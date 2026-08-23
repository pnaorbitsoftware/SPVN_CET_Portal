const test = require('node:test');
const assert = require('node:assert/strict');

const { Group, Organization } = require('../models');
const { settingsUpdateFrom } = require('../controllers/organizationController')._private;
const { dateInputValue, parseDateOnly, validateDateRange } = require('../utils/validation');

test('legacy batch documents remain valid without organization or dates', async () => {
  const group = new Group({ name: 'Legacy Batch', course: 'CET' });
  await group.validate();
  assert.equal(group.organization, null);
  assert.equal(group.startDate, null);
  assert.equal(group.endDate, null);
});

test('batch schema rejects an end date before its start date', async () => {
  const group = new Group({
    name: 'Invalid Batch',
    startDate: new Date('2026-08-10T00:00:00.000Z'),
    endDate: new Date('2026-08-09T00:00:00.000Z'),
  });
  await assert.rejects(group.validate(), /end date must be on or after/i);
});

test('date-only parsing is deterministic and validates calendar dates', () => {
  const parsed = parseDateOnly('2026-08-24', 'Batch start date');
  assert.equal(parsed.toISOString(), '2026-08-24T00:00:00.000Z');
  assert.equal(dateInputValue(parsed), '2026-08-24');
  assert.throws(() => parseDateOnly('2026-02-30'), /invalid/i);
  assert.throws(
    () => validateDateRange(parsed, new Date('2026-08-23T00:00:00.000Z')),
    /must be on or after/i
  );
});

test('organization schema applies safe backward-compatible defaults', async () => {
  const organization = new Organization({
    organizationName: 'Test College',
    organizationCode: 'test_college',
  });
  await organization.validate();
  assert.equal(organization.organizationCode, 'TEST_COLLEGE');
  assert.equal(organization.status, 'active');
  assert.equal(organization.settings.examDefaults.timingMode, 'PERSONAL_DURATION');
  assert.equal(organization.settings.resultDefaults.releaseMode, 'IMMEDIATE');
});

test('organization settings input is bounded and allow-listed', () => {
  const update = settingsUpdateFrom({
    academicYear: '2026-27',
    defaultCourses: ['CET', 'UNKNOWN'],
    defaultDuration: '99999',
    defaultTimingMode: 'UNTIMED',
    defaultNegativeMarking: '-2',
    defaultReleaseMode: 'MANUAL',
    primaryColor: 'not-a-color',
    accentColor: '#123abc',
  });
  assert.deepEqual(update['settings.academicDefaults.courses'], ['CET']);
  assert.equal(update['settings.examDefaults.duration'], 1440);
  assert.equal(update['settings.examDefaults.timingMode'], 'UNTIMED');
  assert.equal(update['settings.examDefaults.negativeMarking'], 0);
  assert.equal(update['settings.resultDefaults.releaseMode'], 'MANUAL');
  assert.equal(update['settings.branding.primaryColor'], '#131330');
  assert.equal(update['settings.branding.accentColor'], '#123abc');
});
