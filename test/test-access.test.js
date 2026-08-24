const test = require('node:test');
const assert = require('node:assert/strict');

const {
  accessConfiguration,
  grantSessionAccess,
  issueAccessGrant,
  resultHasAccess,
  sessionHasAccess,
  validateAccessAttempt,
  verifyAccessGrant,
} = require('../services/testAccessService');

test('test access configuration hashes secrets and preserves or removes an existing hash safely', async () => {
  const now = new Date('2026-08-24T10:00:00Z');
  const enabled = await accessConfiguration({ enabled:true, password:'2580', now });
  assert.equal(enabled.testAccessEnabled, true);
  assert.notEqual(enabled.testAccessHash, '2580');
  assert.equal(enabled.testAccessUpdatedAt, now);

  const preserved = await accessConfiguration({ enabled:true, password:'', existingHash:enabled.testAccessHash, existingUpdatedAt:now });
  assert.equal(preserved.testAccessHash, enabled.testAccessHash);
  assert.equal(preserved.testAccessUpdatedAt.toISOString(), now.toISOString());

  const disabled = await accessConfiguration({ enabled:false, existingHash:enabled.testAccessHash });
  assert.deepEqual(disabled, { testAccessEnabled:false, testAccessHash:null, testAccessUpdatedAt:null });
  await assert.rejects(() => accessConfiguration({ enabled:true, password:'12' }), /4 to 64/);
});

test('invalid access attempts are rate-limited and a valid password clears failures', async () => {
  const configured = await accessConfiguration({ enabled:true, password:'safe-pin' });
  const base = new Date('2026-08-24T10:00:00Z');
  for (let index = 0; index < 4; index += 1) {
    const invalid = await validateAccessAttempt({ userId:'student-1', testId:'test-1', password:'wrong', passwordHash:configured.testAccessHash, now:base });
    assert.equal(invalid.code, 'INVALID_PASSWORD');
  }
  const blocked = await validateAccessAttempt({ userId:'student-1', testId:'test-1', password:'wrong', passwordHash:configured.testAccessHash, now:base });
  assert.equal(blocked.code, 'RATE_LIMITED');
  assert.ok(blocked.retryAfterSeconds > 0);

  const later = new Date(base.getTime() + 11 * 60 * 1000);
  const valid = await validateAccessAttempt({ userId:'student-1', testId:'test-1', password:'safe-pin', passwordHash:configured.testAccessHash, now:later });
  assert.equal(valid.ok, true);
});

test('session, result and signed mobile grants are bound to the current password version', async () => {
  const testRow = { _id:'test-2', testAccessEnabled:true, testAccessUpdatedAt:new Date('2026-08-24T10:00:00Z') };
  const req = { session:{} };
  assert.equal(sessionHasAccess(req, testRow), false);
  grantSessionAccess(req, testRow);
  assert.equal(sessionHasAccess(req, testRow), true);
  assert.equal(resultHasAccess(testRow, { accessVersion:testRow.testAccessUpdatedAt }), true);

  const secret = 'unit-test-secret';
  const token = issueAccessGrant({ userId:'student-2', test:testRow, secret });
  assert.equal(verifyAccessGrant({ token, userId:'student-2', test:testRow, secret }), true);
  assert.equal(verifyAccessGrant({ token, userId:'another-student', test:testRow, secret }), false);

  testRow.testAccessUpdatedAt = new Date('2026-08-24T11:00:00Z');
  assert.equal(sessionHasAccess(req, testRow), false);
  assert.equal(resultHasAccess(testRow, { accessVersion:new Date('2026-08-24T10:00:00Z') }), false);
  assert.equal(verifyAccessGrant({ token, userId:'student-2', test:testRow, secret }), false);
});
