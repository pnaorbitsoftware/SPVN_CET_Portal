const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const xlsx = require('xlsx');
const sharp = require('sharp');
const AdmZip = require('adm-zip');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');
const { createCanvas } = require('@napi-rs/canvas');
const { z } = require('zod');
const { zodTextFormat } = require('openai/helpers/zod');
const { QUESTION_SUB_TYPES, QUESTION_TYPES, cleanList } = require('../services/questionService');

const execFileAsync = promisify(execFile);

const SPREADSHEET_EXTENSIONS = new Set(['.csv','.xls','.xlsx']);
const DOCUMENT_EXTENSIONS = new Set(['.pdf','.doc','.docx','.rtf','.odt','.txt','.md']);
const IMAGE_EXTENSIONS = new Set(['.jpg','.jpeg','.png','.webp','.gif','.heic','.heif','.tif','.tiff','.bmp']);
const SUPPORTED_EXTENSIONS = new Set([
  ...SPREADSHEET_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
]);

const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.bmp': 'image/bmp',
};

const VisualBoxSchema = z.object({
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
  width: z.number().min(1).max(1000),
  height: z.number().min(1).max(1000),
}).nullable();

const MCQSchema = z.object({
  question: z.string(),
  questionImageSource: z.string(),
  questionImageBox: VisualBoxSchema,
  optionA: z.string(),
  optionB: z.string(),
  optionC: z.string(),
  optionD: z.string(),
  correctAnswer: z.enum(['A','B','C','D','UNKNOWN']),
  correctAnswers: z.array(z.enum(['A','B','C','D'])),
  questionType: z.enum(['SINGLE_CORRECT','MULTIPLE_CORRECT','NUMERICAL','TRUE_FALSE']),
  questionSubType: z.enum([...QUESTION_SUB_TYPES, '']).nullable(),
  numericalValue: z.number().nullable(),
  numericalMin: z.number().nullable(),
  numericalMax: z.number().nullable(),
  numericalTolerance: z.number().nullable(),
  tags: z.array(z.string()),
  subject: z.string(),
  topic: z.string(),
  subtopic: z.string(),
  difficulty: z.enum(['Easy','Medium','Hard']),
  marks: z.number(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  sourceLabel: z.string(),
  answerSource: z.enum(['marked','answer_key','provided','inferred','unknown']),
});

const ExtractionSchema = z.object({
  questions: z.array(MCQSchema),
  warnings: z.array(z.string()),
});

const MathVerificationItemSchema = z.object({
  questionIndex: z.number().int().nonnegative(),
  question: z.string(),
  optionA: z.string(),
  optionB: z.string(),
  optionC: z.string(),
  optionD: z.string(),
  matchesSource: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const MathVerificationSchema = z.object({
  questions: z.array(MathVerificationItemSchema),
  warnings: z.array(z.string()),
});

function extensionOf(file) {
  return path.extname(String(file?.name || '')).toLowerCase();
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizedHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, '');
}

function normalizedRow(row) {
  const result = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    result[normalizedHeader(key)] = value;
  });
  return result;
}

function firstValue(row, aliases) {
  for (const alias of aliases) {
    const value = row[normalizedHeader(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

const FIELD_ALIASES = {
  question: ['question','questiontext','questionstatement','q','प्रश्न'],
  optionA: ['optiona','a','answera','choicea','पर्यायअ'],
  optionB: ['optionb','b','answerb','choiceb','पर्यायब'],
  optionC: ['optionc','c','answerc','choicec','पर्यायक'],
  optionD: ['optiond','d','answerd','choiced','पर्यायद'],
  correctAnswer: ['correctanswer','answer','correctoption','answerkey','key','ans','उत्तर'],
  correctAnswers: ['correctanswers','answers','correctoptions','multipleanswers'],
  questionType: ['questiontype','type','answertype'],
  questionSubType: ['questionsubtype','subtype','questioncategory'],
  numericalValue: ['numericalvalue','numericanswer','numericalanswer','exactvalue'],
  numericalMin: ['numericalmin','minimum','minvalue'],
  numericalMax: ['numericalmax','maximum','maxvalue'],
  numericalTolerance: ['numericaltolerance','tolerance'],
  tags: ['tags','tag','labels'],
  questionNo: ['questionno','questionnumber','qno','qnumber','number','no','srno','क्रमांक'],
  subject: ['subject','विषय'],
  topic: ['topic','chapter','धडा'],
  subtopic: ['subtopic','subchapter'],
  difficulty: ['difficulty','level'],
  marks: ['marks','mark','points'],
  explanation: ['explanation','solution','reason'],
  questionImage: ['questionimageurl','questionimage','imageurl','image','diagramurl','figureurl'],
};

function normalizeDifficulty(value, fallback = 'Medium') {
  const text = cleanText(value).toLowerCase();
  if (['easy','e','simple'].includes(text)) return 'Easy';
  if (['hard','h','difficult'].includes(text)) return 'Hard';
  if (['medium','m','moderate'].includes(text)) return 'Medium';
  return ['Easy','Medium','Hard'].includes(fallback) ? fallback : 'Medium';
}

function normalizeCorrectAnswer(value, options = {}) {
  const raw = cleanText(value);
  if (!raw) return 'UNKNOWN';
  const simplified = raw
    .toUpperCase()
    .replace(/^CORRECT\s*(ANSWER|OPTION)?\s*[:=-]?\s*/, '')
    .replace(/^ANS(WER)?\s*[:=-]?\s*/, '')
    .replace(/^OPTION\s*/, '')
    .replace(/[()[\].:\-\s]/g, '');
  if (['A','B','C','D'].includes(simplified)) return simplified;
  if (['1','2','3','4'].includes(simplified)) return ['A','B','C','D'][Number(simplified) - 1];

  const answerText = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const letter of ['A','B','C','D']) {
    const optionText = cleanText(options[`option${letter}`]).toLowerCase().replace(/\s+/g, ' ').trim();
    if (optionText && answerText === optionText) return letter;
  }
  return 'UNKNOWN';
}

function normalizeMarks(value, fallback = 1) {
  const marks = Number(value);
  const fallbackMarks = Number(fallback);
  if (Number.isFinite(marks) && marks > 0 && marks <= 100) return marks;
  return Number.isFinite(fallbackMarks) && fallbackMarks > 0 ? fallbackMarks : 1;
}

function normalizeVisualBox(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  const left = Math.max(0, Math.min(999, x));
  const top = Math.max(0, Math.min(999, y));
  const boundedWidth = Math.max(1, Math.min(1000 - left, width));
  const boundedHeight = Math.max(1, Math.min(1000 - top, height));
  if (boundedWidth >= 950 && boundedHeight >= 950) return null;

  return { x: left, y: top, width: boundedWidth, height: boundedHeight };
}

function normalizeQuestion(raw, defaults = {}) {
  const questionType = QUESTION_TYPES.includes(String(raw.questionType || '').toUpperCase())
    ? String(raw.questionType).toUpperCase()
    : 'SINGLE_CORRECT';
  const correctAnswers = cleanList(raw.correctAnswers, { uppercase: true })
    .filter(answer => ['A','B','C','D'].includes(answer));
  const normalized = {
    question: cleanText(raw.question),
    questionImage: cleanText(raw.questionImage || raw.questionImageUrl) || null,
    questionImageSource: cleanText(raw.questionImageSource) || null,
    questionImageBox: normalizeVisualBox(raw.questionImageBox),
    sourceDocument: cleanText(raw.sourceDocument) || null,
    sourcePage: Number.isInteger(Number(raw.sourcePage)) && Number(raw.sourcePage) > 0
      ? Number(raw.sourcePage)
      : null,
    optionA: cleanText(raw.optionA),
    optionB: cleanText(raw.optionB),
    optionC: cleanText(raw.optionC),
    optionD: cleanText(raw.optionD),
    questionType,
    questionSubType: QUESTION_SUB_TYPES.includes(raw.questionSubType) ? raw.questionSubType : null,
    correctAnswers,
    numericalAnswer: {
      value: raw.numericalValue === null || raw.numericalValue === undefined || raw.numericalValue === '' ? null : Number(raw.numericalValue),
      min: raw.numericalMin === null || raw.numericalMin === undefined || raw.numericalMin === '' ? null : Number(raw.numericalMin),
      max: raw.numericalMax === null || raw.numericalMax === undefined || raw.numericalMax === '' ? null : Number(raw.numericalMax),
      tolerance: Math.max(0, Number(raw.numericalTolerance) || 0),
    },
    tags: cleanList(raw.tags),
    subject: cleanText(raw.subject) || cleanText(defaults.subject) || 'Physics',
    topic: cleanText(raw.topic) || cleanText(defaults.topic) || '',
    subtopic: cleanText(raw.subtopic) || cleanText(defaults.subtopic) || '',
    difficulty: normalizeDifficulty(raw.difficulty, defaults.difficulty),
    marks: normalizeMarks(raw.marks, defaults.marks),
    explanation: cleanText(raw.explanation),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    sourceLabel: cleanText(raw.sourceLabel),
    answerSource: ['marked','answer_key','provided','inferred','unknown'].includes(raw.answerSource)
      ? raw.answerSource
      : 'unknown',
  };
  normalized.correctAnswer = normalizeCorrectAnswer(raw.correctAnswer, normalized);
  if (questionType === 'MULTIPLE_CORRECT') {
    normalized.correctAnswers = correctAnswers.length
      ? correctAnswers
      : cleanList(raw.correctAnswer, { uppercase:true }).filter(answer => ['A','B','C','D'].includes(answer));
    normalized.correctAnswer = normalized.correctAnswers[0] || 'UNKNOWN';
  } else if (questionType === 'TRUE_FALSE') {
    normalized.optionA = 'True';
    normalized.optionB = 'False';
    normalized.optionC = '';
    normalized.optionD = '';
  }
  return normalized;
}

function questionCompleteness(question) {
  const required = question.questionType === 'NUMERICAL'
    ? ['question']
    : question.questionType === 'TRUE_FALSE'
      ? ['question','optionA','optionB']
      : ['question','optionA','optionB','optionC','optionD'];
  return required.filter(field => question[field]).length / required.length;
}

function containsMathematicalTranscription(value) {
  return /(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\[A-Za-z]+|[¬∼∨∧→↔⇒⇔∀∃∈∉⊂⊆∪∩≤≥≠≈∞√∑∏∫∆θπαβγ±×÷]|[A-Za-z0-9)}\]]\s*[_^]\s*(?:\{|[-+A-Za-z0-9])|\[\[[\s\S]*\]\]|(?:^|\s)[A-Za-z0-9.)\]]+\s*[=<>+*/]\s*[-+A-Za-z0-9.(])/u
    .test(String(value || '').normalize('NFKC'));
}

function mathematicalQuestionCandidates(questions) {
  return questions.flatMap((question, questionIndex) => {
    const fields = ['question','optionA','optionB','optionC','optionD'];
    if (!fields.some(field => containsMathematicalTranscription(question[field]))) return [];
    return [{
      questionIndex,
      sourceLabel: question.sourceLabel || `Question ${questionIndex + 1}`,
      question: question.question,
      optionA: question.optionA,
      optionB: question.optionB,
      optionC: question.optionC,
      optionD: question.optionD,
    }];
  });
}

function mathVerificationPrompt(candidates) {
  return `You are the final mathematical transcription verifier for an exam digitization system.

Compare every supplied candidate with the attached original question paper at the stated source location. Return every candidate once, in the same questionIndex order.

Rules:
1. Copy the question and all four options from the source exactly. Preserve every variable, digit, sign, bracket, radical, fraction, matrix cell, subscript, superscript, logical operator, quantifier, arrow and punctuation mark.
2. Never solve, simplify, normalize, paraphrase, or substitute symbols. In particular, never change p/q/r, x/y/z, matrix entries, powers, signs, or option order based on what seems mathematically likely.
3. Keep ordinary prose as ordinary text. Put every mathematical expression inside \\( and \\) using valid LaTeX. Never return a bare LaTeX command such as \\sim, \\vee, \\wedge, \\frac, \\sqrt, or \\begin outside math delimiters.
4. Matrices must use \\begin{bmatrix}, & between cells, \\\\ between rows, and \\end{bmatrix}. Preserve the exact matrix dimensions and values.
5. Set matchesSource true only if all five returned fields already matched the source; otherwise return corrected fields and set it false.
6. If any symbol is genuinely unreadable, preserve the best visible transcription, lower confidence, and add a specific warning. Do not guess silently.

Candidates:
${JSON.stringify(candidates)}`;
}

function applyMathVerification(questions, verification) {
  const candidateIndexes = new Set(mathematicalQuestionCandidates(questions).map(item => item.questionIndex));
  const verifiedByIndex = new Map();
  for (const item of verification.questions || []) {
    if (!candidateIndexes.has(item.questionIndex) || verifiedByIndex.has(item.questionIndex)) continue;
    const fields = ['question','optionA','optionB','optionC','optionD'];
    const cleaned = Object.fromEntries(fields.map(field => [field, cleanText(item[field])]));
    if (fields.some(field => !cleaned[field])) continue;
    verifiedByIndex.set(item.questionIndex, { ...item, ...cleaned });
  }

  let correctedCount = 0;
  const verifiedQuestions = questions.map((question, questionIndex) => {
    const verified = verifiedByIndex.get(questionIndex);
    if (!verified) return question;
    if (!verified.matchesSource) correctedCount += 1;
    return {
      ...question,
      question: verified.question,
      optionA: verified.optionA,
      optionB: verified.optionB,
      optionC: verified.optionC,
      optionD: verified.optionD,
      confidence: Math.max(0, Math.min(1, Number(verified.confidence) || question.confidence)),
    };
  });

  return {
    questions: verifiedQuestions,
    verifiedCount: verifiedByIndex.size,
    correctedCount,
    expectedCount: candidateIndexes.size,
  };
}

function deduplicateQuestions(questions) {
  const seen = new Set();
  return questions.filter(question => {
    const key = ['question','optionA','optionB','optionC','optionD']
      .map(field => cleanText(question[field]).toLowerCase())
      .join('|');
    if (!question.question || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workbookRows(file) {
  const workbook = xlsx.read(file.data, { type: 'buffer', cellDates: false });
  const rows = [];
  workbook.SheetNames.forEach(sheetName => {
    const sheetRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
    sheetRows.forEach((row, rowIndex) => {
      rows.push({
        row: normalizedRow(row),
        sourceLabel: `${file.name} / ${sheetName} / row ${rowIndex + 2}`,
      });
    });
  });
  return rows;
}

function extractSpreadsheetQuestions(files, defaults = {}) {
  const warnings = [];
  const allRows = [];
  files.forEach(file => {
    try {
      allRows.push(...workbookRows(file));
    } catch (error) {
      warnings.push(`${file.name}: spreadsheet could not be read (${error.message}).`);
    }
  });

  const answerMap = new Map();
  const sequentialAnswers = [];
  allRows.forEach(({ row }) => {
    const answer = firstValue(row, FIELD_ALIASES.correctAnswer);
    if (!answer) return;
    const questionNo = cleanText(firstValue(row, FIELD_ALIASES.questionNo));
    if (questionNo) answerMap.set(questionNo.replace(/\D/g, '') || questionNo, answer);
    sequentialAnswers.push(answer);
  });

  const questions = [];
  allRows.forEach(({ row, sourceLabel }) => {
    const rawQuestion = {
      question: firstValue(row, FIELD_ALIASES.question),
      questionImage: firstValue(row, FIELD_ALIASES.questionImage),
      optionA: firstValue(row, FIELD_ALIASES.optionA),
      optionB: firstValue(row, FIELD_ALIASES.optionB),
      optionC: firstValue(row, FIELD_ALIASES.optionC),
      optionD: firstValue(row, FIELD_ALIASES.optionD),
      questionType: firstValue(row, FIELD_ALIASES.questionType),
      questionSubType: firstValue(row, FIELD_ALIASES.questionSubType),
      correctAnswers: firstValue(row, FIELD_ALIASES.correctAnswers),
      numericalValue: firstValue(row, FIELD_ALIASES.numericalValue),
      numericalMin: firstValue(row, FIELD_ALIASES.numericalMin),
      numericalMax: firstValue(row, FIELD_ALIASES.numericalMax),
      numericalTolerance: firstValue(row, FIELD_ALIASES.numericalTolerance),
      tags: firstValue(row, FIELD_ALIASES.tags),
      subject: firstValue(row, FIELD_ALIASES.subject),
      topic: firstValue(row, FIELD_ALIASES.topic),
      subtopic: firstValue(row, FIELD_ALIASES.subtopic),
      difficulty: firstValue(row, FIELD_ALIASES.difficulty),
      marks: firstValue(row, FIELD_ALIASES.marks),
      explanation: firstValue(row, FIELD_ALIASES.explanation),
      sourceLabel,
      confidence: 1,
      answerSource: 'provided',
    };
    if (!cleanText(rawQuestion.question)) return;

    const questionNo = cleanText(firstValue(row, FIELD_ALIASES.questionNo));
    const mappedAnswer = questionNo
      ? answerMap.get(questionNo.replace(/\D/g, '') || questionNo)
      : '';
    rawQuestion.correctAnswer = firstValue(row, FIELD_ALIASES.correctAnswer) || mappedAnswer || '';
    if (!rawQuestion.correctAnswer && sequentialAnswers[questions.length]) {
      rawQuestion.correctAnswer = sequentialAnswers[questions.length];
      rawQuestion.answerSource = 'answer_key';
    } else if (mappedAnswer) {
      rawQuestion.answerSource = 'answer_key';
    }

    const question = normalizeQuestion(rawQuestion, defaults);
    const answerMissing = question.questionType === 'NUMERICAL'
      ? !Number.isFinite(question.numericalAnswer?.value) && !(Number.isFinite(question.numericalAnswer?.min) && Number.isFinite(question.numericalAnswer?.max))
      : question.questionType === 'MULTIPLE_CORRECT'
        ? question.correctAnswers.length < 2
        : question.correctAnswer === 'UNKNOWN';
    if (answerMissing) {
      question.confidence = Math.min(question.confidence, 0.75);
      question.answerSource = 'unknown';
    }
    if (questionCompleteness(question) < 1) {
      question.confidence = Math.min(question.confidence, 0.5);
      warnings.push(`${sourceLabel}: required question fields are missing.`);
    }
    questions.push(question);
  });

  if (!questions.length) warnings.push('No standard question rows were found in the spreadsheet.');
  return {
    questions: deduplicateQuestions(questions),
    warnings: [...new Set(warnings)],
    method: 'spreadsheet',
    model: null,
  };
}

async function prepareImage(file) {
  const extension = extensionOf(file);
  let pipeline = sharp(file.data, { animated: false }).rotate();
  const metadata = await pipeline.metadata();
  if ((metadata.width || 0) > 6000 || (metadata.height || 0) > 6000) {
    pipeline = pipeline.resize({
      width: 6000,
      height: 6000,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  const data = await pipeline
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
  return {
    name: `${path.basename(file.name, extension)}.scan.jpg`,
    mimetype: 'image/jpeg',
    data,
  };
}

function docxImages(file) {
  if (extensionOf(file) !== '.docx') return [];
  try {
    const zip = new AdmZip(file.data);
    return zip.getEntries()
      .filter(entry => !entry.isDirectory && /^word\/media\//i.test(entry.entryName))
      .filter(entry => IMAGE_EXTENSIONS.has(path.extname(entry.entryName).toLowerCase()))
      .slice(0, 20)
      .map(entry => ({
        name: `${file.name} — ${path.basename(entry.entryName)}`,
        mimetype: MIME_BY_EXTENSION[path.extname(entry.entryName).toLowerCase()] || 'image/png',
        data: entry.getData(),
      }));
  } catch {
    return [];
  }
}

function safeAssetName(value, fallback = 'source') {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return cleaned || fallback;
}

function sourcePageNumber(question) {
  const text = `${question.sourceLabel || ''} ${question.questionImageSource || ''}`;
  const match = text.match(/(?:page|pg|p\.?)[\s:#-]*(\d{1,4})/i);
  return match ? Number(match[1]) : null;
}

function sourceMatches(hint, sourceName) {
  const lowerHint = String(hint || '').toLowerCase();
  const lowerName = String(sourceName || '').toLowerCase();
  const baseName = path.basename(lowerName);
  return Boolean(lowerHint && (lowerHint.includes(lowerName) || lowerHint.includes(baseName)));
}

function questionNeedsVisual(question) {
  const text = cleanText(question.question);
  const explicitlyVisual = /(diagram|figure|graph|chart|image|map|table|circuit|network|waveform|ray diagram|shown below|pictured|illustrated|structure|आकृती|चित्र|नकाशा|तक्ता)/i
    .test(text);
  if (explicitlyVisual) return true;

  const mathNotationOnly = /(\\begin\{(?:b|p|v|V|small)?matrix\}|\\begin\{array\}|\bmatri(?:x|ces)\b|\bdeterminant\b|\badj(?:oint)?\b)/i
    .test(text);
  if (mathNotationOnly) return false;

  return Boolean(question.questionImageSource && question.questionImageBox);
}

async function renderPdfPage(pdfPath, pageNumber, outputPrefix) {
  const outputPath = `${outputPrefix}.jpg`;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(pdfPath)),
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    });
    try {
      const document = await loadingTask.promise;
      if (pageNumber > document.numPages) return null;
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 220 / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      fs.writeFileSync(outputPath, canvas.toBuffer('image/jpeg', 94));
      return fs.existsSync(outputPath) ? outputPath : null;
    } finally {
      await loadingTask.destroy().catch(() => {});
    }
  } catch {
    try {
      await execFileAsync('pdftoppm', [
        '-jpeg',
        '-r', '220',
        '-f', String(pageNumber),
        '-l', String(pageNumber),
        '-singlefile',
        pdfPath,
        outputPrefix,
      ], { timeout: 120000, maxBuffer: 1024 * 1024 });
      return fs.existsSync(outputPath) ? outputPath : null;
    } catch {
      return null;
    }
  }
}

async function cropVisualRegion(sourcePath, visualBox, outputPath) {
  const box = normalizeVisualBox(visualBox);
  if (!box) return null;

  const { data, info } = await sharp(sourcePath)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!info.width || !info.height) return null;

  const pixelBounds = (x1, y1, x2, y2) => {
    const left = Math.max(0, Math.floor((x1 / 1000) * info.width));
    const top = Math.max(0, Math.floor((y1 / 1000) * info.height));
    const right = Math.min(info.width, Math.ceil((x2 / 1000) * info.width));
    const bottom = Math.min(info.height, Math.ceil((y2 / 1000) * info.height));
    return { left, top, right, bottom };
  };

  const verticalSliceHasInk = (x, top, bottom) => {
    let darkPixels = 0;
    const minimum = Math.max(2, Math.floor((bottom - top) * 0.004));
    for (let y = top; y < bottom; y += 1) {
      if (data[(y * info.width) + x] < 205) darkPixels += 1;
      if (darkPixels >= minimum) return true;
    }
    return false;
  };

  const horizontalSliceHasInk = (y, left, right) => {
    let darkPixels = 0;
    const minimum = Math.max(2, Math.floor((right - left) * 0.003));
    for (let x = left; x < right; x += 1) {
      if (data[(y * info.width) + x] < 205) darkPixels += 1;
      if (darkPixels >= minimum) return true;
    }
    return false;
  };

  const edgeTouchesInk = (side, bounds) => {
    const band = Math.max(3, Math.min(12, Math.round(Math.min(
      bounds.right - bounds.left,
      bounds.bottom - bounds.top,
    ) * 0.02)));
    if (side === 'left' || side === 'right') {
      const start = side === 'left' ? bounds.left : Math.max(bounds.left, bounds.right - band);
      const end = side === 'left' ? Math.min(bounds.right, bounds.left + band) : bounds.right;
      for (let x = start; x < end; x += 1) {
        if (verticalSliceHasInk(x, bounds.top, bounds.bottom)) return true;
      }
      return false;
    }
    const start = side === 'top' ? bounds.top : Math.max(bounds.top, bounds.bottom - band);
    const end = side === 'top' ? Math.min(bounds.bottom, bounds.top + band) : bounds.bottom;
    for (let y = start; y < end; y += 1) {
      if (horizontalSliceHasInk(y, bounds.left, bounds.right)) return true;
    }
    return false;
  };

  const findWhitespaceBoundary = (side, bounds) => {
    if (!edgeTouchesInk(side, bounds)) {
      return side === 'left' ? bounds.left
        : side === 'right' ? bounds.right
          : side === 'top' ? bounds.top : bounds.bottom;
    }

    const horizontal = side === 'left' || side === 'right';
    const negative = side === 'left' || side === 'top';
    const start = side === 'left' ? bounds.left
      : side === 'right' ? bounds.right - 1
        : side === 'top' ? bounds.top : bounds.bottom - 1;
    const span = horizontal ? bounds.right - bounds.left : bounds.bottom - bounds.top;
    const pageSpan = horizontal ? info.width : info.height;
    const maxDistance = Math.round(Math.max(
      horizontal ? 100 : 60,
      Math.min(span * (horizontal ? 0.9 : 0.7), pageSpan * (horizontal ? 0.35 : 0.2)),
    ));
    const blankTarget = Math.max(8, Math.min(22, Math.round(Math.min(info.width, info.height) / 180)));
    const contentMargin = Math.max(5, Math.min(14, Math.round(blankTarget * 0.65)));
    let lastInk = start;
    let blankRun = 0;

    for (let distance = 1; distance <= maxDistance; distance += 1) {
      const position = start + (negative ? -distance : distance);
      if (position <= 0 || position >= pageSpan - 1) break;
      const hasInk = horizontal
        ? verticalSliceHasInk(position, bounds.top, bounds.bottom)
        : horizontalSliceHasInk(position, bounds.left, bounds.right);
      if (hasInk) {
        lastInk = position;
        blankRun = 0;
      } else {
        blankRun += 1;
        if (blankRun >= blankTarget) break;
      }
    }

    return negative
      ? Math.max(0, lastInk - contentMargin)
      : Math.min(pageSpan, lastInk + contentMargin + 1);
  };

  const paddingX = Math.max(18, Math.min(55, box.width * 0.08));
  const paddingY = Math.max(10, Math.min(28, box.height * 0.08));
  const bounds = pixelBounds(
    Math.max(0, box.x - paddingX),
    Math.max(0, box.y - paddingY),
    Math.min(1000, box.x + box.width + paddingX),
    Math.min(1000, box.y + box.height + paddingY),
  );
  if (bounds.right - bounds.left < 20 || bounds.bottom - bounds.top < 20) return null;

  bounds.left = findWhitespaceBoundary('left', bounds);
  bounds.right = findWhitespaceBoundary('right', bounds);
  bounds.top = findWhitespaceBoundary('top', bounds);
  bounds.bottom = findWhitespaceBoundary('bottom', bounds);
  const finalBounds = {
    left: bounds.left,
    top: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  };
  if (finalBounds.width < 20 || finalBounds.height < 20) return null;

  await sharp(sourcePath)
    .extract(finalBounds)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(outputPath);
  return outputPath;
}

async function preserveQuestionVisuals(files, questions, importId) {
  const importKey = safeAssetName(String(importId), crypto.randomUUID());
  const publicRoot = path.join(__dirname, '..', 'public');
  const relativeDir = path.posix.join('uploads', 'questions', 'scans', importKey);
  const outputDir = path.join(publicRoot, ...relativeDir.split('/'));
  fs.mkdirSync(outputDir, { recursive: true });

  const standaloneImages = [];
  const embeddedImages = [];
  const pdfAssets = [];
  const warnings = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const extension = extensionOf(file);
    const assetPrefix = `${fileIndex + 1}-${safeAssetName(path.basename(file.name, extension), 'source')}`;

    if (IMAGE_EXTENSIONS.has(extension)) {
      try {
        const image = await prepareImage(file);
        const fileName = `${assetPrefix}-source.jpg`;
        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, image.data);
        standaloneImages.push({
          sourceName: file.name,
          filePath,
        });
      } catch (error) {
        warnings.push(`${file.name}: source image could not be preserved (${error.message}).`);
      }
      continue;
    }

    if (extension === '.pdf') {
      const fileName = `${assetPrefix}-source.pdf`;
      const filePath = path.join(outputDir, fileName);
      fs.writeFileSync(filePath, file.data);
      pdfAssets.push({
        sourceName: file.name,
        filePath,
        prefix: assetPrefix,
        renderedPages: new Map(),
      });
    }

    for (const [imageIndex, embeddedImage] of docxImages(file).entries()) {
      try {
        const image = await prepareImage(embeddedImage);
        const fileName = `${assetPrefix}-embedded-${imageIndex + 1}.jpg`;
        fs.writeFileSync(path.join(outputDir, fileName), image.data);
        embeddedImages.push({
          documentName: file.name,
          sourceName: embeddedImage.name,
          url: `/${relativeDir}/${fileName}`,
        });
      } catch (error) {
        warnings.push(`${embeddedImage.name}: embedded image could not be preserved (${error.message}).`);
      }
    }
  }

  const enrichedQuestions = [];
  for (const [questionIndex, originalQuestion] of questions.entries()) {
    const question = { ...originalQuestion };
    const hint = `${question.sourceLabel || ''} ${question.questionImageSource || ''}`;
    const matchedInputFile = files.find(file => sourceMatches(hint, file.name));
    const visualRequired = questionNeedsVisual(question);
    if (!visualRequired && !question.questionImage) {
      question.questionImageSource = null;
      question.questionImageBox = null;
    }

    if (!question.questionImage && standaloneImages.length && visualRequired) {
      const sourceImage = standaloneImages.find(asset => sourceMatches(hint, asset.sourceName))
        || (files.length === 1 && standaloneImages.length === 1 ? standaloneImages[0] : null);
      if (sourceImage && question.questionImageBox) {
        const cropName = `${safeAssetName(path.basename(sourceImage.sourceName, path.extname(sourceImage.sourceName)))}-q-${questionIndex + 1}.jpg`;
        const cropPath = path.join(outputDir, cropName);
        try {
          const croppedPath = await cropVisualRegion(sourceImage.filePath, question.questionImageBox, cropPath);
          if (croppedPath) question.questionImage = `/${relativeDir}/${cropName}`;
        } catch (error) {
          warnings.push(`${question.sourceLabel || sourceImage.sourceName}: diagram crop failed (${error.message}).`);
        }
      } else if (sourceImage) {
        warnings.push(`${question.sourceLabel || sourceImage.sourceName}: diagram coordinates were unavailable, so the full page was not attached.`);
      }
    }

    if (!question.questionImage && embeddedImages.length && visualRequired) {
      const embeddedImage = embeddedImages.find(asset => sourceMatches(hint, asset.sourceName))
        || embeddedImages.find(asset => matchedInputFile?.name === asset.documentName
          && embeddedImages.filter(item => item.documentName === asset.documentName).length === 1);
      if (embeddedImage) question.questionImage = embeddedImage.url;
    }

    const pdfAsset = pdfAssets.find(asset => sourceMatches(hint, asset.sourceName))
      || (files.length === 1 && pdfAssets.length === 1 ? pdfAssets[0] : null);
    if (pdfAsset) {
      const pageNumber = sourcePageNumber(question);
      if (!question.questionImage && pageNumber && visualRequired) {
        if (!question.questionImageBox) {
          warnings.push(`${question.sourceLabel || pdfAsset.sourceName}: diagram coordinates were unavailable, so the full PDF page was not attached.`);
        } else {
          if (!pdfAsset.renderedPages.has(pageNumber)) {
            const outputPrefix = path.join(outputDir, `${pdfAsset.prefix}-page-${pageNumber}`);
            const renderedPath = await renderPdfPage(pdfAsset.filePath, pageNumber, outputPrefix);
            pdfAsset.renderedPages.set(pageNumber, renderedPath);
          }
          const renderedPath = pdfAsset.renderedPages.get(pageNumber);
          if (renderedPath) {
            const cropName = `${pdfAsset.prefix}-page-${pageNumber}-q-${questionIndex + 1}.jpg`;
            const cropPath = path.join(outputDir, cropName);
            try {
              const croppedPath = await cropVisualRegion(renderedPath, question.questionImageBox, cropPath);
              if (croppedPath) question.questionImage = `/${relativeDir}/${cropName}`;
            } catch (error) {
              warnings.push(`${question.sourceLabel || pdfAsset.sourceName}: diagram crop failed (${error.message}).`);
            }
          }
          if (!question.questionImage) {
            warnings.push(`${question.sourceLabel || pdfAsset.sourceName}: the diagram could not be cropped and no full-page fallback was attached.`);
          }
        }
      }
    }

    question.sourceDocument = null;
    question.sourcePage = null;

    enrichedQuestions.push(question);
  }

  standaloneImages.forEach(asset => fs.rmSync(asset.filePath, { force: true }));
  pdfAssets.forEach(asset => {
    fs.rmSync(asset.filePath, { force: true });
    asset.renderedPages.forEach(renderedPath => {
      if (renderedPath) fs.rmSync(renderedPath, { force: true });
    });
  });

  return { questions: enrichedQuestions, warnings: [...new Set(warnings)] };
}

function removeQuestionImportAssets(importId) {
  const importKey = safeAssetName(String(importId));
  const outputDir = path.join(__dirname, '..', 'public', 'uploads', 'questions', 'scans', importKey);
  fs.rmSync(outputDir, { recursive: true, force: true });
}

function extractionPrompt(defaults, fileNames) {
  return `You are a high-accuracy exam question digitization engine.

Extract EVERY exam question from the attached files. A page may contain 1, 10, 100, or any other number of questions. Detect single-correct, multiple-correct, numerical-answer and true/false questions; NEVER use page count as question count.

Rules:
1. Read typed text, scans, photographs, and handwriting carefully. Preserve Marathi, English, scientific notation, equations, and Unicode.
2. Set questionType to SINGLE_CORRECT, MULTIPLE_CORRECT, NUMERICAL, or TRUE_FALSE. MCQs must include their corresponding options. True/false uses A=True and B=False. Numerical questions use numericalValue or numericalMin/numericalMax and may leave options empty.
3. Match a separate answer key to question numbers across any of the attached files.
4. Determine answers in this priority order: visibly marked answer, separate answer key, explicitly provided answer, then inference only when sufficiently certain. Use correctAnswer for single/true-false, correctAnswers for multiple-correct, and numerical fields for numerical questions. If uncertain, use UNKNOWN/empty values and add a warning.
5. Never invent unreadable or missing text. Use an empty string for unreadable fields, lower confidence, and add a warning.
6. Ignore headings, page numbers, instructions, examples without four options, watermarks, and duplicate questions.
7. sourceLabel must identify the filename plus page/row/question number when visible.
8. confidence is 0 to 1 for the transcription and option association, not merely answer certainty.
9. Use these defaults only when metadata is absent:
   subject=${cleanText(defaults.subject) || 'Physics'}
   topic=${cleanText(defaults.topic)}
   subtopic=${cleanText(defaults.subtopic)}
   difficulty=${normalizeDifficulty(defaults.difficulty)}
   marks=${normalizeMarks(defaults.marks)}
10. Preserve mathematical structure using valid LaTeX inside \\( and \\) delimiters. Matrices must use \\begin{bmatrix} rows separated by \\\\ and cells separated by & \\end{bmatrix}; fractions, roots, powers, subscripts, vectors, limits, integrals and scientific notation must remain structurally correct. Keep ordinary prose outside the math delimiters. Never emit bare LaTeX commands outside delimiters.
11. questionImageSource must be the exact attached image filename, embedded-image filename, or PDF filename plus page number only when the answer depends on genuinely non-text visual information such as a circuit, graph, geometry figure, map, labelled scientific diagram, or picture. A matrix, determinant, equation, formula, symbolic expression, normal text table, or mathematical notation is NOT a question image when it can be transcribed into the question/options; for those, use an empty string.
12. questionImageBox must be null when no genuine visual is required. When one is required, inspect at high detail and return the bounding box of the COMPLETE visual as x, y, width, and height normalized from 0 to 1000. Include every connected line, arrow, endpoint, dot, label, legend, axis, scale, caption and boundary belonging to that visual. Exclude page margins, headings, question text, options, answers and neighbouring questions. Check all four edges before returning; never return a partial visual or the whole page.
13. For every mathematical question, compare the final question and each option character-by-character with the source before returning it. Never simplify an expression or substitute variables, digits, matrix values, operators, signs, brackets, powers or subscripts based on what seems likely.
14. explanation, topic, subtopic, questionSubType and tags may be empty. Use a supported questionSubType only when clear from the source.

Attached source names: ${fileNames.join(', ')}`;
}

async function buildOpenAIContent(files) {
  const content = [];
  for (const file of files) {
    const extension = extensionOf(file);
    if (IMAGE_EXTENSIONS.has(extension)) {
      const image = await prepareImage(file);
      content.push({
        type: 'input_text',
        text: `The next image source filename is: ${file.name}`,
      });
      content.push({
        type: 'input_image',
        image_url: `data:${image.mimetype};base64,${image.data.toString('base64')}`,
        detail: 'original',
      });
      continue;
    }

    const mimeType = file.mimetype && file.mimetype !== 'application/octet-stream'
      ? file.mimetype
      : MIME_BY_EXTENSION[extension] || 'application/octet-stream';
    const fileContent = {
      type: 'input_file',
      filename: file.name,
      file_data: `data:${mimeType};base64,${file.data.toString('base64')}`,
    };
    if (extension === '.pdf') fileContent.detail = 'high';
    content.push(fileContent);

    for (const embeddedImage of docxImages(file)) {
      const image = await prepareImage(embeddedImage);
      content.push({
        type: 'input_text',
        text: `The next image was embedded in ${file.name}; embedded filename: ${embeddedImage.name}`,
      });
      content.push({
        type: 'input_image',
        image_url: `data:${image.mimetype};base64,${image.data.toString('base64')}`,
        detail: 'original',
      });
    }
  }
  return content;
}

async function buildGeminiContent(files) {
  const content = [];
  for (const file of files) {
    const extension = extensionOf(file);
    if (IMAGE_EXTENSIONS.has(extension)) {
      const image = await prepareImage(file);
      content.push({ text: `The next image source filename is: ${file.name}` });
      content.push({
        inlineData: {
          mimeType: image.mimetype,
          data: image.data.toString('base64'),
        },
      });
      continue;
    }

    const mimeType = file.mimetype && file.mimetype !== 'application/octet-stream'
      ? file.mimetype
      : MIME_BY_EXTENSION[extension] || 'application/octet-stream';
    content.push({ text: `The next document source filename is: ${file.name}` });
    content.push({
      inlineData: {
        mimeType,
        data: file.data.toString('base64'),
      },
    });

    for (const embeddedImage of docxImages(file)) {
      const image = await prepareImage(embeddedImage);
      content.push({ text: `The next image was embedded in ${file.name}; embedded filename: ${embeddedImage.name}` });
      content.push({
        inlineData: {
          mimeType: image.mimetype,
          data: image.data.toString('base64'),
        },
      });
    }
  }
  return content;
}

async function verifyMathWithOpenAI(openai, model, files, questions, adminId = '') {
  const candidates = mathematicalQuestionCandidates(questions);
  if (!candidates.length || process.env.MATH_OCR_VERIFY === 'false') {
    return { questions, warnings: [], verifiedCount: 0, correctedCount: 0, expectedCount: candidates.length };
  }

  const content = await buildOpenAIContent(files);
  content.unshift({ type: 'input_text', text: mathVerificationPrompt(candidates) });
  const response = await openai.responses.parse({
    model,
    reasoning: { effort: process.env.OPENAI_OCR_REASONING_EFFORT || 'high' },
    max_output_tokens: Number(process.env.OPENAI_OCR_MAX_OUTPUT_TOKENS) || 64000,
    store: false,
    safety_identifier: crypto.createHash('sha256').update(String(adminId || 'admin')).digest('hex'),
    input: [{ role: 'user', content }],
    text: {
      format: zodTextFormat(MathVerificationSchema, 'math_transcription_verification'),
    },
  });
  if (!response.output_parsed) throw new Error('The mathematical verification pass returned no usable result.');

  const applied = applyMathVerification(questions, response.output_parsed);
  const warnings = response.output_parsed.warnings.map(cleanText).filter(Boolean);
  if (applied.verifiedCount < applied.expectedCount) {
    warnings.push(`Mathematical verification covered ${applied.verifiedCount} of ${applied.expectedCount} detected maths questions. Review the remaining formula questions manually.`);
  }
  return { ...applied, warnings };
}

async function verifyMathWithGemini(ai, model, files, questions) {
  const candidates = mathematicalQuestionCandidates(questions);
  if (!candidates.length || process.env.MATH_OCR_VERIFY === 'false') {
    return { questions, warnings: [], verifiedCount: 0, correctedCount: 0, expectedCount: candidates.length };
  }

  const { $schema, ...responseJsonSchema } = z.toJSONSchema(MathVerificationSchema);
  const response = await ai.models.generateContent({
    model,
    contents: [
      { text: mathVerificationPrompt(candidates) },
      ...await buildGeminiContent(files),
    ],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema,
      maxOutputTokens: Number(process.env.GEMINI_OCR_MAX_OUTPUT_TOKENS) || 65536,
    },
  });
  if (!response.text) throw new Error('The mathematical verification pass returned no usable result.');

  const parsed = MathVerificationSchema.parse(JSON.parse(response.text));
  const applied = applyMathVerification(questions, parsed);
  const warnings = parsed.warnings.map(cleanText).filter(Boolean);
  if (applied.verifiedCount < applied.expectedCount) {
    warnings.push(`Mathematical verification covered ${applied.verifiedCount} of ${applied.expectedCount} detected maths questions. Review the remaining formula questions manually.`);
  }
  return { ...applied, warnings };
}

async function extractWithOpenAI(files, defaults = {}, adminId = '') {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required to scan PDF, Word, or handwritten image files.');
  }

  const model = process.env.OPENAI_OCR_MODEL || 'gpt-5.6';
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: Number(process.env.OPENAI_OCR_TIMEOUT_MS) || 10 * 60 * 1000,
    maxRetries: 2,
  });
  const content = await buildOpenAIContent(files);
  content.unshift({
    type: 'input_text',
    text: extractionPrompt(defaults, files.map(file => file.name)),
  });

  const response = await openai.responses.parse({
    model,
    reasoning: { effort: process.env.OPENAI_OCR_REASONING_EFFORT || 'high' },
    max_output_tokens: Number(process.env.OPENAI_OCR_MAX_OUTPUT_TOKENS) || 64000,
    store: false,
    safety_identifier: crypto.createHash('sha256').update(String(adminId || 'admin')).digest('hex'),
    input: [{ role: 'user', content }],
    text: {
      format: zodTextFormat(ExtractionSchema, 'question_import'),
    },
  });

  if (!response.output_parsed) {
    throw new Error('The AI scanner did not return a usable structured result.');
  }

  let questions = response.output_parsed.questions.map(question => normalizeQuestion(question, defaults));
  const warnings = [...response.output_parsed.warnings];
  try {
    const verification = await verifyMathWithOpenAI(openai, model, files, questions, adminId);
    questions = verification.questions;
    warnings.push(...verification.warnings);
  } catch (error) {
    warnings.push(`Mathematical transcription verification could not complete: ${error.message}`);
  }
  questions.forEach(question => {
    if (question.correctAnswer === 'UNKNOWN') {
      warnings.push(`${question.sourceLabel || 'A question'}: correct answer needs manual review.`);
    }
    if (questionCompleteness(question) < 1) {
      warnings.push(`${question.sourceLabel || 'A question'}: question text or options need manual review.`);
    }
  });

  return {
    questions: deduplicateQuestions(questions),
    warnings: [...new Set(warnings.map(cleanText).filter(Boolean))],
    method: 'openai',
    model,
  };
}

async function extractWithGemini(files, defaults = {}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required to use the Gemini scanner.');
  }

  const primaryModel = process.env.GEMINI_OCR_MODEL || 'gemini-3.5-flash';
  const fallbackModel = process.env.GEMINI_OCR_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
  const models = [...new Set([primaryModel, fallbackModel])];
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const content = [
    { text: extractionPrompt(defaults, files.map(file => file.name)) },
    ...await buildGeminiContent(files),
  ];
  const { $schema, ...responseJsonSchema } = z.toJSONSchema(ExtractionSchema);
  const failures = [];

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: content,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema,
          maxOutputTokens: Number(process.env.GEMINI_OCR_MAX_OUTPUT_TOKENS) || 65536,
        },
      });
      if (!response.text) throw new Error('Gemini returned an empty response.');

      const parsed = ExtractionSchema.parse(JSON.parse(response.text));
      let questions = parsed.questions.map(question => normalizeQuestion(question, defaults));
      const warnings = [...parsed.warnings];
      try {
        const verification = await verifyMathWithGemini(ai, model, files, questions);
        questions = verification.questions;
        warnings.push(...verification.warnings);
      } catch (error) {
        warnings.push(`Mathematical transcription verification could not complete: ${error.message}`);
      }
      questions.forEach(question => {
        if (question.correctAnswer === 'UNKNOWN') {
          warnings.push(`${question.sourceLabel || 'A question'}: correct answer needs manual review.`);
        }
        if (questionCompleteness(question) < 1) {
          warnings.push(`${question.sourceLabel || 'A question'}: question text or options need manual review.`);
        }
      });
      return {
        questions: deduplicateQuestions(questions),
        warnings: [...new Set(warnings.map(cleanText).filter(Boolean))],
        method: 'gemini',
        model,
      };
    } catch (error) {
      failures.push(`${model}: ${error.message}`);
    }
  }

  throw new Error(`Gemini scan failed. ${failures.join(' | ')}`);
}

async function extractQuestionFiles(files, defaults = {}, adminId = '') {
  const allSpreadsheets = files.every(file => SPREADSHEET_EXTENSIONS.has(extensionOf(file)));
  if (allSpreadsheets) {
    const spreadsheetResult = extractSpreadsheetQuestions(files, defaults);
    if (spreadsheetResult.questions.length || (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY)) return spreadsheetResult;
  }

  const failures = [];
  if (process.env.GEMINI_API_KEY) {
    try {
      return await extractWithGemini(files, defaults);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      return await extractWithOpenAI(files, defaults, adminId);
    } catch (error) {
      failures.push(`OpenAI scan failed. ${error.message}`);
    }
  }
  if (failures.length) throw new Error(failures.join(' | '));
  throw new Error('Add GEMINI_API_KEY or OPENAI_API_KEY to scan PDF, Word, or handwritten image files.');
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  SPREADSHEET_EXTENSIONS,
  IMAGE_EXTENSIONS,
  extensionOf,
  normalizeQuestion,
  containsMathematicalTranscription,
  mathematicalQuestionCandidates,
  applyMathVerification,
  preserveQuestionVisuals,
  removeQuestionImportAssets,
  extractSpreadsheetQuestions,
  extractWithOpenAI,
  extractWithGemini,
  extractQuestionFiles,
};
