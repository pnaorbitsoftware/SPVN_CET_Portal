const test = require('node:test');
const assert = require('node:assert/strict');

const { Question } = require('../models');
const {
  SOURCES,
  assignRelativeDifficulties,
  extractAnswerKey,
  extractQuestionBlocks,
  extractResponseQuestions,
  inferTopic,
  mergeInlineScriptRows,
  normalizeQuestion,
  parseResponseQuestionHeader,
  sequentialOptionMarkers,
} = require('../services/mhtCetDatasetService');

test('MHT-CET source manifest pins exact paper and answer-key hashes', () => {
  assert.equal(SOURCES.length, 4);
  SOURCES.forEach(source => {
    assert.match(source.questionUrl, /^https:\/\/cdn\.aglasem\.com\/aglasem-doc\//);
    assert.match(source.questionSha256, /^[a-f0-9]{64}$/);
    if (source.responseSheet) {
      assert.equal(source.answerUrl, undefined);
    } else {
      assert.match(source.answerUrl, /^https:\/\/cdn\.aglasem\.com\/aglasem-doc\//);
      assert.match(source.answerSha256, /^[a-f0-9]{64}$/);
    }
    assert.ok(source.expectedQuestions > 0);
  });
});

test('response-sheet parser uses the green official key marker, not the chosen option', () => {
  assert.deepEqual(parseResponseQuestionHeader('Q.1 0 Which law applies?'), {
    number:10,
    text:'Which law applies?',
  });
  const pages = [{
    pageNumber:1,
    height:792,
    greenRows:[410],
    rows:[
      { y:700, text:'Section : Physics' },
      { y:650, text:'Q.1 Which law describes inertia?' },
      { y:620, text:'Ans' },
      { y:580, text:'1. Newton first law' },
      { y:540, text:'2. Newton second law' },
      { y:500, text:'3. Newton third law' },
      { y:410, text:'4. Law of gravitation' },
      { y:380, text:'Question Type : MCQ' },
      { y:360, text:'Question ID : 123456' },
      { y:340, text:'Chosen Option : 2' },
    ],
  }];
  const [question] = extractResponseQuestions(pages, 1);
  assert.equal(question.answer, 'D');
  assert.equal(question.sourceId, '123456');
  assert.equal(question.subject, 'Physics');
});

test('response-sheet layout restores subscripts and removes split question-number suffixes', () => {
  assert.deepEqual(mergeInlineScriptRows([
    { pageNumber:1, y:115.5, parts:[{ x:48, text:'Q.2' }, { x:64, text:'PEPCase fixes CO' }, { x:135, text:'in …' }], text:'Q.2 PEPCase fixes CO in …' },
    { pageNumber:1, y:113.5, parts:[{ x:129, text:'2' }], text:'2' },
    { pageNumber:1, y:106, parts:[{ x:52, text:'0' }], text:'0' },
  ]).map(row => row.text), ['Q.2 PEPCase fixes CO₂ in …']);
});

test('legacy paper parser keeps only numbered blocks with four ordered choices', () => {
  const lines = [
    '1. Instruction without choices',
    '1. What is the SI unit of force? A) Joule B) Newton C) Watt D) Pascal',
    '2. Select the noble gas. A) Oxygen B) Nitrogen C) Neon D) Chlorine',
  ];
  const blocks = extractQuestionBlocks(lines, 2);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].question, 'What is the SI unit of force?');
  assert.deepEqual(blocks[0].options, { A:'Joule', B:'Newton', C:'Watt', D:'Pascal' });
  assert.deepEqual(sequentialOptionMarkers(blocks[0].raw).map(marker => marker.label), ['A','B','C','D']);
});

test('answer-key parser reconstructs column-oriented official key rows', () => {
  const answers = extractAnswerKey([
    'Sr.No KEY Sr.No KEY Sr.No KEY Sr.No KEY',
    '1 C 26 A 51 D 76 B',
    '2 B 27 B 52 A 77 A',
  ], 100);
  assert.equal(answers.get(1), 'C');
  assert.equal(answers.get(26), 'A');
  assert.equal(answers.get(52), 'A');
  assert.equal(answers.get(77), 'A');
});

test('CET taxonomy inference provides immediate subject, chapter and subtopic hierarchy', () => {
  assert.deepEqual(inferTopic('Physics', 'A convex lens forms a real image.'), {
    topic:'Ray Optics', subtopic:'Mirrors, lenses and optical instruments',
  });
  assert.deepEqual(inferTopic('Chemistry', 'Calculate the pH of the buffer solution.'), {
    topic:'Chemical Equilibrium', subtopic:'Ionic and chemical equilibrium',
  });
  assert.deepEqual(inferTopic('Biology', 'Which cell organelle contains its own DNA?'), {
    topic:'Cell Biology', subtopic:'Cell structure and division',
  });
});

test('official CET rows normalize into reusable, attributed portal questions', async () => {
  const source = SOURCES.find(item => item.code === 'MHT_CET_2016_PC');
  const normalized = normalizeQuestion(source, {
    number:1,
    question:'What is the dimensional formula of force?',
    options:{ A:'MLT−1', B:'MLT−2', C:'ML2T−2', D:'M0LT−1' },
  }, 'B');
  assert.ok(normalized.value);
  assert.deepEqual(normalized.value.course, ['CET']);
  assert.equal(normalized.value.pyq.exam, 'CET');
  assert.equal(normalized.value.pyq.year, 2016);
  assert.equal(normalized.value.pyq.sourceKey, 'MHT_CET_2016_PC:Q1');
  assert.equal(normalized.value.subject, 'Physics');
  assert.equal(normalized.value.correctAnswer, 'B');
  assert.equal(normalized.value.topic, 'Units and Measurements');
  await new Question(normalized.value).validate();
});

test('CET quality gate rejects visually dependent and incomplete questions', () => {
  const source = SOURCES[0];
  assert.equal(normalizeQuestion(source, {
    number:1,
    question:'Find the current in the circuit shown in the following figure.',
    options:{ A:'1 A', B:'2 A', C:'3 A', D:'4 A' },
  }, 'A').error, 'visual-dependent');
  assert.equal(normalizeQuestion(source, {
    number:2,
    question:'Which cells are labelled in the given diagram?',
    options:{ A:'First', B:'Second', C:'Third', D:'Fourth' },
  }, 'A').error, 'visual-dependent');
  assert.equal(normalizeQuestion(source, {
    number:3,
    question:'Which statement is correct for this chemical reaction?',
    options:{ A:'', B:'Second', C:'Third', D:'Fourth' },
  }, 'B').error, 'invalid-options');
});

test('relative difficulty assignment produces all three transparent bands', () => {
  const rows = Array.from({ length:20 }, (_, index) => ({
    complexity:index,
    value:{ subject:'Physics', difficulty:'Medium', pyq:{ sourceKey:`q-${index}` } },
  }));
  assignRelativeDifficulties(rows);
  assert.deepEqual(new Set(rows.map(row => row.value.difficulty)), new Set(['Easy','Medium','Hard']));
});
