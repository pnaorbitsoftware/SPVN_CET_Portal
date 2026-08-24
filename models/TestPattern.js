const mongoose = require('mongoose');

const sectionSchema = new mongoose.Schema({
  name:{ type:String, required:true, trim:true },
  subjects:{ type:[String], default:[] },
  navigationGate:{ type:String, enum:['NONE','VISIT_ALL_BEFORE_NEXT'], default:'NONE' },
}, { _id:false });

const testPatternSchema = new mongoose.Schema({
  organization:{ type:mongoose.Schema.Types.ObjectId, ref:'Organization', default:null, index:true },
  code:{ type:String, required:true, trim:true, uppercase:true, maxlength:60, match:/^[A-Z0-9_-]+$/ },
  name:{ type:String, required:true, trim:true, maxlength:120 },
  description:{ type:String, default:null, trim:true, maxlength:1000 },
  allowedQuestionTypes:{
    type:[{ type:String, enum:['SINGLE_CORRECT','MULTIPLE_CORRECT','NUMERICAL','TRUE_FALSE'] }],
    default:['SINGLE_CORRECT'],
  },
  defaultPositiveMarks:{ type:Number, min:0, default:1 },
  defaultNegativeMarks:{ type:Number, min:0, default:0 },
  defaultPartialMarks:{ type:Number, min:0, default:0 },
  partialMarkPolicy:{ type:String, enum:['FULL_OR_ZERO','PARTIAL_SUBSET','PER_CORRECT_OPTION'], default:'FULL_OR_ZERO' },
  sectionStructure:{ type:[sectionSchema], default:[] },
  timingMode:{ type:String, enum:['PERSONAL_DURATION','FIXED_WINDOW','UNTIMED'], default:'PERSONAL_DURATION' },
  rankingSchema:{ type:mongoose.Schema.Types.ObjectId, ref:'RankingSchema', default:null },
  navigationRules:{ type:mongoose.Schema.Types.Mixed, default:{ allowBackNavigation:true, allowMarkForReview:true } },
  resultBehavior:{ type:mongoose.Schema.Types.Mixed, default:{ releaseMode:'IMMEDIATE' } },
  shuffleQuestionsDefault:{ type:Boolean, default:true },
  shuffleOptionsDefault:{ type:Boolean, default:false },
  cetSectionFlow:{ type:Boolean, default:false },
  isSystem:{ type:Boolean, default:false },
  isActive:{ type:Boolean, default:true, index:true },
  createdBy:{ type:mongoose.Schema.Types.ObjectId, ref:'User', default:null },
}, { timestamps:true });

testPatternSchema.pre('validate', function normalizePattern() {
  this.allowedQuestionTypes = [...new Set(this.allowedQuestionTypes || [])];
  if (!this.allowedQuestionTypes.length) this.invalidate('allowedQuestionTypes', 'Select at least one allowed question type.');
  if (this.defaultPartialMarks > this.defaultPositiveMarks) {
    this.invalidate('defaultPartialMarks', 'Default partial marks cannot exceed positive marks.');
  }
});

testPatternSchema.index({ organization:1, code:1 }, { unique:true });
testPatternSchema.index({ organization:1, isActive:1, name:1 });

module.exports = mongoose.models.TestPattern || mongoose.model('TestPattern', testPatternSchema);
