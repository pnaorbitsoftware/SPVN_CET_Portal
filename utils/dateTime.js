const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Kolkata';

function zonedParts(value, timeZone = APP_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
}

function parseLocalDateTime(value, timeZone = APP_TIME_ZONE) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const input = String(value).trim();
  if (!input) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(input)) {
    const absoluteDate = new Date(input);
    return Number.isNaN(absoluteDate.getTime()) ? null : absoluteDate;
  }

  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second = '00'] = match;
  const desiredUtc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  let timestamp = desiredUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(timestamp), timeZone);
    if (!parts) return null;
    const representedUtc = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second
    );
    const adjustment = desiredUtc - representedUtc;
    timestamp += adjustment;
    if (adjustment === 0) break;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTimeLocal(value, timeZone = APP_TIME_ZONE) {
  if (!value) return '';
  const parts = zonedParts(value, timeZone);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

module.exports = { APP_TIME_ZONE, parseLocalDateTime, formatDateTimeLocal };
