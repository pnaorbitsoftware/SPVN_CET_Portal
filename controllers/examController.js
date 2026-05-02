// controllers/examController.js — Enhanced with all anti-cheat + analytics features
const { Test, Question, TestQuestion, Result, GroupMember, TestGroup, User } = require('../models');
const { Op } = require('sequelize');

const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };

// ── INSTRUCTIONS ─────────────────────────────────────────────────────────────
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
  } catch (e) { req.flash('error','Failed.'); res.redirect('/student/tests'); }
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

    let result = await Result.findOne({ where: { studentId, testId, status: 'in_progress' } });
    if (!result) {
      const submitted = await Result.findOne({ where: { studentId, testId, status: { [Op.in]: ['submitted','auto_submitted'] } } });
      if (submitted) { req.flash('info','Already submitted.'); return res.redirect(`/results/${submitted.id}`); }
      result = await Result.create({
        studentId, testId, score: 0, totalMarks: test.totalMarks,
        answers: {}, questionTimings: {}, cheatingFlags: { tabSwitches:0, fullscreenExits:0, focusLosses:0 },
        violationCount: 0, status: 'in_progress', startedAt: new Date(),
      });
    }

    let questions = test.questions;
    if (test.shuffleQuestions) questions = shuffle(questions);

    req.session.examSession = req.session.examSession || {};
    req.session.examSession[testId] = {
      resultId: result.id,
      questionOrder: questions.map(q => q.id),
      startedAt: result.startedAt,
      markedForReview: [],
      questionStartTimes: {},
    };
    res.redirect(`/exam/${testId}/question/1`);
  } catch (e) { req.flash('error','Failed to start.'); res.redirect('/student/tests'); }
};

// ── GET QUESTION ──────────────────────────────────────────────────────────────
exports.getQuestion = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId, qNum } = req.params;
    const questionNumber = parseInt(qNum);
    const examSession = req.session.examSession?.[testId];
    if (!examSession) return res.redirect(`/exam/${testId}/instructions`);

    const result = await Result.findOne({ where: { id: examSession.resultId, studentId, status: 'in_progress' } });
    if (!result) { req.flash('error','Session expired.'); return res.redirect('/student/tests'); }

    const test = await Test.findByPk(testId);
    const startedAt = new Date(result.startedAt);
    const remaining = Math.max(0, Math.floor((test.duration*60*1000 - (Date.now()-startedAt.getTime()))/1000));
    if (remaining <= 0) return res.redirect(`/exam/${testId}/auto-submit`);

    const questionIds = examSession.questionOrder;
    const totalQuestions = questionIds.length;
    if (questionNumber < 1 || questionNumber > totalQuestions) return res.redirect(`/exam/${testId}/question/1`);

    const currentQuestionId = questionIds[questionNumber - 1];
    const question = await Question.findByPk(currentQuestionId);

    let options = [
      { key:'A', value: question.optionA, image: question.optionAImage },
      { key:'B', value: question.optionB, image: question.optionBImage },
      { key:'C', value: question.optionC, image: question.optionCImage },
      { key:'D', value: question.optionD, image: question.optionDImage },
    ];
    if (test.shuffleOptions) options = shuffle(options);

    const answers = result.answers || {};
    const markedForReview = examSession.markedForReview || [];

    const paletteStatus = questionIds.map((qId, idx) => {
      const num = idx+1;
      const answered = answers[qId]?.answer != null;
      const marked = markedForReview.includes(String(qId));
      let status = 'not-visited';
      if (answered && marked) status = 'answered-marked';
      else if (answered) status = 'answered';
      else if (marked) status = 'marked';
      else if (num < questionNumber) status = 'not-answered';
      return { num, qId, status };
    });

    // Record when this question was opened (for time tracking)
    examSession.questionStartTimes[currentQuestionId] = Date.now();

    res.render('exam/question', {
      title: `Q${questionNumber} — ${test.title}`,
      test, question, options, questionNumber, totalQuestions,
      remaining, paletteStatus,
      selectedAnswer: answers[currentQuestionId]?.answer || null,
      isMarked: markedForReview.includes(String(currentQuestionId)),
      resultId: result.id,
      violations: result.violationCount || 0,
    });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/student/tests'); }
};

// ── SAVE ANSWER (AJAX) ────────────────────────────────────────────────────────
exports.saveAnswer = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const { questionId, answer, markForReview, timeSpent } = req.body;
    const examSession = req.session.examSession?.[testId];
    if (!examSession) return res.json({ success: false, message: 'Session expired' });

    const result = await Result.findOne({ where: { id: examSession.resultId, studentId, status: 'in_progress' } });
    if (!result) return res.json({ success: false });

    const answers = result.answers || {};
    const questionTimings = result.questionTimings || {};

    // Save answer with metadata
    if (answer) {
      answers[questionId] = { answer, savedAt: new Date() };
    } else {
      delete answers[questionId];
    }

    // Save time spent on this question
    if (timeSpent && !isNaN(timeSpent)) {
      questionTimings[questionId] = (questionTimings[questionId] || 0) + parseInt(timeSpent);
    }

    await result.update({ answers, questionTimings });

    // Mark for review in session
    examSession.markedForReview = examSession.markedForReview || [];
    if (markForReview === 'true' || markForReview === true) {
      if (!examSession.markedForReview.includes(String(questionId))) examSession.markedForReview.push(String(questionId));
    } else {
      examSession.markedForReview = examSession.markedForReview.filter(id => id !== String(questionId));
    }

    return res.json({ success: true, answeredCount: Object.keys(answers).length });
  } catch (e) { return res.json({ success: false }); }
};

// ── REPORT VIOLATION (AJAX) ───────────────────────────────────────────────────
exports.reportViolation = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const { type } = req.body; // 'tabSwitch' | 'fullscreenExit' | 'focusLoss'
    const examSession = req.session.examSession?.[testId];
    if (!examSession) return res.json({ success: false });

    const result = await Result.findOne({ where: { id: examSession.resultId, studentId, status: 'in_progress' } });
    if (!result) return res.json({ success: false });

    const flags = result.cheatingFlags || { tabSwitches:0, fullscreenExits:0, focusLosses:0 };
    if (type === 'tabSwitch') flags.tabSwitches++;
    else if (type === 'fullscreenExit') flags.fullscreenExits++;
    else if (type === 'focusLoss') flags.focusLosses++;

    const violations = (flags.tabSwitches||0) + (flags.fullscreenExits||0) + (flags.focusLosses||0);
    await result.update({ cheatingFlags: flags, violationCount: violations });

    return res.json({ success: true, violations, flags });
  } catch (e) { return res.json({ success: false }); }
};

// ── SUBMIT ────────────────────────────────────────────────────────────────────
exports.submitExam = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const isAutoSubmit = req.body.auto === 'true';
    const examSession = req.session.examSession?.[testId];
    if (!examSession) return res.redirect('/student/tests');

    const result = await Result.findOne({ where: { id: examSession.resultId, studentId, status: 'in_progress' } });
    if (!result) return res.redirect('/student/tests');

    const test = await Test.findByPk(testId, { include: [{ model: Question, as: 'questions', through: { attributes: [] } }] });
    const answers = result.answers || {};

    let score = 0, correct = 0, wrong = 0, skipped = 0;
    const subjectScores = {}, topicScores = {};

    for (const question of test.questions) {
      const subj = question.subject;
      const topic = question.topic || 'General';
      if (!subjectScores[subj]) subjectScores[subj] = { correct:0, wrong:0, skipped:0, marks:0, total: 0 };
      if (!topicScores[topic]) topicScores[topic] = { correct:0, wrong:0, skipped:0 };
      subjectScores[subj].total += question.marks;

      const given = answers[question.id]?.answer;
      if (!given) {
        skipped++; subjectScores[subj].skipped++; topicScores[topic].skipped++;
      } else if (given === question.correctAnswer) {
        score += question.marks; correct++;
        subjectScores[subj].correct++; subjectScores[subj].marks += question.marks;
        topicScores[topic].correct++;
      } else {
        score -= (test.negativeMarking||0); wrong++;
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
    if (req.session.examSession) delete req.session.examSession[testId];
    return res.redirect(`/results/${result.id}`);
  } catch (e) { console.error(e); req.flash('error','Submit failed.'); res.redirect('/student/tests'); }
};

exports.autoSubmit = async (req, res) => { req.body = { auto: 'true' }; return exports.submitExam(req, res); };

async function updateRanks(testId) {
  const results = await Result.findAll({
    where: { testId, status: { [Op.in]: ['submitted','auto_submitted'] } },
    order: [['score','DESC'],['timeTaken','ASC']],
  });
  for (let i=0; i<results.length; i++) {
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

    const totalAttempted = await Result.count({ where: { testId: result.testId, status: { [Op.in]: ['submitted','auto_submitted'] } } });
    const topperResult = await Result.findOne({ where: { testId: result.testId, rank: 1 }, attributes: ['score','subjectScores'] });

    // Build performance trend (last 5 results for this student)
    const trend = await Result.findAll({
      where: { studentId: result.studentId, status: { [Op.in]: ['submitted','auto_submitted'] } },
      include: [{ model: Test, as: 'test', attributes: ['title'] }],
      order: [['submittedAt','ASC']], limit: 10,
    });

    res.render('exam/result', {
      title: 'Exam Result', result, totalAttempted,
      percentage: ((result.score/result.totalMarks)*100).toFixed(1),
      topperResult, trend,
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
        { model: Test, as: 'test', attributes: ['title','totalMarks','duration'] },
      ],
    });
    if (!result) return res.status(404).send('Not found');
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename=result_${result.id}.pdf`);
    doc.pipe(res);
    doc.fontSize(18).font('Helvetica-Bold').text(process.env.COLLEGE_NAME, { align: 'center' });
    doc.fontSize(13).font('Helvetica').text('CET Examination — Result Card', { align: 'center' });
    doc.moveDown().moveTo(50,doc.y).lineTo(550,doc.y).stroke().moveDown();
    doc.fontSize(11).font('Helvetica-Bold').text('Student Details');
    doc.font('Helvetica').text(`Name: ${result.student.name}`).text(`Roll No: ${result.student.rollNo}`).text(`Test: ${result.test.title}`).text(`Date: ${new Date(result.submittedAt).toLocaleDateString('en-IN')}`).moveDown();
    doc.font('Helvetica-Bold').text('Score Summary');
    doc.font('Helvetica').text(`Score: ${result.score} / ${result.totalMarks}`).text(`Percentage: ${((result.score/result.totalMarks)*100).toFixed(1)}%`).text(`Rank: ${result.rank||'N/A'}`).text(`Correct: ${result.correctAnswers}  Wrong: ${result.wrongAnswers}  Skipped: ${result.skippedAnswers}`).text(`Time: ${Math.floor(result.timeTaken/60)}m ${result.timeTaken%60}s`).moveDown();
    if (result.subjectScores) {
      doc.font('Helvetica-Bold').text('Subject-wise Breakdown');
      doc.font('Helvetica');
      Object.entries(result.subjectScores).forEach(([subj, data]) => {
        doc.text(`${subj}: ${data.marks||0}/${data.total||0} marks (✅${data.correct} ❌${data.wrong} ⏭${data.skipped})`);
      });
    }
    doc.fontSize(9).text(process.env.PDF_FOOTER||'', { align: 'center' });
    doc.end();
  } catch (e) { res.status(500).send('PDF failed'); }
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
