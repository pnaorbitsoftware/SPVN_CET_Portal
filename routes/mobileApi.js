const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const { GroupMember, Notification, Result, Test, User } = require('../models');

const router = express.Router();
const tokenSecret = process.env.MOBILE_API_SECRET || process.env.SESSION_SECRET || 'svpn_mobile_dev_secret';

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

router.get('/admin/dashboard', requireMobileUser, requireRole('admin'), async (req, res) => {
  const [students, tests, submittedResults] = await Promise.all([
    User.countDocuments({ role: 'student', isActive: true }),
    Test.countDocuments(),
    Result.countDocuments({ status: { $in: ['submitted', 'auto_submitted'] } }),
  ]);
  return res.json({ stats: { students, tests, submittedResults } });
});

module.exports = router;
