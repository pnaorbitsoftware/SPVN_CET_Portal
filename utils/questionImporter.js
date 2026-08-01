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
const { z } = require('zod');
const { zodTextFormat } = require('openai/helpers/zod');

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

const MCQSchema = z.object({
  question: z.string(),
  questionImageSource: z.string(),
  optionA: z.string(),
  optionB: z.string(),
  optionC: z.string(),
  optionD: z.string(),
  correctAnswer: z.enum(['A','B','C','D','UNKNOWN']),
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

function normalizeQuestion(raw, defaults = {}) {
  const normalized = {
    question: cleanText(raw.question),
    questionImage: cleanText(raw.questionImage || raw.questionImageUrl) || null,
    questionImageSource: cleanText(raw.questionImageSource) || null,
    sourceDocument: cleanText(raw.sourceDocument) || null,
    sourcePage: Number.isInteger(Number(raw.sourcePage)) && Number(raw.sourcePage) > 0
      ? Number(raw.sourcePage)
      : null,
    optionA: cleanText(raw.optionA),
    optionB: cleanText(raw.optionB),
    optionC: cleanText(raw.optionC),
    optionD: cleanText(raw.optionD),
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
  return normalized;
}

function questionCompleteness(question) {
  const required = ['question','optionA','optionB','optionC','optionD'];
  return required.filter(field => question[field]).length / required.length;
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
    if (question.correctAnswer === 'UNKNOWN') {
      question.confidence = Math.min(question.confidence, 0.75);
      question.answerSource = 'unknown';
    }
    if (questionCompleteness(question) < 1) {
      question.confidence = Math.min(question.confidence, 0.5);
      warnings.push(`${sourceLabel}: one or more options are missing.`);
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
  if (question.questionImageSource) return true;
  return /(diagram|figure|graph|chart|image|map|table|circuit|structure|आकृती|चित्र|नकाशा|तक्ता)/i
    .test(question.question || '');
}

async function renderPdfPage(pdfPath, pageNumber, outputPrefix) {
  const outputPath = `${outputPrefix}.jpg`;
  try {
    await execFileAsync('pdftoppm', [
      '-jpeg',
      '-r', '150',
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
        const fileName = `${assetPrefix}.jpg`;
        fs.writeFileSync(path.join(outputDir, fileName), image.data);
        standaloneImages.push({
          sourceName: file.name,
          url: `/${relativeDir}/${fileName}`,
        });
      } catch (error) {
        warnings.push(`${file.name}: source image could not be preserved (${error.message}).`);
      }
      continue;
    }

    if (extension === '.pdf') {
      const fileName = `${assetPrefix}.pdf`;
      const filePath = path.join(outputDir, fileName);
      fs.writeFileSync(filePath, file.data);
      pdfAssets.push({
        sourceName: file.name,
        filePath,
        url: `/${relativeDir}/${fileName}`,
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
  for (const originalQuestion of questions) {
    const question = { ...originalQuestion };
    const hint = `${question.sourceLabel || ''} ${question.questionImageSource || ''}`;
    const matchedInputFile = files.find(file => sourceMatches(hint, file.name));

    if (!question.questionImage && standaloneImages.length) {
      const sourceImage = standaloneImages.find(asset => sourceMatches(hint, asset.sourceName))
        || (files.length === 1 && standaloneImages.length === 1 ? standaloneImages[0] : null);
      if (sourceImage) question.questionImage = sourceImage.url;
    }

    if (!question.questionImage && embeddedImages.length && questionNeedsVisual(question)) {
      const embeddedImage = embeddedImages.find(asset => sourceMatches(hint, asset.sourceName))
        || embeddedImages.find(asset => matchedInputFile?.name === asset.documentName
          && embeddedImages.filter(item => item.documentName === asset.documentName).length === 1);
      if (embeddedImage) question.questionImage = embeddedImage.url;
    }

    const pdfAsset = pdfAssets.find(asset => sourceMatches(hint, asset.sourceName))
      || (files.length === 1 && pdfAssets.length === 1 ? pdfAssets[0] : null);
    if (pdfAsset) {
      const pageNumber = sourcePageNumber(question);
      question.sourceDocument = pdfAsset.url;
      question.sourcePage = pageNumber;

      if (!question.questionImage && pageNumber && questionNeedsVisual(question)) {
        if (!pdfAsset.renderedPages.has(pageNumber)) {
          const outputPrefix = path.join(outputDir, `${pdfAsset.prefix}-page-${pageNumber}`);
          const renderedPath = await renderPdfPage(pdfAsset.filePath, pageNumber, outputPrefix);
          pdfAsset.renderedPages.set(
            pageNumber,
            renderedPath ? `/${relativeDir}/${path.basename(renderedPath)}` : null
          );
        }
        question.questionImage = pdfAsset.renderedPages.get(pageNumber) || null;
        if (!question.questionImage) {
          warnings.push(`${question.sourceLabel || pdfAsset.sourceName}: visual retained through the original PDF page because page rasterization was unavailable.`);
        }
      }
    }

    enrichedQuestions.push(question);
  }

  return { questions: enrichedQuestions, warnings: [...new Set(warnings)] };
}

function removeQuestionImportAssets(importId) {
  const importKey = safeAssetName(String(importId));
  const outputDir = path.join(__dirname, '..', 'public', 'uploads', 'questions', 'scans', importKey);
  fs.rmSync(outputDir, { recursive: true, force: true });
}

function extractionPrompt(defaults, fileNames) {
  return `You are a high-accuracy exam question digitization engine.

Extract EVERY multiple-choice question from the attached files. A page may contain 1, 10, 100, or any other number of questions. Detect question blocks from their text and A/B/C/D options; NEVER use page count as question count.

Rules:
1. Read typed text, scans, photographs, and handwriting carefully. Preserve Marathi, English, scientific notation, equations, and Unicode.
2. Each output item must contain exactly one question and its four corresponding options A, B, C, and D.
3. Match a separate answer key to question numbers across any of the attached files.
4. Determine correctAnswer in this priority order: visibly ticked/circled/marked answer ("marked"), separate answer key ("answer_key"), answer explicitly written beside the question ("provided"), then solve the MCQ yourself only when sufficiently certain ("inferred"). If uncertain, use "UNKNOWN".
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
10. questionImageSource must be the exact attached image filename, embedded-image filename, or PDF filename plus page number only when the question depends on a diagram, graph, figure, map, table, or other visual. Otherwise use an empty string.
11. explanation may be empty. topic and subtopic may be empty.

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

  const questions = response.output_parsed.questions.map(question => normalizeQuestion(question, defaults));
  const warnings = [...response.output_parsed.warnings];
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
      const questions = parsed.questions.map(question => normalizeQuestion(question, defaults));
      const warnings = [...parsed.warnings];
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
  preserveQuestionVisuals,
  removeQuestionImportAssets,
  extractSpreadsheetQuestions,
  extractWithOpenAI,
  extractWithGemini,
  extractQuestionFiles,
};
