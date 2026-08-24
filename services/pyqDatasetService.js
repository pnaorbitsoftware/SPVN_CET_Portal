const crypto = require('node:crypto');

const DATASET = {
  name: 'datavorous/entrance-exam-dataset',
  version: 'a66a9e715abf764de34755619c6f8068ddf5807d',
  url: 'https://huggingface.co/datasets/datavorous/entrance-exam-dataset',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

const NON_SYLLABUS_TAGS = [
  'AIIMS', 'AP EAMCET', 'BITSAT', 'COMEDK', 'JIPMER', 'KCET',
  'KVPY', 'MHT CET', 'NDA', 'TS EAMCET', 'VITEEE', 'WBJEE',
];

const SOURCES = [
  {
    code: 'JEE_ADVANCED',
    label: 'JEE Advanced',
    exam: 'JEE',
    file: 'search_ADVANCED.parquet',
    size: 800510,
    allowedSubjects: ['Physics', 'Chemistry', 'Mathematics'],
  },
  {
    code: 'JEE_MAIN',
    label: 'JEE Main',
    exam: 'JEE',
    file: 'search_MAIN.parquet',
    size: 32555872,
    allowedSubjects: ['Physics', 'Chemistry', 'Mathematics'],
  },
  {
    code: 'NEET',
    label: 'NEET',
    exam: 'NEET',
    file: 'search_NEET.parquet',
    size: 29694424,
    allowedSubjects: ['Physics', 'Chemistry', 'Biology'],
  },
].map(source => ({
  ...source,
  parquetUrl: `https://huggingface.co/datasets/${DATASET.name}/resolve/${DATASET.version}/${source.file}`,
}));

const ENTITY_MAP = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  minus: '−', times: '×', deg: '°', pi: 'π', theta: 'θ',
};

function decodeEntities(value = '') {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITY_MAP[name.toLowerCase()] ?? match);
}

function cleanHtml(value = '') {
  return decodeEntities(String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(?:p|div|li|ul|ol|table|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseTags(value = '') {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  const matches = [...String(value).matchAll(/['"]([^'"]+)['"]/g)]
    .map(match => match[1].trim())
    .filter(Boolean);
  return [...new Set(matches)];
}

function parseOptions(value = '') {
  if (!value || value === 'None') return [];
  return [...String(value).matchAll(
    /<li\s+class="([^"]*)"[^>]*>[\s\S]*?<span\s+class="option-label">\s*([A-D])\s*<\/span>[\s\S]*?<span\s+class="option-data">([\s\S]*?)<\/span>[\s\S]*?<\/li>/gi
  )].map(match => ({
    key:match[2].toUpperCase(),
    value:cleanHtml(match[3]),
    correct:/\bcorrect\b/i.test(match[1]),
  }));
}

function normalizeSubject(value) {
  if (['Biology', 'Botany', 'Zoology'].includes(value)) return 'Biology';
  return value;
}

function simpleNumericalAnswer(value = '') {
  const text = cleanHtml(value).replace(/^The correct answer is\s*:?\s*/i, '').trim();
  const fraction = text.match(/\\frac\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}/);
  if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2]);
  const plain = text.replace(/^\$|\$$/g, '').trim();
  if (/^[-+]?\d+(?:\.\d+)?(?:\s*[×x]\s*10\s*\^?\s*[-+]?\d+)?$/i.test(plain)) {
    const scientific = plain.match(/^([-+]?\d+(?:\.\d+)?)\s*[×x]\s*10\s*\^?\s*([-+]?\d+)$/i);
    return scientific ? Number(scientific[1]) * (10 ** Number(scientific[2])) : Number(plain);
  }
  return null;
}

function fingerprint(question) {
  return crypto.createHash('sha256')
    .update(String(question).toLocaleLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex');
}

function questionSubType(question, questionType) {
  if (questionType === 'NUMERICAL') return 'numerical';
  if (/assertion.{0,15}reason/i.test(question)) return 'assertion_reason';
  if (/match\s+(?:the\s+)?(?:following|column|list)/i.test(question)) return 'match_based';
  if (/statement\s*(?:i|1|one|a)/i.test(question)) return 'statement_based';
  if (/calculate|find\s+the\s+(?:value|number|ratio|magnitude)|how\s+many/i.test(question)) return 'numerical';
  if (/formula|expression|equation/i.test(question)) return 'formula_based';
  return 'conceptual';
}

function complexityScore(row) {
  const mathTokens = (row.question.match(/\\(?:frac|sum|int|sqrt|begin|left|right|mathrm|mathbf)/g) || []).length;
  const explanationLength = String(row.explanation || '').length;
  const typeWeight = row.questionType === 'NUMERICAL' ? 160 : row.questionType === 'MULTIPLE_CORRECT' ? 120 : 0;
  return row.question.length + Math.min(1000, explanationLength) * 0.35 + mathTokens * 18 + typeWeight;
}

function normalizeRow(raw, source) {
  const original = [raw.question, raw.options].map(String).join('\n');
  if (/<img\b/i.test(original)) return { error:'image-dependent' };

  const tags = parseTags(raw.tags);
  const rawSubject = tags.find(tag => ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Botany', 'Zoology'].includes(tag));
  const subject = normalizeSubject(rawSubject);
  if (!source.allowedSubjects.includes(subject)) return { error:'invalid-subject' };

  const yearLabel = tags.find(tag => /\b(?:19|20)\d{2}\b/.test(tag));
  const year = Number(yearLabel?.match(/\b((?:19|20)\d{2})\b/)?.[1]);
  if (!Number.isInteger(year)) return { error:'missing-year' };

  const hierarchyTags = tags.filter(tag => tag !== rawSubject
    && !/^JEE|^NEET/i.test(tag)
    && !NON_SYLLABUS_TAGS.includes(tag)
    && !/\b(?:19|20)\d{2}\b/.test(tag));
  const topic = hierarchyTags[0] || null;
  // This pinned dataset supplies a chapter/topic plus optional cross-exam
  // classifications. Those classifications are provenance, not subtopics.
  const subtopic = hierarchyTags[1] || null;
  if (!topic) return { error:'missing-topic' };

  const question = cleanHtml(raw.question);
  if (question.length < 15) return { error:'short-question' };

  const parsedOptions = parseOptions(raw.options);
  let questionType;
  let correctAnswer = null;
  let correctAnswers = [];
  let numericalAnswer = null;
  const options = {};
  if (raw.options === 'None') {
    const value = simpleNumericalAnswer(raw.correct_option);
    if (!Number.isFinite(value)) return { error:'invalid-numerical-answer' };
    questionType = 'NUMERICAL';
    numericalAnswer = { value, min:null, max:null, tolerance:0 };
  } else {
    if (parsedOptions.length !== 4 || parsedOptions.some(option => !option.value)) return { error:'invalid-options' };
    correctAnswers = parsedOptions.filter(option => option.correct).map(option => option.key);
    if (!correctAnswers.length) return { error:'missing-answer' };
    questionType = correctAnswers.length > 1 ? 'MULTIPLE_CORRECT' : 'SINGLE_CORRECT';
    correctAnswer = questionType === 'SINGLE_CORRECT' ? correctAnswers[0] : null;
    parsedOptions.forEach(option => { options[`option${option.key}`] = option.value; });
  }

  const explanation = cleanHtml(raw.answer) || null;
  const paper = yearLabel || `${source.label} ${year}`;
  const session = paper.match(/(?:Paper|Shift|Session)\s*[-:]?\s*[A-Z0-9]+/i)?.[0] || null;
  const sourceExternalId = String(raw.id);
  const sourceKey = `${source.code}:${sourceExternalId}`;
  const sourceFingerprint = fingerprint(question);
  const normalized = {
    sourceType:'PYQ',
    course:[source.exam],
    question,
    ...options,
    correctAnswer,
    correctAnswers,
    numericalAnswer,
    questionType,
    questionSubType:questionSubType(question, questionType),
    subject,
    topic,
    subtopic,
    difficulty:'Medium',
    marks:1,
    explanation,
    tags:['PYQ', source.exam, source.label, `Year-${year}`, topic, ...(subtopic ? [subtopic] : [])],
    sourceDocument:`${DATASET.name} · ${source.label}`,
    isActive:true,
    pyq:{
      exam:source.exam,
      variant:source.label,
      year,
      session,
      paper,
      sourceKey,
      sourceExternalId,
      sourceDataset:DATASET.name,
      sourceVersion:DATASET.version,
      sourceUrl:DATASET.url,
      sourceLicense:DATASET.license,
      sourceLicenseUrl:DATASET.licenseUrl,
      sourceFingerprint,
      difficultyBasis:'relative-content-complexity',
    },
  };
  return { value:normalized, complexity:complexityScore(normalized) };
}

function spreadAcrossYears(rows) {
  const buckets = new Map();
  rows.forEach(row => {
    const year = row.value.pyq.year;
    if (!buckets.has(year)) buckets.set(year, []);
    buckets.get(year).push(row);
  });
  const years = [...buckets.keys()].sort((a, b) => b - a);
  buckets.forEach(bucket => bucket.sort((a, b) => a.value.pyq.sourceFingerprint.localeCompare(b.value.pyq.sourceFingerprint)));
  const ordered = [];
  while (years.some(year => buckets.get(year).length)) {
    years.forEach(year => {
      const next = buckets.get(year).shift();
      if (next) ordered.push(next);
    });
  }
  return ordered;
}

function selectBalancedRows(rows, limit) {
  const bySubject = new Map();
  rows.forEach(row => {
    if (!bySubject.has(row.value.subject)) bySubject.set(row.value.subject, []);
    bySubject.get(row.value.subject).push(row);
  });
  bySubject.forEach((values, subject) => bySubject.set(subject, spreadAcrossYears(values)));
  const subjects = [...bySubject.keys()].sort();
  const selected = [];
  while (selected.length < limit && subjects.some(subject => bySubject.get(subject).length)) {
    subjects.forEach(subject => {
      if (selected.length >= limit) return;
      const next = bySubject.get(subject).shift();
      if (next) selected.push(next);
    });
  }
  return selected;
}

function assignRelativeDifficulties(rows) {
  const grouped = new Map();
  rows.forEach(row => {
    if (row.value.pyq.variant === 'JEE Advanced') {
      row.value.difficulty = 'Hard';
      return;
    }
    const key = `${row.value.pyq.variant}:${row.value.subject}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  grouped.forEach(values => {
    values.sort((a, b) => a.complexity - b.complexity);
    values.forEach((row, index) => {
      const percentile = (index + 1) / values.length;
      row.value.difficulty = percentile <= 0.3 ? 'Easy' : percentile > 0.8 ? 'Hard' : 'Medium';
    });
  });
  return rows;
}

module.exports = {
  DATASET,
  NON_SYLLABUS_TAGS,
  SOURCES,
  assignRelativeDifficulties,
  cleanHtml,
  decodeEntities,
  fingerprint,
  normalizeRow,
  parseOptions,
  parseTags,
  selectBalancedRows,
  simpleNumericalAnswer,
};
