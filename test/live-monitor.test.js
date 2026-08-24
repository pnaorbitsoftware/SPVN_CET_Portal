const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLiveMonitor } = require('../services/liveMonitorService');

test('live monitor derives scheduled, active, submitted, progress and violation counts', () => {
  const now = new Date('2026-08-24T10:00:00Z');
  const tests = [{ _id:'t1', title:'Live Test', status:'active', groups:['g1'], questions:['q1','q2','q3','q4'] }];
  const groups = [{ _id:'g1', name:'Batch A' }];
  const students = [{ _id:'s1',name:'A',rollNo:'1' },{ _id:'s2',name:'B',rollNo:'2' },{ _id:'s3',name:'C',rollNo:'3' }];
  const memberships = students.map(student => ({ groupId:'g1',userId:student._id }));
  const results = [
    { _id:'r1',testId:'t1',studentId:'s1',status:'in_progress',startedAt:'2026-08-24T09:50:00Z',lastActivityAt:'2026-08-24T09:59:30Z',questionOrder:['q1','q2','q3','q4'],answers:{ q1:{answer:'A'},q2:{answer:null} },violationCount:2,cheatingFlags:{tabSwitches:1,focusLosses:1} },
    { _id:'r2',testId:'t1',studentId:'s2',status:'auto_submitted',startedAt:'2026-08-24T09:45:00Z',lastActivityAt:'2026-08-24T09:58:00Z',questionOrder:['q1','q2','q3','q4'],answers:{ q1:{answer:'B'} },violationCount:3 },
  ];
  const monitor = buildLiveMonitor({ tests,groups,students,memberships,results,now });
  assert.equal(monitor.tests[0].scheduled,3);
  assert.equal(monitor.tests[0].started,2);
  assert.equal(monitor.tests[0].currentlyActive,1);
  assert.equal(monitor.tests[0].autoSubmitted,1);
  assert.equal(monitor.tests[0].notStarted,1);
  assert.equal(monitor.tests[0].violationCount,5);
  assert.equal(monitor.students[0].suspicious,true);
  assert.equal(monitor.students.find(row=>row.studentId==='s1').progress,25);
});

test('stale in-progress attempts remain visible but are not counted currently active', () => {
  const monitor = buildLiveMonitor({
    tests:[{_id:'t1',title:'Test',groups:['g1'],questions:['q1']}], groups:[{_id:'g1',name:'G'}],
    students:[{_id:'s1',name:'S'}], memberships:[{groupId:'g1',userId:'s1'}],
    results:[{_id:'r1',testId:'t1',studentId:'s1',status:'in_progress',lastActivityAt:'2026-08-24T09:00:00Z'}],
    now:new Date('2026-08-24T10:00:00Z'),
  });
  assert.equal(monitor.tests[0].inProgress,1);
  assert.equal(monitor.tests[0].currentlyActive,0);
  assert.equal(monitor.students[0].currentlyActive,false);
});
