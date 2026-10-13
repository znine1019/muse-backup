'use strict';

const { deterministicId } = require('../../cloudfunctions/api/lib/repository');

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
const STUDENT_C = { _id: 'usr_student_c', status: 'active', roles: ['student'] };
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
  studentC: { appid: 'wx_test', openid: 'openid_student_c' },
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
      const value = record[field];
      if (Array.isArray(value)) {
        return value.some((item) => expected.values.includes(item));
      }
      return expected.values.includes(value);
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

const COLLECTION_KEYS = Object.freeze({
  training_plans: 'plans',
  attendance_sessions: 'sessions',
  attendance_records: 'attendanceRecords',
  leave_requests: 'leaves',
  competitions: 'competitions',
  competition_registrations: 'registrations',
  club_notices: 'notices',
  notice_reads: 'reads',
  training_feedback: 'feedback',
  audit_logs: 'audits'
});

function createHarness() {
  const state = {
    usersByOpenId: new Map([
      [IDENTITIES.coachA.openid, COACH_A],
      [IDENTITIES.coachB.openid, COACH_B],
      [IDENTITIES.developer.openid, DEVELOPER],
      [IDENTITIES.studentA.openid, STUDENT_A],
      [IDENTITIES.studentB.openid, STUDENT_B],
      [IDENTITIES.studentC.openid, STUDENT_C],
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
      [STUDENT_B._id]: [GROUP_A],
      [STUDENT_C._id]: [GROUP_B],
      [DISABLED_STUDENT._id]: [GROUP_A]
    },
    groupStudents: {
      [GROUP_A]: [STUDENT_A._id, STUDENT_B._id],
      [GROUP_B]: [STUDENT_C._id]
    },
    profiles: new Map([
      [STUDENT_A._id, { userId: STUDENT_A._id, name: '学生甲' }],
      [STUDENT_B._id, { userId: STUDENT_B._id, name: '学生乙' }],
      [STUDENT_C._id, { userId: STUDENT_C._id, name: '学生丙' }]
    ]),
    plans: new Map(),
    sessions: new Map(),
    attendanceRecords: new Map(),
    leaves: new Map(),
    competitions: new Map(),
    registrations: new Map(),
    notices: new Map(),
    reads: new Map(),
    feedback: new Map(),
    audits: new Map()
  };
  let transactionQueue = Promise.resolve();

  function collectionFor(name) {
    const key = COLLECTION_KEYS[name];
    if (!key) {
      throw new Error(`Unexpected collection: ${name}`);
    }
    return state[key];
  }

  function createReference(name, id) {
    const collection = collectionFor(name);
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

  function listCollection(name, where, orderBy, options = {}) {
    let records = Array.from(collectionFor(name).values()).filter((record) =>
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
    const limit = options.maxRecords || 300;
    return {
      records: clone(records).slice(0, limit),
      total: records.length,
      incomplete: records.length > limit
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
    getProfile: async (userId) =>
      state.profiles.has(userId) ? clone(state.profiles.get(userId)) : null,
    listEnabledTrainingGroups: async () =>
      Array.from(state.groups.values()).filter((group) => group.enabled === true),
    getTrainingPlan: async (planId) =>
      state.plans.has(planId) ? clone(state.plans.get(planId)) : null,
    getAttendanceSession: async (sessionId) =>
      state.sessions.has(sessionId) ? clone(state.sessions.get(sessionId)) : null,
    getAttendanceRecord: async (sessionId, studentUserId) => {
      const id = deterministicId('attend', sessionId, studentUserId);
      return state.attendanceRecords.has(id)
        ? clone(state.attendanceRecords.get(id))
        : null;
    },
    listAttendanceRecordsByStudent: async (studentUserId, options = {}) =>
      listCollection(
        'attendance_records',
        {
          studentUserId,
          ...(options.fromDate
            ? { attendanceDate: { __op: 'gte', value: options.fromDate } }
            : {})
        },
        [{ field: 'attendanceDate', direction: 'desc' }],
        options
      ),
    getCompetition: async (competitionId) =>
      state.competitions.has(competitionId)
        ? clone(state.competitions.get(competitionId))
        : null,
    listCompetitions: async (options = {}) =>
      listCollection(
        'competitions',
        {
          ...(options.statuses
            ? { status: { __op: 'in', values: options.statuses } }
            : {})
        },
        [{ field: 'eventDate', direction: 'asc' }],
        options
      ),
    getRegistration: async (registrationId) =>
      state.registrations.has(registrationId)
        ? clone(state.registrations.get(registrationId))
        : null,
    listRegistrations: async (options = {}) =>
      listCollection(
        'competition_registrations',
        {
          ...(options.competitionId ? { competitionId: options.competitionId } : {}),
          ...(options.competitionIds
            ? { competitionId: { __op: 'in', values: options.competitionIds } }
            : {}),
          ...(options.studentUserId ? { studentUserId: options.studentUserId } : {}),
          ...(options.studentUserIds
            ? { studentUserId: { __op: 'in', values: options.studentUserIds } }
            : {}),
          ...(options.statuses ? { status: { __op: 'in', values: options.statuses } } : {})
        },
        [{ field: 'createdAt', direction: 'desc' }],
        options
      ),
    countRegistrations: async (competitionId, statuses) =>
      Array.from(state.registrations.values()).filter(
        (registration) =>
          registration.competitionId === competitionId &&
          (!statuses || statuses.includes(registration.status))
      ).length,
    getClubNotice: async (noticeId) =>
      state.notices.has(noticeId) ? clone(state.notices.get(noticeId)) : null,
    listClubNotices: async (options = {}) =>
      listCollection(
        'club_notices',
        {
          ...(options.statuses
            ? { status: { __op: 'in', values: options.statuses } }
            : {})
        },
        [{ field: 'publishedAt', direction: 'desc' }],
        options
      ),
    getNoticeRead: async (noticeId, studentUserId) => {
      const id = deterministicId('noticeread', noticeId, studentUserId);
      return state.reads.has(id) ? clone(state.reads.get(id)) : null;
    },
    listNoticeReads: async (studentUserId, options = {}) =>
      listCollection(
        'notice_reads',
        {
          studentUserId,
          ...(options.noticeIds
            ? { noticeId: { __op: 'in', values: options.noticeIds } }
            : {})
        },
        [{ field: 'readAt', direction: 'desc' }],
        options
      ),
    getTrainingFeedback: async (feedbackId) =>
      state.feedback.has(feedbackId) ? clone(state.feedback.get(feedbackId)) : null,
    listTrainingFeedback: async (options = {}) =>
      listCollection(
        'training_feedback',
        {
          ...(options.studentUserId ? { studentUserId: options.studentUserId } : {}),
          ...(options.studentUserIds
            ? { studentUserId: { __op: 'in', values: options.studentUserIds } }
            : {}),
          ...(options.trainingGroupId
            ? { trainingGroupId: options.trainingGroupId }
            : {}),
          ...(options.planId ? { planId: options.planId } : {}),
          ...(options.fromDate
            ? { attendanceDate: { __op: 'gte', value: options.fromDate } }
            : {}),
          ...(options.toDate
            ? { attendanceDate: { __op: 'lte', value: options.toDate } }
            : {})
        },
        [{ field: 'attendanceDate', direction: 'desc' }],
        options
      ),
    competitionIdForRequest: (actorUserId, clientRequestId) =>
      deterministicId('compete', actorUserId, clientRequestId),
    registrationIdForStudentCompetition: (studentUserId, competitionId) =>
      deterministicId('compreg', studentUserId, competitionId),
    noticeIdForRequest: (actorUserId, clientRequestId) =>
      deterministicId('notice', actorUserId, clientRequestId),
    noticeReadId: (noticeId, studentUserId) =>
      deterministicId('noticeread', noticeId, studentUserId),
    feedbackIdForStudentSession: (studentUserId, sessionId) =>
      deterministicId('feedback', studentUserId, sessionId),
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

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to be rejected');
}

module.exports = {
  COACH_A,
  COACH_B,
  DEVELOPER,
  GROUP_A,
  GROUP_B,
  IDENTITIES,
  STUDENT_A,
  STUDENT_B,
  STUDENT_C,
  captureError,
  clone,
  createHarness
};
