const mongoose = require('mongoose');

const organizationSettingsSchema = new mongoose.Schema({
  academicDefaults: {
    academicYear: { type: String, default: process.env.ACADEMIC_YEAR || '2024-2025' },
    courses: { type: [String], default: ['JEE', 'CET', 'NEET'] },
  },
  examDefaults: {
    duration: { type: Number, min: 1, default: 180 },
    timingMode: {
      type: String,
      enum: ['PERSONAL_DURATION', 'FIXED_WINDOW', 'UNTIMED'],
      default: 'PERSONAL_DURATION',
    },
    negativeMarking: { type: Number, min: 0, default: 0.25 },
    shuffleQuestions: { type: Boolean, default: true },
    shuffleOptions: { type: Boolean, default: false },
  },
  resultDefaults: {
    releaseMode: {
      type: String,
      enum: ['IMMEDIATE', 'AFTER_TEST_END', 'SCHEDULED', 'MANUAL'],
      default: 'IMMEDIATE',
    },
    rankingSchemaCode: { type: String, default: 'SCORE_TIME' },
  },
  branding: {
    portalName: { type: String, default: 'CET Exam Portal' },
    shortName: { type: String, default: 'CET' },
    primaryColor: { type: String, default: '#131330' },
    accentColor: { type: String, default: '#f59e0b' },
  },
  timezone: { type: String, default: process.env.APP_TIME_ZONE || 'Asia/Kolkata' },
}, { _id: false });

const organizationSchema = new mongoose.Schema({
  organizationName: { type: String, required: true, trim: true, maxlength: 160 },
  organizationCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    minlength: 2,
    maxlength: 32,
    match: /^[A-Z0-9_-]+$/,
  },
  description: { type: String, default: '', trim: true, maxlength: 2000 },
  logo: { type: String, default: null, trim: true },
  email: { type: String, default: null, lowercase: true, trim: true },
  phone: { type: String, default: null, trim: true },
  address: { type: String, default: '', trim: true, maxlength: 2000 },
  administrator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active',
    index: true,
  },
  settings: { type: organizationSettingsSchema, default: () => ({}) },
  isDefault: { type: Boolean, default: false, index: true },
}, { timestamps: true });

organizationSchema.index({ organizationName: 1 });

module.exports = mongoose.models.Organization
  || mongoose.model('Organization', organizationSchema);
