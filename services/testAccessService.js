const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 64;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map();

function normalizedPassword(value) {
  return String(value || '').trim();
}

function validatePassword(value) {
  const password = normalizedPassword(value);
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Test password/PIN must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

async function accessConfiguration({ enabled, password, existingHash = null, existingUpdatedAt = null, now = new Date() }) {
  const isEnabled = enabled === true || enabled === 'true' || enabled === 'on';
  if (!isEnabled) {
    return { testAccessEnabled:false, testAccessHash:null, testAccessUpdatedAt:null };
  }
  const submittedPassword = normalizedPassword(password);
  if (!submittedPassword && existingHash) {
    const savedVersion = existingUpdatedAt ? new Date(existingUpdatedAt) : null;
    return { testAccessEnabled:true, testAccessHash:existingHash, testAccessUpdatedAt:savedVersion && !Number.isNaN(savedVersion.getTime()) ? savedVersion : now };
  }
  const validated = validatePassword(submittedPassword);
  return {
    testAccessEnabled:true,
    testAccessHash:await bcrypt.hash(validated, 12),
    testAccessUpdatedAt:now,
  };
}

function failureKey(userId, testId) {
  return `${String(userId)}:${String(testId)}`;
}

function attemptState(userId, testId, now = new Date()) {
  const key = failureKey(userId, testId);
  const timestamp = new Date(now).getTime();
  const entry = failures.get(key);
  if (!entry) return { allowed:true, retryAfterSeconds:0 };
  if (entry.blockedUntil > timestamp) {
    return { allowed:false, retryAfterSeconds:Math.ceil((entry.blockedUntil - timestamp) / 1000) };
  }
  if (entry.windowEnds <= timestamp) failures.delete(key);
  return { allowed:true, retryAfterSeconds:0 };
}

function recordFailure(userId, testId, now = new Date()) {
  const key = failureKey(userId, testId);
  const timestamp = new Date(now).getTime();
  const current = failures.get(key);
  const entry = !current || current.windowEnds <= timestamp
    ? { count:0, windowEnds:timestamp + FAILURE_WINDOW_MS, blockedUntil:0 }
    : current;
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) entry.blockedUntil = timestamp + BLOCK_MS;
  failures.set(key, entry);
  return attemptState(userId, testId, now);
}

function clearFailures(userId, testId) {
  failures.delete(failureKey(userId, testId));
}

async function validateAccessAttempt({ userId, testId, password, passwordHash, now = new Date() }) {
  const state = attemptState(userId, testId, now);
  if (!state.allowed) return { ok:false, code:'RATE_LIMITED', ...state };
  const matches = Boolean(passwordHash) && await bcrypt.compare(normalizedPassword(password), passwordHash);
  if (!matches) {
    const failed = recordFailure(userId, testId, now);
    return { ok:false, code:failed.allowed ? 'INVALID_PASSWORD' : 'RATE_LIMITED', ...failed };
  }
  clearFailures(userId, testId);
  return { ok:true, code:'OK', allowed:true, retryAfterSeconds:0 };
}

function accessVersion(test) {
  if (!test?.testAccessEnabled) return null;
  const version = test.testAccessUpdatedAt ? new Date(test.testAccessUpdatedAt) : null;
  return version && !Number.isNaN(version.getTime()) ? version : null;
}

function versionKey(test) {
  return accessVersion(test)?.getTime() || 0;
}

function sessionHasAccess(req, test) {
  if (!test?.testAccessEnabled) return true;
  return Number(req.session?.testAccess?.[String(test._id)]) === versionKey(test);
}

function grantSessionAccess(req, test) {
  req.session.testAccess ||= {};
  req.session.testAccess[String(test._id)] = versionKey(test);
}

function resultHasAccess(test, result) {
  if (!test?.testAccessEnabled) return true;
  const resultVersion = result?.accessVersion ? new Date(result.accessVersion).getTime() : 0;
  return resultVersion === versionKey(test) && resultVersion !== 0;
}

function issueAccessGrant({ userId, test, secret }) {
  if (!secret) throw new Error('Mobile access-token secret is unavailable.');
  return jwt.sign({ sub:String(userId), testId:String(test._id), accessVersion:versionKey(test), scope:'test_access' }, secret, { expiresIn:'30m' });
}

function verifyAccessGrant({ token, userId, test, secret }) {
  if (!token || !secret) return false;
  try {
    const payload = jwt.verify(token, secret);
    return payload.scope === 'test_access'
      && String(payload.sub) === String(userId)
      && String(payload.testId) === String(test._id)
      && Number(payload.accessVersion) === versionKey(test);
  } catch {
    return false;
  }
}

module.exports = {
  accessConfiguration,
  accessVersion,
  attemptState,
  clearFailures,
  grantSessionAccess,
  issueAccessGrant,
  normalizedPassword,
  recordFailure,
  resultHasAccess,
  sessionHasAccess,
  validateAccessAttempt,
  validatePassword,
  verifyAccessGrant,
  versionKey,
};
