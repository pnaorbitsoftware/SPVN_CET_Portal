const { Question } = require('../models');
const { organizationScope } = require('../services/organizationService');
const { answerForDisplay } = require('../services/questionService');
const { DATASET } = require('../services/pyqDatasetService');

const EXAMS = [
  { code:'JEE', label:'JEE', description:'Main & Advanced', subjects:['Physics', 'Chemistry', 'Mathematics'] },
  { code:'NEET', label:'NEET', description:'UG medical entrance', subjects:['Physics', 'Chemistry', 'Biology'] },
  { code:'CET', label:'MHT-CET', description:'Maharashtra CET', subjects:['Physics', 'Chemistry', 'Mathematics', 'Biology'] },
];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactPattern(value) {
  return new RegExp(`^${escapeRegex(value)}$`, 'i');
}

function safeExam(value) {
  const normalized = String(value || 'JEE').trim().toUpperCase();
  return EXAMS.some(exam => exam.code === normalized) ? normalized : 'JEE';
}

function scope(req, extra = {}) {
  return { sourceType:'PYQ', isActive:true, ...organizationScope(req.organization), ...extra };
}

function pageUrl(query, overrides = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...query, ...overrides }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') params.set(key, value);
  });
  return `/admin/pyq?${params.toString()}`;
}

exports.list = async (req, res) => {
  try {
    const exam = safeExam(req.query.exam);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 30;
    const filters = {
      exam,
      variant:String(req.query.variant || '').trim(),
      subject:String(req.query.subject || '').trim(),
      topic:String(req.query.topic || '').trim(),
      subtopic:String(req.query.subtopic || '').trim(),
      year:String(req.query.year || '').trim(),
      questionType:String(req.query.questionType || '').trim(),
      difficulty:String(req.query.difficulty || '').trim(),
      search:String(req.query.search || '').trim(),
    };
    const query = scope(req, { 'pyq.exam':exam });
    if (filters.variant) query['pyq.variant'] = exactPattern(filters.variant);
    if (filters.subject) query.subject = exactPattern(filters.subject);
    if (filters.topic) query.topic = exactPattern(filters.topic);
    if (filters.subtopic) query.subtopic = exactPattern(filters.subtopic);
    if (/^(?:19|20)\d{2}$/.test(filters.year)) query['pyq.year'] = Number(filters.year);
    if (['SINGLE_CORRECT', 'MULTIPLE_CORRECT', 'NUMERICAL', 'TRUE_FALSE'].includes(filters.questionType)) query.questionType = filters.questionType;
    if (['Easy', 'Medium', 'Hard'].includes(filters.difficulty)) query.difficulty = filters.difficulty;
    if (filters.search) {
      const pattern = new RegExp(escapeRegex(filters.search), 'i');
      query.$and = [{ $or:[{ question:pattern }, { explanation:pattern }, { topic:pattern }, { subtopic:pattern }, { tags:pattern }] }];
    }

    const examBase = scope(req, { 'pyq.exam':exam });
    const hierarchyMatch = { ...examBase };
    if (filters.variant) hierarchyMatch['pyq.variant'] = exactPattern(filters.variant);
    const [questions, total, examCounts, variants, subjects, topics, subtopics, years, hierarchy] = await Promise.all([
      Question.find(query).sort({ 'pyq.year':-1, subject:1, topic:1, question:1 }).skip((page - 1) * limit).limit(limit),
      Question.countDocuments(query),
      Promise.all(EXAMS.map(async item => ({ ...item, count:await Question.countDocuments(scope(req, { 'pyq.exam':item.code })) }))),
      Question.distinct('pyq.variant', examBase),
      Question.distinct('subject', examBase),
      Question.distinct('topic', { ...examBase, ...(filters.subject ? { subject:exactPattern(filters.subject) } : {}) }),
      Question.distinct('subtopic', { ...examBase, ...(filters.subject ? { subject:exactPattern(filters.subject) } : {}), ...(filters.topic ? { topic:exactPattern(filters.topic) } : {}) }),
      Question.distinct('pyq.year', examBase),
      Question.aggregate([
        { $match:hierarchyMatch },
        { $group:{ _id:{ subject:'$subject', topic:'$topic' }, count:{ $sum:1 }, years:{ $addToSet:'$pyq.year' } } },
        { $sort:{ '_id.subject':1, count:-1, '_id.topic':1 } },
      ]),
    ]);

    const hierarchyBySubject = {};
    hierarchy.forEach(row => {
      const subject = row._id.subject || 'Other';
      hierarchyBySubject[subject] ||= [];
      hierarchyBySubject[subject].push({
        name:row._id.topic || 'Uncategorized',
        count:row.count,
        yearCount:row.years.length,
      });
    });

    res.render('admin/pyq-library', {
      title:'Previous Year Questions',
      questions,
      total,
      page,
      totalPages:Math.max(1, Math.ceil(total / limit)),
      filters,
      examCounts,
      selectedExam:EXAMS.find(item => item.code === exam),
      variants:variants.filter(Boolean).sort(),
      subjects:subjects.filter(Boolean).sort(),
      topics:topics.filter(Boolean).sort(),
      subtopics:subtopics.filter(Boolean).sort(),
      years:years.filter(Boolean).sort((a, b) => b - a),
      hierarchyBySubject,
      answerForDisplay,
      pageUrl:(overrides = {}) => pageUrl(filters, overrides),
      dataset:DATASET,
    });
  } catch (error) {
    console.error('PYQ library error:', error);
    req.flash('error', 'Unable to load the PYQ library.');
    res.redirect('/admin/dashboard');
  }
};

exports._private = { EXAMS, escapeRegex, pageUrl, safeExam };
