const mongoose = require('mongoose');

const resultRecalculationSchema = new mongoose.Schema({
  organization:{ type:mongoose.Schema.Types.ObjectId, ref:'Organization', default:null, index:true },
  testId:{ type:mongoose.Schema.Types.ObjectId, ref:'Test', required:true, index:true },
  initiatedBy:{ type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  reason:{ type:String, required:true, trim:true, minlength:10, maxlength:1000 },
  status:{ type:String, enum:['RUNNING','COMPLETED','FAILED'], default:'RUNNING', index:true },
  affectedResults:{ type:Number, min:0, default:0 },
  changedResults:{ type:Number, min:0, default:0 },
  beforeSummary:{ type:mongoose.Schema.Types.Mixed, default:{} },
  afterSummary:{ type:mongoose.Schema.Types.Mixed, default:{} },
  changes:{ type:[mongoose.Schema.Types.Mixed], default:[] },
  changesTruncated:{ type:Boolean, default:false },
  startedAt:{ type:Date, default:Date.now },
  completedAt:{ type:Date, default:null },
  error:{ type:String, default:null, maxlength:2000 },
}, { timestamps:true });

resultRecalculationSchema.index({ testId:1, createdAt:-1 });
resultRecalculationSchema.index(
  { testId:1, status:1 },
  { unique:true, partialFilterExpression:{ status:'RUNNING' } }
);

module.exports = mongoose.models.ResultRecalculation
  || mongoose.model('ResultRecalculation', resultRecalculationSchema);
