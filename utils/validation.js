function cleanText(value, maxLength = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseDateOnly(value, label = 'Date') {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${label} is invalid.`);
    return value;
  }
  const input = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error(`${label} is invalid.`);
  const date = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input) {
    throw new Error(`${label} is invalid.`);
  }
  return date;
}

function validateDateRange(startDate, endDate, labels = {}) {
  if (startDate && endDate && startDate > endDate) {
    throw new Error(`${labels.end || 'End date'} must be on or after ${String(labels.start || 'start date').toLowerCase()}.`);
  }
}

function dateInputValue(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

module.exports = { cleanText, dateInputValue, parseDateOnly, validateDateRange };
