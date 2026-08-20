const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const xlsx = require('xlsx');

const { Group, GroupMember, Notification, Question, QuestionImport, Result, StudentDocument, Test, Topic, User } = require('../models');
const adminController = require('../controllers/adminController');
const examController = require('../controllers/examController');
const { buildQuestionOrder, buildSectionState, isCetSectionTest } = require('../utils/cetExam');
const { SUPPORTED_EXTENSIONS, extensionOf, extractQuestionFiles, normalizeQuestion, preserveQuestionVisuals, removeQuestionImportAssets } = require('../utils/questionImporter');
const { extractSyllabusFromPdf } = require('../utils/syllabusImporter');

const router = express.Router();
const tokenSecret = process.env.MOBILE_API_SECRET || process.env.SESSION_SECRET || 'svpn_mobile_dev_secret';
const documentDirectory = path.join(__dirname, '../public/uploads/documents');
const pdfDirectory = path.join(__dirname, '../public/uploads/pdfs');
if (!fs.existsSync(documentDirectory)) fs.mkdirSync(documentDirectory, { recursive: true });
if (!fs.existsSync(pdfDirectory)) fs.mkdirSync(pdfDirectory, { recursive: true });

const COURSES = ['JEE', 'CET', 'NEET'];
const SUBJECTS_BY_COURSE = {
  JEE: ['Physics', 'Chemistry', 'Mathematics'],
  CET: ['Physics', 'Chemistry', 'Mathematics', 'Biology'],
  NEET: ['Physics', 'Chemistry', 'Biology'],
};
const ALL_SUBJECTS = ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English', 'General Knowledge'];
const completedStatuses = { $in: ['submitted', 'auto_submitted'] };

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const cleanList = (value) => asArray(value).map((item) => String(item).trim()).filter(Boolean);
const fileNameSafe = (value) => String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
const controllerSession = (req) => {
  req.session.user = {
    id: req.mobileUser._id.toString(),
    name: req.mobileUser.name,
    email: req.mobileUser.email,
    rollNo: req.mobileUser.rollNo,
    role: req.mobileUser.role,
    isFirstLogin: req.mobileUser.isFirstLogin,
  };
};

router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

const serializeUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email || null,
  rollNo: user.rollNo || null,
  role: user.role,
  isFirstLogin: user.isFirstLogin,
  profilePhoto: user.profilePhoto || null,
});

const issueToken = (user) => jwt.sign(
  { sub: user._id.toString(), role: user.role, nonce: crypto.randomUUID() },
  tokenSecret,
  { expiresIn: '24h' },
);

const requireMobileUser = async (req, res, next) => {
  try {
    const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Authentication required.' });
    const payload = jwt.verify(token, tokenSecret);
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) return res.status(401).json({ error: 'Account is unavailable.' });
    req.mobileUser = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Your session has expired. Please login again.' });
  }
};

const requireRole = (role) => (req, res, next) => {
  if (req.mobileUser.role !== role) return res.status(403).json({ error: 'Access denied.' });
  return next();
};

router.post('/auth/login', async (req, res) => {
  try {
    const { identifier, password, role = 'student' } = req.body;
    if (!identifier || !password || !['student', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Identifier, password, and role are required.' });
    }

    const query = role === 'admin'
      ? { email: identifier.trim().toLowerCase(), role }
      : { rollNo: identifier.trim(), role };
    const user = await User.findOne(query);
    if (!user || !user.isActive || !(await user.verifyPassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    user.lastLogin = new Date();
    await user.save();
    return res.json({ token: issueToken(user), user: serializeUser(user) });
  } catch (error) {
    console.error('Mobile login error:', error);
    return res.status(500).json({ error: 'Unable to login right now.' });
  }
});

router.get('/me', requireMobileUser, (req, res) => res.json({ user: serializeUser(req.mobileUser) }));

router.post('/auth/change-password', requireMobileUser, async (req, res) => {
  try {
    const { currentPassword = '', newPassword = '', confirmPassword = '' } = req.body;
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (!req.mobileUser.isFirstLogin && !(await req.mobileUser.verifyPassword(currentPassword))) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    req.mobileUser.password = newPassword;
    req.mobileUser.isFirstLogin = false;
    await req.mobileUser.save();
    return res.json({ user: serializeUser(req.mobileUser), token: issueToken(req.mobileUser) });
  } catch (error) {
    console.error('Mobile password change error:', error);
    return res.status(500).json({ error: 'Unable to change password.' });
  }
});

router.get('/meta', requireMobileUser, async (req, res) => {
  const topics = await Topic.find({ isActive: true }).sort({ course: 1, subject: 1, name: 1 });
  return res.json({ courses: COURSES, subjectsByCourse: SUBJECTS_BY_COURSE, allSubjects: ALL_SUBJECTS, topics });
});

router.get('/results/:resultId', requireMobileUser, async (req, res) => {
  try {
    const result = await Result.findById(req.params.resultId)
      .populate('studentId', 'name rollNo email')
      .populate({ path: 'testId', populate: { path: 'questions' } });
    if (!result) return res.status(404).json({ error: 'Result not found.' });
    if (req.mobileUser.role === 'student' && result.studentId?._id.toString() !== req.mobileUser._id.toString()) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const [topperResult, totalAttempted, trend] = await Promise.all([
      Result.findOne({ testId: result.testId._id, rank: 1 }, 'score subjectScores'),
      Result.countDocuments({ testId: result.testId._id, status: completedStatuses }),
      Result.find({ studentId: result.studentId._id, status: completedStatuses })
        .populate('testId', 'title')
        .sort({ submittedAt: 1 })
        .limit(10),
    ]);
    const percentage = result.totalMarks > 0 ? Number(((result.score / result.totalMarks) * 100).toFixed(1)) : 0;
    return res.json({ result, percentage, topperResult, totalAttempted, trend });
  } catch (error) {
    console.error('Mobile result detail error:', error);
    return res.status(500).json({ error: 'Unable to load result.' });
  }
});

router.get('/results/:resultId/pdf', requireMobileUser, async (req, res) => {
  const result = await Result.findById(req.params.resultId).select('studentId');
  if (!result) return res.status(404).json({ error: 'Result not found.' });
  if (req.mobileUser.role === 'student' && result.studentId.toString() !== req.mobileUser._id.toString()) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  controllerSession(req);
  return examController.downloadResultPDF(req, res);
});

router.get('/tests/:testId/leaderboard', requireMobileUser, async (req, res) => {
  const [test, results] = await Promise.all([
    Test.findById(req.params.testId).select('title totalMarks duration subject course'),
    Result.find({ testId: req.params.testId, status: completedStatuses })
      .populate('studentId', 'name rollNo')
      .sort({ score: -1, timeTaken: 1 })
      .limit(50),
  ]);
  if (!test) return res.status(404).json({ error: 'Test not found.' });
  return res.json({ test, results });
});

router.get('/student/dashboard', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const studentId = req.mobileUser._id;
    const [memberships, results, notifications, inProgressResults] = await Promise.all([
      GroupMember.find({ userId: studentId, role: 'student' }, 'groupId'),
      Result.find({ studentId, status: { $in: ['submitted', 'auto_submitted'] } })
        .populate('testId', 'title totalMarks subject course duration')
        .sort({ submittedAt: -1 }),
      Notification.find({ userId: studentId, isRead: false }).sort({ createdAt: -1 }).limit(8),
      Result.find({ studentId, status: 'in_progress' }, 'testId'),
    ]);
    const groupIds = memberships.map((membership) => membership.groupId);
    const tests = groupIds.length
      ? await Test.find({ groups: { $in: groupIds }, status: { $in: ['published', 'active'] }, isActive: { $ne: false } }, 'title duration totalMarks subject startTime endTime').sort({ startTime: 1 })
      : [];
    const completedIds = new Set(results.map((result) => result.testId?._id?.toString()));
    const inProgressIds = new Set(inProgressResults.map((result) => result.testId?.toString()));
    const pendingTests = tests.filter((test) => !completedIds.has(test._id.toString()) && !inProgressIds.has(test._id.toString()));
    const averageScore = results.length
      ? Number((results.reduce((total, result) => total + (result.totalMarks ? (result.score / result.totalMarks) * 100 : 0), 0) / results.length).toFixed(1))
      : 0;
    const totalCorrect = results.reduce((total, result) => total + (result.correctAnswers || 0), 0);
    const totalAttempted = results.reduce((total, result) => total + (result.correctAnswers || 0) + (result.wrongAnswers || 0), 0);
    const accuracy = totalAttempted ? Number(((totalCorrect / totalAttempted) * 100).toFixed(1)) : 0;
    const subjectMap = {};
    results.forEach((result) => {
      const subjects = Array.isArray(result.testId?.subject) && result.testId.subject.length ? result.testId.subject : ['General'];
      subjects.forEach((subject) => {
        subjectMap[subject] ||= { marks: 0, maxMarks: 0, count: 0 };
        subjectMap[subject].marks += result.score;
        subjectMap[subject].maxMarks += result.totalMarks;
        subjectMap[subject].count += 1;
      });
    });
    const subjectStats = Object.entries(subjectMap).map(([name, values]) => ({
      name,
      ...values,
      percentage: values.maxMarks ? Number(((values.marks / values.maxMarks) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.percentage - a.percentage);
    const chartData = [...results].reverse().slice(-10).map((result) => ({
      label: result.testId?.title || 'Test',
      percentage: result.totalMarks ? Number(((result.score / result.totalMarks) * 100).toFixed(1)) : 0,
      score: result.score,
      total: result.totalMarks,
      date: result.submittedAt,
    }));
    let scoreTrend = 'neutral';
    if (results.length >= 2) {
      const latest = results[0].totalMarks ? results[0].score / results[0].totalMarks : 0;
      const previous = results[1].totalMarks ? results[1].score / results[1].totalMarks : 0;
      scoreTrend = latest > previous ? 'up' : latest < previous ? 'down' : 'neutral';
    }

    return res.json({
      stats: { pending: pendingTests.length, completed: results.length, averageScore, accuracy, totalCorrect, totalAttempted, scoreTrend },
      pendingTests: pendingTests.slice(0, 8),
      recentResults: results.slice(0, 5),
      notifications,
      subjectStats,
      chartData,
    });
  } catch (error) {
    console.error('Mobile student dashboard error:', error);
    return res.status(500).json({ error: 'Unable to load dashboard.' });
  }
});

router.get('/student/tests', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const studentId = req.mobileUser._id;
    const [memberships, results] = await Promise.all([
      GroupMember.find({ userId: studentId, role: 'student' }, 'groupId'),
      Result.find({ studentId }, 'testId score totalMarks status rank submittedAt'),
    ]);
    const groupIds = memberships.map((membership) => membership.groupId);
    const tests = groupIds.length
      ? await Test.find({ groups: { $in: groupIds }, status: { $in: ['published', 'active', 'closed'] }, isActive: { $ne: false } }).sort({ createdAt: -1 })
      : [];
    const resultByTest = new Map(results.map((result) => [result.testId.toString(), result]));
    return res.json({ tests: tests.map((test) => ({ ...test.toObject(), result: resultByTest.get(test._id.toString()) || null })) });
  } catch (error) {
    console.error('Mobile tests error:', error);
    return res.status(500).json({ error: 'Unable to load tests.' });
  }
});

router.get('/student/results', requireMobileUser, requireRole('student'), async (req, res) => {
  const results = await Result.find({ studentId: req.mobileUser._id, status: { $in: ['submitted', 'auto_submitted'] } })
    .populate('testId', 'title totalMarks duration subject')
    .sort({ submittedAt: -1 });
  return res.json({ results });
});

router.get('/student/notifications', requireMobileUser, requireRole('student'), async (req, res) => {
  const notifications = await Notification.find({ userId: req.mobileUser._id }).sort({ createdAt: -1 });
  await Notification.updateMany({ userId: req.mobileUser._id }, { isRead: true });
  return res.json({ notifications });
});

router.get('/student/documents', requireMobileUser, requireRole('student'), async (req, res) => {
  const documents = await StudentDocument.find({ studentId: req.mobileUser._id }).sort({ createdAt: -1 });
  return res.json({ documents });
});

router.post('/student/documents', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const file = req.files?.document;
    if (!file) return res.status(400).json({ error: 'Select a document first.' });
    if (Array.isArray(file)) return res.status(400).json({ error: 'Upload one document at a time.' });
    const allowedDocumentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
    const allowedDocumentExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
    if (!allowedDocumentTypes.has(file.mimetype) || !allowedDocumentExtensions.has(path.extname(file.name || '').toLowerCase())) {
      return res.status(400).json({ error: 'Only PDF, JPG and PNG documents are supported.' });
    }
    const maxSize = Number(process.env.MAX_FILE_SIZE) || 20 * 1024 * 1024;
    if (file.size > maxSize) return res.status(413).json({ error: `Document must be below ${Math.floor(maxSize / 1024 / 1024)} MB.` });
    const safeName = String(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `doc_${req.mobileUser._id}_${Date.now()}_${safeName}`;
    fs.writeFileSync(path.join(documentDirectory, fileName), file.data);
    const document = await StudentDocument.create({
      studentId: req.mobileUser._id,
      fileName,
      originalName: file.name,
      fileType: file.mimetype,
      fileSize: file.size,
      filePath: `/uploads/documents/${fileName}`,
      description: req.body.description || '',
    });
    return res.status(201).json({ document });
  } catch (error) {
    console.error('Mobile document upload error:', error);
    return res.status(500).json({ error: 'Unable to upload document.' });
  }
});

const questionForMobile = (question, options) => ({
  id: question._id.toString(),
  question: question.question,
  questionImage: question.questionImage || null,
  subject: question.subject,
  topic: question.topic || null,
  subtopic: question.subtopic || null,
  marks: question.marks,
  options: options || [
    { key: 'A', value: question.optionA, image: question.optionAImage || null },
    { key: 'B', value: question.optionB, image: question.optionBImage || null },
    { key: 'C', value: question.optionC, image: question.optionCImage || null },
    { key: 'D', value: question.optionD, image: question.optionDImage || null },
  ],
});

router.get('/student/tests/:testId/instructions', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const studentId = req.mobileUser._id;
    const [test, memberships, submitted, inProgress] = await Promise.all([
      Test.findOne({ _id: req.params.testId, status: { $in: ['published', 'active'] }, isActive: { $ne: false } }).populate('questions'),
      GroupMember.find({ userId: studentId, role: 'student' }, 'groupId'),
      Result.findOne({ studentId, testId: req.params.testId, status: completedStatuses }),
      Result.findOne({ studentId, testId: req.params.testId, status: 'in_progress' }),
    ]);
    if (!test) return res.status(404).json({ error: 'Test is not available.' });
    const membershipIds = new Set(memberships.map((item) => item.groupId.toString()));
    if (!test.groups.some((groupId) => membershipIds.has(groupId.toString()))) {
      return res.status(403).json({ error: 'This test is not assigned to your batch.' });
    }
    const now = Date.now();
    const isUpcoming = test.startTime && new Date(test.startTime).getTime() > now;
    const isExpired = test.endTime && new Date(test.endTime).getTime() < now && !inProgress;
    const sectionSummary = Object.values(test.questions.reduce((summary, question) => {
      const subject = question.subject || 'General';
      summary[subject] ||= { subject, questionCount: 0, totalMarks: 0 };
      summary[subject].questionCount += 1;
      summary[subject].totalMarks += Number(question.marks) || 0;
      return summary;
    }, {}));
    return res.json({
      test,
      questionCount: test.questions.length,
      inProgress: Boolean(inProgress),
      submittedResultId: submitted?._id || null,
      canStart: !submitted && !isUpcoming && !isExpired,
      availability: submitted ? 'completed' : inProgress ? 'in_progress' : isUpcoming ? 'upcoming' : isExpired ? 'expired' : 'available',
      cetSectionFlow: isCetSectionTest(test, test.questions),
      sectionSummary,
    });
  } catch (error) {
    console.error('Mobile instructions error:', error);
    return res.status(500).json({ error: 'Unable to load test instructions.' });
  }
});

router.post('/student/tests/:testId/start', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const { testId } = req.params;
    const studentId = req.mobileUser._id;
    const [test, submitted, memberships] = await Promise.all([
      Test.findOne({ _id: testId, status: { $in: ['published', 'active'] }, isActive: { $ne: false } }).populate('questions', '_id subject'),
      Result.findOne({ studentId, testId, status: { $in: ['submitted', 'auto_submitted'] } }),
      GroupMember.find({ userId: studentId, role: 'student' }, 'groupId'),
    ]);
    if (!test) return res.status(404).json({ error: 'Test is not available.' });
    if (submitted) return res.status(409).json({ error: 'This test is already submitted.', resultId: submitted._id });

    const membershipIds = new Set(memberships.map((item) => item.groupId.toString()));
    if (!test.groups.some((groupId) => membershipIds.has(groupId.toString()))) {
      return res.status(403).json({ error: 'This test is not assigned to your batch.' });
    }

    const now = Date.now();
    if (test.startTime && new Date(test.startTime).getTime() > now) return res.status(409).json({ error: 'This test has not opened yet.' });

    let result = await Result.findOne({ studentId, testId, status: 'in_progress' });
    if (!result && test.endTime && new Date(test.endTime).getTime() < now) return res.status(409).json({ error: 'This test has expired.' });
    if (!result) {
      result = await Result.create({
        studentId,
        testId,
        score: 0,
        totalMarks: test.totalMarks,
        fullTotalMarks: test.totalMarks,
        answers: {},
        questionTimings: {},
        cheatingFlags: { tabSwitches: 0, fullscreenExits: 0, focusLosses: 0 },
        status: 'in_progress',
        startedAt: new Date(),
        questionOrder: buildQuestionOrder(test, test.questions),
        markedForReview: [],
        visitedQuestionIds: [],
      });
    }
    return res.json({ resultId: result._id, firstQuestionNumber: 1, questionCount: result.questionOrder.length });
  } catch (error) {
    console.error('Mobile test start error:', error);
    return res.status(500).json({ error: 'Unable to start test.' });
  }
});

router.get('/student/tests/:testId/questions/:questionNumber', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const studentId = req.mobileUser._id;
    const { testId } = req.params;
    const questionNumber = Number(req.params.questionNumber);
    const [result, test] = await Promise.all([
      Result.findOne({ studentId, testId, status: 'in_progress' }),
      Test.findById(testId),
    ]);
    if (!result) return res.status(409).json({ error: 'No active test session.' });
    if (!test) return res.status(404).json({ error: 'Test not found.' });
    const remainingSeconds = Math.max(0, Math.floor((test.duration * 60 * 1000 - (Date.now() - new Date(result.startedAt).getTime())) / 1000));
    if (!remainingSeconds) return res.status(408).json({ error: 'Test time is over. Submit the test now.' });
    if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > result.questionOrder.length) {
      return res.status(400).json({ error: 'Invalid question number.' });
    }

    const questionRows = await Question.find({ _id: { $in: result.questionOrder } }, '_id subject');
    const cetFlow = isCetSectionTest(test, questionRows);
    const sectionState = cetFlow
      ? buildSectionState(result.questionOrder, questionRows, result.answers || {}, result.visitedQuestionIds || [])
      : null;
    const questionId = result.questionOrder[questionNumber - 1].toString();
    const subject = sectionState?.subjectById.get(questionId);
    const section = sectionState?.sections.find((item) => item.name === subject);
    if (section?.locked) {
      return res.status(403).json({ error: 'View every Physics and Chemistry question first.', locked: true, nextQuestionNumber: sectionState.firstPendingQuestionNumber });
    }

    await Result.updateOne({ _id: result._id }, { $addToSet: { visitedQuestionIds: questionId } });
    const question = await Question.findById(questionId);
    if (!question) return res.status(404).json({ error: 'Question not found.' });
    const options = [
      { key: 'A', value: question.optionA, image: question.optionAImage || null },
      { key: 'B', value: question.optionB, image: question.optionBImage || null },
      { key: 'C', value: question.optionC, image: question.optionCImage || null },
      { key: 'D', value: question.optionD, image: question.optionDImage || null },
    ];
    if (test.shuffleOptions) options.sort(() => Math.random() - 0.5);
    const visited = new Set([...(result.visitedQuestionIds || []).map(String), questionId]);
    const answers = result.answers || {};
    const marked = new Set((result.markedForReview || []).map(String));
    return res.json({
      questionNumber,
      totalQuestions: result.questionOrder.length,
      remainingSeconds,
      question: questionForMobile(question, options),
      selectedAnswer: answers[questionId]?.answer || null,
      markedForReview: marked.has(questionId),
      sections: sectionState?.sections.map((item) => ({ name: item.name, locked: item.locked, questionNumbers: item.questionNumbers })) || [],
      palette: result.questionOrder.map((id, index) => {
        const key = id.toString();
        return { number: index + 1, answered: Boolean(answers[key]?.answer), visited: visited.has(key), marked: marked.has(key) };
      }),
    });
  } catch (error) {
    console.error('Mobile question error:', error);
    return res.status(500).json({ error: 'Unable to load question.' });
  }
});

router.post('/student/tests/:testId/answers', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const { questionId, answer, markForReview = false, timeSpent = 0 } = req.body;
    const result = await Result.findOne({ studentId: req.mobileUser._id, testId: req.params.testId, status: 'in_progress' });
    if (!result) return res.status(409).json({ error: 'No active test session.' });
    if (!result.questionOrder.map(String).includes(String(questionId))) return res.status(400).json({ error: 'Question does not belong to this test.' });
    const [test, questionRows] = await Promise.all([
      Test.findById(req.params.testId).select('course'),
      Question.find({ _id: { $in: result.questionOrder } }, '_id subject'),
    ]);
    if (!test) return res.status(404).json({ error: 'Test not found.' });
    const sectionState = isCetSectionTest(test, questionRows)
      ? buildSectionState(result.questionOrder, questionRows, result.answers || {}, result.visitedQuestionIds || [])
      : null;
    const questionSubject = sectionState?.subjectById.get(String(questionId));
    const questionSection = sectionState?.sections.find((section) => section.name === questionSubject);
    if (questionSection?.locked) return res.status(403).json({ error: 'Visit every Physics and Chemistry question first.' });
    const answers = { ...(result.answers || {}) };
    const timings = { ...(result.questionTimings || {}) };
    const marked = new Set((result.markedForReview || []).map(String));
    answers[questionId] = { answer: answer?.trim() || null, savedAt: new Date() };
    if (Number.isFinite(Number(timeSpent)) && Number(timeSpent) > 0) timings[questionId] = (timings[questionId] || 0) + Number(timeSpent);
    if (markForReview) marked.add(String(questionId)); else marked.delete(String(questionId));
    await Result.updateOne({ _id: result._id }, { answers, questionTimings: timings, markedForReview: [...marked], $addToSet: { visitedQuestionIds: String(questionId) } });
    return res.json({ saved: true, answeredCount: Object.values(answers).filter((entry) => entry.answer).length });
  } catch (error) {
    console.error('Mobile save answer error:', error);
    return res.status(500).json({ error: 'Unable to save answer.' });
  }
});

router.post('/student/tests/:testId/violations', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const { type } = req.body;
    if (!['tabSwitch', 'fullscreenExit', 'focusLoss'].includes(type)) return res.status(400).json({ error: 'Invalid violation type.' });
    const [result, test] = await Promise.all([
      Result.findOne({ studentId: req.mobileUser._id, testId: req.params.testId, status: 'in_progress' }),
      Test.findById(req.params.testId).select('autoSubmitOnViolation maxTabSwitches maxFocusLosses'),
    ]);
    if (!result || !test) return res.status(409).json({ error: 'No active test session.' });
    const flags = { tabSwitches: 0, fullscreenExits: 0, focusLosses: 0, ...(result.cheatingFlags || {}) };
    if (type === 'tabSwitch') flags.tabSwitches += 1;
    if (type === 'fullscreenExit') flags.fullscreenExits += 1;
    if (type === 'focusLoss') flags.focusLosses += 1;
    const violations = flags.tabSwitches + flags.fullscreenExits + flags.focusLosses;
    await Result.updateOne({ _id: result._id }, { cheatingFlags: flags, violationCount: violations });
    const shouldAutoSubmit = Boolean(test.autoSubmitOnViolation && (
      flags.tabSwitches >= (test.maxTabSwitches ?? 3)
      || flags.focusLosses >= (test.maxFocusLosses ?? 5)
      || flags.fullscreenExits >= 3
    ));
    return res.json({ flags, violations, autoSubmit: shouldAutoSubmit });
  } catch (error) {
    console.error('Mobile violation error:', error);
    return res.status(500).json({ error: 'Unable to record exam violation.' });
  }
});

router.post('/student/tests/:testId/leave', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const { questionId, answer, markForReview = false, timeSpent = 0 } = req.body;
    const result = await Result.findOne({ studentId: req.mobileUser._id, testId: req.params.testId, status: 'in_progress' });
    if (!result || !questionId) return res.json({ saved: false });
    const answers = { ...(result.answers || {}) };
    const timings = { ...(result.questionTimings || {}) };
    const marked = new Set((result.markedForReview || []).map(String));
    answers[questionId] = { answer: answer?.trim() || null, savedAt: new Date() };
    if (Number(timeSpent) > 0) timings[questionId] = (timings[questionId] || 0) + Number(timeSpent);
    if (markForReview) marked.add(String(questionId)); else marked.delete(String(questionId));
    await Result.updateOne({ _id: result._id }, {
      answers,
      questionTimings: timings,
      markedForReview: [...marked],
      $addToSet: { visitedQuestionIds: String(questionId) },
    });
    return res.json({ saved: true });
  } catch (error) {
    console.error('Mobile leave exam error:', error);
    return res.status(500).json({ error: 'Unable to save exam progress.' });
  }
});

router.post('/student/tests/:testId/submit', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const { testId } = req.params;
    const result = await Result.findOne({ studentId: req.mobileUser._id, testId, status: 'in_progress' });
    if (!result) return res.status(409).json({ error: 'No active test session.' });
    const test = await Test.findById(testId).populate('questions');
    if (!test) return res.status(404).json({ error: 'Test not found.' });

    const answers = result.answers || {};
    const subjectScores = {};
    const topicScores = {};
    let score = 0;
    let correctAnswers = 0;
    let wrongAnswers = 0;
    let skippedAnswers = 0;
    for (const question of test.questions) {
      const subject = question.subject || 'General';
      const topic = question.topic || 'General';
      if (!subjectScores[subject]) subjectScores[subject] = { correct: 0, wrong: 0, skipped: 0, marks: 0, total: 0, attempted: false, status: 'NOT_ATTEMPTED' };
      if (!topicScores[topic]) topicScores[topic] = { correct: 0, wrong: 0, skipped: 0 };
      subjectScores[subject].total += question.marks;
      const answer = answers[question._id.toString()]?.answer;
      if (!answer) {
        skippedAnswers += 1;
        subjectScores[subject].skipped += 1;
        topicScores[topic].skipped += 1;
      } else if (answer === question.correctAnswer) {
        correctAnswers += 1;
        score += question.marks;
        subjectScores[subject].correct += 1;
        subjectScores[subject].marks += question.marks;
        subjectScores[subject].attempted = true;
        subjectScores[subject].status = 'ATTEMPTED';
        topicScores[topic].correct += 1;
      } else {
        wrongAnswers += 1;
        const deduction = Number(test.negativeMarking) || 0;
        score -= deduction;
        subjectScores[subject].wrong += 1;
        subjectScores[subject].marks -= deduction;
        subjectScores[subject].attempted = true;
        subjectScores[subject].status = 'ATTEMPTED';
        topicScores[topic].wrong += 1;
      }
    }
    const cetFlow = isCetSectionTest(test, test.questions);
    const attemptedSubjects = [];
    const absentSubjects = [];
    let totalMarks = test.totalMarks;
    if (cetFlow) totalMarks = 0;
    Object.entries(subjectScores).forEach(([subject, values]) => {
      values.marks = Number(values.marks.toFixed(2));
      if (values.attempted) {
        attemptedSubjects.push(subject);
        if (cetFlow) totalMarks += values.total;
      } else if (cetFlow) {
        absentSubjects.push(subject);
        values.status = 'ABSENT';
      }
    });
    score = Math.max(0, Number(score.toFixed(2)));
    const timeTaken = Math.floor((Date.now() - new Date(result.startedAt).getTime()) / 1000);
    await Result.updateOne({ _id: result._id }, {
      score,
      totalMarks,
      fullTotalMarks: test.totalMarks,
      correctAnswers,
      wrongAnswers,
      skippedAnswers,
      subjectScores,
      topicScores,
      attemptedSubjects,
      absentSubjects,
      timeTaken,
      status: req.body?.auto ? 'auto_submitted' : 'submitted',
      submittedAt: new Date(),
    });
    const rankings = await Result.find({ testId, status: { $in: ['submitted', 'auto_submitted'] } }).sort({ score: -1, timeTaken: 1 });
    await Promise.all(rankings.map((item, index) => Result.updateOne({ _id: item._id }, { rank: index + 1, percentile: Number((((rankings.length - index) / rankings.length) * 100).toFixed(2)) })));
    const submitted = await Result.findById(result._id);
    return res.json({ result: submitted });
  } catch (error) {
    console.error('Mobile submit error:', error);
    return res.status(500).json({ error: 'Unable to submit test.' });
  }
});

router.get('/admin/dashboard', requireMobileUser, requireRole('admin'), async (req, res) => {
  const [students, tests, groups, questions, submittedResults, recentResults, recentUsers] = await Promise.all([
    User.countDocuments({ role: 'student', isActive: true }),
    Test.countDocuments(),
    Group.countDocuments({ isActive: { $ne: false } }),
    Question.countDocuments({ isActive: true }),
    Result.countDocuments({ status: { $in: ['submitted', 'auto_submitted'] } }),
    Result.find({ status: completedStatuses }).sort({ submittedAt: -1 }).limit(8).populate('studentId', 'name rollNo').populate('testId', 'title'),
    User.find({ role: 'student' }).sort({ createdAt: -1 }).limit(5).select('-password'),
  ]);
  return res.json({ stats: { students, tests, groups, questions, submittedResults }, recentResults, recentUsers });
});

router.get('/admin/students', requireMobileUser, requireRole('admin'), async (req, res) => {
  const query = { role: 'student' };
  if (req.query.search) {
    const escaped = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [{ name: new RegExp(escaped, 'i') }, { rollNo: new RegExp(escaped, 'i') }];
  }
  const [students, groups] = await Promise.all([
    User.find(query).sort({ rollNo: 1 }).select('-password'),
    Group.find({ isActive: { $ne: false } }).sort({ name: 1 }),
  ]);
  return res.json({ students, groups });
});

router.get('/admin/students/template', requireMobileUser, requireRole('admin'), (req, res) => {
  controllerSession(req);
  return adminController.downloadStudentTemplate(req, res);
});

router.get('/admin/students/:studentId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const student = await User.findOne({ _id: req.params.studentId, role: 'student' }).select('-password');
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const [memberships, results, documents] = await Promise.all([
    GroupMember.find({ userId: student._id, role: 'student' }).populate('groupId', 'name course academicYear'),
    Result.find({ studentId: student._id, status: completedStatuses }).populate('testId', 'title subject course').sort({ submittedAt: -1 }),
    StudentDocument.find({ studentId: student._id }).sort({ createdAt: -1 }),
  ]);
  const averageScore = results.length
    ? Number((results.reduce((total, result) => total + (result.totalMarks ? (result.score / result.totalMarks) * 100 : 0), 0) / results.length).toFixed(1))
    : 0;
  return res.json({ student, groups: memberships.map((item) => item.groupId).filter(Boolean), results, documents, stats: { tests: results.length, averageScore } });
});

router.post('/admin/students', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const { name, rollNo, parentContact, phone, email, groupId } = req.body;
    if (!name?.trim() || !rollNo?.trim()) return res.status(400).json({ error: 'Name and roll number are required.' });
    if (await User.exists({ rollNo: rollNo.trim() })) return res.status(409).json({ error: 'Roll number already exists.' });
    const initialPassword = `CET@${rollNo.trim().slice(-4).padStart(4, '0')}`;
    const student = await User.create({ name: name.trim(), rollNo: rollNo.trim(), parentContact: parentContact?.trim() || null, phone: phone?.trim() || null, email: email?.trim().toLowerCase() || null, role: 'student', password: initialPassword, isFirstLogin: true });
    if (groupId) await GroupMember.findOneAndUpdate({ groupId, userId: student._id }, { role: 'student' }, { upsert: true });
    await Notification.create({ userId: student._id, title: 'Account Created', message: `Welcome ${student.name}!`, type: 'info' });
    return res.status(201).json({ student: serializeUser(student), initialPassword });
  } catch (error) {
    console.error('Mobile create student error:', error);
    return res.status(500).json({ error: 'Unable to create student.' });
  }
});

router.post('/admin/students/bulk-import', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const file = req.files?.csvFile;
    const { groupId } = req.body;
    if (!file) return res.status(400).json({ error: 'Select an Excel or CSV file first.' });
    const workbook = xlsx.read(file.data, { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    let created = 0;
    let existing = 0;
    let assigned = 0;
    let skipped = 0;
    const duplicates = [];
    for (const row of rows) {
      const rollNo = String(row['Roll No'] || row.rollNo || '').trim();
      const name = String(row.Name || row.name || '').trim();
      if (!rollNo || !name) { skipped += 1; continue; }
      let student = await User.findOne({ rollNo });
      if (student) {
        duplicates.push(rollNo);
        existing += 1;
      } else {
        student = await User.create({ name, rollNo, email: String(row.Email || row.email || '').trim().toLowerCase() || null, phone: String(row.Phone || row.phone || '').trim() || null, parentContact: String(row['Parent Contact No'] || row.parentContact || '').trim() || null, role: 'student', password: `CET@${rollNo.slice(-4).padStart(4, '0')}`, isFirstLogin: true });
        created += 1;
      }
      if (groupId) {
        await GroupMember.findOneAndUpdate({ groupId, userId: student._id }, { role: 'student' }, { upsert: true });
        assigned += 1;
      }
    }
    return res.json({ created, existing, assigned, skipped, duplicates, groupAssigned: Boolean(groupId) });
  } catch (error) {
    console.error('Mobile bulk student import error:', error);
    return res.status(500).json({ error: 'Unable to import students.' });
  }
});

router.delete('/admin/students/:studentId', requireMobileUser, requireRole('admin'), async (req, res) => {
  await GroupMember.deleteMany({ userId: req.params.studentId });
  const student = await User.findOneAndUpdate({ _id: req.params.studentId, role: 'student' }, { isActive: false }, { new: true });
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  return res.sendStatus(204);
});

router.get('/admin/groups', requireMobileUser, requireRole('admin'), async (req, res) => {
  const [groups, members] = await Promise.all([
    Group.find({ isActive: { $ne: false } }).sort({ createdAt: -1 }),
    GroupMember.find({ role: 'student' }).populate('userId', 'name rollNo').lean(),
  ]);
  const memberMap = new Map();
  members.forEach((member) => {
    const key = member.groupId.toString();
    memberMap.set(key, [...(memberMap.get(key) || []), member.userId]);
  });
  return res.json({ groups: groups.map((group) => ({ ...group.toObject(), members: memberMap.get(group._id.toString()) || [] })) });
});

router.post('/admin/groups', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, academicYear, course } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Batch name is required.' });
    const group = await Group.create({ name: name.trim(), description: description?.trim() || null, academicYear: academicYear?.trim() || process.env.ACADEMIC_YEAR, course: course || null });
    return res.status(201).json({ group });
  } catch (error) {
    return res.status(409).json({ error: 'Unable to create batch. Its name may already exist.' });
  }
});

router.post('/admin/groups/:groupId/members', requireMobileUser, requireRole('admin'), async (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ error: 'Student is required.' });
  await GroupMember.findOneAndUpdate({ groupId: req.params.groupId, userId: studentId }, { role: 'student' }, { upsert: true });
  return res.status(201).json({ assigned: true });
});

router.get('/admin/groups/:groupId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const group = await Group.findOne({ _id: req.params.groupId, isActive: { $ne: false } });
  if (!group) return res.status(404).json({ error: 'Batch not found.' });
  const [memberships, students, otherGroups] = await Promise.all([
    GroupMember.find({ groupId: group._id, role: 'student' }).populate('userId', '-password').sort({ createdAt: 1 }),
    User.find({ role: 'student', isActive: true }).sort({ rollNo: 1 }).select('-password'),
    Group.find({ _id: { $ne: group._id }, isActive: { $ne: false } }).sort({ name: 1 }),
  ]);
  const memberIds = new Set(memberships.map((item) => item.userId?._id.toString()).filter(Boolean));
  return res.json({
    group,
    members: memberships.map((item) => item.userId).filter(Boolean),
    availableStudents: students.filter((student) => !memberIds.has(student._id.toString())),
    otherGroups,
  });
});

router.patch('/admin/groups/:groupId', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => ['name', 'description', 'academicYear', 'course'].includes(key)));
    if (update.name !== undefined && !String(update.name).trim()) return res.status(400).json({ error: 'Batch name is required.' });
    if (update.name) update.name = String(update.name).trim();
    if (update.description !== undefined) update.description = String(update.description).trim() || null;
    if (update.course !== undefined && ![...COURSES, null, ''].includes(update.course)) return res.status(400).json({ error: 'Invalid course.' });
    if (update.course === '') update.course = null;
    const group = await Group.findOneAndUpdate({ _id: req.params.groupId, isActive: { $ne: false } }, update, { new: true, runValidators: true });
    if (!group) return res.status(404).json({ error: 'Batch not found.' });
    return res.json({ group });
  } catch (error) {
    return res.status(409).json({ error: 'Unable to update batch. Its name may already exist.' });
  }
});

router.delete('/admin/groups/:groupId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const group = await Group.findOneAndUpdate({ _id: req.params.groupId, isActive: { $ne: false } }, { isActive: false }, { new: true });
  if (!group) return res.status(404).json({ error: 'Batch not found.' });
  await Promise.all([
    GroupMember.deleteMany({ groupId: group._id }),
    Test.updateMany({ groups: group._id }, { $pull: { groups: group._id } }),
  ]);
  return res.sendStatus(204);
});

router.delete('/admin/groups/:groupId/members/:studentId', requireMobileUser, requireRole('admin'), async (req, res) => {
  await GroupMember.deleteOne({ groupId: req.params.groupId, userId: req.params.studentId, role: 'student' });
  return res.sendStatus(204);
});

router.post('/admin/groups/:groupId/members/:studentId/move', requireMobileUser, requireRole('admin'), async (req, res) => {
  const { targetGroupId } = req.body;
  if (!targetGroupId) return res.status(400).json({ error: 'Target batch is required.' });
  const target = await Group.findOne({ _id: targetGroupId, isActive: { $ne: false } });
  if (!target) return res.status(404).json({ error: 'Target batch not found.' });
  await GroupMember.deleteOne({ groupId: req.params.groupId, userId: req.params.studentId });
  await GroupMember.findOneAndUpdate({ groupId: target._id, userId: req.params.studentId }, { role: 'student' }, { upsert: true });
  return res.json({ moved: true, targetGroup: target });
});

router.get('/admin/groups/:groupId/credentials', requireMobileUser, requireRole('admin'), (req, res) => {
  req.params.id = req.params.groupId;
  controllerSession(req);
  return adminController.exportGroupCredentials(req, res);
});

router.get('/admin/topics', requireMobileUser, requireRole('admin'), async (req, res) => {
  const query = { isActive: true };
  if (req.query.course) query.course = req.query.course;
  if (req.query.subject) query.subject = req.query.subject;
  const topics = await Topic.find(query).sort({ course: 1, subject: 1, name: 1 });
  return res.json({ topics });
});

router.get('/admin/subjects/:course', requireMobileUser, requireRole('admin'), (req, res) => {
  return res.json({ subjects: SUBJECTS_BY_COURSE[req.params.course] || ALL_SUBJECTS });
});

router.post('/admin/topics', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const { course, subject, name, subtopics = [] } = req.body;
    if (!course || !subject || !name?.trim()) return res.status(400).json({ error: 'Course, subject and unit name are required.' });
    const normalizedSubtopics = (Array.isArray(subtopics) ? subtopics : String(subtopics).split(/\r?\n/)).map((item) => String(item).trim()).filter(Boolean);
    const topic = await Topic.findOneAndUpdate(
      { course, subject, name: name.trim() },
      { $set: { isActive: true }, $addToSet: { subtopics: { $each: normalizedSubtopics } } },
      { new: true, upsert: true },
    );
    return res.status(201).json({ topic });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to save syllabus unit.' });
  }
});

router.post('/admin/topics/import-pdf', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const course = String(req.body.course || '').trim().toUpperCase();
    const subject = String(req.body.subject || '').trim();
    const file = req.files?.syllabusPdf;
    if (!COURSES.includes(course)) return res.status(400).json({ error: 'Select a valid course.' });
    if (subject && !(SUBJECTS_BY_COURSE[course] || []).includes(subject)) return res.status(400).json({ error: 'Select a valid subject.' });
    if (!file || Array.isArray(file)) return res.status(400).json({ error: 'Choose one syllabus PDF.' });
    if (path.extname(file.name || '').toLowerCase() !== '.pdf') return res.status(400).json({ error: 'Only PDF files are supported.' });
    const maxSize = Number(process.env.MAX_FILE_SIZE) || 20 * 1024 * 1024;
    if (file.size > maxSize) return res.status(413).json({ error: `PDF must be below ${Math.floor(maxSize / 1024 / 1024)} MB.` });
    const extraction = await extractSyllabusFromPdf(file, { course, subject, adminId: req.mobileUser._id.toString() });
    if (!extraction.units.length) return res.status(422).json({ error: 'No valid syllabus units were detected.' });
    let created = 0;
    let updated = 0;
    for (const unit of extraction.units) {
      const name = String(unit.unitName || '').replace(/\s+/g, ' ').trim();
      const unitSubject = String(unit.subject || subject || '').trim();
      if (!name || !(SUBJECTS_BY_COURSE[course] || []).includes(unitSubject)) continue;
      const rows = await Topic.find({ course, subject: unitSubject });
      const existing = rows.find((row) => row.name.toLowerCase() === name.toLowerCase());
      const subtopics = [...new Set((unit.subtopics || []).map((item) => String(item).replace(/\s+/g, ' ').trim()).filter(Boolean))];
      if (existing) {
        existing.name = name;
        existing.subtopics = [...new Set([...(existing.subtopics || []), ...subtopics])];
        existing.isActive = true;
        await existing.save();
        updated += 1;
      } else {
        await Topic.create({ course, subject: unitSubject, name, subtopics, isActive: true });
        created += 1;
      }
    }
    return res.json({ created, updated, warnings: extraction.warnings || [], model: extraction.model });
  } catch (error) {
    console.error('Mobile syllabus import error:', error);
    return res.status(500).json({ error: error.message || 'Unable to import syllabus.' });
  }
});

router.patch('/admin/topics/:topicId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const { name, subtopics } = req.body;
  const update = {};
  if (name?.trim()) update.name = name.trim();
  if (subtopics) update.subtopics = (Array.isArray(subtopics) ? subtopics : String(subtopics).split(/\r?\n/)).map((item) => String(item).trim()).filter(Boolean);
  const topic = await Topic.findByIdAndUpdate(req.params.topicId, update, { new: true });
  if (!topic) return res.status(404).json({ error: 'Syllabus unit not found.' });
  return res.json({ topic });
});

router.delete('/admin/topics/:topicId', requireMobileUser, requireRole('admin'), async (req, res) => {
  await Topic.findByIdAndUpdate(req.params.topicId, { isActive: false });
  return res.sendStatus(204);
});

router.get('/admin/questions/template', requireMobileUser, requireRole('admin'), (req, res) => {
  controllerSession(req);
  return adminController.downloadQuestionTemplate(req, res);
});

router.get('/admin/questions', requireMobileUser, requireRole('admin'), async (req, res) => {
  const query = { isActive: true };
  ['subject', 'topic', 'subtopic', 'difficulty'].forEach((key) => { if (req.query[key]) query[key] = req.query[key]; });
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const [questions, total] = await Promise.all([
    Question.find(query).sort({ subject: 1, topic: 1, subtopic: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Question.countDocuments(query),
  ]);
  return res.json({ questions, total, page, totalPages: Math.ceil(total / limit) });
});

router.get('/admin/questions/:questionId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const question = await Question.findOne({ _id: req.params.questionId, isActive: true });
  if (!question) return res.status(404).json({ error: 'Question not found.' });
  return res.json({ question });
});

router.post('/admin/questions', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const { question, optionA, optionB, optionC, optionD, correctAnswer, subject, topic, subtopic, difficulty = 'Medium', marks = 1, explanation } = req.body;
    if (![question, optionA, optionB, optionC, optionD, correctAnswer, subject].every((value) => String(value || '').trim())) return res.status(400).json({ error: 'Question, options, answer and subject are required.' });
    const created = await Question.create({ question, optionA, optionB, optionC, optionD, correctAnswer, subject, topic: topic || null, subtopic: subtopic || null, difficulty, marks: Number(marks) || 1, explanation: explanation || null, createdBy: req.mobileUser._id });
    return res.status(201).json({ question: created });
  } catch (error) {
    console.error('Mobile create question error:', error);
    return res.status(500).json({ error: 'Unable to create question.' });
  }
});

router.patch('/admin/questions/:questionId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const allowed = ['question', 'optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer', 'subject', 'topic', 'subtopic', 'difficulty', 'marks', 'explanation'];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (update.marks !== undefined) update.marks = Number(update.marks) || 1;
  if (update.correctAnswer && !['A', 'B', 'C', 'D'].includes(update.correctAnswer)) return res.status(400).json({ error: 'Correct answer must be A, B, C or D.' });
  const question = await Question.findOneAndUpdate({ _id: req.params.questionId, isActive: true }, update, { new: true });
  if (!question) return res.status(404).json({ error: 'Question not found.' });
  return res.json({ question });
});

router.post('/admin/questions/bulk-import', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const file = req.files?.csvFile;
    if (!file) return res.status(400).json({ error: 'Select an Excel or CSV file first.' });
    const workbook = xlsx.read(file.data, { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    let created = 0;
    let skipped = 0;
    for (const row of rows) {
      try {
        const question = row.question || row.Question;
        const optionA = row.optionA || row['Option A'];
        const optionB = row.optionB || row['Option B'];
        const optionC = row.optionC || row['Option C'];
        const optionD = row.optionD || row['Option D'];
        if (![question, optionA, optionB, optionC, optionD].every(Boolean)) { skipped += 1; continue; }
        await Question.create({ question, optionA, optionB, optionC, optionD, correctAnswer: String(row.correctAnswer || row['Correct Answer'] || 'A').toUpperCase(), subject: row.subject || row.Subject || 'Physics', topic: row.topic || row.Topic || null, subtopic: row.subtopic || row.Subtopic || null, difficulty: row.difficulty || row.Difficulty || 'Medium', marks: Number(row.marks || row.Marks || 1), explanation: row.explanation || row.Explanation || null, createdBy: req.mobileUser._id });
        created += 1;
      } catch { skipped += 1; }
    }
    return res.json({ created, skipped });
  } catch (error) {
    console.error('Mobile bulk question import error:', error);
    return res.status(500).json({ error: 'Unable to import questions.' });
  }
});

router.post('/admin/smart-scanner/scan', requireMobileUser, requireRole('admin'), async (req, res) => {
  let draft;
  try {
    const sourceFiles = req.files?.questionFiles;
    const files = Array.isArray(sourceFiles) ? sourceFiles : sourceFiles ? [sourceFiles] : [];
    if (!files.length) return res.status(400).json({ error: 'Select at least one image, PDF, document, or spreadsheet.' });
    if (files.length > 10) return res.status(400).json({ error: 'You can scan a maximum of 10 files at once.' });
    if (files.some((file) => !SUPPORTED_EXTENSIONS.has(extensionOf(file)))) return res.status(400).json({ error: 'One or more selected files are unsupported.' });
    const defaults = { subject: String(req.body.subject || 'Physics').trim(), topic: String(req.body.topic || '').trim(), subtopic: String(req.body.subtopic || '').trim(), difficulty: ['Easy', 'Medium', 'Hard'].includes(req.body.difficulty) ? req.body.difficulty : 'Medium', marks: Math.max(0.25, Number(req.body.marks) || 1) };
    draft = await QuestionImport.create({ createdBy: req.mobileUser._id, sourceFiles: files.map((file) => ({ name: file.name, mimeType: file.mimetype, size: file.size })), defaults, status: 'scanning' });
    const extracted = await extractQuestionFiles(files, defaults, req.mobileUser._id.toString());
    if (!extracted.questions.length) throw new Error('No MCQ questions were detected. Ensure A/B/C/D options are visible.');
    const visuals = await preserveQuestionVisuals(files, extracted.questions, draft._id);
    draft.questions = visuals.questions.map((question) => ({ ...question, isSelected: true }));
    draft.warnings = [...new Set([...(extracted.warnings || []), ...(visuals.warnings || [])])];
    draft.extractionMethod = extracted.method;
    draft.extractionModel = extracted.model;
    draft.status = 'review';
    await draft.save();
    return res.status(201).json({ draft });
  } catch (error) {
    if (draft) { draft.status = 'failed'; draft.error = error.message; await draft.save().catch(() => {}); }
    console.error('Mobile smart scan error:', error);
    return res.status(500).json({ error: error.message || 'Unable to scan files.' });
  }
});

router.get('/admin/smart-scanner/:draftId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const draft = await QuestionImport.findOne({ _id: req.params.draftId, createdBy: req.mobileUser._id });
  if (!draft) return res.status(404).json({ error: 'Scan draft not found.' });
  return res.json({ draft });
});

router.post('/admin/smart-scanner/:draftId/commit', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const draft = await QuestionImport.findOne({ _id: req.params.draftId, createdBy: req.mobileUser._id, status: 'review' });
    if (!draft) return res.status(404).json({ error: 'Scan draft is not available for review.' });
    const edited = Array.isArray(req.body.questions) ? req.body.questions : draft.questions;
    const selected = edited.filter((question) => question.isSelected !== false).map((question) => normalizeQuestion(question, draft.defaults));
    if (!selected.length) return res.status(400).json({ error: 'Select at least one scanned question.' });
    const invalid = selected.find((question) => !question.question || !question.optionA || !question.optionB || !question.optionC || !question.optionD || !['A', 'B', 'C', 'D'].includes(question.correctAnswer));
    if (invalid) return res.status(400).json({ error: 'Complete the question text, all options, and correct answer before saving.' });
    const questions = await Question.insertMany(selected.map((question) => ({ ...question, createdBy: req.mobileUser._id, isActive: true })));
    draft.questions = edited;
    draft.status = 'imported';
    draft.importedQuestionIds = questions.map((question) => question._id);
    await draft.save();
    return res.json({ imported: questions.length, questionIds: questions.map((question) => question._id) });
  } catch (error) {
    console.error('Mobile smart scan commit error:', error);
    return res.status(500).json({ error: 'Unable to save scanned questions.' });
  }
});

router.delete('/admin/smart-scanner/:draftId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const draft = await QuestionImport.findOneAndDelete({ _id: req.params.draftId, createdBy: req.mobileUser._id, status: { $in: ['review', 'failed'] } });
  if (draft) removeQuestionImportAssets(draft._id);
  return res.sendStatus(204);
});

router.get('/admin/tests', requireMobileUser, requireRole('admin'), async (req, res) => {
  const query = { isActive: { $ne: false } };
  if (req.query.course) query.course = req.query.course;
  if (req.query.subject) query.subject = req.query.subject;
  const tests = await Test.find(query).populate('groups', 'name').sort({ createdAt: -1 });
  return res.json({ tests });
});

router.get('/admin/tests/template/pdf', requireMobileUser, requireRole('admin'), (req, res) => {
  controllerSession(req);
  return adminController.downloadPdfTestTemplate(req, res);
});

router.get('/admin/tests/template/answer-key', requireMobileUser, requireRole('admin'), (req, res) => {
  controllerSession(req);
  return adminController.downloadAnswerKeyTemplate(req, res);
});

router.get('/admin/tests/:testId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const test = await Test.findOne({ _id: req.params.testId, isActive: { $ne: false } })
    .populate('questions')
    .populate('groups', 'name course academicYear');
  if (!test) return res.status(404).json({ error: 'Test not found.' });
  const resultCount = await Result.countDocuments({ testId: test._id, status: completedStatuses });
  return res.json({ test, resultCount });
});

router.post('/admin/tests/upload-pdf', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const questionPdf = req.files?.questionPdf;
    if (!questionPdf || Array.isArray(questionPdf)) return res.status(400).json({ error: 'Question PDF is required.' });
    if (path.extname(questionPdf.name || '').toLowerCase() !== '.pdf') return res.status(400).json({ error: 'Question paper must be a PDF.' });
    const { title, description, duration = 180, negativeMarking = 0.25, startTime, endTime, instructions, marksPerQuestion = 1 } = req.body;
    if (!String(title || '').trim()) return res.status(400).json({ error: 'Test title is required.' });
    const maxSize = Number(process.env.MAX_FILE_SIZE) || 20 * 1024 * 1024;
    if (questionPdf.size > maxSize) return res.status(413).json({ error: 'Question PDF is too large.' });
    const qName = `q_${Date.now()}_${fileNameSafe(questionPdf.name)}`;
    fs.writeFileSync(path.join(pdfDirectory, qName), questionPdf.data);
    let solutionPdfPath = null;
    const solutionPdf = req.files?.solutionPdf;
    if (solutionPdf && !Array.isArray(solutionPdf)) {
      const sName = `s_${Date.now()}_${fileNameSafe(solutionPdf.name)}`;
      fs.writeFileSync(path.join(pdfDirectory, sName), solutionPdf.data);
      solutionPdfPath = `/uploads/pdfs/${sName}`;
    }
    const source = questionPdf.data.toString('latin1');
    const pageMatches = source.match(/\/Type\s*\/Page[^s]/g);
    const countMatch = source.match(/\/Count\s+(\d+)/);
    const pageCount = pageMatches?.length || Number(countMatch?.[1]) || 0;
    const perQuestion = Math.max(0.25, Number(marksPerQuestion) || 1);
    const parsedStart = startTime ? new Date(startTime) : null;
    const parsedEnd = endTime ? new Date(endTime) : null;
    if (parsedStart && parsedEnd && parsedEnd <= parsedStart) return res.status(400).json({ error: 'Test end time must be after start time.' });
    const test = await Test.create({
      title: String(title).trim(), description: String(description || '').trim() || null,
      duration: Math.max(5, Number(duration) || 180), negativeMarking: Math.max(0, Number(negativeMarking) || 0),
      startTime: parsedStart, endTime: parsedEnd, instructions: String(instructions || '').trim() || null,
      totalMarks: Math.max(1, pageCount) * perQuestion, marksPerQuestion: perQuestion,
      createdBy: req.mobileUser._id, status: 'draft', course: cleanList(req.body.course || req.body.courses),
      subject: cleanList(req.body.subject || req.body.subjects), groups: cleanList(req.body.groupIds),
      questionPdfPath: `/uploads/pdfs/${qName}`, solutionPdfPath,
      autoSubmitOnViolation: Boolean(req.body.autoSubmitOnViolation), maxTabSwitches: Number(req.body.maxTabSwitches) || 3,
      maxFocusLosses: Number(req.body.maxFocusLosses) || 5, blockCopyPaste: req.body.blockCopyPaste !== false,
      requireFullscreen: Boolean(req.body.requireFullscreen),
    });
    return res.status(201).json({ test, pageCount });
  } catch (error) {
    console.error('Mobile PDF test upload error:', error);
    return res.status(500).json({ error: 'Unable to create PDF test.' });
  }
});

router.post('/admin/tests', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const { title, questionIds, groupIds = [], course = [], subject = [], description, duration = 180, negativeMarking = 0.25, passingMarks, shuffleQuestions = true, shuffleOptions = false, startTime, endTime, instructions, topic, subtopic, autoSubmitOnViolation = false, maxTabSwitches = 3, maxFocusLosses = 5, blockCopyPaste = true, requireFullscreen = false } = req.body;
    const selectedQuestionIds = Array.isArray(questionIds) ? questionIds : questionIds ? [questionIds] : [];
    if (!title?.trim() || !selectedQuestionIds.length) return res.status(400).json({ error: 'Test title and at least one question are required.' });
    const questions = await Question.find({ _id: { $in: selectedQuestionIds }, isActive: true });
    if (questions.length !== selectedQuestionIds.length) return res.status(400).json({ error: 'One or more selected questions are unavailable.' });
    if (startTime && endTime && new Date(endTime) <= new Date(startTime)) return res.status(400).json({ error: 'Test end time must be after start time.' });
    const groups = Array.isArray(groupIds) ? groupIds : [groupIds];
    const test = await Test.create({
      title: title.trim(), description: description?.trim() || null, duration: Math.max(5, Number(duration) || 180),
      totalMarks: questions.reduce((total, question) => total + question.marks, 0), negativeMarking: Math.max(0, Number(negativeMarking) || 0), passingMarks: passingMarks ? Number(passingMarks) : null,
      shuffleQuestions: Boolean(shuffleQuestions), shuffleOptions: Boolean(shuffleOptions), startTime: startTime ? new Date(startTime) : null, endTime: endTime ? new Date(endTime) : null,
      instructions: instructions?.trim() || null, createdBy: req.mobileUser._id, status: 'draft', course: Array.isArray(course) ? course : [course], subject: Array.isArray(subject) ? subject : [subject], topic: topic || null, subtopic: subtopic || null,
      questions: selectedQuestionIds, groups, autoSubmitOnViolation: Boolean(autoSubmitOnViolation), maxTabSwitches: Number(maxTabSwitches) || 3, maxFocusLosses: Number(maxFocusLosses) || 5, blockCopyPaste: Boolean(blockCopyPaste), requireFullscreen: Boolean(requireFullscreen),
    });
    return res.status(201).json({ test });
  } catch (error) {
    console.error('Mobile test create error:', error);
    return res.status(500).json({ error: 'Unable to create test.' });
  }
});

router.patch('/admin/tests/:testId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const allowed = ['title', 'description', 'duration', 'negativeMarking', 'passingMarks', 'shuffleQuestions', 'shuffleOptions', 'startTime', 'endTime', 'instructions', 'course', 'subject', 'topic', 'subtopic', 'groups', 'groupIds', 'questions', 'questionIds', 'autoSubmitOnViolation', 'maxTabSwitches', 'maxFocusLosses', 'blockCopyPaste', 'requireFullscreen'];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (update.groupIds !== undefined) { update.groups = cleanList(update.groupIds); delete update.groupIds; }
  if (update.questionIds !== undefined) { update.questions = cleanList(update.questionIds); delete update.questionIds; }
  if (update.questions !== undefined) {
    update.questions = cleanList(update.questions);
    const questions = await Question.find({ _id: { $in: update.questions }, isActive: true });
    if (questions.length !== update.questions.length) return res.status(400).json({ error: 'One or more selected questions are unavailable.' });
    update.totalMarks = questions.reduce((total, question) => total + Number(question.marks || 0), 0);
  }
  if (update.startTime) update.startTime = new Date(update.startTime);
  if (update.endTime) update.endTime = new Date(update.endTime);
  if (update.startTime && update.endTime && update.endTime <= update.startTime) return res.status(400).json({ error: 'Test end time must be after start time.' });
  const test = await Test.findByIdAndUpdate(req.params.testId, update, { new: true });
  if (!test) return res.status(404).json({ error: 'Test not found.' });
  return res.json({ test });
});

router.post('/admin/tests/:testId/publish', requireMobileUser, requireRole('admin'), async (req, res) => {
  const test = await Test.findOne({ _id: req.params.testId, isActive: { $ne: false } });
  if (!test) return res.status(404).json({ error: 'Test not found.' });
  test.status = 'published';
  await test.save();
  const memberships = await GroupMember.find({ groupId: { $in: test.groups }, role: 'student' }, 'userId');
  if (memberships.length) await Notification.insertMany(memberships.map((member) => ({ userId: member.userId, title: 'New Exam Published', message: `"${test.title}" is now available. Duration: ${test.duration} mins.`, type: 'exam', link: '/student/tests' })));
  return res.json({ test, notifiedStudents: memberships.length });
});

router.delete('/admin/tests/:testId', requireMobileUser, requireRole('admin'), async (req, res) => {
  await Test.findByIdAndUpdate(req.params.testId, { isActive: false, status: 'closed' });
  return res.sendStatus(204);
});

router.get('/admin/results', requireMobileUser, requireRole('admin'), async (req, res) => {
  const query = { status: { $in: ['submitted', 'auto_submitted'] } };
  if (req.query.testId) query.testId = req.query.testId;
  if (req.query.groupId) {
    const members = await GroupMember.find({ groupId: req.query.groupId, role: 'student' }, 'userId');
    query.studentId = { $in: members.map((member) => member.userId) };
  }
  const results = await Result.find(query).sort({ submittedAt: -1 }).populate('studentId', 'name rollNo').populate('testId', 'title course subject');
  const [groups, tests] = await Promise.all([
    Group.find({ isActive: { $ne: false } }).sort({ name: 1 }),
    Test.find({ isActive: { $ne: false } }).sort({ createdAt: -1 }).select('title groups course subject').populate('groups', 'name'),
  ]);
  return res.json({ results, groups, tests });
});

router.get('/admin/results/export', requireMobileUser, requireRole('admin'), (req, res) => {
  controllerSession(req);
  return adminController.exportResultsExcel(req, res);
});

router.get('/admin/results/:resultId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const result = await Result.findById(req.params.resultId)
    .populate('studentId', 'name rollNo email')
    .populate({ path: 'testId', populate: { path: 'questions' } });
  if (!result) return res.status(404).json({ error: 'Result not found.' });
  const percentage = result.totalMarks > 0 ? Number(((result.score / result.totalMarks) * 100).toFixed(1)) : 0;
  return res.json({ result, percentage });
});

router.get('/admin/documents', requireMobileUser, requireRole('admin'), async (req, res) => {
  const documents = await StudentDocument.find().sort({ createdAt: -1 }).populate('studentId', 'name rollNo');
  return res.json({ documents });
});

router.delete('/admin/documents/:documentId', requireMobileUser, requireRole('admin'), async (req, res) => {
  const document = await StudentDocument.findByIdAndDelete(req.params.documentId);
  if (!document) return res.status(404).json({ error: 'Document not found.' });
  const fullPath = path.join(__dirname, '../public', document.filePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  return res.sendStatus(204);
});

router.delete('/admin/questions/:questionId', requireMobileUser, requireRole('admin'), async (req, res) => {
  await Question.findByIdAndUpdate(req.params.questionId, { isActive: false });
  return res.sendStatus(204);
});

module.exports = router;
