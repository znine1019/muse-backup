'use strict';

const { getPerformanceEvent, listPerformanceEvents } = require('./performance-events');

const CHART_POINT_LIMIT = 120;

function dateOnly(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function isBetter(candidate, current, comparison) {
  if (!current) {
    return true;
  }
  return comparison === 'lower'
    ? candidate.value < current.value
    : candidate.value > current.value;
}

function buildMeasurementSeries(records) {
  return [...records]
    .sort(
      (left, right) =>
        new Date(left.measuredAt || 0).getTime() -
        new Date(right.measuredAt || 0).getTime()
    )
    .map((record) => ({
      date: dateOnly(record.measuredAt),
      heightCm: record.heightCm,
      weightKg: record.weightKg
    }));
}

function buildPerformanceSeries(records) {
  const byEvent = {};
  for (const record of records) {
    if (!byEvent[record.eventCode]) {
      byEvent[record.eventCode] = [];
    }
    byEvent[record.eventCode].push({
      date: dateOnly(record.achievedAt),
      value: record.value,
      unit: record.unit,
      comparison: record.comparison
    });
  }
  for (const recordsForEvent of Object.values(byEvent)) {
    recordsForEvent.sort(
      (left, right) =>
        new Date(left.date || 0).getTime() - new Date(right.date || 0).getTime()
    );
  }
  return byEvent;
}

function buildPersonalBests(records) {
  const bestByEvent = new Map();
  for (const record of records) {
    const current = bestByEvent.get(record.eventCode);
    if (!current || isBetter(record, current, record.comparison)) {
      bestByEvent.set(record.eventCode, record);
    }
  }
  return Array.from(bestByEvent.values())
    .map((record) => ({
      eventCode: record.eventCode,
      eventName: record.eventName,
      value: record.value,
      unit: record.unit,
      comparison: record.comparison,
      date: dateOnly(record.achievedAt)
    }))
    .sort((left, right) => left.eventCode.localeCompare(right.eventCode));
}

function buildStageChanges(records) {
  const byEvent = new Map();
  for (const record of records) {
    if (!byEvent.has(record.eventCode)) {
      byEvent.set(record.eventCode, []);
    }
    byEvent.get(record.eventCode).push(record);
  }

  return Array.from(byEvent.entries()).map(([eventCode, eventRecords]) => {
    const sorted = [...eventRecords].sort(
      (left, right) =>
        new Date(left.achievedAt || 0).getTime() -
        new Date(right.achievedAt || 0).getTime()
    );
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    const rawChange = latest.value - first.value;
    const changePercent = first.value
      ? Number(((rawChange / Math.abs(first.value)) * 100).toFixed(2))
      : null;
    const improved =
      first.comparison === 'lower' ? rawChange < 0 : rawChange > 0;
    return {
      eventCode,
      eventName: latest.eventName,
      unit: latest.unit,
      comparison: latest.comparison,
      sampleCount: sorted.length,
      firstDate: dateOnly(first.achievedAt),
      latestDate: dateOnly(latest.achievedAt),
      firstValue: first.value,
      latestValue: latest.value,
      change: Number(rawChange.toFixed(3)),
      changePercent,
      improved
    };
  });
}

function buildTargetComparison(profile, records) {
  const goal = profile.examGoal || {};
  const eventCode = goal.targetEventCode || '';
  if (!eventCode || goal.targetValue === undefined || goal.targetValue === null) {
    return null;
  }
  const targetValue = Number(goal.targetValue);
  if (!Number.isFinite(targetValue)) {
    return null;
  }
  const event = getPerformanceEvent(eventCode);
  if (!event) {
    return null;
  }
  const eventRecords = records
    .filter((record) => record.eventCode === eventCode)
    .sort(
      (left, right) =>
        new Date(left.achievedAt || 0).getTime() -
        new Date(right.achievedAt || 0).getTime()
    );
  if (!eventRecords.length) {
    return {
      eventCode,
      eventName: event.name,
      unit: event.unit,
      comparison: event.comparison,
      targetValue,
      currentValue: null,
      difference: null,
      achieved: false,
      hasCurrentResult: false
    };
  }

  const latest = eventRecords[eventRecords.length - 1];
  const difference = Number((latest.value - targetValue).toFixed(3));
  const achieved =
    event.comparison === 'lower'
      ? latest.value <= targetValue
      : latest.value >= targetValue;

  return {
    eventCode,
    eventName: event.name,
    unit: event.unit,
    comparison: event.comparison,
    targetValue,
    currentValue: latest.value,
    currentDate: dateOnly(latest.achievedAt),
    difference,
    achieved,
    hasCurrentResult: true
  };
}

function buildAutomaticReport({ profile, measurements, performanceRecords }) {
  const approvedRecords = performanceRecords.filter(
    (record) => record.status === 'approved'
  );
  const measurementHistory = buildMeasurementSeries(measurements);
  const performanceHistory = buildPerformanceSeries(approvedRecords);
  const personalBests = buildPersonalBests(approvedRecords);
  const stageChanges = buildStageChanges(approvedRecords);
  const targetComparison = buildTargetComparison(profile, approvedRecords);
  const measurementSeries = measurementHistory.length > CHART_POINT_LIMIT
    ? measurementHistory.slice(measurementHistory.length - CHART_POINT_LIMIT)
    : measurementHistory;
  const performanceSeries = {};
  const truncatedEvents = [];
  for (const [eventCode, series] of Object.entries(performanceHistory)) {
    performanceSeries[eventCode] = series.length > CHART_POINT_LIMIT
      ? series.slice(series.length - CHART_POINT_LIMIT)
      : series;
    if (performanceSeries[eventCode].length < series.length) {
      truncatedEvents.push(eventCode);
    }
  }

  return {
    profile: {
      userId: profile.userId,
      name: profile.name,
      primaryEventCode: profile.primaryEventCode || '',
      primaryEventName: profile.primaryEventName || '',
      examGoal: profile.examGoal || {}
    },
    supportedEvents: listPerformanceEvents(),
    measurements: measurementSeries,
    measurementMeta: {
      total: measurementHistory.length,
      displayed: measurementSeries.length,
      chartPointLimit: CHART_POINT_LIMIT,
      truncated: measurementSeries.length < measurementHistory.length
    },
    performanceSeries,
    performanceMeta: {
      approvedTotal: approvedRecords.length,
      chartPointLimit: CHART_POINT_LIMIT,
      truncatedEvents
    },
    personalBests,
    stageChanges,
    targetComparison,
    dataQuality: {
      measurementCount: measurementHistory.length,
      approvedPerformanceCount: approvedRecords.length,
      pbComplete: true,
      hasHeightTrend: measurementHistory.filter((item) => item.heightCm).length >= 2,
      hasWeightTrend: measurementHistory.filter((item) => item.weightKg).length >= 2,
      hasPerformanceTrend: Object.values(performanceHistory).some(
        (items) => items.length >= 2
      )
    }
  };
}

module.exports = {
  CHART_POINT_LIMIT,
  buildAutomaticReport,
  buildMeasurementSeries,
  buildPerformanceSeries,
  buildPersonalBests,
  buildStageChanges,
  buildTargetComparison
};
