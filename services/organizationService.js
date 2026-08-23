const { Organization, User } = require('../models');

const DEFAULT_ORGANIZATION_CODE = String(
  process.env.DEFAULT_ORGANIZATION_CODE || process.env.COLLEGE_SHORT_NAME || 'SPVN'
).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_') || 'SPVN';

let cachedDefault = null;
let cachedAt = 0;
const CACHE_MS = 60 * 1000;

function defaultOrganizationInput() {
  const organizationName = process.env.COLLEGE_NAME || 'Shardabai Pawar Vidya Niketan';
  const shortName = process.env.COLLEGE_SHORT_NAME || 'SPVN';
  return {
    organizationName,
    organizationCode: DEFAULT_ORGANIZATION_CODE,
    description: 'Default organization for the existing SPVN CET Portal installation.',
    logo: process.env.COLLEGE_LOGO_PATH || null,
    email: process.env.COLLEGE_EMAIL || null,
    phone: process.env.COLLEGE_PHONE || null,
    address: process.env.COLLEGE_ADDRESS || '',
    status: 'active',
    isDefault: true,
    settings: {
      academicDefaults: { academicYear: process.env.ACADEMIC_YEAR || '2024-2025' },
      branding: {
        portalName: process.env.APP_NAME || 'CET Exam Portal',
        shortName,
      },
      timezone: process.env.APP_TIME_ZONE || 'Asia/Kolkata',
    },
  };
}

async function ensureDefaultOrganization() {
  if (cachedDefault && Date.now() - cachedAt < CACHE_MS) return cachedDefault;

  const defaults = defaultOrganizationInput();
  let organization = await Organization.findOne({
    $or: [
      { isDefault: true },
      { organizationCode: DEFAULT_ORGANIZATION_CODE },
    ],
  });

  if (!organization) {
    organization = await Organization.create(defaults);
  } else if (!organization.isDefault) {
    organization.isDefault = true;
    await organization.save();
  }

  cachedDefault = organization;
  cachedAt = Date.now();
  return organization;
}

function clearOrganizationCache() {
  cachedDefault = null;
  cachedAt = 0;
}

async function resolveUserOrganization(userOrId) {
  let user = userOrId;
  if (!user || typeof user === 'string') {
    user = userOrId ? await User.findById(userOrId).select('organization isSuperAdmin role') : null;
  }
  if (user?.organization) {
    const organization = await Organization.findById(user.organization);
    if (organization) return organization;
  }
  return ensureDefaultOrganization();
}

function organizationScope(organization, field = 'organization') {
  if (!organization?._id) return {};
  if (!organization.isDefault) return { [field]: organization._id };
  return {
    $or: [
      { [field]: organization._id },
      { [field]: null },
      { [field]: { $exists: false } },
    ],
  };
}

function organizationIdForWrite(req) {
  return req.organization?._id || null;
}

module.exports = {
  DEFAULT_ORGANIZATION_CODE,
  clearOrganizationCache,
  defaultOrganizationInput,
  ensureDefaultOrganization,
  organizationIdForWrite,
  organizationScope,
  resolveUserOrganization,
};
