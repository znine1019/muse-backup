'use strict';

const CLUB_UTC_OFFSET_MINUTES = 8 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_TYPES = Object.freeze(['month', 'quarter', 'year']);

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateOnlyFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function clubDateOnly(now = new Date()) {
  return new Date(now.getTime() + CLUB_UTC_OFFSET_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function clubTimeParts(now = new Date()) {
  const shifted = new Date(
    now.getTime() + CLUB_UTC_OFFSET_MINUTES * 60 * 1000
  );
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}

function clubDateTimeString(now = new Date()) {
  const shifted = new Date(
    now.getTime() + CLUB_UTC_OFFSET_MINUTES * 60 * 1000
  );
  return `${shifted.toISOString().slice(0, 10)} ${shifted
    .toISOString()
    .slice(11, 16)}`;
}

function isDateTimeString(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(value)
  ) {
    return false;
  }
  return isDateOnly(value.slice(0, 10));
}

function timeToMinutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    return null;
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const normalized = ((Number(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnlyFromUtcDate(date);
}

function startOfWeek(dateOnly) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return dateOnlyFromUtcDate(date);
}

function endOfWeek(dateOnly) {
  return addDays(startOfWeek(dateOnly), 6);
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && dateOnlyFromUtcDate(date) === value;
}

function periodRange(input = {}, now = new Date()) {
  const currentDate = clubDateOnly(now);
  const currentYear = Number(currentDate.slice(0, 4));
  const currentMonth = Number(currentDate.slice(5, 7));
  const periodType = PERIOD_TYPES.includes(input.periodType)
    ? input.periodType
    : 'month';
  const year = Number(input.year) || currentYear;
  if (year < 2000 || year > 2100) {
    throw new Error('INVALID_PERIOD_YEAR');
  }

  if (periodType === 'year') {
    return {
      periodType,
      year,
      month: null,
      quarter: null,
      startDate: `${year}-01-01`,
      endExclusive: `${year + 1}-01-01`,
      label: `${year}年度`,
      rangeText: `${year}-01-01 至 ${year}-12-31`
    };
  }

  if (periodType === 'quarter') {
    const quarter = Number(input.quarter) || Math.floor((currentMonth - 1) / 3) + 1;
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      throw new Error('INVALID_PERIOD_QUARTER');
    }
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 3;
    const startDate = `${year}-${pad(startMonth)}-01`;
    const endExclusive =
      endMonth === 13
        ? `${year + 1}-01-01`
        : `${year}-${pad(endMonth)}-01`;
    return {
      periodType,
      year,
      month: null,
      quarter,
      startDate,
      endExclusive,
      label: `${year}年第${quarter}季度`,
      rangeText: `${startDate} 至 ${addDays(endExclusive, -1)}`
    };
  }

  const month = Number(input.month) || currentMonth;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('INVALID_PERIOD_MONTH');
  }
  const startDate = `${year}-${pad(month)}-01`;
  const endExclusive =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${pad(month + 1)}-01`;
  return {
    periodType,
    year,
    month,
    quarter: null,
    startDate,
    endExclusive,
    label: `${year}年${month}月`,
    rangeText: `${startDate} 至 ${addDays(endExclusive, -1)}`
  };
}

function previousPeriodRange(range) {
  if (!range || !range.startDate) {
    return null;
  }
  if (range.periodType === 'year') {
    return periodRange({ periodType: 'year', year: range.year - 1 });
  }
  if (range.periodType === 'quarter') {
    if (range.quarter > 1) {
      return periodRange({
        periodType: 'quarter',
        year: range.year,
        quarter: range.quarter - 1
      });
    }
    return periodRange({
      periodType: 'quarter',
      year: range.year - 1,
      quarter: 4
    });
  }
  if (range.month > 1) {
    return periodRange({
      periodType: 'month',
      year: range.year,
      month: range.month - 1
    });
  }
  return periodRange({
    periodType: 'month',
    year: range.year - 1,
    month: 12
  });
}

function dateOnlyFromValue(value) {
  if (!value && value !== 0) {
    return '';
  }
  if (value instanceof Date) {
    return clubDateOnly(value);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : clubDateOnly(date);
}

function isDateInRange(dateOnly, range) {
  const normalized = dateOnlyFromValue(dateOnly);
  return Boolean(
    normalized &&
      range &&
      normalized >= range.startDate &&
      normalized < range.endExclusive
  );
}

module.exports = {
  PERIOD_TYPES,
  clubDateTimeString,
  clubTimeParts,
  dateOnlyFromValue,
  addDays,
  clubDateOnly,
  endOfWeek,
  isDateInRange,
  isDateOnly,
  isDateTimeString,
  minutesToTime,
  periodRange,
  previousPeriodRange,
  timeToMinutes,
  startOfWeek,
  DAY_MS
};
