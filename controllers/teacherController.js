// controllers/teacherController.js
const { User, Test, Question, TestQuestion, Group, TestGroup, Result, Notification } = require('../models');
const { Op, sequelize: db } = require('sequelize');
const xlsx = require('xlsx');

/**
 * GET /teacher/dashboard
 */
exports.getDashboard = async (req, res) => {
  try {
    const teacherId = req.session.user.id;

    const [testCount, questionCount, studentsTested] = await Promise.all([
      Test.count({ where: { createdBy: teacherId } }),
      Question.count({ where: { createdBy: teacherId } }),
      Result.count({
        include: [{ model: Test, as: 'test', where: { createdBy: teacherId }, required: true }],
      }),
    ]);

    const recentTests = await Test.findAll({
      where: { createdBy: teacherId },
      order: [['createdAt', 'DESC']],
      limit: 5,
      include: [{ model: Group, as: 'groups', through: { attributes: [] } }],
    });

    res.render('teacher/dashboard', {
      title: 'Teacher Dashboard',
      stats: { testCount, questionCount, studentsTested },
      recentTests,
    });
  } catch (error) {
    console.error('Teacher dashboard error:', error);
    req.flash('error', 'Failed to load dashboard.');
    res.redirect('/auth/login');
  }
};

// ─── QUESTION MANAGEMENT ─────────────────────────────────────────────────────

exports.getQuestions = async (req, res) => {
  try {
    const { subject, difficulty, page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;

    const where = { createdBy: req.session.user.id };
    if (subject) where.subject = subject;
    if (difficulty) where.difficulty = difficulty;

    const { count, rows: questions } = await Question.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    res.render('teacher/questions', {
      title: 'Question Bank',
      questions,
      total: count,
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      filters: { subject, difficulty },
    });
  } catch (error) {
    req.flash('error', 'Failed to load questions.');
    res.redirect('/teacher/dashboard');
  }
};

exports.createQuestion = async (req, res) => {
  try {
    const { question, optionA, optionB, optionC, optionD, correctAnswer, subject, difficulty, marks, explanation } = req.body;
    await Question.create({
      question, optionA, optionB, optionC, optionD, correctAnswer,
      subject, difficulty, marks: parseFloat(marks) || 1,
      explanation, createdBy: req.session.user.id,
    });
    req.flash('success', 'Question added successfully.');
    res.redirect('/teacher/questions');
  } catch (error) {
    req.flash('error', 'Failed to create question.');
    res.redirect('/teacher/questions');
  }
};

exports.bulkImportQuestions = async (req, res) => {
  try {
    if (!req.files || !req.files.csvFile) {
      req.flash('error', 'No file uploaded.');
      return res.redirect('/teacher/questions');
    }

    const file = req.files.csvFile;
    const workbook = xlsx.read(file.data, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    let created = 0;
    for (const row of rows) {
      try {
        await Question.create({
          question: row.question || row.Question,
          optionA: row.optionA || row.OptionA || row['Option A'],
          optionB: row.optionB || row.OptionB || row['Option B'],
          optionC: row.optionC || row.OptionC || row['Option C'],
          optionD: row.optionD || row.OptionD || row['Option D'],
          correctAnswer: (row.correctAnswer || row.CorrectAnswer || row['Correct Answer'] || 'A').toUpperCase(),
          subject: row.subject || row.Subject || 'Physics',
          difficulty: row.difficulty || row.Difficulty || 'Medium',
          marks: parseFloat(row.marks || row.Marks || 1),
          explanation: row.explanation || row.Explanation || null,
          createdBy: req.session.user.id,
        });
        created++;
      } catch { /* skip invalid rows */ }
    }

    req.flash('success', `${created} questions imported successfully.`);
    res.redirect('/teacher/questions');
  } catch (error) {
    req.flash('error', 'Failed to import questions.');
    res.redirect('/teacher/questions');
  }
};

exports.deleteQuestion = async (req, res) => {
  try {
    await Question.update({ isActive: false }, { where: { id: req.params.id, createdBy: req.session.user.id } });
    req.flash('success', 'Question deleted.');
    res.redirect('/teacher/questions');
  } catch (error) {
    req.flash('error', 'Failed to delete question.');
    res.redirect('/teacher/questions');
  }
};

// ─── TEST MANAGEMENT ─────────────────────────────────────────────────────────

exports.getTests = async (req, res) => {
  try {
    const tests = await Test.findAll({
      where: { createdBy: req.session.user.id },
      include: [{ model: Group, as: 'groups', through: { attributes: [] } }],
      order: [['createdAt', 'DESC']],
    });
    res.render('teacher/tests', { title: 'My Tests', tests });
  } catch (error) {
    req.flash('error', 'Failed to load tests.');
    res.redirect('/teacher/dashboard');
  }
};

exports.getCreateTest = async (req, res) => {
  try {
    const groups = await Group.findAll({ where: { isActive: true } });
    const questions = await Question.findAll({
      where: { createdBy: req.session.user.id, isActive: true },
      order: [['subject', 'ASC'], ['difficulty', 'ASC']],
    });
    res.render('teacher/create-test', { title: 'Create Test', groups, questions });
  } catch (error) {
    req.flash('error', 'Failed to load create test form.');
    res.redirect('/teacher/tests');
  }
};

exports.createTest = async (req, res) => {
  try {
    const {
      title, description, duration, negativeMarking, passingMarks,
      shuffleQuestions, shuffleOptions, startTime, endTime,
      instructions, groupIds, questionIds,
    } = req.body;

    const selectedQuestions = Array.isArray(questionIds) ? questionIds : (questionIds ? [questionIds] : []);
    const questionsData = await Question.findAll({ where: { id: selectedQuestions } });
    const totalMarks = questionsData.reduce((sum, q) => sum + q.marks, 0);

    const test = await Test.create({
      title, description, duration: parseInt(duration),
      negativeMarking: parseFloat(negativeMarking) || 0.25,
      passingMarks: parseFloat(passingMarks) || null,
      shuffleQuestions: shuffleQuestions === 'on',
      shuffleOptions: shuffleOptions === 'on',
      startTime: startTime || null,
      endTime: endTime || null,
      instructions,
      totalMarks,
      createdBy: req.session.user.id,
      status: 'draft',
    });

    // Add questions
    for (let i = 0; i < selectedQuestions.length; i++) {
      await TestQuestion.create({ testId: test.id, questionId: selectedQuestions[i], orderIndex: i });
    }

    // Assign to groups
    const groups = Array.isArray(groupIds) ? groupIds : (groupIds ? [groupIds] : []);
    for (const groupId of groups) {
      await TestGroup.create({ testId: test.id, groupId });
    }

    req.flash('success', 'Test created successfully!');
    res.redirect(`/teacher/tests/${test.id}`);
  } catch (error) {
    console.error('Create test error:', error);
    req.flash('error', 'Failed to create test: ' + error.message);
    res.redirect('/teacher/tests/create');
  }
};

exports.getTestDetail = async (req, res) => {
  try {
    const test = await Test.findOne({
      where: { id: req.params.id, createdBy: req.session.user.id },
      include: [
        { model: Question, as: 'questions', through: { attributes: ['orderIndex'] } },
        { model: Group, as: 'groups', through: { attributes: [] } },
      ],
    });

    if (!test) {
      req.flash('error', 'Test not found.');
      return res.redirect('/teacher/tests');
    }

    const results = await Result.findAll({
      where: { testId: test.id, status: 'submitted' },
      include: [{ model: User, as: 'student', attributes: ['name', 'rollNo'] }],
      order: [['score', 'DESC']],
    });

    res.render('teacher/test-detail', { title: test.title, test, results });
  } catch (error) {
    req.flash('error', 'Failed to load test.');
    res.redirect('/teacher/tests');
  }
};

exports.publishTest = async (req, res) => {
  try {
    const test = await Test.findOne({ where: { id: req.params.id, createdBy: req.session.user.id } });
    if (!test) { req.flash('error', 'Test not found.'); return res.redirect('/teacher/tests'); }

    await test.update({ status: 'published' });

    // Notify students in assigned groups
    const testGroups = await TestGroup.findAll({ where: { testId: test.id } });
    for (const tg of testGroups) {
      const members = await require('../models/GroupMember').findAll({ where: { groupId: tg.groupId, role: 'student' } });
      for (const member of members) {
        await Notification.create({
          userId: member.userId,
          title: 'New Exam Published',
          message: `Exam "${test.title}" has been published. Duration: ${test.duration} minutes.`,
          type: 'exam',
          link: '/student/tests',
        });
      }
    }

    req.flash('success', 'Test published and students notified!');
    res.redirect(`/teacher/tests/${test.id}`);
  } catch (error) {
    req.flash('error', 'Failed to publish test.');
    res.redirect('/teacher/tests');
  }
};

exports.getStudentPerformance = async (req, res) => {
  try {
    const teacherId = req.session.user.id;
    const results = await Result.findAll({
      include: [
        { model: User, as: 'student', attributes: ['name', 'rollNo'] },
        { model: Test, as: 'test', where: { createdBy: teacherId }, attributes: ['title', 'totalMarks'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.render('teacher/performance', { title: 'Student Performance', results });
  } catch (error) {
    req.flash('error', 'Failed to load performance data.');
    res.redirect('/teacher/dashboard');
  }
};
