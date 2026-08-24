const mongoose = require('mongoose');
const { Group, GroupMember, Notification, Question, Test, TestPart } = require('../models');
const { parseLocalDateTime } = require('../utils/dateTime');
const { organizationIdForWrite, organizationScope } = require('../services/organizationService');
const { accessConfiguration } = require('../services/testAccessService');
const { TEST_TYPES, ensureDefaultExamConfigurations, resolveExamConfiguration, validateQuestionsForPattern } = require('../services/examConfigurationService');
const { RESULT_RELEASE_MODES, releaseConfiguration } = require('../services/resultReleaseService');
const { TIMING_MODES, timingInput } = require('../services/timingService');
const { SUBJECTS, combinedPartQuestions } = require('../services/testPartService');
const { totalMarksFromConfigs } = require('../services/testConfigurationService');

const COURSES = ['JEE','CET','NEET'];
const SESSION_KEY = 'combinedTestWizard';

function list(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

function scoped(req, extra = {}) {
  return { ...extra, ...organizationScope(req.organization) };
}

function organizationKey(req) {
  return String(req.organization?._id || organizationIdForWrite(req) || 'default');
}

function freshWizard(req) {
  return { organizationKey:organizationKey(req), partIds:[], identity:{}, audience:{}, delivery:{} };
}

function currentWizard(req) {
  if (!req.session[SESSION_KEY] || req.session[SESSION_KEY].organizationKey !== organizationKey(req)) {
    req.session[SESSION_KEY] = freshWizard(req);
  }
  return req.session[SESSION_KEY];
}

async function partsFor(req, ids, { readyOnly = true } = {}) {
  const unique = [...new Set(list(ids))];
  if (!unique.length) throw new Error('Select at least one subject test part.');
  if (unique.some(id => !mongoose.isValidObjectId(id))) throw new Error('One or more selected test parts are invalid.');
  const query = scoped(req, { _id:{ $in:unique }, isActive:{ $ne:false } });
  if (readyOnly) query.status = 'ready';
  const rows = await TestPart.find(query);
  const byId = new Map(rows.map(row => [String(row._id), row]));
  const ordered = unique.map(id => byId.get(id)).filter(Boolean);
  if (ordered.length !== unique.length) throw new Error('A selected test part is unavailable or not Ready.');
  if (ordered.some(part => !part.questionConfigs.length)) throw new Error('Every selected test part must contain questions.');
  return ordered;
}

async function wizardSummary(req) {
  const wizard = currentWizard(req);
  const parts = await partsFor(req, wizard.partIds);
  const groups = wizard.audience.groupIds?.length
    ? await Group.find(scoped(req, { _id:{ $in:wizard.audience.groupIds }, isActive:{ $ne:false } })).sort({ name:1 })
    : [];
  const combined = combinedPartQuestions(parts);
  return { wizard, parts, groups, combined, totalMarks:totalMarksFromConfigs(combined.configs) };
}

async function renderStep(req, res, step, data = {}) {
  res.render('admin/test-wizard', {
    title:'Create Combined Test', step, wizard:currentWizard(req),
    COURSES, SUBJECTS, TEST_TYPES, TIMING_MODES, RESULT_RELEASE_MODES,
    ...data,
  });
}

exports.start = (req, res) => {
  req.session[SESSION_KEY] = freshWizard(req);
  res.redirect('/admin/tests/create/parts');
};

exports.getParts = async (req, res) => {
  try {
    const parts = await TestPart.find(scoped(req, { isActive:{ $ne:false }, status:'ready' })).sort({ subject:1, updatedAt:-1 });
    await renderStep(req, res, 'parts', { parts });
  } catch (error) { console.error(error); req.flash('error','Unable to load ready test parts.'); res.redirect('/admin/tests'); }
};

exports.saveParts = async (req, res) => {
  try {
    const parts = await partsFor(req, req.body.partIds);
    const { duplicates } = combinedPartQuestions(parts);
    if (duplicates.length) throw new Error(`${duplicates.length} duplicate question(s) occur across the selected parts. Remove duplicates before combining.`);
    const wizard = currentWizard(req);
    wizard.partIds = parts.map(part => String(part._id));
    req.session[SESSION_KEY] = wizard;
    res.redirect('/admin/tests/create/identity');
  } catch (error) { req.flash('error',error.message); res.redirect('/admin/tests/create/parts'); }
};

exports.getIdentity = async (req, res) => {
  try {
    const wizard = currentWizard(req);
    if (!wizard.partIds.length) return res.redirect('/admin/tests/create/parts');
    const configuration = await ensureDefaultExamConfigurations(req.organization?._id);
    await renderStep(req, res, 'identity', { patterns:configuration.patterns, rankingSchemas:configuration.rankingSchemas });
  } catch (error) { console.error(error); req.flash('error','Unable to load test identity options.'); res.redirect('/admin/tests/create/parts'); }
};

exports.saveIdentity = async (req, res) => {
  try {
    await partsFor(req, currentWizard(req).partIds);
    const title = String(req.body.title || '').replace(/\s+/g, ' ').trim();
    if (!title) throw new Error('Enter a clear final test name.');
    const courses = [...new Set(list(req.body.courses).map(value => value.toUpperCase()).filter(value => COURSES.includes(value)))];
    const configuration = await resolveExamConfiguration(req.organization?._id, req.body.testPattern, req.body.rankingSchema);
    const wizard = currentWizard(req);
    wizard.identity = {
      title,
      description:String(req.body.description || '').trim() || null,
      testType:TEST_TYPES.includes(req.body.testType) ? req.body.testType : 'CUSTOM',
      courses,
      testPattern:String(configuration.pattern._id),
      rankingSchema:String(configuration.ranking._id),
    };
    req.session[SESSION_KEY] = wizard;
    res.redirect('/admin/tests/create/audience');
  } catch (error) { req.flash('error',error.message); res.redirect('/admin/tests/create/identity'); }
};

exports.getAudience = async (req, res) => {
  try {
    const wizard = currentWizard(req);
    if (!wizard.identity.title) return res.redirect('/admin/tests/create/identity');
    const groups = await Group.find(scoped(req, { isActive:{ $ne:false } })).sort({ name:1 });
    await renderStep(req, res, 'audience', { groups });
  } catch (error) { console.error(error); req.flash('error','Unable to load batches.'); res.redirect('/admin/tests/create/identity'); }
};

exports.saveAudience = async (req, res) => {
  try {
    const groupIds = [...new Set(list(req.body.groupIds))];
    if (!groupIds.length) throw new Error('Select at least one batch for this test.');
    if (groupIds.some(id => !mongoose.isValidObjectId(id))) throw new Error('A selected batch is invalid.');
    const groups = await Group.find(scoped(req, { _id:{ $in:groupIds }, isActive:{ $ne:false } }), '_id');
    if (groups.length !== groupIds.length) throw new Error('A selected batch is unavailable.');
    const passingRaw = String(req.body.passingMarks || '').trim();
    const passingMarks = passingRaw === '' ? null : Number(passingRaw);
    if (passingMarks !== null && (!Number.isFinite(passingMarks) || passingMarks < 0)) throw new Error('Passing marks must be zero or more.');
    const wizard = currentWizard(req);
    wizard.audience = {
      groupIds,
      passingMarks,
      instructions:String(req.body.instructions || '').trim() || null,
    };
    req.session[SESSION_KEY] = wizard;
    res.redirect('/admin/tests/create/delivery');
  } catch (error) { req.flash('error',error.message); res.redirect('/admin/tests/create/audience'); }
};

exports.getDelivery = async (req, res) => {
  const wizard = currentWizard(req);
  if (!wizard.audience.groupIds?.length) return res.redirect('/admin/tests/create/audience');
  await renderStep(req, res, 'delivery');
};

exports.saveDelivery = async (req, res) => {
  try {
    const timing = timingInput({
      timingMode:req.body.timingMode,
      duration:req.body.duration,
      startTime:parseLocalDateTime(req.body.startTime),
      endTime:parseLocalDateTime(req.body.endTime),
    });
    const access = await accessConfiguration({ enabled:req.body.testAccessEnabled, password:req.body.testAccessPassword });
    const release = releaseConfiguration({
      resultReleaseMode:req.body.resultReleaseMode,
      resultReleaseAt:parseLocalDateTime(req.body.resultReleaseAt),
      endTime:timing.endTime,
    });
    const wizard = currentWizard(req);
    wizard.delivery = {
      timingMode:timing.timingMode,
      duration:timing.duration,
      startTime:timing.startTime?.toISOString() || null,
      endTime:timing.endTime?.toISOString() || null,
      shuffleQuestions:req.body.shuffleQuestions === 'on',
      shuffleOptions:req.body.shuffleOptions === 'on',
      autoSubmitOnViolation:req.body.autoSubmitOnViolation === 'on',
      maxTabSwitches:Math.max(1, Number(req.body.maxTabSwitches) || 3),
      maxFocusLosses:Math.max(1, Number(req.body.maxFocusLosses) || 5),
      blockCopyPaste:req.body.blockCopyPaste === 'on',
      requireFullscreen:req.body.requireFullscreen === 'on',
      testAccessEnabled:access.testAccessEnabled,
      testAccessHash:access.testAccessHash,
      testAccessUpdatedAt:access.testAccessUpdatedAt?.toISOString() || null,
      resultReleaseMode:release.resultReleaseMode,
      resultReleaseAt:release.resultReleaseAt?.toISOString() || null,
      resultsReleased:release.resultsReleased,
    };
    req.session[SESSION_KEY] = wizard;
    res.redirect('/admin/tests/create/review');
  } catch (error) { req.flash('error',error.message); res.redirect('/admin/tests/create/delivery'); }
};

exports.getReview = async (req, res) => {
  try {
    const summary = await wizardSummary(req);
    if (!summary.wizard.delivery.timingMode) return res.redirect('/admin/tests/create/delivery');
    await renderStep(req, res, 'review', summary);
  } catch (error) { req.flash('error',error.message); res.redirect('/admin/tests/create/parts'); }
};

exports.finish = async (req, res) => {
  try {
    const { wizard, parts, groups, combined } = await wizardSummary(req);
    if (!wizard.identity.title || !wizard.delivery.timingMode || !groups.length) throw new Error('Complete every wizard step before creating the test.');
    const questionIds = combined.configs.map(config => config.questionId);
    const questionRows = await Question.find(scoped(req, { _id:{ $in:questionIds }, isActive:true }));
    if (questionRows.length !== questionIds.length) throw new Error('A question in the selected parts is no longer available.');
    const questionMap = new Map(questionRows.map(question => [String(question._id), question]));
    const orderedQuestions = questionIds.map(id => questionMap.get(String(id)));
    const examConfiguration = await resolveExamConfiguration(req.organization?._id, wizard.identity.testPattern, wizard.identity.rankingSchema);
    validateQuestionsForPattern(orderedQuestions, examConfiguration.pattern);
    const totalMarks = totalMarksFromConfigs(combined.configs);
    const publishNow = req.body.finalAction === 'publish';
    const test = await Test.create({
      organization:organizationIdForWrite(req),
      title:wizard.identity.title,
      description:wizard.identity.description,
      testType:wizard.identity.testType,
      testPattern:examConfiguration.pattern._id,
      patternSnapshot:examConfiguration.patternSnapshot,
      rankingSchema:examConfiguration.ranking._id,
      rankingSchemaSnapshot:examConfiguration.rankingSnapshot,
      duration:wizard.delivery.duration,
      timingMode:wizard.delivery.timingMode,
      totalMarks,
      negativeMarking:0,
      passingMarks:wizard.audience.passingMarks,
      shuffleQuestions:wizard.delivery.shuffleQuestions,
      shuffleOptions:wizard.delivery.shuffleOptions,
      status:publishNow ? 'published' : 'draft',
      startTime:wizard.delivery.startTime ? new Date(wizard.delivery.startTime) : null,
      endTime:wizard.delivery.endTime ? new Date(wizard.delivery.endTime) : null,
      createdBy:req.session.user.id,
      instructions:wizard.audience.instructions,
      course:wizard.identity.courses,
      subject:[...new Set(parts.map(part => part.subject))],
      marksPerQuestion:combined.configs[0]?.positiveMarks ?? 1,
      questions:questionIds,
      questionConfigs:combined.configs,
      sourceTestParts:parts.map(part => part._id),
      groups:groups.map(group => group._id),
      autoSubmitOnViolation:wizard.delivery.autoSubmitOnViolation,
      maxTabSwitches:wizard.delivery.maxTabSwitches,
      maxFocusLosses:wizard.delivery.maxFocusLosses,
      blockCopyPaste:wizard.delivery.blockCopyPaste,
      requireFullscreen:wizard.delivery.requireFullscreen,
      testAccessEnabled:wizard.delivery.testAccessEnabled,
      testAccessHash:wizard.delivery.testAccessHash || null,
      testAccessUpdatedAt:wizard.delivery.testAccessUpdatedAt ? new Date(wizard.delivery.testAccessUpdatedAt) : null,
      resultReleaseMode:wizard.delivery.resultReleaseMode,
      resultReleaseAt:wizard.delivery.resultReleaseAt ? new Date(wizard.delivery.resultReleaseAt) : null,
      resultsReleased:wizard.delivery.resultsReleased,
    });
    if (publishNow) {
      const memberships = await GroupMember.find({ groupId:{ $in:test.groups }, role:'student' }, 'userId');
      const userIds = [...new Set(memberships.map(row => String(row.userId)))];
      await Promise.all(userIds.map(userId => Notification.create({
        userId, title:'New Exam Published', message:`“${test.title}” is now available.`, type:'exam', link:'/student/tests',
      })));
    }
    delete req.session[SESSION_KEY];
    req.flash('success',publishNow ? 'Combined test published and students notified.' : 'Combined test saved as a draft.');
    res.redirect(`/admin/tests/${test._id}`);
  } catch (error) {
    console.error('Combined test creation error:', error);
    req.flash('error',error.message);
    res.redirect('/admin/tests/create/review');
  }
};

exports._private = { freshWizard, organizationKey };
