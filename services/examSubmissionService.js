const { Result } = require('../models');
const { scoreTest } = require('./scoringService');
const { updateRanks } = require('./rankingService');

async function finalizeAttempt({ result, test, isAutoSubmit = false, now = new Date(), recalculation = false }) {
  const questions = test.questions || [];
  const scoring = scoreTest({ test, questions, answers:result.answers || {} });
  const startedAt = result.startedAt ? new Date(result.startedAt) : now;
  const timeTaken = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  const update = {
    score:scoring.score,
    totalMarks:scoring.maxScore,
    fullTotalMarks:scoring.fullMaxScore,
    correctAnswers:scoring.correct,
    wrongAnswers:scoring.incorrect,
    partialAnswers:scoring.partial,
    skippedAnswers:scoring.skipped,
    bonusAnswers:scoring.bonus,
    timeTaken,
    subjectScores:scoring.subjectScores,
    topicScores:scoring.topicScores,
    perQuestionScore:scoring.perQuestionScore,
    attemptedSubjects:scoring.attemptedSubjects,
    absentSubjects:scoring.absentSubjects,
    scoringVersion:'2.0',
  };
  if (recalculation) {
    update.recalculatedAt = now;
  } else {
    update.status = isAutoSubmit ? 'auto_submitted' : 'submitted';
    update.submittedAt = now;
    update.lastActivityAt = now;
  }
  await Result.updateOne({ _id:result._id }, update);
  await updateRanks(test._id || test.id);
  return Result.findById(result._id);
}

module.exports = { finalizeAttempt };
