const { idOf, percentage, resultAccuracy } = require('./reportService');

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function distribution(values, buckets) {
  return buckets.map(bucket => ({ ...bucket, count:values.filter(value => value >= bucket.min && value < bucket.max).length }));
}

function buildAdminAnalytics({ reports, tests = [], results = [], questionCount = 0 }) {
  const testReportById = new Map(reports.testReports.map(row => [row.testId,row]));
  const orderedTests = [...tests].sort((left, right) => {
    const leftResult = results.filter(result => idOf(result.testId) === idOf(left)).map(result => new Date(result.submittedAt || 0).getTime());
    const rightResult = results.filter(result => idOf(result.testId) === idOf(right)).map(result => new Date(result.submittedAt || 0).getTime());
    return Math.max(0, ...leftResult) - Math.max(0, ...rightResult);
  });
  const testTrend = orderedTests.map(test => {
    const report = testReportById.get(idOf(test));
    return {
      testId:idOf(test),
      title:test.title,
      averagePercentage:report?.averagePercentage || 0,
      participationRate:report?.completionRate || 0,
      attempts:report?.attempts || 0,
      scheduledStudents:report?.scheduledStudents || 0,
    };
  }).filter(row => row.attempts > 0).slice(-12);

  const scoreValues = results.map(percentage);
  const accuracyValues = results.map(resultAccuracy);
  const scheduledTotal = reports.testReports.reduce((sum, row) => sum + row.scheduledStudents, 0);
  const completedStudents = reports.testReports.reduce((sum, row) => sum + Math.min(row.attempts, row.scheduledStudents || row.attempts), 0);
  const topBatch = reports.batchReports.filter(row => row.completedAttempts > 0).sort((left, right) => right.averagePercentage - left.averagePercentage)[0] || null;
  const weakestSubject = [...reports.subjectReports].filter(row => row.resultCount > 0).sort((left, right) => left.percentage - right.percentage)[0] || null;
  const recentTests = [...tests].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0)).slice(0, 8).map(test => ({
    ...test,
    report:testReportById.get(idOf(test)) || { attempts:0, averagePercentage:0, completionRate:0 },
  }));
  const recentResults = [...results].sort((left, right) => new Date(right.submittedAt || 0) - new Date(left.submittedAt || 0)).slice(0, 8);

  return {
    stats:{
      totalStudents:reports.summary.students,
      activeStudents:reports.summary.activeStudents,
      totalTests:tests.length,
      publishedTests:tests.filter(test => ['published','active'].includes(test.status)).length,
      questions:questionCount,
      completedAttempts:results.length,
      averagePercentage:reports.summary.averagePercentage,
      averageAccuracy:reports.summary.averageAccuracy,
      overallParticipation:round(scheduledTotal ? (completedStudents / scheduledTotal) * 100 : 0),
      topBatch:topBatch?.name || '—',
      topBatchPercentage:topBatch?.averagePercentage || 0,
      weakestSubject:weakestSubject?.name || '—',
      weakestSubjectPercentage:weakestSubject?.percentage || 0,
    },
    charts:{
      scoreTrend:testTrend.map(row => ({ label:row.title, value:row.averagePercentage })),
      participationTrend:testTrend.map(row => ({ label:row.title, value:row.participationRate, attempts:row.attempts, scheduled:row.scheduledStudents })),
      subjects:reports.subjectReports.map(row => ({ label:row.name, value:row.percentage, accuracy:row.accuracy })),
      batches:reports.batchReports.map(row => ({ label:row.name, value:row.averagePercentage, participation:row.participationRate })),
      scoreDistribution:distribution(scoreValues, [
        { label:'0–39%', min:0, max:40 }, { label:'40–59%', min:40, max:60 },
        { label:'60–79%', min:60, max:80 }, { label:'80–100%', min:80, max:101 },
      ]),
      accuracyDistribution:distribution(accuracyValues, [
        { label:'0–39%', min:0, max:40 }, { label:'40–59%', min:40, max:60 },
        { label:'60–79%', min:60, max:80 }, { label:'80–100%', min:80, max:101 },
      ]),
    },
    recentTests,
    recentResults,
    topPerformers:reports.studentReports.slice(0, 8),
    needsAttention:[...reports.studentReports].filter(row => row.averagePercentage < 40).sort((left, right) => left.averagePercentage - right.averagePercentage).slice(0, 8),
  };
}

module.exports = { buildAdminAnalytics, distribution };
