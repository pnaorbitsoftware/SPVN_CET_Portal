const { hasSubmittedAnswer, normalizeSubmittedAnswer } = require('./questionService');
const { effectiveQuestionConfig } = require('./testConfigurationService');
const { isCetSectionTest } = require('../utils/cetExam');

function round(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function setsEqual(left, right) {
  return left.length === right.length && left.every(value => right.includes(value));
}

function correctOptions(question) {
  if (question.questionType === 'MULTIPLE_CORRECT') return [...new Set(question.correctAnswers || [])].sort();
  return question.correctAnswer ? [question.correctAnswer] : [];
}

function numericalIsCorrect(question, answer) {
  if (!Number.isFinite(answer)) return false;
  const expected = question.numericalAnswer || {};
  if (Number.isFinite(expected.min) && Number.isFinite(expected.max)
      && answer >= expected.min && answer <= expected.max) return true;
  if (!Number.isFinite(expected.value)) return false;
  return Math.abs(answer - expected.value) <= Math.max(0, Number(expected.tolerance) || 0);
}

function scoreQuestion(question, rawAnswer, config) {
  const effective = effectiveQuestionConfig(null, question, config);
  const maxScore = effective.bonus ? effective.bonusMarks : effective.positiveMarks;
  if (effective.bonus) {
    return { status:'bonus', awarded:round(effective.bonusMarks), maxScore:round(maxScore), answer:rawAnswer ?? null };
  }

  const type = question.questionType || 'SINGLE_CORRECT';
  let answer;
  try {
    answer = normalizeSubmittedAnswer(rawAnswer, type);
  } catch {
    answer = null;
  }
  if (!hasSubmittedAnswer(answer)) {
    return { status:'skipped', awarded:0, maxScore:round(maxScore), answer:null };
  }

  let correct = false;
  if (type === 'NUMERICAL') correct = numericalIsCorrect(question, answer);
  else if (type === 'MULTIPLE_CORRECT') correct = setsEqual(answer, correctOptions(question));
  else correct = answer === question.correctAnswer;

  if (correct) {
    return { status:'correct', awarded:round(effective.positiveMarks), maxScore:round(maxScore), answer };
  }

  if (type === 'MULTIPLE_CORRECT') {
    const expected = correctOptions(question);
    const hasIncorrectSelection = answer.some(value => !expected.includes(value));
    const isCorrectSubset = answer.length > 0 && !hasIncorrectSelection && answer.every(value => expected.includes(value));
    if (isCorrectSubset && effective.markingMode !== 'FULL_OR_ZERO') {
      const partial = effective.markingMode === 'PER_CORRECT_OPTION'
        ? effective.positiveMarks * (answer.length / Math.max(expected.length, 1))
        : effective.partialMarks;
      if (partial > 0) return { status:'partial', awarded:round(Math.min(partial, effective.positiveMarks)), maxScore:round(maxScore), answer };
    }
    if (hasIncorrectSelection && effective.incorrectSelectionPolicy === 'ZERO') {
      return { status:'incorrect', awarded:0, maxScore:round(maxScore), answer };
    }
  }

  return { status:'incorrect', awarded:round(-effective.negativeMarks), maxScore:round(maxScore), answer };
}

function scoreTest({ test, questions = [], answers = {}, floorAtZero = true }) {
  const subjectScores = {};
  const topicScores = {};
  const perQuestionScore = {};
  const counters = { correct:0, incorrect:0, partial:0, skipped:0, bonus:0 };
  let rawScore = 0;
  let fullMaxScore = 0;

  for (const question of questions) {
    const questionId = String(question._id || question.id);
    const config = effectiveQuestionConfig(test, question);
    const saved = answers[questionId];
    const rawAnswer = saved && typeof saved === 'object' && !Array.isArray(saved)
      && Object.prototype.hasOwnProperty.call(saved, 'answer') ? saved.answer : saved;
    const scored = scoreQuestion(question, rawAnswer, config);
    const subject = question.subject || 'General';
    const topic = question.topic || 'General';
    subjectScores[subject] ||= { correct:0, wrong:0, partial:0, skipped:0, bonus:0, marks:0, total:0, attempted:false, status:'NOT_ATTEMPTED' };
    topicScores[topic] ||= { correct:0, wrong:0, partial:0, skipped:0, bonus:0, marks:0, total:0 };
    subjectScores[subject].total += scored.maxScore;
    topicScores[topic].total += scored.maxScore;
    subjectScores[subject].marks += scored.awarded;
    topicScores[topic].marks += scored.awarded;
    if (scored.status !== 'skipped' && scored.status !== 'bonus') {
      subjectScores[subject].attempted = true;
      subjectScores[subject].status = 'ATTEMPTED';
    }
    if (scored.status === 'correct') { subjectScores[subject].correct += 1; topicScores[topic].correct += 1; }
    if (scored.status === 'incorrect') { subjectScores[subject].wrong += 1; topicScores[topic].wrong += 1; }
    if (scored.status === 'partial') { subjectScores[subject].partial += 1; topicScores[topic].partial += 1; }
    if (scored.status === 'skipped') { subjectScores[subject].skipped += 1; topicScores[topic].skipped += 1; }
    if (scored.status === 'bonus') { subjectScores[subject].bonus += 1; topicScores[topic].bonus += 1; }
    counters[scored.status] += 1;
    rawScore += scored.awarded;
    fullMaxScore += scored.maxScore;
    perQuestionScore[questionId] = { ...scored, config };
  }

  const cetSectionFlow = isCetSectionTest(test, questions);
  const attemptedSubjects = [];
  const absentSubjects = [];
  let attemptedMaxScore = 0;
  Object.entries(subjectScores).forEach(([subject, data]) => {
    data.marks = round(data.marks);
    data.total = round(data.total);
    if (cetSectionFlow && !data.attempted && data.bonus === 0) {
      data.status = 'ABSENT';
      absentSubjects.push(subject);
      return;
    }
    if (data.attempted || data.bonus > 0) attemptedSubjects.push(subject);
    attemptedMaxScore += data.total;
  });
  Object.values(topicScores).forEach(data => {
    data.marks = round(data.marks);
    data.total = round(data.total);
  });

  return {
    score:round(floorAtZero ? Math.max(0, rawScore) : rawScore),
    rawScore:round(rawScore),
    maxScore:round(cetSectionFlow ? attemptedMaxScore : fullMaxScore),
    fullMaxScore:round(fullMaxScore),
    correct:counters.correct,
    incorrect:counters.incorrect,
    partial:counters.partial,
    skipped:counters.skipped,
    bonus:counters.bonus,
    perQuestionScore,
    subjectScores,
    topicScores,
    attemptedSubjects,
    absentSubjects,
  };
}

module.exports = { numericalIsCorrect, scoreQuestion, scoreTest };
