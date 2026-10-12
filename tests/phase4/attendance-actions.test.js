'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createAttendanceActions = require('../../cloudfunctions/api/actions/attendance');
const { deterministicId } = require('../../cloudfunctions/api/lib/repository');
const {
  addDays,
  clubDateOnly,
  clubTimeParts,
  timeToMinutes
} = require('../../cloudfunctions/api/lib/dates');

const GROUP_A = 'group_a';
const GROUP_B = 'group_b';
const COACH_A = { _id: 'usr_coach_a', status: 'active', roles: ['coach'] };
const COACH_B = { _id: 'usr_coach_b', status: 'active', roles: ['coach'] };
const DEVELOPER = {
  _id: 'usr_developer',
  status: 'active',
  roles: ['developer']
};
const STUDENT_A = { _id: 'usr_student_a', status: 'active', roles: ['student'] };
const STUDENT_B = { _id: 'usr_student_b', status: 'active', roles: ['student'] };
const DISABLED_STUDENT = {
  _id: 'usr_student_disabled',
  status: 'disabled',
  roles: ['student']
};
const IDENTITIES = {
  coachA: { appid: 'wx_test', openid: 'openid_coach_a' },
  coachB: { appid: 'wx_test', openid: 'openid_coach_b' },
  developer: { appid: 'wx_test', openid: 'openid_developer' },
  studentA: { appid: 'wx_test', openid: 'openid_student_a' },
  studentB: { appid: 'wx_test', openid: 'openid_student_b' },
  disabledStudent: { appid: 'wx_test', openid: 'openid_student_disabled' }
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

function matchesWhere(record, where) {
  if (!where || !Object.keys(where).length) {
    return true;
  }
  return Object.entries(where).every(([field, expected]) => {
    if (expected && typeof expected === 'object' && expected.__op === 'in') {
      return expected.values.includes(record[field]);
    }
    if (expected && typeof expected === 'object' && expected.__op === 'gte') {
      return record[field] >= expected.value;
    }
    if (expected && typeof expected === 'object' && expected.__op === 'lte') {
      return record[field] <= expected.value;
    }
    return record[field] === expected;
  });
}

function createHarness() {
  const state = {
    usersByOpenId: new Map([
      [IDENTITIES.coachA.openid, COACH_A],
      [IDENTITIES.coachB.openid, COACH_B],
      [IDENTITIES.developer.openid, DEVELOPER],
      [IDENTITIES.studentA.openid, STUDENT_A],
      [IDENTITIES.studentB.openid, STUDENT_B],
      [IDENTITIES.disabledStudent.openid, DISABLED_STUDENT]
    ]),
    groups: new Map([
      [
        GROUP_A,
        { _id: GROUP_A, groupId: GROUP_A, name: '短跑组', seasonLabel: '2026', enabled: true }
      ],
      [
        GROUP_B,
        { _id: GROUP_B, groupId: GROUP_B, name: '跳远组', seasonLabel: '2026', enabled: true }
      ]
    ]),
    coachGroups: { [COACH_A._id]: [GROUP_A], [COACH_B._id]: [GROUP_B] },
    studentGroups: {
      [STUDENT_A._id]: [GROUP_A],
      [STUDENT_B._id]: [GROUP_B],
      [DISABLED_STUDENT._id]: [GROUP_A]
    },
    groupStudents: {
      [GROUP_A]: [STUDENT_A._id, 'usr_student_a2'],
      [GROUP_B]: [STUDENT_B._id]
    },
    profiles: new Map([
      [STUDENT_A._id, { userId: STUDENT_A._id, name: '模拟学生甲' }],
      ['usr_student_a2', { userId: 'usr_student_a2', name: '模拟学生丙' }],
      [STUDENT_B._id, { userId: STUDENT_B._id, name: '模拟学生乙' }]
    ]),
    plans: new Map(),
    sessions: new Map(),
    records: new Map(),
    leaves: new Map(),
    audits: new Map()
  };
  let transactionQueue = Promise.resolve();

  function collectionState(name) {
    if (name === 'attendance_sessions') {
      return state.sessions;
    }
    if (name === 'attendance_records') {
      return state.records;
    }
    if (name === 'leave_requests') {
      return state.leaves;
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
        if (Object.prototype.hasOwnProperty.call(data, '_id')) {
          throw new Error('set data must not contain _id');
        }
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

  function listCollection(collection, where, orderBy, options = {}) {
    let records = Array.from(collection.values()).filter((record) =>
      matchesWhere(record, where)
    );
    for (let index = orderBy.length - 1; index >= 0; index -= 1) {
      const order = orderBy[index];
      const direction = order.direction === 'desc' ? -1 : 1;
      records = [...records].sort((left, right) => {
        const a = left[order.field];
        const b = right[order.field];
        if (a === b) {
          return 0;
        }
        return direction * (a > b ? 1 : -1);
      });
    }
    return {
      records: clone(records).slice(0, options.maxRecords || 300),
      total: records.length,
      incomplete: records.length > (options.maxRecords || 300)
    };
  }

  const repository = {
    ensureUser: async (identity) => clone(state.usersByOpenId.get(identity.openid)),
    getTrainingGroup: async (groupId) =>
      state.groups.has(groupId) ? clone(state.groups.get(groupId)) : null,
    getCoachGroupIds: async (userId) => state.coachGroups[userId] || [],
    getStudentGroupIds: async (userId) => state.studentGroups[userId] || [],
    getStudentUserIdsForGroups: async (groupIds) =>
      Array.from(
        new Set(groupIds.flatMap((groupId) => state.groupStudents[groupId] || []))
      ),
    getGroupsMap: async (groupIds) =>
      new Map(
        groupIds
          .filter((groupId) => state.groups.has(groupId))
          .map((groupId) => [groupId, clone(state.groups.get(groupId))])
      ),
    getProfilesMap: async (userIds) =>
      new Map(
        userIds
          .filter((userId) => state.profiles.has(userId))
          .map((userId) => [userId, clone(state.profiles.get(userId))])
      ),
    getTrainingPlan: async (planId) =>
      state.plans.has(planId) ? clone(state.plans.get(planId)) : null,
    getAttendanceSession: async (sessionId) =>
      state.sessions.has(sessionId) ? clone(state.sessions.get(sessionId)) : null,
    listAttendanceSessions: async (options = {}) =>
      listCollection(
        state.sessions,
        {
          ...(options.groupIds ? { trainingGroupId: { __op: 'in', values: options.groupIds } } : {}),
          ...(options.statuses ? { status: { __op: 'in', values: options.statuses } } : {}),
          ...(options.fromDate ? { attendanceDate: { __op: 'gte', value: options.fromDate } } : {}),
          ...(options.toDate ? { attendanceDate: { __op: 'lte', value: options.toDate } } : {})
        },
        [
          { field: 'attendanceDate', direction: 'asc' },
          { field: '_id', direction: 'asc' }
        ],
        options
      ),
    getAttendanceRecord: async (sessionId, studentUserId) => {
      const id = deterministicId('attend', sessionId, studentUserId);
      return state.records.has(id) ? clone(state.records.get(id)) : null;
    },
    listAttendanceRecordsBySession: async (sessionId, options = {}) =>
      listCollection(
        state.records,
        { sessionId },
        [{ field: 'studentUserId', direction: 'asc' }],
        options
      ),
    listAttendanceRecordsByStudent: async (studentUserId, options = {}) =>
      listCollection(
        state.records,
        {
          studentUserId,
          ...(options.fromDate ? { attendanceDate: { __op: 'gte', value: options.fromDate } } : {}),
          ...(options.toDate ? { attendanceDate: { __op: 'lte', value: options.toDate } } : {})
        },
        [
          { field: 'attendanceDate', direction: 'desc' },
          { field: '_id', direction: 'asc' }
        ],
        options
      ),
    getLeaveRequest: async (leaveId) =>
      state.leaves.has(leaveId) ? clone(state.leaves.get(leaveId)) : null,
    listLeaveRequests: async (options = {}) =>
      listCollection(
        state.leaves,
        {
          ...(options.sessionIds ? { sessionId: { __op: 'in', values: options.sessionIds } } : {}),
          ...(options.studentUserIds ? { studentUserId: { __op: 'in', values: options.studentUserIds } } : {}),
          ...(options.statuses ? { status: { __op: 'in', values: options.statuses } } : {}),
          ...(options.fromDate ? { attendanceDate: { __op: 'gte', value: options.fromDate } } : {}),
          ...(options.toDate ? { attendanceDate: { __op: 'lte', value: options.toDate } } : {})
        },
        [
          { field: 'createdAt', direction: 'desc' },
          { field: '_id', direction: 'asc' }
        ],
        options
      ),
    countPendingLeaveRequests: async (studentUserIds) =>
      Array.from(state.leaves.values()).filter(
        (leave) =>
          leave.status === 'pending' &&
          (!studentUserIds || studentUserIds.includes(leave.studentUserId))
      ).length,
    attendanceSessionIdForRequest: (actorUserId, clientRequestId) =>
      deterministicId('att', actorUserId, clientRequestId),
    attendanceRecordId: (sessionId, studentUserId) =>
      deterministicId('attend', sessionId, studentUserId),
    leaveRequestId: (studentUserId, sessionId, clientRequestId) =>
      deterministicId('leave', studentUserId, sessionId, clientRequestId),
    db: {
      command: {
        in: (values) => ({ __op: 'in', values }),
        gte: (value) => ({ __op: 'gte', value }),
        lte: (value) => ({ __op: 'lte', value })
      },
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

function sessionPayload(requestId, overrides = {}) {
  return {
    clientRequestId: requestId,
    trainingGroupId: GROUP_A,
    title: '短跑组训练',
    attendanceDate: clubDateOnly(),
    locationName: '田径场东侧',
    latitude: 30,
    longitude: 120,
    radiusMeters: 100,
    accuracyThresholdMeters: 100,
    checkInOpenTime: '00:00',
    checkInCloseTime: '23:59',
    lateAfterTime: '23:59',
    ...overrides
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

async function createSession(actions, identity, requestId, overrides = {}) {
  const result = await actions['attendance.create_session']({
    identity,
    payload: sessionPayload(requestId, overrides)
  });
  return result.session;
}

test('coach creates an attendance session idempotently with audit', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });

  const first = await createSession(actions, IDENTITIES.coachA, 'session_1');
  const second = await createSession(actions, IDENTITIES.coachA, 'session_1');

  assert.equal(first.status, 'scheduled');
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(harness.state.sessions.size, 1);
  assert.ok(
    Array.from(harness.state.audits.values()).some(
      (entry) => entry.action === 'coach.attendance_session.created'
    )
  );
});

test('coach cannot create attendance for another group', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });

  const error = await captureError(
    actions['attendance.create_session']({
      identity: IDENTITIES.coachB,
      payload: sessionPayload('cross_group', { trainingGroupId: GROUP_A })
    })
  );
  assert.equal(error.code, 'OUT_OF_SCOPE');
});

test('student check-in succeeds and is idempotent', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'checkin_1');

  const first = await actions['attendance.check_in']({
    identity: IDENTITIES.studentA,
    payload: {
      sessionId: session.sessionId,
      latitude: 30,
      longitude: 120,
      accuracy: 10
    }
  });
  const second = await actions['attendance.check_in']({
    identity: IDENTITIES.studentA,
    payload: {
      sessionId: session.sessionId,
      latitude: 30,
      longitude: 120,
      accuracy: 10
    }
  });

  assert.equal(first.duplicate, false);
  assert.equal(first.record.status, 'checked_in');
  assert.equal(second.duplicate, true);
  assert.equal(harness.state.records.size, 1);
});

test('late check-in is marked late after the late threshold', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'late_1', {
    lateAfterTime: '00:00'
  });

  const result = await actions['attendance.check_in']({
    identity: IDENTITIES.studentA,
    payload: {
      sessionId: session.sessionId,
      latitude: 30,
      longitude: 120,
      accuracy: 10
    }
  });
  assert.equal(result.record.status, 'late');
});

test('check-in outside the time window is rejected', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const future = await createSession(actions, IDENTITIES.coachA, 'future_1', {
    attendanceDate: addDays(clubDateOnly(), 1)
  });

  const error = await captureError(
    actions['attendance.check_in']({
      identity: IDENTITIES.studentA,
      payload: {
        sessionId: future.sessionId,
        latitude: 30,
        longitude: 120,
        accuracy: 10
      }
    })
  );
  assert.equal(error.code, 'CHECK_IN_NOT_OPEN');
});

test('out-of-range GPS is rejected and client distance fields are ignored', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'range_1');

  const error = await captureError(
    actions['attendance.check_in']({
      identity: IDENTITIES.studentA,
      payload: {
        sessionId: session.sessionId,
        latitude: 30.1,
        longitude: 120.1,
        accuracy: 5,
        distance: 1,
        isWithinRange: true
      }
    })
  );
  assert.equal(error.code, 'OUT_OF_RANGE');
  assert.equal(harness.state.records.size, 0);
});

test('low GPS accuracy and boundary positions require manual verification', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'accuracy_1');

  const lowAccuracy = await actions['attendance.check_in']({
    identity: IDENTITIES.studentA,
    payload: {
      sessionId: session.sessionId,
      latitude: 30,
      longitude: 120,
      accuracy: 300
    }
  });
  assert.equal(lowAccuracy.record.status, 'pending_verification');
  assert.equal(lowAccuracy.record.verificationReason, 'low_accuracy');

  harness.state.records.clear();
  const boundary = await actions['attendance.check_in']({
    identity: IDENTITIES.studentA,
    payload: {
      sessionId: session.sessionId,
      latitude: 30.0009,
      longitude: 120,
      accuracy: 5
    }
  });
  assert.equal(boundary.record.status, 'pending_verification');
  assert.equal(boundary.record.verificationReason, 'near_boundary');
});

test('disabled account and disabled group block check-in', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'disabled_1');

  const disabledError = await captureError(
    actions['attendance.check_in']({
      identity: IDENTITIES.disabledStudent,
      payload: {
        sessionId: session.sessionId,
        latitude: 30,
        longitude: 120,
        accuracy: 10
      }
    })
  );
  assert.equal(disabledError.code, 'ACCOUNT_DISABLED');

  harness.state.groups.get(GROUP_A).enabled = false;
  const groupError = await captureError(
    actions['attendance.check_in']({
      identity: IDENTITIES.studentA,
      payload: {
        sessionId: session.sessionId,
        latitude: 30,
        longitude: 120,
        accuracy: 10
      }
    })
  );
  assert.equal(groupError.code, 'TRAINING_GROUP_DISABLED');
});

test('student cannot check in to another group session', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const sessionB = await createSession(actions, IDENTITIES.coachB, 'group_b_1', {
    trainingGroupId: GROUP_B
  });

  const error = await captureError(
    actions['attendance.check_in']({
      identity: IDENTITIES.studentA,
      payload: {
        sessionId: sessionB.sessionId,
        latitude: 30,
        longitude: 120,
        accuracy: 10
      }
    })
  );
  assert.equal(error.code, 'OUT_OF_SCOPE');
});

test('session update and cancel use optimistic version checks', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'update_1', {
    attendanceDate: addDays(clubDateOnly(), 1)
  });

  const updated = await actions['attendance.update_session']({
    identity: IDENTITIES.coachA,
    payload: {
      ...sessionPayload('update_1'),
      sessionId: session.sessionId,
      expectedVersion: 1,
      title: '短跑组调整训练'
    }
  });
  assert.equal(updated.session.version, 2);

  const stale = await captureError(
    actions['attendance.cancel_session']({
      identity: IDENTITIES.coachA,
      payload: { sessionId: session.sessionId, expectedVersion: 1 }
    })
  );
  assert.equal(stale.code, 'SESSION_VERSION_CONFLICT');

  const cancelled = await actions['attendance.cancel_session']({
    identity: IDENTITIES.coachA,
    payload: { sessionId: session.sessionId, expectedVersion: 2 }
  });
  assert.equal(cancelled.session.status, 'cancelled');
});

test('roster summary reflects checked-in, late, leave and absent states', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'roster_1');

  await actions['attendance.check_in']({
    identity: IDENTITIES.studentA,
    payload: { sessionId: session.sessionId, latitude: 30, longitude: 120, accuracy: 10 }
  });

  const roster = await actions['attendance.get_session_roster']({
    identity: IDENTITIES.coachA,
    payload: { sessionId: session.sessionId }
  });
  assert.equal(roster.summary.expected, 2);
  assert.equal(roster.summary.checkedIn, 1);
  assert.equal(roster.summary.pending, 1);
  assert.equal(roster.roster.length, 2);
});

test('leave application is pending, idempotent and visible to the coach', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'leave_session_1', {
    attendanceDate: addDays(clubDateOnly(), 1)
  });

  const first = await actions['leave.create']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'leave_req_1',
      sessionId: session.sessionId,
      reason: '身体不适需要休息'
    }
  });
  const second = await actions['leave.create']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'leave_req_2',
      sessionId: session.sessionId,
      reason: '再次提交'
    }
  });
  assert.equal(first.leave.status, 'pending');
  assert.equal(second.duplicate, true);
  assert.equal(harness.state.leaves.size, 1);

  const pending = await actions['leave.list_pending']({
    identity: IDENTITIES.coachA,
    payload: {}
  });
  assert.equal(pending.pendingCount, 1);
  assert.equal(pending.leaves[0].studentName, '模拟学生甲');
  assert.equal(pending.leaves[0].trainingGroupName, '短跑组');
});

test('leave approval links to attendance and preserves audit', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'approve_session', {
    attendanceDate: addDays(clubDateOnly(), 1)
  });
  const leave = await actions['leave.create']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'approve_leave',
      sessionId: session.sessionId,
      reason: '参加家庭活动'
    }
  });

  const reviewed = await actions['leave.review']({
    identity: IDENTITIES.coachA,
    payload: {
      leaveId: leave.leave.leaveId,
      decision: 'approve',
      comment: '同意'
    }
  });
  assert.equal(reviewed.leave.status, 'approved');

  const record = await harness.repository.getAttendanceRecord(
    session.sessionId,
    STUDENT_A._id
  );
  assert.equal(record.status, 'leave_approved');
  assert.equal(record.leaveRequestId, leave.leave.leaveId);
  assert.ok(
    Array.from(harness.state.audits.values()).some(
      (entry) => entry.action === 'coach.leave.approved'
    )
  );
});

test('leave rejection requires a comment and keeps history', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'reject_session', {
    attendanceDate: addDays(clubDateOnly(), 1)
  });
  const leave = await actions['leave.create']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'reject_leave',
      sessionId: session.sessionId,
      reason: '个人原因'
    }
  });

  const error = await captureError(
    actions['leave.review']({
      identity: IDENTITIES.coachA,
      payload: { leaveId: leave.leave.leaveId, decision: 'reject', comment: '' }
    })
  );
  assert.equal(error.code, 'INVALID_FIELD');

  const reviewed = await actions['leave.review']({
    identity: IDENTITIES.coachA,
    payload: {
      leaveId: leave.leave.leaveId,
      decision: 'reject',
      comment: '材料不足'
    }
  });
  assert.equal(reviewed.leave.status, 'rejected');
  assert.equal(harness.state.records.size, 0);
});

test('coach cross-group leave review is rejected and developer is global', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'scope_session', {
    attendanceDate: addDays(clubDateOnly(), 1)
  });
  const leave = await actions['leave.create']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'scope_leave',
      sessionId: session.sessionId,
      reason: '事假'
    }
  });

  const crossError = await captureError(
    actions['leave.review']({
      identity: IDENTITIES.coachB,
      payload: { leaveId: leave.leave.leaveId, decision: 'approve' }
    })
  );
  assert.equal(crossError.code, 'OUT_OF_SCOPE');

  const reviewed = await actions['leave.review']({
    identity: IDENTITIES.developer,
    payload: { leaveId: leave.leave.leaveId, decision: 'approve' }
  });
  assert.equal(reviewed.leave.status, 'approved');
});

test('duplicate and concurrent leave reviews cannot overwrite results', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'concurrent_session', {
    attendanceDate: addDays(clubDateOnly(), 1)
  });
  const leave = await actions['leave.create']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'concurrent_leave',
      sessionId: session.sessionId,
      reason: '事假'
    }
  });

  const settled = await Promise.allSettled([
    actions['leave.review']({
      identity: IDENTITIES.coachA,
      payload: { leaveId: leave.leave.leaveId, decision: 'approve' }
    }),
    actions['leave.review']({
      identity: IDENTITIES.developer,
      payload: { leaveId: leave.leave.leaveId, decision: 'reject', comment: '不同意' }
    })
  ]);
  const fulfilled = settled.filter((item) => item.status === 'fulfilled');
  const rejected = settled.filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'LEAVE_NOT_PENDING');

  const repeat = await captureError(
    actions['leave.review']({
      identity: IDENTITIES.coachA,
      payload: { leaveId: leave.leave.leaveId, decision: 'approve' }
    })
  );
  assert.equal(repeat.code, 'LEAVE_NOT_PENDING');
});

test('student can cancel a pending leave but cannot cancel after review', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'cancel_session', {
    attendanceDate: addDays(clubDateOnly(), 1)
  });
  const leave = await actions['leave.create']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'cancel_leave',
      sessionId: session.sessionId,
      reason: '临时取消'
    }
  });

  const cancelled = await actions['leave.cancel']({
    identity: IDENTITIES.studentA,
    payload: { leaveId: leave.leave.leaveId }
  });
  assert.equal(cancelled.leave.status, 'cancelled');

  const error = await captureError(
    actions['leave.cancel']({
      identity: IDENTITIES.studentA,
      payload: { leaveId: leave.leave.leaveId }
    })
  );
  assert.equal(error.code, 'LEAVE_NOT_PENDING');
});

test('leave approval cannot overwrite a real check-in record', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'conflict_session', {
    attendanceDate: addDays(clubDateOnly(), 1)
  });
  const leave = await actions['leave.create']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'conflict_leave',
      sessionId: session.sessionId,
      reason: '事假'
    }
  });

  await actions['attendance.manual_verify']({
    identity: IDENTITIES.coachA,
    payload: {
      sessionId: session.sessionId,
      studentUserId: STUDENT_A._id,
      status: 'checked_in',
      reason: '现场确认'
    }
  });

  const error = await captureError(
    actions['leave.review']({
      identity: IDENTITIES.coachA,
      payload: { leaveId: leave.leave.leaveId, decision: 'approve' }
    })
  );
  assert.equal(error.code, 'ATTENDANCE_CONFLICT');
});

test('manual verification keeps the original status and reason', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'manual_session');

  await actions['attendance.check_in']({
    identity: IDENTITIES.studentA,
    payload: {
      sessionId: session.sessionId,
      latitude: 30,
      longitude: 120,
      accuracy: 300
    }
  });
  await actions['attendance.manual_verify']({
    identity: IDENTITIES.coachA,
    payload: {
      sessionId: session.sessionId,
      studentUserId: STUDENT_A._id,
      status: 'checked_in',
      reason: '定位误差已核实'
    }
  });

  const record = await harness.repository.getAttendanceRecord(
    session.sessionId,
    STUDENT_A._id
  );
  assert.equal(record.status, 'checked_in');
  assert.equal(record.originalStatus, 'pending_verification');
  assert.equal(record.adjustReason, '定位误差已核实');
  assert.equal(record.adjustedBy, COACH_A._id);
});

test('attendance query filters and student history are scoped', async () => {
  const harness = createHarness();
  const actions = createAttendanceActions({ repository: harness.repository });
  const session = await createSession(actions, IDENTITIES.coachA, 'history_session');
  await createSession(actions, IDENTITIES.coachB, 'history_session_b', {
    trainingGroupId: GROUP_B
  });

  const coachList = await actions['attendance.list_manage_sessions']({
    identity: IDENTITIES.coachA,
    payload: {}
  });
  assert.equal(coachList.sessions.length, 1);

  const developerList = await actions['attendance.list_manage_sessions']({
    identity: IDENTITIES.developer,
    payload: {}
  });
  assert.equal(developerList.sessions.length, 2);

  await actions['attendance.check_in']({
    identity: IDENTITIES.studentA,
    payload: { sessionId: session.sessionId, latitude: 30, longitude: 120, accuracy: 10 }
  });
  const history = await actions['attendance.list_student_records']({
    identity: IDENTITIES.studentA,
    payload: {}
  });
  assert.equal(history.records.length, 1);
  assert.equal(history.summary.checkedIn, 1);
});

test('attendance date helpers respect UTC+8 boundaries', () => {
  const now = new Date('2026-10-13T15:59:00.000Z');
  const after = new Date('2026-10-13T16:00:00.000Z');
  assert.equal(clubTimeParts(now).date, '2026-10-13');
  assert.equal(clubTimeParts(after).date, '2026-10-14');
  assert.equal(timeToMinutes('08:30'), 510);
  assert.equal(timeToMinutes('24:00'), null);
});
