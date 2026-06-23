// controllers/authController.js
const { User } = require('../models');


// ── ADMIN LOGIN (separate URL: /auth/admin) ───────────────────────────────
exports.getAdminLogin = (req, res) => {
  res.render('auth/admin-login', { title: 'Admin Login — ' + (process.env.COLLEGE_SHORT_NAME || 'CET') + ' Portal' });
};

exports.postAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email, role: 'admin' } });
    if (!user || !user.isActive) {
      req.flash('error', 'Invalid admin credentials.');
      return res.redirect('/auth/admin');
    }
    const valid = await user.verifyPassword(password);
    if (!valid) {
      req.flash('error', 'Incorrect password.');
      return res.redirect('/auth/admin');
    }
    req.session.user = {
      id: user.id, name: user.name, email: user.email,
      rollNo: user.rollNo, role: user.role,
      isFirstLogin: user.isFirstLogin, profilePhoto: user.profilePhoto,
    };
    await user.update({ lastLogin: new Date() });
    if (user.isFirstLogin) {
      req.flash('warning', 'Please change your default password.');
      return res.redirect('/auth/change-password');
    }
    req.flash('success', `Welcome, ${user.name}!`);
    return res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Admin login error:', err);
    req.flash('error', 'Login failed. Please try again.');
    return res.redirect('/auth/admin');
  }
};

exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Login — ' + (process.env.COLLEGE_SHORT_NAME || 'CET') + ' Portal' });
};

exports.postLogin = async (req, res) => {
  try {
    const { identifier, password, role } = req.body;
    // /auth/login is STUDENT-ONLY — admin must use /auth/admin
    if (role !== 'student') {
      req.flash('error', 'Please use the admin login page.');
      return res.redirect('/auth/admin');
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

    // Check passwords match
    if (newPassword !== confirmPassword) {

      req.flash('error', 'Passwords do not match.');

      return res.redirect('/auth/change-password');
    }

    // Password length
    if (newPassword.length < 6) {

      req.flash('error', 'Password must be at least 6 characters.');

      return res.redirect('/auth/change-password');
    }

    // Find user
    const user = await User.findByPk(req.session.user.id);

    if (!user) {

      req.flash('error', 'User not found.');

      return res.redirect('/auth/login');
    }

    // Verify current password ONLY if not first login
    if (!user.isFirstLogin) {

      const validPassword = await user.verifyPassword(currentPassword);

      if (!validPassword) {

        req.flash('error', 'Current password is incorrect.');

        return res.redirect('/auth/change-password');
      }
    }

    // Save new password
    user.password = newPassword;
    user.isFirstLogin = false;

    await user.save();

    // Update session
    req.session.user.isFirstLogin = false;

    req.flash('success', 'Password changed successfully!');

    return res.redirect(`/${req.session.user.role}/dashboard`);

  } catch (err) {

    console.error('Change password error:', err);

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
