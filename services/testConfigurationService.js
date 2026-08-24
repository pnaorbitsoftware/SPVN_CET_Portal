function finiteOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function configsByQuestionId(test) {
  return new Map((test?.questionConfigs || []).map(config => [
    String(config.questionId?._id || config.questionId),
    typeof config.toObject === 'function' ? config.toObject() : config,
  ]));
}

function effectiveQuestionConfig(test, question, suppliedConfig = null) {
  const config = suppliedConfig || configsByQuestionId(test).get(String(question._id || question.id)) || {};
  const positiveMarks = Math.max(0, finiteOr(config.positiveMarks, finiteOr(question.marks, finiteOr(test?.marksPerQuestion, 1))));
  const negativeMarks = Math.max(0, finiteOr(config.negativeMarks, finiteOr(test?.negativeMarking, 0)));
  const partialMarks = Math.min(positiveMarks, Math.max(0, finiteOr(config.partialMarks, 0)));
  const bonusMarks = Math.max(0, finiteOr(config.bonusMarks, positiveMarks));
  return {
    questionId:String(question._id || question.id),
    positiveMarks,
    negativeMarks,
    partialMarks,
    bonus:Boolean(config.bonus),
    bonusMarks,
    bonusReason:String(config.bonusReason || '').trim() || null,
    markingMode:['FULL_OR_ZERO','PARTIAL_SUBSET','PER_CORRECT_OPTION'].includes(config.markingMode)
      ? config.markingMode
      : partialMarks > 0 ? 'PARTIAL_SUBSET' : 'FULL_OR_ZERO',
    incorrectSelectionPolicy:config.incorrectSelectionPolicy === 'ZERO' ? 'ZERO' : 'NEGATIVE',
    displayOrder:Math.max(0, finiteOr(config.displayOrder, 0)),
    section:String(config.section || question.subject || '').trim() || null,
  };
}

function bodyConfig(body, questionId) {
  const configs = body?.questionConfigs || {};
  return configs[questionId] || configs[String(questionId)] || {};
}

function buildQuestionConfigs(questions, body = {}, testDefaults = {}, existingTest = null) {
  const existing = configsByQuestionId(existingTest);
  return questions.map((question, index) => {
    const questionId = String(question._id || question.id);
    const current = existing.get(questionId) || {};
    const submitted = bodyConfig(body, questionId);
    const merged = {
      ...current,
      ...submitted,
      questionId,
      positiveMarks:finiteOr(submitted.positiveMarks, finiteOr(current.positiveMarks, finiteOr(question.marks, 1))),
      negativeMarks:finiteOr(submitted.negativeMarks, finiteOr(current.negativeMarks, finiteOr(testDefaults.negativeMarking, 0))),
      partialMarks:finiteOr(submitted.partialMarks, finiteOr(current.partialMarks, 0)),
      bonus:Object.prototype.hasOwnProperty.call(submitted, 'bonus')
        ? ['on','true',true,'1',1].includes(submitted.bonus)
        : Boolean(current.bonus),
      bonusMarks:finiteOr(submitted.bonusMarks, finiteOr(current.bonusMarks, null)),
      bonusReason:submitted.bonusReason ?? current.bonusReason ?? null,
      markingMode:submitted.markingMode || current.markingMode,
      incorrectSelectionPolicy:submitted.incorrectSelectionPolicy || current.incorrectSelectionPolicy,
      displayOrder:index,
      section:submitted.section || current.section || question.subject || null,
    };
    return effectiveQuestionConfig(testDefaults, question, merged);
  });
}

function totalMarksFromConfigs(configs = []) {
  return Number(configs.reduce((total, config) => total + (config.bonus ? config.bonusMarks : config.positiveMarks), 0).toFixed(2));
}

module.exports = {
  buildQuestionConfigs,
  configsByQuestionId,
  effectiveQuestionConfig,
  totalMarksFromConfigs,
};
