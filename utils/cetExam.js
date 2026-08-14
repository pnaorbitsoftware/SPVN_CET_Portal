const CET_SECTION_ORDER = ['Physics', 'Chemistry', 'Mathematics', 'Biology'];
const CET_PREREQUISITE_SUBJECTS = ['Physics', 'Chemistry'];

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
  return CET_PREREQUISITE_SUBJECTS.every(subject => subjects.has(subject))
    && (subjects.has('Mathematics') || subjects.has('Biology'));
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
  const hasAttemptedSubject = subject => {
    const section = sectionMap.get(subject);
    return section?.questionIds.some(questionId => Boolean(answers[questionId]?.answer));
  };
  const prerequisiteSubjectsAttempted = CET_PREREQUISITE_SUBJECTS.every(hasAttemptedSubject);

  sections.forEach((section, sectionIndex) => {
    section.completed = section.questionIds.every(questionId =>
      Object.prototype.hasOwnProperty.call(answers, questionId)
    );
    section.locked = !CET_PREREQUISITE_SUBJECTS.includes(section.name)
      && !prerequisiteSubjectsAttempted;
    section.index = sectionIndex;
  });

  const firstUnlockedSection = sections.find(section => !section.locked) || null;
  const firstPendingQuestionNumber = firstUnlockedSection
    ? firstUnlockedSection.questionIds.reduce((pendingNumber, questionId, questionIndex) => {
        if (pendingNumber) return pendingNumber;
        return answers[questionId]?.answer
          ? null
          : firstUnlockedSection.questionNumbers[questionIndex];
      }, null) || firstUnlockedSection.questionNumbers[0]
    : 1;

  return {
    sections,
    prerequisiteSubjectsAttempted,
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
