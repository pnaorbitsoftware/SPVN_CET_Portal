// routes/teacher.js
const express = require('express');
const router = express.Router();
const tc = require('../controllers/teacherController');
const { isAuthenticated, requireRole, requirePasswordChange } = require('../middleware/auth');

const guard = [isAuthenticated, requirePasswordChange, requireRole('teacher')];

router.get('/dashboard', ...guard, tc.getDashboard);
router.get('/questions', ...guard, tc.getQuestions);
router.post('/questions', ...guard, tc.createQuestion);
router.post('/questions/bulk-import', ...guard, tc.bulkImportQuestions);
router.delete('/questions/:id', ...guard, tc.deleteQuestion);
router.get('/tests', ...guard, tc.getTests);
router.get('/tests/create', ...guard, tc.getCreateTest);
router.post('/tests', ...guard, tc.createTest);
router.get('/tests/:id', ...guard, tc.getTestDetail);
router.post('/tests/:id/publish', ...guard, tc.publishTest);
router.get('/performance', ...guard, tc.getStudentPerformance);

module.exports = router;
