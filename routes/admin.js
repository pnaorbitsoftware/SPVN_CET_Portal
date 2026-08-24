const express        = require('express');
const router         = express.Router();
const c              = require('../controllers/adminController');
const questionImport = require('../controllers/questionImportController');
const organization    = require('../controllers/organizationController');
const questionPapers  = require('../controllers/questionPaperController');
const autoPapers      = require('../controllers/autoPaperController');
const examConfig      = require('../controllers/examConfigurationController');
const { isAuthenticated, requireRole, requirePasswordChange } = require('../middleware/auth');

const guard = [isAuthenticated, requirePasswordChange, requireRole('admin')];

router.get('/dashboard', ...guard, c.getDashboard);

// Organization management and defaults
router.get('/organizations',                 ...guard, organization.getOrganizations);
router.post('/organizations',                ...guard, organization.createOrganization);
router.post('/organizations/:id',            ...guard, organization.updateOrganization);
router.post('/organizations/:id/status',     ...guard, organization.updateOrganizationStatus);

// Reusable test patterns and ranking schemas
router.get('/exam-configurations',                         ...guard, examConfig.getConfigurations);
router.post('/exam-configurations/patterns',               ...guard, examConfig.savePattern);
router.post('/exam-configurations/patterns/:id',           ...guard, examConfig.savePattern);
router.post('/exam-configurations/patterns/:id/toggle',    ...guard, examConfig.togglePattern);
router.post('/exam-configurations/rankings',               ...guard, examConfig.saveRanking);
router.post('/exam-configurations/rankings/:id',           ...guard, examConfig.saveRanking);
router.post('/exam-configurations/rankings/:id/toggle',    ...guard, examConfig.toggleRanking);

// Students
router.get('/students',              ...guard, c.getStudents);
router.post('/students',             ...guard, c.createStudent);
router.post('/students/bulk-import', ...guard, c.bulkImportStudents);
router.get('/students/:id/view',     ...guard, c.viewStudentProfile);
router.post('/students/:id/delete',  ...guard, c.deleteStudent);

// Batches / Groups
router.get('/groups',                          ...guard, c.getGroups);
router.post('/groups',                         ...guard, c.createGroup);
router.get('/groups/template/download',        ...guard, c.downloadStudentTemplate);
router.post('/groups/assign-member',           ...guard, c.assignMember);
router.get('/groups/:id',                      ...guard, c.getGroupDetail);
router.post('/groups/:id',                     ...guard, c.updateGroup);
router.post('/groups/:id/delete',              ...guard, c.deleteGroup);
router.get('/groups/:id/credentials-pdf',      ...guard, c.exportGroupCredentials);
router.post('/groups/:id/bulk-import',         ...guard, c.bulkImportStudents);
router.post('/groups/:id/add-student',         ...guard, c.createStudent);
router.post('/groups/:id/students/:studentId/remove', ...guard, c.removeStudentFromGroup);
router.post('/groups/:id/students/:studentId/move',   ...guard, c.moveStudentToGroup);

// Content hierarchy
router.get('/topics',        ...guard, c.getTopics);
router.post('/topics',       ...guard, c.createTopic);
router.post('/topics/import-pdf', ...guard, c.importSyllabusPdf);
router.post('/topics/:id',   ...guard, c.updateTopic);
router.post('/topics/:id/delete', ...guard, c.deleteTopic);

// AJAX helpers
router.get('/ajax/subjects/:course', ...guard, c.getSubjectsForCourse);
router.get('/ajax/topics',           ...guard, c.getTopicsForSubject);
router.get('/ajax/subtopics',        ...guard, c.getSubtopicsForTopic);

// Questions
router.get('/questions/smart-import',                    ...guard, questionImport.getSmartImport);
router.post('/questions/smart-import/scan',              ...guard, questionImport.scanQuestionFiles);
router.get('/questions/smart-import/:id/review',         ...guard, questionImport.getSmartImportReview);
router.post('/questions/smart-import/:id/commit',        ...guard, questionImport.commitSmartImport);
router.post('/questions/smart-import/:id/discard',       ...guard, questionImport.discardSmartImport);
router.get('/questions',                       ...guard, c.getQuestions);
router.post('/questions',                      ...guard, c.createQuestion);
router.post('/questions/bulk-import',          ...guard, c.bulkImportQuestions);
router.get('/questions/template/download',     ...guard, c.downloadQuestionTemplate);
router.delete('/questions/:id',                ...guard, c.deleteQuestion);
router.post('/questions/:id/delete',           ...guard, c.deleteQuestion);

// Reusable question paper library
router.get('/question-papers/questions/search', ...guard, questionPapers.searchQuestions);
router.get('/question-papers/generate',          ...guard, autoPapers.getGenerator);
router.post('/question-papers/generate/preview', ...guard, autoPapers.preview);
router.post('/question-papers/generate/replace', ...guard, autoPapers.replace);
router.post('/question-papers/generate/save',    ...guard, autoPapers.save);
router.get('/question-papers',                  ...guard, questionPapers.list);
router.get('/question-papers/create',           ...guard, questionPapers.getCreate);
router.post('/question-papers',                 ...guard, questionPapers.create);
router.get('/question-papers/:id',              ...guard, questionPapers.view);
router.get('/question-papers/:id/edit',         ...guard, questionPapers.getEdit);
router.post('/question-papers/:id',             ...guard, questionPapers.update);
router.post('/question-papers/:id/duplicate',   ...guard, questionPapers.duplicate);
router.post('/question-papers/:id/archive',     ...guard, questionPapers.archive);
router.post('/question-papers/:id/delete',      ...guard, questionPapers.remove);
router.get('/question-papers/:id/create-test',  ...guard, questionPapers.createTest);

// Tests
router.get('/tests',                      ...guard, c.getTests);
router.get('/tests/upload',                ...guard, (req, res) => res.redirect('/admin/questions/smart-import'));
router.get('/tests/create',               ...guard, c.getCreateTest);
router.post('/tests',                     ...guard, c.createTest);
router.post('/tests/upload-pdf',          ...guard, c.uploadPdfTest);
router.get('/tests/template/pdf',         ...guard, c.downloadPdfTestTemplate);
router.get('/tests/template/answer-key',  ...guard, c.downloadAnswerKeyTemplate);
router.get('/tests/:id',                  ...guard, c.getTestDetail);
router.get('/tests/:id/edit',             ...guard, c.getEditTest);
router.post('/tests/:id/edit',            ...guard, c.updateTest);
router.post('/tests/:id/delete',          ...guard, c.deleteTest);
router.post('/tests/:id/publish',         ...guard, c.publishTest);
router.post('/tests/:id/results/release', ...guard, c.releaseTestResults);

// Results
router.get('/results',        ...guard, c.getAllResults);
router.get('/results/export', ...guard, c.exportResultsExcel);

// Documents
router.get('/documents',          ...guard, c.getDocuments);
router.post('/documents/:id/delete',...guard, c.deleteDocument);

module.exports = router;
