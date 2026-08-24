#!/usr/bin/env node
require('dotenv').config();

const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect } = require('../config/database');
const { Question, Topic } = require('../models');
const { ensureDefaultOrganization, organizationScope } = require('../services/organizationService');
const { NON_SYLLABUS_TAGS } = require('../services/pyqDatasetService');
const {
  generationQuery,
  parseGenerationRules,
  selectQuestionsForBlueprint,
} = require('../services/paperGeneratorService');

async function grouped(match, field) {
  return Question.aggregate([
    { $match:match },
    { $group:{ _id:`$${field}`, count:{ $sum:1 } } },
    { $sort:{ count:-1, _id:1 } },
  ]);
}

async function main() {
  await connect();
  const organization = await ensureDefaultOrganization();
  const pyqMatch = { organization:organization._id, sourceType:'PYQ', isActive:true };
  const total = await Question.countDocuments(pyqMatch);
  const [variants, exams, subjects, difficulties, types, years, invalidMetadata, invalidAnswers, invalidQuestionHierarchy, invalidTopicHierarchy, duplicates, cetTotal] = await Promise.all([
    grouped(pyqMatch, 'pyq.variant'),
    grouped(pyqMatch, 'pyq.exam'),
    grouped(pyqMatch, 'subject'),
    grouped(pyqMatch, 'difficulty'),
    grouped(pyqMatch, 'questionType'),
    grouped(pyqMatch, 'pyq.year'),
    Question.countDocuments({ ...pyqMatch, $or:[
      { 'pyq.exam':{ $exists:false } }, { 'pyq.year':{ $exists:false } },
      { 'pyq.sourceKey':{ $exists:false } }, { 'pyq.sourceFingerprint':{ $exists:false } },
      { 'pyq.sourceLicense':{ $exists:false } }, { topic:{ $in:[null,''] } },
      { subject:{ $in:[null,''] } }, { question:{ $in:[null,''] } },
    ] }),
    Question.countDocuments({ ...pyqMatch, $or:[
      { questionType:{ $in:['SINGLE_CORRECT','TRUE_FALSE'] }, correctAnswer:{ $nin:['A','B','C','D'] } },
      { questionType:'MULTIPLE_CORRECT', $expr:{ $lt:[{ $size:'$correctAnswers' },2] } },
      { questionType:'NUMERICAL', $nor:[
        { 'numericalAnswer.value':{ $type:'number' } },
        { $and:[
          { 'numericalAnswer.min':{ $type:'number' } },
          { 'numericalAnswer.max':{ $type:'number' } },
        ] },
      ] },
    ] }),
    Question.countDocuments({ ...pyqMatch, $or:[
      { subtopic:{ $in:NON_SYLLABUS_TAGS } },
      { tags:{ $in:NON_SYLLABUS_TAGS } },
    ] }),
    Topic.countDocuments({ organization:organization._id, subtopics:{ $in:NON_SYLLABUS_TAGS } }),
    Question.aggregate([
      { $match:pyqMatch },
      { $group:{ _id:'$pyq.sourceFingerprint', count:{ $sum:1 } } },
      { $match:{ count:{ $gt:1 } } },
      { $limit:1 },
    ]),
    Question.countDocuments({ ...pyqMatch, 'pyq.exam':'CET' }),
  ]);

  assert.ok(total >= 6000, `Expected at least 6,000 PYQs, found ${total}.`);
  assert.equal(invalidMetadata, 0, 'PYQ metadata/hierarchy validation failed.');
  assert.equal(invalidAnswers, 0, 'One or more imported answers are incomplete.');
  assert.equal(invalidQuestionHierarchy + invalidTopicHierarchy, 0, 'Cross-exam labels leaked into syllabus subtopics.');
  assert.equal(duplicates.length, 0, 'Duplicate question fingerprints were imported.');
  assert.equal(cetTotal, 0, 'Unverified questions must not be relabelled as MHT-CET PYQs.');

  const rules = parseGenerationRules({
    course:'JEE', subject:'Physics', totalQuestions:10, totalMarks:10,
    easyCount:3, mediumCount:5, hardCount:2,
    questionTypes:['SINGLE_CORRECT','MULTIPLE_CORRECT','NUMERICAL'],
    questionTags:['PYQ'],
  });
  const candidates = await Question.find(generationQuery(rules, organizationScope(organization))).lean();
  const selection = selectQuestionsForBlueprint(candidates, rules, () => 0.42);
  assert.equal(selection.length, 10);
  assert.equal(new Set(selection.map(question => String(question._id))).size, 10);
  assert.deepEqual(
    Object.fromEntries(['Easy','Medium','Hard'].map(level => [level,selection.filter(question => question.difficulty === level).length])),
    { Easy:3, Medium:5, Hard:2 }
  );

  const serialize = rows => Object.fromEntries(rows.map(row => [String(row._id),row.count]));
  process.stdout.write(`${JSON.stringify({
    total,
    variants:serialize(variants),
    exams:serialize(exams),
    subjects:serialize(subjects),
    difficulties:serialize(difficulties),
    questionTypes:serialize(types),
    yearRange:{ min:Math.min(...years.map(row => row._id)), max:Math.max(...years.map(row => row._id)), distinct:years.length },
    invalidMetadata,
    invalidAnswers,
    invalidHierarchyLabels:invalidQuestionHierarchy + invalidTopicHierarchy,
    duplicateFingerprints:duplicates.length,
    generatorProof:{ candidates:candidates.length, selected:selection.length, distribution:{ Easy:3, Medium:5, Hard:2 }, totalMarks:10 },
  }, null, 2)}\n`);
}

main()
  .catch(error => { console.error('PYQ verification failed:', error); process.exitCode = 1; })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
