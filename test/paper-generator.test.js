const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  PaperGenerationError,
  generationQuery,
  parseGenerationRules,
  replacementCriteria,
  selectQuestionsForBlueprint,
} = require('../services/paperGeneratorService');

function question(id, difficulty, marks, type = 'SINGLE_CORRECT') {
  return { _id:id, difficulty, marks, questionType:type };
}

function rules(overrides = {}) {
  return {
    course:'CET', subject:'Physics', topics:[], subtopics:[], totalQuestions:3, totalMarks:6,
    difficultyCounts:{ Easy:1, Medium:1, Hard:1 },
    questionTypes:['SINGLE_CORRECT','NUMERICAL'], questionTags:[], excludedQuestionIds:[],
    ...overrides,
  };
}

test('generation rules require an exact difficulty total and normalize filters', () => {
  const excluded = new mongoose.Types.ObjectId().toString();
  const parsed = parseGenerationRules({
    course:'cet', subject:'Physics', totalQuestions:'3', totalMarks:'6',
    easyCount:'1', mediumCount:'1', hardCount:'1', questionTypes:['SINGLE_CORRECT','INVALID'],
    topics:'Motion, Force', questionTags:'PYQ,Revision', excludedQuestionIds:excluded,
  });
  assert.equal(parsed.course, 'CET');
  assert.deepEqual(parsed.topics, ['Motion','Force']);
  assert.deepEqual(parsed.questionTypes, ['SINGLE_CORRECT']);
  assert.deepEqual(parsed.excludedQuestionIds, [excluded]);
  assert.throws(() => parseGenerationRules({
    course:'CET', subject:'Physics', totalQuestions:4, totalMarks:4,
    easyCount:1, mediumCount:1, hardCount:1,
  }), /difficulty counts total 3/i);
});

test('generation query combines organization, hierarchy, type, tag and exclusion rules', () => {
  const excluded = new mongoose.Types.ObjectId().toString();
  const query = generationQuery(rules({
    topics:['Motion'], subtopics:['Velocity'], questionTags:['PYQ'], excludedQuestionIds:[excluded],
  }), { organization:new mongoose.Types.ObjectId() });
  assert.ok(Array.isArray(query.$and));
  assert.ok(query.$and.some(clause => clause.organization));
  assert.ok(query.$and.some(clause => clause.tags?.$all));
  assert.ok(query.$and.some(clause => clause._id?.$nin));
});

test('generator satisfies exact difficulty counts and total marks without duplicates', () => {
  const candidates = [
    question('e1','Easy',1), question('e2','Easy',2),
    question('m1','Medium',1), question('m2','Medium',2,'NUMERICAL'),
    question('h1','Hard',1), question('h2','Hard',3),
  ];
  const selected = selectQuestionsForBlueprint(candidates, rules(), () => 0.5);
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map(item => item._id)).size, 3);
  assert.equal(selected.reduce((sum,item) => sum + item.marks, 0), 6);
  assert.deepEqual(
    Object.fromEntries(['Easy','Medium','Hard'].map(level => [level,selected.filter(item => item.difficulty===level).length])),
    { Easy:1, Medium:1, Hard:1 }
  );
});

test('generator reports inventory shortages and impossible exact-mark blueprints', () => {
  const candidates = [question('e','Easy',1),question('m','Medium',1),question('h','Hard',1)];
  assert.throws(
    () => selectQuestionsForBlueprint(candidates, rules({ difficultyCounts:{ Easy:2,Medium:0,Hard:1 } })),
    error => error instanceof PaperGenerationError && error.code === 'INSUFFICIENT_INVENTORY'
  );
  assert.throws(
    () => selectQuestionsForBlueprint(candidates, rules({ totalMarks:10 })),
    error => error instanceof PaperGenerationError && error.code === 'MARKS_TARGET_UNAVAILABLE'
  );
});

test('replacement criteria preserves difficulty, type rules and exact total marks', () => {
  assert.deepEqual(
    replacementCriteria(question('q','Hard',4), rules(), true),
    { difficulty:'Hard', marks:4, questionType:{ $in:['SINGLE_CORRECT','NUMERICAL'] } }
  );
});
