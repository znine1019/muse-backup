'use strict';

const CLUB_UTC_OFFSET_MINUTES = 8 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

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

module.exports = {
  addDays,
  clubDateOnly,
  endOfWeek,
  isDateOnly,
  startOfWeek,
  DAY_MS
};
