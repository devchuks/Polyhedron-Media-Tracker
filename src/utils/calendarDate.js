const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseCalendarDate = value => {
  const match = String(value || '').match(DATE_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
};

export const dateInputFromTimestamp = (value, options = {}) => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  if (Number.isFinite(options.offsetMinutes)) {
    return new Date(timestamp + options.offsetMinutes * 60_000).toISOString().slice(0, 10);
  }
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const timestampFromDateInput = (value, options = {}) => {
  const parsed = parseCalendarDate(value);
  if (!parsed) return null;
  const hour = Number.isInteger(options.hour) ? options.hour : 12;
  if (Number.isFinite(options.offsetMinutes)) {
    return Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour) - options.offsetMinutes * 60_000;
  }
  return new Date(parsed.year, parsed.month - 1, parsed.day, hour, 0, 0, 0).getTime();
};

export const todayDateInput = (now = Date.now()) => dateInputFromTimestamp(now);

export const timestampForCalendarDateWithCurrentTime = (value, now = Date.now()) => {
  const parsed = parseCalendarDate(value);
  if (!parsed) return null;
  const clock = new Date(now);
  return new Date(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    clock.getHours(),
    clock.getMinutes(),
    clock.getSeconds(),
    clock.getMilliseconds(),
  ).getTime();
};
