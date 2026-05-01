// controllers/adminController.js
const { User, Group, Test, Result, GroupMember, Notification } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');
const { generateStudentPassword, generateTeacherPassword } = require('../utils/passwordHelper');

/**
 * GET /admin/dashboard
 */
exports.getDashboard = async (req, res) => {
  try {
    const [studentCount, teacherCount, testCount, groupCount] = await Promise.all([
      User.count({ where: { role: 'student', isActive: true } }),
      User.count({ where: { role: 'teacher', isActive: true } }),
      Test.count(),
      Group.count({ where: { isActive: true } }),
    ]);

    const recentResults = await Result.findAll({
      limit: 10,
      order: [['createdAt', 'DESC']],
      include: [
        { model: User, as: 'student', attributes: ['name', 'rollNo'] },
        { model: Test, as: 'test', attributes: ['title'] },
      ],
    });

    const recentUsers = await User.findAll({
      where: { role: { [Op.in]: ['student', 'teacher'] } },
      limit: 8,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'name', 'email', 'rollNo', 'role', 'createdAt'],
    });

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: { studentCount, teacherCount, testCount, groupCount },
      recentResults,
      recentUsers,
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    req.flash('error', 'Failed to load dashboard.');
    res.redirect('/auth/login');
  }
};

// ─── TEACHER MANAGEMENT ──────────────────────────────────────────────────────

exports.getTeachers = async (req, res) => {
  try {
    const teachers = await User.findAll({
      where: { role: 'teacher' },
      order: [['createdAt', 'DESC']],
    });
    res.render('admin/teachers', { title: 'Manage Teachers', teachers });
  } catch (error) {
    req.flash('error', 'Failed to load teachers.');
    res.redirect('/admin/dashboard');
  }
};

exports.createTeacher = async (req, res) => {
  try {
    const { name, email, phone, subject } = req.body;
    const defaultPassword = generateTeacherPassword(name);

    await User.create({
      name,
      email,
      phone,
      subject,
      role: 'teacher',
      password: defaultPassword,
      isFirstLogin: true,
    });

    req.flash('success', `Teacher created. Default password: ${defaultPassword}`);
    res.redirect('/admin/teachers');
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      req.flash('error', 'Email already exists.');
    } else {
      req.flash('error', 'Failed to create teacher.');
    }
    res.redirect('/admin/teachers');
  }
};

exports.deleteTeacher = async (req, res) => {
  try {
    await User.update({ isActive: false }, { where: { id: req.params.id, role: 'teacher' } });
    req.flash('success', 'Teacher deactivated successfully.');
    res.redirect('/admin/teachers');
  } catch (error) {
    req.flash('error', 'Failed to deactivate teacher.');
    res.redirect('/admin/teachers');
  }
};

// ─── STUDENT MANAGEMENT ──────────────────────────────────────────────────────

exports.getStudents = async (req, res) => {
  try {
    const students = await User.findAll({
      where: { role: 'student' },
      order: [['rollNo', 'ASC']],
    });
    const groups = await Group.findAll({ where: { isActive: true } });
    res.render('admin/students', { title: 'Manage Students', students, groups });
  } catch (error) {
    req.flash('error', 'Failed to load students.');
    res.redirect('/admin/dashboard');
  }
};

exports.createStudent = async (req, res) => {
  try {
    const { name, email, rollNo, phone, groupId } = req.body;
    const defaultPassword = generateStudentPassword(rollNo);

    const student = await User.create({
      name,
      email,
      rollNo,
      phone,
      role: 'student',
      password: defaultPassword,
      isFirstLogin: true,
    });

    if (groupId) {
      await GroupMember.create({ groupId, userId: student.id, role: 'student' });
    }

    // Notify student
    await Notification.create({
      userId: student.id,
      title: 'Account Created',
      message: `Welcome to ${process.env.COLLEGE_SHORT_NAME} Exam Portal! Your Roll No: ${rollNo}, Default Password: ${defaultPassword}`,
      type: 'info',
    });

    req.flash('success', `Student created. Roll No: ${rollNo}, Password: ${defaultPassword}`);
    res.redirect('/admin/students');
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      req.flash('error', 'Roll number or email already exists.');
    } else {
      req.flash('error', 'Failed to create student: ' + error.message);
    }
    res.redirect('/admin/students');
  }
};

exports.bulkImportStudents = async (req, res) => {
  try {
    if (!req.files || !req.files.csvFile) {
      req.flash('error', 'No file uploaded.');
      return res.redirect('/admin/students');
    }

    const file = req.files.csvFile;
    const workbook = xlsx.read(file.data, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    let created = 0, skipped = 0;

    for (const row of rows) {
      try {
        const rollNo = String(row.rollNo || row.roll_no || row['Roll No'] || '').trim();
        const name = String(row.name || row.Name || '').trim();
        const email = String(row.email || row.Email || '').trim();

        if (!rollNo || !name) { skipped++; continue; }

        const defaultPassword = generateStudentPassword(rollNo);
        const [, wasCreated] = await User.findOrCreate({
          where: { rollNo },
          defaults: { name, email: email || null, rollNo, role: 'student', password: defaultPassword, isFirstLogin: true },
        });
        if (wasCreated) created++; else skipped++;
      } catch { skipped++; }
    }

    req.flash('success', `Bulk import complete: ${created} created, ${skipped} skipped.`);
    res.redirect('/admin/students');
  } catch (error) {
    req.flash('error', 'Failed to import students: ' + error.message);
    res.redirect('/admin/students');
  }
};

// ─── GROUP MANAGEMENT ────────────────────────────────────────────────────────

exports.getGroups = async (req, res) => {
  try {
    const groups = await Group.findAll({
      include: [{ model: User, as: 'members', through: { attributes: ['role'] } }],
      order: [['createdAt', 'DESC']],
    });
    const students = await User.findAll({ where: { role: 'student', isActive: true } });
    const teachers = await User.findAll({ where: { role: 'teacher', isActive: true } });
    res.render('admin/groups', { title: 'Manage Groups', groups, students, teachers });
  } catch (error) {
    req.flash('error', 'Failed to load groups.');
    res.redirect('/admin/dashboard');
  }
};

exports.createGroup = async (req, res) => {
  try {
    const { name, description, academicYear } = req.body;
    await Group.create({ name, description, academicYear: academicYear || process.env.ACADEMIC_YEAR });
    req.flash('success', 'Group created successfully.');
    res.redirect('/admin/groups');
  } catch (error) {
    req.flash('error', 'Failed to create group. Name may already exist.');
    res.redirect('/admin/groups');
  }
};

exports.assignMember = async (req, res) => {
  try {
    const { groupId, userId, role } = req.body;
    await GroupMember.findOrCreate({ where: { groupId, userId }, defaults: { role } });
    req.flash('success', 'Member assigned to group.');
    res.redirect('/admin/groups');
  } catch (error) {
    req.flash('error', 'Failed to assign member.');
    res.redirect('/admin/groups');
  }
};

// ─── RESULTS ─────────────────────────────────────────────────────────────────

exports.getAllResults = async (req, res) => {
  try {
    const results = await Result.findAll({
      include: [
        { model: User, as: 'student', attributes: ['name', 'rollNo'] },
        { model: Test, as: 'test', attributes: ['title'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.render('admin/results', { title: 'All Results', results });
  } catch (error) {
    req.flash('error', 'Failed to load results.');
    res.redirect('/admin/dashboard');
  }
};
