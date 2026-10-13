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

module.exports = {
  clubDateTimeString,
  clubTimeParts,
  addDays,
  clubDateOnly,
  endOfWeek,
  isDateOnly,
  isDateTimeString,
  minutesToTime,
  timeToMinutes,
  startOfWeek,
  DAY_MS
};
