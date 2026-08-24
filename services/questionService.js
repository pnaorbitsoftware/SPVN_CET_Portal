const QUESTION_TYPES = ['SINGLE_CORRECT', 'MULTIPLE_CORRECT', 'NUMERICAL', 'TRUE_FALSE'];
const QUESTION_SUB_TYPES = [
  'conceptual', 'numerical', 'assertion_reason', 'statement_based', 'match_based',
  'diagram_based', 'comprehension', 'formula_based', 'custom',
];
const OPTION_KEYS = ['A', 'B', 'C', 'D'];

function list(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return String(value).split(',');
}

function cleanList(value, { uppercase = false } = {}) {
  return [...new Set(list(value)
    .map(item => String(item).trim())
    .filter(Boolean)
    .map(item => uppercase ? item.toUpperCase() : item))];
}

function nullableNumber(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a valid number.`);
  return number;
}

function questionInputFromBody(body = {}, defaults = {}) {
  const questionType = QUESTION_TYPES.includes(body.questionType)
    ? body.questionType
    : defaults.questionType || 'SINGLE_CORRECT';
  const questionSubType = QUESTION_SUB_TYPES.includes(body.questionSubType)
    ? body.questionSubType
    : null;
  const tags = cleanList(body.tags);
  const course = cleanList(body.course || body.courses, { uppercase: true });
  const input = {
    questionType,
    questionSubType,
    course,
    tags,
    question: String(body.question || '').trim(),
    optionA: String(body.optionA || '').trim() || null,
    optionB: String(body.optionB || '').trim() || null,
    optionC: String(body.optionC || '').trim() || null,
    optionD: String(body.optionD || '').trim() || null,
    subject: String(body.subject || defaults.subject || '').trim(),
    topic: String(body.topic || '').trim() || null,
    subtopic: String(body.subtopic || '').trim() || null,
    difficulty: ['Easy', 'Medium', 'Hard'].includes(body.difficulty) ? body.difficulty : 'Medium',
    marks: Math.max(0, Number(body.marks ?? defaults.marks ?? 1) || 0),
    explanation: String(body.explanation || '').trim() || null,
  };

  if (!input.question || !input.subject) throw new Error('Question text and subject are required.');

  if (questionType === 'MULTIPLE_CORRECT') {
    input.correctAnswer = null;
    input.correctAnswers = cleanList(body.correctAnswers, { uppercase: true })
      .filter(answer => OPTION_KEYS.includes(answer));
    if (input.correctAnswers.length < 2) throw new Error('Select at least two correct options.');
  } else if (questionType === 'NUMERICAL') {
    input.correctAnswer = null;
    input.correctAnswers = [];
    const value = nullableNumber(body.numericalValue, 'Numerical answer');
    const min = nullableNumber(body.numericalMin, 'Numerical minimum');
    const max = nullableNumber(body.numericalMax, 'Numerical maximum');
    const tolerance = nullableNumber(body.numericalTolerance, 'Numerical tolerance') ?? 0;
    if (value === null && (min === null || max === null)) {
      throw new Error('Enter an exact numerical answer or both range values.');
    }
    if (min !== null && max !== null && min > max) throw new Error('Numerical maximum must be at least the minimum.');
    if (tolerance < 0) throw new Error('Numerical tolerance cannot be negative.');
    input.numericalAnswer = { value, min, max, tolerance };
  } else {
    const correctAnswer = String(body.correctAnswer || '').toUpperCase();
    const allowed = questionType === 'TRUE_FALSE' ? ['A', 'B'] : OPTION_KEYS;
    if (!allowed.includes(correctAnswer)) throw new Error('Select a valid correct answer.');
    input.correctAnswer = correctAnswer;
    input.correctAnswers = [correctAnswer];
    if (questionType === 'TRUE_FALSE') {
      input.optionA = 'True';
      input.optionB = 'False';
      input.optionC = null;
      input.optionD = null;
    }
  }

  if (['SINGLE_CORRECT', 'MULTIPLE_CORRECT'].includes(questionType)) {
    if (![input.optionA, input.optionB, input.optionC, input.optionD].every(Boolean)) {
      throw new Error('All four options are required for MCQ questions.');
    }
  }
  return input;
}

function answerForDisplay(question) {
  const type = question?.questionType || 'SINGLE_CORRECT';
  if (type === 'MULTIPLE_CORRECT') return (question.correctAnswers || []).join(', ');
  if (type === 'NUMERICAL') {
    const answer = question.numericalAnswer || {};
    if (Number.isFinite(answer.value)) return String(answer.value);
    if (Number.isFinite(answer.min) && Number.isFinite(answer.max)) return `${answer.min}–${answer.max}`;
    return 'Not configured';
  }
  if (type === 'TRUE_FALSE') return question.correctAnswer === 'A' ? 'True' : 'False';
  return question?.correctAnswer || '';
}

function normalizeSubmittedAnswer(value, questionType = 'SINGLE_CORRECT') {
  if (questionType === 'MULTIPLE_CORRECT') {
    return cleanList(value, { uppercase: true }).filter(answer => OPTION_KEYS.includes(answer)).sort();
  }
  if (questionType === 'NUMERICAL') {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error('Enter a valid numerical answer.');
    return number;
  }
  const answer = String(value || '').trim().toUpperCase();
  if (!answer) return null;
  const allowed = questionType === 'TRUE_FALSE' ? ['A', 'B'] : OPTION_KEYS;
  if (!allowed.includes(answer)) throw new Error('Select a valid answer.');
  return answer;
}

function hasSubmittedAnswer(value) {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '';
}

module.exports = {
  OPTION_KEYS,
  QUESTION_SUB_TYPES,
  QUESTION_TYPES,
  answerForDisplay,
  cleanList,
  hasSubmittedAnswer,
  normalizeSubmittedAnswer,
  questionInputFromBody,
};
