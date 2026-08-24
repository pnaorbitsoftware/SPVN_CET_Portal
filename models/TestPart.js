const mongoose = require('mongoose');

const SUBJECTS = ['Physics', 'Chemistry', 'Mathematics', 'Biology'];

const testPartQuestionSchema = new mongoose.Schema({
  questionId:    { type:mongoose.Schema.Types.ObjectId, ref:'Question', required:true },
  positiveMarks: { type:Number, min:0, required:true },
  negativeMarks: { type:Number, min:0, default:0 },
  displayOrder:  { type:Number, min:0, default:0 },
}, { _id:false });

const testPartSchema = new mongoose.Schema({
  organization:       { type:mongoose.Schema.Types.ObjectId, ref:'Organization', default:null, index:true },
  name:               { type:String, required:true, trim:true, maxlength:180 },
  subject:            { type:String, enum:SUBJECTS, required:true, index:true },
  topic:              { type:String, trim:true, default:null, maxlength:180 },
  subtopic:           { type:String, trim:true, default:null, maxlength:180 },
  description:        { type:String, trim:true, default:null, maxlength:1000 },
  defaultPositiveMarks:{ type:Number, min:0, default:1 },
  defaultNegativeMarks:{ type:Number, min:0, default:0 },
  questionConfigs:    { type:[testPartQuestionSchema], default:[] },
  status:             { type:String, enum:['draft','ready','archived'], default:'draft', index:true },
  createdBy:          { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  isActive:           { type:Boolean, default:true, index:true },
}, { timestamps:true });

testPartSchema.pre('validate', function normalizeTestPart() {
  const seen = new Set();
  this.questionConfigs = (this.questionConfigs || []).filter(config => {
    const key = String(config.questionId || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((config, index) => {
    config.displayOrder = index;
    if (!Number.isFinite(config.positiveMarks)) config.positiveMarks = this.defaultPositiveMarks;
    if (!Number.isFinite(config.negativeMarks)) config.negativeMarks = this.defaultNegativeMarks;
    return config;
  });
  if (this.status === 'ready' && !this.questionConfigs.length) {
    this.invalidate('questionConfigs', 'A ready test part must contain at least one question.');
  }
});

testPartSchema.virtual('questionCount').get(function questionCount() {
  return this.questionConfigs?.length || 0;
});

testPartSchema.index({ organization:1, subject:1, status:1, updatedAt:-1 });
testPartSchema.index({ organization:1, name:1, isActive:1 });
testPartSchema.set('toJSON', { virtuals:true });
testPartSchema.set('toObject', { virtuals:true });

testPartSchema.statics.SUBJECTS = SUBJECTS;

module.exports = mongoose.models.TestPart || mongoose.model('TestPart', testPartSchema);
