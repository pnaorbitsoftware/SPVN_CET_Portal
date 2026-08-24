// controllers/examController.js — MongoDB / Mongoose
const { Test, Question, Result, GroupMember, User } = require('../models');
const {
  CET_SECTION_ORDER,
  buildQuestionOrder,
  buildSectionState,
  isCetSectionTest,
  orderedSectionNames,
} = require('../utils/cetExam');
const { finalizeAttempt } = require('../services/examSubmissionService');
const { hasSubmittedAnswer, normalizeSubmittedAnswer } = require('../services/questionService');
const { effectiveQuestionConfig } = require('../services/testConfigurationService');
const {
  availabilityFor,
  deadlineForAttempt,
  deadlineForResult,
  remainingSeconds,
  timingLabel,
  timingModeOf,
} = require('../services/timingService');
const { organizationScope } = require('../services/organizationService');
const {
  accessVersion,
  grantSessionAccess,
  resultHasAccess,
  sessionHasAccess,
  validateAccessAttempt,
} = require('../services/testAccessService');

const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };

async function isAssignedStudent(studentId, test) {
  if (!test?.groups?.length) return false;
  return Boolean(await GroupMember.exists({ userId:studentId, role:'student', groupId:{ $in:test.groups } }));
}

exports.getInstructions = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const [test, submitted, inProgress] = await Promise.all([
      Test.findOne({ _id: testId, status: { $in: ['published','active'] }, isActive:{ $ne:false }, ...organizationScope(req.organization) }).populate('questions'),
      Result.findOne({ studentId, testId, status: { $in: ['submitted','auto_submitted'] } }),
      Result.findOne({ studentId, testId, status: 'in_progress' }),
    ]);
    if (!test) { req.flash('error','Test not available.'); return res.redirect('/student/tests'); }
    if (!(await isAssignedStudent(studentId, test))) { req.flash('error','This test is not assigned to your batch.'); return res.redirect('/student/tests'); }
    if (submitted) { req.flash('info','Already submitted.'); return res.redirect(`/results/${submitted._id}`); }
    const availability = availabilityFor(test, { hasInProgressAttempt:Boolean(inProgress) });
    if (!availability.canStart && !availability.canResume) {
      req.flash('error', availability.message);
      return res.redirect('/student/tests');
    }
    if (!sessionHasAccess(req, test)) {
      return res.render('exam/access', { title:`Access — ${test.title}`, test, timingLabel:timingLabel(test) });
    }
    const cetSectionFlow = isCetSectionTest(test, test.questions);
    const sectionSummary = cetSectionFlow
      ? orderedSectionNames(test.questions).map(subject => {
          const questions = test.questions.filter(question => question.subject === subject);
          return {
            subject,
            questionCount: questions.length,
            totalMarks: questions.reduce((sum, question) => sum + effectiveQuestionConfig(test, question).positiveMarks, 0),
          };
        })
      : [];
    res.render('exam/instructions', {
      title: `${test.title} — Instructions`,
      test,
      questionCount: test.questions.length,
      inProgress: !!inProgress,
      cetSectionFlow,
      sectionSummary,
      timingLabel:timingLabel(test),
      timingMode:timingModeOf(test),
    });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/student/tests'); }
};

exports.unlockTest = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const test = await Test.findOne({
      _id:req.params.testId,
      status:{ $in:['published','active'] },
      isActive:{ $ne:false },
      ...organizationScope(req.organization),
    }).select('+testAccessHash');
    if (!test || !(await isAssignedStudent(studentId, test))) {
      req.flash('error','Test not available.');
      return res.redirect('/student/tests');
    }
    if (!test.testAccessEnabled) return res.redirect(`/exam/${test._id}/instructions`);
    const attempt = await validateAccessAttempt({
      userId:studentId,
      testId:test._id,
      password:req.body.testAccessPassword,
      passwordHash:test.testAccessHash,
    });
    if (!attempt.ok) {
      req.flash('error', attempt.code === 'RATE_LIMITED'
        ? `Too many invalid attempts. Try again in ${attempt.retryAfterSeconds} seconds.`
        : 'Incorrect test password or PIN.');
      return res.redirect(`/exam/${test._id}/instructions`);
    }
    grantSessionAccess(req, test);
    req.flash('success','Test access verified.');
    return res.redirect(`/exam/${test._id}/instructions`);
  } catch (error) {
    console.error(error);
    req.flash('error','Unable to verify test access.');
    return res.redirect('/student/tests');
  }
};

exports.startExam = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const [test, submitted, inProgress] = await Promise.all([
      Test.findOne({ _id: testId, status: { $in: ['published','active'] }, isActive:{ $ne:false }, ...organizationScope(req.organization) }).populate('questions'),
      Result.findOne({ studentId, testId, status: { $in: ['submitted','auto_submitted'] } }),
      Result.findOne({ studentId, testId, status:'in_progress' }),
    ]);
    if (!test) { req.flash('error','Test not available.'); return res.redirect('/student/tests'); }
    if (!(await isAssignedStudent(studentId, test))) { req.flash('error','This test is not assigned to your batch.'); return res.redirect('/student/tests'); }
    if (submitted) { req.flash('info','Already submitted.'); return res.redirect(`/results/${submitted._id}`); }
    if (!sessionHasAccess(req, test)) { req.flash('error','Enter the test password or PIN first.'); return res.redirect(`/exam/${testId}/instructions`); }

    const availability = availabilityFor(test, { hasInProgressAttempt:Boolean(inProgress) });
    if (!availability.canStart && !availability.canResume) {
      if (inProgress && timingModeOf(test) === 'FIXED_WINDOW') {
        const finalized = await finalizeAttempt({ result:inProgress, test, isAutoSubmit:true });
        return res.redirect(`/results/${finalized._id}`);
      }
      req.flash('error',availability.message);
      return res.redirect('/student/tests');
    }

    let result = inProgress;
    if (!result) {
      const questionIds = buildQuestionOrder(test, test.questions);
      const startedAt = new Date();
      result = await Result.create({
        organization:test.organization || null,
        studentId, testId, score: 0, totalMarks: test.totalMarks, fullTotalMarks: test.totalMarks,
        answers: {}, questionTimings: {},
        cheatingFlags: { tabSwitches:0, fullscreenExits:0, focusLosses:0 },
        violationCount: 0, status: 'in_progress', startedAt, lastActivityAt:startedAt,
        deadlineAt:deadlineForAttempt(test, startedAt),
        accessVersion:accessVersion(test),
        questionOrder: questionIds, markedForReview: [],
      });
    } else if (!resultHasAccess(test, result)) {
      result.accessVersion = accessVersion(test);
      await result.save();
    }
    res.redirect(`/exam/${testId}/question/1`);
  } catch (e) { console.error(e); req.flash('error','Failed to start.'); res.redirect('/student/tests'); }
};

exports.getQuestion = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId, qNum } = req.params;
    const questionNumber = parseInt(qNum);

    const [result, test] = await Promise.all([
      Result.findOne({ studentId, testId, status: 'in_progress' }),
      Test.findOne({ _id:testId, ...organizationScope(req.organization) }),
    ]);

    if (!result) {
      const submitted = await Result.findOne({ studentId, testId, status: { $in: ['submitted','auto_submitted'] } });
      if (submitted) return res.redirect(`/results/${submitted._id}`);
      return res.redirect(`/exam/${testId}/instructions`);
    }
    if (!test) { req.flash('error','Test not found.'); return res.redirect('/student/tests'); }
    if (!resultHasAccess(test, result)) { req.flash('error','Verify the current test password or PIN to resume.'); return res.redirect(`/exam/${testId}/instructions`); }

    const remaining = remainingSeconds(test, result);
    if (remaining !== null && remaining <= 0) { req.body = { auto:'true' }; return exports.submitExam(req, res); }
    if (!result.deadlineAt && timingModeOf(test) !== 'UNTIMED') {
      result.deadlineAt = deadlineForResult(test, result);
      await result.save();
    }

    const questionIds = result.questionOrder;
    const totalQuestions = questionIds.length;
    if (questionNumber < 1 || questionNumber > totalQuestions) return res.redirect(`/exam/${testId}/question/1`);

    const questionRows = await Question.find(
      { _id: { $in: questionIds } },
      '_id subject'
    );
    const cetSectionFlow = isCetSectionTest(test, questionRows);
    const sectionState = cetSectionFlow
      ? buildSectionState(questionIds, questionRows, result.answers || {}, result.visitedQuestionIds || [])
      : null;
    const currentQuestionId = questionIds[questionNumber - 1];
    const requestedSubject = sectionState?.subjectById.get(String(currentQuestionId));
    const requestedSection = sectionState?.sections
      .find(section => section.name === requestedSubject);
    if (cetSectionFlow && requestedSection?.locked) {
      return res.redirect(`/exam/${testId}/question/${sectionState.firstPendingQuestionNumber}`);
    }

    const visitedQuestionIds = new Set(
      (result.visitedQuestionIds || []).map(questionId => String(questionId))
    );
    const currentQuestionKey = String(currentQuestionId);
    if (!visitedQuestionIds.has(currentQuestionKey)) {
      visitedQuestionIds.add(currentQuestionKey);
      await Result.updateOne(
        { _id:result._id },
        { $addToSet:{ visitedQuestionIds:currentQuestionKey } }
      );
    }

    const question = await Question.findById(currentQuestionId);
    if (!question) { req.flash('error','Question not found.'); return res.redirect('/student/tests'); }

    let options = [
      { key:'A', value: question.optionA, image: question.optionAImage },
      { key:'B', value: question.optionB, image: question.optionBImage },
      { key:'C', value: question.optionC, image: question.optionCImage },
      { key:'D', value: question.optionD, image: question.optionDImage },
    ];
    if (test.shuffleOptions) options = shuffle(options);

    const answers = result.answers || {};
    const markedForReview = result.markedForReview || [];

    const paletteStatus = questionIds.map((questionId, questionIndex) => {
      const id = String(questionId);
      const answered = hasSubmittedAnswer(answers[id]?.answer);
      const marked   = markedForReview.includes(id);
      const subject = sectionState?.subjectById.get(id) || question.subject;
      const sectionIndex = sectionState?.sections.findIndex(section => section.name === subject) ?? 0;
      let status = 'not-visited';
      if (answered && marked) status = 'answered-marked';
      else if (answered)      status = 'answered';
      else if (marked)        status = 'marked';
      else if (visitedQuestionIds.has(id)) status = 'not-answered';
      return {
        num: questionIndex + 1,
        qId: questionId,
        status,
        subject,
        locked: cetSectionFlow && sectionState.sections[sectionIndex]?.locked,
      };
    });

    const currentSection = cetSectionFlow
      ? sectionState.sections.find(section => section.name === question.subject)
      : null;
    const sectionQuestionNumber = currentSection
      ? currentSection.questionNumbers.indexOf(questionNumber) + 1
      : questionNumber;

    res.render('exam/question', {
      title: `Q${questionNumber} — ${test.title}`,
      test, question, options, questionNumber, totalQuestions,
      remaining, paletteStatus,
      selectedAnswer: answers[String(currentQuestionId)]?.answer ?? null,
      isMarked: markedForReview.includes(String(currentQuestionId)),
      resultId: result._id,
      violations: result.violationCount || 0,
      result,
      questionConfig:effectiveQuestionConfig(test, question),
      cetSectionFlow,
      sectionState,
      currentSection,
      sectionQuestionNumber,
    });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/student/tests'); }
};

exports.saveAnswer = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const { questionId, answer, markForReview, timeSpent } = req.body;

    const result = await Result.findOne({ studentId, testId, status: 'in_progress' });
    if (!result) return res.json({ success: false, message: 'Session expired' });

    if (!result.questionOrder.map(String).includes(String(questionId))) {
      return res.status(400).json({ success:false, message:'Question does not belong to this test.' });
    }

    const [test, questionRows] = await Promise.all([
      Test.findById(testId).select('course timingMode duration endTime testAccessEnabled testAccessUpdatedAt'),
      Question.find({ _id: { $in: result.questionOrder } }, '_id subject questionType'),
    ]);
    const currentQuestion = questionRows.find(question => String(question._id) === String(questionId));
    if (!test || !currentQuestion) return res.status(404).json({ success:false, message:'Question not found.' });
    if (!resultHasAccess(test, result)) return res.status(403).json({ success:false, message:'Test access must be verified again.' });
    if (remainingSeconds(test, result) === 0) {
      const scoringTest = await Test.findById(testId).populate('questions');
      await finalizeAttempt({ result, test:scoringTest, isAutoSubmit:true });
      return res.status(409).json({ success:false, autoSubmitted:true, message:'Time is over. The test was submitted.' });
    }
    const cetSectionFlow = isCetSectionTest(test, questionRows);
    const sectionState = cetSectionFlow
      ? buildSectionState(result.questionOrder, questionRows, result.answers || {}, result.visitedQuestionIds || [])
      : null;
    const questionSubject = sectionState?.subjectById.get(String(questionId));
    const questionSection = sectionState?.sections.find(section => section.name === questionSubject);
    if (questionSection?.locked) {
      return res.status(403).json({ success: false, message: 'Visit every Physics and Chemistry question first.' });
    }

    const answers        = { ...(result.answers || {}) };
    const questionTimings = { ...(result.questionTimings || {}) };
    const markedForReview = [...(result.markedForReview || [])];

    let normalizedAnswer;
    try {
      normalizedAnswer = normalizeSubmittedAnswer(answer, currentQuestion.questionType);
    } catch (error) {
      return res.status(400).json({ success:false, message:error.message });
    }
    answers[questionId] = { answer: normalizedAnswer, savedAt: new Date() };
    if (timeSpent && !isNaN(timeSpent))
      questionTimings[questionId] = (questionTimings[questionId] || 0) + parseInt(timeSpent);

    const idx = markedForReview.indexOf(String(questionId));
    if (markForReview === 'true' || markForReview === true) { if (idx === -1) markedForReview.push(String(questionId)); }
    else { if (idx !== -1) markedForReview.splice(idx, 1); }

    const visitedQuestionIds = [...new Set([
      ...(result.visitedQuestionIds || []).map(value => String(value)),
      String(questionId),
    ])];
    await Result.findByIdAndUpdate(result._id, { answers, questionTimings, markedForReview, visitedQuestionIds, lastActivityAt:new Date() });
    return res.json({ success: true, answeredCount: Object.values(answers).filter(entry => hasSubmittedAnswer(entry?.answer)).length });
  } catch (e) { console.error(e); return res.json({ success: false, message: e.message }); }
};

exports.reportViolation = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const { type } = req.body;
    const [result, test] = await Promise.all([
      Result.findOne({ studentId, testId, status: 'in_progress' }),
      Test.findById(testId).select('autoSubmitOnViolation maxTabSwitches maxFocusLosses testAccessEnabled testAccessUpdatedAt'),
    ]);
    if (!result) return res.json({ success: false });
    if (!resultHasAccess(test, result)) return res.status(403).json({ success:false, message:'Test access must be verified again.' });

    const flags = result.cheatingFlags || { tabSwitches:0, fullscreenExits:0, focusLosses:0 };
    if (type === 'tabSwitch')           flags.tabSwitches    = (flags.tabSwitches||0) + 1;
    else if (type === 'fullscreenExit') flags.fullscreenExits = (flags.fullscreenExits||0) + 1;
    else if (type === 'focusLoss')      flags.focusLosses    = (flags.focusLosses||0) + 1;

    const violations = (flags.tabSwitches||0) + (flags.fullscreenExits||0) + (flags.focusLosses||0);
    await Result.findByIdAndUpdate(result._id, { cheatingFlags: flags, violationCount: violations });

    // ── Auto-submit check ─────────────────────────────────────────────────
    const maxSwitches = test?.maxTabSwitches ?? 3;
    const maxFocusLosses = test?.maxFocusLosses ?? 5;
    const shouldAutoSubmit = test?.autoSubmitOnViolation && (
      (type === 'tabSwitch'    && flags.tabSwitches    >= maxSwitches) ||
      (type === 'focusLoss'    && flags.focusLosses    >= maxFocusLosses) ||
      (type === 'fullscreenExit' && flags.fullscreenExits >= 3)
    );

    const remaining = Math.max(0, maxSwitches - (flags.tabSwitches||0));
    let warningLevel = remaining <= 1 ? 'danger' : 'warning';
    let warningMsg = shouldAutoSubmit
      ? 'Exam auto-submitted due to too many violations.'
      : `⚠ Tab switch detected! ${remaining} more allowed.`;

    return res.json({
      success: true, violations,
      tabSwitches: flags.tabSwitches||0,
      focusLosses: flags.focusLosses||0,
      autoSubmit: shouldAutoSubmit,
      warningLevel, warningMsg,
    });
  } catch (e) { console.error(e); return res.json({ success: false }); }
};

exports.submitExam = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const isAutoSubmit = req.body?.auto === 'true';

    const result = await Result.findOne({ studentId, testId, status: 'in_progress' });
    if (!result) {
      const done = await Result.findOne({ studentId, testId, status: { $in: ['submitted','auto_submitted'] } });
      if (done) return res.redirect(`/results/${done._id}`);
      return res.redirect('/student/tests');
    }

    const test = await Test.findById(testId).populate('questions');
    if (!test) { req.flash('error','Test not found.'); return res.redirect('/student/tests'); }
    if (!resultHasAccess(test, result)) { req.flash('error','Verify the current test password or PIN before submitting.'); return res.redirect(`/exam/${testId}/instructions`); }
    await finalizeAttempt({ result, test, isAutoSubmit });
    return res.redirect(`/results/${result._id}`);
  } catch (e) { console.error(e); req.flash('error','Submit failed.'); res.redirect('/student/tests'); }
};

exports.autoSubmit = async (req, res) => { req.body = { auto:'true' }; return exports.submitExam(req, res); };

// Called via navigator.sendBeacon when student navigates away mid-exam
exports.leaveExam = async (req, res) => {
  try {
    const studentId = req.session?.user?.id;
    const { testId } = req.params;
    if (!studentId) return res.sendStatus(204);

    const body = req.body || {};
    const { questionId, answer, markForReview, timeSpent } = body;

    const [result, test] = await Promise.all([
      Result.findOne({ studentId, testId, status: 'in_progress' }),
      Test.findById(testId).select('testAccessEnabled testAccessUpdatedAt'),
    ]);
    if (!result) return res.sendStatus(204);
    if (!test || !resultHasAccess(test, result)) return res.sendStatus(403);

    // Save the current answer first
    if (questionId) {
      const answers         = { ...(result.answers || {}) };
      const questionTimings = { ...(result.questionTimings || {}) };
      const markedForReview = [...(result.markedForReview || [])];

      if (!result.questionOrder.map(String).includes(String(questionId))) return res.sendStatus(204);
      const question = await Question.findById(questionId).select('questionType');
      if (!question) return res.sendStatus(204);
      let normalizedAnswer = null;
      try { normalizedAnswer = normalizeSubmittedAnswer(answer, question.questionType); } catch { normalizedAnswer = null; }
      answers[questionId] = { answer: normalizedAnswer, savedAt: new Date() };
      if (timeSpent && !isNaN(timeSpent))
        questionTimings[questionId] = (questionTimings[questionId] || 0) + parseInt(timeSpent);

      const idx = markedForReview.indexOf(String(questionId));
      if (markForReview === 'true') { if (idx === -1) markedForReview.push(String(questionId)); }
      else { if (idx !== -1) markedForReview.splice(idx, 1); }

      const visitedQuestionIds = [...new Set([
        ...(result.visitedQuestionIds || []).map(value => String(value)),
        String(questionId),
      ])];
      await Result.findByIdAndUpdate(result._id, { answers, questionTimings, markedForReview, visitedQuestionIds, lastActivityAt:new Date() });
    }

    // Note: do NOT auto-submit here. This fires on any page unload —
    // including back/forward navigation and refresh — not just tab close.
    // Auto-submitting the whole exam on a simple back-navigation was
    // silently locking students out mid-test. Only the timer expiring
    // (getQuestion/countdown) or violation thresholds (reportViolation)
    // should trigger a real auto-submit.
    return res.sendStatus(204);
  } catch (e) {
    console.error('leaveExam error:', e);
    return res.sendStatus(204);
  }
};

exports.getResult = async (req, res) => {
  try {
    const result = await Result.findById(req.params.resultId)
      .populate('studentId', 'name rollNo email')
      .populate({ path: 'testId', populate: { path: 'questions' } });
    if (!result) { req.flash('error','Not found.'); return res.redirect('/student/dashboard'); }

    const viewer = req.session.user;
    if (viewer.role === 'student' && result.studentId._id.toString() !== viewer.id)
      { req.flash('error','Access denied.'); return res.redirect('/student/dashboard'); }

    const [topperResult, totalAttempted, trend] = await Promise.all([
      Result.findOne({ testId: result.testId._id, rank: 1 }, 'score subjectScores'),
      Result.countDocuments({ testId: result.testId._id, status: { $in: ['submitted','auto_submitted'] } }),
      Result.find({ studentId: result.studentId._id, status: { $in: ['submitted','auto_submitted'] } })
        .populate('testId','title').sort({ submittedAt: 1 }).limit(10),
    ]);

    const percentage = result.totalMarks > 0
      ? parseFloat(((result.score / result.totalMarks) * 100).toFixed(1)) : 0;

    res.render('exam/result', { title: 'Exam Result', result, percentage, topperResult, trend, totalAttempted });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/student/dashboard'); }
};

exports.downloadResultPDF = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const result = await Result.findById(req.params.resultId)
      .populate('studentId', 'name rollNo email')
      .populate({ path: 'testId', populate: { path: 'questions' } });
    if (!result) return res.status(404).send('Not found');

    const test = result.testId;
    const questionMap = {};
    (test.questions || []).forEach(q => { questionMap[q._id.toString()] = q; });
    const orderedIds  = result.questionOrder?.length ? result.questionOrder : Object.keys(questionMap);
    const questions   = orderedIds.map(id => questionMap[id.toString()]).filter(Boolean);
    const answers     = result.answers || {};
    const safe        = str => (str || '').replace(/<[^>]*>/g, '').trim();
    const COLLEGE     = process.env.COLLEGE_NAME || 'College';
    const pct         = result.totalMarks > 0 ? ((result.score / result.totalMarks) * 100).toFixed(1) : '0.0';

    const doc = new PDFDocument({ margin: 45, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=result_${result._id}.pdf`);
    doc.pipe(res);

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e293b').text(COLLEGE, { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#64748b').text('CET Examination — Detailed Result Card', { align: 'center' });
    doc.moveDown(0.5);

    const info = [
      ['Name', result.studentId.name], ['Roll No', result.studentId.rollNo || '—'],
      ['Test', test.title],
      ['Date', result.submittedAt ? new Date(result.submittedAt).toLocaleDateString('en-IN') : '—'],
      ['Score', `${result.score} / ${result.totalMarks}  (${pct}%)`],
      ['Rank', `#${result.rank || '—'}  ·  Correct: ${result.correctAnswers}  Wrong: ${result.wrongAnswers}  Skipped: ${result.skippedAnswers}`],
    ];
    info.forEach(([label, val]) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#64748b').text(`${label}: `, { continued: true });
      doc.font('Helvetica').fillColor('#1e293b').text(val);
    });

    const subjectScores = result.subjectScores || {};
    const subjectNames = [
      ...CET_SECTION_ORDER.filter(subject => subjectScores[subject]),
      ...Object.keys(subjectScores).filter(subject => !CET_SECTION_ORDER.includes(subject)),
    ];
    if (subjectNames.length) {
      doc.moveDown(0.8);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text('SUBJECT-WISE MARKS');
      subjectNames.forEach(subject => {
        const data = subjectScores[subject];
        const value = data.status === 'ABSENT'
          ? 'ABSENT'
          : `${data.marks || 0} / ${data.total || 0}`;
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#64748b').text(`${subject}: `, { continued: true });
        doc.font('Helvetica').fillColor(data.status === 'ABSENT' ? '#dc2626' : '#1e293b').text(value);
      });
      if (result.absentSubjects?.length) {
        doc.fontSize(8).font('Helvetica').fillColor('#64748b')
          .text(`Total uses attempted subjects only. Full test marks: ${result.fullTotalMarks || test.totalMarks}.`);
      }
    }

    doc.addPage();
    doc.fontSize(11).font('Helvetica-Bold').text('QUESTION-BY-QUESTION ANSWERS', { align: 'center' });
    doc.moveDown(0.5);

    questions.forEach((q, idx) => {
      if (doc.y > 700) doc.addPage();
      const ans = answers[String(q._id)] || {};
      const given = ans.answer || null;
      const isCorrect = given && given === q.correctAnswer;
      const statusColor = isCorrect ? '#16a34a' : given ? '#dc2626' : '#b45309';
      const optMap = { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD };

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e1f5e').text(`Q${idx+1}. `, { continued: true });
      doc.font('Helvetica').fillColor('#1e293b').text(safe(q.question));
      ['A','B','C','D'].forEach(key => {
        const isC = q.correctAnswer === key, isG = given === key;
        const col = isC ? '#16a34a' : (isG && !isC) ? '#dc2626' : '#374151';
        doc.fontSize(8).font(isC||isG?'Helvetica-Bold':'Helvetica').fillColor(col)
           .text(`   ${isC?'✓':isG?'✗':' '} ${key}) ${safe(optMap[key]||'')}`, { width: 480 });
      });
      if (q.explanation) {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#6d28d9').text('Explanation: ', { continued: true });
        doc.font('Helvetica').fillColor('#4b5563').text(safe(q.explanation));
      }
      doc.moveDown(0.5);
    });

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
         .text(`${COLLEGE} · Page ${i+1} of ${totalPages}`, 45, 820, { width: 505, align: 'center' });
    }
    doc.end();
  } catch (e) { console.error('PDF error:', e); res.status(500).send('PDF generation failed: ' + e.message); }
};

exports.getLeaderboard = async (req, res) => {
  try {
    const { testId } = req.params;
    const [test, results] = await Promise.all([
      Test.findById(testId),
      Result.find({ testId, status: { $in: ['submitted','auto_submitted'] } })
        .populate('studentId', 'name rollNo')
        .sort({ rank:1, score: -1, timeTaken: 1 }).limit(50),
    ]);
    if (!test) { req.flash('error','Not found.'); return res.redirect('/student/dashboard'); }
    res.render('exam/leaderboard', { title: `Leaderboard — ${test.title}`, test, results });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/student/dashboard'); }
};
