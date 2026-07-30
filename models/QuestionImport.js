const mongoose = require('mongoose');

const sourceFileSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  mimeType: { type: String, default: 'application/octet-stream' },
  size:     { type: Number, default: 0 },
}, { _id: false });

const importDefaultsSchema = new mongoose.Schema({
  subject:    { type: String, default: 'Physics' },
  topic:      { type: String, default: null },
  subtopic:   { type: String, default: null },
  difficulty: { type: String, enum: ['Easy','Medium','Hard'], default: 'Medium' },
  marks:      { type: Number, default: 1 },
}, { _id: false });

const testDefaultsSchema = new mongoose.Schema({
  title:           { type: String, default: '' },
  description:     { type: String, default: '' },
  duration:        { type: Number, default: 180 },
  negativeMarking: { type: Number, default: 0.25 },
  startTime:       { type: Date, default: null },
  endTime:         { type: Date, default: null },
  instructions:    { type: String, default: '' },
  courses:         { type: [String], default: [] },
  groupIds:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
}, { _id: false });

const importedQuestionSchema = new mongoose.Schema({
  question:      { type: String, default: '' },
  optionA:       { type: String, default: '' },
  optionB:       { type: String, default: '' },
  optionC:       { type: String, default: '' },
  optionD:       { type: String, default: '' },
  correctAnswer: { type: String, enum: ['A','B','C','D','UNKNOWN'], default: 'UNKNOWN' },
  subject:       { type: String, default: 'Physics' },
  topic:         { type: String, default: null },
  subtopic:      { type: String, default: null },
  difficulty:    { type: String, enum: ['Easy','Medium','Hard'], default: 'Medium' },
  marks:         { type: Number, default: 1 },
  explanation:   { type: String, default: null },
  confidence:    { type: Number, min: 0, max: 1, default: 0 },
  sourceLabel:   { type: String, default: null },
  answerSource:  { type: String, enum: ['marked','answer_key','provided','inferred','unknown'], default: 'unknown' },
  isSelected:    { type: Boolean, default: true },
});

const questionImportSchema = new mongoose.Schema({
  createdBy:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sourceFiles:         { type: [sourceFileSchema], default: [] },
  defaults:            { type: importDefaultsSchema, default: () => ({}) },
  testDefaults:        { type: testDefaultsSchema, default: () => ({}) },
  status:              { type: String, enum: ['scanning','review','imported','failed'], default: 'scanning' },
  extractionMethod:    { type: String, enum: ['spreadsheet','openai','gemini'], default: 'spreadsheet' },
  extractionModel:     { type: String, default: null },
  questions:           { type: [importedQuestionSchema], default: [] },
  warnings:            { type: [String], default: [] },
  error:               { type: String, default: null },
  importedQuestionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  testId:              { type: mongoose.Schema.Types.ObjectId, ref: 'Test', default: null },
}, { timestamps: true });

questionImportSchema.index({ createdBy: 1, createdAt: -1 });
questionImportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.models.QuestionImport || mongoose.model('QuestionImport', questionImportSchema);
