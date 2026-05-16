// controllers/examController.js
const { Test, Question, TestQuestion, Result, GroupMember, TestGroup, User } = require('../models');
const { Op } = require('sequelize');

const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };

// ── INSTRUCTIONS ──────────────────────────────────────────────────────────────
exports.getInstructions = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const test = await Test.findOne({
      where: { id: testId, status: { [Op.in]: ['published','active'] } },
      include: [{ model: Question, as: 'questions', through: { attributes: [] } }],
    });
    if (!test) { req.flash('error','Test not available.'); return res.redirect('/student/tests'); }
    const submitted = await Result.findOne({ where: { studentId, testId, status: { [Op.in]: ['submitted','auto_submitted'] } } });
    if (submitted) { req.flash('info','Already submitted.'); return res.redirect(`/results/${submitted.id}`); }
    const inProgress = await Result.findOne({ where: { studentId, testId, status: 'in_progress' } });
    res.render('exam/instructions', { title: `${test.title} — Instructions`, test, questionCount: test.questions.length, inProgress: !!inProgress });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/student/tests'); }
};

// ── START ─────────────────────────────────────────────────────────────────────
exports.startExam = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const test = await Test.findOne({
      where: { id: testId, status: { [Op.in]: ['published','active'] } },
      include: [{ model: Question, as: 'questions', through: { attributes: [] } }],
    });
    if (!test) { req.flash('error','Test not available.'); return res.redirect('/student/tests'); }

    // Check if already submitted
    const submitted = await Result.findOne({ where: { studentId, testId, status: { [Op.in]: ['submitted','auto_submitted'] } } });
    if (submitted) { req.flash('info','Already submitted.'); return res.redirect(`/results/${submitted.id}`); }

    // Resume existing in-progress attempt
    let result = await Result.findOne({ where: { studentId, testId, status: 'in_progress' } });

    if (!result) {
      // New attempt — shuffle once and PERSIST the order to DB
      let questionIds = test.questions.map(q => q.id);
      if (test.shuffleQuestions) questionIds = shuffle(questionIds);

      result = await Result.create({
        studentId, testId,
        score: 0, totalMarks: test.totalMarks,
        answers: {}, questionTimings: {},
        cheatingFlags: { tabSwitches:0, fullscreenExits:0, focusLosses:0 },
        violationCount: 0,
        status: 'in_progress',
        startedAt: new Date(),
        questionOrder: questionIds,   // ← persisted to DB, never reshuffled
        markedForReview: [],
      });
    }

    res.redirect(`/exam/${testId}/question/1`);
  } catch (e) { console.error(e); req.flash('error','Failed to start.'); res.redirect('/student/tests'); }
};

// ── GET QUESTION ──────────────────────────────────────────────────────────────
exports.getQuestion = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId, qNum } = req.params;
    const questionNumber = parseInt(qNum);

    // Load result from DB — no session dependency for critical data
    const result = await Result.findOne({ where: { studentId, testId, status: 'in_progress' } });
    if (!result) {
      // Check if already submitted
      const submitted = await Result.findOne({ where: { studentId, testId, status: { [Op.in]: ['submitted','auto_submitted'] } } });
      if (submitted) return res.redirect(`/results/${submitted.id}`);
      return res.redirect(`/exam/${testId}/instructions`);
    }

    const test = await Test.findByPk(testId);
    if (!test) { req.flash('error','Test not found.'); return res.redirect('/student/tests'); }

    // Calculate remaining time from DB startedAt — never from session
    const startedAt = new Date(result.startedAt);
    const remaining = Math.max(0, Math.floor((test.duration * 60 * 1000 - (Date.now() - startedAt.getTime())) / 1000));
    if (remaining <= 0) {
      // Auto-submit directly
      req.body = { auto: 'true' };
      return exports.submitExam(req, res);
    }

    // Use persisted question order from DB — stable across refreshes
    const questionIds = result.questionOrder;
    if (!questionIds || !questionIds.length) {
      // Fallback: load from test, persist
      const freshTest = await Test.findOne({ where: { id: testId }, include: [{ model: Question, as: 'questions', through: { attributes: [] } }] });
      const ids = freshTest.questions.map(q => q.id);
      await result.update({ questionOrder: ids });
      return res.redirect(`/exam/${testId}/question/${questionNumber}`);
    }

    const totalQuestions = questionIds.length;
    if (questionNumber < 1 || questionNumber > totalQuestions) return res.redirect(`/exam/${testId}/question/1`);

    const currentQuestionId = questionIds[questionNumber - 1];
    const question = await Question.findByPk(currentQuestionId);
    if (!question) { req.flash('error','Question not found.'); return res.redirect('/student/tests'); }

    let options = [
      { key:'A', value: question.optionA },
      { key:'B', value: question.optionB },
      { key:'C', value: question.optionC },
      { key:'D', value: question.optionD },
    ];
    if (test.shuffleOptions) options = shuffle(options);

    const answers = result.answers || {};
    const markedForReview = result.markedForReview || [];

    const paletteStatus = questionIds.map((qId, idx) => {
      const num = idx + 1;
      const answered = !!(answers[qId]?.answer);
      const marked = markedForReview.includes(String(qId));
      let status = 'not-visited';
      if (answered && marked) status = 'answered-marked';
      else if (answered)      status = 'answered';
      else if (marked)        status = 'marked';
      else if (num < questionNumber) status = 'not-answered';
      return { num, qId, status };
    });

    res.render('exam/question', {
      title: `Q${questionNumber} — ${test.title}`,
      test, question, options, questionNumber, totalQuestions,
      remaining, paletteStatus,
      selectedAnswer: answers[currentQuestionId]?.answer || null,
      isMarked: markedForReview.includes(String(currentQuestionId)),
      resultId: result.id,
      violations: result.violationCount || 0,
      result, // pass result so exam view can read cheatingFlags for initial counts
    });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/student/tests'); }
};

// ── SAVE ANSWER (AJAX) ────────────────────────────────────────────────────────
exports.saveAnswer = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const { questionId, answer, markForReview, timeSpent } = req.body;

    // Load from DB — not session
    const result = await Result.findOne({ where: { studentId, testId, status: 'in_progress' } });
    if (!result) return res.json({ success: false, message: 'Session expired or already submitted' });

    const answers = { ...(result.answers || {}) };
    const questionTimings = { ...(result.questionTimings || {}) };
    const markedForReview = [...(result.markedForReview || [])];

    // Save or clear answer — keep visit record even when clearing
    if (answer && answer.trim()) {
      answers[questionId] = { answer: answer.trim(), savedAt: new Date() };
    } else {
      // Clear answer but keep as visited (null answer)
      answers[questionId] = { answer: null, savedAt: new Date() };
    }

    if (timeSpent && !isNaN(timeSpent)) {
      questionTimings[questionId] = (questionTimings[questionId] || 0) + parseInt(timeSpent);
    }

    // Update marked for review in DB
    const idx = markedForReview.indexOf(String(questionId));
    if (markForReview === 'true' || markForReview === true) {
      if (idx === -1) markedForReview.push(String(questionId));
    } else {
      if (idx !== -1) markedForReview.splice(idx, 1);
    }

    await result.update({ answers, questionTimings, markedForReview });

    return res.json({ success: true, answeredCount: Object.values(answers).filter(a => a.answer).length });
  } catch (e) { console.error(e); return res.json({ success: false, message: e.message }); }
};

// ── REPORT VIOLATION (AJAX) ───────────────────────────────────────────────────
// ── REPORT VIOLATION (AJAX) ───────────────────────────────────────────────────
exports.reportViolation = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const { type } = req.body;

    // Find in-progress result directly from DB (no session dependency)
    const result = await Result.findOne({ where: { studentId, testId, status: 'in_progress' } });
    if (!result) return res.json({ success: false });

    const test = await Test.findByPk(testId);
    const flags = result.cheatingFlags || { tabSwitches:0, fullscreenExits:0, focusLosses:0 };

    if (type === 'tabSwitch') flags.tabSwitches = (flags.tabSwitches||0) + 1;
    else if (type === 'fullscreenExit') flags.fullscreenExits = (flags.fullscreenExits||0) + 1;
    else if (type === 'focusLoss') flags.focusLosses = (flags.focusLosses||0) + 1;

    const violations = (flags.tabSwitches||0) + (flags.fullscreenExits||0) + (flags.focusLosses||0);
    await result.update({ cheatingFlags: flags, violationCount: violations });

    // Check if auto-submit should trigger
    let autoSubmit = false;
    let warningMsg = '';
    const maxTab = test.maxTabSwitches || 3;
    const maxFocus = test.maxFocusLosses || 5;

    if (test.autoSubmitOnViolation) {
      if (type === 'tabSwitch' && flags.tabSwitches >= maxTab) {
        autoSubmit = true;
        warningMsg = `Exam auto-submitted: exceeded ${maxTab} tab switch limit.`;
      } else if (type === 'focusLoss' && flags.focusLosses >= maxFocus) {
        autoSubmit = true;
        warningMsg = `Exam auto-submitted: exceeded ${maxFocus} focus loss limit.`;
      }
    }

    // Remaining warnings
    const tabRemaining = Math.max(0, maxTab - (flags.tabSwitches||0));
    const warningLevel = tabRemaining <= 1 ? 'danger' : tabRemaining <= 2 ? 'warning' : 'info';

    return res.json({
      success: true,
      violations,
      autoSubmit,
      warningMsg,
      tabSwitches: flags.tabSwitches||0,
      maxTabSwitches: maxTab,
      tabRemaining,
      warningLevel,
      autoSubmitEnabled: !!test.autoSubmitOnViolation,
    });
  } catch (e) { console.error(e); return res.json({ success: false }); }
};

// ── SUBMIT ────────────────────────────────────────────────────────────────────
exports.submitExam = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const isAutoSubmit = req.body?.auto === 'true';

    // Find in-progress result from DB — no session needed
    const result = await Result.findOne({ where: { studentId, testId, status: 'in_progress' } });
    if (!result) {
      // Already submitted — find and redirect
      const done = await Result.findOne({ where: { studentId, testId, status: { [Op.in]: ['submitted','auto_submitted'] } } });
      if (done) return res.redirect(`/results/${done.id}`);
      return res.redirect('/student/tests');
    }

    const test = await Test.findByPk(testId, { include: [{ model: Question, as: 'questions', through: { attributes: [] } }] });
    const answers = result.answers || {};

    let score = 0, correct = 0, wrong = 0, skipped = 0;
    const subjectScores = {}, topicScores = {};

    for (const question of test.questions) {
      const subj = question.subject || 'General';
      const topic = question.topic || 'General';
      if (!subjectScores[subj]) subjectScores[subj] = { correct:0, wrong:0, skipped:0, marks:0, total:0 };
      if (!topicScores[topic])  topicScores[topic]  = { correct:0, wrong:0, skipped:0 };
      subjectScores[subj].total += question.marks;

      const given = answers[question.id]?.answer;
      if (!given) {
        skipped++; subjectScores[subj].skipped++; topicScores[topic].skipped++;
      } else if (given === question.correctAnswer) {
        score += question.marks; correct++;
        subjectScores[subj].correct++; subjectScores[subj].marks += question.marks;
        topicScores[topic].correct++;
      } else {
        score -= (parseFloat(test.negativeMarking) || 0); wrong++;
        subjectScores[subj].wrong++; topicScores[topic].wrong++;
      }
    }

    score = Math.max(0, parseFloat(score.toFixed(2)));
    const timeTaken = Math.floor((Date.now() - new Date(result.startedAt).getTime()) / 1000);

    await result.update({
      score, totalMarks: test.totalMarks,
      correctAnswers: correct, wrongAnswers: wrong, skippedAnswers: skipped,
      timeTaken, subjectScores, topicScores,
      status: isAutoSubmit ? 'auto_submitted' : 'submitted',
      submittedAt: new Date(),
    });

    await updateRanks(testId);

    // Clean up session if present
    if (req.session.examSession) delete req.session.examSession[testId];

    return res.redirect(`/results/${result.id}`);
  } catch (e) { console.error(e); req.flash('error','Submit failed.'); res.redirect('/student/tests'); }
};

// GET auto-submit — timer expired redirect
exports.autoSubmit = async (req, res) => {
  req.body = { auto: 'true' };
  return exports.submitExam(req, res);
};

async function updateRanks(testId) {
  const results = await Result.findAll({
    where: { testId, status: { [Op.in]: ['submitted','auto_submitted'] } },
    order: [['score','DESC'],['timeTaken','ASC']],
  });
  for (let i = 0; i < results.length; i++) {
    await results[i].update({ rank: i+1, percentile: parseFloat((((results.length-i)/results.length)*100).toFixed(2)) });
  }
}

// ── RESULT ────────────────────────────────────────────────────────────────────
exports.getResult = async (req, res) => {
  try {
    const result = await Result.findOne({
      where: { id: req.params.resultId },
      include: [
        { model: User, as: 'student', attributes: ['name','rollNo'] },
        { model: Test, as: 'test', include: [{ model: Question, as: 'questions', through: { attributes: [] } }] },
      ],
    });
    if (!result) { req.flash('error','Not found.'); return res.redirect('/student/dashboard'); }
    const viewer = req.session.user;
    if (viewer.role === 'student' && result.studentId !== viewer.id) { req.flash('error','Access denied.'); return res.redirect('/student/dashboard'); }

    const topperResult = await Result.findOne({ where: { testId: result.testId, rank: 1 }, attributes: ['score','subjectScores'] });
    const trend = await Result.findAll({
      where: { studentId: result.studentId, status: { [Op.in]: ['submitted','auto_submitted'] } },
      include: [{ model: Test, as: 'test', attributes: ['title'] }],
      order: [['submittedAt','ASC']], limit: 10,
    });
    const totalAttempted = await Result.count({
      where: { testId: result.testId, status: { [Op.in]: ['submitted','auto_submitted'] } },
    });

    const percentage = result.totalMarks > 0
      ? parseFloat(((result.score / result.totalMarks) * 100).toFixed(1))
      : 0;

    res.render('exam/result', {
      title: 'Exam Result', result,
      percentage, topperResult, trend, totalAttempted,
    });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/student/dashboard'); }
};

// ── PDF ───────────────────────────────────────────────────────────────────────
exports.downloadResultPDF = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const result = await Result.findOne({
      where: { id: req.params.resultId },
      include: [
        { model: User, as: 'student', attributes: ['name','rollNo'] },
        { model: Test, as: 'test', attributes: ['title','totalMarks','duration'] },
      ],
    });
    if (!result) return res.status(404).send('Not found');
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename=result_${result.id}.pdf`);
    doc.pipe(res);
    doc.fontSize(18).font('Helvetica-Bold').text(process.env.COLLEGE_NAME || 'College', { align:'center' });
    doc.fontSize(13).font('Helvetica').text('CET Examination — Result Card', { align:'center' });
    doc.moveDown().moveTo(50,doc.y).lineTo(550,doc.y).stroke().moveDown();
    doc.font('Helvetica-Bold').text('Student Details');
    doc.font('Helvetica').text(`Name: ${result.student.name}`).text(`Roll No: ${result.student.rollNo}`).text(`Test: ${result.test.title}`).text(`Date: ${new Date(result.submittedAt).toLocaleDateString('en-IN')}`).moveDown();
    doc.font('Helvetica-Bold').text('Score Summary');
    doc.font('Helvetica')
      .text(`Score: ${result.score} / ${result.totalMarks}`)
      .text(`Percentage: ${result.totalMarks>0?((result.score/result.totalMarks)*100).toFixed(1):0}%`)
      .text(`Rank: ${result.rank||'N/A'}`)
      .text(`Correct: ${result.correctAnswers}  Wrong: ${result.wrongAnswers}  Skipped: ${result.skippedAnswers}`)
      .text(`Time Taken: ${Math.floor((result.timeTaken||0)/60)}m ${(result.timeTaken||0)%60}s`).moveDown();
    if (result.subjectScores) {
      doc.font('Helvetica-Bold').text('Subject-wise Breakdown');
      doc.font('Helvetica');
      Object.entries(result.subjectScores).forEach(([subj,data]) => {
        doc.text(`${subj}: ${data.marks||0}/${data.total||0} marks (C:${data.correct} W:${data.wrong} S:${data.skipped})`);
      });
    }
    doc.end();
  } catch (e) { res.status(500).send('PDF generation failed'); }
};

// ── LEADERBOARD ───────────────────────────────────────────────────────────────
exports.getLeaderboard = async (req, res) => {
  try {
    const { testId } = req.params;
    const test = await Test.findByPk(testId);
    if (!test) { req.flash('error','Not found.'); return res.redirect('/student/dashboard'); }
    const results = await Result.findAll({
      where: { testId, status: { [Op.in]: ['submitted','auto_submitted'] } },
      include: [{ model: User, as: 'student', attributes: ['name','rollNo'] }],
      order: [['score','DESC'],['timeTaken','ASC']], limit: 50,
    });
    res.render('exam/leaderboard', { title: `Leaderboard — ${test.title}`, test, results });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/student/dashboard'); }
};
