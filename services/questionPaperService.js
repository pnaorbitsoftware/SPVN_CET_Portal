const { cleanList } = require('./questionService');

function normalizeTags(value) {
  return cleanList(value).map(tag => tag.slice(0, 60)).slice(0, 30);
}

function questionPaperSummary(questions = []) {
  const difficultyDistribution = { Easy:0, Medium:0, Hard:0 };
  const questionTypeDistribution = {};
  const topics = new Set();
  const subtopics = new Set();
  const subjects = new Set();
  let totalMarks = 0;
  questions.forEach(question => {
    const difficulty = ['Easy','Medium','Hard'].includes(question.difficulty) ? question.difficulty : 'Medium';
    const type = question.questionType || 'SINGLE_CORRECT';
    difficultyDistribution[difficulty] += 1;
    questionTypeDistribution[type] = (questionTypeDistribution[type] || 0) + 1;
    if (question.subject) subjects.add(String(question.subject).trim());
    if (question.topic) topics.add(String(question.topic).trim());
    if (question.subtopic) subtopics.add(String(question.subtopic).trim());
    totalMarks += Math.max(0, Number(question.marks) || 0);
  });
  return {
    totalQuestions:questions.length,
    totalMarks:Number(totalMarks.toFixed(2)),
    difficultyDistribution,
    questionTypeDistribution,
    subjects:[...subjects],
    topics:[...topics],
    subtopics:[...subtopics],
  };
}

function paperInputFromBody(body = {}, questions = []) {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('Question paper title is required.');
  if (!questions.length) throw new Error('Select at least one question.');
  const summary = questionPaperSummary(questions);
  const requestedSubjects = cleanList(body.subjects || body.subject);
  return {
    ...summary,
    title,
    code:String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60),
    description:String(body.description || '').trim().slice(0, 2000) || null,
    course:String(body.course || '').trim().toUpperCase() || null,
    subjects:requestedSubjects.length ? requestedSubjects : summary.subjects,
    tags:normalizeTags(body.tags),
    questionIds:questions.map(question => question._id || question.id),
    status:['draft','ready','archived'].includes(body.status) ? body.status : 'draft',
  };
}

module.exports = { normalizeTags, paperInputFromBody, questionPaperSummary };
