'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createStatisticsActions = require('../../cloudfunctions/api/actions/statistics');
const { clubDateOnly } = require('../../cloudfunctions/api/lib/dates');
const {
  COACH_A,
  COACH_B,
  GROUP_A,
  GROUP_B,
  IDENTITIES,
  STUDENT_A,
  captureError,
  createHarness
} = require('./helpers');

function currentPayload(extra = {}) {
  const today = clubDateOnly();
  return {
    periodType: 'month',
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    ...extra
  };
}

function replaceCoachMemberships(harness, records) {
  const students = harness.state.memberships.filter(
    (membership) => membership.roleInGroup === 'student'
  );
  harness.state.memberships.length = 0;
  harness.state.memberships.push(...students, ...records);
}

function coachMembership({
  id,
  userId,
  groupId,
  status = 'active'
}) {
  return {
    _id: id,
    userId,
    groupId,
    roleInGroup: 'coach',
    status,
    assignedAt: new Date('2026-01-01T00:00:00.000Z')
  };
}

function performance(id, studentUserId, value, achievedAt) {
  return {
    _id: id,
    performanceId: id,
    studentUserId,
    eventCode: '100m',
    eventName: '100米',
    value,
    unit: '秒',
    comparison: 'lower',
    achievedAt,
    status: 'approved',
    reviewedAt: new Date(`${achievedAt}T00:00:00.000Z`),
    source: 'student_report'
  };
}

test('BUG-F03 单一有效教练来自 group_memberships，不读取旧 coachUserIds', async () => {
  const harness = createHarness();
  replaceCoachMemberships(harness, [
    coachMembership({
      id: 'coach_a_group_a',
      userId: COACH_A._id,
      groupId: GROUP_A
    })
  ]);
  harness.state.groups.get(GROUP_A).coachUserIds = ['historical_invalid_coach'];

  const actions = createStatisticsActions({ repository: harness.repository });
  const meta = await actions['statistics.get_meta']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  const groupA = meta.groups.find((group) => group.id === GROUP_A);
  assert.deepEqual(groupA.coachNames, ['教练甲']);

  const overview = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(overview.scope.coachCount, 1);
});

test('BUG-F03 同一训练组多名有效教练全部显示且稳定排序', async () => {
  const harness = createHarness();
  replaceCoachMemberships(harness, [
    coachMembership({
      id: 'coach_b_group_a',
      userId: COACH_B._id,
      groupId: GROUP_A
    }),
    coachMembership({
      id: 'coach_a_group_a',
      userId: COACH_A._id,
      groupId: GROUP_A
    })
  ]);

  const actions = createStatisticsActions({ repository: harness.repository });
  const first = await actions['statistics.get_meta']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  const second = await actions['statistics.get_meta']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  const firstNames = first.groups.find((group) => group.id === GROUP_A).coachNames;
  const secondNames = second.groups.find((group) => group.id === GROUP_A).coachNames;

  assert.deepEqual(firstNames, ['教练甲', '教练乙']);
  assert.deepEqual(secondNames, firstNames, '相同数据重复请求应保持稳定顺序');

  const overview = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(overview.scope.coachCount, 2);
});

test('BUG-F03 同一教练跨多个训练组时 coachCount 按用户去重', async () => {
  const harness = createHarness();
  replaceCoachMemberships(harness, [
    coachMembership({
      id: 'coach_a_group_a',
      userId: COACH_A._id,
      groupId: GROUP_A
    }),
    coachMembership({
      id: 'coach_a_group_b',
      userId: COACH_A._id,
      groupId: GROUP_B
    })
  ]);

  const actions = createStatisticsActions({ repository: harness.repository });
  const overview = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.developer,
    payload: currentPayload()
  });
  assert.equal(overview.scope.coachCount, 1);

  const meta = await actions['statistics.get_meta']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  assert.deepEqual(
    meta.groups.find((group) => group.id === GROUP_A).coachNames,
    ['教练甲']
  );
  assert.deepEqual(
    meta.groups.find((group) => group.id === GROUP_B).coachNames,
    ['教练甲']
  );
});

test('BUG-F03 已撤权教练不再计入，学生成员关系不计入教练人数', async () => {
  const harness = createHarness();
  replaceCoachMemberships(harness, [
    coachMembership({
      id: 'coach_a_inactive',
      userId: COACH_A._id,
      groupId: GROUP_A,
      status: 'inactive'
    }),
    coachMembership({
      id: 'coach_b_active',
      userId: COACH_B._id,
      groupId: GROUP_A
    })
  ]);

  const actions = createStatisticsActions({ repository: harness.repository });
  const overview = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(overview.scope.coachCount, 1, '学生成员关系和撤权教练都不得计入');

  const meta = await actions['statistics.get_meta']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  assert.deepEqual(
    meta.groups.find((group) => group.id === GROUP_A).coachNames,
    ['教练乙']
  );
});

test('BUG-F03 缺失、停用或非教练用户不进入负责教练统计', async () => {
  const harness = createHarness();
  replaceCoachMemberships(harness, [
    coachMembership({
      id: 'missing_user',
      userId: 'missing_coach',
      groupId: GROUP_A
    }),
    coachMembership({
      id: 'disabled_user',
      userId: COACH_B._id,
      groupId: GROUP_A
    }),
    coachMembership({
      id: 'non_coach_user',
      userId: 'non_coach_user',
      groupId: GROUP_A
    })
  ]);
  harness.state.usersByOpenId.set(IDENTITIES.coachB.openid, {
    ...COACH_B,
    roles: [...COACH_B.roles],
    status: 'disabled'
  });
  harness.state.usersByOpenId.set('openid_non_coach', {
    _id: 'non_coach_user',
    status: 'active',
    roles: ['student'],
    displayName: '学生账号'
  });

  const actions = createStatisticsActions({ repository: harness.repository });
  const overview = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(overview.scope.coachCount, 0);

  const meta = await actions['statistics.get_meta']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  assert.deepEqual(
    meta.groups.find((group) => group.id === GROUP_A).coachNames,
    []
  );
});

test('BUG-F03 教练成员超过安全读取上限时拒绝返回部分统计', async () => {
  const harness = createHarness();
  const records = Array.from({ length: 5001 }, (_, index) =>
    coachMembership({
      id: `coach_cap_${index}`,
      userId: `coach_cap_user_${index}`,
      groupId: GROUP_A
    })
  );
  replaceCoachMemberships(harness, records);

  const actions = createStatisticsActions({ repository: harness.repository });
  const error = await captureError(
    actions['statistics.get_manage_overview']({
      identity: IDENTITIES.developer,
      payload: currentPayload({ trainingGroupId: GROUP_A })
    })
  );
  assert.equal(error.code, 'STATISTICS_INCOMPLETE');
});

test('BUG-F03 重复成员记录不会重复计数或重复姓名', async () => {
  const harness = createHarness();
  replaceCoachMemberships(harness, [
    coachMembership({
      id: 'coach_a_group_a_1',
      userId: COACH_A._id,
      groupId: GROUP_A
    }),
    coachMembership({
      id: 'coach_a_group_a_2',
      userId: COACH_A._id,
      groupId: GROUP_A
    })
  ]);

  const actions = createStatisticsActions({ repository: harness.repository });
  const overview = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(overview.scope.coachCount, 1);

  const meta = await actions['statistics.get_meta']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  assert.deepEqual(
    meta.groups.find((group) => group.id === GROUP_A).coachNames,
    ['教练甲']
  );
});

test('BUG-F03 成绩 XLSX 负责教练列使用有效成员关系和真实姓名', async () => {
  const harness = createHarness();
  replaceCoachMemberships(harness, [
    coachMembership({
      id: 'coach_a_group_a',
      userId: COACH_A._id,
      groupId: GROUP_A
    }),
    coachMembership({
      id: 'coach_b_group_a',
      userId: COACH_B._id,
      groupId: GROUP_A
    })
  ]);
  const today = clubDateOnly();
  harness.state.performances.push(
    performance('export_coach_names', STUDENT_A._id, 12.1, today)
  );

  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['export.performance_rows']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ trainingGroupId: GROUP_A, maxRows: 10 })
  });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].coachNames, ['教练甲', '教练乙']);
});

test('BUG-F03 coach 与 developer 原有统计范围保持不变', async () => {
  const harness = createHarness();
  replaceCoachMemberships(harness, [
    coachMembership({
      id: 'coach_a_group_a',
      userId: COACH_A._id,
      groupId: GROUP_A
    }),
    coachMembership({
      id: 'coach_b_group_b',
      userId: COACH_B._id,
      groupId: GROUP_B
    })
  ]);

  const actions = createStatisticsActions({ repository: harness.repository });
  const denied = await captureError(
    actions['statistics.get_manage_overview']({
      identity: IDENTITIES.coachA,
      payload: currentPayload({ trainingGroupId: GROUP_B })
    })
  );
  assert.equal(denied.code, 'OUT_OF_SCOPE');

  const developer = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.developer,
    payload: currentPayload()
  });
  assert.equal(developer.scope.coachCount, 2);
});

test('BUG-F03 无有效教练时返回空姓名和零计数', async () => {
  const harness = createHarness();
  replaceCoachMemberships(harness, []);

  const actions = createStatisticsActions({ repository: harness.repository });
  const overview = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(overview.scope.coachCount, 0);

  const meta = await actions['statistics.get_meta']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  assert.deepEqual(
    meta.groups.find((group) => group.id === GROUP_A).coachNames,
    []
  );
});
