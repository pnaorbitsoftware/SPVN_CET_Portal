#!/usr/bin/env node
require('dotenv').config();

const mongoose = require('mongoose');
const { connect } = require('../config/database');
const { Question } = require('../models');
const { ensureDefaultOrganization } = require('../services/organizationService');

function fail(message) {
  throw new Error(`MHT-CET verification failed: ${message}`);
}

async function main() {
  await connect();
  const organization = await ensureDefaultOrganization();
  const query = {
    organization:organization._id,
    sourceType:'PYQ',
    'pyq.exam':'CET',
    isActive:true,
  };
  const questions = await Question.find(query).lean();
  if (!questions.length) fail('no active CET PYQs were found');
  const invalid = questions.filter(question => (
    !question.question
    || !question.optionA
    || !question.optionB
    || !question.optionC
    || !question.optionD
    || !['A','B','C','D'].includes(question.correctAnswer)
    || !question.topic
    || !question.subtopic
    || !question.pyq?.sourceKey
    || !question.pyq?.sourceUrl
    || !question.pyq?.sourceFingerprint
  ));
  if (invalid.length) fail(`${invalid.length} rows have missing content, answer, hierarchy or provenance`);
  const keys = questions.map(question => question.pyq.sourceKey);
  if (new Set(keys).size !== keys.length) fail('duplicate source keys were found');
  const subjects = Object.fromEntries(
    ['Physics','Chemistry','Mathematics','Biology'].map(subject => [subject,questions.filter(question => question.subject === subject).length])
  );
  const years = {};
  questions.forEach(question => { years[question.pyq.year] = (years[question.pyq.year] || 0) + 1; });
  const difficulties = {};
  questions.forEach(question => { difficulties[question.difficulty] = (difficulties[question.difficulty] || 0) + 1; });
  process.stdout.write(`${JSON.stringify({ organization:organization.organizationCode, total:questions.length, subjects, years, difficulties }, null, 2)}\n`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
