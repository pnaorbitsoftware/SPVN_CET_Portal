const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
  name:         { type: String, required: true, unique: true, trim: true },
  description:  { type: String, default: null },
  academicYear: { type: String, default: process.env.ACADEMIC_YEAR || '2024-2025' },
  course:       { type: String, enum: ['JEE','CET','NEET', null], default: null },
  startDate:    { type: Date, default: null },
  endDate:      { type: Date, default: null },
  isActive:     { type: Boolean, default: true },
}, { timestamps: true });

groupSchema.pre('validate', function validateDateRange() {
  if (this.startDate && this.endDate && this.startDate > this.endDate) {
    this.invalidate('endDate', 'Batch end date must be on or after the start date.');
  }
});

module.exports = mongoose.models.Group || mongoose.model('Group', groupSchema);
