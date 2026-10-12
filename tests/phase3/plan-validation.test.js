'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addDays,
  clubDateOnly,
  endOfWeek,
  isDateOnly,
  startOfWeek
} = require('../../cloudfunctions/api/lib/dates');
const {
  PLAN_CATEGORIES,
  validatePlanCreatePayload,
  validatePlanUpdatePayload,
  validateStudentPlanQueryPayload
} = require('../../cloudfunctions/api/lib/validation');

function validItem(overrides = {}) {
  return {
    category: 'sprint',
    name: '30米加速跑',
    target: '提高起跑加速',
    sets: 6,
    reps: 1,
    distanceMeters: 30,
    restSeconds: 120,
    ...overrides
  };
}

test('club date helper handles the UTC+8 day boundary', () => {
  assert.equal(
    clubDateOnly(new Date('2026-01-01T15:59:59.000Z')),
    '2026-01-01'
  );
  assert.equal(
    clubDateOnly(new Date('2026-01-01T16:00:00.000Z')),
    '2026-01-02'
  );
});

test('week helpers use Monday through Sunday', () => {
  assert.equal(startOfWeek('2026-10-14'), '2026-10-12');
  assert.equal(endOfWeek('2026-10-14'), '2026-10-18');
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(isDateOnly('2026-02-30'), false);
  assert.equal(isDateOnly('2026-02-28'), true);
});

test('plan create payload normalizes items and optional fields', () => {
  const result = validatePlanCreatePayload({
    clientRequestId: 'req_001',
    trainingGroupId: 'group_a',
    title: ' Week 1 ',
    startDate: '2026-10-14',
    items: [
      validItem({ order: 2, name: ' 放松跑 ' }),
      validItem({ category: 'recovery', order: 1, name: '慢跑恢复', distanceMeters: 3000 })
    ]
  });

  assert.equal(result.title, 'Week 1');
  assert.equal(result.endDate, '2026-10-14');
  assert.deepEqual(
    result.items.map((item) => item.order),
    [1, 2]
  );
  assert.equal(result.items[1].name, '放松跑');
  assert.equal(result.items[0].category, 'recovery');
});

test('plan create payload rejects invalid training data', () => {
  assert.throws(
    () =>
      validatePlanCreatePayload({
        clientRequestId: 'req_002',
        trainingGroupId: 'group_a',
        title: '空计划',
        startDate: '2026-10-14',
        items: []
      }),
    /至少需要一项训练内容/
  );

  assert.throws(
    () =>
      validatePlanCreatePayload({
        clientRequestId: 'req_003',
        trainingGroupId: 'group_a',
        title: '重复顺序',
        startDate: '2026-10-14',
        items: [validItem({ order: 1 }), validItem({ order: 1 })]
      }),
    /训练顺序不能重复/
  );

  assert.throws(
    () =>
      validatePlanCreatePayload({
        clientRequestId: 'req_004',
        trainingGroupId: 'group_a',
        title: '非法分类',
        startDate: '2026-10-14',
        items: [validItem({ category: 'not_a_category' })]
      }),
    /训练分类不在支持列表中/
  );

  assert.throws(
    () =>
      validatePlanCreatePayload({
        clientRequestId: 'req_005',
        trainingGroupId: 'group_a',
        title: '日期错误',
        startDate: '2026-10-15',
        endDate: '2026-10-14',
        items: [validItem()]
      }),
    /结束日期不能早于开始日期/
  );
});

test('plan update requires a version and student scope is constrained', () => {
  assert.throws(
    () =>
      validatePlanUpdatePayload({
        planId: 'plan_1',
        title: '计划',
        startDate: '2026-10-14',
        items: [validItem()]
      }),
    /缺少计划版本/
  );

  assert.throws(
    () => validateStudentPlanQueryPayload({ scope: 'month' }),
    /查询范围不正确/
  );

  assert.equal(validateStudentPlanQueryPayload({}).scope, 'today');
  assert.ok(PLAN_CATEGORIES.includes('strength'));
});
