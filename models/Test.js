const mongoose = require('mongoose');

const testQuestionConfigSchema = new mongoose.Schema({
  questionId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
  positiveMarks:   { type: Number, min: 0, default: null },
  negativeMarks:   { type: Number, min: 0, default: null },
  partialMarks:    { type: Number, min: 0, default: 0 },
  bonus:           { type: Boolean, default: false },
  bonusMarks:      { type: Number, min: 0, default: null },
  bonusReason:     { type: String, default: null, maxlength: 500 },
  markingMode:     { type: String, enum: ['FULL_OR_ZERO','PARTIAL_SUBSET','PER_CORRECT_OPTION'], default: 'FULL_OR_ZERO' },
  incorrectSelectionPolicy: { type: String, enum: ['ZERO','NEGATIVE'], default: 'NEGATIVE' },
  displayOrder:    { type: Number, min: 0, default: 0 },
  section:         { type: String, default: null },
}, { _id: false });

const testSchema = new mongoose.Schema({
  organization:    { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
  title:           { type: String, required: true },
  testType:        { type:String, enum:['MOCK','CHAPTER_TEST','SUBJECT_TEST','FULL_SYLLABUS','PRACTICE','PYQ','DIAGNOSTIC','CUSTOM'], default:'CUSTOM', index:true },
  testPattern:     { type:mongoose.Schema.Types.ObjectId, ref:'TestPattern', default:null },
  patternSnapshot: { type:mongoose.Schema.Types.Mixed, default:null },
  rankingSchema:   { type:mongoose.Schema.Types.ObjectId, ref:'RankingSchema', default:null },
  rankingSchemaSnapshot:{ type:mongoose.Schema.Types.Mixed, default:null },
  description:     { type: String, default: null },
  duration:        { type: Number, default: 180 },   // minutes
  totalMarks:      { type: Number, default: 0 },
  negativeMarking: { type: Number, default: 0.25 },
  passingMarks:    { type: Number, default: null },
  shuffleQuestions:{ type: Boolean, default: true },
  shuffleOptions:  { type: Boolean, default: false },
  status:          { type: String, enum: ['draft','published','active','closed'], default: 'draft' },
  startTime:       { type: Date, default: null },
  endTime:         { type: Date, default: null },
  createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  instructions:    { type: String, default: null },
  course:          { type: [String], default: [] },
  subject:         { type: [String], default: [] },
  topic:           { type: String, default: null },
  subtopic:        { type: String, default: null },
  marksPerQuestion:{ type: Number, default: 1 },
  questionPdfPath: { type: String, default: null },
  solutionPdfPath: { type: String, default: null },
  // Embedded question list (replaces TestQuestion join table)
  questions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  questionConfigs: { type: [testQuestionConfigSchema], default: [] },
  sourceQuestionPaper: { type:mongoose.Schema.Types.ObjectId, ref:'QuestionPaper', default:null },
  // Groups assigned (replaces TestGroup join table)
  groups:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
  // Anti-cheat
  autoSubmitOnViolation: { type: Boolean, default: false },
  maxTabSwitches:        { type: Number, default: 3 },
  maxFocusLosses:        { type: Number, default: 5 },
  blockCopyPaste:        { type: Boolean, default: true },
  requireFullscreen:     { type: Boolean, default: false },
  isActive:              { type: Boolean, default: true },
}, { timestamps: true });

testSchema.pre('validate', function normalizeQuestionConfigurations() {
  if (!this.questionConfigs?.length) return;
  const seen = new Set();
  this.questionConfigs = this.questionConfigs.filter((config, index) => {
    const key = String(config.questionId || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    config.displayOrder = index;
    return true;
  });
  if (!this.questions?.length) this.questions = this.questionConfigs.map(config => config.questionId);
});

testSchema.index({ organization: 1, status: 1, createdBy: 1 });

module.exports = mongoose.models.Test || mongoose.model('Test', testSchema);
