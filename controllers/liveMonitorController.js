const { Group, GroupMember, Result, Test, User } = require('../models');
const { organizationScope } = require('../services/organizationService');
const { buildLiveMonitor } = require('../services/liveMonitorService');

async function monitorSnapshot(req) {
  const scope = organizationScope(req.organization);
  const tests = await Test.find({ status:{ $in:['published','active'] }, isActive:{ $ne:false }, ...scope })
    .select('title status groups questions startTime endTime')
    .sort({ startTime:-1,createdAt:-1 })
    .lean();
  const testIds = tests.map(test => test._id);
  const groupIds = [...new Set(tests.flatMap(test => (test.groups||[]).map(String)))];
  const [groups,memberships,students,results] = await Promise.all([
    Group.find({ _id:{ $in:groupIds }, ...scope }).select('name').lean(),
    GroupMember.find({ groupId:{ $in:groupIds }, role:'student' }).select('groupId userId').lean(),
    User.find({ role:'student', ...scope }).select('name rollNo isActive').lean(),
    testIds.length ? Result.find({ testId:{ $in:testIds }, status:{ $in:['in_progress','submitted','auto_submitted'] } })
      .select('studentId testId status answers questionOrder startedAt lastActivityAt cheatingFlags violationCount createdAt updatedAt')
      .sort({ updatedAt:-1 }).lean() : [],
  ]);
  return buildLiveMonitor({ tests,groups,students,memberships,results,selectedTestId:String(req.query.testId||'') });
}

exports.getMonitor = async (req,res) => {
  try {
    const snapshot=await monitorSnapshot(req);
    res.render('admin/live-monitor',{title:'Live Exam Monitor',snapshot});
  } catch(error) {
    req.flash('error',`Unable to load live monitor: ${error.message}`);
    res.redirect('/admin/dashboard');
  }
};

exports.getMonitorData = async (req,res) => {
  try { return res.json(await monitorSnapshot(req)); }
  catch(error) { return res.status(500).json({error:'Unable to refresh live monitor.'}); }
};

module.exports.monitorSnapshot=monitorSnapshot;
