// controllers/studentController.js
const { User, Test, Question, Group, GroupMember, Result, Notification, StudentDocument } = require('../models');
const fs   = require('fs');
const path = require('path');
const { availabilityFor, timingLabel } = require('../services/timingService');
const { resultAvailability, safeSubmission } = require('../services/resultReleaseService');
const DOC_DIR = path.join(__dirname, '../public/uploads/documents');
if (!fs.existsSync(DOC_DIR)) fs.mkdirSync(DOC_DIR, { recursive: true });

exports.getDashboard = async (req, res) => {
  try {
    const studentId = req.session.user.id;

    const [memberships, allResults, notifications] = await Promise.all([
      GroupMember.find({ userId: studentId, role: 'student' }, 'groupId'),
      Result.find({ studentId, status: { $in: ['submitted','auto_submitted'] } })
        .populate('testId', 'title totalMarks subject course duration timingMode endTime resultReleaseMode resultReleaseAt resultsReleased')
        .sort({ submittedAt: -1 }),
      Notification.find({ userId: studentId, isRead: false }).sort({ createdAt: -1 }).limit(8),
    ]);

    const groupIds = memberships.map(m => m.groupId);

    // Fetch tests for those groups + in-progress in parallel
    const [availableTests, inProgressResults] = await Promise.all([
      groupIds.length
        ? Test.find({ groups: { $in: groupIds }, status: { $in: ['published','active'] }, isActive:{ $ne:false } }, 'id title duration timingMode totalMarks subject startTime endTime').sort({ startTime: 1 })
        : Promise.resolve([]),
      Result.find({ studentId, status: 'in_progress' }, 'testId'),
    ]);

    const completedIds  = new Set(allResults.map(r => r.testId?._id?.toString()));
    const inProgressIds = new Set(inProgressResults.map(r => r.testId?.toString()));
    const pendingTests  = availableTests.filter(test => {
      const testId = test._id.toString();
      if (completedIds.has(testId)) return false;
      return availabilityFor(test, { hasInProgressAttempt:inProgressIds.has(testId) }).state !== 'expired';
    });

    const releasedResults = allResults.filter(result => result.testId && resultAvailability(result.testId).available);
    const pendingReleases = allResults
      .filter(result => result.testId && !resultAvailability(result.testId).available)
      .map(result => ({ submission:safeSubmission(result, result.testId), release:resultAvailability(result.testId) }));

    // Chart data (last 10 chronological). Hidden submissions never feed analytics.
    const chartResults = [...releasedResults].reverse().slice(-10);
    const chartData = chartResults.map(r => ({
      label: r.testId?.title ? r.testId.title.substring(0, 18) + (r.testId.title.length > 18 ? '…' : '') : 'Test',
      pct:   r.totalMarks > 0 ? parseFloat(((r.score / r.totalMarks) * 100).toFixed(1)) : 0,
      score: r.score, total: r.totalMarks,
      date:  r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '',
    }));

    // Subject breakdown
    const subjectMap = {};
    releasedResults.forEach(r => {
      const subj = r.testId?.subject || 'General';
      if (!subjectMap[subj]) subjectMap[subj] = { marks: 0, maxMarks: 0, count: 0 };
      subjectMap[subj].marks    += r.score;
      subjectMap[subj].maxMarks += r.totalMarks;
      subjectMap[subj].count++;
    });
    const subjectStats = Object.entries(subjectMap)
      .map(([name, d]) => ({ name, pct: d.maxMarks > 0 ? parseFloat(((d.marks / d.maxMarks) * 100).toFixed(1)) : 0, count: d.count, marks: d.marks, maxMarks: d.maxMarks }))
      .sort((a, b) => b.pct - a.pct);

    const avgScore = releasedResults.length
      ? parseFloat((releasedResults.reduce((s, r) => s + (r.totalMarks > 0 ? (r.score / r.totalMarks) * 100 : 0), 0) / releasedResults.length).toFixed(1)) : 0;
    let scoreTrend = 'neutral';
    if (releasedResults.length >= 2) {
      const last = releasedResults[0].totalMarks > 0 ? (releasedResults[0].score / releasedResults[0].totalMarks) * 100 : 0;
      const prev = releasedResults[1].totalMarks > 0 ? (releasedResults[1].score / releasedResults[1].totalMarks) * 100 : 0;
      scoreTrend = last > prev ? 'up' : last < prev ? 'down' : 'neutral';
    }
    const totalCorrect   = releasedResults.reduce((s, r) => s + (r.correctAnswers || 0), 0);
    const totalAttempted = releasedResults.reduce((s, r) => s + (r.correctAnswers || 0) + (r.wrongAnswers || 0), 0);
    const accuracy = totalAttempted > 0 ? parseFloat(((totalCorrect / totalAttempted) * 100).toFixed(1)) : 0;

    const now = new Date();
    const upcomingTest = pendingTests.find(test => availabilityFor(test, {
      now,
      hasInProgressAttempt:inProgressIds.has(test._id.toString()),
    }).state === 'upcoming') || null;

    res.render('student/dashboard', {
      title: 'My Dashboard', pendingTests,
      completedResults: releasedResults.slice(0, 5),
      allResultsCount: releasedResults.length,
      pendingReleases,
      notifications, chartData: JSON.stringify(chartData),
      subjectStats, upcomingTest, bestResult: null,
      availabilityFor, timingLabel, inProgressIds,
      stats: { pending: pendingTests.length, completed: allResults.length, released:releasedResults.length, avgScore, scoreTrend, accuracy, totalCorrect, totalAttempted },
    });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load dashboard.'); res.redirect('/auth/login'); }
};

exports.getTests = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const now = new Date();
    const [memberships, results] = await Promise.all([
      GroupMember.find({ userId: studentId }, 'groupId'),
      Result.find({ studentId }, 'testId score totalMarks status rank submittedAt'),
    ]);
    const groupIds = memberships.map(m => m.groupId);
    const tests = groupIds.length
      ? await Test.find({ groups: { $in: groupIds }, status: { $in: ['published','active','closed'] }, isActive:{ $ne:false } }).sort({ createdAt: -1 })
      : [];

    const resultMap = {};
    results.forEach(r => { resultMap[r.testId.toString()] = r; });

    // Categorise tests
    const newTests      = [];
    const pendingTests  = [];
    const expiredTests  = [];
    const solvedTests   = [];
    const upcomingTests = [];


    tests.forEach(test => {
      const result   = resultMap[test._id.toString()];
      const isDone   = result && ['submitted','auto_submitted'].includes(result.status);
      const isInProg = result && result.status === 'in_progress';
      const availability = availabilityFor(test, { now, hasInProgressAttempt:Boolean(isInProg) });

      if (isDone) {
        solvedTests.push({ test, result });
      } else if (availability.state === 'expired') {
        expiredTests.push({ test, result: result || null });
      } else if (isInProg) {
        pendingTests.push({ test, result });          // resume
      } else if (availability.state === 'available') {
        newTests.push({ test, result: null });        // ready to start
      } else {
        upcomingTests.push({ test, result: null });   // not open yet
      }
    });

    res.render('student/tests', { title: 'My Tests', newTests, pendingTests, expiredTests, solvedTests, upcomingTests, resultMap, timingLabel, resultAvailability });
  } catch (err) { req.flash('error', 'Failed to load tests.'); res.redirect('/student/dashboard'); }
};

exports.getNotifications = async (req, res) => {
  try {
    const [notifications] = await Promise.all([
      Notification.find({ userId: req.session.user.id }).sort({ createdAt: -1 }),
      Notification.updateMany({ userId: req.session.user.id }, { isRead: true }),
    ]);
    res.render('student/notifications', { title: 'Notifications', notifications });
  } catch (err) { req.flash('error', 'Failed.'); res.redirect('/student/dashboard'); }
};

exports.getResults = async (req, res) => {
  try {
    const results = await Result.find({ studentId: req.session.user.id, status: { $in: ['submitted','auto_submitted'] } })
      .populate('testId', 'title totalMarks duration timingMode subject endTime resultReleaseMode resultReleaseAt resultsReleased')
      .sort({ submittedAt: -1 });
    const releasedResults = results.filter(result => result.testId && resultAvailability(result.testId).available);
    const pendingResults = results
      .filter(result => result.testId && !resultAvailability(result.testId).available)
      .map(result => ({ submission:safeSubmission(result, result.testId), release:resultAvailability(result.testId) }));
    res.render('student/results', { title: 'My Results', results:releasedResults, pendingResults });
  } catch (err) { req.flash('error', 'Failed.'); res.redirect('/student/dashboard'); }
};

exports.getDocuments = async (req, res) => {
  try {
    const docs = await StudentDocument.find({ studentId: req.session.user.id }).sort({ createdAt: -1 });
    res.render('student/documents', { title: 'My Documents', docs });
  } catch (e) { req.flash('error', 'Failed.'); res.redirect('/student/dashboard'); }
};

exports.uploadDocument = async (req, res) => {
  try {
    if (!req.files?.document) { req.flash('error', 'No file selected.'); return res.redirect('/student/documents'); }
    const file  = req.files.document;
    const fname = `doc_${req.session.user.id}_${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    fs.writeFileSync(path.join(DOC_DIR, fname), file.data);
    await StudentDocument.create({
      studentId: req.session.user.id, fileName: fname, originalName: file.name,
      fileType: file.mimetype, fileSize: file.size, filePath: '/uploads/documents/' + fname,
      description: req.body.description || '',
    });
    req.flash('success', 'Document uploaded.');
    res.redirect('/student/documents');
  } catch (e) { req.flash('error', 'Upload failed: ' + e.message); res.redirect('/student/documents'); }
};
