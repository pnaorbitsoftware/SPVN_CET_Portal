const { answerForDisplay, hasSubmittedAnswer } = require('./questionService');
const { scoreQuestion } = require('./scoringService');
const { effectiveQuestionConfig } = require('./testConfigurationService');

function submittedAnswerForDisplay(question, answer) {
  if (!hasSubmittedAnswer(answer)) return 'Not answered';
  if (Array.isArray(answer)) return answer.join(', ');
  if (question?.questionType === 'TRUE_FALSE') return answer === 'A' ? 'True' : answer === 'B' ? 'False' : String(answer);
  return String(answer);
}

function correctOptionKeys(question) {
  if (question?.questionType === 'MULTIPLE_CORRECT') return (question.correctAnswers || []).map(String);
  if (question?.questionType === 'NUMERICAL') return [];
  return question?.correctAnswer ? [String(question.correctAnswer)] : [];
}

function submittedOptionKeys(question, answer) {
  if (question?.questionType === 'NUMERICAL') return [];
  if (Array.isArray(answer)) return answer.map(String);
  return hasSubmittedAnswer(answer) ? [String(answer)] : [];
}

function questionReview(result, question) {
  const questionId = String(question?._id || question?.id || '');
  const saved = result?.answers?.[questionId];
  const rawAnswer = saved && typeof saved === 'object' && !Array.isArray(saved)
    && Object.prototype.hasOwnProperty.call(saved, 'answer') ? saved.answer : saved;
  const recorded = result?.perQuestionScore?.[questionId];
  const scored = recorded || scoreQuestion(
    question,
    rawAnswer,
    effectiveQuestionConfig(result?.testId || result?.test, question)
  );
  return {
    ...scored,
    answer:rawAnswer ?? null,
    attempted:hasSubmittedAnswer(rawAnswer),
    answerLabel:submittedAnswerForDisplay(question, rawAnswer),
    correctLabel:answerForDisplay(question),
    selectedOptionKeys:submittedOptionKeys(question, rawAnswer),
    correctOptionKeys:correctOptionKeys(question),
  };
}

function questionsInAttemptOrder(result) {
  const questions = result?.testId?.questions || result?.test?.questions || [];
  const byId = new Map(questions.map(question => [String(question._id || question.id), question]));
  const order = result?.questionOrder?.length
    ? result.questionOrder.map(String)
    : questions.map(question => String(question._id || question.id));
  return order.map(id => byId.get(id)).filter(Boolean);
}

module.exports = {
  correctOptionKeys,
  questionReview,
  questionsInAttemptOrder,
  submittedAnswerForDisplay,
  submittedOptionKeys,
};
