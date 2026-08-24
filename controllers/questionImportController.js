const {
  Group,
  GroupMember,
  Notification,
  Question,
  QuestionImport,
  Test,
} = require('../models');
const { mongoose } = require('../config/database');
const {
  SUPPORTED_EXTENSIONS,
  extensionOf,
  extractQuestionFiles,
  normalizeQuestion,
  preserveQuestionVisuals,
  removeQuestionImportAssets,
} = require('../utils/questionImporter');
const { parseLocalDateTime, formatDateTimeLocal } = require('../utils/dateTime');
const { organizationIdForWrite } = require('../services/organizationService');
const { questionInputFromBody } = require('../services/questionService');
const { buildQuestionConfigs, totalMarksFromConfigs } = require('../services/testConfigurationService');
const { TIMING_MODES, timingInput, timingLabel } = require('../services/timingService');
const { accessConfiguration } = require('../services/testAccessService');

const COURSES = ['JEE','CET','NEET'];
const SUBJECTS = require('../config/subjects.json');
const MAX_FILES = 10;
const MAX_TOTAL_SIZE = 40 * 1024 * 1024;

function uploadedFiles(req) {
  const input = req.files?.questionFiles;
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

function defaultsFrom(body) {
  return {
    subject: String(body.subject || 'Physics').trim(),
    topic: String(body.topic || '').trim(),
    subtopic: String(body.subtopic || '').trim(),
    difficulty: ['Easy','Medium','Hard'].includes(body.difficulty) ? body.difficulty : 'Medium',
    marks: Math.max(0.25, Number(body.marks) || 1),
  };
}

function sourceFiles(files) {
  return files.map(file => ({
    name: String(file.name || 'upload'),
    mimeType: String(file.mimetype || 'application/octet-stream'),
    size: Number(file.size) || file.data?.length || 0,
  }));
}

function ownImportQuery(req, id) {
  return { _id: id, createdBy: req.session.user.id };
}

function formQuestionRows(body) {
  const questions = body.questions || [];
  if (Array.isArray(questions)) return questions;
  return Object.keys(questions)
    .sort((left, right) => Number(left) - Number(right))
    .map(key => questions[key]);
}

function selectedValues(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function testDefaultsFrom(body) {
  if (body.fromCreateTest !== '1') return {};
  return {
    title: String(body.testTitle || '').trim(),
    description: String(body.testDescription || '').trim(),
    timingMode: TIMING_MODES.includes(body.testTimingMode) ? body.testTimingMode : 'PERSONAL_DURATION',
    duration: Math.max(5, Number.parseInt(body.testDuration, 10) || 180),
    negativeMarking: Math.max(0, Number(body.testNegativeMarking) || 0),
    startTime: parseLocalDateTime(body.testStartTime),
    endTime: parseLocalDateTime(body.testEndTime),
    instructions: String(body.testInstructions || '').trim(),
    courses: selectedValues(body.testCourses).filter(course => COURSES.includes(course)),
    groupIds: selectedValues(body.testGroupIds),
  };
}

exports.getSmartImport = async (req, res) => {
  res.render('admin/smart-import', {
    title: 'Smart Question Scan',
    SUBJECTS,
    aiEnabled: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY),
    maxFiles: MAX_FILES,
    maxTotalSizeMb: Math.floor(MAX_TOTAL_SIZE / 1024 / 1024),
  });
};

exports.scanQuestionFiles = async (req, res) => {
  const files = uploadedFiles(req);
  let importDraft;
  try {
    if (!files.length) throw new Error('Choose at least one file.');
    if (files.length > MAX_FILES) throw new Error(`Upload a maximum of ${MAX_FILES} files at once.`);

    const unsupported = files.filter(file => !SUPPORTED_EXTENSIONS.has(extensionOf(file)));
    if (unsupported.length) {
      throw new Error(`Unsupported file type: ${unsupported.map(file => file.name).join(', ')}`);
    }

    const totalSize = files.reduce((sum, file) => sum + (Number(file.size) || file.data?.length || 0), 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      throw new Error(`Combined upload size must be below ${Math.floor(MAX_TOTAL_SIZE / 1024 / 1024)} MB.`);
    }

    const defaults = defaultsFrom(req.body);
    importDraft = await QuestionImport.create({
      createdBy: req.session.user.id,
      sourceFiles: sourceFiles(files),
      defaults,
      testDefaults: testDefaultsFrom(req.body),
      status: 'scanning',
    });

    const result = await extractQuestionFiles(files, defaults, req.session.user.id);
    if (!result.questions.length) {
      throw new Error('No MCQ questions were detected. Check file quality and ensure every question has A/B/C/D options.');
    }

    const visualResult = await preserveQuestionVisuals(files, result.questions, importDraft._id);
    importDraft.questions = visualResult.questions.map(question => ({ ...question, isSelected: true }));
    importDraft.warnings = [...new Set([...result.warnings, ...visualResult.warnings])];
    importDraft.extractionMethod = result.method;
    importDraft.extractionModel = result.model;
    importDraft.status = 'review';
    importDraft.error = null;
    await importDraft.save();

    req.flash('success', `${result.questions.length} question(s) scanned. Review them before saving.`);
    res.redirect(`/admin/questions/smart-import/${importDraft._id}/review`);
  } catch (error) {
    console.error('Smart import scan failed:', error);
    if (importDraft) {
      importDraft.status = 'failed';
      importDraft.error = error.message;
      await importDraft.save().catch(() => {});
    }
    req.flash('error', `Scan failed: ${error.message}`);
    res.redirect('/admin/questions/smart-import');
  }
};

exports.getSmartImportReview = async (req, res) => {
  try {
    const [importDraft, groups] = await Promise.all([
      QuestionImport.findOne(ownImportQuery(req, req.params.id)),
      Group.find({ isActive: true }).sort({ name: 1 }),
    ]);
    if (!importDraft || importDraft.status !== 'review') {
      req.flash('error', 'This import draft is not available for review.');
      return res.redirect('/admin/questions/smart-import');
    }
    res.render('admin/smart-import-review', {
      title: 'Review Scanned Questions',
      importDraft,
      groups,
      COURSES,
      SUBJECTS,
      formatDateTimeLocal,
      TIMING_MODES,
    });
  } catch (error) {
    req.flash('error', `Unable to open review: ${error.message}`);
    res.redirect('/admin/questions/smart-import');
  }
};

exports.commitSmartImport = async (req, res) => {
  const importDraft = await QuestionImport.findOne(ownImportQuery(req, req.params.id));
  if (!importDraft || importDraft.status !== 'review') {
    req.flash('error', 'This import draft is not available.');
    return res.redirect('/admin/questions/smart-import');
  }

  try {
    const rows = formQuestionRows(req.body);
    if (rows.length !== importDraft.questions.length) {
      throw new Error('Question list changed unexpectedly. Reload the review page and try again.');
    }

    const editedQuestions = rows.map((row, index) => {
      const original = importDraft.questions[index];
      const normalized = normalizeQuestion({
        ...row,
        questionImage: row.questionImage || original.questionImage,
        questionImageSource: original.questionImageSource,
        questionImageBox: original.questionImageBox,
        sourceDocument: null,
        sourcePage: null,
        confidence: original.confidence,
        sourceLabel: original.sourceLabel,
        answerSource: original.answerSource,
      }, importDraft.defaults);
      return {
        ...normalized,
        isSelected: row.selected === '1' || row.selected === 'on',
      };
    });

    importDraft.questions = editedQuestions;
    await importDraft.save();

    const selectedQuestions = editedQuestions.filter(question => question.isSelected);
    if (!selectedQuestions.length) throw new Error('Select at least one question.');

    const preparedQuestions = selectedQuestions.map((question, index) => {
      try {
        const validated = questionInputFromBody({
          ...question,
          numericalValue:question.numericalAnswer?.value,
          numericalMin:question.numericalAnswer?.min,
          numericalMax:question.numericalAnswer?.max,
          numericalTolerance:question.numericalAnswer?.tolerance,
        }, importDraft.defaults);
        return { ...question, ...validated };
      } catch (error) {
        throw new Error(`Question ${index + 1}: ${error.message}`);
      }
    });

    const importAction = req.body.importAction;
    if (!['save_questions', 'publish_test'].includes(importAction)) {
      throw new Error('Choose Save to Question Bank or Save & Publish Test.');
    }
    const createTest = importAction === 'publish_test';
    const publishNow = createTest;
    const groupIds = selectedValues(req.body.groupIds);
    if (publishNow && !groupIds.length) {
      throw new Error('Select at least one batch before publishing to student dashboards.');
    }
    if (createTest && !String(req.body.testTitle || '').trim()) {
      throw new Error('Test title is required.');
    }

    const timing = createTest ? timingInput({
      timingMode:req.body.timingMode,
      duration:req.body.duration,
      startTime:parseLocalDateTime(req.body.startTime),
      endTime:parseLocalDateTime(req.body.endTime),
    }) : null;
    const access = createTest ? await accessConfiguration({ enabled:req.body.testAccessEnabled, password:req.body.testAccessPassword }) : null;

    let createdTest = null;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const questionDocuments = preparedQuestions.map(question => ({
          organization: organizationIdForWrite(req),
          question: question.question,
          questionImage: question.questionImage || null,
          optionA: question.optionA,
          optionB: question.optionB,
          optionC: question.optionC,
          optionD: question.optionD,
          questionType: question.questionType,
          questionSubType: question.questionSubType,
          correctAnswer: question.correctAnswer,
          correctAnswers: question.correctAnswers,
          numericalAnswer: question.numericalAnswer,
          tags: question.tags,
          subject: question.subject,
          topic: question.topic || null,
          subtopic: question.subtopic || null,
          difficulty: question.difficulty,
          marks: question.marks,
          explanation: question.explanation || null,
          createdBy: req.session.user.id,
          isActive: true,
        }));
        const createdQuestions = await Question.insertMany(questionDocuments, { session });

        if (createTest) {
          const negativeMarking = Math.max(0, Number(req.body.negativeMarking) || 0);
          const questionConfigs = buildQuestionConfigs(createdQuestions, req.body, { negativeMarking });
          const totalMarks = totalMarksFromConfigs(questionConfigs);
          const subjectList = [...new Set(createdQuestions.map(question => question.subject))];
          const courses = selectedValues(req.body.courses).filter(course => COURSES.includes(course));
          const validGroups = await Group.find({ _id: { $in: groupIds }, isActive: true }, '_id').session(session);
          if (validGroups.length !== groupIds.length) throw new Error('One or more selected batches are invalid.');

          const tests = await Test.create([{
            organization:organizationIdForWrite(req),
            title: String(req.body.testTitle).trim(),
            description: String(req.body.testDescription || '').trim() || null,
            duration: timing.duration,
            timingMode:timing.timingMode,
            totalMarks,
            negativeMarking,
            passingMarks: req.body.passingMarks ? Math.max(0, Number(req.body.passingMarks)) : null,
            shuffleQuestions: req.body.shuffleQuestions === 'on',
            shuffleOptions: req.body.shuffleOptions === 'on',
            status: publishNow ? 'published' : 'draft',
            startTime:timing.startTime,
            endTime:timing.endTime,
            createdBy: req.session.user.id,
            instructions: String(req.body.instructions || '').trim() || null,
            course: courses,
            subject: subjectList,
            marksPerQuestion: preparedQuestions[0]?.marks || 1,
            questions: createdQuestions.map(question => question._id),
            questionConfigs,
            groups: validGroups.map(group => group._id),
            blockCopyPaste: true,
            ...access,
          }], { session });
          createdTest = tests[0];

          if (publishNow) {
            const memberships = await GroupMember.find({
              groupId: { $in: validGroups.map(group => group._id) },
              role: 'student',
            }, 'userId').session(session);
            const userIds = [...new Set(memberships.map(member => member.userId.toString()))];
            if (userIds.length) {
              await Notification.insertMany(userIds.map(userId => ({
                userId,
                title: 'New Exam Published',
                message: `"${createdTest.title}" is now available. Timing: ${timingLabel(createdTest)}.`,
                type: 'exam',
                link: '/student/tests',
              })), { session });
            }
          }
        }

        importDraft.status = 'imported';
        importDraft.importedQuestionIds = createdQuestions.map(question => question._id);
        importDraft.testId = createdTest?._id || null;
        await importDraft.save({ session });
      });
    } finally {
      await session.endSession();
    }

    const message = createdTest
      ? `${selectedQuestions.length} questions saved and test published to students.`
      : `${selectedQuestions.length} questions saved to Question Bank.`;
    req.flash('success', message);
    res.redirect(createdTest ? `/admin/tests/${createdTest._id}` : '/admin/questions');
  } catch (error) {
    console.error('Smart import commit failed:', error);
    req.flash('error', `Could not save import: ${error.message}`);
    res.redirect(`/admin/questions/smart-import/${importDraft._id}/review`);
  }
};

exports.discardSmartImport = async (req, res) => {
  try {
    const discarded = await QuestionImport.findOneAndDelete({
      ...ownImportQuery(req, req.params.id),
      status: { $in: ['review','failed'] },
    });
    if (discarded) removeQuestionImportAssets(discarded._id);
    req.flash('success', 'Import draft discarded.');
  } catch (error) {
    req.flash('error', `Could not discard import: ${error.message}`);
  }
  res.redirect('/admin/questions/smart-import');
};
