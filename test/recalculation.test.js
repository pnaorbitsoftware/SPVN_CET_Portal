const test = require('node:test');
const assert = require('node:assert/strict');
const {
  auditChange,
  resultSummary,
  scoringUpdate,
  validateRecalculationRequest,
} = require('../services/recalculationService');

test('recalculation requires an explicit confirmation and meaningful reason', () => {
  assert.deepEqual(
    validateRecalculationRequest({ reason:'  Corrected   answer key for Q12  ', confirmation:'RECALCULATE' }),
    { reason:'Corrected answer key for Q12' }
  );
  assert.throws(() => validateRecalculationRequest({ reason:'too short', confirmation:'RECALCULATE' }), /at least 10/);
  assert.throws(() => validateRecalculationRequest({ reason:'Corrected answer key', confirmation:'yes' }), /RECALCULATE exactly/);
});

test('result summary reports stable score and percentage aggregates', () => {
  assert.deepEqual(resultSummary([
    { score:8, totalMarks:10 },
    { score:12, totalMarks:20 },
  ]), { count:2, averageScore:10, averagePercentage:70, highestScore:12, lowestScore:8 });
  assert.deepEqual(resultSummary([]), { count:0, averageScore:0, averagePercentage:0, highestScore:0, lowestScore:0 });
});

test('scoring update only contains derived result fields', () => {
  const now = new Date('2026-08-24T10:00:00Z');
  const update = scoringUpdate({
    score:4, maxScore:5, fullMaxScore:5, correct:1, incorrect:0, partial:0,
    skipped:0, bonus:0, subjectScores:{}, topicScores:{}, perQuestionScore:{},
    attemptedSubjects:['Physics'], absentSubjects:[],
  }, now);
  assert.equal(update.score, 4);
  assert.equal(update.recalculatedAt, now);
  assert.equal(update.scoringVersion, '2.0');
  assert.equal(Object.hasOwn(update, 'answers'), false);
  assert.equal(Object.hasOwn(update, 'submittedAt'), false);
  assert.equal(Object.hasOwn(update, 'timeTaken'), false);
});

test('audit change records score and rank differences but omits unchanged rows', () => {
  const before = { _id:'r1', studentId:'s1', score:2, totalMarks:4, rank:2, percentile:50 };
  assert.equal(auditChange(before, { ...before }), null);
  const change = auditChange(before, { ...before, score:4, rank:1, percentile:100 });
  assert.deepEqual(change.score, { before:2, after:4 });
  assert.deepEqual(change.rank, { before:2, after:1 });
});
