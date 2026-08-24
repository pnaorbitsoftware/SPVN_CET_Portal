const xlsx = require('xlsx');
const { Group, GroupMember, Result, Test, User } = require('../models');
const { organizationScope } = require('../services/organizationService');
const { buildReports, idOf, workbookRows } = require('../services/reportService');
const { parseDateOnly, validateDateRange } = require('../utils/validation');

const REPORT_TYPES = ['overview','student','batch','test','subject','question'];

function parseFilters(query = {}) {
  const startDate = parseDateOnly(query.startDate, 'Report start date');
  const endDate = parseDateOnly(query.endDate, 'Report end date');
  validateDateRange(startDate, endDate, { start:'Report start date', end:'Report end date' });
  return {
    reportType:REPORT_TYPES.includes(query.reportType) ? query.reportType : 'overview',
    startDate,
    endDate,
    groupId:String(query.groupId || ''),
    studentId:String(query.studentId || ''),
    testId:String(query.testId || ''),
    course:String(query.course || ''),
    subject:String(query.subject || ''),
  };
}

async function reportContext(req) {
  const filters = parseFilters(req.query);
  const scope = organizationScope(req.organization);
  const [allGroups, allStudents, allTests, memberships] = await Promise.all([
    Group.find({ isActive:{ $ne:false }, ...scope }).sort({ name:1 }).lean(),
    User.find({ role:'student', ...scope }).sort({ rollNo:1 }).select('name rollNo isActive organization').lean(),
    Test.find({ isActive:{ $ne:false }, ...scope })
      .sort({ createdAt:-1 })
      .select('title status groups course subject totalMarks questions createdAt')
      .populate('questions','question subject topic difficulty')
      .lean(),
    GroupMember.find({ role:'student' }).select('groupId userId').lean(),
  ]);

  const scopedGroupIds = new Set(allGroups.map(idOf));
  const scopedStudentIds = new Set(allStudents.map(idOf));
  const scopedMemberships = memberships.filter(item => scopedGroupIds.has(idOf(item.groupId)) && scopedStudentIds.has(idOf(item.userId)));
  const selectedMemberIds = filters.groupId
    ? new Set(scopedMemberships.filter(item => idOf(item.groupId) === filters.groupId).map(item => idOf(item.userId)))
    : null;

  const students = allStudents.filter(student => {
    if (selectedMemberIds && !selectedMemberIds.has(idOf(student))) return false;
    if (filters.studentId && idOf(student) !== filters.studentId) return false;
    return true;
  });
  const studentIds = new Set(students.map(idOf));
  const tests = allTests.filter(test => {
    if (filters.groupId && !(test.groups || []).map(idOf).includes(filters.groupId)) return false;
    if (filters.testId && idOf(test) !== filters.testId) return false;
    if (filters.course && !(test.course || []).includes(filters.course)) return false;
    if (filters.subject && !(test.subject || []).includes(filters.subject)) return false;
    return true;
  });
  const testIds = new Set(tests.map(idOf));

  const resultQuery = {
    status:{ $in:['submitted','auto_submitted'] },
    studentId:{ $in:[...studentIds] },
    testId:{ $in:[...testIds] },
  };
  if (filters.startDate || filters.endDate) {
    resultQuery.submittedAt = {};
    if (filters.startDate) resultQuery.submittedAt.$gte = filters.startDate;
    if (filters.endDate) {
      const exclusiveEnd = new Date(filters.endDate);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      resultQuery.submittedAt.$lt = exclusiveEnd;
    }
  }
  const rawResults = studentIds.size && testIds.size
    ? await Result.find(resultQuery)
      .select('studentId testId score totalMarks fullTotalMarks correctAnswers wrongAnswers partialAnswers skippedAnswers rank percentile timeTaken submittedAt subjectScores topicScores perQuestionScore questionTimings status')
      .lean()
    : [];
  const studentMap = new Map(allStudents.map(student => [idOf(student),student]));
  const testMap = new Map(allTests.map(test => [idOf(test),test]));
  const results = rawResults.map(result => ({ ...result, studentId:studentMap.get(idOf(result.studentId)), testId:testMap.get(idOf(result.testId)) })).filter(result => result.studentId && result.testId);
  const groups = filters.groupId ? allGroups.filter(group => idOf(group) === filters.groupId) : allGroups;
  const reports = buildReports({ groups, students, memberships:scopedMemberships, tests, results });
  return { filters, reports, options:{ groups:allGroups, students:allStudents, tests:allTests } };
}

function pageFor(reports, reportType, requestedPage) {
  const rowsByType = {
    student:reports.studentReports,
    batch:reports.batchReports,
    test:reports.testReports,
    subject:reports.subjectReports,
    question:reports.questionAnalytics,
  };
  const rows = rowsByType[reportType] || [];
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(Number.parseInt(requestedPage, 10) || 1, 1), totalPages);
  return { rows:rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total:rows.length, totalPages };
}

exports.getReports = async (req, res) => {
  try {
    const context = await reportContext(req);
    const pageData = pageFor(context.reports, context.filters.reportType, req.query.page);
    const params = new URLSearchParams();
    Object.entries(req.query).forEach(([key, value]) => { if (key !== 'page' && value) params.set(key, String(value)); });
    res.render('admin/reports', {
      title:'Reports Center',
      ...context,
      pageData,
      reportTypes:REPORT_TYPES,
      exportQuery:params.toString(),
    });
  } catch (error) {
    req.flash('error',`Unable to build reports: ${error.message}`);
    res.redirect('/admin/reports');
  }
};

exports.exportReports = async (req, res) => {
  try {
    const { reports, filters } = await reportContext(req);
    const sheets = workbookRows(reports);
    const workbook = xlsx.utils.book_new();
    Object.entries(sheets).forEach(([name, rows]) => {
      const worksheet = xlsx.utils.json_to_sheet(rows.length ? rows : [{ Message:'No matching data' }]);
      worksheet['!cols'] = Array(Math.max(1, Object.keys(rows[0] || { Message:'' }).length)).fill({ wch:20 });
      xlsx.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
    });
    const buffer = xlsx.write(workbook, { type:'buffer', bookType:'xlsx' });
    const stamp = new Date().toISOString().slice(0,10);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="${filters.reportType}_reports_${stamp}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    req.flash('error',`Report export failed: ${error.message}`);
    res.redirect('/admin/reports');
  }
};

module.exports.parseFilters = parseFilters;
module.exports.reportContext = reportContext;
