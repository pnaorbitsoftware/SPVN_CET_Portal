// controllers/studentController.js
const { User, Test, Question, TestQuestion, Group, TestGroup, GroupMember, Result, Notification } = require('../models');
const { Op } = require('sequelize');

/**
 * GET /student/dashboard
 */
exports.getDashboard = async (req, res) => {
  try {
    const studentId = req.session.user.id;

    // Get student's groups
    const groupMemberships = await GroupMember.findAll({ where: { userId: studentId, role: 'student' } });
    const groupIds = groupMemberships.map(gm => gm.groupId);

    // Get tests assigned to those groups (guard empty array — Op.in([]) crashes MySQL)
    let availableTests = [];
    if (groupIds.length > 0) {
      const testGroups = await TestGroup.findAll({ where: { groupId: { [Op.in]: groupIds } } });
      const testIds = [...new Set(testGroups.map(tg => tg.testId))];
      if (testIds.length > 0) {
        availableTests = await Test.findAll({
          where: { id: { [Op.in]: testIds }, status: { [Op.in]: ['published', 'active'] } },
          order: [['createdAt', 'DESC']],
        });
      }
    }

    // Completed tests
    const completedResults = await Result.findAll({
      where: { studentId, status: { [Op.in]: ['submitted', 'auto_submitted'] } },
      include: [{ model: Test, as: 'test', attributes: ['title', 'totalMarks'] }],
      order: [['submittedAt', 'DESC']],
      limit: 5,
    });

    const completedTestIds = completedResults.map(r => r.testId);

    // Pending tests
    const pendingTests = availableTests.filter(t => !completedTestIds.includes(t.id));

    // Unread notifications
    const notifications = await Notification.findAll({
      where: { userId: studentId, isRead: false },
      order: [['createdAt', 'DESC']],
      limit: 5,
    });

    res.render('student/dashboard', {
      title: 'Student Dashboard',
      pendingTests,
      completedResults,
      notifications,
      stats: {
        pending: pendingTests.length,
        completed: completedResults.length,
        avgScore: completedResults.length
          ? (completedResults.reduce((s, r) => s + (r.score / r.totalMarks) * 100, 0) / completedResults.length).toFixed(1)
          : 0,
      },
    });
  } catch (error) {
    console.error('Student dashboard error:', error);
    req.flash('error', 'Failed to load dashboard.');
    res.redirect('/auth/login');
  }
};

/**
 * GET /student/tests
 */
exports.getTests = async (req, res) => {
  try {
    const studentId = req.session.user.id;

    const groupMemberships = await GroupMember.findAll({ where: { userId: studentId } });
    const groupIds = groupMemberships.map(gm => gm.groupId);
    let tests = [];
    if (groupIds.length > 0) {
      const testGroups = await TestGroup.findAll({ where: { groupId: { [Op.in]: groupIds } } });
      const testIds = [...new Set(testGroups.map(tg => tg.testId))];
      if (testIds.length > 0) {
        tests = await Test.findAll({
          where: { id: { [Op.in]: testIds }, status: { [Op.in]: ['published', 'active', 'closed'] } },
          order: [['createdAt', 'DESC']],
        });
      }
    }

    const results = await Result.findAll({
      where: { studentId },
      attributes: ['testId', 'score', 'totalMarks', 'status', 'rank'],
    });

    const resultMap = {};
    results.forEach(r => { resultMap[r.testId] = r; });

    res.render('student/tests', { title: 'My Tests', tests, resultMap });
  } catch (error) {
    req.flash('error', 'Failed to load tests.');
    res.redirect('/student/dashboard');
  }
};

/**
 * GET /student/notifications
 */
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { userId: req.session.user.id },
      order: [['createdAt', 'DESC']],
    });
    // Mark all as read
    await Notification.update({ isRead: true }, { where: { userId: req.session.user.id } });
    res.render('student/notifications', { title: 'Notifications', notifications });
  } catch (error) {
    req.flash('error', 'Failed to load notifications.');
    res.redirect('/student/dashboard');
  }
};

/**
 * GET /student/results
 */
exports.getResults = async (req, res) => {
  try {
    const results = await Result.findAll({
      where: { studentId: req.session.user.id, status: { [Op.in]: ['submitted', 'auto_submitted'] } },
      include: [{ model: Test, as: 'test', attributes: ['title', 'totalMarks', 'duration'] }],
      order: [['submittedAt', 'DESC']],
    });
    res.render('student/results', { title: 'My Results', results });
  } catch (error) {
    req.flash('error', 'Failed to load results.');
    res.redirect('/student/dashboard');
  }
};

// ── DOCUMENT UPLOAD ───────────────────────────────────────────────────────────
const { StudentDocument } = require('../models');
const fs   = require('fs');
const path = require('path');
const DOC_DIR = path.join(__dirname, '../public/uploads/documents');
if (!fs.existsSync(DOC_DIR)) fs.mkdirSync(DOC_DIR, { recursive: true });

exports.getDocuments = async (req, res) => {
  try {
    const docs = await StudentDocument.findAll({ where: { studentId: req.session.user.id }, order: [['createdAt','DESC']] });
    res.render('student/documents', { title: 'My Documents', docs });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/student/dashboard'); }
};

exports.uploadDocument = async (req, res) => {
  try {
    if (!req.files?.document) { req.flash('error','No file selected.'); return res.redirect('/student/documents'); }
    const file = req.files.document;
    const fname = `doc_${req.session.user.id}_${Date.now()}_${file.name.replace(/\s+/g,'_')}`;
    const filePath = '/uploads/documents/' + fname;
    fs.writeFileSync(path.join(DOC_DIR, fname), file.data);
    await StudentDocument.create({
      studentId: req.session.user.id, fileName: fname,
      originalName: file.name, fileType: file.mimetype,
      fileSize: file.size, filePath,
      description: req.body.description || '',
    });
    req.flash('success', 'Document uploaded.');
    res.redirect('/student/documents');
  } catch (e) { req.flash('error','Upload failed: ' + e.message); res.redirect('/student/documents'); }
};
