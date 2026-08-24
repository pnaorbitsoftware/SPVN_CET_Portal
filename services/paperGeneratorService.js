const mongoose = require('mongoose');
const { cleanList } = require('./questionService');

const DIFFICULTIES = ['Easy','Medium','Hard'];
const QUESTION_TYPES = ['SINGLE_CORRECT','MULTIPLE_CORRECT','NUMERICAL','TRUE_FALSE'];
const COURSES = ['JEE','CET','NEET'];
const SUBJECTS = ['Physics','Chemistry','Mathematics','Biology','English','General Knowledge'];

class PaperGenerationError extends Error {
  constructor(message, code = 'INVALID_RULES', details = {}) {
    super(message);
    this.name = 'PaperGenerationError';
    this.code = code;
    this.details = details;
  }
}

function integer(value, label, { min = 0, max = 500 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new PaperGenerationError(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return number;
}

function parseGenerationRules(input = {}) {
  const course = String(input.course || '').trim().toUpperCase();
  const subject = String(input.subject || '').trim();
  if (!COURSES.includes(course) || !SUBJECTS.includes(subject)) {
    throw new PaperGenerationError('Choose a valid course and subject.');
  }
  const totalQuestions = integer(input.totalQuestions, 'Total questions', { min:1, max:500 });
  const difficultyCounts = {
    Easy:integer(input.easyCount ?? input.difficultyCounts?.Easy ?? 0, 'Easy count'),
    Medium:integer(input.mediumCount ?? input.difficultyCounts?.Medium ?? 0, 'Medium count'),
    Hard:integer(input.hardCount ?? input.difficultyCounts?.Hard ?? 0, 'Hard count'),
  };
  const distributionTotal = Object.values(difficultyCounts).reduce((sum, count) => sum + count, 0);
  if (distributionTotal !== totalQuestions) {
    throw new PaperGenerationError(`Difficulty counts total ${distributionTotal}, but total questions is ${totalQuestions}.`);
  }
  const totalMarks = Number(input.totalMarks);
  if (!Number.isFinite(totalMarks) || totalMarks <= 0 || totalMarks > 10000) {
    throw new PaperGenerationError('Total marks must be a number greater than zero and at most 10000.');
  }
  const questionTypes = cleanList(input.questionTypes).filter(type => QUESTION_TYPES.includes(type));
  const excludedQuestionIds = cleanList(input.excludedQuestionIds || input.excludedQuestions);
  if (excludedQuestionIds.some(id => !mongoose.isValidObjectId(id))) {
    throw new PaperGenerationError('Excluded questions must contain valid question IDs.');
  }
  return {
    course,
    subject,
    topics:cleanList(input.topics),
    subtopics:cleanList(input.subtopics),
    totalQuestions,
    totalMarks:Number(totalMarks.toFixed(2)),
    difficultyCounts,
    questionTypes:questionTypes.length ? questionTypes : [...QUESTION_TYPES],
    questionTags:cleanList(input.questionTags),
    excludedQuestionIds:[...new Set(excludedQuestionIds)],
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generationQuery(rules, organizationFilter = {}) {
  const clauses = [
    { isActive:true },
    organizationFilter,
    { course:rules.course },
    { subject:rules.subject },
    { questionType:{ $in:rules.questionTypes } },
  ];
  if (rules.topics.length) clauses.push({ topic:{ $in:rules.topics.map(value => new RegExp(`^${escapeRegex(value)}$`, 'i')) } });
  if (rules.subtopics.length) clauses.push({ subtopic:{ $in:rules.subtopics.map(value => new RegExp(`^${escapeRegex(value)}$`, 'i')) } });
  if (rules.questionTags.length) clauses.push({ tags:{ $all:rules.questionTags.map(value => new RegExp(`^${escapeRegex(value)}$`, 'i')) } });
  if (rules.excludedQuestionIds.length) clauses.push({ _id:{ $nin:rules.excludedQuestionIds } });
  return { $and:clauses };
}

function shuffled(values, random = Math.random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index],copy[swap]] = [copy[swap],copy[index]];
  }
  return copy;
}

function marksInCents(question) {
  return Math.round(Math.max(0, Number(question.marks) || 0) * 100);
}

function selectionsByTotal(pool, count, targetCents, random) {
  if (count === 0) return new Map([[0,[]]]);
  const maps = Array.from({ length:count + 1 }, () => new Map());
  maps[0].set(0, []);
  shuffled(pool, random).forEach(question => {
    const marks = marksInCents(question);
    for (let size = count; size >= 1; size -= 1) {
      for (const [sum, selection] of [...maps[size - 1].entries()]) {
        const next = sum + marks;
        if (next > targetCents || maps[size].has(next)) continue;
        maps[size].set(next, [...selection,question]);
      }
    }
  });
  return maps[count];
}

function selectQuestionsForBlueprint(candidates, rules, random = Math.random) {
  const inventory = Object.fromEntries(DIFFICULTIES.map(difficulty => [difficulty, candidates.filter(question => question.difficulty === difficulty).length]));
  const shortages = DIFFICULTIES.filter(difficulty => inventory[difficulty] < rules.difficultyCounts[difficulty]);
  if (shortages.length) {
    const summary = shortages.map(difficulty => `${difficulty}: need ${rules.difficultyCounts[difficulty]}, found ${inventory[difficulty]}`).join('; ');
    throw new PaperGenerationError(`Insufficient question-bank inventory (${summary}).`, 'INSUFFICIENT_INVENTORY', {
      requested:rules.difficultyCounts,
      available:inventory,
    });
  }

  const targetCents = Math.round(rules.totalMarks * 100);
  const possible = {};
  DIFFICULTIES.forEach(difficulty => {
    possible[difficulty] = selectionsByTotal(
      candidates.filter(question => question.difficulty === difficulty),
      rules.difficultyCounts[difficulty],
      targetCents,
      random
    );
  });

  for (const [easyMarks,easy] of possible.Easy.entries()) {
    for (const [mediumMarks,medium] of possible.Medium.entries()) {
      const hard = possible.Hard.get(targetCents - easyMarks - mediumMarks);
      if (hard) return shuffled([...easy,...medium,...hard], random);
    }
  }

  const ranges = {};
  DIFFICULTIES.forEach(difficulty => {
    const totals = [...possible[difficulty].keys()];
    ranges[difficulty] = totals.length
      ? { min:Math.min(...totals) / 100, max:Math.max(...totals) / 100 }
      : { min:null, max:null };
  });
  throw new PaperGenerationError(
    `The requested difficulty counts are available, but no exact ${rules.totalMarks}-mark combination exists.`,
    'MARKS_TARGET_UNAVAILABLE',
    { requestedMarks:rules.totalMarks, possibleMarksByDifficulty:ranges }
  );
}

function replacementCriteria(currentQuestion, rules, preserveTotalMarks = true) {
  return {
    difficulty:currentQuestion.difficulty,
    ...(preserveTotalMarks ? { marks:Number(currentQuestion.marks) || 0 } : {}),
    questionType:{ $in:rules.questionTypes },
  };
}

module.exports = {
  DIFFICULTIES,
  PaperGenerationError,
  generationQuery,
  marksInCents,
  parseGenerationRules,
  replacementCriteria,
  selectQuestionsForBlueprint,
};
