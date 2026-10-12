'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createPerformanceActions = require('../../cloudfunctions/api/actions/performance');
const { deterministicId } = require('../../cloudfunctions/api/lib/repository');

const STUDENT = { _id: 'usr_student_a', status: 'active', roles: ['student'] };
const COACH = { _id: 'usr_coach_a', status: 'active', roles: ['coach'] };
const DEVELOPER = {
  _id: 'usr_developer',
  status: 'active',
  roles: ['developer']
};
const IDENTITIES = {
  student: { appid: 'wx_test_app', openid: 'openid_student_0001' },
  coach: { appid: 'wx_test_app', openid: 'openid_coach_0001' },
  developer: { appid: 'wx_test_app', openid: 'openid_developer_0001' }
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

function createHarness(initialRecords = []) {
  const state = {
    users: new Map([
      [STUDENT._id, clone(STUDENT)],
      [COACH._id, clone(COACH)],
      [DEVELOPER._id, clone(DEVELOPER)]
    ]),
    performanceRecords: new Map(
      initialRecords.map((record) => [record._id, clone(record)])
    ),
    audits: new Map()
  };
  let transactionCalls = 0;
  let transactionQueue = Promise.resolve();

  function collectionState(collectionName) {
    if (collectionName === 'performance_records') {
      return state.performanceRecords;
    }
    if (collectionName === 'audit_logs') {
      return state.audits;
    }
    throw new Error(`Unexpected collection: ${collectionName}`);
  }

  function createReference(collectionName, id) {
    const collection = collectionState(collectionName);
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
      if (identity.openid === IDENTITIES.student.openid) {
        return clone(STUDENT);
      }
      if (identity.openid === IDENTITIES.coach.openid) {
        return clone(COACH);
      }
      return clone(DEVELOPER);
    },
    performanceIdForSubmission: (studentUserId, eventCode, achievedAt, value) =>
      deterministicId('perf', studentUserId, eventCode, achievedAt, String(value)),
    getPerformanceRecord: async (id) =>
      state.performanceRecords.has(id)
        ? clone(state.performanceRecords.get(id))
        : null,
    listPerformanceRecords: async (studentUserId) =>
      Array.from(state.performanceRecords.values()).filter(
        (record) => record.studentUserId === studentUserId
      ),
    listPendingPerformanceRecords: async () =>
      Array.from(state.performanceRecords.values()).filter(
        (record) => record.status === 'pending'
      ),
    getProfilesMap: async (userIds) =>
      new Map(
        userIds.map((userId) => [
          userId,
          {
            userId,
            name: userId === 'usr_student_a' ? '模拟学生甲' : '模拟学生乙'
          }
        ])
      ),
    getStudentGroupNamesMap: async (userIds) =>
      new Map(
        userIds.map((userId) => [
          userId,
          [userId === 'usr_student_a' ? '短跑组（2026）' : '跳远组（2026）']
        ])
      ),
    countPendingPerformanceRecords: async (studentUserIds) =>
      Array.from(state.performanceRecords.values()).filter(
        (record) =>
          record.status === 'pending' &&
          (!studentUserIds || studentUserIds.includes(record.studentUserId))
      ).length,
    getCoachGroupIds: async () => ['group_a'],
    getStudentUserIdsForGroups: async (groupIds) => {
      const map = {
        group_a: ['usr_student_a'],
        group_b: ['usr_student_b']
      };
      return groupIds.flatMap((groupId) => map[groupId] || []);
    },
    db: {
      serverDate: () => new Date(),
      runTransaction(work) {
        transactionCalls += 1;
        const run = transactionQueue.then(() =>
          work({
            collection(collectionName) {
              return {
                doc(id) {
                  return createReference(collectionName, id);
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

  return {
    repository,
    state,
    getTransactionCalls: () => transactionCalls
  };
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to be rejected');
}

test('student submits a pending PB record with deterministic id and audit', async () => {
  const harness = createHarness();
  const actions = createPerformanceActions({ repository: harness.repository });

  const result = await actions['performance.submit']({
    identity: IDENTITIES.student,
    payload: {
      eventCode: '100m',
      value: 12.5,
      achievedAt: '2026-10-01',
      note: '模拟成绩'
    }
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.duplicate, false);
  assert.equal(result.performanceId, harness.repository.performanceIdForSubmission(
    STUDENT._id,
    '100m',
    '2026-10-01',
    12.5
  ));
  assert.equal(harness.state.audits.size, 1);
  assert.equal(
    harness.state.audits.get(`audit_performance_submit_${result.performanceId}`)
      .action,
    'performance.submitted'
  );
});

test('duplicate PB submission is idempotent and does not create another audit', async () => {
  const harness = createHarness();
  const actions = createPerformanceActions({ repository: harness.repository });
  const request = {
    identity: IDENTITIES.student,
    payload: {
      eventCode: 'long_jump',
      value: 5.2,
      achievedAt: '2026-10-01'
    }
  };

  const first = await actions['performance.submit'](request);
  const second = await actions['performance.submit'](request);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(harness.state.performanceRecords.size, 1);
  assert.equal(harness.state.audits.size, 1);
});

test('coach cannot review a PB record outside assigned groups', async () => {
  const recordId = 'perf_student_b';
  const harness = createHarness([
    {
      _id: recordId,
      studentUserId: 'usr_student_b',
      eventCode: '100m',
      eventName: '100米',
      value: 12.1,
      unit: '秒',
      comparison: 'lower',
      achievedAt: '2026-10-01',
      status: 'pending'
    }
  ]);
  const actions = createPerformanceActions({ repository: harness.repository });

  const error = await captureError(
    actions['admin.review_performance']({
      identity: IDENTITIES.coach,
      payload: { performanceId: recordId, decision: 'approve' }
    })
  );

  assert.equal(error.code, 'OUT_OF_SCOPE');
  assert.equal(harness.getTransactionCalls(), 0);
});

test('coach approves an in-scope PB and student cannot self-approve', async () => {
  const recordId = 'perf_student_a';
  const harness = createHarness([
    {
      _id: recordId,
      studentUserId: STUDENT._id,
      eventCode: '100m',
      eventName: '100米',
      value: 12.4,
      unit: '秒',
      comparison: 'lower',
      achievedAt: '2026-10-01',
      status: 'pending'
    }
  ]);
  const actions = createPerformanceActions({ repository: harness.repository });

  const result = await actions['admin.review_performance']({
    identity: IDENTITIES.coach,
    payload: {
      performanceId: recordId,
      decision: 'approve',
      comment: '教练审核通过'
    }
  });
  assert.equal(result.status, 'approved');
  assert.equal(harness.state.performanceRecords.get(recordId).status, 'approved');
  assert.equal(
    harness.state.audits.get(
      [...harness.state.audits.keys()].find((key) =>
        key.startsWith('audit_performance_review_')
      )
    ).action,
    'admin.performance.approved'
  );

  const error = await captureError(
    actions['admin.review_performance']({
      identity: IDENTITIES.student,
      payload: { performanceId: recordId, decision: 'approve' }
    })
  );
  assert.equal(error.code, 'FORBIDDEN');
});

test('pending list is enriched and scoped, with a true pending count', async () => {
  const harness = createHarness([
    {
      _id: 'perf_a',
      studentUserId: STUDENT._id,
      eventCode: '100m',
      eventName: '100米',
      value: 12.4,
      unit: '秒',
      comparison: 'lower',
      achievedAt: '2026-10-01',
      source: 'student_report',
      note: '模拟备注',
      status: 'pending',
      createdAt: new Date('2026-10-01T01:00:00.000Z')
    },
    {
      _id: 'perf_b',
      studentUserId: 'usr_student_b',
      eventCode: 'long_jump',
      eventName: '跳远',
      value: 5.5,
      unit: '米',
      comparison: 'higher',
      achievedAt: '2026-10-02',
      source: 'student_report',
      note: '',
      status: 'pending',
      createdAt: new Date('2026-10-02T01:00:00.000Z')
    }
  ]);
  const actions = createPerformanceActions({ repository: harness.repository });

  const coachResult = await actions['admin.list_pending_performances']({
    identity: IDENTITIES.coach,
    payload: {}
  });
  assert.equal(coachResult.pendingCount, 1);
  assert.equal(coachResult.truncated, false);
  assert.equal(coachResult.performances.length, 1);
  assert.equal(coachResult.performances[0].studentName, '模拟学生甲');
  assert.deepEqual(coachResult.performances[0].trainingGroupNames, ['短跑组（2026）']);
  assert.equal(coachResult.performances[0].source, 'student_report');
  assert.equal(coachResult.performances[0].note, '模拟备注');

  const developerResult = await actions['admin.list_pending_performances']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  assert.equal(developerResult.pendingCount, 2);
  assert.equal(developerResult.performances.length, 2);
});

test('coach can reject a pending record with a review comment', async () => {
  const recordId = 'perf_reject';
  const harness = createHarness([
    {
      _id: recordId,
      studentUserId: STUDENT._id,
      eventCode: '100m',
      eventName: '100米',
      value: 12.4,
      unit: '秒',
      comparison: 'lower',
      achievedAt: '2026-10-01',
      status: 'pending'
    }
  ]);
  const actions = createPerformanceActions({ repository: harness.repository });

  const result = await actions['admin.review_performance']({
    identity: IDENTITIES.coach,
    payload: {
      performanceId: recordId,
      decision: 'reject',
      comment: '成绩材料不清晰'
    }
  });

  assert.equal(result.status, 'rejected');
  const saved = harness.state.performanceRecords.get(recordId);
  assert.equal(saved.status, 'rejected');
  assert.equal(saved.reviewComment, '成绩材料不清晰');
  assert.equal(saved.reviewedBy, COACH._id);
  assert.ok(saved.reviewedAt instanceof Date);
});

test('developer can review a record outside coach group scope', async () => {
  const recordId = 'perf_student_b';
  const harness = createHarness([
    {
      _id: recordId,
      studentUserId: 'usr_student_b',
      eventCode: '100m',
      eventName: '100米',
      value: 12.1,
      unit: '秒',
      comparison: 'lower',
      achievedAt: '2026-10-01',
      status: 'pending'
    }
  ]);
  const actions = createPerformanceActions({ repository: harness.repository });

  const result = await actions['admin.review_performance']({
    identity: IDENTITIES.developer,
    payload: { performanceId: recordId, decision: 'approve' }
  });
  assert.equal(result.status, 'approved');
});

test('concurrent reviews cannot overwrite each other', async () => {
  const recordId = 'perf_concurrent';
  const harness = createHarness([
    {
      _id: recordId,
      studentUserId: STUDENT._id,
      eventCode: '100m',
      eventName: '100米',
      value: 12.4,
      unit: '秒',
      comparison: 'lower',
      achievedAt: '2026-10-01',
      status: 'pending'
    }
  ]);
  const actions = createPerformanceActions({ repository: harness.repository });

  const settled = await Promise.allSettled([
    actions['admin.review_performance']({
      identity: IDENTITIES.coach,
      payload: { performanceId: recordId, decision: 'approve' }
    }),
    actions['admin.review_performance']({
      identity: IDENTITIES.developer,
      payload: { performanceId: recordId, decision: 'reject' }
    })
  ]);

  const fulfilled = settled.filter((item) => item.status === 'fulfilled');
  const rejected = settled.filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'PERFORMANCE_NOT_PENDING');
  assert.notEqual(
    harness.state.performanceRecords.get(recordId).status,
    'pending'
  );
});
