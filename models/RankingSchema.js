const mongoose = require('mongoose');

const rankingCriterionSchema = new mongoose.Schema({
  field:{ type:String, enum:['score','correctAnswers','wrongAnswers','timeTaken','submittedAt'], required:true },
  direction:{ type:String, enum:['ASC','DESC'], required:true },
}, { _id:false });

const rankingSchema = new mongoose.Schema({
  organization:{ type:mongoose.Schema.Types.ObjectId, ref:'Organization', default:null, index:true },
  code:{ type:String, required:true, trim:true, uppercase:true, maxlength:60, match:/^[A-Z0-9_-]+$/ },
  name:{ type:String, required:true, trim:true, maxlength:120 },
  description:{ type:String, default:null, trim:true, maxlength:1000 },
  criteria:{ type:[rankingCriterionSchema], required:true },
  tiePolicy:{ type:String, enum:['ORDINAL','DENSE','COMPETITION'], default:'ORDINAL' },
  isSystem:{ type:Boolean, default:false },
  isActive:{ type:Boolean, default:true, index:true },
  createdBy:{ type:mongoose.Schema.Types.ObjectId, ref:'User', default:null },
}, { timestamps:true });

rankingSchema.pre('validate', function validateCriteria() {
  const seen = new Set();
  this.criteria = (this.criteria || []).filter(criterion => {
    if (seen.has(criterion.field)) return false;
    seen.add(criterion.field);
    return true;
  });
  if (!this.criteria.length) this.invalidate('criteria', 'At least one ranking criterion is required.');
});

rankingSchema.index({ organization:1, code:1 }, { unique:true });
rankingSchema.index({ organization:1, isActive:1, name:1 });

module.exports = mongoose.models.RankingSchema || mongoose.model('RankingSchema', rankingSchema);
