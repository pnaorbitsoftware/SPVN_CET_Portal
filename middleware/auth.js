// middleware/auth.js
// Authentication and role-based access control middleware
const { User } = require('../models');
const { resolveUserOrganization } = require('../services/organizationService');

function organizationAllowsAccess(req) {
  if (!req.organization || req.organization.status === 'active') return true;
  return Boolean(req.session?.user?.role === 'admin' && req.session.user.isSuperAdmin);
}

/**
 * Checks if user is logged in
 */
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    if (!organizationAllowsAccess(req)) {
      req.flash('error', `Your organization is ${req.organization.status}. Contact the platform administrator.`);
      req.session.user = null;
      return res.redirect('/auth/login');
    }
    return next();
  }
  req.flash('error', 'Please login to access this page.');
  return res.redirect('/auth/login');
};

/**
 * Redirects already-logged-in users away from auth pages
 */
const isGuest = (req, res, next) => {
  if (req.session && req.session.user) {
    return res.redirect(`/${req.session.user.role}/dashboard`);
  }
  return next();
};

/**
 * Enforces first-login password change
 */
const requirePasswordChange = (req, res, next) => {
  if (req.session.user && req.session.user.isFirstLogin) {
    if (req.path !== '/auth/change-password') {
      req.flash('warning', 'You must change your password before proceeding.');
      return res.redirect('/auth/change-password');
    }
  }
  return next();
};

/**
 * Role-based guard factory
 * Usage: requireRole('admin') or requireRole(['admin', 'student'])
 */
const requireRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash('error', 'Please login to access this page.');
      return res.redirect('/auth/login');
    }
    if (!allowedRoles.includes(req.session.user.role)) {
      req.flash('error', 'Access denied. Insufficient permissions.');
      return res.redirect(`/${req.session.user.role}/dashboard`);
    }
    if (!organizationAllowsAccess(req)) {
      req.flash('error', `Your organization is ${req.organization.status}. Contact the platform administrator.`);
      req.session.user = null;
      return res.redirect('/auth/login');
    }
    return next();
  };
};

/**
 * Resolve the current organization after MongoDB boot and expose its branding.
 * Legacy users without an organization are treated as members of the default
 * SPVN organization, so existing sessions and documents continue to work.
 */
const attachOrganization = async (req, res, next) => {
  try {
    let user = null;
    if (req.session?.user?.id) {
      user = await User.findById(req.session.user.id)
        .select('organization isSuperAdmin role isActive');
      if (!user || !user.isActive) {
        req.session.user = null;
      } else {
        req.session.user.organizationId = user.organization?.toString() || null;
        req.session.user.isSuperAdmin = Boolean(user.isSuperAdmin);
      }
    }

    const organization = await resolveUserOrganization(user);
    req.organization = organization;
    res.locals.organization = organization;
    res.locals.organizationStatus = organization.status;
    res.locals.collegeName = organization.organizationName || res.locals.collegeName;
    res.locals.collegeShort = organization.settings?.branding?.shortName
      || organization.organizationCode
      || res.locals.collegeShort;
    res.locals.academicYear = organization.settings?.academicDefaults?.academicYear
      || res.locals.academicYear;
    res.locals.collegeLogo = organization.logo || res.locals.collegeLogo;
    res.locals.collegeAddress = organization.address || res.locals.collegeAddress;
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Attach user data to res.locals for use in all views
 */
const attachUser = (req, res, next) => {
  res.locals.currentUser    = req.session.user || null;
  res.locals.collegeName    = process.env.COLLEGE_NAME       || 'CET Exam Portal';
  res.locals.collegeShort   = process.env.COLLEGE_SHORT_NAME || 'CET';
  res.locals.academicYear   = process.env.ACADEMIC_YEAR      || '2024-25';
  res.locals.collegeLogo    = process.env.COLLEGE_LOGO_PATH  || null;
  res.locals.collegeAddress = process.env.COLLEGE_ADDRESS    || '';
  res.locals.successMsg = req.flash('success');
  res.locals.errorMsg   = req.flash('error');
  res.locals.warningMsg = req.flash('warning');
  res.locals.infoMsg    = req.flash('info');
  next();
};

/**
 * Error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  const statusCode = err.status || 500;
  res.status(statusCode).render('error', {
    title: 'Error',
    message: err.message || 'Something went wrong!',
    statusCode,
    error: process.env.NODE_ENV === 'development' ? err : {},
  });
};

/**
 * 404 handler
 */
const notFound = (req, res) => {
  res.status(404).render('error', {
    title: '404 - Page Not Found',
    message: 'The page you are looking for does not exist.',
    statusCode: 404,
    error: {},
  });
};

module.exports = {
  isAuthenticated,
  isGuest,
  requireRole,
  requirePasswordChange,
  attachUser,
  attachOrganization,
  errorHandler,
  notFound,
};
