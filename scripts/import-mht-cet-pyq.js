#!/usr/bin/env node
require('dotenv').config();

const mongoose = require('mongoose');
const { connect } = require('../config/database');
const { Question, Topic } = require('../models');
const { ensureDefaultOrganization } = require('../services/organizationService');
const {
  SOURCES,
  assignRelativeDifficulties,
  extractSource,
} = require('../services/mhtCetDatasetService');

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function selectedSources() {
  const only = String(argument('only', ''))
    .split(',')
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);
  return only.length ? SOURCES.filter(source => only.includes(source.code)) : SOURCES;
}

function summarize(rows) {
  const result = { total:rows.length, subjects:{}, years:{}, difficulties:{}, topics:{} };
  rows.forEach(({ value }) => {
    result.subjects[value.subject] = (result.subjects[value.subject] || 0) + 1;
    result.years[value.pyq.year] = (result.years[value.pyq.year] || 0) + 1;
    result.difficulties[value.difficulty] = (result.difficulties[value.difficulty] || 0) + 1;
    result.topics[value.topic] = (result.topics[value.topic] || 0) + 1;
  });
  return result;
}

async function upsertTopics(rows, organizationId) {
  const topics = new Map();
  rows.forEach(({ value }) => {
    const key = `${value.subject}:${value.topic}`;
    if (!topics.has(key)) {
      topics.set(key, { subject:value.subject, name:value.topic, subtopics:new Set() });
    }
    if (value.subtopic) topics.get(key).subtopics.add(value.subtopic);
  });
  if (!topics.size) return;
  await Topic.bulkWrite([...topics.values()].map(topic => ({
    updateOne:{
      filter:{ organization:organizationId, course:'CET', subject:topic.subject, name:topic.name },
      update:{
        $set:{ isActive:true },
        ...(topic.subtopics.size ? { $addToSet:{ subtopics:{ $each:[...topic.subtopics] } } } : {}),
      },
      upsert:true,
    },
  })), { ordered:false });
}

async function importRows(rows, sources) {
  await connect();
  const organization = await ensureDefaultOrganization();
  let inserted = 0;
  let matched = 0;
  for (let index = 0; index < rows.length; index += 250) {
    const batch = rows.slice(index, index + 250);
    const result = await Question.bulkWrite(batch.map(({ value }) => ({
      updateOne:{
        filter:{ organization:organization._id, sourceType:'PYQ', 'pyq.sourceKey':value.pyq.sourceKey },
        update:{
          $set:{ ...value, organization:organization._id },
          $setOnInsert:{ createdBy:null },
        },
        upsert:true,
      },
    })), { ordered:false });
    inserted += result.upsertedCount;
    matched += result.matchedCount;
    process.stdout.write(`Reconciled ${Math.min(index + batch.length, rows.length)}/${rows.length}\r`);
  }
  process.stdout.write('\n');
  const sourceCodePattern = sources
    .map(source => source.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const activeSourceKeys = rows.map(({ value }) => value.pyq.sourceKey);
  const staleResult = await Question.updateMany({
    organization:organization._id,
    sourceType:'PYQ',
    'pyq.exam':'CET',
    isActive:true,
    $and:[
      { 'pyq.sourceKey':{ $regex:`^(?:${sourceCodePattern}):` } },
      { 'pyq.sourceKey':{ $nin:activeSourceKeys } },
    ],
  }, { $set:{ isActive:false } });
  await upsertTopics(rows, organization._id);
  return {
    organization:organization.organizationCode,
    selected:rows.length,
    inserted,
    matched,
    deactivated:staleResult.modifiedCount,
    databaseCetPyqTotal:await Question.countDocuments({
      organization:organization._id,
      sourceType:'PYQ',
      'pyq.exam':'CET',
      isActive:true,
    }),
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sources = selectedSources();
  if (!sources.length) throw new Error('No matching MHT-CET source was selected.');
  process.stdout.write(`SPVN MHT-CET PYQ import · ${sources.length} pinned official paper set(s)${dryRun ? ' · DRY RUN' : ''}\n`);
  const rows = [];
  const fingerprints = new Set();
  for (const source of sources) {
    process.stdout.write(`\nDownloading and verifying ${source.paper}…\n`);
    const result = await extractSource(source);
    process.stdout.write(`${source.code}: ${result.parsedQuestions}/${source.expectedQuestions} questions parsed; ${result.parsedAnswers}/${source.expectedQuestions} answers parsed; ${result.rows.length} passed quality gates\n`);
    process.stdout.write(`Rejected: ${JSON.stringify(result.rejected)}\n`);
    if (result.missingQuestionNumbers.length || result.missingAnswerNumbers.length) {
      process.stdout.write(`Missing questions: ${JSON.stringify(result.missingQuestionNumbers)} · missing answers: ${JSON.stringify(result.missingAnswerNumbers)}\n`);
    }
    result.rows.forEach(row => {
      const key = row.value.pyq.sourceFingerprint;
      if (fingerprints.has(key)) return;
      fingerprints.add(key);
      rows.push(row);
    });
  }
  assignRelativeDifficulties(rows);
  process.stdout.write(`\nValidated MHT-CET selection:\n${JSON.stringify(summarize(rows), null, 2)}\n`);
  if (dryRun) return;
  const imported = await importRows(rows, sources);
  process.stdout.write(`\nImport result:\n${JSON.stringify(imported, null, 2)}\n`);
}

main()
  .catch(error => {
    console.error('\nMHT-CET PYQ import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
