const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Question } = require('../models');
const {
  SOURCES,
  assignRelativeDifficulties,
  cleanHtml,
  normalizeRow,
  parseOptions,
  selectBalancedRows,
  simpleNumericalAnswer,
} = require('../services/pyqDatasetService');

const root = path.join(__dirname, '..');
const mainSource = SOURCES.find(source => source.code === 'JEE_MAIN');

function options(correct = ['B']) {
  return ['A','B','C','D'].map(key => (
    `<li class="option ${correct.includes(key) ? 'correct' : ''}">`
      + `<span class="option-label">${key}</span>`
      + `<span class="option-data">Option ${key} &amp; detail</span>`
      + '</li>'
  )).join('');
}

function row(overrides = {}) {
  return {
    id:'sample-1',
    question:'<p>What is the value of $2 + 2$?</p>',
    tags:"['Physics', 'Units and Measurements', 'JEE Main', 'JEE Main 2024']",
    options:options(['B']),
    correct_option:'',
    answer:'<div>Because <strong>two pairs</strong> make four.</div>',
    ...overrides,
  };
}

test('PYQ cleaner removes markup while preserving readable text and LaTeX', () => {
  assert.equal(cleanHtml('<p>Use $x^2$ &amp; <b>units</b><br>next</p>'), 'Use $x^2$ & units\nnext');
  assert.equal(simpleNumericalAnswer('<div>The correct answer is:<span>8</span></div>'), 8);
  assert.equal(simpleNumericalAnswer('The correct answer is: \\frac{3}{4}'), 0.75);
});

test('PYQ option parser returns four labelled options and authoritative answer keys', () => {
  const parsed = parseOptions(options(['A','C']));
  assert.deepEqual(parsed.map(item => item.key), ['A','B','C','D']);
  assert.deepEqual(parsed.filter(item => item.correct).map(item => item.key), ['A','C']);
  assert.equal(parsed[0].value, 'Option A & detail');
});

test('dataset rows normalize into reusable, attributed portal questions', async () => {
  const result = normalizeRow(row(), mainSource);
  assert.ok(result.value);
  assert.equal(result.value.sourceType, 'PYQ');
  assert.deepEqual(result.value.course, ['JEE']);
  assert.equal(result.value.subject, 'Physics');
  assert.equal(result.value.topic, 'Units and Measurements');
  assert.equal(result.value.subtopic, null);
  assert.equal(result.value.questionType, 'SINGLE_CORRECT');
  assert.equal(result.value.correctAnswer, 'B');
  assert.equal(result.value.pyq.exam, 'JEE');
  assert.equal(result.value.pyq.year, 2024);
  assert.equal(result.value.pyq.sourceLicense, 'CC BY 4.0');
  assert.match(result.value.explanation, /two pairs/);

  const question = new Question(result.value);
  await question.validate();
  assert.equal(question.pyq.sourceKey, 'JEE_MAIN:sample-1');
});

test('dataset numerical and multiple-correct answers survive normalization', async () => {
  const numerical = normalizeRow(row({
    id:'number-1',
    question:'Calculate the exact value requested in the expression.',
    options:'None',
    correct_option:'<div>The correct answer is:<span>8</span></div>',
  }), mainSource).value;
  assert.equal(numerical.questionType, 'NUMERICAL');
  assert.equal(numerical.numericalAnswer.value, 8);
  await new Question(numerical).validate();

  const multiple = normalizeRow(row({ id:'multi-1', options:options(['A','C']) }), mainSource).value;
  assert.equal(multiple.questionType, 'MULTIPLE_CORRECT');
  assert.deepEqual(multiple.correctAnswers, ['A','C']);
  await new Question(multiple).validate();
});

test('quality gate rejects image-dependent, yearless and out-of-syllabus rows', () => {
  assert.equal(normalizeRow(row({ question:'Question with <img src="diagram.png"> a required diagram' }), mainSource).error, 'image-dependent');
  assert.equal(normalizeRow(row({ tags:"['Physics', 'Units and Measurements']" }), mainSource).error, 'missing-year');
  assert.equal(normalizeRow(row({ tags:"['Biology', 'JEE Main 2024', 'Genetics']" }), mainSource).error, 'invalid-subject');
});

test('cross-exam classification tags are never presented as syllabus subtopics', () => {
  const result = normalizeRow(row({
    tags:"['Physics', 'Ray Optics', 'JEE Main', 'JEE Main 2024', 'MHT CET']",
  }), mainSource);
  assert.equal(result.value.topic, 'Ray Optics');
  assert.equal(result.value.subtopic, null);
  assert.ok(!result.value.tags.includes('MHT CET'));
});

test('selection balances subjects and years, then assigns transparent difficulty bands', () => {
  const normalized = [];
  ['Physics','Chemistry','Mathematics'].forEach((subject, subjectIndex) => {
    Array.from({ length:10 }, (_, index) => 2024 - index).forEach((year, yearIndex) => normalized.push({
      complexity:100 + subjectIndex * 10 + yearIndex,
      value:{ subject, questionType:'SINGLE_CORRECT', difficulty:'Medium', pyq:{ year, variant:'JEE Main', sourceFingerprint:`${subject}-${year}` } },
    }));
  });
  const selected = selectBalancedRows(normalized, 6);
  assert.deepEqual(Object.fromEntries(['Chemistry','Mathematics','Physics'].map(subject => [subject,selected.filter(item => item.value.subject === subject).length])), {
    Chemistry:2, Mathematics:2, Physics:2,
  });
  assert.equal(new Set(selected.map(item => item.value.pyq.year)).size, 2);
  assignRelativeDifficulties(normalized);
  assert.ok(normalized.some(item => item.value.difficulty === 'Easy'));
  assert.ok(normalized.some(item => item.value.difficulty === 'Medium'));
  assert.ok(normalized.some(item => item.value.difficulty === 'Hard'));
});

test('PYQ model requires provenance and has an idempotent source-key index', async () => {
  const invalid = new Question({
    sourceType:'PYQ', question:'Missing source metadata', subject:'Physics',
    optionA:'A', optionB:'B', optionC:'C', optionD:'D', correctAnswer:'A',
  });
  await assert.rejects(invalid.validate(), /source metadata/i);
  const sourceIndex = Question.schema.indexes().find(([fields]) => fields['pyq.sourceKey']);
  assert.ok(sourceIndex);
  assert.equal(sourceIndex[1].unique, true);
  assert.equal(sourceIndex[1].partialFilterExpression.sourceType, 'PYQ');
});

test('PYQ library is routed, discoverable and connected to paper creation', () => {
  const route = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'views', 'partials', 'sidebar-admin.ejs'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'views', 'admin', 'pyq-library.ejs'), 'utf8');
  const paperController = fs.readFileSync(path.join(root, 'controllers', 'questionPaperController.js'), 'utf8');
  assert.match(route, /router\.get\('\/pyq'.*pyq\.list/);
  assert.match(sidebar, /href="\/admin\/pyq"[\s\S]*PYQ Library/);
  assert.match(library, /JEE|selectedExam/);
  assert.match(library, /MHT-CET library is ready for verified data/);
  assert.match(library, /questionId=<%= q\.id %>/);
  assert.match(paperController, /req\.query\.questionIds \|\| req\.query\.questionId/);
});
