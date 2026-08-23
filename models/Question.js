const mongoose = require('mongoose');

const QUESTION_TYPES = ['SINGLE_CORRECT', 'MULTIPLE_CORRECT', 'NUMERICAL', 'TRUE_FALSE'];
const QUESTION_SUB_TYPES = [
  'conceptual',
  'numerical',
  'assertion_reason',
  'statement_based',
  'match_based',
  'diagram_based',
  'comprehension',
  'formula_based',
  'custom',
];

const numericalAnswerSchema = new mongoose.Schema({
  value: { type: Number, default: null },
  min: { type: Number, default: null },
  max: { type: Number, default: null },
  tolerance: { type: Number, min: 0, default: 0 },
}, { _id: false });

const optionRequired = function optionRequired() {
  return this.questionType !== 'NUMERICAL';
};
const fourOptionsRequired = function fourOptionsRequired() {
  return ['SINGLE_CORRECT', 'MULTIPLE_CORRECT'].includes(this.questionType);
};

const questionSchema = new mongoose.Schema({
  organization:     { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
  course:           { type: [String], default: [] },
  question:         { type: String, required: true },
  questionImage:    { type: String, default: null },
  sourceDocument:   { type: String, default: null },
  sourcePage:       { type: Number, default: null },
  questionType:     { type: String, enum: QUESTION_TYPES, default: 'SINGLE_CORRECT', index: true },
  questionSubType:  { type: String, enum: [...QUESTION_SUB_TYPES, null], default: null, index: true },
  optionA:          { type: String, required: optionRequired, default: null },
  optionB:          { type: String, required: optionRequired, default: null },
  optionC:          { type: String, required: fourOptionsRequired, default: null },
  optionD:          { type: String, required: fourOptionsRequired, default: null },
  optionAImage:     { type: String, default: null },
  optionBImage:     { type: String, default: null },
  optionCImage:     { type: String, default: null },
  optionDImage:     { type: String, default: null },
  correctAnswer:    {
    type: String,
    enum: ['A', 'B', 'C', 'D', null],
    default: null,
    required() { return ['SINGLE_CORRECT', 'TRUE_FALSE'].includes(this.questionType); },
  },
  correctAnswers:   { type: [{ type: String, enum: ['A', 'B', 'C', 'D'] }], default: [] },
  numericalAnswer:  { type: numericalAnswerSchema, default: null },
  subject:          { type: String, required: true },
  difficulty:       { type: String, enum: ['Easy','Medium','Hard'], default: 'Medium' },
  tags:             { type: [String], default: [] },
  marks:            { type: Number, min: 0, default: 1.0 },
  explanation:      { type: String, default: null },
  explanationImage: { type: String, default: null },
  topic:            { type: String, default: null },
  subtopic:         { type: String, default: null },
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  isActive:         { type: Boolean, default: true },
}, { timestamps: true });

questionSchema.pre('validate', function normalizeAnswerModel() {
  this.tags = [...new Set((this.tags || []).map(tag => String(tag).trim()).filter(Boolean))];
  this.correctAnswers = [...new Set((this.correctAnswers || []).map(answer => String(answer).toUpperCase()))];

  if (this.questionType === 'TRUE_FALSE') {
    this.optionA = this.optionA || 'True';
    this.optionB = this.optionB || 'False';
    this.optionC = null;
    this.optionD = null;
    this.correctAnswers = this.correctAnswer ? [this.correctAnswer] : [];
  } else if (this.questionType === 'SINGLE_CORRECT') {
    if (!this.correctAnswer && this.correctAnswers.length === 1) this.correctAnswer = this.correctAnswers[0];
    if (this.correctAnswer) this.correctAnswers = [this.correctAnswer];
  } else if (this.questionType === 'MULTIPLE_CORRECT') {
    this.correctAnswer = null;
    if (this.correctAnswers.length < 2) {
      this.invalidate('correctAnswers', 'Multiple-correct questions require at least two correct options.');
    }
  } else if (this.questionType === 'NUMERICAL') {
    this.optionA = null;
    this.optionB = null;
    this.optionC = null;
    this.optionD = null;
    this.correctAnswer = null;
    this.correctAnswers = [];
    const answer = this.numericalAnswer;
    const hasExactValue = Number.isFinite(answer?.value);
    const hasRange = Number.isFinite(answer?.min) && Number.isFinite(answer?.max);
    if (!hasExactValue && !hasRange) {
      this.invalidate('numericalAnswer', 'A numerical answer needs an exact value or an accepted range.');
    }
    if (hasRange && answer.min > answer.max) {
      this.invalidate('numericalAnswer.max', 'Numerical answer maximum must be at least the minimum.');
    }
  }
});

questionSchema.index({ organization: 1, subject: 1, topic: 1, difficulty: 1 });
questionSchema.index({ organization: 1, questionType: 1, questionSubType: 1 });
questionSchema.index({ organization: 1, tags: 1 });

questionSchema.statics.QUESTION_TYPES = QUESTION_TYPES;
questionSchema.statics.QUESTION_SUB_TYPES = QUESTION_SUB_TYPES;

module.exports = mongoose.models.Question || mongoose.model('Question', questionSchema);
