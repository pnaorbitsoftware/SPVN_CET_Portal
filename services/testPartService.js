const mongoose = require('mongoose');

const SUBJECTS = ['Physics', 'Chemistry', 'Mathematics', 'Biology'];

function values(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function numberAtLeastZero(value, fallback, label) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or more.`);
  return number;
}

function testPartMetadata(body = {}) {
  const name = String(body.name || '').replace(/\s+/g, ' ').trim();
  const subject = String(body.subject || '').trim();
  if (!name) throw new Error('Give this test part a clear name.');
  if (!SUBJECTS.includes(subject)) throw new Error('Select Physics, Chemistry, Mathematics, or Biology.');
  const status = ['draft','ready','archived'].includes(body.status) ? body.status : 'draft';
  return {
    name,
    subject,
    topic:String(body.topic || '').replace(/\s+/g, ' ').trim() || null,
    subtopic:String(body.subtopic || '').replace(/\s+/g, ' ').trim() || null,
    description:String(body.description || '').trim() || null,
    defaultPositiveMarks:numberAtLeastZero(body.defaultPositiveMarks, 1, 'Default positive marks'),
    defaultNegativeMarks:numberAtLeastZero(body.defaultNegativeMarks, 0, 'Default negative marks'),
    status,
  };
}

function nestedValue(body, prefix, questionId) {
  if (body?.[prefix] && typeof body[prefix] === 'object') return body[prefix][questionId];
  return body?.[`${prefix}[${questionId}]`];
}

function questionConfigsFromBody(body = {}, defaults = {}) {
  const seen = new Set();
  return values(body.questionIds).map(String).map(value => value.trim()).filter(questionId => {
    if (!mongoose.isValidObjectId(questionId) || seen.has(questionId)) return false;
    seen.add(questionId);
    return true;
  }).map((questionId, displayOrder) => ({
    questionId,
    positiveMarks:numberAtLeastZero(
      nestedValue(body, 'positiveMarks', questionId),
      numberAtLeastZero(defaults.defaultPositiveMarks, 1, 'Default positive marks'),
      'Question positive marks'
    ),
    negativeMarks:numberAtLeastZero(
      nestedValue(body, 'negativeMarks', questionId),
      numberAtLeastZero(defaults.defaultNegativeMarks, 0, 'Default negative marks'),
      'Question negative marks'
    ),
    displayOrder,
  }));
}

function combinedPartQuestions(parts = []) {
  const seen = new Set();
  const duplicates = [];
  const configs = [];
  for (const part of parts) {
    for (const config of part.questionConfigs || []) {
      const questionId = String(config.questionId?._id || config.questionId || '');
      if (!questionId || seen.has(questionId)) {
        if (questionId) duplicates.push(questionId);
        continue;
      }
      seen.add(questionId);
      configs.push({
        questionId,
        positiveMarks:Number(config.positiveMarks),
        negativeMarks:Number(config.negativeMarks),
        partialMarks:0,
        bonus:false,
        bonusMarks:Number(config.positiveMarks),
        markingMode:'FULL_OR_ZERO',
        incorrectSelectionPolicy:'NEGATIVE',
        displayOrder:configs.length,
        section:part.subject,
      });
    }
  }
  return { configs, duplicates };
}

module.exports = {
  SUBJECTS,
  combinedPartQuestions,
  questionConfigsFromBody,
  testPartMetadata,
};
