const { Result, ResultRecalculation } = require('../models');
const { scoreTest } = require('./scoringService');
const { updateRanks } = require('./rankingService');

const COMPLETED_STATUS = { $in:['submitted','auto_submitted'] };
const CHANGE_AUDIT_LIMIT = 500;

function validateRecalculationRequest({ reason, confirmation } = {}) {
  const cleanReason = String(reason || '').replace(/\s+/g, ' ').trim();
  if (cleanReason.length < 10) throw new Error('Enter a reason of at least 10 characters.');
  if (cleanReason.length > 1000) throw new Error('Reason cannot exceed 1000 characters.');
  if (String(confirmation || '').trim() !== 'RECALCULATE') {
    throw new Error('Type RECALCULATE exactly to confirm.');
  }
  return { reason:cleanReason };
}

function round(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function resultSummary(results = []) {
  const count = results.length;
  const scores = results.map(result => Number(result.score) || 0);
  const percentages = results.map(result => {
    const total = Number(result.totalMarks) || 0;
    return total > 0 ? ((Number(result.score) || 0) / total) * 100 : 0;
  });
  return {
    count,
    averageScore:count ? round(scores.reduce((sum, value) => sum + value, 0) / count) : 0,
    averagePercentage:count ? round(percentages.reduce((sum, value) => sum + value, 0) / count) : 0,
    highestScore:count ? round(Math.max(...scores)) : 0,
    lowestScore:count ? round(Math.min(...scores)) : 0,
  };
}

function scoringUpdate(scoring, recalculatedAt) {
  return {
    score:scoring.score,
    totalMarks:scoring.maxScore,
    fullTotalMarks:scoring.fullMaxScore,
    correctAnswers:scoring.correct,
    wrongAnswers:scoring.incorrect,
    partialAnswers:scoring.partial,
    skippedAnswers:scoring.skipped,
    bonusAnswers:scoring.bonus,
    subjectScores:scoring.subjectScores,
    topicScores:scoring.topicScores,
    perQuestionScore:scoring.perQuestionScore,
    attemptedSubjects:scoring.attemptedSubjects,
    absentSubjects:scoring.absentSubjects,
    scoringVersion:'2.0',
    recalculatedAt,
  };
}

function auditChange(before, after) {
  const change = {
    resultId:String(before._id),
    studentId:String(before.studentId),
    score:{ before:before.score, after:after.score },
    totalMarks:{ before:before.totalMarks, after:after.totalMarks },
    rank:{ before:before.rank, after:after.rank },
    percentile:{ before:before.percentile, after:after.percentile },
  };
  const changed = Object.entries(change).some(([key, value]) => (
    !['resultId','studentId'].includes(key) && value.before !== value.after
  ));
  return changed ? change : null;
}

async function recalculateTestResults({ test, initiatedBy, organization = null, reason, now = new Date() }) {
  if (!test?._id) throw new Error('Test is required.');
  if (!initiatedBy) throw new Error('Initiating admin is required.');

  let audit;
  try {
    audit = await ResultRecalculation.create({
      organization,
      testId:test._id,
      initiatedBy,
      reason,
      status:'RUNNING',
      startedAt:now,
    });
  } catch (error) {
    if (error?.code === 11000) throw new Error('A recalculation is already running for this test.');
    throw error;
  }

  try {
    const before = await Result.find({ testId:test._id, status:COMPLETED_STATUS }).lean();
    const questions = test.questions || [];
    const operations = before.map(result => {
      const scoring = scoreTest({ test, questions, answers:result.answers || {} });
      return {
        updateOne:{
          filter:{ _id:result._id, status:COMPLETED_STATUS },
          update:{ $set:scoringUpdate(scoring, now) },
        },
      };
    });
    if (operations.length) await Result.bulkWrite(operations, { ordered:true });
    await updateRanks(test._id);

    const after = await Result.find({ testId:test._id, status:COMPLETED_STATUS }).lean();
    const afterById = new Map(after.map(result => [String(result._id), result]));
    const allChanges = before
      .map(result => auditChange(result, afterById.get(String(result._id)) || result))
      .filter(Boolean);
    audit.status = 'COMPLETED';
    audit.affectedResults = before.length;
    audit.changedResults = allChanges.length;
    audit.beforeSummary = resultSummary(before);
    audit.afterSummary = resultSummary(after);
    audit.changes = allChanges.slice(0, CHANGE_AUDIT_LIMIT);
    audit.changesTruncated = allChanges.length > CHANGE_AUDIT_LIMIT;
    audit.completedAt = new Date();
    await audit.save();
    return audit;
  } catch (error) {
    audit.status = 'FAILED';
    audit.completedAt = new Date();
    audit.error = String(error.message || error).slice(0, 2000);
    await audit.save().catch(() => {});
    throw error;
  }
}

module.exports = {
  CHANGE_AUDIT_LIMIT,
  auditChange,
  recalculateTestResults,
  resultSummary,
  scoringUpdate,
  validateRecalculationRequest,
};
