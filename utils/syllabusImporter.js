const crypto = require('crypto');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');
const { z } = require('zod');
const { zodTextFormat } = require('openai/helpers/zod');

const SUBJECTS_BY_COURSE = {
  JEE: ['Physics', 'Chemistry', 'Mathematics'],
  CET: ['Physics', 'Chemistry', 'Mathematics', 'Biology'],
  NEET: ['Physics', 'Chemistry', 'Biology'],
};

const SyllabusUnitSchema = z.object({
  subject: z.string(),
  unitName: z.string(),
  subtopics: z.array(z.string()),
});

const SyllabusExtractionSchema = z.object({
  units: z.array(SyllabusUnitSchema),
  warnings: z.array(z.string()),
});

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueText(values) {
  const seen = new Set();
  return values.map(cleanText).filter(value => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanUnitName(value) {
  return cleanText(value)
    .replace(/^(?:unit|chapter|section|module)\s+(?:\d+|[ivxlcdm]+)\s*[:.)-]\s*/i, '')
    .trim();
}

function cleanSubtopic(value) {
  return cleanText(value)
    .replace(/^(?:\d+(?:\.\d+)+|\d+)[.)-]?\s+/, '')
    .replace(/^[•·▪◦*-]\s+/, '')
    .trim();
}

function normalizeSubject(value) {
  const subject = cleanText(value).toLocaleLowerCase();
  if (['math', 'maths', 'mathematics'].includes(subject)) return 'Mathematics';
  if (subject === 'physics') return 'Physics';
  if (subject === 'chemistry') return 'Chemistry';
  if (['biology', 'botany', 'zoology'].includes(subject)) return 'Biology';
  return cleanText(value);
}

function normalizeResult(result, course, requestedSubject) {
  const validSubjects = SUBJECTS_BY_COURSE[course] || [];
  const fallbackSubject = requestedSubject ? normalizeSubject(requestedSubject) : '';
  const units = [];
  const byKey = new Map();

  for (const row of result.units || []) {
    const subject = fallbackSubject || normalizeSubject(row.subject);
    const unitName = cleanUnitName(row.unitName);
    if (!validSubjects.includes(subject) || !unitName) continue;
    const key = `${subject.toLocaleLowerCase()}::${unitName.toLocaleLowerCase()}`;
    const subtopics = uniqueText((row.subtopics || []).map(cleanSubtopic));
    const existing = byKey.get(key);
    if (existing) {
      existing.subtopics = uniqueText([...existing.subtopics, ...subtopics]);
    } else {
      const unit = { subject, unitName, subtopics };
      units.push(unit);
      byKey.set(key, unit);
    }
  }

  return {
    units,
    warnings: uniqueText(result.warnings || []),
  };
}

function syllabusPrompt(course, subject, filename) {
  const validSubjects = SUBJECTS_BY_COURSE[course].join(', ');
  const subjectRule = subject
    ? `Every extracted unit belongs to ${subject}. Set subject to exactly "${subject}".`
    : `Detect the subject for each unit, but use only these valid ${course} subjects: ${validSubjects}.`;

  return `You are digitizing an entrance-exam syllabus PDF into a structured hierarchy.

Course: ${course}
Source: ${filename}
${subjectRule}

Instructions:
1. Read every page, including scanned pages, tables, columns, and continued sections.
2. Extract the complete hierarchy as Subject -> Unit/Chapter -> Subtopics.
3. A unitName must be the real unit, chapter, section, or main syllabus heading from the source.
4. Subtopics must contain the detailed syllabus points that belong to that unit. Preserve meaningful source wording and order.
5. Ignore cover-page text, exam instructions, eligibility, marking schemes, page numbers, headers, footers, question papers, answer keys, and duplicate entries.
6. Never invent text. If a section is unreadable or its hierarchy is uncertain, add a concise warning.
7. Merge a unit continued across pages. Do not emit duplicate units.
8. Do not turn each bullet into a separate unit when the PDF clearly groups those bullets under one unit.
9. Return all detected units, not a summary or sample.`;
}

async function extractWithGemini(file, course, subject) {
  const primaryModel = process.env.GEMINI_SYLLABUS_MODEL || process.env.GEMINI_OCR_MODEL || 'gemini-3.5-flash';
  const fallbackModel = process.env.GEMINI_OCR_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
  const models = [...new Set([primaryModel, fallbackModel])];
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const { $schema, ...responseJsonSchema } = z.toJSONSchema(SyllabusExtractionSchema);
  const failures = [];

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          { text: syllabusPrompt(course, subject, file.name) },
          { inlineData: { mimeType: 'application/pdf', data: file.data.toString('base64') } },
        ],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema,
          maxOutputTokens: Number(process.env.GEMINI_SYLLABUS_MAX_OUTPUT_TOKENS) || 32768,
        },
      });
      if (!response.text) throw new Error('Gemini returned an empty response.');
      const parsed = SyllabusExtractionSchema.parse(JSON.parse(response.text));
      return { ...normalizeResult(parsed, course, subject), method: 'gemini', model };
    } catch (error) {
      failures.push(`${model}: ${error.message}`);
    }
  }

  throw new Error(`Gemini syllabus scan failed. ${failures.join(' | ')}`);
}

async function extractWithOpenAI(file, course, subject, adminId) {
  const model = process.env.OPENAI_SYLLABUS_MODEL || process.env.OPENAI_OCR_MODEL || 'gpt-5.6';
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: Number(process.env.OPENAI_OCR_TIMEOUT_MS) || 10 * 60 * 1000,
    maxRetries: 2,
  });
  const response = await openai.responses.parse({
    model,
    reasoning: { effort: process.env.OPENAI_OCR_REASONING_EFFORT || 'high' },
    max_output_tokens: Number(process.env.OPENAI_SYLLABUS_MAX_OUTPUT_TOKENS) || 32768,
    store: false,
    safety_identifier: crypto.createHash('sha256').update(String(adminId || 'admin')).digest('hex'),
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: syllabusPrompt(course, subject, file.name) },
        {
          type: 'input_file',
          filename: file.name,
          file_data: `data:application/pdf;base64,${file.data.toString('base64')}`,
          detail: 'high',
        },
      ],
    }],
    text: { format: zodTextFormat(SyllabusExtractionSchema, 'syllabus_import') },
  });
  if (!response.output_parsed) throw new Error('OpenAI returned no usable syllabus hierarchy.');
  return { ...normalizeResult(response.output_parsed, course, subject), method: 'openai', model };
}

async function extractSyllabusFromPdf(file, options = {}) {
  const course = cleanText(options.course).toUpperCase();
  const subject = options.subject ? normalizeSubject(options.subject) : '';
  if (!SUBJECTS_BY_COURSE[course]) throw new Error('Select a valid course.');
  if (subject && !SUBJECTS_BY_COURSE[course].includes(subject)) {
    throw new Error(`${subject} is not configured for ${course}.`);
  }

  const failures = [];
  if (process.env.GEMINI_API_KEY) {
    try {
      return await extractWithGemini(file, course, subject);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      return await extractWithOpenAI(file, course, subject, options.adminId);
    } catch (error) {
      failures.push(`OpenAI syllabus scan failed. ${error.message}`);
    }
  }
  if (failures.length) throw new Error(failures.join(' | '));
  throw new Error('Add GEMINI_API_KEY or OPENAI_API_KEY to import a syllabus PDF.');
}

module.exports = {
  SUBJECTS_BY_COURSE,
  normalizeSubject,
  normalizeResult,
  extractSyllabusFromPdf,
};
