'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAutomaticReport,
  buildPersonalBests,
  buildStageChanges,
  buildTargetComparison
} = require('../../cloudfunctions/api/lib/report-builder');

const APPROVED_100M = [
  {
    _id: 'perf_1',
    eventCode: '100m',
    eventName: '100米',
    value: 13.2,
    unit: '秒',
    comparison: 'lower',
    achievedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'approved'
  },
  {
    _id: 'perf_2',
    eventCode: '100m',
    eventName: '100米',
    value: 12.8,
    unit: '秒',
    comparison: 'lower',
    achievedAt: new Date('2026-02-01T00:00:00.000Z'),
    status: 'approved'
  }
];

test('report builder excludes pending and rejected records from formal series', () => {
  const report = buildAutomaticReport({
    profile: {
      userId: 'usr_student',
      name: '模拟学生',
      examGoal: {}
    },
    measurements: [],
    performanceRecords: [
      ...APPROVED_100M,
      {
        _id: 'perf_pending',
        eventCode: '100m',
        eventName: '100米',
        value: 11.9,
        unit: '秒',
        comparison: 'lower',
        achievedAt: new Date('2026-03-01T00:00:00.000Z'),
        status: 'pending'
      },
      {
        _id: 'perf_rejected',
        eventCode: '100m',
        eventName: '100米',
        value: 11.8,
        unit: '秒',
        comparison: 'lower',
        achievedAt: new Date('2026-04-01T00:00:00.000Z'),
        status: 'rejected'
      }
    ]
  });

  assert.equal(report.dataQuality.approvedPerformanceCount, 2);
  assert.deepEqual(
    report.performanceSeries['100m'].map((item) => item.value),
    [13.2, 12.8]
  );
  assert.equal(report.personalBests[0].value, 12.8);
});

test('personal best and stage change follow each event comparison direction', () => {
  const records = [
    ...APPROVED_100M,
    {
      eventCode: 'long_jump',
      eventName: '跳远',
      value: 5.1,
      unit: '米',
      comparison: 'higher',
      achievedAt: new Date('2026-01-01T00:00:00.000Z'),
      status: 'approved'
    },
    {
      eventCode: 'long_jump',
      eventName: '跳远',
      value: 5.6,
      unit: '米',
      comparison: 'higher',
      achievedAt: new Date('2026-02-01T00:00:00.000Z'),
      status: 'approved'
    }
  ];

  const bests = buildPersonalBests(records);
  const changes = buildStageChanges(records);
  assert.equal(bests.find((item) => item.eventCode === '100m').value, 12.8);
  assert.equal(bests.find((item) => item.eventCode === 'long_jump').value, 5.6);
  assert.equal(changes.find((item) => item.eventCode === '100m').improved, true);
  assert.equal(
    changes.find((item) => item.eventCode === 'long_jump').improved,
    true
  );
});

test('target comparison is numeric only when a structured target exists', () => {
  const lower = buildTargetComparison(
    {
      examGoal: {
        targetEventCode: '100m',
        targetValue: 12.5
      }
    },
    APPROVED_100M
  );
  assert.equal(lower.targetValue, 12.5);
  assert.equal(lower.currentValue, 12.8);
  assert.equal(lower.achieved, false);
  assert.equal(lower.difference, 0.3);

  const noStructuredTarget = buildTargetComparison(
    { examGoal: { targetScore: '达成12秒' } },
    APPROVED_100M
  );
  assert.equal(noStructuredTarget, null);
});

test('report data quality does not claim a trend with fewer than two points', () => {
  const report = buildAutomaticReport({
    profile: { userId: 'usr_student', name: '模拟学生', examGoal: {} },
    measurements: [
      {
        heightCm: 170,
        weightKg: 60,
        measuredAt: new Date('2026-01-01T00:00:00.000Z')
      }
    ],
    performanceRecords: APPROVED_100M.slice(0, 1)
  });

  assert.equal(report.dataQuality.hasHeightTrend, false);
  assert.equal(report.dataQuality.hasWeightTrend, false);
  assert.equal(report.dataQuality.hasPerformanceTrend, false);
});

test('personal best stays correct across a large mixed history', () => {
  const records = [];
  for (let index = 0; index < 250; index += 1) {
    records.push({
      eventCode: '100m',
      eventName: '100m',
      value: Number((20 - index * 0.01).toFixed(2)),
      unit: 's',
      comparison: 'lower',
      achievedAt: new Date(2026, 0, 1 + index),
      status: 'approved'
    });
    records.push({
      eventCode: 'long_jump',
      eventName: 'long jump',
      value: Number((1 + index * 0.01).toFixed(2)),
      unit: 'm',
      comparison: 'higher',
      achievedAt: new Date(2026, 0, 1 + index),
      status: 'approved'
    });
  }

  const bests = buildPersonalBests(records);
  assert.equal(bests.find((item) => item.eventCode === '100m').value, 17.51);
  assert.equal(bests.find((item) => item.eventCode === 'long_jump').value, 3.49);
});
