function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + number(value), 0) / values.length : 0;
}

function idOf(value) {
  return String(value?._id || value?.id || value || '');
}

function percentage(result) {
  return number(result?.totalMarks) > 0 ? (number(result.score) / number(result.totalMarks)) * 100 : 0;
}

function resultAccuracy(result) {
  const attempted = number(result?.correctAnswers) + number(result?.wrongAnswers) + number(result?.partialAnswers);
  return attempted ? (number(result.correctAnswers) / attempted) * 100 : 0;
}

function performanceRows(results, studentsById) {
  const byStudent = new Map();
  results.forEach(result => {
    const studentId = idOf(result.studentId);
    if (!studentId) return;
    const row = byStudent.get(studentId) || { studentId, student:studentsById.get(studentId) || result.studentId, results:[] };
    row.results.push(result);
    byStudent.set(studentId, row);
  });
  return [...byStudent.values()].map(row => {
    const ordered = [...row.results].sort((left, right) => new Date(left.submittedAt || 0) - new Date(right.submittedAt || 0));
    const latest = ordered.at(-1);
    const previous = ordered.at(-2);
    const percentages = ordered.map(percentage);
    return {
      ...row,
      testsCompleted:ordered.length,
      averagePercentage:round(average(percentages)),
      averageAccuracy:round(average(ordered.map(resultAccuracy))),
      averageTimeMinutes:round(average(ordered.map(result => number(result.timeTaken) / 60))),
      bestPercentage:round(Math.max(0, ...percentages)),
      latestRank:latest?.rank || null,
      trend:latest && previous ? round(percentage(latest) - percentage(previous)) : 0,
      history:ordered.map(result => ({
        testId:idOf(result.testId),
        testTitle:result.testId?.title || 'Test',
        percentage:round(percentage(result)),
        accuracy:round(resultAccuracy(result)),
        rank:result.rank || null,
        timeMinutes:round(number(result.timeTaken) / 60),
        submittedAt:result.submittedAt || null,
      })),
    };
  }).sort((left, right) => right.averagePercentage - left.averagePercentage);
}

function breakdownRows(results, field) {
  const rows = new Map();
  results.forEach(result => {
    Object.entries(result?.[field] || {}).forEach(([name, data]) => {
      if (!name || data?.status === 'ABSENT') return;
      const row = rows.get(name) || { name, marks:0, total:0, correct:0, wrong:0, partial:0, skipped:0, bonus:0, resultCount:0 };
      row.marks += number(data.marks);
      row.total += number(data.total);
      row.correct += number(data.correct);
      row.wrong += number(data.wrong);
      row.partial += number(data.partial);
      row.skipped += number(data.skipped);
      row.bonus += number(data.bonus);
      row.resultCount += 1;
      rows.set(name, row);
    });
  });
  return [...rows.values()].map(row => ({
    ...row,
    percentage:round(row.total ? (row.marks / row.total) * 100 : 0),
    accuracy:round(row.correct + row.wrong + row.partial ? (row.correct / (row.correct + row.wrong + row.partial)) * 100 : 0),
  })).sort((left, right) => right.percentage - left.percentage);
}

function questionAnalyticsForTest(test, results) {
  const resultPercentages = new Map(results.map(result => [idOf(result), percentage(result)]));
  const ordered = [...results].sort((left, right) => resultPercentages.get(idOf(right)) - resultPercentages.get(idOf(left)));
  const segmentSize = ordered.length > 1 ? Math.max(1, Math.ceil(ordered.length * 0.27)) : 0;
  const topIds = new Set(ordered.slice(0, segmentSize).map(idOf));
  const bottomIds = new Set(ordered.slice(-segmentSize).map(idOf));

  return (test.questions || []).map(question => {
    const questionId = idOf(question);
    const counts = { correct:0, incorrect:0, partial:0, skipped:0, bonus:0 };
    let totalTime = 0;
    let timedResponses = 0;
    let topCorrect = 0;
    let bottomCorrect = 0;
    results.forEach(result => {
      const status = result.perQuestionScore?.[questionId]?.status || 'skipped';
      if (Object.hasOwn(counts, status)) counts[status] += 1;
      else counts.skipped += 1;
      const seconds = number(result.questionTimings?.[questionId]);
      if (seconds > 0) { totalTime += seconds; timedResponses += 1; }
      if (status === 'correct' && topIds.has(idOf(result))) topCorrect += 1;
      if (status === 'correct' && bottomIds.has(idOf(result))) bottomCorrect += 1;
    });
    const total = results.length;
    const attempted = counts.correct + counts.incorrect + counts.partial;
    const discrimination = segmentSize
      ? round((topCorrect / segmentSize - bottomCorrect / segmentSize) * 100)
      : null;
    return {
      questionId,
      testId:idOf(test),
      testTitle:test.title,
      question:question.question || `Question ${questionId}`,
      subject:question.subject || 'General',
      topic:question.topic || 'General',
      difficulty:question.difficulty || 'Medium',
      totalResponses:total,
      attemptCount:attempted,
      correctCount:counts.correct,
      wrongCount:counts.incorrect,
      partialCount:counts.partial,
      skippedCount:counts.skipped,
      bonusCount:counts.bonus,
      correctPercentage:round(total ? (counts.correct / total) * 100 : 0),
      wrongPercentage:round(total ? (counts.incorrect / total) * 100 : 0),
      skippedPercentage:round(total ? (counts.skipped / total) * 100 : 0),
      averageResponseSeconds:round(timedResponses ? totalTime / timedResponses : 0),
      discrimination,
      usefulness:discrimination === null ? 'Insufficient data' : discrimination >= 30 ? 'Strong' : discrimination >= 15 ? 'Moderate' : discrimination >= 0 ? 'Weak' : 'Review key',
    };
  });
}

function buildReports({ groups = [], students = [], memberships = [], tests = [], results = [] }) {
  const studentsById = new Map(students.map(student => [idOf(student), student]));
  const testsById = new Map(tests.map(test => [idOf(test), test]));
  const memberIdsByGroup = new Map(groups.map(group => [idOf(group), new Set()]));
  memberships.forEach(membership => {
    const groupId = idOf(membership.groupId);
    const studentId = idOf(membership.userId);
    if (!memberIdsByGroup.has(groupId)) memberIdsByGroup.set(groupId, new Set());
    if (studentId) memberIdsByGroup.get(groupId).add(studentId);
  });

  const studentReports = performanceRows(results, studentsById);
  const subjectReports = breakdownRows(results, 'subjectScores');
  const topicReports = breakdownRows(results, 'topicScores');

  const batchReports = groups.map(group => {
    const groupId = idOf(group);
    const memberIds = memberIdsByGroup.get(groupId) || new Set();
    const activeMemberIds = new Set([...memberIds].filter(id => studentsById.get(id)?.isActive !== false));
    const assignedTests = tests.filter(test => (test.groups || []).map(idOf).includes(groupId));
    const assignedTestIds = new Set(assignedTests.map(idOf));
    const groupResults = results.filter(result => memberIds.has(idOf(result.studentId)) && assignedTestIds.has(idOf(result.testId)));
    const resultPairs = new Set(groupResults.map(result => `${idOf(result.studentId)}:${idOf(result.testId)}`));
    const expectedAttempts = memberIds.size * assignedTests.length;
    const performers = performanceRows(groupResults, studentsById);
    const percentages = groupResults.map(percentage);
    return {
      groupId,
      name:group.name,
      course:group.course || '',
      totalStudents:memberIds.size,
      activeStudents:activeMemberIds.size,
      testsAssigned:assignedTests.length,
      testsAttempted:new Set(groupResults.map(result => idOf(result.testId))).size,
      completedAttempts:groupResults.length,
      averageScore:round(average(groupResults.map(result => number(result.score)))),
      averagePercentage:round(average(percentages)),
      averageAccuracy:round(average(groupResults.map(resultAccuracy))),
      highestPercentage:round(Math.max(0, ...percentages)),
      lowestPercentage:percentages.length ? round(Math.min(...percentages)) : 0,
      participationRate:round(expectedAttempts ? (resultPairs.size / expectedAttempts) * 100 : 0),
      topPerformers:performers.slice(0, 5),
      lowPerformers:performers.filter(row => row.averagePercentage < 40).sort((left, right) => left.averagePercentage - right.averagePercentage).slice(0, 5),
      subjectAverages:breakdownRows(groupResults, 'subjectScores'),
      topicAverages:breakdownRows(groupResults, 'topicScores'),
      testWise:assignedTests.map(test => {
        const testResults = groupResults.filter(result => idOf(result.testId) === idOf(test));
        return { testId:idOf(test), title:test.title, attempts:testResults.length, averagePercentage:round(average(testResults.map(percentage))) };
      }),
    };
  });

  const questionAnalytics = [];
  const testReports = tests.map(test => {
    const testId = idOf(test);
    const testResults = results.filter(result => idOf(result.testId) === testId);
    const scheduledIds = new Set();
    (test.groups || []).forEach(groupId => (memberIdsByGroup.get(idOf(groupId)) || []).forEach(studentId => scheduledIds.add(studentId)));
    const analytics = questionAnalyticsForTest(test, testResults);
    questionAnalytics.push(...analytics);
    const percentages = testResults.map(percentage);
    const distribution = [
      { label:'0–39%', count:percentages.filter(value => value < 40).length },
      { label:'40–59%', count:percentages.filter(value => value >= 40 && value < 60).length },
      { label:'60–79%', count:percentages.filter(value => value >= 60 && value < 80).length },
      { label:'80–100%', count:percentages.filter(value => value >= 80).length },
    ];
    return {
      testId,
      title:test.title,
      status:test.status,
      scheduledStudents:scheduledIds.size,
      attempts:testResults.length,
      completionRate:round(scheduledIds.size ? (new Set(testResults.map(result => idOf(result.studentId))).size / scheduledIds.size) * 100 : 0),
      averageScore:round(average(testResults.map(result => number(result.score)))),
      averagePercentage:round(average(percentages)),
      averageAccuracy:round(average(testResults.map(resultAccuracy)), 1),
      averageTimeMinutes:round(average(testResults.map(result => number(result.timeTaken) / 60)), 1),
      averageTimePerQuestionSeconds:round(average(analytics.filter(row => row.averageResponseSeconds > 0).map(row => row.averageResponseSeconds))),
      highestScore:testResults.length ? Math.max(...testResults.map(result => number(result.score))) : 0,
      lowestScore:testResults.length ? Math.min(...testResults.map(result => number(result.score))) : 0,
      scoreDistribution:distribution,
      rankDistribution:testResults.filter(result => result.rank).sort((left, right) => left.rank - right.rank).map(result => ({ rank:result.rank, student:result.studentId?.name || '', score:result.score })),
      mostIncorrect:[...analytics].sort((left, right) => right.wrongPercentage - left.wrongPercentage).slice(0, 5),
      difficultyPerformance:['Easy','Medium','Hard'].map(difficulty => {
        const rows = analytics.filter(row => row.difficulty === difficulty);
        return { difficulty, questions:rows.length, correctPercentage:round(average(rows.map(row => row.correctPercentage))) };
      }),
    };
  });

  return {
    summary:{
      students:students.length,
      activeStudents:students.filter(student => student.isActive !== false).length,
      batches:groups.length,
      tests:tests.length,
      completedAttempts:results.length,
      averagePercentage:round(average(results.map(percentage))),
      averageAccuracy:round(average(results.map(resultAccuracy))),
    },
    studentReports,
    batchReports,
    testReports,
    subjectReports,
    topicReports,
    questionAnalytics:questionAnalytics.sort((left, right) => right.wrongPercentage - left.wrongPercentage),
  };
}

function workbookRows(reports) {
  return {
    Students:reports.studentReports.map(row => ({
      'Roll No':row.student?.rollNo || '', Student:row.student?.name || '', 'Tests Completed':row.testsCompleted,
      'Average %':row.averagePercentage, 'Best %':row.bestPercentage, 'Accuracy %':row.averageAccuracy,
      'Average Time (min)':row.averageTimeMinutes, 'Latest Rank':row.latestRank || '', 'Trend (points)':row.trend,
    })),
    Batches:reports.batchReports.map(row => ({
      Batch:row.name, Course:row.course, Students:row.totalStudents, 'Active Students':row.activeStudents,
      'Tests Assigned':row.testsAssigned, 'Completed Attempts':row.completedAttempts, 'Participation %':row.participationRate,
      'Average Score':row.averageScore, 'Average %':row.averagePercentage, 'Average Accuracy %':row.averageAccuracy,
      'Highest %':row.highestPercentage, 'Lowest %':row.lowestPercentage,
    })),
    Tests:reports.testReports.map(row => ({
      Test:row.title, Status:row.status, Scheduled:row.scheduledStudents, Attempts:row.attempts,
      'Completion %':row.completionRate, 'Average Score':row.averageScore, 'Average %':row.averagePercentage,
      'Highest Score':row.highestScore, 'Lowest Score':row.lowestScore, 'Accuracy %':row.averageAccuracy,
      'Average Time (min)':row.averageTimeMinutes, 'Average Seconds / Question':row.averageTimePerQuestionSeconds,
    })),
    Subjects:reports.subjectReports.map(row => ({ Subject:row.name, Results:row.resultCount, Marks:row.marks, Maximum:row.total, 'Performance %':row.percentage, 'Accuracy %':row.accuracy })),
    Topics:reports.topicReports.map(row => ({ Topic:row.name, Results:row.resultCount, Marks:row.marks, Maximum:row.total, 'Performance %':row.percentage, 'Accuracy %':row.accuracy })),
    Questions:reports.questionAnalytics.map(row => ({
      Test:row.testTitle, 'Question ID':row.questionId, Question:row.question, Subject:row.subject, Topic:row.topic, Difficulty:row.difficulty,
      Responses:row.totalResponses, Attempts:row.attemptCount, 'Correct %':row.correctPercentage, 'Wrong %':row.wrongPercentage,
      'Skipped %':row.skippedPercentage, 'Avg Response Seconds':row.averageResponseSeconds,
      'Discrimination Points':row.discrimination ?? '', Usefulness:row.usefulness,
    })),
  };
}

module.exports = { buildReports, idOf, percentage, resultAccuracy, workbookRows };
