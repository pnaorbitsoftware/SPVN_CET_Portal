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
        { model: User, as: 'student', attributes: ['name','rollNo','email'] },
        { model: Test, as: 'test', include: [{ model: Question, as: 'questions', through: { attributes: [] } }] },
      ],
    });
    if (!result) return res.status(404).send('Not found');

    // Build ordered question list using persisted questionOrder
    const questionMap = {};
    (result.test.questions || []).forEach(q => { questionMap[q.id] = q; });
    const orderedIds = result.questionOrder && result.questionOrder.length
      ? result.questionOrder
      : Object.keys(questionMap).map(Number);
    const questions = orderedIds.map(id => questionMap[id]).filter(Boolean);
    const answers = result.answers || {};

    const COLLEGE = process.env.COLLEGE_NAME || 'College';
    const pct = result.totalMarks > 0 ? ((result.score / result.totalMarks) * 100).toFixed(1) : '0.0';

    const doc = new PDFDocument({ margin: 45, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=result_${result.id}.pdf`);
    doc.pipe(res);

    // ── Helper: safe text (strip HTML tags) ──────────────────────────────────
    const safe = str => (str || '').replace(/<[^>]*>/g, '').trim();

    // ── Header ───────────────────────────────────────────────────────────────
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e293b')
       .text(COLLEGE, { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#64748b')
       .text('CET Examination — Detailed Result Card', { align: 'center' });
    doc.moveDown(0.3);
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.5);

    // ── Student Info Table ───────────────────────────────────────────────────
    const infoY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#475569').text('STUDENT DETAILS', 45, infoY);
    doc.moveDown(0.3);
    const info = [
      ['Name', result.student.name],
      ['Roll No', result.student.rollNo || '—'],
      ['Test', result.test.title],
      ['Date', result.submittedAt ? new Date(result.submittedAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'],
      ['Duration', `${result.test.duration || '—'} min`],
      ['Time Taken', `${Math.floor((result.timeTaken||0)/60)}m ${(result.timeTaken||0)%60}s`],
    ];
    info.forEach(([label, val]) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#64748b').text(`${label}:`, 45, doc.y, { continued: true, width: 80 });
      doc.font('Helvetica').fillColor('#1e293b').text(` ${val}`);
    });

    doc.moveDown(0.5);
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.5);

    // ── Score Summary Box ────────────────────────────────────────────────────
    const boxY = doc.y;
    doc.rect(45, boxY, 505, 68).fillColor('#f8fafc').fill();
    doc.rect(45, boxY, 505, 68).strokeColor('#e2e8f0').stroke();

    const cols = [
      { label: 'Score', value: `${result.score} / ${result.totalMarks}` },
      { label: 'Percentage', value: `${pct}%` },
      { label: 'Rank', value: `#${result.rank || '—'}` },
      { label: 'Correct', value: String(result.correctAnswers || 0) },
      { label: 'Wrong', value: String(result.wrongAnswers || 0) },
      { label: 'Skipped', value: String(result.skippedAnswers || 0) },
    ];
    const colW = 505 / cols.length;
    cols.forEach((c, i) => {
      const cx = 45 + i * colW;
      doc.fontSize(14).font('Helvetica-Bold')
         .fillColor(c.label==='Correct'?'#16a34a':c.label==='Wrong'?'#dc2626':c.label==='Skipped'?'#d97706':'#1e293b')
         .text(c.value, cx, boxY + 12, { width: colW, align: 'center' });
      doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
         .text(c.label, cx, boxY + 48, { width: colW, align: 'center' });
    });
    doc.moveDown(0.3);
    doc.y = boxY + 78;

    // ── Subject-wise Breakdown ───────────────────────────────────────────────
    if (result.subjectScores && Object.keys(result.subjectScores).length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#475569').text('SUBJECT-WISE BREAKDOWN', 45);
      doc.moveDown(0.3);
      const hY = doc.y;
      doc.rect(45, hY, 505, 16).fillColor('#1e293b').fill();
      ['Subject','Marks','Correct','Wrong','Skipped','%'].forEach((h, i) => {
        const ws = [180,65,65,65,65,65];
        const xs = [45, 225, 290, 355, 420, 485];
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff')
           .text(h, xs[i], hY+4, { width: ws[i], align: i===0?'left':'center' });
      });
      doc.y = hY + 18;
      let rowAlt = false;
      Object.entries(result.subjectScores).forEach(([subj, data]) => {
        const rY = doc.y;
        if (rowAlt) doc.rect(45, rY, 505, 16).fillColor('#f8fafc').fill();
        rowAlt = !rowAlt;
        const spct = data.total > 0 ? ((data.marks||0)/data.total*100).toFixed(0) : 0;
        const xs = [45, 225, 290, 355, 420, 485];
        const ws = [175, 65, 65, 65, 65, 60];
        const vals = [subj, `${data.marks||0}/${data.total||0}`, data.correct||0, data.wrong||0, data.skipped||0, `${spct}%`];
        vals.forEach((v, i) => {
          doc.fontSize(8).font('Helvetica').fillColor('#1e293b')
             .text(String(v), xs[i], rY+4, { width: ws[i], align: i===0?'left':'center' });
        });
        doc.y = rY + 18;
      });
      doc.moveDown(0.5);
    }

    // ── Question-by-Question Answer Sheet ────────────────────────────────────
    doc.addPage();
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e293b')
       .text('QUESTION-BY-QUESTION ANSWER SHEET', { align: 'center' });
    doc.fontSize(8).font('Helvetica').fillColor('#64748b')
       .text(`${result.test.title}  ·  ${result.student.name}  ·  ${result.student.rollNo || ''}`, { align: 'center' });
    doc.moveDown(0.5);

    // Legend
    const legendY = doc.y;
    [['#16a34a','● Correct'], ['#dc2626','● Wrong'], ['#d97706','○ Skipped']].forEach(([color, label], i) => {
      doc.fontSize(8).font('Helvetica').fillColor(color).text(label, 45 + i * 100, legendY);
    });
    doc.moveDown(0.6);

    questions.forEach((q, idx) => {
      const ans = answers[q.id];
      const given = ans?.answer || null;
      const correct = q.correctAnswer;
      const isCorrect = given && given === correct;
      const isWrong = given && given !== correct;
      const isSkipped = !given;

      const statusColor = isCorrect ? '#16a34a' : isWrong ? '#dc2626' : '#d97706';
      const statusLabel = isCorrect ? '✓ Correct' : isWrong ? '✗ Wrong' : '○ Skipped';
      const bgColor = isCorrect ? '#f0fdf4' : isWrong ? '#fff1f2' : '#fffbeb';
      const borderColor = isCorrect ? '#86efac' : isWrong ? '#fca5a5' : '#fcd34d';

      // Check if new page needed
      if (doc.y > 700) doc.addPage();

      const qY = doc.y;
      const optMap = { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD };
      const optLines = Object.entries(optMap).map(([k,v]) => `${k}) ${safe(v)}`);
      const bodyText = safe(q.question);

      // Estimate height
      const textHeight = Math.ceil(bodyText.length / 85) * 12 + optLines.length * 11 + 18 + (q.explanation ? 20 : 0);
      const boxH = Math.max(textHeight, 50);

      if (doc.y + boxH > 750) doc.addPage();
      const qY2 = doc.y;

      // Box background
      doc.rect(45, qY2, 505, boxH).fillColor(bgColor).fill();
      doc.rect(45, qY2, 505, boxH).strokeColor(borderColor).lineWidth(0.5).stroke();
      doc.lineWidth(1);

      // Q number + status
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b')
         .text(`Q${idx + 1}.`, 52, qY2 + 5, { continued: true });
      doc.font('Helvetica').fillColor('#1e293b')
         .text(` ${bodyText}`, { width: 390 });

      // Status badge (top right)
      doc.fontSize(8).font('Helvetica-Bold').fillColor(statusColor)
         .text(statusLabel, 430, qY2 + 5, { width: 110, align: 'right' });

      // Options
      doc.moveDown(0.1);
      optLines.forEach(opt => {
        const key = opt[0];
        const isAnswered = given === key;
        const isCorrectOpt = correct === key;
        const optColor = isCorrectOpt ? '#16a34a' : (isAnswered && !isCorrectOpt) ? '#dc2626' : '#475569';
        const fontWeight = (isAnswered || isCorrectOpt) ? 'Helvetica-Bold' : 'Helvetica';
        doc.fontSize(8).font(fontWeight).fillColor(optColor)
           .text(`  ${opt}`, 58, doc.y, { width: 460 });
      });

      // Correct answer + student answer line
      doc.moveDown(0.15);
      const ansY = doc.y;
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#16a34a')
         .text(`Correct: ${correct}) ${safe(optMap[correct])}`, 58, ansY, { width: 220 });
      if (given) {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(isCorrect ? '#16a34a' : '#dc2626')
           .text(`Your Answer: ${given}) ${safe(optMap[given])}`, 280, ansY, { width: 260 });
      } else {
        doc.fontSize(7.5).font('Helvetica').fillColor('#d97706')
           .text('Your Answer: Not Attempted', 280, ansY, { width: 260 });
      }

      // Explanation if any
      if (q.explanation) {
        doc.moveDown(0.15);
        doc.fontSize(7).font('Helvetica').fillColor('#475569')
           .text(`Explanation: ${safe(q.explanation)}`, 58, doc.y, { width: 460 });
      }

      doc.y = qY2 + boxH + 5;
    });

    // ── Footer on each page ──────────────────────────────────────────────────
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
         .text(`${COLLEGE}  ·  Generated ${new Date().toLocaleString('en-IN')}  ·  Page ${i+1} of ${totalPages}`,
           45, 820, { width: 505, align: 'center' });
    }

    doc.end();
  } catch (e) { console.error('PDF error:', e); res.status(500).send('PDF generation failed: ' + e.message); }
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
