'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateMeasurementPayload,
  validatePerformanceReviewPayload,
  validatePerformanceSubmissionPayload,
  validateStudentProfileUpdatePayload
} = require('../../cloudfunctions/api/lib/validation');

test('extended student profile accepts supported primary and secondary events', () => {
  const result = validateStudentProfileUpdatePayload({
    primaryEventCode: '100m',
    secondaryEventCodes: ['long_jump', 'shot_put'],
    trainingStartYear: 2022,
    trainingExperienceSummary: '校内训练三年',
    examGoal: {
      targetScore: '100米 12秒',
      examYear: 2027,
      targetSchool: '模拟体育院校',
      note: '保持每周训练'
    }
  });

  assert.equal(result.primaryEventName, '100米');
  assert.deepEqual(result.secondaryEventCodes, ['long_jump', 'shot_put']);
  assert.equal(result.examGoal.examYear, 2027);
});

test('extended profile rejects duplicate primary/secondary and unsupported events', () => {
  assert.throws(
    () =>
      validateStudentProfileUpdatePayload({
        primaryEventCode: '100m',
        secondaryEventCodes: ['100m']
      }),
    /副项不能与主项重复/
  );
  assert.throws(
    () =>
      validateStudentProfileUpdatePayload({
        primaryEventCode: 'unknown'
      }),
    /主项不在支持的项目列表中/
  );
});


test('structured exam target is numeric and bound to a supported event', () => {
  const result = validateStudentProfileUpdatePayload({
    primaryEventCode: '100m',
    examGoal: {
      targetEventCode: '100m',
      targetValue: 12.5,
      targetScore: '目标12.5秒'
    }
  });
  assert.equal(result.examGoal.targetEventCode, '100m');
  assert.equal(result.examGoal.targetValue, 12.5);
  assert.equal(result.examGoal.targetUnit, '秒');
  assert.throws(
    () =>
      validateStudentProfileUpdatePayload({
        examGoal: { targetValue: 12.5 }
      }),
    /填写体考目标值前请选择体考目标项目/
  );
});
test('measurement and performance payloads validate dates, units and ranges', () => {
  assert.deepEqual(
    validateMeasurementPayload({
      heightCm: 170,
      weightKg: 60,
      measuredAt: '2026-10-01'
    }),
    { heightCm: 170, weightKg: 60, measuredAt: '2026-10-01' }
  );

  const sprint = validatePerformanceSubmissionPayload({
    eventCode: '100m',
    value: 12.5,
    achievedAt: '2026-10-01',
    note: '模拟测试'
  });
  assert.equal(sprint.comparison, 'lower');
  assert.equal(sprint.unit, '秒');

  assert.throws(
    () =>
      validatePerformanceSubmissionPayload({
        eventCode: '100m',
        value: 2,
        achievedAt: '2026-10-01'
      }),
    /成绩应在/
  );
});

test('performance review accepts only approve or reject', () => {
  assert.deepEqual(
    validatePerformanceReviewPayload({
      performanceId: 'perf_test_1',
      decision: 'approve',
      comment: '模拟审核通过'
    }),
    {
      performanceId: 'perf_test_1',
      decision: 'approve',
      comment: '模拟审核通过'
    }
  );

  assert.throws(
    () =>
      validatePerformanceReviewPayload({
        performanceId: 'perf_test_1',
        decision: 'approve_all'
      }),
    /审核结果不正确/
  );
});
