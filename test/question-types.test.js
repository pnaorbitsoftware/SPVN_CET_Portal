const test = require('node:test');
const assert = require('node:assert/strict');

const { Question } = require('../models');
const {
  answerForDisplay,
  hasSubmittedAnswer,
  normalizeSubmittedAnswer,
  questionInputFromBody,
} = require('../services/questionService');

test('legacy single-correct question remains valid and gains normalized answer array', async () => {
  const question = new Question({
    question:'Legacy question',
    optionA:'One', optionB:'Two', optionC:'Three', optionD:'Four',
    correctAnswer:'B',
    subject:'Physics',
  });
  await question.validate();
  assert.equal(question.questionType, 'SINGLE_CORRECT');
  assert.deepEqual([...question.correctAnswers], ['B']);
});

test('multiple-correct questions require at least two unique answers', async () => {
  const invalid = new Question({
    question:'Select primes', questionType:'MULTIPLE_CORRECT',
    optionA:'2', optionB:'3', optionC:'4', optionD:'6',
    correctAnswers:['A'], subject:'Mathematics',
  });
  await assert.rejects(invalid.validate(), /at least two/i);

  const valid = new Question({
    question:'Select primes', questionType:'MULTIPLE_CORRECT',
    optionA:'2', optionB:'3', optionC:'4', optionD:'6',
    correctAnswers:['B','A','A'], subject:'Mathematics',
  });
  await valid.validate();
  assert.deepEqual([...valid.correctAnswers], ['B','A']);
  assert.equal(valid.correctAnswer, null);
  assert.equal(answerForDisplay(valid), 'B, A');
});

test('numerical questions accept exact values or valid ranges without MCQ options', async () => {
  const exact = new Question({
    question:'Value of 2 + 2', questionType:'NUMERICAL',
    numericalAnswer:{ value:4, tolerance:0 }, subject:'Mathematics',
  });
  await exact.validate();
  assert.equal(answerForDisplay(exact), '4');

  const invalidRange = new Question({
    question:'Approximate value', questionType:'NUMERICAL',
    numericalAnswer:{ min:10, max:5 }, subject:'Physics',
  });
  await assert.rejects(invalidRange.validate(), /maximum/i);
});

test('true-false questions normalize options and answer labels', async () => {
  const question = new Question({
    question:'The Earth orbits the Sun.', questionType:'TRUE_FALSE',
    correctAnswer:'A', subject:'General Knowledge',
  });
  await question.validate();
  assert.equal(question.optionA, 'True');
  assert.equal(question.optionB, 'False');
  assert.equal(question.optionC, null);
  assert.equal(answerForDisplay(question), 'True');
});

test('question request parsing validates type-specific answer models', () => {
  const multiple = questionInputFromBody({
    question:'Select values', subject:'Mathematics', questionType:'MULTIPLE_CORRECT',
    optionA:'1', optionB:'2', optionC:'3', optionD:'4', correctAnswers:['A','C'],
    tags:'PYQ, Practice, PYQ',
  });
  assert.deepEqual(multiple.correctAnswers, ['A','C']);
  assert.deepEqual(multiple.tags, ['PYQ','Practice']);

  assert.throws(() => questionInputFromBody({
    question:'Number', subject:'Mathematics', questionType:'NUMERICAL',
  }), /exact numerical answer/i);
});

test('student answer normalization supports arrays, numbers and legacy strings', () => {
  assert.deepEqual(normalizeSubmittedAnswer(['C','A','C'], 'MULTIPLE_CORRECT'), ['A','C']);
  assert.equal(normalizeSubmittedAnswer('4.25', 'NUMERICAL'), 4.25);
  assert.equal(normalizeSubmittedAnswer(' b ', 'SINGLE_CORRECT'), 'B');
  assert.equal(hasSubmittedAnswer([]), false);
  assert.equal(hasSubmittedAnswer(0), true);
});
