const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const xlsx = require('xlsx');

const { Group, GroupMember, Notification, Question, QuestionImport, Result, StudentDocument, Test, Topic, User } = require('../models');
const { buildQuestionOrder, buildSectionState, isCetSectionTest } = require('../utils/cetExam');
const { SUPPORTED_EXTENSIONS, extensionOf, extractQuestionFiles, normalizeQuestion, preserveQuestionVisuals, removeQuestionImportAssets } = require('../utils/questionImporter');

const router = express.Router();
const tokenSecret = process.env.MOBILE_API_SECRET || process.env.SESSION_SECRET || 'svpn_mobile_dev_secret';
const documentDirectory = path.join(__dirname, '../public/uploads/documents');
if (!fs.existsSync(documentDirectory)) fs.mkdirSync(documentDirectory, { recursive: true });

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

router.get('/student/dashboard', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const studentId = req.mobileUser._id;
    const [memberships, results, notifications] = await Promise.all([
      GroupMember.find({ userId: studentId, role: 'student' }, 'groupId'),
      Result.find({ studentId, status: { $in: ['submitted', 'auto_submitted'] } })
        .populate('testId', 'title totalMarks subject duration')
        .sort({ submittedAt: -1 }),
      Notification.find({ userId: studentId, isRead: false }).sort({ createdAt: -1 }).limit(8),
    ]);
    const groupIds = memberships.map((membership) => membership.groupId);
    const tests = groupIds.length
      ? await Test.find({ groups: { $in: groupIds }, status: { $in: ['published', 'active'] }, isActive: { $ne: false } }, 'title duration totalMarks subject startTime endTime').sort({ startTime: 1 })
      : [];
    const completedIds = new Set(results.map((result) => result.testId?._id?.toString()));
    const pendingTests = tests.filter((test) => !completedIds.has(test._id.toString()));
    const averageScore = results.length
      ? Number((results.reduce((total, result) => total + (result.totalMarks ? (result.score / result.totalMarks) * 100 : 0), 0) / results.length).toFixed(1))
      : 0;

    return res.json({
      stats: { pending: pendingTests.length, completed: results.length, averageScore },
      pendingTests: pendingTests.slice(0, 8),
      recentResults: results.slice(0, 5),
      notifications,
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

router.post('/student/tests/:testId/start', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const { testId } = req.params;
    const studentId = req.mobileUser._id;
    const [test, submitted] = await Promise.all([
      Test.findOne({ _id: testId, status: { $in: ['published', 'active'] }, isActive: { $ne: false } }).populate('questions', '_id subject'),
      Result.findOne({ studentId, testId, status: { $in: ['submitted', 'auto_submitted'] } }),
    ]);
    if (!test) return res.status(404).json({ error: 'Test is not available.' });
    if (submitted) return res.status(409).json({ error: 'This test is already submitted.', resultId: submitted._id });

    let result = await Result.findOne({ studentId, testId, status: 'in_progress' });
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

router.post('/student/tests/:testId/submit', requireMobileUser, requireRole('student'), async (req, res) => {
  try {
    const { testId } = req.params;
    const result = await Result.findOne({ studentId: req.mobileUser._id, testId, status: 'in_progress' });
    if (!result) return res.status(409).json({ error: 'No active test session.' });
    const test = await Test.findById(testId).populate('questions');
    if (!test) return res.status(404).json({ error: 'Test not found.' });

    const answers = result.answers || {};
    const subjectScores = {};
    let score = 0;
    let correctAnswers = 0;
    let wrongAnswers = 0;
    let skippedAnswers = 0;
    for (const question of test.questions) {
      const subject = question.subject || 'General';
      if (!subjectScores[subject]) subjectScores[subject] = { correct: 0, wrong: 0, skipped: 0, marks: 0, total: 0, attempted: false };
      subjectScores[subject].total += question.marks;
      const answer = answers[question._id.toString()]?.answer;
      if (!answer) {
        skippedAnswers += 1;
        subjectScores[subject].skipped += 1;
      } else if (answer === question.correctAnswer) {
        correctAnswers += 1;
        score += question.marks;
        subjectScores[subject].correct += 1;
        subjectScores[subject].marks += question.marks;
        subjectScores[subject].attempted = true;
      } else {
        wrongAnswers += 1;
        const deduction = Number(test.negativeMarking) || 0;
        score -= deduction;
        subjectScores[subject].wrong += 1;
        subjectScores[subject].marks -= deduction;
        subjectScores[subject].attempted = true;
      }
    }
    const cetFlow = isCetSectionTest(test, test.questions);
    const attemptedSubjects = [];
    const absentSubjects = [];
    let totalMarks = test.totalMarks;
    if (cetFlow) {
      totalMarks = 0;
      Object.entries(subjectScores).forEach(([subject, values]) => {
        values.marks = Number(values.marks.toFixed(2));
        if (values.attempted) {
          attemptedSubjects.push(subject);
          totalMarks += values.total;
        } else {
          absentSubjects.push(subject);
          values.status = 'ABSENT';
        }
      });
    }
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
      attemptedSubjects,
      absentSubjects,
      timeTaken,
      status: 'submitted',
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
  const [students, tests, submittedResults] = await Promise.all([
    User.countDocuments({ role: 'student', isActive: true }),
    Test.countDocuments(),
    Result.countDocuments({ status: { $in: ['submitted', 'auto_submitted'] } }),
  ]);
  return res.json({ stats: { students, tests, submittedResults } });
});

router.get('/admin/students', requireMobileUser, requireRole('admin'), async (req, res) => {
  const students = await User.find({ role: 'student' }).sort({ rollNo: 1 }).select('-password');
  return res.json({ students });
});

router.post('/admin/students', requireMobileUser, requireRole('admin'), async (req, res) => {
  try {
    const { name, rollNo, parentContact, groupId } = req.body;
    if (!name?.trim() || !rollNo?.trim()) return res.status(400).json({ error: 'Name and roll number are required.' });
    if (await User.exists({ rollNo: rollNo.trim() })) return res.status(409).json({ error: 'Roll number already exists.' });
    const initialPassword = `CET@${rollNo.trim().slice(-4).padStart(4, '0')}`;
    const student = await User.create({ name: name.trim(), rollNo: rollNo.trim(), parentContact: parentContact?.trim() || null, role: 'student', password: initialPassword, isFirstLogin: true });
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
    let skipped = 0;
    const duplicates = [];
    for (const row of rows) {
      const rollNo = String(row['Roll No'] || row.rollNo || '').trim();
      const name = String(row.Name || row.name || '').trim();
      if (!rollNo || !name) { skipped += 1; continue; }
      if (await User.exists({ rollNo })) { duplicates.push(rollNo); skipped += 1; continue; }
      const student = await User.create({ name, rollNo, parentContact: String(row['Parent Contact No'] || row.parentContact || '').trim() || null, role: 'student', password: `CET@${rollNo.slice(-4).padStart(4, '0')}`, isFirstLogin: true });
      if (groupId) await GroupMember.findOneAndUpdate({ groupId, userId: student._id }, { role: 'student' }, { upsert: true });
      created += 1;
    }
    return res.json({ created, skipped, duplicates, groupAssigned: Boolean(groupId) });
  } catch (error) {
    console.error('Mobile bulk student import error:', error);
    return res.status(500).json({ error: 'Unable to import students.' });
  }
});

router.delete('/admin/students/:studentId', requireMobileUser, requireRole('admin'), async (req, res) => {
  await GroupMember.deleteMany({ userId: req.params.studentId });
  const result = await User.deleteOne({ _id: req.params.studentId, role: 'student' });
  if (!result.deletedCount) return res.status(404).json({ error: 'Student not found.' });
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

router.get('/admin/topics', requireMobileUser, requireRole('admin'), async (req, res) => {
  const query = { isActive: true };
  if (req.query.course) query.course = req.query.course;
  if (req.query.subject) query.subject = req.query.subject;
  const topics = await Topic.find(query).sort({ course: 1, subject: 1, name: 1 });
  return res.json({ topics });
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
  const allowed = ['title', 'description', 'duration', 'negativeMarking', 'passingMarks', 'shuffleQuestions', 'shuffleOptions', 'startTime', 'endTime', 'instructions', 'course', 'subject', 'topic', 'subtopic', 'groups', 'autoSubmitOnViolation', 'maxTabSwitches', 'maxFocusLosses', 'blockCopyPaste', 'requireFullscreen'];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (update.startTime) update.startTime = new Date(update.startTime);
  if (update.endTime) update.endTime = new Date(update.endTime);
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
  return res.json({ results });
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
