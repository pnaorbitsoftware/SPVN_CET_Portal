const test = require('node:test');
const assert = require('node:assert/strict');
const {
  questionReview,
  questionsInAttemptOrder,
  submittedAnswerForDisplay,
} = require('../services/answerReviewService');

test('answer review renders multiple, numerical and true-false answers safely', () => {
  assert.equal(submittedAnswerForDisplay({ questionType:'MULTIPLE_CORRECT' }, ['A','C']), 'A, C');
  assert.equal(submittedAnswerForDisplay({ questionType:'NUMERICAL' }, 0), '0');
  assert.equal(submittedAnswerForDisplay({ questionType:'TRUE_FALSE' }, 'B'), 'False');
  assert.equal(submittedAnswerForDisplay({}, null), 'Not answered');
});

test('question review prefers persisted scoring status and preserves a zero answer', () => {
  const question = { _id:'q1', questionType:'NUMERICAL', numericalAnswer:{ value:0 } };
  const result = {
    answers:{ q1:{ answer:0 } },
    perQuestionScore:{ q1:{ status:'correct', awarded:2, maxScore:2 } },
  };
  const review = questionReview(result, question);
  assert.equal(review.attempted, true);
  assert.equal(review.answer, 0);
  assert.equal(review.answerLabel, '0');
  assert.equal(review.status, 'correct');
});

test('question review exposes every selected and correct multiple option', () => {
  const question = { _id:'q2', questionType:'MULTIPLE_CORRECT', correctAnswers:['A','C'] };
  const review = questionReview({ answers:{ q2:{ answer:['A','B'] } } }, question);
  assert.deepEqual(review.selectedOptionKeys, ['A','B']);
  assert.deepEqual(review.correctOptionKeys, ['A','C']);
  assert.equal(review.status, 'incorrect');
});

test('question review follows the saved attempt order', () => {
  const q1 = { _id:'q1' }; const q2 = { _id:'q2' };
  assert.deepEqual(questionsInAttemptOrder({ testId:{ questions:[q1,q2] }, questionOrder:['q2','q1'] }), [q2,q1]);
});
