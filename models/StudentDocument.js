const mongoose = require('mongoose');

const studentDocumentSchema = new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
  studentId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName:     { type: String, required: true },
  originalName: { type: String, required: true },
  fileType:     { type: String, default: null },
  fileSize:     { type: Number, default: null },
  filePath:     { type: String, required: true },
  description:  { type: String, default: '' },
}, { timestamps: true });

studentDocumentSchema.index({ organization: 1, studentId: 1, createdAt: -1 });

module.exports = mongoose.models.StudentDocument || mongoose.model('StudentDocument', studentDocumentSchema);
