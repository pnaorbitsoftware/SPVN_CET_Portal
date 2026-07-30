const CET_SECTION_ORDER = ['Physics', 'Chemistry', 'Mathematics'];

function values(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function subjectOf(question) {
  return String(question?.subject || 'General');
}

function isCetSectionTest(test, questions = []) {
  const courses = values(test?.course).map(course => String(course).toUpperCase());
  if (!courses.includes('CET')) return false;

  const subjects = new Set(questions.map(subjectOf));
  return CET_SECTION_ORDER.every(subject => subjects.has(subject));
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function orderedSectionNames(questions) {
  const available = [...new Set(questions.map(subjectOf))];
  return [
    ...CET_SECTION_ORDER.filter(subject => available.includes(subject)),
    ...available.filter(subject => !CET_SECTION_ORDER.includes(subject)),
  ];
}

function buildQuestionOrder(test, questions = []) {
  if (!isCetSectionTest(test, questions)) {
    const questionIds = questions.map(question => question._id.toString());
    return test?.shuffleQuestions ? shuffle(questionIds) : questionIds;
  }

  return orderedSectionNames(questions).flatMap(subject => {
    const sectionIds = questions
      .filter(question => subjectOf(question) === subject)
      .map(question => question._id.toString());
    return test?.shuffleQuestions ? shuffle(sectionIds) : sectionIds;
  });
}

function buildSectionState(questionOrder = [], questions = [], answers = {}) {
  const subjectById = new Map(
    questions.map(question => [question._id.toString(), subjectOf(question)])
  );
  const sectionNames = [];
  const sectionMap = new Map();

  questionOrder.forEach((questionId, questionIndex) => {
    const id = questionId.toString();
    const subject = subjectById.get(id) || 'General';
    if (!sectionMap.has(subject)) {
      sectionNames.push(subject);
      sectionMap.set(subject, {
        name: subject,
        questionIds: [],
        questionNumbers: [],
      });
    }
    const section = sectionMap.get(subject);
    section.questionIds.push(id);
    section.questionNumbers.push(questionIndex + 1);
  });

  const sections = sectionNames.map(name => sectionMap.get(name));
  let unlockedSectionIndex = 0;
  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex++) {
    const completed = sections[sectionIndex].questionIds.every(questionId =>
      Object.prototype.hasOwnProperty.call(answers, questionId)
    );
    if (!completed) break;
    unlockedSectionIndex = sectionIndex + 1;
  }

  sections.forEach((section, sectionIndex) => {
    section.completed = section.questionIds.every(questionId =>
      Object.prototype.hasOwnProperty.call(answers, questionId)
    );
    section.locked = sectionIndex > unlockedSectionIndex;
    section.index = sectionIndex;
  });

  const unlockedSection = sections[unlockedSectionIndex] || null;
  const firstPendingQuestionNumber = unlockedSection
    ? unlockedSection.questionIds.reduce((pendingNumber, questionId, questionIndex) => {
        if (pendingNumber) return pendingNumber;
        return Object.prototype.hasOwnProperty.call(answers, questionId)
          ? null
          : unlockedSection.questionNumbers[questionIndex];
      }, null) || unlockedSection.questionNumbers[0]
    : 1;

  return {
    sections,
    unlockedSectionIndex,
    firstPendingQuestionNumber,
    subjectById,
  };
}

module.exports = {
  CET_SECTION_ORDER,
  buildQuestionOrder,
  buildSectionState,
  isCetSectionTest,
  orderedSectionNames,
};
