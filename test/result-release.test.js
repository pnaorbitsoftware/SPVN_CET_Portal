const test = require('node:test');
const assert = require('node:assert/strict');

const { releaseConfiguration, releaseModeOf, resultAvailability, safeSubmission } = require('../services/resultReleaseService');

const at = value => new Date(value);

test('legacy tests release results immediately', () => {
  assert.equal(releaseModeOf({}), 'IMMEDIATE');
  assert.equal(resultAvailability({}, at('2026-08-24T10:00:00Z')).available, true);
});

test('release configuration validates end-based and scheduled modes', () => {
  assert.throws(() => releaseConfiguration({ resultReleaseMode:'AFTER_TEST_END' }), /requires a test end time/);
  assert.throws(() => releaseConfiguration({ resultReleaseMode:'SCHEDULED' }), /requires a release date/);
  assert.throws(() => releaseConfiguration({ resultReleaseMode:'SCHEDULED', resultReleaseAt:'not-a-date' }), /invalid/);

  assert.deepEqual(releaseConfiguration({ resultReleaseMode:'IMMEDIATE' }), {
    resultReleaseMode:'IMMEDIATE', resultReleaseAt:null, resultsReleased:true,
  });
  assert.equal(releaseConfiguration({ resultReleaseMode:'MANUAL' }).resultsReleased, false);
});

test('after-end, scheduled and manual result availability cannot be bypassed by time assumptions', () => {
  const before = at('2026-08-24T12:59:59Z');
  const after = at('2026-08-24T13:00:00Z');
  const afterEnd = { resultReleaseMode:'AFTER_TEST_END', endTime:after, resultsReleased:false };
  assert.equal(resultAvailability(afterEnd, before).available, false);
  assert.equal(resultAvailability(afterEnd, after).available, true);

  const scheduled = { resultReleaseMode:'SCHEDULED', resultReleaseAt:after, resultsReleased:false };
  assert.equal(resultAvailability(scheduled, before).available, false);
  assert.equal(resultAvailability(scheduled, after).available, true);
  assert.equal(resultAvailability({ resultReleaseMode:'MANUAL', resultsReleased:false }, after).available, false);
  assert.equal(resultAvailability({ resultReleaseMode:'MANUAL', resultsReleased:true }, before).available, true);
});

test('editing preserves an explicit release only when the mode stays unchanged', () => {
  const existing = { resultReleaseMode:'MANUAL', resultsReleased:true };
  assert.equal(releaseConfiguration({ resultReleaseMode:'MANUAL', existingTest:existing }).resultsReleased, true);
  assert.equal(releaseConfiguration({ resultReleaseMode:'SCHEDULED', resultReleaseAt:'2026-09-01T10:00:00Z', existingTest:existing }).resultsReleased, false);
});

test('editing cannot re-hide a result already released automatically in the same mode', () => {
  const existing = { resultReleaseMode:'SCHEDULED', resultReleaseAt:'2020-01-01T00:00:00Z', resultsReleased:false };
  const edited = releaseConfiguration({ resultReleaseMode:'SCHEDULED', resultReleaseAt:'2030-01-01T00:00:00Z', existingTest:existing });
  assert.equal(edited.resultsReleased, true);
});

test('safe submission payload excludes all marks, rank and answers', () => {
  const payload = safeSubmission({ _id:'r1', score:99, rank:1, answers:{ q1:'A' }, status:'submitted', submittedAt:at('2026-08-24T10:00:00Z') }, { _id:'t1', title:'Protected Result' });
  assert.equal(payload.testTitle, 'Protected Result');
  assert.equal('score' in payload, false);
  assert.equal('answers' in payload, false);
});
