const test = require('node:test');
const assert = require('node:assert/strict');

const {
  availabilityFor,
  deadlineForAttempt,
  remainingSeconds,
  timingInput,
  timingLabel,
  timingModeOf,
} = require('../services/timingService');

const at = value => new Date(value);

test('legacy tests default to personal-duration timing', () => {
  const legacy = { duration:180 };
  assert.equal(timingModeOf(legacy), 'PERSONAL_DURATION');
  assert.equal(timingLabel(legacy), '180 min personal duration');
});

test('timing input validates personal, fixed-window and untimed modes', () => {
  assert.throws(() => timingInput({ timingMode:'PERSONAL_DURATION', duration:0 }), /between 1 and 1440/);
  assert.throws(() => timingInput({ timingMode:'FIXED_WINDOW', startTime:'2026-08-24T10:00:00Z' }), /require both/);
  assert.throws(() => timingInput({ timingMode:'FIXED_WINDOW', startTime:'2026-08-24T12:00:00Z', endTime:'2026-08-24T10:00:00Z' }), /after start/);

  const fixed = timingInput({ timingMode:'FIXED_WINDOW', duration:999, startTime:'2026-08-24T10:00:00Z', endTime:'2026-08-24T13:00:00Z' });
  assert.equal(fixed.duration, 180);
  assert.equal(fixed.timingMode, 'FIXED_WINDOW');

  const untimed = timingInput({ timingMode:'UNTIMED', duration:180 });
  assert.equal(untimed.duration, null);
  assert.equal(timingLabel(untimed), 'No time limit');
});

test('availability enforces access windows and preserves eligible attempt continuation', () => {
  const window = { timingMode:'PERSONAL_DURATION', duration:180, startTime:at('2026-08-24T10:00:00Z'), endTime:at('2026-08-24T18:00:00Z') };
  assert.equal(availabilityFor(window, { now:at('2026-08-24T09:59:59Z') }).state, 'upcoming');
  assert.equal(availabilityFor(window, { now:at('2026-08-24T12:00:00Z') }).canStart, true);
  assert.equal(availabilityFor(window, { now:at('2026-08-24T18:00:00Z') }).state, 'expired');
  assert.equal(availabilityFor(window, { now:at('2026-08-24T18:00:00Z'), hasInProgressAttempt:true }).canResume, true);

  const fixed = { ...window, timingMode:'FIXED_WINDOW' };
  const expiredAttempt = availabilityFor(fixed, { now:at('2026-08-24T18:00:00Z'), hasInProgressAttempt:true });
  assert.equal(expiredAttempt.state, 'expired');
  assert.equal(expiredAttempt.canResume, false);
});

test('deadlines remain stable across refresh and fixed-window starts get only remaining window time', () => {
  const personal = { timingMode:'PERSONAL_DURATION', duration:180 };
  const startedAt = at('2026-08-24T10:00:00Z');
  assert.equal(deadlineForAttempt(personal, startedAt).toISOString(), '2026-08-24T13:00:00.000Z');
  assert.equal(remainingSeconds(personal, { startedAt, deadlineAt:at('2026-08-24T12:00:00Z') }, at('2026-08-24T11:30:00Z')), 1800);

  const fixed = { timingMode:'FIXED_WINDOW', startTime:at('2026-08-24T10:00:00Z'), endTime:at('2026-08-24T13:00:00Z') };
  assert.equal(deadlineForAttempt(fixed, at('2026-08-24T12:40:00Z')).toISOString(), '2026-08-24T13:00:00.000Z');
  assert.equal(remainingSeconds(fixed, { startedAt:at('2026-08-24T12:40:00Z') }, at('2026-08-24T12:40:00Z')), 1200);
  assert.equal(remainingSeconds({ timingMode:'UNTIMED' }, { startedAt }, at('2026-08-25T10:00:00Z')), null);
});
