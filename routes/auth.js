// routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isGuest, isAuthenticated } = require('../middleware/auth');

router.get('/login',  isGuest, authController.getLogin);
router.get('/admin',  isGuest, authController.getAdminLogin);
router.post('/admin', isGuest, authController.postAdminLogin);
router.post('/login', isGuest, authController.postLogin);
router.get('/change-password', isAuthenticated, authController.getChangePassword);
router.post('/change-password', isAuthenticated, authController.postChangePassword);
router.get('/logout', isAuthenticated, authController.logout);

module.exports = router;
