'use strict';

function trimNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  const factor = Math.pow(10, decimals);
  return String(Math.round(number * factor) / factor);
}

function formatSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  if (number >= 60) {
    const totalHundredths = Math.round(number * 100);
    const hours = Math.floor(totalHundredths / 360000);
    const minutes = Math.floor((totalHundredths % 360000) / 6000);
    const secondsHundredths = totalHundredths % 6000;
    const seconds = Math.floor(secondsHundredths / 100);
    const fraction = secondsHundredths % 100;
    const fractionText = fraction
      ? `.${String(fraction).padStart(2, '0').replace(/0$/, '')}`
      : '';
    const secondsText = `${String(seconds).padStart(2, '0')}${fractionText}秒`;
    return hours
      ? `${hours}小时${String(minutes).padStart(2, '0')}分${secondsText}`
      : `${minutes}分${secondsText}`;
  }
  return `${trimNumber(number, 2)} 秒`;
}

function formatPerformanceValue(value, unit) {
  if (unit === '秒') {
    return formatSeconds(value);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return `${value || ''} ${unit || ''}`.trim();
  }
  return `${trimNumber(number, unit === 'kg' ? 1 : 2)}${unit ? ` ${unit}` : ''}`;
}

module.exports = {
  formatPerformanceValue,
  formatSeconds
};
