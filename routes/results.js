// routes/results.js
const express = require('express');
const router = express.Router();
const ec = require('../controllers/examController');
const { isAuthenticated } = require('../middleware/auth');

router.get('/leaderboard/:testId', isAuthenticated, ec.getLeaderboard);
router.get('/:resultId/pdf', isAuthenticated, ec.downloadResultPDF);
router.get('/:resultId', isAuthenticated, ec.getResult);

module.exports = router;
