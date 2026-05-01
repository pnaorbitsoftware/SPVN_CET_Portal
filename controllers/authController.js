// controllers/authController.js
const { User } = require('../models');
const bcrypt = require('bcryptjs');

/**
 * GET /auth/login
 */
exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Login — ' + process.env.COLLEGE_SHORT_NAME + ' Exam Portal' });
};

/**
 * POST /auth/login
 */
exports.postLogin = async (req, res) => {
  try {
    const { identifier, password, role } = req.body;

    // Find user by email, rollNo, or username
    const user = await User.findOne({
      where: role === 'student'
        ? { rollNo: identifier, role: 'student' }
        : { email: identifier, role },
    });

    if (!user || !user.isActive) {
      req.flash('error', 'Invalid credentials or account is inactive.');
      return res.redirect('/auth/login');
    }

    const isValid = await user.verifyPassword(password);
    if (!isValid) {
      req.flash('error', 'Invalid password. Please try again.');
      return res.redirect('/auth/login');
    }

    // Store session
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      rollNo: user.rollNo,
      role: user.role,
      isFirstLogin: user.isFirstLogin,
      profilePhoto: user.profilePhoto,
    };

    // Update last login
    await user.update({ lastLogin: new Date() });

    // Force password change on first login
    if (user.isFirstLogin) {
      req.flash('warning', 'Welcome! Please change your default password to continue.');
      return res.redirect('/auth/change-password');
    }

    req.flash('success', `Welcome back, ${user.name}!`);
    return res.redirect(`/${user.role}/dashboard`);
  } catch (error) {
    console.error('Login error:', error);
    req.flash('error', 'An error occurred during login. Please try again.');
    return res.redirect('/auth/login');
  }
};

/**
 * GET /auth/change-password
 */
exports.getChangePassword = (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  res.render('auth/change-password', {
    title: 'Change Password',
    user: req.session.user,
  });
};

/**
 * POST /auth/change-password
 */
exports.postChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.session.user.id;

    if (newPassword !== confirmPassword) {
      req.flash('error', 'New passwords do not match.');
      return res.redirect('/auth/change-password');
    }

    if (newPassword.length < 8) {
      req.flash('error', 'Password must be at least 8 characters long.');
      return res.redirect('/auth/change-password');
    }

    const user = await User.findByPk(userId);
    const isValid = await user.verifyPassword(currentPassword);

    if (!isValid) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/auth/change-password');
    }

    await user.update({ password: newPassword, isFirstLogin: false });

    // Update session
    req.session.user.isFirstLogin = false;

    req.flash('success', 'Password changed successfully!');
    return res.redirect(`/${req.session.user.role}/dashboard`);
  } catch (error) {
    console.error('Change password error:', error);
    req.flash('error', 'Failed to change password. Please try again.');
    return res.redirect('/auth/change-password');
  }
};

/**
 * GET /auth/logout
 */
exports.logout = (req, res) => {
  const role = req.session.user?.role;
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.clearCookie('connect.sid');
    req.flash && req.flash('success', 'You have been logged out successfully.');
    return res.redirect('/auth/login');
  });
};
