// routes/admin.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { isAuthenticated, requireRole, requirePasswordChange } = require('../middleware/auth');

const guard = [isAuthenticated, requirePasswordChange, requireRole('admin')];

router.get('/dashboard', ...guard, adminController.getDashboard);

// Students
router.get('/students', ...guard, adminController.getStudents);
router.post('/students', ...guard, adminController.createStudent);
router.post('/students/bulk-import', ...guard, adminController.bulkImportStudents);

// Groups
router.get('/groups', ...guard, adminController.getGroups);
router.post('/groups', ...guard, adminController.createGroup);
router.post('/groups/assign-member', ...guard, adminController.assignMember);

// Questions
router.get('/questions', ...guard, adminController.getQuestions);
router.post('/questions', ...guard, adminController.createQuestion);
router.post('/questions/bulk-import', ...guard, adminController.bulkImportQuestions);
router.delete('/questions/:id', ...guard, adminController.deleteQuestion);

// Tests
router.get('/tests', ...guard, adminController.getTests);
router.get('/tests/create', ...guard, adminController.getCreateTest);
router.post('/tests', ...guard, adminController.createTest);
router.get('/tests/:id', ...guard, adminController.getTestDetail);
router.post('/tests/:id/publish', ...guard, adminController.publishTest);

// Subjects
router.get('/subjects', ...guard, adminController.getSubjects);
router.post('/subjects', ...guard, adminController.addSubject);
router.post('/subjects/delete', ...guard, adminController.deleteSubject);

// Results
router.get('/results', ...guard, adminController.getAllResults);

module.exports = router;
