const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreQuestion, scoreTest } = require('../services/scoringService');
const { buildQuestionConfigs, totalMarksFromConfigs } = require('../services/testConfigurationService');

function question(id, overrides = {}) {
  return {
    _id:id,
    questionType:'SINGLE_CORRECT',
    correctAnswer:'A',
    correctAnswers:['A'],
    marks:1,
    subject:'Physics',
    topic:'General',
    ...overrides,
  };
}

test('legacy single-correct scoring remains compatible and floors an overall negative score', () => {
  const questions = [question('q1'), question('q2'), question('q3')];
  const scored = scoreTest({
    test:{ negativeMarking:0.25, marksPerQuestion:1 },
    questions,
    answers:{ q1:{ answer:'A' }, q2:{ answer:'B' } },
  });
  assert.equal(scored.score, 0.75);
  assert.equal(scored.correct, 1);
  assert.equal(scored.incorrect, 1);
  assert.equal(scored.skipped, 1);

  const negative = scoreTest({
    test:{ negativeMarking:2 },
    questions:[question('q1')],
    answers:{ q1:{ answer:'B' } },
  });
  assert.equal(negative.rawScore, -2);
  assert.equal(negative.score, 0);
});

test('multiple-correct scoring supports exact, subset and incorrect-selection policies', () => {
  const multiple = question('multi', {
    questionType:'MULTIPLE_CORRECT',
    correctAnswer:null,
    correctAnswers:['A','C'],
    marks:4,
  });
  assert.equal(scoreQuestion(multiple, ['C','A'], { positiveMarks:4, negativeMarks:1 }).awarded, 4);

  const partial = scoreQuestion(multiple, ['A'], {
    positiveMarks:4,
    negativeMarks:1,
    partialMarks:2,
    markingMode:'PARTIAL_SUBSET',
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.awarded, 2);

  const proportional = scoreQuestion(multiple, ['A'], {
    positiveMarks:4,
    negativeMarks:1,
    markingMode:'PER_CORRECT_OPTION',
  });
  assert.equal(proportional.awarded, 2);

  const wrongSelection = scoreQuestion(multiple, ['A','B'], {
    positiveMarks:4,
    negativeMarks:1,
    markingMode:'PARTIAL_SUBSET',
    incorrectSelectionPolicy:'ZERO',
  });
  assert.equal(wrongSelection.status, 'incorrect');
  assert.equal(wrongSelection.awarded, 0);
});

test('numerical scoring handles tolerance and inclusive ranges', () => {
  const exact = question('numeric', {
    questionType:'NUMERICAL',
    correctAnswer:null,
    correctAnswers:[],
    numericalAnswer:{ value:10, tolerance:0.2 },
  });
  assert.equal(scoreQuestion(exact, '10.19', { positiveMarks:2 }).status, 'correct');
  assert.equal(scoreQuestion(exact, 10.21, { positiveMarks:2, negativeMarks:0.5 }).awarded, -0.5);

  const ranged = { ...exact, numericalAnswer:{ min:2.5, max:3.5 } };
  assert.equal(scoreQuestion(ranged, 2.5, { positiveMarks:2 }).status, 'correct');
  assert.equal(scoreQuestion(ranged, 3.5, { positiveMarks:2 }).status, 'correct');
});

test('bonus questions award configured marks regardless of the submitted answer', () => {
  const scored = scoreQuestion(question('bonus'), null, {
    positiveMarks:1,
    bonus:true,
    bonusMarks:3,
    bonusReason:'Ambiguous answer key',
  });
  assert.equal(scored.status, 'bonus');
  assert.equal(scored.awarded, 3);
});

test('CET section totals exclude genuinely absent subjects while retaining full maximum', () => {
  const questions = [
    question('p', { subject:'Physics', marks:2 }),
    question('c', { subject:'Chemistry', marks:2 }),
    question('m', { subject:'Mathematics', marks:4 }),
  ];
  const scored = scoreTest({
    test:{ course:['CET'], negativeMarking:0 },
    questions,
    answers:{ p:{ answer:'A' } },
  });
  assert.deepEqual(scored.attemptedSubjects, ['Physics']);
  assert.deepEqual(scored.absentSubjects, ['Chemistry','Mathematics']);
  assert.equal(scored.maxScore, 2);
  assert.equal(scored.fullMaxScore, 8);
});

test('question configuration builder preserves order, accepts explicit bonus clearing and totals marks', () => {
  const questions = [question('q1', { marks:2 }), question('q2', { marks:3 })];
  const existing = {
    questionConfigs:[{ questionId:'q1', positiveMarks:5, negativeMarks:1, bonus:true, bonusMarks:6 }],
  };
  const configs = buildQuestionConfigs(questions, {
    questionConfigs:{
      q1:{ positiveMarks:'2', negativeMarks:'0.5', bonus:'false' },
      q2:{ positiveMarks:'4', bonus:'true', bonusMarks:'7' },
    },
  }, { negativeMarking:0.25 }, existing);
  assert.equal(configs[0].bonus, false);
  assert.equal(configs[0].displayOrder, 0);
  assert.equal(configs[1].bonus, true);
  assert.equal(configs[1].displayOrder, 1);
  assert.equal(totalMarksFromConfigs(configs), 9);
});

test('question configuration builder accepts flat multipart field names from web forms', () => {
  const configs = buildQuestionConfigs([question('multi', {
    questionType:'MULTIPLE_CORRECT',
    correctAnswers:['A','B'],
    marks:4,
  })], {
    'questionConfigs[multi][positiveMarks]':'4',
    'questionConfigs[multi][negativeMarks]':'1',
    'questionConfigs[multi][partialMarks]':'2',
    'questionConfigs[multi][markingMode]':'PARTIAL_SUBSET',
    'questionConfigs[multi][incorrectSelectionPolicy]':'ZERO',
  });
  assert.equal(configs[0].positiveMarks, 4);
  assert.equal(configs[0].negativeMarks, 1);
  assert.equal(configs[0].partialMarks, 2);
  assert.equal(configs[0].markingMode, 'PARTIAL_SUBSET');
  assert.equal(configs[0].incorrectSelectionPolicy, 'ZERO');
});
