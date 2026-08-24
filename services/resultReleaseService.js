const RESULT_RELEASE_MODES = ['IMMEDIATE','AFTER_TEST_END','SCHEDULED','MANUAL'];

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function releaseModeOf(test) {
  return RESULT_RELEASE_MODES.includes(test?.resultReleaseMode) ? test.resultReleaseMode : 'IMMEDIATE';
}

function releaseConfiguration({ resultReleaseMode, resultReleaseAt, endTime, existingTest = null }) {
  const mode = RESULT_RELEASE_MODES.includes(resultReleaseMode) ? resultReleaseMode : 'IMMEDIATE';
  const releaseAt = validDate(resultReleaseAt);
  if (resultReleaseAt && !releaseAt) throw new Error('Result release time is invalid.');
  if (mode === 'AFTER_TEST_END' && !validDate(endTime)) throw new Error('After-test-end result release requires a test end time.');
  if (mode === 'SCHEDULED' && !releaseAt) throw new Error('Scheduled result release requires a release date and time.');

  const previousMode = existingTest ? releaseModeOf(existingTest) : null;
  const preserveRelease = Boolean(existingTest && previousMode === mode && resultAvailability(existingTest).available);
  return {
    resultReleaseMode:mode,
    resultReleaseAt:mode === 'SCHEDULED' ? releaseAt : null,
    resultsReleased:mode === 'IMMEDIATE' ? true : preserveRelease,
  };
}

function resultAvailability(test, now = new Date()) {
  const mode = releaseModeOf(test);
  const current = validDate(now);
  if (!current) throw new Error('Current time is invalid.');
  if (test?.resultsReleased === true || mode === 'IMMEDIATE') {
    return { available:true, mode, releaseAt:null, message:'Result is available.' };
  }
  if (mode === 'AFTER_TEST_END') {
    const end = validDate(test?.endTime);
    const available = Boolean(end && current >= end);
    return { available, mode, releaseAt:end, message:available ? 'Result is available.' : end ? `Result will be available after ${end.toISOString()}.` : 'Result release is awaiting a configured test end time.' };
  }
  if (mode === 'SCHEDULED') {
    const releaseAt = validDate(test?.resultReleaseAt);
    const available = Boolean(releaseAt && current >= releaseAt);
    return { available, mode, releaseAt, message:available ? 'Result is available.' : releaseAt ? `Result is scheduled for ${releaseAt.toISOString()}.` : 'Result release has not been scheduled.' };
  }
  return { available:false, mode, releaseAt:null, message:'Result will be available after the administrator releases it.' };
}

function releaseLabel(test) {
  const state = resultAvailability(test);
  if (state.available) return 'Available';
  if (state.mode === 'AFTER_TEST_END') return 'After test end';
  if (state.mode === 'SCHEDULED') return state.releaseAt ? `Scheduled ${state.releaseAt.toLocaleString('en-IN')}` : 'Scheduled';
  return 'Manual release';
}

function safeSubmission(result, test = result?.testId) {
  return {
    id:String(result?._id || result?.id || ''),
    testId:String(test?._id || test?.id || result?.testId || ''),
    testTitle:test?.title || 'Exam',
    status:result?.status || 'submitted',
    submittedAt:result?.submittedAt || null,
  };
}

module.exports = {
  RESULT_RELEASE_MODES,
  releaseConfiguration,
  releaseLabel,
  releaseModeOf,
  resultAvailability,
  safeSubmission,
  validDate,
};
