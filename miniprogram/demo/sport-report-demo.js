'use strict';

const DEMO_MARKER = 'DEMO｜虚构演示数据';
const DEMO_NOTICE = '仅用于界面预览，不代表真实训练成绩';

const SUPPORTED_EVENTS = Object.freeze([
  { code: '100m', name: '100米', unit: '秒', comparison: 'lower' },
  { code: '800m', name: '800米', unit: '秒', comparison: 'lower' },
  { code: 'long_jump', name: '跳远', unit: '米', comparison: 'higher' }
]);

const DEMO_PROFILE = Object.freeze({
  userId: 'demo_student_fictional',
  name: '演示学生（虚构）',
  primaryEventCode: '100m',
  primaryEventName: '100米',
  examGoal: Object.freeze({
    targetEventCode: '100m',
    targetEventName: '100米',
    targetValue: 11.5,
    targetUnit: '秒',
    targetComparison: 'lower',
    targetScore: '目标11.50秒',
    examYear: 2027,
    targetSchool: '示例体育院校',
    note: '虚构演示目标'
  })
});

const DEMO_MEASUREMENTS = Object.freeze([
  Object.freeze({ date: '2026-03-01', heightCm: 168.0, weightKg: 56.5 }),
  Object.freeze({ date: '2026-03-20', heightCm: 168.8, weightKg: 57.0 }),
  Object.freeze({ date: '2026-04-10', heightCm: 169.5, weightKg: 57.4 }),
  Object.freeze({ date: '2026-05-02', heightCm: 170.4, weightKg: 58.1 }),
  Object.freeze({ date: '2026-05-24', heightCm: 171.2, weightKg: 58.6 }),
  Object.freeze({ date: '2026-06-15', heightCm: 172.0, weightKg: 59.0 })
]);

const DEMO_PERFORMANCE = Object.freeze({
  '100m': Object.freeze([
    Object.freeze({ date: '2026-03-05', value: 12.5 }),
    Object.freeze({ date: '2026-04-02', value: 12.2 }),
    Object.freeze({ date: '2026-05-07', value: 11.95 }),
    Object.freeze({ date: '2026-06-11', value: 11.7 })
  ]),
  '800m': Object.freeze([
    Object.freeze({ date: '2026-03-12', value: 155 }),
    Object.freeze({ date: '2026-04-15', value: 148 }),
    Object.freeze({ date: '2026-05-20', value: 141 })
  ]),
  long_jump: Object.freeze([
    Object.freeze({ date: '2026-03-18', value: 5.1 }),
    Object.freeze({ date: '2026-04-22', value: 5.35 }),
    Object.freeze({ date: '2026-06-05', value: 5.6 })
  ])
});

function formatSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round((totalSeconds % 60) * 100) / 100;
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

function displayValueFor(eventCode, value) {
  return eventCode === '800m' ? formatSeconds(value) : String(value);
}

function getEvent(eventCode) {
  return SUPPORTED_EVENTS.find((event) => event.code === eventCode) || null;
}

function buildPerformanceSeries() {
  const result = {};
  for (const event of SUPPORTED_EVENTS) {
    const records = DEMO_PERFORMANCE[event.code] || [];
    result[event.code] = records.map((record) => ({
      date: record.date,
      value: record.value,
      unit: event.unit,
      comparison: event.comparison,
      displayValue: displayValueFor(event.code, record.value)
    }));
  }
  return result;
}

function buildPersonalBests() {
  return SUPPORTED_EVENTS.map((event) => {
    const records = DEMO_PERFORMANCE[event.code] || [];
    const best = records.reduce((current, record) => {
      if (!current) {
        return record;
      }
      return event.comparison === 'lower'
        ? record.value < current.value
          ? record
          : current
        : record.value > current.value
          ? record
          : current;
    }, null);
    return {
      eventCode: event.code,
      eventName: event.name,
      value: best.value,
      unit: event.unit,
      comparison: event.comparison,
      date: best.date,
      displayValue: displayValueFor(event.code, best.value)
    };
  });
}

function buildStageChanges() {
  return SUPPORTED_EVENTS.map((event) => {
    const records = (DEMO_PERFORMANCE[event.code] || [])
      .slice()
      .sort((left, right) => left.date.localeCompare(right.date));
    const first = records[0];
    const latest = records[records.length - 1];
    const rawChange = Number((latest.value - first.value).toFixed(3));
    const changePercent = Number(
      ((rawChange / Math.abs(first.value)) * 100).toFixed(2)
    );
    return {
      eventCode: event.code,
      eventName: event.name,
      unit: event.unit,
      comparison: event.comparison,
      sampleCount: records.length,
      firstDate: first.date,
      latestDate: latest.date,
      firstValue: first.value,
      latestValue: latest.value,
      change: rawChange,
      changePercent,
      improved:
        event.comparison === 'lower' ? rawChange < 0 : rawChange > 0,
      firstDisplayValue: displayValueFor(event.code, first.value),
      latestDisplayValue: displayValueFor(event.code, latest.value),
      changeDisplayValue: `${rawChange < 0 ? '-' : '+'}${Math.abs(rawChange)} ${event.unit}`
    };
  });
}

function buildTargetComparison() {
  const goal = DEMO_PROFILE.examGoal;
  const event = getEvent(goal.targetEventCode);
  const records = DEMO_PERFORMANCE[goal.targetEventCode] || [];
  const latest = records[records.length - 1];
  const difference = Number((latest.value - goal.targetValue).toFixed(3));
  return {
    eventCode: goal.targetEventCode,
    eventName: goal.targetEventName,
    unit: goal.targetUnit,
    comparison: goal.targetComparison,
    targetValue: goal.targetValue,
    targetDisplayValue: displayValueFor(goal.targetEventCode, goal.targetValue),
    currentValue: latest.value,
    currentDisplayValue: displayValueFor(goal.targetEventCode, latest.value),
    currentDate: latest.date,
    difference,
    differenceDisplayValue: displayValueFor(
      goal.targetEventCode,
      Math.abs(difference)
    ),
    achieved: event.comparison === 'lower'
      ? latest.value <= goal.targetValue
      : latest.value >= goal.targetValue,
    hasCurrentResult: true
  };
}

function buildDemoReport() {
  const performanceSeries = buildPerformanceSeries();
  const approvedPerformanceCount = SUPPORTED_EVENTS.reduce(
    (total, event) => total + (DEMO_PERFORMANCE[event.code] || []).length,
    0
  );

  return {
    demo: {
      isDemo: true,
      marker: DEMO_MARKER,
      notice: DEMO_NOTICE
    },
    profile: DEMO_PROFILE,
    supportedEvents: SUPPORTED_EVENTS.map((event) => ({ ...event })),
    measurements: DEMO_MEASUREMENTS.map((item) => ({ ...item })),
    measurementMeta: {
      total: DEMO_MEASUREMENTS.length,
      displayed: DEMO_MEASUREMENTS.length,
      chartPointLimit: 120,
      truncated: false
    },
    performanceSeries,
    performanceMeta: {
      approvedTotal: approvedPerformanceCount,
      chartPointLimit: 120,
      truncatedEvents: []
    },
    personalBests: buildPersonalBests(),
    stageChanges: buildStageChanges(),
    targetComparison: buildTargetComparison(),
    dataQuality: {
      measurementCount: DEMO_MEASUREMENTS.length,
      approvedPerformanceCount,
      pbComplete: true,
      hasHeightTrend: DEMO_MEASUREMENTS.length >= 2,
      hasWeightTrend: DEMO_MEASUREMENTS.length >= 2,
      hasPerformanceTrend: true
    }
  };
}

module.exports = {
  DEMO_MARKER,
  DEMO_NOTICE,
  SUPPORTED_EVENTS,
  buildDemoReport,
  displayValueFor
};
