const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { TestPart } = require('../models');
const {
  combinedPartQuestions,
  questionConfigsFromBody,
  testPartMetadata,
} = require('../services/testPartService');

test('test part metadata keeps subject hierarchy independent from exam delivery settings', () => {
  const input = testPartMetadata({
    name:'  Physics   Electrostatics Set 01 ',
    subject:'Physics', topic:' Electrostatics ', subtopic:' Coulomb Law ',
    defaultPositiveMarks:'1', defaultNegativeMarks:'0.25', status:'ready',
    courses:['CET'], groupIds:['batch'], shuffleQuestions:'on',
  });
  assert.deepEqual(input, {
    name:'Physics Electrostatics Set 01', subject:'Physics', topic:'Electrostatics', subtopic:'Coulomb Law',
    description:null, defaultPositiveMarks:1, defaultNegativeMarks:0.25, status:'ready',
  });
  assert.equal('courses' in input, false);
  assert.equal('groupIds' in input, false);
});

test('question config parser applies default marks and honors per-question overrides', () => {
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  const configs = questionConfigsFromBody({
    questionIds:[String(first),String(second),String(first)],
    positiveMarks:{ [String(second)]:'3' },
    negativeMarks:{ [String(second)]:'1' },
  }, { defaultPositiveMarks:1, defaultNegativeMarks:0.25 });
  assert.equal(configs.length, 2);
  assert.deepEqual(configs.map(config => config.positiveMarks), [1,3]);
  assert.deepEqual(configs.map(config => config.negativeMarks), [0.25,1]);
  assert.deepEqual(configs.map(config => config.displayOrder), [0,1]);
});

test('test part schema preserves question order and requires questions before Ready', async () => {
  const userId = new mongoose.Types.ObjectId();
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  const part = new TestPart({
    name:'Biology Genetics', subject:'Biology', createdBy:userId, status:'ready',
    questionConfigs:[
      { questionId:first, positiveMarks:2, negativeMarks:0 },
      { questionId:second, positiveMarks:1, negativeMarks:0 },
      { questionId:first, positiveMarks:4, negativeMarks:1 },
    ],
  });
  await part.validate();
  assert.deepEqual(part.questionConfigs.map(config => String(config.questionId)), [String(first),String(second)]);
  assert.deepEqual(part.questionConfigs.map(config => config.displayOrder), [0,1]);
  await assert.rejects(new TestPart({ name:'Empty', subject:'Chemistry', createdBy:userId, status:'ready' }).validate(), /at least one question/i);
});

test('combined test keeps subject sections, marks, order, and reports duplicates', () => {
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  const combined = combinedPartQuestions([
    { subject:'Physics', questionConfigs:[{ questionId:first, positiveMarks:1, negativeMarks:0.25 }] },
    { subject:'Chemistry', questionConfigs:[{ questionId:second, positiveMarks:2, negativeMarks:0 }, { questionId:first, positiveMarks:4, negativeMarks:1 }] },
  ]);
  assert.equal(combined.configs.length, 2);
  assert.deepEqual(combined.configs.map(config => config.section), ['Physics','Chemistry']);
  assert.deepEqual(combined.configs.map(config => config.positiveMarks), [1,2]);
  assert.deepEqual(combined.configs.map(config => config.displayOrder), [0,1]);
  assert.deepEqual(combined.duplicates, [String(first)]);
});
