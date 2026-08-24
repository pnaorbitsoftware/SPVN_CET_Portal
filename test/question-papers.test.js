const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { QuestionPaper } = require('../models');
const { paperInputFromBody, questionPaperSummary } = require('../services/questionPaperService');
const { _private } = require('../controllers/questionPaperController');

function question(overrides = {}) {
  return {
    _id:new mongoose.Types.ObjectId(),
    marks:1,
    subject:'Physics',
    topic:'Motion',
    subtopic:'Velocity',
    difficulty:'Medium',
    questionType:'SINGLE_CORRECT',
    ...overrides,
  };
}

test('question paper schema normalizes tags and question IDs without losing order', async () => {
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  const paper = new QuestionPaper({
    title:'Physics Practice', code:'physics practice', createdBy:new mongoose.Types.ObjectId(),
    tags:['PYQ',' PYQ ','Revision'],
    questionIds:[first,second,first],
  });
  paper.code = 'PHYSICS_PRACTICE';
  await paper.validate();
  assert.deepEqual([...paper.tags], ['PYQ','Revision']);
  assert.deepEqual(paper.questionIds.map(String), [String(first),String(second)]);
  assert.equal(paper.totalQuestions, 2);
  assert.equal(paper.status, 'draft');
});

test('question paper indexes never combine parallel subject and tag arrays', () => {
  const indexes = QuestionPaper.schema.indexes().map(([fields]) => fields);
  assert.equal(indexes.some(fields => fields.subjects && fields.tags), false);
  assert.equal(indexes.some(fields => fields.organization && fields.subjects), true);
  assert.equal(indexes.some(fields => fields.organization && fields.tags), true);
});

test('question paper summary derives real marks, hierarchy and distributions', () => {
  const summary = questionPaperSummary([
    question({ marks:2, difficulty:'Easy' }),
    question({ marks:3, subject:'Chemistry', topic:'Atoms', subtopic:null, difficulty:'Hard', questionType:'NUMERICAL' }),
  ]);
  assert.equal(summary.totalQuestions, 2);
  assert.equal(summary.totalMarks, 5);
  assert.deepEqual(summary.difficultyDistribution, { Easy:1, Medium:0, Hard:1 });
  assert.deepEqual(summary.questionTypeDistribution, { SINGLE_CORRECT:1, NUMERICAL:1 });
  assert.deepEqual(summary.subjects, ['Physics','Chemistry']);
  assert.deepEqual(summary.topics, ['Motion','Atoms']);
});

test('paper input validates required fields and honors explicit reusable metadata', () => {
  const questions = [question()];
  const input = paperInputFromBody({
    title:' CET Paper ', code:'cet paper 1', course:'cet', subjects:['Physics'],
    tags:'CET-2026, PYQ, CET-2026', status:'ready',
  }, questions);
  assert.equal(input.title, 'CET Paper');
  assert.equal(input.code, 'CET_PAPER_1');
  assert.equal(input.course, 'CET');
  assert.deepEqual(input.subjects, ['Physics']);
  assert.deepEqual(input.tags, ['CET-2026','PYQ']);
  assert.equal(input.status, 'ready');
  assert.throws(() => paperInputFromBody({ title:'Empty' }, []), /at least one question/i);
});

test('paper helpers deduplicate submitted IDs and combine organization and text filters safely', () => {
  assert.deepEqual(_private.selectedIds({ questionIds:['a','b','a'] }), ['a','b']);
  assert.equal(_private.baseCode('CET 2026 — Physics'), 'CET_2026_PHYSICS');
  const organizationId = new mongoose.Types.ObjectId();
  const query = _private.questionSearchFilter({
    query:{ subject:'Physics', search:'force (N)', questionType:'SINGLE_CORRECT' },
    organization:{ _id:organizationId, isDefault:false },
  });
  assert.ok(Array.isArray(query.$and));
  assert.ok(query.$and.some(clause => String(clause.organization) === String(organizationId)));
  assert.ok(query.$and.some(clause => clause.$or));
});
