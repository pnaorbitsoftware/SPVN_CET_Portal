const mongoose = require('mongoose');
const { Question, QuestionPaper, Test } = require('../models');
const { organizationIdForWrite, organizationScope } = require('../services/organizationService');
const { QUESTION_SUB_TYPES, QUESTION_TYPES, answerForDisplay } = require('../services/questionService');
const { paperInputFromBody } = require('../services/questionPaperService');

const COURSES = ['JEE','CET','NEET'];
const SUBJECTS = ['Physics','Chemistry','Mathematics','Biology','English','General Knowledge'];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return String(value).split(',');
}

function selectedIds(body = {}) {
  return [...new Set(values(body.questionIds).map(id => String(id).trim()).filter(Boolean))];
}

function paperScope(req, extra = {}) {
  return { ...extra, ...organizationScope(req.organization) };
}

async function findPaper(req, { populate = false, includeDeleted = false } = {}) {
  let query = QuestionPaper.findOne(paperScope(req, {
    _id:req.params.id,
    ...(includeDeleted ? {} : { isActive:{ $ne:false } }),
  }));
  if (populate) query = query.populate('questionIds').populate('createdBy', 'name');
  return query;
}

async function questionsForIds(req, ids) {
  if (!ids.length) throw new Error('Select at least one question.');
  if (ids.some(id => !mongoose.isValidObjectId(id))) throw new Error('One or more question IDs are invalid.');
  const rows = await Question.find({ _id:{ $in:ids }, isActive:true, ...organizationScope(req.organization) });
  const byId = new Map(rows.map(question => [String(question._id), question]));
  const ordered = ids.map(id => byId.get(String(id))).filter(Boolean);
  if (ordered.length !== ids.length) throw new Error('One or more selected questions are unavailable.');
  return ordered;
}

function baseCode(title) {
  return String(title || 'PAPER').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'PAPER';
}

async function availableCode(req, requested, title) {
  const base = baseCode(requested || title);
  let code = base;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const exists = await QuestionPaper.exists({
      organization:organizationIdForWrite(req), code, isActive:{ $ne:false },
    });
    if (!exists) return code;
    code = `${base.slice(0, 48)}_${String(attempt + 2).padStart(2, '0')}`;
  }
  throw new Error('Unable to allocate a unique question paper code.');
}

function questionSearchFilter(req) {
  const clauses = [{ isActive:true }, organizationScope(req.organization)];
  const { course, subject, topic, subtopic, difficulty, questionType, questionSubType, tag, search, questionId } = req.query;
  if (course) clauses.push({ course:String(course).toUpperCase() });
  if (subject) clauses.push({ subject });
  if (topic) clauses.push({ topic:new RegExp(escapeRegex(topic), 'i') });
  if (subtopic) clauses.push({ subtopic:new RegExp(escapeRegex(subtopic), 'i') });
  if (difficulty) clauses.push({ difficulty });
  if (QUESTION_TYPES.includes(questionType)) clauses.push({ questionType });
  if (QUESTION_SUB_TYPES.includes(questionSubType)) clauses.push({ questionSubType });
  if (tag) clauses.push({ tags:new RegExp(`^${escapeRegex(tag)}$`, 'i') });
  if (questionId) {
    if (!mongoose.isValidObjectId(questionId)) return { _id:null };
    clauses.push({ _id:questionId });
  }
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    clauses.push({ $or:[{ question:pattern }, { topic:pattern }, { subtopic:pattern }, { tags:pattern }] });
  }
  return { $and:clauses };
}

function serializeQuestion(question) {
  return {
    id:String(question._id),
    question:question.question,
    subject:question.subject,
    topic:question.topic || null,
    subtopic:question.subtopic || null,
    difficulty:question.difficulty,
    questionType:question.questionType || 'SINGLE_CORRECT',
    questionSubType:question.questionSubType || null,
    tags:question.tags || [],
    marks:Number(question.marks) || 0,
    answer:answerForDisplay(question),
    explanation:question.explanation || null,
  };
}

exports.list = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 18;
    const clauses = [{ isActive:{ $ne:false } }, organizationScope(req.organization)];
    if (req.query.status) clauses.push({ status:req.query.status });
    if (req.query.course) clauses.push({ course:req.query.course });
    if (req.query.subject) clauses.push({ subjects:req.query.subject });
    if (req.query.tag) clauses.push({ tags:new RegExp(`^${escapeRegex(req.query.tag)}$`, 'i') });
    if (req.query.search) {
      const pattern = new RegExp(escapeRegex(req.query.search), 'i');
      clauses.push({ $or:[{ title:pattern }, { code:pattern }, { description:pattern }, { tags:pattern }, { topics:pattern }] });
    }
    const query = { $and:clauses };
    const [papers, total, tags] = await Promise.all([
      QuestionPaper.find(query).populate('createdBy', 'name').sort({ createdAt:-1 }).skip((page - 1) * limit).limit(limit),
      QuestionPaper.countDocuments(query),
      QuestionPaper.distinct('tags', paperScope(req, { isActive:{ $ne:false } })),
    ]);
    res.render('admin/question-papers', {
      title:'Question Paper Library', papers, total, page, totalPages:Math.max(1, Math.ceil(total / limit)),
      tags:tags.sort(), COURSES, SUBJECTS, filters:req.query,
    });
  } catch (error) {
    console.error('Question paper list error:', error);
    req.flash('error','Unable to load question papers.');
    res.redirect('/admin/dashboard');
  }
};

async function renderForm(req, res, paper = null) {
  const [initialQuestions, selectedQuestions] = await Promise.all([
    Question.find({ isActive:true, ...organizationScope(req.organization) }).sort({ createdAt:-1 }).limit(50),
    paper ? Question.find({ _id:{ $in:paper.questionIds }, ...organizationScope(req.organization) }) : [],
  ]);
  const selectedMap = new Map(selectedQuestions.map(question => [String(question._id), question]));
  const orderedSelected = paper
    ? paper.questionIds.map(id => selectedMap.get(String(id))).filter(Boolean)
    : [];
  res.render('admin/question-paper-form', {
    title:paper ? 'Edit Question Paper' : 'Create Question Paper',
    paper, COURSES, SUBJECTS, QUESTION_TYPES, QUESTION_SUB_TYPES,
    initialQuestions:initialQuestions.map(serializeQuestion),
    selectedQuestions:orderedSelected.map(serializeQuestion),
  });
}

exports.getCreate = async (req, res) => {
  try { await renderForm(req, res); }
  catch (error) { console.error(error); req.flash('error','Unable to open paper creator.'); res.redirect('/admin/question-papers'); }
};

exports.create = async (req, res) => {
  try {
    const questions = await questionsForIds(req, selectedIds(req.body));
    const input = paperInputFromBody(req.body, questions);
    input.code = await availableCode(req, input.code, input.title);
    const paper = await QuestionPaper.create({
      ...input,
      organization:organizationIdForWrite(req),
      createdBy:req.session.user.id,
      isActive:true,
    });
    req.flash('success','Question paper created.');
    res.redirect(`/admin/question-papers/${paper._id}`);
  } catch (error) {
    console.error('Question paper create error:', error);
    req.flash('error', `Unable to create paper: ${error.message}`);
    res.redirect('/admin/question-papers/create');
  }
};

exports.view = async (req, res) => {
  try {
    const paper = await findPaper(req, { populate:true });
    if (!paper) { req.flash('error','Question paper not found.'); return res.redirect('/admin/question-papers'); }
    res.render('admin/question-paper-detail', {
      title:paper.title, paper,
      questions:paper.questionIds.map(question => ({ question, answer:answerForDisplay(question) })),
    });
  } catch (error) { console.error(error); req.flash('error','Unable to load question paper.'); res.redirect('/admin/question-papers'); }
};

exports.getEdit = async (req, res) => {
  try {
    const paper = await findPaper(req);
    if (!paper) { req.flash('error','Question paper not found.'); return res.redirect('/admin/question-papers'); }
    await renderForm(req, res, paper);
  } catch (error) { console.error(error); req.flash('error','Unable to edit question paper.'); res.redirect('/admin/question-papers'); }
};

exports.update = async (req, res) => {
  try {
    const paper = await findPaper(req);
    if (!paper) throw new Error('Question paper not found.');
    const questions = await questionsForIds(req, selectedIds(req.body));
    const input = paperInputFromBody(req.body, questions);
    if (input.code && input.code !== paper.code) {
      const duplicate = await QuestionPaper.exists({
        _id:{ $ne:paper._id }, organization:organizationIdForWrite(req), code:input.code, isActive:{ $ne:false },
      });
      if (duplicate) throw new Error('That question paper code is already in use.');
    }
    if (!input.code) input.code = paper.code;
    Object.assign(paper, input);
    await paper.save();
    req.flash('success','Question paper updated.');
    res.redirect(`/admin/question-papers/${paper._id}`);
  } catch (error) {
    console.error('Question paper update error:', error);
    req.flash('error', `Unable to update paper: ${error.message}`);
    res.redirect(`/admin/question-papers/${req.params.id}/edit`);
  }
};

exports.duplicate = async (req, res) => {
  try {
    const source = await findPaper(req);
    if (!source) throw new Error('Question paper not found.');
    const title = `${source.title} Copy`;
    const code = await availableCode(req, `${source.code}_COPY`, title);
    const copy = await QuestionPaper.create({
      ...source.toObject(), _id:undefined, createdAt:undefined, updatedAt:undefined,
      title, code, status:'draft', createdBy:req.session.user.id,
      duplicatedFrom:source._id, isActive:true,
    });
    req.flash('success','Question paper duplicated as a draft.');
    res.redirect(`/admin/question-papers/${copy._id}/edit`);
  } catch (error) { console.error(error); req.flash('error',`Unable to duplicate paper: ${error.message}`); res.redirect('/admin/question-papers'); }
};

exports.archive = async (req, res) => {
  try {
    const paper = await findPaper(req);
    if (!paper) throw new Error('Question paper not found.');
    paper.status = paper.status === 'archived' ? 'draft' : 'archived';
    await paper.save();
    req.flash('success', paper.status === 'archived' ? 'Question paper archived.' : 'Question paper restored as draft.');
    res.redirect(`/admin/question-papers/${paper._id}`);
  } catch (error) { req.flash('error',error.message); res.redirect('/admin/question-papers'); }
};

exports.remove = async (req, res) => {
  try {
    const paper = await findPaper(req);
    if (!paper) throw new Error('Question paper not found.');
    const usedByTests = await Test.countDocuments({ sourceQuestionPaper:paper._id, isActive:{ $ne:false } });
    paper.isActive = false;
    paper.status = 'archived';
    await paper.save();
    req.flash('success', usedByTests
      ? `Paper removed from the library. ${usedByTests} linked test(s) remain unchanged.`
      : 'Question paper removed safely.');
    res.redirect('/admin/question-papers');
  } catch (error) { req.flash('error',error.message); res.redirect('/admin/question-papers'); }
};

exports.createTest = async (req, res) => {
  const paper = await findPaper(req);
  if (!paper) { req.flash('error','Question paper not found.'); return res.redirect('/admin/question-papers'); }
  if (paper.status === 'archived') { req.flash('error','Restore this paper before creating a test from it.'); return res.redirect(`/admin/question-papers/${paper._id}`); }
  return res.redirect(`/admin/tests/create?paperId=${paper._id}`);
};

exports.searchQuestions = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
    const query = questionSearchFilter(req);
    const [questions, total] = await Promise.all([
      Question.find(query).sort({ createdAt:-1 }).skip((page - 1) * limit).limit(limit),
      Question.countDocuments(query),
    ]);
    res.json({ questions:questions.map(serializeQuestion), page, total, totalPages:Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    console.error('Question paper question search error:', error);
    res.status(500).json({ error:'Unable to search the question bank.' });
  }
};

exports._private = { availableCode, baseCode, questionSearchFilter, questionsForIds, selectedIds, serializeQuestion };
