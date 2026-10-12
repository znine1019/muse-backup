'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createPlanActions = require('../../cloudfunctions/api/actions/plans');
const { deterministicId } = require('../../cloudfunctions/api/lib/repository');

const GROUP_A = 'group_a';
const GROUP_B = 'group_b';
const COACH_A = { _id: 'usr_coach_a', status: 'active', roles: ['coach'] };
const COACH_B = { _id: 'usr_coach_b', status: 'active', roles: ['coach'] };
const DISABLED_COACH = {
  _id: 'usr_coach_disabled',
  status: 'disabled',
  roles: ['coach']
};
const DEVELOPER = {
  _id: 'usr_developer',
  status: 'active',
  roles: ['developer']
};
const STUDENT_A = { _id: 'usr_student_a', status: 'active', roles: ['student'] };
const STUDENT_B = { _id: 'usr_student_b', status: 'active', roles: ['student'] };
const IDENTITIES = {
  coachA: { appid: 'wx_test', openid: 'openid_coach_a' },
  coachB: { appid: 'wx_test', openid: 'openid_coach_b' },
  disabledCoach: { appid: 'wx_test', openid: 'openid_coach_disabled' },
  developer: { appid: 'wx_test', openid: 'openid_developer' },
  studentA: { appid: 'wx_test', openid: 'openid_student_a' },
  studentB: { appid: 'wx_test', openid: 'openid_student_b' }
};

function clone(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)])
    );
  }
  return value;
}

function planItems() {
  return [
    {
      order: 1,
      category: 'sprint',
      name: '30米加速跑',
      eventCode: '100m',
      eventName: '100米',
      target: '起跑加速',
      sets: 6,
      reps: 1,
      distanceMeters: 30,
      restSeconds: 120,
      notes: '保持放松'
    },
    {
      order: 2,
      category: 'recovery',
      name: '慢跑恢复',
      distanceMeters: 2000,
      notes: ''
    }
  ];
}

function createPayload(requestId, trainingGroupId = GROUP_A) {
  return {
    clientRequestId: requestId,
    trainingGroupId,
    title: '第1周速度训练',
    startDate: '2026-10-14',
    endDate: '2026-10-16',
    notes: '训练前充分热身',
    items: planItems()
  };
}

function createHarness() {
  const state = {
    usersByOpenId: new Map([
      [IDENTITIES.coachA.openid, COACH_A],
      [IDENTITIES.coachB.openid, COACH_B],
      [IDENTITIES.disabledCoach.openid, DISABLED_COACH],
      [IDENTITIES.developer.openid, DEVELOPER],
      [IDENTITIES.studentA.openid, STUDENT_A],
      [IDENTITIES.studentB.openid, STUDENT_B]
    ]),
    groups: new Map([
      [
        GROUP_A,
        {
          _id: GROUP_A,
          groupId: GROUP_A,
          name: '短跑组',
          seasonLabel: '2026',
          enabled: true
        }
      ],
      [
        GROUP_B,
        {
          _id: GROUP_B,
          groupId: GROUP_B,
          name: '跳远组',
          seasonLabel: '2026',
          enabled: true
        }
      ]
    ]),
    coachGroups: {
      [COACH_A._id]: [GROUP_A],
      [COACH_B._id]: [GROUP_B]
    },
    studentGroups: {
      [STUDENT_A._id]: [GROUP_A],
      [STUDENT_B._id]: [GROUP_B]
    },
    plans: new Map(),
    audits: new Map()
  };
  let transactionQueue = Promise.resolve();

  function collectionState(name) {
    if (name === 'training_plans') {
      return state.plans;
    }
    if (name === 'audit_logs') {
      return state.audits;
    }
    throw new Error(`Unexpected collection: ${name}`);
  }

  function createReference(name, id) {
    const collection = collectionState(name);
    return {
      async get() {
        if (!collection.has(id)) {
          throw new Error('document not found');
        }
        return { data: clone(collection.get(id)) };
      },
      async set({ data }) {
        collection.set(id, { _id: id, ...clone(data) });
      },
      async update({ data }) {
        const current = collection.get(id);
        if (!current) {
          throw new Error('document not found');
        }
        collection.set(id, { ...current, ...clone(data) });
      }
    };
  }

  const repository = {
    ensureUser: async (identity) => {
      const user = state.usersByOpenId.get(identity.openid);
      if (!user) {
        throw new Error('unknown identity');
      }
      return clone(user);
    },
    getTrainingGroup: async (groupId) =>
      state.groups.has(groupId) ? clone(state.groups.get(groupId)) : null,
    getCoachGroupIds: async (userId) => state.coachGroups[userId] || [],
    getStudentGroupIds: async (userId) => state.studentGroups[userId] || [],
    getGroupsMap: async (groupIds) =>
      new Map(
        groupIds
          .filter((groupId) => state.groups.has(groupId))
          .map((groupId) => [groupId, clone(state.groups.get(groupId))])
      ),
    getTrainingPlan: async (planId) =>
      state.plans.has(planId) ? clone(state.plans.get(planId)) : null,
    listTrainingPlans: async (options = {}) => {
      let records = Array.from(state.plans.values());
      if (Array.isArray(options.groupIds)) {
        records = records.filter((plan) =>
          options.groupIds.includes(plan.trainingGroupId)
        );
      }
      if (Array.isArray(options.statuses)) {
        records = records.filter((plan) => options.statuses.includes(plan.status));
      }
      if (options.fromDate) {
        records = records.filter((plan) => plan.endDate >= options.fromDate);
      }
      if (options.toDate) {
        records = records.filter((plan) => plan.startDate <= options.toDate);
      }
      const direction = options.orderDirection === 'desc' ? -1 : 1;
      records.sort((left, right) => {
        if (left.startDate !== right.startDate) {
          return direction * left.startDate.localeCompare(right.startDate);
        }
        return left._id.localeCompare(right._id);
      });
      return {
        records: clone(records),
        total: records.length,
        incomplete: false
      };
    },
    planIdForRequest: (actorUserId, clientRequestId) =>
      deterministicId('plan', actorUserId, clientRequestId),
    copyPlanIdForRequest: (actorUserId, sourcePlanId, clientRequestId) =>
      deterministicId('plan_copy', actorUserId, sourcePlanId, clientRequestId),
    db: {
      serverDate: () => new Date(),
      runTransaction(work) {
        const run = transactionQueue.then(() =>
          work({
            collection(name) {
              return {
                doc(id) {
                  return createReference(name, id);
                }
              };
            }
          })
        );
        transactionQueue = run.catch(() => {});
        return run;
      }
    }
  };

  return { repository, state };
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to be rejected');
}

function auditActions(state) {
  return Array.from(state.audits.values()).map((entry) => entry.action);
}

test('coach creates a draft plan with ordered items and audit', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });

  const result = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload: createPayload('req_001')
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.plan.status, 'draft');
  assert.equal(result.plan.trainingGroupId, GROUP_A);
  assert.deepEqual(
    result.plan.items.map((item) => item.order),
    [1, 2]
  );
  assert.equal(harness.state.plans.size, 1);
  assert.deepEqual(auditActions(harness.state), [
    'coach.training_plan.created'
  ]);
});

test('duplicate plan creation is idempotent', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });
  const payload = createPayload('req_dup');

  const first = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload
  });
  const second = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.plan.planId, first.plan.planId);
  assert.equal(harness.state.plans.size, 1);
  assert.equal(harness.state.audits.size, 1);
});

test('draft can be published and becomes visible to the group student', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });
  const created = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload: createPayload('req_publish')
  });

  const published = await actions['plan.publish']({
    identity: IDENTITIES.coachA,
    payload: { planId: created.plan.planId, expectedVersion: 1 }
  });
  assert.equal(published.plan.status, 'published');
  assert.equal(published.plan.version, 2);

  const studentResult = await actions['plan.list_student']({
    identity: IDENTITIES.studentA,
    payload: { scope: 'today', date: '2026-10-14' }
  });
  assert.equal(studentResult.plans.length, 1);
  assert.equal(studentResult.plans[0].planId, created.plan.planId);

  const detail = await actions['plan.get_student']({
    identity: IDENTITIES.studentA,
    payload: { planId: created.plan.planId }
  });
  assert.equal(detail.plan.items.length, 2);
});

test('student cannot see drafts or other groups published plans', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });
  const created = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload: createPayload('req_hidden')
  });

  const draftResult = await actions['plan.list_student']({
    identity: IDENTITIES.studentA,
    payload: { scope: 'today', date: '2026-10-14' }
  });
  assert.equal(draftResult.plans.length, 0);

  await actions['plan.publish']({
    identity: IDENTITIES.coachA,
    payload: { planId: created.plan.planId, expectedVersion: 1 }
  });

  const otherStudent = await actions['plan.list_student']({
    identity: IDENTITIES.studentB,
    payload: { scope: 'today', date: '2026-10-14' }
  });
  assert.equal(otherStudent.plans.length, 0);

  const error = await captureError(
    actions['plan.get_student']({
      identity: IDENTITIES.studentB,
      payload: { planId: created.plan.planId }
    })
  );
  assert.equal(error.code, 'OUT_OF_SCOPE');
});

test('student week query returns overlapping published plans only', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });
  const created = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload: createPayload('req_week')
  });
  await actions['plan.publish']({
    identity: IDENTITIES.coachA,
    payload: { planId: created.plan.planId, expectedVersion: 1 }
  });

  const week = await actions['plan.list_student']({
    identity: IDENTITIES.studentA,
    payload: { scope: 'week', date: '2026-10-14' }
  });
  assert.equal(week.plans.length, 1);

  const laterWeek = await actions['plan.list_student']({
    identity: IDENTITIES.studentA,
    payload: { scope: 'week', date: '2026-11-01' }
  });
  assert.equal(laterWeek.plans.length, 0);
});

test('coach cannot create or manage plans outside assigned groups', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });

  const error = await captureError(
    actions['plan.create']({
      identity: IDENTITIES.coachB,
      payload: createPayload('req_cross', GROUP_A)
    })
  );
  assert.equal(error.code, 'OUT_OF_SCOPE');
  assert.equal(harness.state.plans.size, 0);
});

test('developer can manage plans for any enabled group', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });

  const result = await actions['plan.create']({
    identity: IDENTITIES.developer,
    payload: createPayload('req_dev', GROUP_B)
  });
  assert.equal(result.plan.trainingGroupId, GROUP_B);
});

test('disabled account is rejected before plan access', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });

  const error = await captureError(
    actions['plan.list_manage']({
      identity: IDENTITIES.disabledCoach,
      payload: {}
    })
  );
  assert.equal(error.code, 'ACCOUNT_DISABLED');
});

test('disabled group blocks create and publish', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });
  const created = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload: createPayload('req_disabled')
  });

  harness.state.groups.get(GROUP_A).enabled = false;

  const createError = await captureError(
    actions['plan.create']({
      identity: IDENTITIES.coachA,
      payload: createPayload('req_disabled_2')
    })
  );
  assert.equal(createError.code, 'TRAINING_GROUP_DISABLED');

  const publishError = await captureError(
    actions['plan.publish']({
      identity: IDENTITIES.coachA,
      payload: { planId: created.plan.planId, expectedVersion: 1 }
    })
  );
  assert.equal(publishError.code, 'TRAINING_GROUP_DISABLED');
});

test('plan edit bumps the version and stale edits are rejected', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });
  const created = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload: createPayload('req_edit')
  });

  const updated = await actions['plan.update']({
    identity: IDENTITIES.coachA,
    payload: {
      planId: created.plan.planId,
      expectedVersion: 1,
      title: '第1周速度训练（调整）',
      startDate: '2026-10-14',
      endDate: '2026-10-17',
      notes: '增加恢复',
      items: planItems()
    }
  });
  assert.equal(updated.plan.version, 2);
  assert.equal(updated.plan.title, '第1周速度训练（调整）');

  const staleError = await captureError(
    actions['plan.update']({
      identity: IDENTITIES.coachA,
      payload: {
        planId: created.plan.planId,
        expectedVersion: 1,
        title: '过期编辑',
        startDate: '2026-10-14',
        endDate: '2026-10-17',
        items: planItems()
      }
    })
  );
  assert.equal(staleError.code, 'PLAN_VERSION_CONFLICT');
});

test('archiving keeps history and hides the plan from students', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });
  const created = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload: createPayload('req_archive')
  });
  await actions['plan.publish']({
    identity: IDENTITIES.coachA,
    payload: { planId: created.plan.planId, expectedVersion: 1 }
  });
  const archived = await actions['plan.archive']({
    identity: IDENTITIES.coachA,
    payload: { planId: created.plan.planId, expectedVersion: 2 }
  });

  assert.equal(archived.plan.status, 'archived');
  assert.ok(harness.state.plans.has(created.plan.planId));
  assert.ok(auditActions(harness.state).includes('coach.training_plan.archived'));

  const studentResult = await actions['plan.list_student']({
    identity: IDENTITIES.studentA,
    payload: { scope: 'history', date: '2026-10-20' }
  });
  assert.equal(studentResult.plans.length, 0);
});

test('copy creates a new draft without modifying the source plan', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });
  const created = await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload: createPayload('req_source')
  });
  await actions['plan.publish']({
    identity: IDENTITIES.coachA,
    payload: { planId: created.plan.planId, expectedVersion: 1 }
  });

  const copied = await actions['plan.copy']({
    identity: IDENTITIES.coachA,
    payload: {
      sourcePlanId: created.plan.planId,
      clientRequestId: 'req_copy',
      startDate: '2026-10-21',
      endDate: '2026-10-23'
    }
  });

  assert.equal(copied.duplicate, false);
  assert.equal(copied.plan.status, 'draft');
  assert.equal(copied.plan.copiedFromPlanId, created.plan.planId);
  assert.equal(copied.plan.version, 1);
  assert.equal(copied.plan.startDate, '2026-10-21');
  assert.equal(
    harness.state.plans.get(created.plan.planId).status,
    'published'
  );

  const duplicateCopy = await actions['plan.copy']({
    identity: IDENTITIES.coachA,
    payload: {
      sourcePlanId: created.plan.planId,
      clientRequestId: 'req_copy',
      startDate: '2026-10-21',
      endDate: '2026-10-23'
    }
  });
  assert.equal(duplicateCopy.duplicate, true);
});

test('coach manage list only returns assigned groups', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });
  await actions['plan.create']({
    identity: IDENTITIES.coachA,
    payload: createPayload('req_a', GROUP_A)
  });
  await actions['plan.create']({
    identity: IDENTITIES.coachB,
    payload: createPayload('req_b', GROUP_B)
  });

  const coachAList = await actions['plan.list_manage']({
    identity: IDENTITIES.coachA,
    payload: {}
  });
  assert.equal(coachAList.plans.length, 1);
  assert.equal(coachAList.plans[0].trainingGroupId, GROUP_A);

  const developerList = await actions['plan.list_manage']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  assert.equal(developerList.plans.length, 2);
});

test('invalid plan payload is rejected by the action boundary', async () => {
  const harness = createHarness();
  const actions = createPlanActions({ repository: harness.repository });

  const error = await captureError(
    actions['plan.create']({
      identity: IDENTITIES.coachA,
      payload: {
        clientRequestId: 'req_invalid',
        trainingGroupId: GROUP_A,
        title: '非法计划',
        startDate: '2026-10-14',
        items: [{ category: 'sprint', name: '跑', sets: 999 }]
      }
    })
  );
  assert.equal(error.code, 'INVALID_FIELD');
  assert.equal(harness.state.plans.size, 0);
});
