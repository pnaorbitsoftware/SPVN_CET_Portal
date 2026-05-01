// utils/passwordHelper.js
// Password generation utilities for XYZ College CET System

/**
 * Generate student default password from roll number
 * Format: CET@<last4digits>
 * Example: Roll=2024CE001 → CET@1001
 */
const generateStudentPassword = (rollNo) => {
  const prefix = process.env.PASSWORD_PREFIX || 'CET@';
  const digits = String(rollNo).replace(/\D/g, ''); // extract digits only
  const suffix = digits.slice(-4).padStart(4, '0');
  return `${prefix}${suffix}`;
};

/**
 * Generate teacher default password
 * Format: Teacher@<FirstName><RandomNum>
 */
const generateTeacherPassword = (name) => {
  const prefix = process.env.TEACHER_PASSWORD_PREFIX || 'Teacher@';
  const firstName = name.trim().split(' ')[0];
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${firstName}${rand}`;
};

module.exports = { generateStudentPassword, generateTeacherPassword };
