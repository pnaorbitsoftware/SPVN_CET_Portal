// controllers/examController.js
// Core exam engine: start, save answers, submit, auto-submit

const { Test, Question, TestQuestion, Result, GroupMember, TestGroup, User } = require('../models');
const { Op } = require('sequelize');

/**
 * Shuffle array (Fisher-Yates)
 */
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * GET /exam/:testId/instructions
 */
exports.getInstructions = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;

    const test = await Test.findOne({
      where: { id: testId, status: { [Op.in]: ['published', 'active'] } },
      include: [{ model: Question, as: 'questions', through: { attributes: [] } }],
    });

    if (!test) {
      req.flash('error', 'Test not found or not available.');
      return res.redirect('/student/tests');
    }

    // Check if student already attempted
    const existingResult = await Result.findOne({
      where: { studentId, testId, status: { [Op.in]: ['submitted', 'auto_submitted'] } },
    });

    if (existingResult) {
      req.flash('info', 'You have already submitted this test.');
      return res.redirect(`/results/${existingResult.id}`);
    }

    // Check if in_progress (resume)
    const inProgress = await Result.findOne({
      where: { studentId, testId, status: 'in_progress' },
    });

    res.render('exam/instructions', {
      title: `${test.title} — Instructions`,
      test,
      questionCount: test.questions.length,
      inProgress: !!inProgress,
    });
  } catch (error) {
    console.error('Exam instructions error:', error);
    req.flash('error', 'Failed to load exam.');
    res.redirect('/student/tests');
  }
};

/**
 * POST /exam/:testId/start
 */
exports.startExam = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;

    const test = await Test.findOne({
      where: { id: testId, status: { [Op.in]: ['published', 'active'] } },
      include: [{
        model: Question,
        as: 'questions',
        through: { attributes: ['orderIndex'] },
      }],
    });

    if (!test) {
      req.flash('error', 'Test not available.');
      return res.redirect('/student/tests');
    }

    // Check existing in_progress
    let result = await Result.findOne({ where: { studentId, testId, status: 'in_progress' } });

    if (!result) {
      // Check already submitted
      const submitted = await Result.findOne({
        where: { studentId, testId, status: { [Op.in]: ['submitted', 'auto_submitted'] } },
      });
      if (submitted) {
        req.flash('info', 'You have already submitted this exam.');
        return res.redirect(`/results/${submitted.id}`);
      }

      result = await Result.create({
        studentId,
        testId,
        score: 0,
        totalMarks: test.totalMarks,
        answers: {},
        status: 'in_progress',
        startedAt: new Date(),
      });
    }

    // Shuffle questions if enabled
    let questions = test.questions;
    if (test.shuffleQuestions) {
      questions = shuffle(questions);
    }

    // Store question order in session for this exam
    req.session.examSession = req.session.examSession || {};
    req.session.examSession[testId] = {
      resultId: result.id,
      questionOrder: questions.map(q => q.id),
      startedAt: result.startedAt,
    };

    res.redirect(`/exam/${testId}/question/1`);
  } catch (error) {
    console.error('Start exam error:', error);
    req.flash('error', 'Failed to start exam.');
    res.redirect('/student/tests');
  }
};

/**
 * GET /exam/:testId/question/:qNum
 */
exports.getQuestion = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId, qNum } = req.params;
    const questionNumber = parseInt(qNum);

    const examSession = req.session.examSession?.[testId];
    if (!examSession) {
      return res.redirect(`/exam/${testId}/instructions`);
    }

    const result = await Result.findOne({ where: { id: examSession.resultId, studentId, status: 'in_progress' } });
    if (!result) {
      req.flash('error', 'Exam session expired or already submitted.');
      return res.redirect('/student/tests');
    }

    const test = await Test.findByPk(testId);

    // Calculate time remaining
    const startedAt = new Date(result.startedAt);
    const durationMs = test.duration * 60 * 1000;
    const elapsed = Date.now() - startedAt.getTime();
    const remaining = Math.max(0, Math.floor((durationMs - elapsed) / 1000));

    if (remaining <= 0) {
      // Auto-submit
      return res.redirect(`/exam/${testId}/auto-submit`);
    }

    const questionIds = examSession.questionOrder;
    const totalQuestions = questionIds.length;

    if (questionNumber < 1 || questionNumber > totalQuestions) {
      return res.redirect(`/exam/${testId}/question/1`);
    }

    const currentQuestionId = questionIds[questionNumber - 1];
    const question = await Question.findByPk(currentQuestionId);

    // Shuffle options if enabled
    let options = [
      { key: 'A', value: question.optionA },
      { key: 'B', value: question.optionB },
      { key: 'C', value: question.optionC },
      { key: 'D', value: question.optionD },
    ];

    if (test.shuffleOptions) {
      options = shuffle(options);
    }

    const answers = result.answers || {};
    const markedForReview = req.session.examSession[testId].markedForReview || [];

    // Build question palette status
    const paletteStatus = questionIds.map((qId, idx) => {
      const num = idx + 1;
      const answered = answers[qId] != null;
      const marked = markedForReview.includes(qId);
      let status = 'not-visited';
      if (answered && marked) status = 'answered-marked';
      else if (answered) status = 'answered';
      else if (marked) status = 'marked';
      else if (num < questionNumber) status = 'not-answered';
      return { num, qId, status };
    });

    res.render('exam/question', {
      title: `Question ${questionNumber} — ${test.title}`,
      test,
      question,
      options,
      questionNumber,
      totalQuestions,
      remaining,
      paletteStatus,
      selectedAnswer: answers[currentQuestionId] || null,
      isMarked: markedForReview.includes(currentQuestionId),
      resultId: result.id,
    });
  } catch (error) {
    console.error('Get question error:', error);
    req.flash('error', 'Failed to load question.');
    res.redirect('/student/tests');
  }
};

/**
 * POST /exam/:testId/save-answer (AJAX)
 */
exports.saveAnswer = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const { questionId, answer, markForReview } = req.body;

    const examSession = req.session.examSession?.[testId];
    if (!examSession) return res.json({ success: false, message: 'Session expired' });

    const result = await Result.findOne({ where: { id: examSession.resultId, studentId, status: 'in_progress' } });
    if (!result) return res.json({ success: false, message: 'Result not found' });

    // Update answers
    const answers = result.answers || {};
    if (answer) {
      answers[questionId] = answer;
    } else {
      delete answers[questionId]; // Clear answer
    }

    await result.update({ answers });

    // Handle mark for review in session
    if (!req.session.examSession[testId].markedForReview) {
      req.session.examSession[testId].markedForReview = [];
    }
    const mfr = req.session.examSession[testId].markedForReview;
    if (markForReview === 'true') {
      if (!mfr.includes(String(questionId))) mfr.push(String(questionId));
    } else {
      req.session.examSession[testId].markedForReview = mfr.filter(id => id !== String(questionId));
    }

    return res.json({ success: true, answeredCount: Object.keys(answers).length });
  } catch (error) {
    console.error('Save answer error:', error);
    return res.json({ success: false, message: 'Failed to save answer' });
  }
};

/**
 * POST /exam/:testId/submit
 */
exports.submitExam = async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { testId } = req.params;
    const isAutoSubmit = req.body.auto === 'true';

    const examSession = req.session.examSession?.[testId];
    if (!examSession) return res.redirect('/student/tests');

    const result = await Result.findOne({ where: { id: examSession.resultId, studentId, status: 'in_progress' } });
    if (!result) return res.redirect('/student/tests');

    const test = await Test.findByPk(testId, {
      include: [{ model: Question, as: 'questions', through: { attributes: [] } }],
    });

    const answers = result.answers || {};
    let score = 0, correct = 0, wrong = 0, skipped = 0;

    for (const question of test.questions) {
      const given = answers[question.id];
      if (!given) {
        skipped++;
      } else if (given === question.correctAnswer) {
        score += question.marks;
        correct++;
      } else {
        score -= (test.negativeMarking || 0);
        wrong++;
      }
    }

    score = Math.max(0, parseFloat(score.toFixed(2)));
    const timeTaken = Math.floor((Date.now() - new Date(result.startedAt).getTime()) / 1000);

    await result.update({
      score,
      totalMarks: test.totalMarks,
      correctAnswers: correct,
      wrongAnswers: wrong,
      skippedAnswers: skipped,
      timeTaken,
      status: isAutoSubmit ? 'auto_submitted' : 'submitted',
      submittedAt: new Date(),
    });

    // Calculate ranks for this test
    await updateRanks(testId);

    // Clear exam session
    if (req.session.examSession) {
      delete req.session.examSession[testId];
    }

    return res.redirect(`/results/${result.id}`);
  } catch (error) {
    console.error('Submit exam error:', error);
    req.flash('error', 'Failed to submit exam.');
    res.redirect('/student/tests');
  }
};

/**
 * GET /exam/:testId/auto-submit
 */
exports.autoSubmit = async (req, res) => {
  req.body = { auto: 'true' };
  return exports.submitExam(req, res);
};

/**
 * Recalculate ranks after submission
 */
async function updateRanks(testId) {
  const results = await Result.findAll({
    where: { testId, status: { [Op.in]: ['submitted', 'auto_submitted'] } },
    order: [['score', 'DESC'], ['timeTaken', 'ASC']],
  });

  for (let i = 0; i < results.length; i++) {
    const percentile = ((results.length - i) / results.length) * 100;
    await results[i].update({ rank: i + 1, percentile: parseFloat(percentile.toFixed(2)) });
  }
}

/**
 * GET /results/:resultId
 */
exports.getResult = async (req, res) => {
  try {
    const result = await Result.findOne({
      where: { id: req.params.resultId },
      include: [
        { model: User, as: 'student', attributes: ['name', 'rollNo'] },
        {
          model: Test, as: 'test',
          include: [{ model: Question, as: 'questions', through: { attributes: [] } }],
        },
      ],
    });

    if (!result) {
      req.flash('error', 'Result not found.');
      return res.redirect('/student/dashboard');
    }

    // Only student themselves or teacher/admin can view
    const viewer = req.session.user;
    if (viewer.role === 'student' && result.studentId !== viewer.id) {
      req.flash('error', 'Access denied.');
      return res.redirect('/student/dashboard');
    }

    // Total students who took the test
    const totalAttempted = await Result.count({
      where: { testId: result.testId, status: { [Op.in]: ['submitted', 'auto_submitted'] } },
    });

    res.render('exam/result', {
      title: 'Exam Result',
      result,
      totalAttempted,
      percentage: ((result.score / result.totalMarks) * 100).toFixed(1),
    });
  } catch (error) {
    console.error('Get result error:', error);
    req.flash('error', 'Failed to load result.');
    res.redirect('/student/dashboard');
  }
};

/**
 * GET /results/:resultId/pdf  — export result as PDF
 */
exports.downloadResultPDF = async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const result = await Result.findOne({
      where: { id: req.params.resultId },
      include: [
        { model: User, as: 'student', attributes: ['name', 'rollNo', 'email'] },
        { model: Test, as: 'test', attributes: ['title', 'totalMarks', 'duration'] },
      ],
    });

    if (!result) return res.status(404).send('Result not found');

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=result_${result.id}.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text(process.env.COLLEGE_NAME, { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('CET Online Examination — Result Card', { align: 'center' });
    doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Student Info
    doc.fontSize(12).font('Helvetica-Bold').text('Student Details');
    doc.font('Helvetica')
      .text(`Name: ${result.student.name}`)
      .text(`Roll No: ${result.student.rollNo}`)
      .text(`Test: ${result.test.title}`)
      .text(`Date: ${new Date(result.submittedAt).toLocaleDateString('en-IN')}`)
      .moveDown();

    // Score
    doc.font('Helvetica-Bold').text('Score Summary');
    doc.font('Helvetica')
      .text(`Total Score: ${result.score} / ${result.totalMarks}`)
      .text(`Percentage: ${((result.score / result.totalMarks) * 100).toFixed(1)}%`)
      .text(`Rank: ${result.rank || 'N/A'}`)
      .text(`Correct: ${result.correctAnswers}  |  Wrong: ${result.wrongAnswers}  |  Skipped: ${result.skippedAnswers}`)
      .text(`Time Taken: ${Math.floor(result.timeTaken / 60)} min ${result.timeTaken % 60} sec`)
      .moveDown();

    // Footer
    doc.fontSize(9).text(process.env.PDF_FOOTER, { align: 'center' });
    doc.end();
  } catch (error) {
    console.error('PDF error:', error);
    res.status(500).send('Failed to generate PDF');
  }
};

/**
 * GET /results/leaderboard/:testId
 */
exports.getLeaderboard = async (req, res) => {
  try {
    const { testId } = req.params;
    const test = await Test.findByPk(testId);
    if (!test) { req.flash('error', 'Test not found.'); return res.redirect('/student/dashboard'); }

    const results = await Result.findAll({
      where: { testId, status: { [Op.in]: ['submitted', 'auto_submitted'] } },
      include: [{ model: User, as: 'student', attributes: ['name', 'rollNo'] }],
      order: [['score', 'DESC'], ['timeTaken', 'ASC']],
      limit: 50,
    });

    res.render('exam/leaderboard', { title: `Leaderboard — ${test.title}`, test, results });
  } catch (error) {
    req.flash('error', 'Failed to load leaderboard.');
    res.redirect('/student/dashboard');
  }
};
