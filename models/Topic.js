const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
  organization:{ type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
  name:      { type: String, required: true },
  course:    { type: String, enum: ['JEE','CET','NEET'], required: true },
  subject:   { type: String, required: true },
  subtopics: { type: [String], default: [] },
  isActive:  { type: Boolean, default: true },
}, { timestamps: true });

topicSchema.index({ organization: 1, course: 1, subject: 1, name: 1 });

module.exports = mongoose.models.Topic || mongoose.model('Topic', topicSchema);
