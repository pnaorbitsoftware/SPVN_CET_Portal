const { RankingSchema, TestPattern } = require('../models');
const { cleanList } = require('./questionService');

const TEST_TYPES = ['MOCK','CHAPTER_TEST','SUBJECT_TEST','FULL_SYLLABUS','PRACTICE','PYQ','DIAGNOSTIC','CUSTOM'];
const QUESTION_TYPES = ['SINGLE_CORRECT','MULTIPLE_CORRECT','NUMERICAL','TRUE_FALSE'];
const TIMING_MODES = ['PERSONAL_DURATION','FIXED_WINDOW','UNTIMED'];
const RANK_FIELDS = ['score','correctAnswers','wrongAnswers','timeTaken','submittedAt'];

const RANKING_DEFAULTS = [
  {
    code:'SCHEME_1', name:'Score, then Time', isSystem:true,
    description:'Higher total score, then lower completion time. Preserves the legacy ranking behaviour.',
    criteria:[{ field:'score', direction:'DESC' }, { field:'timeTaken', direction:'ASC' }, { field:'submittedAt', direction:'ASC' }],
    tiePolicy:'ORDINAL',
  },
  {
    code:'ACCURACY_PRIORITY', name:'Score and Accuracy', isSystem:true,
    description:'Higher score, more correct answers, fewer wrong answers, then lower completion time.',
    criteria:[{ field:'score', direction:'DESC' }, { field:'correctAnswers', direction:'DESC' }, { field:'wrongAnswers', direction:'ASC' }, { field:'timeTaken', direction:'ASC' }],
    tiePolicy:'ORDINAL',
  },
];

function patternDefaults(rankingByCode) {
  const base = {
    allowedQuestionTypes:[...QUESTION_TYPES], defaultPositiveMarks:1, defaultNegativeMarks:0,
    defaultPartialMarks:0, partialMarkPolicy:'FULL_OR_ZERO', timingMode:'PERSONAL_DURATION',
    navigationRules:{ allowBackNavigation:true, allowMarkForReview:true },
    resultBehavior:{ releaseMode:'IMMEDIATE' }, shuffleQuestionsDefault:true, shuffleOptionsDefault:false,
    isSystem:true,
  };
  return [
    { ...base, code:'BASIC', name:'Basic', description:'General-purpose exam pattern.', rankingSchema:rankingByCode.SCHEME_1 },
    { ...base, code:'MHT_CET', name:'MHT-CET', description:'CET sections and legacy Physics/Chemistry navigation gate.', allowedQuestionTypes:['SINGLE_CORRECT'], defaultNegativeMarks:0.25, rankingSchema:rankingByCode.SCHEME_1, cetSectionFlow:true, sectionStructure:[{ name:'Science Foundation', subjects:['Physics','Chemistry'], navigationGate:'VISIT_ALL_BEFORE_NEXT' }, { name:'Choice Section', subjects:['Mathematics','Biology'], navigationGate:'NONE' }] },
    { ...base, code:'JEE_MAIN', name:'JEE Main', description:'JEE-style single, multiple and numerical questions.', allowedQuestionTypes:['SINGLE_CORRECT','MULTIPLE_CORRECT','NUMERICAL'], defaultPositiveMarks:4, defaultNegativeMarks:1, partialMarkPolicy:'PER_CORRECT_OPTION', rankingSchema:rankingByCode.SCHEME_1 },
    { ...base, code:'NEET', name:'NEET', description:'NEET-style single-correct pattern.', allowedQuestionTypes:['SINGLE_CORRECT'], defaultPositiveMarks:4, defaultNegativeMarks:1, rankingSchema:rankingByCode.SCHEME_1 },
    { ...base, code:'CUSTOM', name:'Custom', description:'Flexible pattern for legacy and custom tests.', defaultNegativeMarks:0.25, rankingSchema:rankingByCode.SCHEME_1 },
  ];
}

async function ensureDefaultExamConfigurations(organizationId) {
  if (!organizationId) return { patterns:[], rankingSchemas:[] };
  await Promise.all(RANKING_DEFAULTS.map(definition => RankingSchema.updateOne(
    { organization:organizationId, code:definition.code },
    { $setOnInsert:{ ...definition, organization:organizationId, isActive:true } },
    { upsert:true }
  )));
  const rankings = await RankingSchema.find({ organization:organizationId, isActive:true }).sort({ isSystem:-1, name:1 });
  const rankingByCode = Object.fromEntries(rankings.map(schema => [schema.code,schema._id]));
  await Promise.all(patternDefaults(rankingByCode).map(definition => TestPattern.updateOne(
    { organization:organizationId, code:definition.code },
    { $setOnInsert:{ ...definition, organization:organizationId, isActive:true } },
    { upsert:true }
  )));
  const patterns = await TestPattern.find({ organization:organizationId, isActive:true }).populate('rankingSchema').sort({ isSystem:-1, name:1 });
  return { patterns, rankingSchemas:rankings };
}

function patternSnapshot(pattern) {
  if (!pattern) return null;
  return {
    code:pattern.code,
    name:pattern.name,
    allowedQuestionTypes:[...(pattern.allowedQuestionTypes || [])],
    defaultPositiveMarks:pattern.defaultPositiveMarks,
    defaultNegativeMarks:pattern.defaultNegativeMarks,
    defaultPartialMarks:pattern.defaultPartialMarks,
    partialMarkPolicy:pattern.partialMarkPolicy,
    sectionStructure:(pattern.sectionStructure || []).map(section => typeof section.toObject === 'function' ? section.toObject() : section),
    timingMode:pattern.timingMode,
    navigationRules:pattern.navigationRules,
    resultBehavior:pattern.resultBehavior,
    shuffleQuestionsDefault:pattern.shuffleQuestionsDefault,
    shuffleOptionsDefault:pattern.shuffleOptionsDefault,
    cetSectionFlow:Boolean(pattern.cetSectionFlow),
  };
}

function rankingSnapshot(schema) {
  if (!schema) return null;
  return {
    code:schema.code,
    name:schema.name,
    criteria:(schema.criteria || []).map(criterion => ({ field:criterion.field, direction:criterion.direction })),
    tiePolicy:schema.tiePolicy || 'ORDINAL',
  };
}

async function resolveExamConfiguration(organizationId, patternId, rankingSchemaId) {
  const { patterns, rankingSchemas } = await ensureDefaultExamConfigurations(organizationId);
  const selectedPattern = patterns.find(item => String(item._id) === String(patternId));
  if (patternId && !selectedPattern) throw new Error('Selected test pattern is unavailable.');
  const pattern = selectedPattern || patterns.find(item => item.code === 'CUSTOM') || patterns[0];
  const patternRankingId = pattern?.rankingSchema?._id || pattern?.rankingSchema;
  const selectedRanking = rankingSchemas.find(item => String(item._id) === String(rankingSchemaId));
  if (rankingSchemaId && !selectedRanking) throw new Error('Selected ranking schema is unavailable.');
  const ranking = selectedRanking || rankingSchemas.find(item => String(item._id) === String(patternRankingId))
    || rankingSchemas.find(item => item.code === 'SCHEME_1')
    || rankingSchemas[0];
  if (!pattern || !ranking) throw new Error('Exam pattern defaults are unavailable.');
  return { pattern, ranking, patternSnapshot:patternSnapshot(pattern), rankingSnapshot:rankingSnapshot(ranking) };
}

function validateQuestionsForPattern(questions, pattern) {
  const allowed = new Set(pattern.allowedQuestionTypes || QUESTION_TYPES);
  const invalid = questions.filter(question => !allowed.has(question.questionType || 'SINGLE_CORRECT'));
  if (invalid.length) {
    const types = [...new Set(invalid.map(question => question.questionType || 'SINGLE_CORRECT'))].join(', ');
    throw new Error(`${invalid.length} selected question(s) use type(s) not allowed by ${pattern.name}: ${types}.`);
  }
}

function criteriaFromBody(body = {}) {
  const rawFields = Array.isArray(body.criteriaFields) ? body.criteriaFields : body.criteriaFields ? [body.criteriaFields] : [];
  const rawDirections = Array.isArray(body.criteriaDirections) ? body.criteriaDirections : body.criteriaDirections ? [body.criteriaDirections] : [];
  const seen = new Set();
  const criteria = rawFields.map((field,index) => ({
    field,
    direction:rawDirections[index] === 'ASC' ? 'ASC' : 'DESC',
  })).filter(item => RANK_FIELDS.includes(item.field) && !seen.has(item.field) && seen.add(item.field));
  if (!criteria.length) throw new Error('Select at least one ranking criterion.');
  return criteria;
}

function patternInputFromBody(body = {}) {
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!name || !code) throw new Error('Pattern name and code are required.');
  const allowedQuestionTypes = cleanList(body.allowedQuestionTypes).filter(type => QUESTION_TYPES.includes(type));
  if (!allowedQuestionTypes.length) throw new Error('Select at least one allowed question type.');
  const positive = Math.max(0, Number(body.defaultPositiveMarks) || 0);
  const partial = Math.max(0, Number(body.defaultPartialMarks) || 0);
  if (partial > positive) throw new Error('Partial marks cannot exceed positive marks.');
  return {
    name, code, description:String(body.description || '').trim() || null,
    allowedQuestionTypes,
    defaultPositiveMarks:positive,
    defaultNegativeMarks:Math.max(0, Number(body.defaultNegativeMarks) || 0),
    defaultPartialMarks:partial,
    partialMarkPolicy:['FULL_OR_ZERO','PARTIAL_SUBSET','PER_CORRECT_OPTION'].includes(body.partialMarkPolicy) ? body.partialMarkPolicy : 'FULL_OR_ZERO',
    timingMode:TIMING_MODES.includes(body.timingMode) ? body.timingMode : 'PERSONAL_DURATION',
    rankingSchema:body.rankingSchema || null,
    shuffleQuestionsDefault:body.shuffleQuestionsDefault === 'on',
    shuffleOptionsDefault:body.shuffleOptionsDefault === 'on',
    cetSectionFlow:body.cetSectionFlow === 'on',
  };
}

module.exports = {
  QUESTION_TYPES,
  RANK_FIELDS,
  TEST_TYPES,
  TIMING_MODES,
  criteriaFromBody,
  ensureDefaultExamConfigurations,
  patternInputFromBody,
  patternSnapshot,
  rankingSnapshot,
  resolveExamConfiguration,
  validateQuestionsForPattern,
};
