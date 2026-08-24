#!/usr/bin/env node
require('dotenv').config();

const mongoose = require('mongoose');
const { connect } = require('../config/database');
const { Question, Topic } = require('../models');
const { ensureDefaultOrganization } = require('../services/organizationService');
const {
  DATASET,
  NON_SYLLABUS_TAGS,
  SOURCES,
  assignRelativeDifficulties,
  normalizeRow,
  selectBalancedRows,
} = require('../services/pyqDatasetService');

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function selectedSources() {
  const only = String(argument('only', '')).split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
  return only.length ? SOURCES.filter(source => only.includes(source.code)) : SOURCES;
}

function summarize(rows) {
  const summary = { total:rows.length, exams:{}, subjects:{}, years:{}, difficulties:{}, types:{} };
  rows.forEach(({ value }) => {
    summary.exams[value.pyq.variant] = (summary.exams[value.pyq.variant] || 0) + 1;
    summary.subjects[value.subject] = (summary.subjects[value.subject] || 0) + 1;
    summary.years[value.pyq.year] = (summary.years[value.pyq.year] || 0) + 1;
    summary.difficulties[value.difficulty] = (summary.difficulties[value.difficulty] || 0) + 1;
    summary.types[value.questionType] = (summary.types[value.questionType] || 0) + 1;
  });
  return summary;
}

async function readSource(source, limit, globalFingerprints) {
  const { asyncBufferFromUrl, parquetReadObjects } = await import('hyparquet');
  process.stdout.write(`\nDownloading and validating ${source.label}…\n`);
  const file = await asyncBufferFromUrl({ url:source.parquetUrl, byteLength:source.size });
  const rawRows = await parquetReadObjects({
    file,
    columns:['id', 'question', 'tags', 'options', 'correct_option', 'answer'],
  });
  const rejected = {};
  const normalized = [];
  rawRows.forEach(raw => {
    const result = normalizeRow(raw, source);
    if (!result.value) {
      rejected[result.error] = (rejected[result.error] || 0) + 1;
      return;
    }
    const fingerprint = result.value.pyq.sourceFingerprint;
    if (globalFingerprints.has(fingerprint)) {
      rejected.duplicate = (rejected.duplicate || 0) + 1;
      return;
    }
    globalFingerprints.add(fingerprint);
    normalized.push(result);
  });
  const selected = selectBalancedRows(normalized, Math.min(limit, normalized.length));
  process.stdout.write(`${source.label}: ${rawRows.length} source rows → ${normalized.length} valid unique → ${selected.length} selected\n`);
  process.stdout.write(`Rejected: ${JSON.stringify(rejected)}\n`);
  return selected;
}

async function upsertTopics(rows, organizationId) {
  const units = new Map();
  rows.forEach(({ value }) => {
    const key = [value.pyq.exam, value.subject, value.topic].join(':');
    if (!units.has(key)) units.set(key, { course:value.pyq.exam, subject:value.subject, name:value.topic, subtopics:new Set() });
    if (value.subtopic) units.get(key).subtopics.add(value.subtopic);
  });
  if (!units.size) return;
  await Topic.updateMany(
    { organization:organizationId, subtopics:{ $in:NON_SYLLABUS_TAGS } },
    { $pull:{ subtopics:{ $in:NON_SYLLABUS_TAGS } } }
  );
  await Topic.bulkWrite([...units.values()].map(unit => ({
    updateOne:{
      filter:{ organization:organizationId, course:unit.course, subject:unit.subject, name:unit.name },
      update:{
        $set:{ isActive:true },
        ...(unit.subtopics.size ? { $addToSet:{ subtopics:{ $each:[...unit.subtopics] } } } : {}),
      },
      upsert:true,
    },
  })), { ordered:false });
}

async function importRows(rows) {
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
  await upsertTopics(rows, organization._id);
  return {
    organization:organization.organizationCode,
    selected:rows.length,
    inserted,
    matched,
    databasePyqTotal:await Question.countDocuments({ organization:organization._id, sourceType:'PYQ', isActive:true }),
  };
}

async function main() {
  const limit = Math.max(1, Math.min(10000, Number(argument('limit-per-source', 3000)) || 3000));
  const dryRun = process.argv.includes('--dry-run');
  const sources = selectedSources();
  if (!sources.length) throw new Error('No matching dataset source was selected.');
  process.stdout.write(`SPVN PYQ import · ${DATASET.name}@${DATASET.version.slice(0, 12)} · ${DATASET.license}\n`);
  process.stdout.write(`Sources: ${sources.map(source => source.label).join(', ')} · cap ${limit} per source${dryRun ? ' · DRY RUN' : ''}\n`);
  const globalFingerprints = new Set();
  const selected = [];
  for (const source of sources) selected.push(...await readSource(source, limit, globalFingerprints));
  assignRelativeDifficulties(selected);
  process.stdout.write(`\nValidated selection:\n${JSON.stringify(summarize(selected), null, 2)}\n`);
  if (dryRun) return;
  const result = await importRows(selected);
  process.stdout.write(`\nImport result:\n${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch(error => { console.error('\nPYQ import failed:', error); process.exitCode = 1; })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
