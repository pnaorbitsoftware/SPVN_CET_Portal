const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReports } = require('../services/reportService');
const { buildAdminAnalytics } = require('../services/adminAnalyticsService');

test('admin analytics uses report data for real widgets and chart distributions', () => {
  const students = [{ _id:'s1', name:'A', isActive:true }, { _id:'s2', name:'B', isActive:true }];
  const groups = [{ _id:'g1', name:'Batch A' }];
  const tests = [{ _id:'t1', title:'Test A', status:'published', groups:['g1'], createdAt:new Date() }];
  const memberships = students.map(student => ({ groupId:'g1', userId:student._id }));
  const results = [
    { _id:'r1', studentId:students[0], testId:tests[0], score:8, totalMarks:10, correctAnswers:8, wrongAnswers:2, submittedAt:new Date(), subjectScores:{ Physics:{ marks:8,total:10,correct:8,wrong:2 } } },
    { _id:'r2', studentId:students[1], testId:tests[0], score:3, totalMarks:10, correctAnswers:3, wrongAnswers:7, submittedAt:new Date(), subjectScores:{ Physics:{ marks:3,total:10,correct:3,wrong:7 } } },
  ];
  const reports = buildReports({ groups, students, memberships, tests, results });
  const analytics = buildAdminAnalytics({ reports, tests, results, questionCount:25 });
  assert.equal(analytics.stats.completedAttempts, 2);
  assert.equal(analytics.stats.averagePercentage, 55);
  assert.equal(analytics.stats.overallParticipation, 100);
  assert.equal(analytics.stats.questions, 25);
  assert.equal(analytics.charts.scoreDistribution.reduce((sum,row) => sum + row.count, 0), 2);
  assert.equal(analytics.needsAttention[0].student.name, 'B');
});

test('empty analytics has stable zero values instead of fake chart data', () => {
  const reports = buildReports({});
  const analytics = buildAdminAnalytics({ reports });
  assert.equal(analytics.stats.averagePercentage, 0);
  assert.equal(analytics.stats.overallParticipation, 0);
  assert.deepEqual(analytics.charts.scoreTrend, []);
  assert.deepEqual(analytics.topPerformers, []);
});
