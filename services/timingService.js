const TIMING_MODES = ['PERSONAL_DURATION','FIXED_WINDOW','UNTIMED'];

function timingModeOf(test) {
  return TIMING_MODES.includes(test?.timingMode) ? test.timingMode : 'PERSONAL_DURATION';
}

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timingInput({ timingMode, duration, startTime, endTime }) {
  const mode = TIMING_MODES.includes(timingMode) ? timingMode : 'PERSONAL_DURATION';
  const start = validDate(startTime);
  const end = validDate(endTime);
  if (startTime && !start) throw new Error('Test start time is invalid.');
  if (endTime && !end) throw new Error('Test end time is invalid.');
  if (start && end && end <= start) throw new Error('Test end time must be after start time.');
  if (mode === 'FIXED_WINDOW' && (!start || !end)) {
    throw new Error('Fixed-window tests require both a start and end time.');
  }
  if (mode === 'UNTIMED') return { timingMode:mode, duration:null, startTime:start, endTime:end };
  if (mode === 'FIXED_WINDOW') {
    return { timingMode:mode, duration:Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60000)), startTime:start, endTime:end };
  }
  const minutes = Number(duration);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error('Duration must be between 1 and 1440 minutes.');
  }
  return { timingMode:mode, duration:Math.round(minutes), startTime:start, endTime:end };
}

function availabilityFor(test, { now = new Date(), hasInProgressAttempt = false } = {}) {
  const current = validDate(now) || new Date();
  const start = validDate(test?.startTime);
  const end = validDate(test?.endTime);
  const mode = timingModeOf(test);
  if (start && current < start) {
    return { state:'upcoming', canStart:false, canResume:false, message:`This test opens at ${start.toISOString()}.` };
  }
  if (end && current >= end) {
    if (hasInProgressAttempt && mode !== 'FIXED_WINDOW') {
      return { state:'in_progress', canStart:false, canResume:true, message:'Resume your existing attempt.' };
    }
    return { state:'expired', canStart:false, canResume:false, message:'This test window has closed.' };
  }
  return {
    state:hasInProgressAttempt ? 'in_progress' : 'available',
    canStart:!hasInProgressAttempt,
    canResume:hasInProgressAttempt,
    message:hasInProgressAttempt ? 'Resume your existing attempt.' : 'Test is available.',
  };
}

function deadlineForAttempt(test, startedAt) {
  const mode = timingModeOf(test);
  if (mode === 'UNTIMED') return null;
  if (mode === 'FIXED_WINDOW') {
    const end = validDate(test.endTime);
    if (!end) throw new Error('Fixed-window test is missing its end time.');
    return end;
  }
  const start = validDate(startedAt);
  if (!start) throw new Error('Attempt start time is invalid.');
  return new Date(start.getTime() + (Number(test.duration) || 180) * 60 * 1000);
}

function deadlineForResult(test, result) {
  const stored = validDate(result?.deadlineAt);
  if (stored) return stored;
  return deadlineForAttempt(test, result?.startedAt);
}

function remainingSeconds(test, result, now = new Date()) {
  if (timingModeOf(test) === 'UNTIMED') return null;
  const deadline = deadlineForResult(test, result);
  const current = validDate(now);
  if (!current) throw new Error('Current time is invalid.');
  return Math.max(0, Math.ceil((deadline.getTime() - current.getTime()) / 1000));
}

function timingLabel(test) {
  const mode = timingModeOf(test);
  if (mode === 'UNTIMED') return 'No time limit';
  if (mode === 'FIXED_WINDOW') return 'Fixed window';
  return `${test.duration} min personal duration`;
}

module.exports = {
  TIMING_MODES,
  availabilityFor,
  deadlineForAttempt,
  deadlineForResult,
  remainingSeconds,
  timingInput,
  timingLabel,
  timingModeOf,
  validDate,
};
