const mongoose = require('mongoose');
const { Question, TestPart, Topic } = require('../models');
const { organizationIdForWrite, organizationScope } = require('../services/organizationService');
const { answerForDisplay, questionInputFromBody } = require('../services/questionService');
const { SUBJECTS, questionConfigsFromBody, testPartMetadata } = require('../services/testPartService');

function scoped(req, extra = {}) {
  return { ...extra, ...organizationScope(req.organization) };
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
    marks:Number(question.marks) || 0,
    answer:answerForDisplay(question),
  };
}

async function findPart(req, populate = false) {
  let query = TestPart.findOne(scoped(req, { _id:req.params.id, isActive:{ $ne:false } }));
  if (populate) query = query.populate('questionConfigs.questionId').populate('createdBy', 'name');
  return query;
}

async function renderBuilder(req, res, part = null) {
  const subject = part?.subject || String(req.query.subject || 'Physics');
  const [initialRows, hierarchy] = await Promise.all([
    Question.find(scoped(req, { isActive:true, subject })).sort({ createdAt:-1 }).limit(40),
    Topic.find(scoped(req, { isActive:true, subject })).sort({ name:1 }),
  ]);
  const selectedQuestions = (part?.questionConfigs || []).flatMap(config => {
    if (!config.questionId?._id) return [];
    return [{
      ...serializeQuestion(config.questionId),
      positiveMarks:Number(config.positiveMarks),
      negativeMarks:Number(config.negativeMarks),
    }];
  });
  res.render('admin/test-part-form', {
    title:part ? `Build ${part.name}` : 'New Subject Test Part',
    part,
    SUBJECTS,
    selectedSubject:subject,
    hierarchy,
    initialQuestions:initialRows.map(serializeQuestion),
    selectedQuestions,
  });
}

exports.list = async (req, res) => {
  try {
    const query = scoped(req, { isActive:{ $ne:false } });
    if (SUBJECTS.includes(req.query.subject)) query.subject = req.query.subject;
    if (['draft','ready','archived'].includes(req.query.status)) query.status = req.query.status;
    const parts = await TestPart.find(query).populate('createdBy', 'name').sort({ updatedAt:-1 });
    res.render('admin/test-parts', {
      title:'Subject Test Parts', parts, SUBJECTS,
      filters:{ subject:req.query.subject || '', status:req.query.status || '' },
    });
  } catch (error) {
    console.error('Test part list error:', error);
    req.flash('error','Unable to load subject test parts.');
    res.redirect('/admin/tests');
  }
};

exports.getCreate = async (req, res) => {
  try { await renderBuilder(req, res); }
  catch (error) { console.error(error); req.flash('error','Unable to open the subject-part builder.'); res.redirect('/admin/test-parts'); }
};

exports.create = async (req, res) => {
  try {
    const metadata = testPartMetadata(req.body);
    if (metadata.status === 'ready') metadata.status = 'draft';
    const part = await TestPart.create({
      ...metadata,
      organization:organizationIdForWrite(req),
      createdBy:req.session.user.id,
      questionConfigs:[],
    });
    req.flash('success','Test part created. Add questions and marks now.');
    res.redirect(`/admin/test-parts/${part._id}/edit`);
  } catch (error) {
    req.flash('error',error.message);
    res.redirect('/admin/test-parts/create');
  }
};

exports.getEdit = async (req, res) => {
  try {
    const part = await findPart(req, true);
    if (!part) { req.flash('error','Test part not found.'); return res.redirect('/admin/test-parts'); }
    await renderBuilder(req, res, part);
  } catch (error) { console.error(error); req.flash('error','Unable to open this test part.'); res.redirect('/admin/test-parts'); }
};

exports.update = async (req, res) => {
  try {
    const part = await findPart(req);
    if (!part) throw new Error('Test part not found.');
    const metadata = testPartMetadata(req.body);
    const configs = questionConfigsFromBody(req.body, metadata);
    const questionIds = configs.map(config => config.questionId);
    const questions = questionIds.length
      ? await Question.find(scoped(req, { _id:{ $in:questionIds }, isActive:true, subject:metadata.subject }), '_id')
      : [];
    if (questions.length !== questionIds.length) throw new Error('Every selected question must be active and from this part’s subject.');
    if (metadata.status === 'ready' && !configs.length) throw new Error('Add at least one question before marking this part Ready.');
    Object.assign(part, metadata, { questionConfigs:configs });
    await part.save();
    req.flash('success', metadata.status === 'ready' ? 'Test part is ready to combine.' : 'Test part saved.');
    res.redirect(`/admin/test-parts/${part._id}/edit`);
  } catch (error) {
    req.flash('error',error.message);
    res.redirect(`/admin/test-parts/${req.params.id}/edit`);
  }
};

exports.addQuestion = async (req, res) => {
  try {
    const part = await findPart(req);
    if (!part) throw new Error('Test part not found.');
    const input = questionInputFromBody({
      ...req.body,
      subject:part.subject,
      topic:req.body.topic || part.topic,
      subtopic:req.body.subtopic || part.subtopic,
      marks:req.body.positiveMarks || part.defaultPositiveMarks,
    }, { subject:part.subject, marks:part.defaultPositiveMarks });
    const question = await Question.create({
      ...input,
      organization:organizationIdForWrite(req),
      createdBy:req.session.user.id,
    });
    part.questionConfigs.push({
      questionId:question._id,
      positiveMarks:Math.max(0, Number(req.body.positiveMarks ?? part.defaultPositiveMarks) || 0),
      negativeMarks:Math.max(0, Number(req.body.negativeMarks ?? part.defaultNegativeMarks) || 0),
      displayOrder:part.questionConfigs.length,
    });
    await part.save();
    req.flash('success','Question and answer added to this test part.');
    res.redirect(`/admin/test-parts/${part._id}/edit#questions`);
  } catch (error) {
    req.flash('error',`Question not added: ${error.message}`);
    res.redirect(`/admin/test-parts/${req.params.id}/edit#new-question`);
  }
};

exports.archive = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new Error('Invalid test part.');
    const part = await findPart(req);
    if (!part) throw new Error('Test part not found.');
    part.status = 'archived';
    await part.save();
    req.flash('success','Test part archived. Existing combined tests remain unchanged.');
  } catch (error) { req.flash('error',error.message); }
  res.redirect('/admin/test-parts');
};

exports._private = { serializeQuestion };
