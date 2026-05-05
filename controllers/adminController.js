// controllers/adminController.js
const { User, Group, Question, Test, TestQuestion, GroupMember, TestGroup, Result, Notification } = require('../models');
const { Op } = require('sequelize');
const xlsx = require('xlsx');
const { generateStudentPassword } = require('../utils/passwordHelper');
const fs = require('fs');
const path = require('path');
const SUBJECTS_FILE = path.join(__dirname, '../config/subjects.json');
const loadSubjects = () => { try { return JSON.parse(fs.readFileSync(SUBJECTS_FILE, 'utf8')); } catch { return ['Physics','Chemistry','Mathematics','Biology','English','General Knowledge']; } };
const saveSubjects = (list) => fs.writeFileSync(SUBJECTS_FILE, JSON.stringify(list, null, 2));
const { processQuestionImage } = require('../utils/imageUpload');



// ─── DASHBOARD ────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const [studentCount, teacherCount, testCount, groupCount, questionCount] = await Promise.all([
      User.count({ where: { role: 'student', isActive: true } }),
      User.count({ where: { role: 'teacher', isActive: true } }),
      Test.count(),
      Group.count({ where: { isActive: true } }),
      Question.count({ where: { isActive: true } }),
    ]);
    const [recentResults, recentUsers] = await Promise.all([
      Result.findAll({
        limit: 10, order: [['createdAt', 'DESC']],
        include: [{ model: User, as: 'student', attributes: ['name', 'rollNo'] }, { model: Test, as: 'test', attributes: ['title'] }],
      }),
      User.findAll({ where: { role: 'student' }, order: [['createdAt', 'DESC']], limit: 5 }),
    ]);
    res.render('admin/dashboard', { title: 'Admin Dashboard', stats: { studentCount, teacherCount, testCount, groupCount, questionCount }, recentResults, recentUsers, SUBJECTS: loadSubjects() });
  } catch (e) { console.error(e); req.flash('error', 'Failed to load dashboard.'); res.redirect('/auth/login'); }
};

// ─── STUDENT MANAGEMENT ──────────────────────────────────────────────────────
exports.getStudents = async (req, res) => {
  try {
    const students = await User.findAll({ where: { role: 'student' }, order: [['rollNo', 'ASC']] });
    const groups = await Group.findAll({ where: { isActive: true } });
    res.render('admin/students', { title: 'Manage Students', students, groups });
  } catch (e) { req.flash('error', 'Failed to load students.'); res.redirect('/admin/dashboard'); }
};

exports.createStudent = async (req, res) => {
  try {
    const { name, email, rollNo, phone, groupId } = req.body;
    const defaultPassword = generateStudentPassword(rollNo);
    const student = await User.create({ name, email, rollNo, phone, role: 'student', password: defaultPassword, isFirstLogin: true });
    if (groupId) await GroupMember.create({ groupId, userId: student.id, role: 'student' });
    await Notification.create({ userId: student.id, title: 'Account Created', message: `Welcome! Roll No: ${rollNo}, Password: ${defaultPassword}`, type: 'info' });
    req.flash('success', `Student created. Password: ${defaultPassword}`);
    res.redirect('/admin/students');
  } catch (e) {
    req.flash('error', e.name === 'SequelizeUniqueConstraintError' ? 'Roll number or email already exists.' : 'Failed to create student.');
    res.redirect('/admin/students');
  }
};

exports.bulkImportStudents = async (req, res) => {
  try {
    if (!req.files?.csvFile) { req.flash('error', 'No file uploaded.'); return res.redirect('/admin/students'); }
    const rows = xlsx.utils.sheet_to_json(xlsx.read(req.files.csvFile.data, { type: 'buffer' }).Sheets[xlsx.read(req.files.csvFile.data, { type: 'buffer' }).SheetNames[0]]);
    let created = 0, skipped = 0;
    for (const row of rows) {
      try {
        const rollNo = String(row.rollNo || row['Roll No'] || '').trim();
        const name = String(row.name || row.Name || '').trim();
        if (!rollNo || !name) { skipped++; continue; }
        const [, wasCreated] = await User.findOrCreate({ where: { rollNo }, defaults: { name, email: String(row.email || '').trim() || null, rollNo, role: 'student', password: generateStudentPassword(rollNo), isFirstLogin: true } });
        wasCreated ? created++ : skipped++;
      } catch { skipped++; }
    }
    req.flash('success', `Import complete: ${created} created, ${skipped} skipped.`);
    res.redirect('/admin/students');
  } catch (e) { req.flash('error', 'Import failed.'); res.redirect('/admin/students'); }
};

// ─── GROUP MANAGEMENT ────────────────────────────────────────────────────────
exports.getGroups = async (req, res) => {
  try {
    const groups = await Group.findAll({ include: [{ model: User, as: 'members', through: { attributes: ['role'] } }], order: [['createdAt', 'DESC']] });
    const students = await User.findAll({ where: { role: 'student', isActive: true } });
    res.render('admin/groups', { title: 'Manage Groups', groups, students });
  } catch (e) { req.flash('error', 'Failed to load groups.'); res.redirect('/admin/dashboard'); }
};

exports.createGroup = async (req, res) => {
  try {
    const { name, description, academicYear } = req.body;
    await Group.create({ name, description, academicYear: academicYear || process.env.ACADEMIC_YEAR });
    req.flash('success', 'Group created.');
    res.redirect('/admin/groups');
  } catch (e) { req.flash('error', 'Failed to create group. Name may already exist.'); res.redirect('/admin/groups'); }
};

exports.assignMember = async (req, res) => {
  try {
    const { groupId, userId, role } = req.body;
    await GroupMember.findOrCreate({ where: { groupId, userId }, defaults: { role } });
    req.flash('success', 'Member assigned.');
    res.redirect('/admin/groups');
  } catch (e) { req.flash('error', 'Failed to assign member.'); res.redirect('/admin/groups'); }
};

// ─── QUESTION MANAGEMENT (moved from teacher) ────────────────────────────────
exports.getQuestions = async (req, res) => {
  try {
    const { subject, difficulty, page = 1 } = req.query;
    const limit = 20, offset = (page - 1) * limit;
    const where = { isActive: true };
    if (subject) where.subject = subject;
    if (difficulty) where.difficulty = difficulty;
    const { count, rows: questions } = await Question.findAndCountAll({ where, order: [['subject', 'ASC'], ['createdAt', 'DESC']], limit, offset });
    res.render('admin/questions', { title: 'Question Bank', questions, total: count, currentPage: parseInt(page), totalPages: Math.ceil(count / limit), filters: { subject, difficulty }, SUBJECTS: loadSubjects() });
  } catch (e) { req.flash('error', 'Failed to load questions.'); res.redirect('/admin/dashboard'); }
};

exports.createQuestion = async (req, res) => {
  try {
    const { question, optionA, optionB, optionC, optionD, correctAnswer, subject, difficulty, marks, explanation, topic } = req.body;
    let questionImage = null;
    if (req.files?.questionImage) questionImage = await processQuestionImage(req.files.questionImage, `q_${Date.now()}`);
    await Question.create({ question, optionA, optionB, optionC, optionD, correctAnswer, subject, difficulty, marks: parseFloat(marks) || 1, explanation, topic, questionImage, createdBy: req.session.user.id });
    req.flash('success', 'Question added.');
    res.redirect('/admin/questions');
  } catch (e) { req.flash('error', 'Failed to create question: ' + e.message); res.redirect('/admin/questions'); }
};

exports.bulkImportQuestions = async (req, res) => {
  try {
    if (!req.files?.csvFile) { req.flash('error', 'No file uploaded.'); return res.redirect('/admin/questions'); }
    const wb = xlsx.read(req.files.csvFile.data, { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    let created = 0;
    for (const row of rows) {
      try {
        await Question.create({
          question: row.question || row.Question, optionA: row.optionA || row['Option A'], optionB: row.optionB || row['Option B'],
          optionC: row.optionC || row['Option C'], optionD: row.optionD || row['Option D'],
          correctAnswer: (row.correctAnswer || 'A').toUpperCase(), subject: row.subject || 'Physics',
          difficulty: row.difficulty || 'Medium', marks: parseFloat(row.marks || 1), topic: row.topic || null,
          explanation: row.explanation || null, createdBy: req.session.user.id,
        });
        created++;
      } catch {}
    }
    req.flash('success', `${created} questions imported.`);
    res.redirect('/admin/questions');
  } catch (e) { req.flash('error', 'Import failed.'); res.redirect('/admin/questions'); }
};

exports.deleteQuestion = async (req, res) => {
  try {
    await Question.update({ isActive: false }, { where: { id: req.params.id } });
    req.flash('success', 'Question deleted.');
    res.redirect('/admin/questions');
  } catch (e) { req.flash('error', 'Failed.'); res.redirect('/admin/questions'); }
};

// ─── TEST MANAGEMENT (moved from teacher) ────────────────────────────────────
exports.getTests = async (req, res) => {
  try {
    const { subject } = req.query;
    const where = {};
    if (subject) {
      // Filter tests that have questions of this subject
      const qIds = (await Question.findAll({ where: { subject, isActive: true }, attributes: ['id'] })).map(q => q.id);
      const testIds = (await TestQuestion.findAll({ where: { questionId: qIds }, attributes: ['testId'] })).map(t => t.testId);
      where.id = testIds;
    }
    const tests = await Test.findAll({
      where, include: [{ model: Group, as: 'groups', through: { attributes: [] } }],
      order: [['createdAt', 'DESC']],
    });
    res.render('admin/tests', { title: 'Manage Tests', tests, SUBJECTS: loadSubjects(), filterSubject: subject || '' });
  } catch (e) { req.flash('error', 'Failed.'); res.redirect('/admin/dashboard'); }
};

exports.getCreateTest = async (req, res) => {
  try {
    const { subject } = req.query;
    const groups = await Group.findAll({ where: { isActive: true } });
    const where = { isActive: true };
    if (subject) where.subject = subject;
    const questions = await Question.findAll({ where, order: [['subject', 'ASC'], ['difficulty', 'ASC']] });
    res.render('admin/create-test', { title: 'Create Test', groups, questions, SUBJECTS: loadSubjects(), filterSubject: subject || '' });
  } catch (e) { req.flash('error', 'Failed.'); res.redirect('/admin/tests'); }
};

exports.createTest = async (req, res) => {
  try {
    const { title, description, duration, negativeMarking, passingMarks, shuffleQuestions, shuffleOptions, startTime, endTime, instructions, groupIds, questionIds } = req.body;
    const selected = Array.isArray(questionIds) ? questionIds : (questionIds ? [questionIds] : []);
    const questionsData = await Question.findAll({ where: { id: selected } });
    const totalMarks = questionsData.reduce((s, q) => s + q.marks, 0);
    const test = await Test.create({
      title, description, duration: parseInt(duration), negativeMarking: parseFloat(negativeMarking) || 0.25,
      passingMarks: parseFloat(passingMarks) || null, shuffleQuestions: shuffleQuestions === 'on',
      shuffleOptions: shuffleOptions === 'on', startTime: startTime || null, endTime: endTime || null,
      instructions, totalMarks, createdBy: req.session.user.id, status: 'draft',
    });
    for (let i = 0; i < selected.length; i++) await TestQuestion.create({ testId: test.id, questionId: selected[i], orderIndex: i });
    const groups = Array.isArray(groupIds) ? groupIds : (groupIds ? [groupIds] : []);
    for (const gId of groups) await TestGroup.create({ testId: test.id, groupId: gId });
    req.flash('success', 'Test created!');
    res.redirect(`/admin/tests/${test.id}`);
  } catch (e) { req.flash('error', 'Failed: ' + e.message); res.redirect('/admin/tests/create'); }
};

exports.getTestDetail = async (req, res) => {
  try {
    const test = await Test.findOne({
      where: { id: req.params.id },
      include: [{ model: Question, as: 'questions', through: { attributes: ['orderIndex'] } }, { model: Group, as: 'groups', through: { attributes: [] } }],
    });
    if (!test) { req.flash('error', 'Not found.'); return res.redirect('/admin/tests'); }
    const results = await Result.findAll({
      where: { testId: test.id, status: { [Op.in]: ['submitted', 'auto_submitted'] } },
      include: [{ model: User, as: 'student', attributes: ['name', 'rollNo'] }],
      order: [['score', 'DESC']],
    });
    res.render('admin/test-detail', { title: test.title, test, results });
  } catch (e) { req.flash('error', 'Failed.'); res.redirect('/admin/tests'); }
};

exports.publishTest = async (req, res) => {
  try {
    const test = await Test.findByPk(req.params.id);
    if (!test) { req.flash('error', 'Not found.'); return res.redirect('/admin/tests'); }
    await test.update({ status: 'published' });
    const testGroups = await TestGroup.findAll({ where: { testId: test.id } });
    for (const tg of testGroups) {
      const members = await GroupMember.findAll({ where: { groupId: tg.groupId, role: 'student' } });
      for (const m of members) await Notification.create({ userId: m.userId, title: 'New Exam Published', message: `"${test.title}" is now available. Duration: ${test.duration} mins.`, type: 'exam', link: '/student/tests' });
    }
    req.flash('success', 'Test published and students notified!');
    res.redirect(`/admin/tests/${test.id}`);
  } catch (e) { req.flash('error', 'Failed.'); res.redirect('/admin/tests'); }
};

// ─── RESULTS ─────────────────────────────────────────────────────────────────
exports.getAllResults = async (req, res) => {
  try {
    const results = await Result.findAll({
      include: [{ model: User, as: 'student', attributes: ['name', 'rollNo'] }, { model: Test, as: 'test', attributes: ['title'] }],
      order: [['createdAt', 'DESC']],
    });
    res.render('admin/results', { title: 'All Results', results });
  } catch (e) { req.flash('error', 'Failed to load results.'); res.redirect('/admin/dashboard'); }
};

// ─── SUBJECT MANAGEMENT ──────────────────────────────────────────────────────
// Subjects are stored as a JSON config file for simplicity

exports.getSubjects = (req, res) => {
  const subjects = loadSubjects();
  const subjectStats = {};
  // Count questions per subject async
  Promise.all(subjects.map(s => Question.count({ where: { subject: s, isActive: true } })))
    .then(counts => {
      subjects.forEach((s, i) => subjectStats[s] = counts[i]);
      res.render('admin/subjects', { title: 'Manage Subjects', subjects, subjectStats });
    })
    .catch(() => res.render('admin/subjects', { title: 'Manage Subjects', subjects, subjectStats: {} }));
};

exports.addSubject = (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) { req.flash('error', 'Subject name is required.'); return res.redirect('/admin/subjects'); }
  const subjects = loadSubjects();
  const trimmed = name.trim();
  if (subjects.includes(trimmed)) { req.flash('error', 'Subject already exists.'); return res.redirect('/admin/subjects'); }
  subjects.push(trimmed);
  saveSubjects(subjects);
  req.flash('success', `Subject "${trimmed}" added.`);
  res.redirect('/admin/subjects');
};

exports.deleteSubject = async (req, res) => {
  const { name } = req.body;
  const count = await Question.count({ where: { subject: name, isActive: true } });
  if (count > 0) { req.flash('error', `Cannot delete "${name}" — it has ${count} questions. Remove questions first.`); return res.redirect('/admin/subjects'); }
  const subjects = loadSubjects().filter(s => s !== name);
  saveSubjects(subjects);
  req.flash('success', `Subject "${name}" deleted.`);
  res.redirect('/admin/subjects');
};
