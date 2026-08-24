// controllers/adminController.js — MongoDB / Mongoose
const { User, Group, Question, QuestionPaper, Test, GroupMember, Result, ResultRecalculation, Notification, Topic, StudentDocument } = require('../models');
const xlsx = require('xlsx');
const fs   = require('fs');
const path = require('path');
const { parseLocalDateTime, formatDateTimeLocal } = require('../utils/dateTime');
const { extractSyllabusFromPdf } = require('../utils/syllabusImporter');
const { organizationIdForWrite, organizationScope } = require('../services/organizationService');
const { dateInputValue, parseDateOnly, validateDateRange } = require('../utils/validation');
const {
  QUESTION_SUB_TYPES,
  QUESTION_TYPES,
  answerForDisplay,
  questionInputFromBody,
} = require('../services/questionService');
const {
  buildQuestionConfigs,
  configsByQuestionId,
  totalMarksFromConfigs,
} = require('../services/testConfigurationService');
const {
  TEST_TYPES,
  ensureDefaultExamConfigurations,
  resolveExamConfiguration,
  validateQuestionsForPattern,
} = require('../services/examConfigurationService');
const { updateRanks } = require('../services/rankingService');
const { TIMING_MODES, timingInput, timingLabel } = require('../services/timingService');
const { accessConfiguration } = require('../services/testAccessService');
const {
  RESULT_RELEASE_MODES,
  releaseConfiguration,
  releaseLabel,
} = require('../services/resultReleaseService');
const { buildReports } = require('../services/reportService');
const { buildAdminAnalytics } = require('../services/adminAnalyticsService');

const COURSES = ['JEE','CET','NEET'];
const SUBJECTS_BY_COURSE = { JEE:['Physics','Chemistry','Mathematics'], CET:['Physics','Chemistry','Mathematics','Biology'], NEET:['Physics','Chemistry','Biology'] };
const ALL_SUBJECTS = ['Physics','Chemistry','Mathematics','Biology','English','General Knowledge'];
const generatePassword = rollNo => `CET@${String(rollNo).slice(-4).padStart(4,'0')}`;

const UPLOAD_DIR = path.join(__dirname,'../public/uploads');
const PDF_DIR = path.join(UPLOAD_DIR,'pdfs');
const DOC_DIR = path.join(UPLOAD_DIR,'documents');
[UPLOAD_DIR,PDF_DIR,DOC_DIR].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); });

const loadTopics = (organization, course, subject) => {
  const q = { isActive: true, ...organizationScope(organization) };
  if (course)  q.course  = course;
  if (subject) q.subject = subject;
  return Topic.find(q).sort({ name: 1 });
};

const cleanHierarchyText = value => String(value || '').replace(/\s+/g, ' ').trim();
const stripUnitPrefix = value => cleanHierarchyText(value).replace(/^unit\s*\d+\s*[—-]\s*/i, '');

const hierarchyValuePattern = (value, { allowUnitPrefix = false } = {}) => {
  const terms = (allowUnitPrefix ? stripUnitPrefix(value) : cleanHierarchyText(value))
    .split(' ')
    .filter(Boolean);
  const expression = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const prefix = allowUnitPrefix ? '(?:unit\\s*\\d+\\s*[—-]\\s*)?' : '';
  return new RegExp(`^${prefix}${expression}$`, 'i');
};

const hierarchyWords = value => stripUnitPrefix(value)
  .toLocaleLowerCase()
  .replace(/trigonometric/g, 'trig')
  .replace(/[^a-z0-9]+/g, ' ')
  .split(' ')
  .map(word => word.replace(/ies$/, 'y').replace(/s$/, ''))
  .filter(word => word.length > 2 && !['and', 'the', 'for', 'with', 'from', 'into', 'using', 'basic', 'general', 'standard'].includes(word));

const matchesSyllabusTopic = (questionTopic, syllabusTopic) => {
  if (stripUnitPrefix(questionTopic).toLocaleLowerCase() === stripUnitPrefix(syllabusTopic.name).toLocaleLowerCase()) return true;
  const questionWords = [...new Set(hierarchyWords(questionTopic))];
  const syllabusWords = new Set(hierarchyWords([syllabusTopic.name, ...(syllabusTopic.subtopics || [])].join(' ')));
  const matches = questionWords.filter(word => syllabusWords.has(word)).length;
  return matches >= Math.min(2, questionWords.length);
};

const parseSubtopics = value => {
  const seen = new Set();
  return String(value || '').split(/\r?\n/).map(cleanHierarchyText).filter(item => {
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mergeHierarchyText = (existing, incoming) => {
  const seen = new Set();
  return [...(existing || []), ...(incoming || [])].map(cleanHierarchyText).filter(item => {
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isValidCourseSubject = (course, subject) => COURSES.includes(course)
  && (SUBJECTS_BY_COURSE[course] || []).includes(subject);

async function upsertSyllabusUnit({ organization, course, subject, name, subtopics }) {
  const unitName = cleanHierarchyText(name);
  const existingRows = await Topic.find({ course, subject, ...organizationScope(organization) });
  const existing = existingRows.find(row => row.name.toLocaleLowerCase() === unitName.toLocaleLowerCase());
  if (!existing) {
    await Topic.create({ organization:organization?._id || null, course, subject, name: unitName, subtopics, isActive: true });
    return 'created';
  }
  existing.name = unitName;
  existing.subtopics = mergeHierarchyText(existing.subtopics, subtopics);
  existing.isActive = true;
  await existing.save();
  return 'updated';
}

const completedResultStatus = { $in: ['submitted', 'auto_submitted'] };

function validatePdfFile(file, label = 'PDF') {
  if (!file) return null;
  if (Array.isArray(file)) throw new Error(`Upload one ${label} file.`);
  const extension = path.extname(file.name || '').toLowerCase();
  if (extension !== '.pdf' || !['application/pdf','application/octet-stream'].includes(file.mimetype)) {
    throw new Error(`${label} must be a PDF file.`);
  }
  const maxSize = parseInt(process.env.MAX_FILE_SIZE, 10) || 20 * 1024 * 1024;
  if (file.size > maxSize) throw new Error(`${label} must be below ${Math.floor(maxSize / 1024 / 1024)} MB.`);
  return file;
}

function cleanupIncompleteFiles(files) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (cleanupError) {
      console.error('Unable to clean up incomplete PDF upload:', cleanupError.message);
    }
  });
}

async function resultQueryFrom(filters = {}, organization = null) {
  const query = { status: completedResultStatus, ...organizationScope(organization) };
  if (filters.testId) query.testId = filters.testId;
  if (filters.groupId) {
    const memberships = await GroupMember.find(
      { groupId: filters.groupId, role: 'student' },
      'userId'
    );
    query.studentId = { $in: memberships.map(membership => membership.userId) };
  }
  return query;
}

async function validateScopedGroupIds(req, values) {
  const ids = [...new Set((Array.isArray(values) ? values : values ? [values] : []).map(String).filter(Boolean))];
  if (!ids.length) return [];
  const groups = await Group.find({ _id:{ $in:ids }, isActive:{ $ne:false }, ...organizationScope(req.organization) }, '_id');
  if (groups.length !== ids.length) throw new Error('One or more selected batches are unavailable.');
  return ids;
}

function subjectResultValue(result, subject) {
  const data = result.subjectScores?.[subject];
  if (!data) return '';
  if (data.status === 'ABSENT') return 'ABSENT';
  return Number(data.marks || 0);
}

function safeFilenamePart(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const scope = organizationScope(req.organization);
    const [students, groups, tests, memberships, questionCount] = await Promise.all([
      User.find({ role:'student', ...scope }).select('name rollNo isActive organization').lean(),
      Group.find({ isActive:{ $ne:false }, ...scope }).select('name course').lean(),
      Test.find({ isActive:{ $ne:false }, ...scope }).select('title status groups subject createdAt startTime endTime').lean(),
      GroupMember.find({ role:'student' }).select('groupId userId').lean(),
      Question.countDocuments({ isActive:{ $ne:false }, ...scope }),
    ]);
    const studentIds = new Set(students.map(student => String(student._id)));
    const groupIds = new Set(groups.map(group => String(group._id)));
    const testIds = new Set(tests.map(test => String(test._id)));
    const scopedMemberships = memberships.filter(item => groupIds.has(String(item.groupId)) && studentIds.has(String(item.userId)));
    const rawResults = studentIds.size && testIds.size ? await Result.find({
      studentId:{ $in:[...studentIds] }, testId:{ $in:[...testIds] }, status:completedResultStatus,
    }).select('studentId testId score totalMarks correctAnswers wrongAnswers partialAnswers skippedAnswers rank timeTaken submittedAt subjectScores topicScores').lean() : [];
    const studentMap = new Map(students.map(student => [String(student._id),student]));
    const testMap = new Map(tests.map(test => [String(test._id),test]));
    const results = rawResults.map(result => ({ ...result, studentId:studentMap.get(String(result.studentId)), testId:testMap.get(String(result.testId)) })).filter(result => result.studentId && result.testId);
    const reports = buildReports({ groups, students, memberships:scopedMemberships, tests, results });
    const analytics = buildAdminAnalytics({ reports, tests, results, questionCount });
    res.render('admin/dashboard', { title:'Admin Dashboard', analytics });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/auth/login'); }
};

// ── STUDENT MANAGEMENT ────────────────────────────────────────────────────────
exports.getStudents = async (req, res) => {
  try {
    const scope = organizationScope(req.organization);
    const [students, groups] = await Promise.all([
      User.find({ role:'student', ...scope }).sort({ rollNo:1 }),
      Group.find({ isActive:true, ...scope }),
    ]);
    res.render('admin/students', { title:'Manage Students', students, groups });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
};

exports.createStudent = async (req, res) => {
  try {
    const { name, rollNo, email, phone, parentContact, groupId } = req.body;
    if (!rollNo || !name) { req.flash('error','Name and Roll No required.'); return res.redirect('/admin/students'); }
    if (groupId) await validateScopedGroupIds(req, groupId);
    const exists = await User.findOne({ rollNo });
    if (exists) { req.flash('error',`Roll No ${rollNo} already exists.`); return res.redirect(req.get('Referer')||'/admin/students'); }
    const pwd = generatePassword(rollNo);
    const student = await User.create({
      name:String(name).trim(),
      rollNo:String(rollNo).trim(),
      email:String(email || '').trim().toLowerCase() || null,
      phone:String(phone || '').trim() || null,
      parentContact:String(parentContact || '').trim() || null,
      role:'student',
      password:pwd,
      isFirstLogin:true,
      organization:organizationIdForWrite(req),
    });
    if (groupId) await GroupMember.create({ groupId, userId:student._id, role:'student' });
    await Notification.create({ userId:student._id, title:'Account Created', message:`Welcome ${name}! Roll: ${rollNo}, Password: ${pwd}`, type:'info' });
    req.flash('success',`Student created. Password: ${pwd}`);
    res.redirect(req.get('Referer')||'/admin/students');
  } catch (e) {
    req.flash('error', e.code===11000 ? 'Roll number already exists.' : 'Failed: '+e.message);
    res.redirect(req.get('Referer')||'/admin/students');
  }
};

exports.bulkImportStudents = async (req, res) => {
  try {
    const groupId = req.params?.id || req.body.groupId;
    if (!req.files?.csvFile) { req.flash('error','No file uploaded.'); return res.redirect(req.get('Referer')||'/admin/groups'); }
    const group = groupId ? await Group.findOne({ _id: groupId, isActive: { $ne: false }, ...organizationScope(req.organization) }) : null;
    if (groupId && !group) {
      req.flash('error', 'Selected batch is not available.');
      return res.redirect(req.get('Referer') || '/admin/groups');
    }
    const wb   = xlsx.read(req.files.csvFile.data, { type:'buffer' });
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    let created=0, existing=0, assigned=0, skipped=0;
    for (const row of rows) {
      const rollNo = String(row['Roll No']||row.rollNo||'').trim();
      const name   = String(row['Name']||row.name||'').trim();
      if (!rollNo||!name) { skipped++; continue; }
      try {
        let student = await User.findOne({ rollNo, ...organizationScope(req.organization) });
        if (student) {
          existing++;
        } else {
          const pwd = generatePassword(rollNo);
          student = await User.create({ name, rollNo, parentContact:String(row['Parent Contact No']||row.parentContact||'').trim()||null, role:'student', password:pwd, isFirstLogin:true, organization:organizationIdForWrite(req) });
          created++;
        }
        if (group) {
          await GroupMember.findOneAndUpdate(
            { groupId: group._id, userId: student._id },
            { role:'student' },
            { upsert:true }
          );
          assigned++;
        }
      } catch { skipped++; }
    }
    let msg = `Imported ${created} new student(s).`;
    if (group) msg += ` Added ${assigned} student(s) to "${group.name}".`;
    if (existing) msg += ` ${existing} existing student(s) were retained.`;
    if (skipped) msg += ` ${skipped} skipped.`;
    req.flash('success', msg);
    res.redirect(req.get('Referer')||'/admin/groups');
  } catch (e) { req.flash('error','Import failed: '+e.message); res.redirect(req.get('Referer')||'/admin/groups'); }
};

// ── GROUPS ────────────────────────────────────────────────────────────────────
exports.getGroups = async (req, res) => {
  try {
    const scope = organizationScope(req.organization);
    const [groups, students, memberships] = await Promise.all([
      Group.find({ isActive:{ $ne:false }, ...scope }).sort({ createdAt:-1 }),
      User.find({ role:'student', isActive:true, ...scope }).sort({ rollNo:1 }),
      GroupMember.find().populate({ path:'userId', match:{ role:'student', ...scope }, select:'name rollNo' }).populate({ path:'groupId', match:{ ...scope }, select:'name' }),
    ]);
    // Attach members array to each group
    const memberMap = {};
    memberships.forEach(m => {
      const gid = m.groupId?._id?.toString();
      if (!gid) return;
      if (!memberMap[gid]) memberMap[gid] = [];
      memberMap[gid].push({ ...m.userId?.toObject(), GroupMember:{ role: m.role } });
    });
    const groupsWithMembers = groups.map(g => ({
      ...g.toObject(),
      id: g._id.toString(),
      members: memberMap[g._id.toString()] || [],
    }));
    res.render('admin/groups', { title:'Batches', groups: groupsWithMembers, students, COURSES, dateInputValue });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
};

exports.createGroup = async (req, res) => {
  try {
    const { name, description, academicYear, course } = req.body;
    const startDate = parseDateOnly(req.body.startDate, 'Batch start date');
    const endDate = parseDateOnly(req.body.endDate, 'Batch end date');
    validateDateRange(startDate, endDate, { start:'Batch start date', end:'Batch end date' });
    const group = await Group.create({ organization:organizationIdForWrite(req), name, description, academicYear:academicYear||process.env.ACADEMIC_YEAR, course:course||null, startDate, endDate });
    let imported=0, skipped=0;
    if (req.files?.csvFile) {
      const wb   = xlsx.read(req.files.csvFile.data, { type:'buffer' });
      const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      for (const row of rows) {
        try {
          const rollNo = String(row['Roll No']||row.rollNo||'').trim();
          const sName  = String(row['Name']||row.name||'').trim();
          if (!rollNo||!sName) { skipped++; continue; }
          const pw = generatePassword(rollNo);
          let student = await User.findOne({ rollNo, ...organizationScope(req.organization) });
          const isNew = !student;
          if (!student) student = await User.create({ name:sName, rollNo, email:String(row['Email']||row.email||'').trim()||null, phone:String(row['Phone']||row.phone||'').trim()||null, parentContact:String(row['Parent Contact No']||row.parentContact||'').trim()||null, role:'student', password:pw, isFirstLogin:true, organization:organizationIdForWrite(req) });
          await GroupMember.findOneAndUpdate({ groupId:group._id, userId:student._id }, { role:'student' }, { upsert:true });
          if (isNew) imported++; else skipped++;
        } catch { skipped++; }
      }
      req.flash('success',`Batch "${name}" created with ${imported} students${skipped?', '+skipped+' skipped':''}.`);
    } else {
      req.flash('success',`Batch "${name}" created.`);
    }
    res.redirect('/admin/groups');
  } catch (e) { req.flash('error','Failed. Name may already exist.'); res.redirect('/admin/groups'); }
};

exports.assignMember = async (req, res) => {
  try {
    const { groupId, userId } = req.body;
    const [group, student] = await Promise.all([
      Group.findOne({ _id:groupId, isActive:{ $ne:false }, ...organizationScope(req.organization) }),
      User.findOne({ _id:userId, role:'student', isActive:true, ...organizationScope(req.organization) }),
    ]);
    if (!group || !student) throw new Error('Batch or student is unavailable.');
    await GroupMember.findOneAndUpdate({ groupId, userId }, { role:'student' }, { upsert:true });
    req.flash('success','Member assigned.');
    res.redirect('/admin/groups');
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/groups'); }
};

exports.downloadStudentTemplate = (req, res) => {
  const rows = [
    { 'Name':'Arjun Mehta',   'Roll No':'2024CE001', 'Email':'arjun@example.com',  'Phone':'9876543210', 'Parent Contact No':'9876543200' },
    { 'Name':'Priya Patel',   'Roll No':'2024CE002', 'Email':'priya@example.com',  'Phone':'9876543211', 'Parent Contact No':'9876543201' },
    { 'Name':'Sample Student','Roll No':'2024CE003', 'Email':'sample@example.com', 'Phone':'',           'Parent Contact No':'' },
  ];
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:25},{wch:15},{wch:30},{wch:15},{wch:20}];
  xlsx.utils.book_append_sheet(wb, ws, 'Students');
  const buf = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Disposition','attachment; filename=student_import_template.xlsx');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
};

exports.exportGroupCredentials = async (req, res) => {
  try {
    const group = await Group.findOne({ _id:req.params.id, ...organizationScope(req.organization) });
    if (!group) { req.flash('error','Batch not found.'); return res.redirect('/admin/groups'); }
    const memberships = await GroupMember.find({ groupId:group._id, role:'student' })
      .populate({ path:'userId', match:{ role:'student', ...organizationScope(req.organization) }, select:'name rollNo parentContact' });
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin:40, size:'A4' });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename=credentials_${group.name.replace(/\s+/g,'_')}.pdf`);
    doc.pipe(res);
    doc.fontSize(16).font('Helvetica-Bold').text(process.env.COLLEGE_NAME||'College',{align:'center'});
    doc.fontSize(11).font('Helvetica').text(`Batch: ${group.name} | AY: ${group.academicYear||''}`,{align:'center'});
    doc.moveDown(0.5).moveTo(40,doc.y).lineTo(555,doc.y).stroke().moveDown(0.5);
    const colX=[40,150,300,420];
    doc.fontSize(9).font('Helvetica-Bold');
    ['Roll No','Name','Parent Contact','Password'].forEach((h,i)=>doc.text(h,colX[i],doc.y,{continued:i<3}));
    doc.moveDown(0.4).moveTo(40,doc.y).lineTo(555,doc.y).stroke().moveDown(0.3);
    doc.font('Helvetica').fontSize(9);
    for (const m of memberships) {
      const s = m.userId;
      if (!s) continue;
      const rowY = doc.y;
      const pwd  = generatePassword(s.rollNo||'');
      doc.text(s.rollNo||'',colX[0],rowY,{width:105});
      doc.text(s.name||'',colX[1],rowY,{width:145});
      doc.text(s.parentContact||'',colX[2],rowY,{width:115});
      doc.text(pwd,colX[3],rowY,{width:120});
      doc.moveDown(0.5);
      if (doc.y>750) doc.addPage();
    }
    doc.end();
  } catch (e) { console.error(e); res.status(500).send('PDF export failed.'); }
};

// ── TOPICS ────────────────────────────────────────────────────────────────────
exports.getTopics = async (req, res) => {
  try {
    const { course, subject } = req.query;
    const [topics, allTopics] = await Promise.all([
      loadTopics(req.organization, course, subject),
      Topic.find({ isActive:true, ...organizationScope(req.organization) }, 'course subtopics'),
    ]);
    const SUBJECTS = course ? (SUBJECTS_BY_COURSE[course]||ALL_SUBJECTS) : ALL_SUBJECTS;
    const courseStats = Object.fromEntries(COURSES.map(courseName => {
      const courseTopics = allTopics.filter(topic => topic.course === courseName);
      return [courseName, {
        units: courseTopics.length,
        subtopics: courseTopics.reduce((sum, topic) => sum + (topic.subtopics?.length || 0), 0),
      }];
    }));
    res.render('admin/topics', {
      title:'Syllabus Manager', topics, COURSES, SUBJECTS, SUBJECTS_BY_COURSE, courseStats,
      filterCourse:course||'', filterSubject:subject||'',
      aiEnabled:Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY),
    });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
};

exports.createTopic = async (req, res) => {
  try {
    const { name, course, subject, subtopics } = req.body;
    if (!isValidCourseSubject(course, subject)) throw new Error('Select a valid course and subject.');
    if (!cleanHierarchyText(name)) throw new Error('Unit name is required.');
    const result = await upsertSyllabusUnit({ organization:req.organization, course, subject, name, subtopics: parseSubtopics(subtopics) });
    req.flash('success', result === 'created' ? 'Syllabus unit added.' : 'Existing unit updated with the new subtopics.');
    res.redirect(`/admin/topics?course=${course}&subject=${encodeURIComponent(subject)}`);
  } catch (e) { req.flash('error','Failed: '+e.message); res.redirect('/admin/topics'); }
};

exports.importSyllabusPdf = async (req, res) => {
  const course = cleanHierarchyText(req.body.course).toUpperCase();
  const subject = cleanHierarchyText(req.body.subject);
  const redirectUrl = `/admin/topics?course=${encodeURIComponent(course)}${subject ? `&subject=${encodeURIComponent(subject)}` : ''}`;
  try {
    if (!COURSES.includes(course)) throw new Error('Select a valid course.');
    if (subject && !isValidCourseSubject(course, subject)) throw new Error('Select a valid subject for this course.');
    const file = req.files?.syllabusPdf;
    if (!file) throw new Error('Choose a syllabus PDF.');
    if (Array.isArray(file)) throw new Error('Upload one syllabus PDF at a time.');
    const extension = path.extname(file.name || '').toLocaleLowerCase();
    if (extension !== '.pdf' || !['application/pdf', 'application/octet-stream'].includes(file.mimetype)) {
      throw new Error('Only PDF files are supported.');
    }
    const maxSize = parseInt(process.env.MAX_FILE_SIZE, 10) || 20 * 1024 * 1024;
    if (file.size > maxSize) throw new Error(`PDF must be below ${Math.floor(maxSize / 1024 / 1024)} MB.`);

    const extraction = await extractSyllabusFromPdf(file, {
      course,
      subject,
      adminId:req.session?.user?.id || req.user?.id || '',
    });
    if (!extraction.units.length) throw new Error('No valid syllabus units were detected. Review the PDF and try again.');

    let created = 0;
    let updated = 0;
    for (const unit of extraction.units) {
      const result = await upsertSyllabusUnit({
        organization:req.organization,
        course,
        subject:unit.subject,
        name:unit.unitName,
        subtopics:unit.subtopics,
      });
      if (result === 'created') created += 1;
      else updated += 1;
    }

    let message = `Syllabus imported: ${created} unit(s) added and ${updated} unit(s) updated using ${extraction.model}.`;
    if (extraction.warnings.length) message += ` ${extraction.warnings.length} warning(s) need review.`;
    req.flash('success', message);
    res.redirect(redirectUrl);
  } catch (e) {
    console.error('Syllabus PDF import failed:', e);
    req.flash('error', 'Syllabus import failed: ' + e.message);
    res.redirect(COURSES.includes(course) ? redirectUrl : '/admin/topics');
  }
};

exports.updateTopic = async (req, res) => {
  try {
    const { name, subtopics } = req.body;
    if (!cleanHierarchyText(name)) throw new Error('Unit name is required.');
    const topic = await Topic.findOneAndUpdate(
      { _id:req.params.id, ...organizationScope(req.organization) },
      { name:cleanHierarchyText(name), subtopics:parseSubtopics(subtopics) }
    );
    if (!topic) throw new Error('Syllabus unit not found.');
    req.flash('success','Syllabus unit updated.');
    res.redirect('/admin/topics');
  } catch (e) { req.flash('error','Failed: '+e.message); res.redirect('/admin/topics'); }
};

exports.deleteTopic = async (req, res) => {
  try {
    await Topic.findOneAndUpdate({ _id:req.params.id, ...organizationScope(req.organization) }, { isActive:false });
    req.flash('success','Syllabus unit deleted.');
    res.redirect('/admin/topics');
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/topics'); }
};

exports.getSubjectsForCourse = (req, res) => res.json(SUBJECTS_BY_COURSE[req.params.course]||ALL_SUBJECTS);

exports.getTopicsForSubject = async (req, res) => {
  try { res.json(await loadTopics(req.organization, req.query.course, req.query.subject)); }
  catch { res.json([]); }
};

exports.getSubtopicsForTopic = async (req, res) => {
  try {
    const { course, subject, topic } = req.query;
    const q = { isActive:true, ...organizationScope(req.organization) };
    if (course)  q.course  = course;
    if (subject) q.subject = subject;
    if (topic)   q.name    = topic;
    const t = await Topic.findOne(q);
    res.json(t?.subtopics||[]);
  } catch { res.json([]); }
};

// ── QUESTIONS ─────────────────────────────────────────────────────────────────
exports.getQuestions = async (req, res) => {
  try {
    const {
      subject, topic, subtopic, difficulty, course, questionType,
      questionSubType, tag, search, questionId, sort='subject', page=1,
    } = req.query;
    const limit=25, skip=(page-1)*limit;
    const q = { isActive:true, ...organizationScope(req.organization) };
    if (subject)   q.subject   = hierarchyValuePattern(subject);
    if (difficulty) q.difficulty = difficulty;
    if (course) q.course = course;
    if (QUESTION_TYPES.includes(questionType)) q.questionType = questionType;
    if (QUESTION_SUB_TYPES.includes(questionSubType)) q.questionSubType = questionSubType;
    if (tag) q.tags = hierarchyValuePattern(tag);
    if (questionId && /^[a-f\d]{24}$/i.test(questionId)) q._id = questionId;
    if (search) {
      const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      q.$and = [{ $or:[
        { question:new RegExp(escaped, 'i') },
        { explanation:new RegExp(escaped, 'i') },
        { tags:new RegExp(escaped, 'i') },
      ] }];
    }
    const sortMap = {
      difficulty: { difficulty:1, subject:1 },
      newest:     { createdAt:-1 },
      oldest:     { createdAt:1 },
      subject:    { subject:1, topic:1, subtopic:1, difficulty:1, createdAt:-1 },
    };
    const topicRows = subject ? await loadTopics(req.organization, course, subject) : [];
    const selectedTopic = topicRows.find(row => stripUnitPrefix(row.name).toLocaleLowerCase() === stripUnitPrefix(topic).toLocaleLowerCase());
    let questions, total;
    if (selectedTopic) {
      const candidates = await Question.find(q).sort(sortMap[sort]||sortMap.subject);
      const topicMatches = candidates.filter(question => matchesSyllabusTopic(question.topic, selectedTopic));
      const subtopicMatches = subtopic
        ? topicMatches.filter(question => hierarchyValuePattern(subtopic).test(question.subtopic || ''))
        : topicMatches;
      const filteredQuestions = subtopicMatches.length || !subtopic ? subtopicMatches : topicMatches;
      total = filteredQuestions.length;
      questions = filteredQuestions.slice(skip, skip + limit);
    } else {
      const topicQuery = { ...q };
      if (topic) topicQuery.topic = hierarchyValuePattern(topic, { allowUnitPrefix: true });
      if (subtopic) topicQuery.subtopic = hierarchyValuePattern(subtopic);
      [questions, total] = await Promise.all([
        Question.find(topicQuery).sort(sortMap[sort]||sortMap.subject).skip(skip).limit(limit),
        Question.countDocuments(topicQuery),
      ]);
    }
    const subtopicList = selectedTopic?.subtopics || [];
    res.render('admin/questions', {
      title:'Question Bank', questions, total,
      currentPage:parseInt(page), totalPages:Math.ceil(total/limit),
      COURSES, SUBJECTS:ALL_SUBJECTS, topicRows, subtopicList,
      QUESTION_TYPES, QUESTION_SUB_TYPES, answerForDisplay,
      filters:{ subject, topic, subtopic, difficulty, course, questionType, questionSubType, tag, search, questionId, sort },
    });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
};

exports.createQuestion = async (req, res) => {
  try {
    const input = questionInputFromBody(req.body);
    let questionImage = req.body.questionImageUrl || null;
    if (req.files?.questionImage) {
      const { processQuestionImage } = require('../utils/imageUpload');
      questionImage = await processQuestionImage(req.files.questionImage, `q_${Date.now()}`);
    }
    await Question.create({ ...input, organization:organizationIdForWrite(req), questionImage, createdBy:req.session.user.id });
    req.flash('success','Question added.');
    res.redirect(`/admin/questions?subject=${encodeURIComponent(input.subject||'')}&topic=${encodeURIComponent(input.topic||'')}`);
  } catch (e) { req.flash('error','Failed: '+e.message); res.redirect('/admin/questions'); }
};

exports.bulkImportQuestions = async (req, res) => {
  try {
    if (!req.files?.csvFile) { req.flash('error','No file uploaded.'); return res.redirect('/admin/questions'); }
    const wb   = xlsx.read(req.files.csvFile.data, { type:'buffer' });
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    let created=0;
    for (const row of rows) {
      try {
        const input = questionInputFromBody({
          ...row,
          question:row.question||row.Question,
          optionA:row.optionA||row['Option A'], optionB:row.optionB||row['Option B'],
          optionC:row.optionC||row['Option C'], optionD:row.optionD||row['Option D'],
          correctAnswer:row.correctAnswer||row['Correct Answer']||'A',
          correctAnswers:row.correctAnswers||row['Correct Answers'],
          questionType:row.questionType||row['Question Type']||'SINGLE_CORRECT',
          questionSubType:row.questionSubType||row['Question Sub-Type'],
          numericalValue:row.numericalValue||row['Numerical Value'],
          numericalMin:row.numericalMin||row['Numerical Min'],
          numericalMax:row.numericalMax||row['Numerical Max'],
          numericalTolerance:row.numericalTolerance||row['Numerical Tolerance'],
          tags:row.tags||row.Tags,
          subject:row.subject||row.Subject||'Physics',
          difficulty:row.difficulty||row.Difficulty||'Medium',
        });
        await Question.create({
          ...input,
          questionImage: row.questionImageUrl || row.questionImage || row['Image URL'] || row['Question Image URL'] || null,
          organization:organizationIdForWrite(req),
          createdBy:req.session.user.id,
        });
        created++;
      } catch {}
    }
    req.flash('success',`${created} questions imported.`);
    res.redirect('/admin/questions');
  } catch (e) { req.flash('error','Import failed.'); res.redirect('/admin/questions'); }
};

exports.deleteQuestion = async (req, res) => {
  try {
    await Question.findOneAndUpdate({ _id:req.params.id, ...organizationScope(req.organization) }, { isActive:false });
    req.flash('success','Question removed.');
    res.redirect('/admin/questions');
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/questions'); }
};

// ── TESTS ─────────────────────────────────────────────────────────────────────
exports.getTests = async (req, res) => {
  try {
    const { subject, course } = req.query;
    const q = { isActive:{ $ne:false }, ...organizationScope(req.organization) };
    if (subject) q.subject = subject;
    if (course)  q.course  = course;
    const tests = await Test.find(q).populate('groups','name').sort({ createdAt:-1 });
    res.render('admin/tests', { title:'Tests', tests, COURSES, SUBJECTS:ALL_SUBJECTS, filterSubject:subject||'', filterCourse:course||'', timingLabel });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
};

exports.getCreateTest = async (req, res) => {
  try {
    const { subject, course, paperId } = req.query;
    const q = { isActive:true, ...organizationScope(req.organization) };
    if (subject) q.subject = subject;
    const examConfigurations = await ensureDefaultExamConfigurations(req.organization?._id);
    const [groups, questions, topics, sourcePaper] = await Promise.all([
      Group.find({ isActive:true, ...organizationScope(req.organization) }),
      Question.find(q).sort({ subject:1, difficulty:1 }),
      loadTopics(req.organization, course, subject),
      paperId ? QuestionPaper.findOne({ _id:paperId, isActive:{ $ne:false }, ...organizationScope(req.organization) }) : null,
    ]);
    const selectedQuestionIds = sourcePaper ? sourcePaper.questionIds.map(id => String(id)) : [];
    if (sourcePaper) {
      const availableIds = new Set(questions.map(question => String(question._id)));
      const unavailableCount = selectedQuestionIds.filter(id => !availableIds.has(id)).length;
      if (unavailableCount) throw new Error(`The paper contains ${unavailableCount} unavailable question(s). Edit the paper before creating a test.`);
    }
    res.render('admin/create-test', {
      title:'Create Test', groups, questions, COURSES, SUBJECTS:ALL_SUBJECTS, topics,
      filterSubject:subject||'', filterCourse:course||'', sourcePaper, selectedQuestionIds,
      TEST_TYPES, patterns:examConfigurations.patterns, rankingSchemas:examConfigurations.rankingSchemas,
      TIMING_MODES, RESULT_RELEASE_MODES,
      patternOptions:examConfigurations.patterns.map(pattern => ({
        id:String(pattern._id), code:pattern.code,
        defaultPositiveMarks:pattern.defaultPositiveMarks, defaultNegativeMarks:pattern.defaultNegativeMarks,
        defaultPartialMarks:pattern.defaultPartialMarks, partialMarkPolicy:pattern.partialMarkPolicy,
        shuffleQuestionsDefault:pattern.shuffleQuestionsDefault, shuffleOptionsDefault:pattern.shuffleOptionsDefault,
        rankingSchemaId:String(pattern.rankingSchema?._id || pattern.rankingSchema || ''),
        timingMode:pattern.timingMode,
      })),
      aiEnabled:Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY),
    });
  } catch (e) { req.flash('error',`Unable to create test from selection: ${e.message}`); res.redirect('/admin/tests'); }
};

exports.createTest = async (req, res) => {
  const persistedPdfFiles = [];
  try {
    const questionIds_raw = req.body.questionIds;
    const selectedQIds = Array.isArray(questionIds_raw) ? questionIds_raw : (questionIds_raw ? [questionIds_raw] : []);
    if (!selectedQIds.length) { req.flash('error','Select at least one question.'); return res.redirect('/admin/tests/create'); }
    const { title, description, duration, negativeMarking, passingMarks, shuffleQuestions, shuffleOptions, startTime, endTime, instructions, groupIds, courses, subjects, topic, subtopic, marksPerQuestion, sourceQuestionPaper, testPattern, rankingSchema, testType } = req.body;
    const sourcePaper = sourceQuestionPaper
      ? await QuestionPaper.findOne({ _id:sourceQuestionPaper, isActive:{ $ne:false }, ...organizationScope(req.organization) })
      : null;
    if (sourceQuestionPaper && !sourcePaper) throw new Error('Source question paper is unavailable.');
    const selectedSet = new Set(selectedQIds.map(String));
    const paperOrder = sourcePaper ? sourcePaper.questionIds.map(id => String(id)) : [];
    const effectiveSelectedQIds = sourcePaper
      ? [...paperOrder.filter(id => selectedSet.has(id)), ...selectedQIds.filter(id => !paperOrder.includes(String(id)))]
      : selectedQIds;
    const questionRows = await Question.find({ _id:{ $in:effectiveSelectedQIds }, ...organizationScope(req.organization) });
    const questionMap = new Map(questionRows.map(question => [question._id.toString(), question]));
    const questionsData = effectiveSelectedQIds.map(id => questionMap.get(String(id))).filter(Boolean);
    if (questionsData.length !== effectiveSelectedQIds.length) throw new Error('One or more selected questions are unavailable.');
    const examConfiguration = await resolveExamConfiguration(req.organization?._id, testPattern, rankingSchema);
    validateQuestionsForPattern(questionsData, examConfiguration.pattern);
    const parsedNegativeMarking = Math.max(0, Number(negativeMarking) || 0);
    const questionConfigs = buildQuestionConfigs(questionsData, req.body, { negativeMarking:parsedNegativeMarking });
    const totalMarks = totalMarksFromConfigs(questionConfigs);
    let questionPdfPath=null, solutionPdfPath=null;
    validatePdfFile(req.files?.questionPdf, 'Question paper');
    validatePdfFile(req.files?.solutionPdf, 'Solution paper');
    const groups = await validateScopedGroupIds(req, groupIds);
    const courseArr  = Array.isArray(courses)  ? courses  : (courses  ? [courses]  : []);
    const subjectArr = Array.isArray(subjects) ? subjects : (subjects ? [subjects] : []);
    const timing = timingInput({ timingMode:req.body.timingMode, duration, startTime:parseLocalDateTime(startTime), endTime:parseLocalDateTime(endTime) });
    const access = await accessConfiguration({ enabled:req.body.testAccessEnabled, password:req.body.testAccessPassword });
    const release = releaseConfiguration({
      resultReleaseMode:req.body.resultReleaseMode,
      resultReleaseAt:parseLocalDateTime(req.body.resultReleaseAt),
      endTime:timing.endTime,
    });
    if (req.files?.questionPdf) {
      const fn=`q_${Date.now()}.pdf`;
      const destination=path.join(PDF_DIR,fn);
      fs.writeFileSync(destination,req.files.questionPdf.data);
      persistedPdfFiles.push(destination);
      questionPdfPath='/uploads/pdfs/'+fn;
    }
    if (req.files?.solutionPdf) {
      const fn=`s_${Date.now()}.pdf`;
      const destination=path.join(PDF_DIR,fn);
      fs.writeFileSync(destination,req.files.solutionPdf.data);
      persistedPdfFiles.push(destination);
      solutionPdfPath='/uploads/pdfs/'+fn;
    }
    const test = await Test.create({
      title, description, duration:timing.duration, timingMode:timing.timingMode,
      testType:TEST_TYPES.includes(testType) ? testType : 'CUSTOM',
      testPattern:examConfiguration.pattern._id,
      patternSnapshot:examConfiguration.patternSnapshot,
      rankingSchema:examConfiguration.ranking._id,
      rankingSchemaSnapshot:examConfiguration.rankingSnapshot,
      organization:organizationIdForWrite(req),
      negativeMarking:parsedNegativeMarking, passingMarks:parseFloat(passingMarks)||null,
      shuffleQuestions:shuffleQuestions==='on', shuffleOptions:shuffleOptions==='on',
      startTime:timing.startTime, endTime:timing.endTime, instructions,
      totalMarks, createdBy:req.session.user.id, status:'draft',
      course: courseArr, subject: subjectArr, topic:topic||null, subtopic:subtopic||null,
      marksPerQuestion:parseFloat(marksPerQuestion)||1,
      questionPdfPath, solutionPdfPath,
      questions:effectiveSelectedQIds, questionConfigs, groups,
      sourceQuestionPaper:sourcePaper?._id || null,
      autoSubmitOnViolation:req.body.autoSubmitOnViolation==='on',
      maxTabSwitches:parseInt(req.body.maxTabSwitches)||3,
      maxFocusLosses:parseInt(req.body.maxFocusLosses)||5,
      blockCopyPaste:req.body.blockCopyPaste==='on',
      requireFullscreen:req.body.requireFullscreen==='on',
      ...access,
      ...release,
    });
    req.flash('success','Test created!');
    res.redirect(`/admin/tests/${test._id}`);
  } catch (e) {
    cleanupIncompleteFiles(persistedPdfFiles);
    req.flash('error','Failed: '+e.message);
    res.redirect('/admin/tests/create');
  }
};

exports.getTestDetail = async (req, res) => {
  try {
    const test = await Test.findOne({
      _id:req.params.id,
      ...organizationScope(req.organization),
    }).populate('questions').populate('groups','name');
    if (!test) { req.flash('error','Not found.'); return res.redirect('/admin/tests'); }
    const [results, recalculations] = await Promise.all([
      Result.find({ testId:req.params.id, status:{ $in:['submitted','auto_submitted'] }, ...organizationScope(req.organization) })
        .populate('studentId','name rollNo').sort({ rank:1, score:-1, timeTaken:1 }),
      ResultRecalculation.find({ testId:test._id, ...organizationScope(req.organization) })
        .populate('initiatedBy','name email').sort({ createdAt:-1 }).limit(10),
    ]);
    res.render('admin/test-detail', {
      title:test.title, test, results, recalculations, timingLabel, releaseLabel, answerForDisplay,
    });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/tests'); }
};

exports.publishTest = async (req, res) => {
  try {
    const test = await Test.findOne({ _id:req.params.id, isActive:{ $ne:false }, ...organizationScope(req.organization) });
    if (!test) { req.flash('error','Not found.'); return res.redirect('/admin/tests'); }
    await Test.findByIdAndUpdate(test._id, { status:'published' });
    // Notify all students in assigned groups
    const memberships = await GroupMember.find({ groupId:{ $in:test.groups }, role:'student' });
    await Promise.all(memberships.map(m =>
      Notification.create({ userId:m.userId, title:'New Exam Published', message:`"${test.title}" is now available. Timing: ${timingLabel(test)}.`, type:'exam', link:'/student/tests' })
    ));
    req.flash('success','Test published and students notified!');
    res.redirect(`/admin/tests/${test._id}`);
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/tests'); }
};

// ── RESULTS ───────────────────────────────────────────────────────────────────
exports.getAllResults = async (req, res) => {
  try {
    const selectedGroupId = String(req.query.groupId || '');
    const selectedTestId = String(req.query.testId || '');
    const query = await resultQueryFrom({
      groupId: selectedGroupId,
      testId: selectedTestId,
    }, req.organization);
    const [results, groups, tests] = await Promise.all([
      Result.find(query)
        .sort({ createdAt:-1 })
        .populate('studentId','name rollNo')
        .populate('testId','title course subject'),
      Group.find({ isActive:true, ...organizationScope(req.organization) }).sort({ name:1 }),
      Test.find({ ...organizationScope(req.organization) }).select('title groups status').sort({ createdAt:-1 }),
    ]);
    res.render('admin/results', {
      title:'Batch-wise Results',
      results,
      groups,
      tests,
      selectedGroupId,
      selectedTestId,
    });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
};

exports.exportResultsExcel = async (req, res) => {
  try {
    const selectedGroupId = String(req.query.groupId || '');
    const selectedTestId = String(req.query.testId || '');
    const query = await resultQueryFrom({
      groupId: selectedGroupId,
      testId: selectedTestId,
    }, req.organization);
    const results = await Result.find(query)
      .sort({ createdAt:-1 })
      .populate('studentId','name rollNo')
      .populate('testId','title');

    const studentIds = results
      .map(result => result.studentId?._id)
      .filter(Boolean);
    const memberships = studentIds.length
      ? await GroupMember.find({ userId: { $in: studentIds }, role:'student' })
          .populate({ path:'groupId', match:{ ...organizationScope(req.organization) }, select:'name' })
      : [];
    const batchesByStudent = new Map();
    memberships.forEach(membership => {
      const studentId = membership.userId.toString();
      const batchNames = batchesByStudent.get(studentId) || [];
      if (membership.groupId?.name && !batchNames.includes(membership.groupId.name)) {
        batchNames.push(membership.groupId.name);
      }
      batchesByStudent.set(studentId, batchNames);
    });

    const data = results.map(r => ({
      'Roll No':r.studentId?.rollNo,
      Name:r.studentId?.name,
      Batch:batchesByStudent.get(r.studentId?._id?.toString())?.join(', ') || '',
      Test:r.testId?.title,
      'Physics Marks':subjectResultValue(r, 'Physics'),
      'Chemistry Marks':subjectResultValue(r, 'Chemistry'),
      'Mathematics Marks':subjectResultValue(r, 'Mathematics'),
      'Total Marks Obtained':r.score,
      'Maximum Marks (Attempted Subjects)':r.totalMarks,
      'Full Test Marks':r.fullTotalMarks || r.totalMarks,
      Percentage:r.totalMarks>0?((r.score/r.totalMarks)*100).toFixed(1)+'%':'0%',
      Rank:r.rank||'', Status:r.status,
      Date:r.submittedAt?new Date(r.submittedAt).toLocaleDateString('en-IN'):'',
    }));
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch:14 }, { wch:24 }, { wch:24 }, { wch:32 },
      { wch:18 }, { wch:20 }, { wch:22 }, { wch:21 },
      { wch:36 }, { wch:18 }, { wch:13 }, { wch:9 },
      { wch:16 }, { wch:13 },
    ];
    xlsx.utils.book_append_sheet(wb, ws, 'Results');
    const buf = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
    const [selectedGroup, selectedTest] = await Promise.all([
      selectedGroupId ? Group.findOne({ _id:selectedGroupId, ...organizationScope(req.organization) }).select('name') : null,
      selectedTestId ? Test.findOne({ _id:selectedTestId, ...organizationScope(req.organization) }).select('title') : null,
    ]);
    const filename = [
      selectedGroup ? safeFilenamePart(selectedGroup.name, 'batch') : null,
      selectedTest ? safeFilenamePart(selectedTest.title, 'test') : null,
      'results',
    ].filter(Boolean).join('_') + '.xlsx';
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) { req.flash('error','Export failed.'); res.redirect('/admin/results'); }
};

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────
exports.getDocuments = async (req, res) => {
  try {
    const docs = await StudentDocument.find({ ...organizationScope(req.organization) }).sort({ createdAt:-1 }).populate('studentId','name rollNo');
    res.render('admin/documents', { title:'Student Documents', docs });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
};

exports.deleteDocument = async (req, res) => {
  try {
    const doc = await StudentDocument.findOne({ _id:req.params.id, ...organizationScope(req.organization) });
    if (doc) {
      const fp = path.join(__dirname,'..','public',doc.filePath);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await doc.deleteOne();
    }
    req.flash('success','Document deleted.');
    res.redirect('/admin/documents');
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/documents'); }
};

// ── GROUP DETAIL / EDIT / DELETE ──────────────────────────────────────────
exports.getGroupDetail = async (req, res) => {
  try {
    const scope = organizationScope(req.organization);
    const group = await Group.findOne({ _id:req.params.id, ...scope });
    if (!group) { req.flash('error','Batch not found.'); return res.redirect('/admin/groups'); }
    const memberships = await GroupMember.find({ groupId:group._id, role:'student' })
      .populate({ path:'userId', match:{ role:'student', ...organizationScope(req.organization) } });
    const members = memberships.map(m => m.userId).filter(Boolean);
    const allGroups = await Group.find({ isActive: true, ...scope });
    res.render('admin/group-detail', { title: group.name, group, members, allGroups });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/admin/groups'); }
};

exports.updateGroup = async (req, res) => {
  try {
    const { name, description, academicYear, course } = req.body;
    const startDate = parseDateOnly(req.body.startDate, 'Batch start date');
    const endDate = parseDateOnly(req.body.endDate, 'Batch end date');
    validateDateRange(startDate, endDate, { start:'Batch start date', end:'Batch end date' });
    const group = await Group.findOneAndUpdate(
      { _id:req.params.id, ...organizationScope(req.organization) },
      { name, description: description || null, academicYear: academicYear || process.env.ACADEMIC_YEAR, course:course||null, startDate, endDate },
      { new:true, runValidators:true }
    );
    if (!group) throw new Error('Batch not found.');
    req.flash('success', 'Batch updated.');
    res.redirect('/admin/groups');
  } catch (e) { req.flash('error', 'Failed: ' + e.message); res.redirect('/admin/groups'); }
};

exports.deleteGroup = async (req, res) => {
  try {
    const group = await Group.findOneAndUpdate(
      { _id:req.params.id, ...organizationScope(req.organization) },
      { isActive:false },
      { new:true }
    );
    if (!group) throw new Error('Batch not found.');
    await GroupMember.deleteMany({ groupId: group._id });
    req.flash('success', 'Batch deleted.');
    res.redirect('/admin/groups');
  } catch (e) { req.flash('error', 'Failed.'); res.redirect('/admin/groups'); }
};

exports.removeStudentFromGroup = async (req, res) => {
  try {
    const [group, student] = await Promise.all([
      Group.exists({ _id:req.params.id, ...organizationScope(req.organization) }),
      User.exists({ _id:req.params.studentId, role:'student', ...organizationScope(req.organization) }),
    ]);
    if (!group || !student) throw new Error('Batch or student not found.');
    await GroupMember.findOneAndDelete({ groupId: req.params.id, userId: req.params.studentId });
    req.flash('success', 'Student removed from batch.');
    res.redirect(`/admin/groups/${req.params.id}`);
  } catch (e) { req.flash('error', 'Failed.'); res.redirect(`/admin/groups/${req.params.id}`); }
};

exports.moveStudentToGroup = async (req, res) => {
  try {
    const { targetGroupId } = req.body;
    const [source, target, student] = await Promise.all([
      Group.exists({ _id:req.params.id, ...organizationScope(req.organization) }),
      Group.exists({ _id:targetGroupId, ...organizationScope(req.organization) }),
      User.exists({ _id:req.params.studentId, role:'student', ...organizationScope(req.organization) }),
    ]);
    if (!source || !target || !student) throw new Error('Batch or student not found.');
    await GroupMember.findOneAndDelete({ groupId: req.params.id, userId: req.params.studentId });
    await GroupMember.findOneAndUpdate({ groupId: targetGroupId, userId: req.params.studentId }, { role: 'student' }, { upsert: true });
    req.flash('success', 'Student moved to new batch.');
    res.redirect(`/admin/groups/${req.params.id}`);
  } catch (e) { req.flash('error', 'Failed.'); res.redirect(`/admin/groups/${req.params.id}`); }
};

// ── DELETE STUDENT ─────────────────────────────────────────────────────────
exports.deleteStudent = async (req, res) => {
  try {
    const studentId = req.params.id;

    const student = await User.findOne({ _id:studentId, role:'student', ...organizationScope(req.organization) });

    if (!student) {
      req.flash("error", "Student not found.");
      return res.redirect("/admin/students");
    }

    // Delete student from groups
    await GroupMember.deleteMany({
      $or: [
        { userId: studentId },
        { user: studentId },
        { studentId: studentId }
      ]
    });

    // Permanently delete student
    await User.findByIdAndDelete(studentId);

    req.flash("success", "Student deleted successfully.");
    return res.redirect("/admin/students");
  } catch (error) {
    console.error("Delete student error:", error);

    req.flash("error", "Failed to delete student.");
    return res.redirect("/admin/students");
  }
};
// ── VIEW STUDENT PROFILE ──────────────────────────────────────────────────
exports.viewStudentProfile = async (req, res) => {
  try {
    const student = await User.findOne({ _id:req.params.id, role:'student', ...organizationScope(req.organization) });
    if (!student || student.role !== 'student') { req.flash('error','Student not found.'); return res.redirect('/admin/students'); }
    const [memberships, documents, results] = await Promise.all([
      GroupMember.find({ userId:student._id }).populate({ path:'groupId', match:{ ...organizationScope(req.organization) }, select:'name academicYear' }),
      StudentDocument.find({ studentId:student._id, ...organizationScope(req.organization) }).sort({ createdAt:-1 }),
      Result.find({ studentId:student._id, status:{ $in:['submitted','auto_submitted'] }, ...organizationScope(req.organization) }).populate('testId','title totalMarks').sort({ createdAt:-1 }).limit(10),
    ]);
    res.render('admin/student-profile', { title: student.name, student, memberships, documents, results });
  } catch (e) { console.error(e); req.flash('error','Failed.'); res.redirect('/admin/students'); }
};

// ── EDIT TEST ─────────────────────────────────────────────────────────────
exports.getEditTest = async (req, res) => {
  try {
    const examConfigurations = await ensureDefaultExamConfigurations(req.organization?._id);
    const [test, groups, questions] = await Promise.all([
      Test.findOne({ _id:req.params.id, ...organizationScope(req.organization) }).select('+testAccessHash').populate('questions').populate('groups','name'),
      Group.find({ isActive:true, ...organizationScope(req.organization) }),
      Question.find({ isActive:true, ...organizationScope(req.organization) }).sort({ subject:1, difficulty:1 }),
    ]);
    if (!test) { req.flash('error','Not found.'); return res.redirect('/admin/tests'); }
    const testAccessConfigured = Boolean(test.testAccessHash);
    test.testAccessHash = undefined;
    res.render('admin/edit-test', {
      title:'Edit Test', test, groups, questions, COURSES, SUBJECTS:ALL_SUBJECTS,
      formatDateTimeLocal,
      questionConfigMap:configsByQuestionId(test),
      TEST_TYPES, patterns:examConfigurations.patterns, rankingSchemas:examConfigurations.rankingSchemas,
      TIMING_MODES, RESULT_RELEASE_MODES, testAccessConfigured,
      patternOptions:examConfigurations.patterns.map(pattern => ({
        id:String(pattern._id), code:pattern.code,
        defaultPositiveMarks:pattern.defaultPositiveMarks, defaultNegativeMarks:pattern.defaultNegativeMarks,
        defaultPartialMarks:pattern.defaultPartialMarks, partialMarkPolicy:pattern.partialMarkPolicy,
        shuffleQuestionsDefault:pattern.shuffleQuestionsDefault, shuffleOptionsDefault:pattern.shuffleOptionsDefault,
        rankingSchemaId:String(pattern.rankingSchema?._id || pattern.rankingSchema || ''),
        timingMode:pattern.timingMode,
      })),
    });
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/tests'); }
};

exports.updateTest = async (req, res) => {
  try {
    const questionIds_raw = req.body.questionIds;
    const selectedQIds = Array.isArray(questionIds_raw) ? questionIds_raw : (questionIds_raw ? [questionIds_raw] : []);
    const { title, description, duration, negativeMarking, passingMarks, shuffleQuestions, shuffleOptions, startTime, endTime, instructions, groupIds, courses, subjects, testPattern, rankingSchema, testType } = req.body;
    const existingTest = await Test.findOne({ _id:req.params.id, isActive:{ $ne:false }, ...organizationScope(req.organization) }).select('+testAccessHash');
    if (!existingTest) throw new Error('Test not found.');
    const effectiveQuestionIds = selectedQIds.length ? selectedQIds : existingTest.questions.map(id => String(id));
    const questionRows = await Question.find({ _id:{ $in:effectiveQuestionIds }, ...organizationScope(req.organization) });
    const questionMap = new Map(questionRows.map(question => [question._id.toString(), question]));
    const questionsData = effectiveQuestionIds.map(id => questionMap.get(String(id))).filter(Boolean);
    if (questionsData.length !== effectiveQuestionIds.length) throw new Error('One or more selected questions are unavailable.');
    const examConfiguration = await resolveExamConfiguration(req.organization?._id, testPattern, rankingSchema);
    validateQuestionsForPattern(questionsData, examConfiguration.pattern);
    const parsedNegativeMarking = Math.max(0, Number(negativeMarking) || 0);
    const questionConfigs = buildQuestionConfigs(questionsData, req.body, { negativeMarking:parsedNegativeMarking }, existingTest);
    const totalMarks = totalMarksFromConfigs(questionConfigs);
    const groups = await validateScopedGroupIds(req, groupIds);
    const courseArr  = Array.isArray(courses)  ? courses  : (courses  ? [courses]  : []);
    const subjectArr = Array.isArray(subjects) ? subjects : (subjects ? [subjects] : []);
    const timing = timingInput({ timingMode:req.body.timingMode, duration, startTime:parseLocalDateTime(startTime), endTime:parseLocalDateTime(endTime) });
    const access = await accessConfiguration({ enabled:req.body.testAccessEnabled, password:req.body.testAccessPassword, existingHash:existingTest.testAccessHash, existingUpdatedAt:existingTest.testAccessUpdatedAt });
    const release = releaseConfiguration({
      resultReleaseMode:req.body.resultReleaseMode,
      resultReleaseAt:parseLocalDateTime(req.body.resultReleaseAt),
      endTime:timing.endTime,
      existingTest,
    });
    await Test.findByIdAndUpdate(req.params.id, {
      title, description, duration:timing.duration, timingMode:timing.timingMode,
      testType:TEST_TYPES.includes(testType) ? testType : 'CUSTOM',
      testPattern:examConfiguration.pattern._id,
      patternSnapshot:examConfiguration.patternSnapshot,
      rankingSchema:examConfiguration.ranking._id,
      rankingSchemaSnapshot:examConfiguration.rankingSnapshot,
      negativeMarking:parsedNegativeMarking,
      passingMarks:parseFloat(passingMarks)||null,
      shuffleQuestions:shuffleQuestions==='on', shuffleOptions:shuffleOptions==='on',
      startTime:timing.startTime, endTime:timing.endTime, instructions,
      course: courseArr, subject: subjectArr, groups, totalMarks,
      autoSubmitOnViolation:req.body.autoSubmitOnViolation==='on',
      maxTabSwitches:parseInt(req.body.maxTabSwitches)||3,
      maxFocusLosses:parseInt(req.body.maxFocusLosses)||5,
      blockCopyPaste:req.body.blockCopyPaste==='on',
      requireFullscreen:req.body.requireFullscreen==='on',
      questions:effectiveQuestionIds,
      questionConfigs,
      ...access,
      ...release,
    });
    await updateRanks(req.params.id);
    req.flash('success','Test updated!');
    res.redirect(`/admin/tests/${req.params.id}`);
  } catch (e) { req.flash('error','Failed: '+e.message); res.redirect(`/admin/tests/${req.params.id}`); }
};

exports.deleteTest = async (req, res) => {
  try {
    const test = await Test.findOneAndUpdate(
      { _id:req.params.id, isActive:{ $ne:false }, ...organizationScope(req.organization) },
      { isActive:false, status:'closed', groups:[] },
      { returnDocument:'after' }
    );
    if (!test) { req.flash('error','Test not found or already deleted.'); return res.redirect('/admin/tests'); }
    req.flash('success','Test deleted.');
    res.redirect('/admin/tests');
  } catch (e) { req.flash('error','Failed.'); res.redirect('/admin/tests'); }
};

exports.releaseTestResults = async (req, res) => {
  try {
    const test = await Test.findOneAndUpdate(
      { _id:req.params.id, isActive:{ $ne:false }, ...organizationScope(req.organization) },
      { resultsReleased:true },
      { new:true }
    );
    if (!test) throw new Error('Test not found.');
    const submitted = await Result.find({ testId:test._id, status:{ $in:['submitted','auto_submitted'] } }, 'studentId');
    const studentIds = [...new Set(submitted.map(result => String(result.studentId)))];
    if (studentIds.length) {
      await Notification.insertMany(studentIds.map(userId => ({
        userId,
        title:'Exam Result Available',
        message:`Your result for "${test.title}" is now available.`,
        type:'success',
        link:'/student/results',
      })));
    }
    req.flash('success',`Results released. ${studentIds.length} submitted student(s) notified.`);
    res.redirect(`/admin/tests/${test._id}`);
  } catch (error) {
    req.flash('error',`Unable to release results: ${error.message}`);
    res.redirect(`/admin/tests/${req.params.id}`);
  }
};

// ── QUESTION TEMPLATE DOWNLOAD ────────────────────────────────────────────
exports.downloadQuestionTemplate = (req, res) => {
  const rows = [
    { question:'What is the SI unit of force?', questionType:'SINGLE_CORRECT', questionSubType:'conceptual', optionA:'Joule', optionB:'Newton', optionC:'Watt', optionD:'Pascal', correctAnswer:'B', correctAnswers:'', numericalValue:'', numericalMin:'', numericalMax:'', numericalTolerance:'', tags:'Physics,Revision', subject:'Physics', topic:'Laws of Motion', subtopic:'', difficulty:'Easy', marks:1, explanation:'Force = mass × acceleration. SI unit is Newton (N).', questionImageUrl:'' },
    { question:'Select all prime numbers.', questionType:'MULTIPLE_CORRECT', questionSubType:'conceptual', optionA:'2', optionB:'3', optionC:'4', optionD:'6', correctAnswer:'', correctAnswers:'A,B', numericalValue:'', numericalMin:'', numericalMax:'', numericalTolerance:'', tags:'Practice', subject:'Mathematics', topic:'Numbers', subtopic:'', difficulty:'Easy', marks:2, explanation:'2 and 3 are prime.', questionImageUrl:'' },
    { question:'Enter the value of 2 + 2.', questionType:'NUMERICAL', questionSubType:'numerical', optionA:'', optionB:'', optionC:'', optionD:'', correctAnswer:'', correctAnswers:'', numericalValue:4, numericalMin:'', numericalMax:'', numericalTolerance:0, tags:'Practice', subject:'Mathematics', topic:'Arithmetic', subtopic:'', difficulty:'Easy', marks:1, explanation:'2 + 2 = 4.', questionImageUrl:'' },
  ];
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  ws['!cols'] = Array(Object.keys(rows[0]).length).fill({wch:18});
  ws['!cols'][0] = {wch:60};
  xlsx.utils.book_append_sheet(wb, ws, 'Questions');
  const buf = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Disposition','attachment; filename=question_import_template.xlsx');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
};

exports.getUploadTest = async (req, res) => {
  try {
    const groups = await Group.find({ isActive:true, ...organizationScope(req.organization) });
    res.render('admin/upload-test', { title: 'Upload Test via PDF', groups, COURSES, SUBJECTS: ALL_SUBJECTS, TIMING_MODES, RESULT_RELEASE_MODES });
  } catch (e) { req.flash('error', 'Failed.'); res.redirect('/admin/tests'); }
};

exports.uploadPdfTest = async (req, res) => {
  const persistedPdfFiles = [];
  try {
    if (!req.files?.questionPdf) { req.flash('error','Question PDF required.'); return res.redirect('/admin/tests/upload'); }
    validatePdfFile(req.files.questionPdf, 'Question paper');
    validatePdfFile(req.files?.solutionPdf, 'Solution paper');
    const { title, description, duration, negativeMarking, startTime, endTime, instructions, groupIds, courses, subjects, marksPerQuestion } = req.body;
    if (!title?.trim()) { req.flash('error','Test title required.'); return res.redirect('/admin/tests/upload'); }
    const qBuf   = req.files.questionPdf.data;
    let pdfPageCount=0;
    try {
      const ps = qBuf.toString('latin1');
      const pm = ps.match(/\/Type\s*\/Page[^s]/g);
      pdfPageCount = pm ? pm.length : 0;
      if (!pdfPageCount) { const cm=ps.match(/\/Count\s+(\d+)/); pdfPageCount=cm?parseInt(cm[1]):0; }
    } catch {}
    const mpq=parseFloat(marksPerQuestion)||1;
    const totalMarks=pdfPageCount>0?pdfPageCount*mpq:mpq;
    const groups=await validateScopedGroupIds(req, groupIds);
    const courseArr  = Array.isArray(courses)  ? courses  : (courses  ? [courses]  : []);
    const subjectArr = Array.isArray(subjects) ? subjects : (subjects ? [subjects] : []);
    const timing = timingInput({
      timingMode:req.body.timingMode,
      duration,
      startTime:parseLocalDateTime(startTime),
      endTime:parseLocalDateTime(endTime),
    });
    const release = releaseConfiguration({
      resultReleaseMode:req.body.resultReleaseMode,
      resultReleaseAt:parseLocalDateTime(req.body.resultReleaseAt),
      endTime:timing.endTime,
    });
    const qFname = `q_${Date.now()}.pdf`;
    const questionDestination=path.join(PDF_DIR,qFname);
    fs.writeFileSync(questionDestination,qBuf);
    persistedPdfFiles.push(questionDestination);
    const questionPdfPath = '/uploads/pdfs/'+qFname;
    let solutionPdfPath = null;
    if (req.files?.solutionPdf) {
      const fn=`s_${Date.now()}.pdf`;
      const destination=path.join(PDF_DIR,fn);
      fs.writeFileSync(destination,req.files.solutionPdf.data);
      persistedPdfFiles.push(destination);
      solutionPdfPath='/uploads/pdfs/'+fn;
    }
    const test = await Test.create({
      title:title.trim(), description:description||null, duration:timing.duration, timingMode:timing.timingMode,
      organization:organizationIdForWrite(req),
      negativeMarking:parseFloat(negativeMarking)||0.25, startTime:timing.startTime, endTime:timing.endTime,
      instructions:instructions||null, totalMarks, createdBy:req.session.user.id, status:'draft',
      course:courseArr, subject:subjectArr, marksPerQuestion:mpq,
      questionPdfPath, solutionPdfPath, groups,
      autoSubmitOnViolation:req.body.autoSubmitOnViolation==='on',
      maxTabSwitches:parseInt(req.body.maxTabSwitches)||3,
      maxFocusLosses:parseInt(req.body.maxFocusLosses)||5,
      blockCopyPaste:req.body.blockCopyPaste!=='off',
      requireFullscreen:req.body.requireFullscreen==='on',
      ...release,
    });
    const pageInfo=pdfPageCount>0?` Detected ${pdfPageCount} page(s) — ${totalMarks} total marks.`:'';
    req.flash('success',`PDF test "${test.title}" created!${pageInfo}${solutionPdfPath?' Model answers attached.':''}`);
    res.redirect(`/admin/tests/${test._id}`);
  } catch (e) {
    cleanupIncompleteFiles(persistedPdfFiles);
    console.error(e);
    req.flash('error','Failed: '+e.message);
    res.redirect('/admin/tests/upload');
  }
};

// ── PDF TEMPLATE ──────────────────────────────────────────────────────────────
exports.downloadPdfTestTemplate = (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size:'A4', margin:50 });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=question_paper_template.pdf');
    doc.pipe(res);
    const W=595.28, pageW=W-100;
    const pageHeader=(qNum,total,type)=>{
      doc.rect(50,40,pageW,28).fill('#1e3a5f');
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text(`SVPN TEST  ·  Question ${qNum} of ${total}`,58,49).text(type,50,49,{width:pageW,align:'right'});
      doc.fillColor('#1e3a5f').fontSize(7).font('Helvetica').text('⚠  1 QUESTION PER PAGE  —  Do not merge pages',50,74,{width:pageW,align:'center'});
      doc.moveTo(50,84).lineTo(W-50,84).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    };
    const drawOptions=(opts,startY)=>{
      const labels=['A','B','C','D']; let y=startY;
      opts.forEach((opt,i)=>{ doc.rect(50,y,14,14).strokeColor('#94a3b8').lineWidth(0.8).stroke(); doc.fillColor('#374151').fontSize(11).font('Helvetica-Bold').text(labels[i]+'.',68,y+1); doc.font('Helvetica').fillColor('#1f2937').text(opt,88,y+1,{width:pageW-38}); y=doc.y+6; });
      return y;
    };
    const answerBox=(answer,explanation)=>{
      const y=doc.y+14; doc.rect(50,y,pageW,explanation?56:26).fill('#f0fdf4').stroke();
      doc.fillColor('#166534').fontSize(9).font('Helvetica-Bold').text(`✔  Correct Answer: (${answer})`,58,y+7);
      if(explanation) doc.fillColor('#374151').font('Helvetica').fontSize(8.5).text(`Explanation: ${explanation}`,58,y+22,{width:pageW-16});
      doc.fillColor('#94a3b8').fontSize(7).font('Helvetica').text('— END OF QUESTION —',50,doc.page.height-50,{width:pageW,align:'center'});
    };
    pageHeader(1,5,'TEXT QUESTION'); doc.moveDown(0.5);
    doc.fillColor('#1e3a5f').fontSize(10).font('Helvetica-Bold').text('SUBJECT: Physics   |   TOPIC: Laws of Motion   |   MARKS: 2',50,95,{width:pageW});
    doc.moveDown(0.8); doc.fillColor('#111827').fontSize(12.5).font('Helvetica-Bold').text('Q1.  A body of mass 5 kg moves at 10 m/s. A force of 20 N acts for 3 s. What is the final velocity?',50,doc.y,{width:pageW});
    doc.moveDown(1); drawOptions(['25 m/s','22 m/s','20 m/s','30 m/s'],doc.y); answerBox('B','v = u + at = 10 + (20/5)×3 = 22 m/s');
    doc.addPage(); pageHeader(2,5,'QUESTION WITH DIAGRAM'); doc.moveDown(0.5);
    doc.fillColor('#1e3a5f').fontSize(10).font('Helvetica-Bold').text('SUBJECT: Physics   |   TOPIC: Optics   |   MARKS: 3',50,95,{width:pageW});
    doc.moveDown(0.8); doc.fillColor('#111827').fontSize(12.5).font('Helvetica-Bold').text('Q2.  Refer to the ray diagram below. Identify the type of lens and image formed:',50,doc.y,{width:pageW});
    doc.moveDown(0.8);
    const imgY=doc.y,imgH=130;
    doc.rect(50,imgY,pageW,imgH).fill('#f8fafc').strokeColor('#94a3b8').lineWidth(1).stroke();
    doc.moveTo(50,imgY).lineTo(50+pageW,imgY+imgH).strokeColor('#cbd5e1').lineWidth(0.5).dash(4,{space:4}).stroke();
    doc.moveTo(50+pageW,imgY).lineTo(50,imgY+imgH).stroke(); doc.undash();
    doc.fillColor('#64748b').fontSize(11).font('Helvetica-Bold').text('[ Diagram / Image Area ]',50,imgY+imgH/2-18,{width:pageW,align:'center'});
    doc.fillColor('#94a3b8').fontSize(8.5).font('Helvetica').text('Embed your diagram here using a PDF editor',50,imgY+imgH/2,{width:pageW,align:'center'});
    doc.y=imgY+imgH+12; drawOptions(['Convex lens; real and inverted','Concave lens; virtual and erect','Convex lens; virtual and erect','Concave lens; real and inverted'],doc.y);
    answerBox('A','Convex lens forms a real, inverted image when object is beyond F.');
    doc.addPage(); pageHeader(3,5,'TEXT QUESTION'); doc.moveDown(0.5);
    doc.fillColor('#1e3a5f').fontSize(10).font('Helvetica-Bold').text('SUBJECT: Chemistry   |   TOPIC: Chemical Bonding   |   MARKS: 1',50,95,{width:pageW});
    doc.moveDown(0.8); doc.fillColor('#111827').fontSize(12.5).font('Helvetica-Bold').text('Q3.  Bond angle in H₂O is approximately:',50,doc.y,{width:pageW});
    doc.moveDown(1); drawOptions(['90°','109.5°','104.5°','120°'],doc.y); answerBox('C','2 lone pairs compress the bond angle to ~104.5°.');
    doc.addPage(); pageHeader(4,5,'QUESTION WITH STRUCTURE / IMAGE'); doc.moveDown(0.5);
    doc.fillColor('#1e3a5f').fontSize(10).font('Helvetica-Bold').text('SUBJECT: Chemistry   |   TOPIC: Organic Chemistry   |   MARKS: 2',50,95,{width:pageW});
    doc.moveDown(0.8); doc.fillColor('#111827').fontSize(12.5).font('Helvetica-Bold').text('Q4.  The structural formula below belongs to which class of organic compound?',50,doc.y,{width:pageW});
    doc.moveDown(0.8);
    const sY=doc.y,sH=110;
    doc.rect(50,sY,pageW,sH).fill('#fffbeb').strokeColor('#fbbf24').lineWidth(1).stroke();
    doc.fillColor('#92400e').fontSize(11).font('Helvetica-Bold').text('[ Structural Formula / Chemical Structure Image ]',50,sY+sH/2-16,{width:pageW,align:'center'});
    doc.y=sY+sH+12; drawOptions(['Alcohol','Aldehyde','Ketone','Carboxylic Acid'],doc.y); answerBox('D','–COOH functional group = Carboxylic acid.');
    doc.addPage(); pageHeader(5,5,'TEXT QUESTION'); doc.moveDown(0.5);
    doc.fillColor('#1e3a5f').fontSize(10).font('Helvetica-Bold').text('SUBJECT: Mathematics   |   TOPIC: Integration   |   MARKS: 4',50,95,{width:pageW});
    doc.moveDown(0.8); doc.fillColor('#111827').fontSize(12.5).font('Helvetica-Bold').text('Q5.  Evaluate: ∫ (2x³ + 3x² − x + 5) dx',50,doc.y,{width:pageW});
    doc.moveDown(1); drawOptions(['(x⁴/2) + x³ − (x²/2) + 5x + C','(x⁴/2) + x³ + (x²/2) + 5x + C','2x⁴ + 3x³ − x² + 5x + C','x⁴ + x³ − x² + 5 + C'],doc.y);
    answerBox('A','∫2x³dx=x⁴/2, ∫3x²dx=x³, ∫−x dx=−x²/2, ∫5dx=5x');
    doc.end();
  } catch (e) { console.error(e); res.status(500).send('Template failed: '+e.message); }
};

// ── ANSWER KEY TEMPLATE ───────────────────────────────────────────────────────
exports.downloadAnswerKeyTemplate = (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=answer_key_template.pdf');
    doc.pipe(res);

    const W = 595.28, pageW = W - 100;
    const NAVY = '#1e3a5f', GREEN = '#166534', LIGHT_GREEN = '#f0fdf4',
          BORDER_GREEN = '#bbf7d0', SLATE = '#374151';

    const drawHeader = () => {
      doc.rect(50, 40, pageW, 34).fill(NAVY);
      doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold').text('ANSWER KEY', 58, 48);
      doc.fontSize(9).font('Helvetica').text('Fill in your actual answers below and upload as Solution PDF', 58, 62);
      doc.fontSize(9).font('Helvetica-Bold').text('MODEL ANSWERS & EXPLANATIONS', 58, 48, { width: pageW, align: 'right' });
      doc.moveTo(50, 80).lineTo(W - 50, 80).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    };

    const drawRow = (qNum, ans, subject, topic, explanation, marks) => {
      if (doc.y > 730) { doc.addPage(); drawHeader(); doc.y = 95; }
      const y = doc.y + 3;
      const rowH = explanation ? 60 : 34;
      if (qNum % 2 === 0) doc.rect(50, y, pageW, rowH).fill('#f8fafc');
      doc.roundedRect(54, y + 7, 26, 20, 4).fill(NAVY);
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text('Q' + qNum, 54, y + 11, { width: 26, align: 'center' });
      doc.circle(110, y + 17, 10).fill(GREEN);
      doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text(ans, 101, y + 11, { width: 20, align: 'center' });
      doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text(subject + (topic ? '  \xb7  ' + topic : ''), 128, y + 7);
      doc.fillColor(GREEN).fontSize(8).font('Helvetica-Bold').text('+' + marks + ' mark' + (marks !== 1 ? 's' : ''), 128, y + 18);
      if (explanation) {
        doc.rect(128, y + 30, pageW - 82, rowH - 36).fill(LIGHT_GREEN).strokeColor(BORDER_GREEN).lineWidth(0.5).stroke();
        doc.fillColor(GREEN).fontSize(7.5).font('Helvetica-Bold').text('Explanation: ', 132, y + 35, { continued: true });
        doc.fillColor(SLATE).font('Helvetica').text(explanation, { width: pageW - 92 });
      }
      doc.y = y + rowH + 2;
    };

    drawHeader();
    doc.y = 90;

    doc.rect(50, doc.y, pageW, 26).fill('#eff6ff').strokeColor('#bfdbfe').lineWidth(0.5).stroke();
    doc.fillColor('#1e40af').fontSize(8).font('Helvetica-Bold').text('HOW TO USE:  ', 58, doc.y + 5, { continued: true });
    doc.font('Helvetica').text('Replace Q numbers, answers (A/B/C/D), subject, topic, marks and explanation with your actual exam answers. Upload this as the Solution PDF when creating a test.', { width: pageW - 20 });
    doc.y += 32;

    doc.rect(50, doc.y, pageW, 18).fill('#e2e8f0');
    doc.fillColor('#475569').fontSize(8).font('Helvetica-Bold')
       .text('Q', 58, doc.y + 5)
       .text('Ans', 96, doc.y + 5)
       .text('Subject  /  Topic', 128, doc.y + 5)
       .text('Marks', W - 90, doc.y + 5);
    doc.y += 22;

    const rows = [
      { q:1,  a:'B', sub:'Physics',     top:'Laws of Motion',    m:2, exp:'F=ma => a=4 m/s2. v = u + at = 10 + 4x3 = 22 m/s.' },
      { q:2,  a:'A', sub:'Physics',     top:'Optics',            m:3, exp:'Convex lens forms real inverted image when object is beyond F.' },
      { q:3,  a:'C', sub:'Chemistry',   top:'Chemical Bonding',  m:1, exp:'2 lone pairs in H2O compress bond angle to ~104.5 degrees.' },
      { q:4,  a:'D', sub:'Chemistry',   top:'Organic Chemistry', m:2, exp:'COOH functional group = Carboxylic Acid.' },
      { q:5,  a:'A', sub:'Mathematics', top:'Integration',       m:4, exp:'Integral(2x3)=x4/2, Integral(3x2)=x3, Integral(-x)=-x2/2, Integral(5)=5x. Add C.' },
      { q:6,  a:'C', sub:'Physics',     top:'Kinematics',        m:2, exp:'' },
      { q:7,  a:'B', sub:'Chemistry',   top:'Periodic Table',    m:1, exp:'' },
      { q:8,  a:'D', sub:'Mathematics', top:'Calculus',          m:2, exp:'' },
      { q:9,  a:'A', sub:'Biology',     top:'Cell Biology',      m:1, exp:'' },
      { q:10, a:'B', sub:'Physics',     top:'Thermodynamics',    m:2, exp:'' },
    ];
    rows.forEach(function(r) { drawRow(r.q, r.a, r.sub, r.top, r.exp, r.m); });

    doc.addPage();
    drawHeader();
    doc.y = 95;

    doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text('SUBJECT-WISE SUMMARY', 50, doc.y);
    doc.y += 18;

    const cols = [50, 220, 310, 400];
    const hdrs = ['Subject', 'Questions', 'Total Marks', 'Notes'];
    doc.rect(50, doc.y, pageW, 20).fill(NAVY);
    hdrs.forEach(function(h, i) { doc.fillColor('#fff').fontSize(8.5).font('Helvetica-Bold').text(h, cols[i] + 4, doc.y + 6, { width: 90 }); });
    doc.y += 22;

    var summaryRows = [
      { sub:'Physics', qs:4, marks:9 },
      { sub:'Chemistry', qs:3, marks:4 },
      { sub:'Mathematics', qs:2, marks:6 },
      { sub:'Biology', qs:1, marks:1 },
    ];
    summaryRows.forEach(function(s, i) {
      var ry = doc.y;
      if (i % 2 === 0) doc.rect(50, ry, pageW, 20).fill('#f8fafc');
      doc.fillColor(SLATE).fontSize(9).font('Helvetica-Bold').text(s.sub, cols[0]+4, ry+6);
      doc.font('Helvetica').text(String(s.qs), cols[1]+4, ry+6).text(String(s.marks), cols[2]+4, ry+6).text('', cols[3]+4, ry+6);
      doc.moveTo(50, ry+20).lineTo(W-50, ry+20).strokeColor('#e2e8f0').lineWidth(0.4).stroke();
      doc.y = ry + 22;
    });

    doc.rect(50, doc.y, pageW, 22).fill(NAVY);
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
       .text('TOTAL', cols[0]+4, doc.y+7)
       .text('10', cols[1]+4, doc.y+7)
       .text('20', cols[2]+4, doc.y+7);
    doc.y += 30;

    doc.rect(50, doc.y, pageW, 34).fill('#fefce8').strokeColor('#fde047').lineWidth(0.5).stroke();
    doc.fillColor('#713f12').fontSize(8).font('Helvetica-Bold').text('TIP:  ', 58, doc.y + 6, { continued: true });
    doc.font('Helvetica').text('Edit this PDF in Adobe Acrobat, LibreOffice Draw or Canva. Replace sample values with your actual exam answers. Keep the same layout. Upload as Solution PDF when creating a test.', { width: pageW - 16 });

    doc.end();
  } catch (e) { console.error(e); res.status(500).send('Answer key template failed: ' + e.message); }
};
