// routes/admin.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { isAuthenticated, requireRole, requirePasswordChange } = require('../middleware/auth');

const guard = [isAuthenticated, requirePasswordChange, requireRole('admin')];

router.get('/dashboard', ...guard, adminController.getDashboard);

// Teachers
router.get('/teachers', ...guard, adminController.getTeachers);
router.post('/teachers', ...guard, adminController.createTeacher);
router.delete('/teachers/:id', ...guard, adminController.deleteTeacher);

// Students
router.get('/students', ...guard, adminController.getStudents);
router.post('/students', ...guard, adminController.createStudent);
router.post('/students/bulk-import', ...guard, adminController.bulkImportStudents);

// Groups
router.get('/groups', ...guard, adminController.getGroups);
router.post('/groups', ...guard, adminController.createGroup);
router.post('/groups/assign-member', ...guard, adminController.assignMember);

// Results
router.get('/results', ...guard, adminController.getAllResults);

module.exports = router;
