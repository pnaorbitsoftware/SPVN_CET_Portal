function idOf(value) {
  return String(value?._id || value?.id || value || '');
}

function answeredCount(result) {
  return Object.values(result?.answers || {}).filter(saved => {
    const answer = saved && typeof saved === 'object' && Object.hasOwn(saved, 'answer') ? saved.answer : saved;
    return Array.isArray(answer) ? answer.length > 0 : answer !== null && answer !== undefined && answer !== '';
  }).length;
}

function buildLiveMonitor({ tests = [], groups = [], students = [], memberships = [], results = [], selectedTestId = '', now = new Date(), activeWithinSeconds = 120 }) {
  const studentById = new Map(students.map(student => [idOf(student),student]));
  const groupById = new Map(groups.map(group => [idOf(group),group]));
  const memberIdsByGroup = new Map();
  memberships.forEach(membership => {
    const groupId = idOf(membership.groupId);
    const studentId = idOf(membership.userId);
    if (!studentById.has(studentId)) return;
    if (!memberIdsByGroup.has(groupId)) memberIdsByGroup.set(groupId,new Set());
    memberIdsByGroup.get(groupId).add(studentId);
  });
  const latestResultByPair = new Map();
  [...results].sort((left,right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0)).forEach(result => {
    const key = `${idOf(result.testId)}:${idOf(result.studentId)}`;
    if (!latestResultByPair.has(key)) latestResultByPair.set(key,result);
  });

  const summaries = tests.map(test => {
    const testId = idOf(test);
    const groupIds = (test.groups || []).map(idOf);
    const scheduledIds = new Set();
    groupIds.forEach(groupId => (memberIdsByGroup.get(groupId) || []).forEach(studentId => scheduledIds.add(studentId)));
    const attempts = [...scheduledIds].map(studentId => latestResultByPair.get(`${testId}:${studentId}`)).filter(Boolean);
    const inProgress = attempts.filter(result => result.status === 'in_progress');
    const active = inProgress.filter(result => result.lastActivityAt && (now - new Date(result.lastActivityAt)) / 1000 <= activeWithinSeconds);
    const submitted = attempts.filter(result => ['submitted','auto_submitted'].includes(result.status));
    const autoSubmitted = attempts.filter(result => result.status === 'auto_submitted');
    const progressValues = attempts.map(result => {
      if (['submitted','auto_submitted'].includes(result.status)) return 100;
      const total = result.questionOrder?.length || test.questions?.length || 0;
      return total ? (answeredCount(result) / total) * 100 : 0;
    });
    return {
      testId,
      title:test.title,
      status:test.status,
      batchNames:groupIds.map(groupId => groupById.get(groupId)?.name).filter(Boolean),
      scheduled:scheduledIds.size,
      started:attempts.length,
      currentlyActive:active.length,
      inProgress:inProgress.length,
      submitted:submitted.length,
      autoSubmitted:autoSubmitted.length,
      notStarted:Math.max(0,scheduledIds.size-attempts.length),
      averageProgress:Math.round((progressValues.length ? progressValues.reduce((sum,value) => sum+value,0)/progressValues.length : 0)*10)/10,
      violationCount:attempts.reduce((sum,result) => sum + Number(result.violationCount || 0),0),
      startTime:test.startTime || null,
      endTime:test.endTime || null,
      scheduledIds,
    };
  });
  const chosen = summaries.find(summary => summary.testId === selectedTestId) || summaries.find(summary => summary.inProgress > 0) || summaries[0] || null;
  const chosenTest = chosen ? tests.find(test => idOf(test) === chosen.testId) : null;
  const studentRows = chosen && chosenTest ? [...chosen.scheduledIds].map(studentId => {
    const student = studentById.get(studentId);
    const result = latestResultByPair.get(`${chosen.testId}:${studentId}`);
    const totalQuestions = result?.questionOrder?.length || chosenTest.questions?.length || 0;
    const answered = result ? answeredCount(result) : 0;
    const submitted = ['submitted','auto_submitted'].includes(result?.status);
    const progress = submitted ? 100 : totalQuestions ? Math.round((answered/totalQuestions)*1000)/10 : 0;
    const lastActivitySeconds = result?.lastActivityAt ? Math.max(0,Math.floor((now-new Date(result.lastActivityAt))/1000)) : null;
    return {
      studentId,
      name:student?.name || 'Unknown student',
      rollNo:student?.rollNo || '',
      batchNames:(memberships.filter(item => idOf(item.userId)===studentId && (chosenTest.groups||[]).map(idOf).includes(idOf(item.groupId))).map(item => groupById.get(idOf(item.groupId))?.name).filter(Boolean)),
      resultId:result ? idOf(result) : null,
      status:result?.status || 'not_started',
      startedAt:result?.startedAt || null,
      elapsedSeconds:result?.startedAt ? Math.max(0,Math.floor((now-new Date(result.startedAt))/1000)) : 0,
      lastActivityAt:result?.lastActivityAt || null,
      lastActivitySeconds,
      currentlyActive:Boolean(result?.status==='in_progress' && lastActivitySeconds !== null && lastActivitySeconds <= activeWithinSeconds),
      answered,
      remaining:Math.max(0,totalQuestions-answered),
      totalQuestions,
      progress,
      tabSwitches:Number(result?.cheatingFlags?.tabSwitches || 0),
      focusLosses:Number(result?.cheatingFlags?.focusLosses || 0),
      fullscreenExits:Number(result?.cheatingFlags?.fullscreenExits || 0),
      totalViolations:Number(result?.violationCount || 0),
      suspicious:Number(result?.violationCount || 0)>0,
    };
  }).sort((left,right) => Number(right.suspicious)-Number(left.suspicious) || Number(right.currentlyActive)-Number(left.currentlyActive) || right.progress-left.progress) : [];

  return {
    generatedAt:now,
    activeWithinSeconds,
    selectedTestId:chosen?.testId || null,
    tests:summaries.map(({ scheduledIds,...summary }) => summary),
    students:studentRows,
  };
}

module.exports = { answeredCount, buildLiveMonitor, idOf };
