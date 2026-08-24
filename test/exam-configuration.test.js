const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { RankingSchema, Test, TestPattern } = require('../models');
const {
  criteriaFromBody,
  patternInputFromBody,
  patternSnapshot,
  rankingSnapshot,
  validateQuestionsForPattern,
} = require('../services/examConfigurationService');
const { compareByCriteria, rankResults } = require('../services/rankingService');
const { isCetSectionTest } = require('../utils/cetExam');

test('legacy tests receive a backward-compatible CUSTOM type without pattern references', async () => {
  const legacy = new Test({ title:'Legacy', createdBy:new mongoose.Types.ObjectId() });
  await legacy.validate();
  assert.equal(legacy.testType, 'CUSTOM');
  assert.equal(legacy.testPattern, null);
  assert.equal(legacy.rankingSchema, null);
});

test('ranking schemas normalize duplicate fields and require real criteria', async () => {
  const schema = new RankingSchema({
    code:'CUSTOM_RANK', name:'Custom',
    criteria:[{ field:'score', direction:'DESC' }, { field:'score', direction:'ASC' }, { field:'timeTaken', direction:'ASC' }],
  });
  await schema.validate();
  assert.deepEqual(schema.criteria.map(item => item.field), ['score','timeTaken']);
  await assert.rejects(new RankingSchema({ code:'EMPTY', name:'Empty', criteria:[] }).validate(), /at least one/i);
});

test('test patterns validate marking defaults and produce immutable configuration snapshots', async () => {
  const pattern = new TestPattern({
    code:'ORG_PATTERN', name:'Organization Pattern', allowedQuestionTypes:['SINGLE_CORRECT','NUMERICAL'],
    defaultPositiveMarks:4, defaultNegativeMarks:1, defaultPartialMarks:2,
    partialMarkPolicy:'PARTIAL_SUBSET', cetSectionFlow:true,
  });
  await pattern.validate();
  const snapshot = patternSnapshot(pattern);
  assert.equal(snapshot.code, 'ORG_PATTERN');
  assert.deepEqual(snapshot.allowedQuestionTypes, ['SINGLE_CORRECT','NUMERICAL']);
  assert.equal(snapshot.cetSectionFlow, true);

  const invalid = new TestPattern({ code:'BAD', name:'Bad', allowedQuestionTypes:['SINGLE_CORRECT'], defaultPositiveMarks:1, defaultPartialMarks:2 });
  await assert.rejects(invalid.validate(), /partial marks cannot exceed/i);
});

test('configuration request parsing validates pattern and ranking inputs', () => {
  const pattern = patternInputFromBody({
    name:'My Pattern', code:'my pattern', allowedQuestionTypes:['SINGLE_CORRECT','NUMERICAL'],
    defaultPositiveMarks:'4', defaultNegativeMarks:'1', defaultPartialMarks:'2',
    partialMarkPolicy:'PARTIAL_SUBSET', timingMode:'FIXED_WINDOW', shuffleQuestionsDefault:'on',
  });
  assert.equal(pattern.code, 'MY_PATTERN');
  assert.equal(pattern.timingMode, 'FIXED_WINDOW');
  assert.equal(pattern.shuffleQuestionsDefault, true);

  const criteria = criteriaFromBody({
    criteriaFields:['score','correctAnswers','score',''],
    criteriaDirections:['DESC','DESC','ASC','ASC'],
  });
  assert.deepEqual(criteria, [{ field:'score', direction:'DESC' }, { field:'correctAnswers', direction:'DESC' }]);
  assert.deepEqual(rankingSnapshot({ code:'R', name:'Rank', criteria, tiePolicy:'DENSE' }), { code:'R', name:'Rank', criteria, tiePolicy:'DENSE' });
});

test('pattern question-type validation rejects incompatible selections', () => {
  const pattern = { name:'Single Only', allowedQuestionTypes:['SINGLE_CORRECT'] };
  assert.doesNotThrow(() => validateQuestionsForPattern([{ questionType:'SINGLE_CORRECT' }], pattern));
  assert.throws(() => validateQuestionsForPattern([{ questionType:'NUMERICAL' }], pattern), /not allowed/i);
});

test('ranking comparator and tie policies are configuration-driven', () => {
  const criteria = [{ field:'score', direction:'DESC' }, { field:'correctAnswers', direction:'DESC' }, { field:'timeTaken', direction:'ASC' }];
  const rows = [
    { _id:'a', score:10, correctAnswers:8, timeTaken:100 },
    { _id:'b', score:12, correctAnswers:6, timeTaken:200 },
    { _id:'c', score:10, correctAnswers:8, timeTaken:100 },
    { _id:'d', score:10, correctAnswers:7, timeTaken:80 },
  ];
  const sorted = [...rows].sort((a,b) => compareByCriteria(a,b,criteria));
  assert.deepEqual(sorted.map(row => row._id), ['b','a','c','d']);
  assert.deepEqual(rankResults(rows, criteria, 'DENSE').map(item => item.rank), [1,2,2,3]);
  assert.deepEqual(rankResults(rows, criteria, 'COMPETITION').map(item => item.rank), [1,2,2,4]);
});

test('CET section behavior follows a saved pattern snapshot while legacy CET tests still work', () => {
  const questions = [{ subject:'Physics' },{ subject:'Chemistry' },{ subject:'Mathematics' }];
  assert.equal(isCetSectionTest({ course:['CET'] }, questions), true);
  assert.equal(isCetSectionTest({ course:['CET'], patternSnapshot:{ cetSectionFlow:false } }, questions), false);
  assert.equal(isCetSectionTest({ course:['JEE'], patternSnapshot:{ cetSectionFlow:true } }, questions), true);
});
