const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReports, workbookRows } = require('../services/reportService');

const students = [
  { _id:'s1', name:'Asha', rollNo:'1', isActive:true },
  { _id:'s2', name:'Bharat', rollNo:'2', isActive:false },
];
const groups = [{ _id:'g1', name:'CET A', course:'CET' }];
const memberships = [{ groupId:'g1', userId:'s1' }, { groupId:'g1', userId:'s2' }];
const question = { _id:'q1', question:'2 + 2?', subject:'Mathematics', topic:'Arithmetic', difficulty:'Easy' };
const tests = [{ _id:'t1', title:'Mock 1', status:'published', groups:['g1'], questions:[question] }];
const results = [
  { _id:'r1', studentId:students[0], testId:tests[0], score:8, totalMarks:10, correctAnswers:1, wrongAnswers:0, timeTaken:600, rank:1, submittedAt:new Date(), subjectScores:{ Mathematics:{ marks:8, total:10, correct:1, wrong:0, skipped:0 } }, topicScores:{ Arithmetic:{ marks:8, total:10, correct:1, wrong:0, skipped:0 } }, perQuestionScore:{ q1:{ status:'correct' } }, questionTimings:{ q1:20 } },
  { _id:'r2', studentId:students[1], testId:tests[0], score:2, totalMarks:10, correctAnswers:0, wrongAnswers:1, timeTaken:900, rank:2, submittedAt:new Date(), subjectScores:{ Mathematics:{ marks:2, total:10, correct:0, wrong:1, skipped:0 } }, topicScores:{ Arithmetic:{ marks:2, total:10, correct:0, wrong:1, skipped:0 } }, perQuestionScore:{ q1:{ status:'incorrect' } }, questionTimings:{ q1:40 } },
];

test('reports derive real batch participation, performance and question analytics', () => {
  const reports = buildReports({ groups, students, memberships, tests, results });
  assert.equal(reports.summary.averagePercentage, 50);
  assert.equal(reports.batchReports[0].participationRate, 100);
  assert.equal(reports.batchReports[0].activeStudents, 1);
  assert.equal(reports.testReports[0].completionRate, 100);
  assert.equal(reports.questionAnalytics[0].correctPercentage, 50);
  assert.equal(reports.questionAnalytics[0].averageResponseSeconds, 30);
  assert.equal(reports.questionAnalytics[0].discrimination, 100);
});

test('student, subject and export rows contain computed values without sample data', () => {
  const reports = buildReports({ groups, students, memberships, tests, results });
  assert.equal(reports.studentReports[0].student.name, 'Asha');
  assert.equal(reports.subjectReports[0].name, 'Mathematics');
  const rows = workbookRows(reports);
  assert.equal(rows.Students.length, 2);
  assert.equal(rows.Batches[0]['Participation %'], 100);
  assert.equal(rows.Questions[0]['Correct %'], 50);
});

test('empty report data stays finite and exportable', () => {
  const reports = buildReports({ groups:[], students:[], memberships:[], tests:[], results:[] });
  assert.deepEqual(reports.summary, { students:0, activeStudents:0, batches:0, tests:0, completedAttempts:0, averagePercentage:0, averageAccuracy:0 });
  assert.deepEqual(workbookRows(reports).Questions, []);
});
