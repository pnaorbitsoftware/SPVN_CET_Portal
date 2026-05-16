// routes/student.js
const express = require('express');
const router = express.Router();
const sc = require('../controllers/studentController');
const { isAuthenticated, requireRole, requirePasswordChange } = require('../middleware/auth');

const guard = [isAuthenticated, requirePasswordChange, requireRole('student')];

router.get('/dashboard',     ...guard, sc.getDashboard);
router.get('/tests',         ...guard, sc.getTests);
router.get('/results',       ...guard, sc.getResults);
router.get('/notifications', ...guard, sc.getNotifications);
router.get('/documents',     ...guard, sc.getDocuments);
router.post('/documents',    ...guard, sc.uploadDocument);

module.exports = router;
