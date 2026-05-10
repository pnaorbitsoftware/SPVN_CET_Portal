// controllers/authController.js
const { User } = require('../models');

exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Login — ' + (process.env.COLLEGE_SHORT_NAME || 'Exam') + ' Portal' });
};

exports.postLogin = async (req, res) => {
  try {
    const { identifier, password, role } = req.body;
    // Only allow admin and student
    if (!['admin', 'student'].includes(role)) {
      req.flash('error', 'Invalid role.');
      return res.redirect('/auth/login');
    }
    const where = role === 'student'
      ? { rollNo: identifier, role: 'student' }
      : { email: identifier, role: 'admin' };
    const user = await User.findOne({ where });
    if (!user || !user.isActive) {
      req.flash('error', 'Invalid credentials or account inactive.');
      return res.redirect('/auth/login');
    }
    const valid = await user.verifyPassword(password);
    if (!valid) {
      req.flash('error', 'Incorrect password. Please try again.');
      return res.redirect('/auth/login');
    }
    req.session.user = {
      id: user.id, name: user.name, email: user.email,
      rollNo: user.rollNo, role: user.role,
      isFirstLogin: user.isFirstLogin, profilePhoto: user.profilePhoto,
    };
    await user.update({ lastLogin: new Date() });
    if (user.isFirstLogin) {
      req.flash('warning', 'Please change your default password to continue.');
      return res.redirect('/auth/change-password');
    }
    req.flash('success', `Welcome back, ${user.name}!`);
    return res.redirect(`/${user.role}/dashboard`);
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error', 'Login failed. Please try again.');
    return res.redirect('/auth/login');
  }
};

exports.getChangePassword = (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  res.render('auth/change-password', { title: 'Change Password', user: req.session.user });
};

exports.postChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) { req.flash('error', 'Passwords do not match.'); return res.redirect('/auth/change-password'); }
    if (newPassword.length < 8) { req.flash('error', 'Password must be at least 8 characters.'); return res.redirect('/auth/change-password'); }
    const user = await User.findByPk(req.session.user.id);
    if (!await user.verifyPassword(currentPassword)) { req.flash('error', 'Current password is incorrect.'); return res.redirect('/auth/change-password'); }
    await user.update({ password: newPassword, isFirstLogin: false });
    req.session.user.isFirstLogin = false;
    req.flash('success', 'Password changed successfully!');
    return res.redirect(`/${req.session.user.role}/dashboard`);
  } catch (err) {
    req.flash('error', 'Failed to change password.');
    return res.redirect('/auth/change-password');
  }
};

// Fix logout crash — safe session destroy
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.clearCookie('connect.sid');
    return res.redirect('/auth/login');
  });
};
