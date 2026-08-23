const { Organization, User } = require('../models');
const {
  clearOrganizationCache,
  organizationIdForWrite,
} = require('../services/organizationService');

const STATUS_VALUES = ['active', 'inactive', 'suspended'];
const COURSE_VALUES = ['JEE', 'CET', 'NEET'];
const RELEASE_VALUES = ['IMMEDIATE', 'AFTER_TEST_END', 'SCHEDULED', 'MANUAL'];
const TIMING_VALUES = ['PERSONAL_DURATION', 'FIXED_WINDOW', 'UNTIMED'];
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function clean(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function selected(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).map(item => String(item));
}

function canManage(req, organizationId) {
  return Boolean(
    req.session.user.isSuperAdmin
    || String(organizationId) === String(organizationIdForWrite(req))
  );
}

function settingsUpdateFrom(body) {
  const courses = selected(body.defaultCourses).filter(course => COURSE_VALUES.includes(course));
  const timingMode = TIMING_VALUES.includes(body.defaultTimingMode)
    ? body.defaultTimingMode : 'PERSONAL_DURATION';
  const releaseMode = RELEASE_VALUES.includes(body.defaultReleaseMode)
    ? body.defaultReleaseMode : 'IMMEDIATE';
  const primaryColor = COLOR_PATTERN.test(body.primaryColor || '') ? body.primaryColor : '#131330';
  const accentColor = COLOR_PATTERN.test(body.accentColor || '') ? body.accentColor : '#f59e0b';

  return {
    'settings.academicDefaults.academicYear': clean(body.academicYear, 32),
    'settings.academicDefaults.courses': courses.length ? courses : COURSE_VALUES,
    'settings.examDefaults.duration': Math.max(1, Math.min(1440, Number(body.defaultDuration) || 180)),
    'settings.examDefaults.timingMode': timingMode,
    'settings.examDefaults.negativeMarking': Math.max(0, Number(body.defaultNegativeMarking) || 0),
    'settings.examDefaults.shuffleQuestions': body.defaultShuffleQuestions === 'on',
    'settings.examDefaults.shuffleOptions': body.defaultShuffleOptions === 'on',
    'settings.resultDefaults.releaseMode': releaseMode,
    'settings.resultDefaults.rankingSchemaCode': clean(body.defaultRankingSchemaCode, 64) || 'SCORE_TIME',
    'settings.branding.portalName': clean(body.portalName, 120) || 'CET Exam Portal',
    'settings.branding.shortName': clean(body.shortName, 24) || 'CET',
    'settings.branding.primaryColor': primaryColor,
    'settings.branding.accentColor': accentColor,
    'settings.timezone': clean(body.timezone, 80) || 'Asia/Kolkata',
  };
}

exports.getOrganizations = async (req, res) => {
  try {
    const query = req.session.user.isSuperAdmin ? {} : { _id: organizationIdForWrite(req) };
    const organizations = await Organization.find(query)
      .populate('administrator', 'name email')
      .sort({ isDefault: -1, organizationName: 1 });
    const administrators = req.session.user.isSuperAdmin
      ? await User.find({ role: 'admin', isActive: true }).select('name email organization').sort({ name: 1 })
      : [];
    res.render('admin/organizations', {
      title: 'Organization Settings',
      organizations,
      administrators,
      statusValues: STATUS_VALUES,
      courseValues: COURSE_VALUES,
    });
  } catch (error) {
    console.error('Organization settings load failed:', error);
    req.flash('error', 'Unable to load organization settings.');
    res.redirect('/admin/dashboard');
  }
};

exports.createOrganization = async (req, res) => {
  try {
    if (!req.session.user.isSuperAdmin) throw Object.assign(new Error('Only a platform administrator can create an organization.'), { status: 403 });
    const organizationName = clean(req.body.organizationName, 160);
    const organizationCode = clean(req.body.organizationCode, 32).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    if (!organizationName || organizationCode.length < 2) throw new Error('Organization name and a valid code are required.');
    const administrator = req.body.administrator || null;
    const organization = await Organization.create({
      organizationName,
      organizationCode,
      description: clean(req.body.description),
      logo: clean(req.body.logo, 500) || null,
      email: clean(req.body.email, 160).toLowerCase() || null,
      phone: clean(req.body.phone, 40) || null,
      address: clean(req.body.address),
      administrator,
      status: 'active',
      settings: {
        academicDefaults: { academicYear: clean(req.body.academicYear, 32) || process.env.ACADEMIC_YEAR || '2024-2025' },
        branding: { portalName: organizationName, shortName: organizationCode },
        timezone: clean(req.body.timezone, 80) || 'Asia/Kolkata',
      },
    });
    if (administrator) await User.findByIdAndUpdate(administrator, { organization: organization._id });
    req.flash('success', `Organization "${organization.organizationName}" created.`);
  } catch (error) {
    const message = error.code === 11000 ? 'Organization code already exists.' : error.message;
    req.flash('error', message);
  }
  res.redirect('/admin/organizations');
};

exports.updateOrganization = async (req, res) => {
  try {
    if (!canManage(req, req.params.id)) throw Object.assign(new Error('Access denied.'), { status: 403 });
    const organizationName = clean(req.body.organizationName, 160);
    if (!organizationName) throw new Error('Organization name is required.');
    const update = {
      organizationName,
      description: clean(req.body.description),
      logo: clean(req.body.logo, 500) || null,
      email: clean(req.body.email, 160).toLowerCase() || null,
      phone: clean(req.body.phone, 40) || null,
      address: clean(req.body.address),
      ...settingsUpdateFrom(req.body),
    };
    if (req.session.user.isSuperAdmin) update.administrator = req.body.administrator || null;
    const organization = await Organization.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!organization) throw new Error('Organization not found.');
    if (req.session.user.isSuperAdmin && update.administrator) {
      await User.findByIdAndUpdate(update.administrator, { organization: organization._id });
    }
    clearOrganizationCache();
    req.flash('success', 'Organization settings updated.');
  } catch (error) {
    req.flash('error', `Unable to update organization: ${error.message}`);
  }
  res.redirect('/admin/organizations');
};

exports.updateOrganizationStatus = async (req, res) => {
  try {
    if (!req.session.user.isSuperAdmin) throw Object.assign(new Error('Only a platform administrator can change organization status.'), { status: 403 });
    if (!STATUS_VALUES.includes(req.body.status)) throw new Error('Select a valid organization status.');
    const organization = await Organization.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true }
    );
    if (!organization) throw new Error('Organization not found.');
    clearOrganizationCache();
    req.flash('success', `${organization.organizationName} is now ${organization.status}.`);
  } catch (error) {
    req.flash('error', `Unable to change organization status: ${error.message}`);
  }
  res.redirect('/admin/organizations');
};

exports._private = { canManage, settingsUpdateFrom };
