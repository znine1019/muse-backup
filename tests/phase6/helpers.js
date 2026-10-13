'use strict';

const GROUP_A = 'group_a';
const GROUP_B = 'group_b';
const COACH_A = { _id: 'usr_coach_a', status: 'active', roles: ['coach'], displayName: '教练甲' };
const COACH_B = { _id: 'usr_coach_b', status: 'active', roles: ['coach'], displayName: '教练乙' };
const DEVELOPER = { _id: 'usr_developer', status: 'active', roles: ['developer'], displayName: '开发者' };
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
        {
          _id: GROUP_A,
          groupId: GROUP_A,
          name: '短跑组',
          seasonLabel: '2026',
          enabled: true,
          coachUserIds: [COACH_A._id]
        }
      ],
      [
        GROUP_B,
        {
          _id: GROUP_B,
          groupId: GROUP_B,
          name: '跳远组',
          seasonLabel: '2026',
          enabled: true,
          coachUserIds: [COACH_B._id]
        }
      ]
    ]),
    memberships: [
      {
        _id: 'member_a_a',
        userId: STUDENT_A._id,
        groupId: GROUP_A,
        roleInGroup: 'student',
        status: 'active',
        assignedAt: new Date('2026-01-01T00:00:00.000Z')
      },
      {
        _id: 'member_b_a',
        userId: STUDENT_B._id,
        groupId: GROUP_A,
        roleInGroup: 'student',
        status: 'active',
        assignedAt: new Date('2026-01-01T00:00:00.000Z')
      },
      {
        _id: 'member_c_b',
        userId: STUDENT_C._id,
        groupId: GROUP_B,
        roleInGroup: 'student',
        status: 'active',
        assignedAt: new Date('2026-01-01T00:00:00.000Z')
      }
    ],
    profiles: new Map([
      [STUDENT_A._id, { _id: 'profile_a', userId: STUDENT_A._id, name: '学生甲', primaryEventCode: '100m', primaryEventName: '100米', examGoal: {} }],
      [STUDENT_B._id, { _id: 'profile_b', userId: STUDENT_B._id, name: '学生乙', primaryEventCode: 'long_jump', primaryEventName: '跳远', examGoal: {} }],
      [STUDENT_C._id, { _id: 'profile_c', userId: STUDENT_C._id, name: '学生丙', primaryEventCode: 'long_jump', primaryEventName: '跳远', examGoal: {} }]
    ]),
    performances: [],
    sessions: [],
    records: [],
    leaves: [],
    feedback: []
  };

  const repository = {
    ensureUser: async (identity) => clone(state.usersByOpenId.get(identity.openid)),
    getProfile: async (userId) =>
      state.profiles.has(userId) ? clone(state.profiles.get(userId)) : null,
    getProfilesMap: async (userIds) =>
      new Map(
        userIds
          .filter((userId) => state.profiles.has(userId))
          .map((userId) => [userId, clone(state.profiles.get(userId))])
      ),
    getUsersMap: async (userIds) =>
      new Map(
        userIds.map((userId) => [
          userId,
          clone(
            Array.from(state.usersByOpenId.values()).find(
              (user) => user._id === userId
            ) || {}
          )
        ])
      ),
    getTrainingGroup: async (groupId) =>
      state.groups.has(groupId) ? clone(state.groups.get(groupId)) : null,
    getGroupsMap: async (groupIds) =>
      new Map(
        groupIds
          .filter((groupId) => state.groups.has(groupId))
          .map((groupId) => [groupId, clone(state.groups.get(groupId))])
      ),
    listAllTrainingGroups: async () =>
      Array.from(state.groups.values()).map(clone),
    getCoachGroupIds: async (userId) =>
      Array.from(state.groups.values())
        .filter((group) => (group.coachUserIds || []).includes(userId))
        .map((group) => group._id),
    getStudentGroupIds: async (userId) =>
      state.memberships
        .filter(
          (membership) =>
            membership.userId === userId &&
            membership.roleInGroup === 'student' &&
            membership.status === 'active'
        )
        .map((membership) => membership.groupId),
    getStudentUserIdsForGroups: async (groupIds) =>
      Array.from(
        new Set(
          state.memberships
            .filter(
              (membership) =>
                groupIds.includes(membership.groupId) &&
                membership.roleInGroup === 'student' &&
                membership.status === 'active'
            )
            .map((membership) => membership.userId)
        )
      ),
    listMembershipsForGroups: async (groupIds) => {
      const records = state.memberships.filter((membership) =>
        groupIds.includes(membership.groupId)
      );
      return { records: clone(records), total: records.length, incomplete: false };
    },
    listAttendanceSessions: async (options = {}) => {
      let records = state.sessions.filter(
        (session) =>
          (!options.groupIds ||
            options.groupIds.includes(session.trainingGroupId)) &&
          (!options.fromDate || session.attendanceDate >= options.fromDate) &&
          (!options.toDate || session.attendanceDate <= options.toDate) &&
          (!options.statuses || options.statuses.includes(session.status))
      );
      records = clone(records).sort((left, right) =>
        left.attendanceDate.localeCompare(right.attendanceDate)
      );
      const max = options.maxRecords || 300;
      return {
        records: records.slice(0, max),
        total: records.length,
        incomplete: records.length > max
      };
    },
    listAttendanceRecordsBySessions: async (sessionIds) => {
      const records = state.records.filter((record) =>
        sessionIds.includes(record.sessionId)
      );
      return { records: clone(records), total: records.length, incomplete: false };
    },
    listAttendanceRecordsByStudent: async (studentUserId) => {
      const records = state.records.filter(
        (record) => record.studentUserId === studentUserId
      );
      return { records: clone(records), total: records.length, incomplete: false };
    },
    listLeaveRequests: async (options = {}) => {
      let records = state.leaves.filter(
        (leave) =>
          (!options.sessionIds || options.sessionIds.includes(leave.sessionId)) &&
          (!options.studentUserIds ||
            options.studentUserIds.includes(leave.studentUserId)) &&
          (!options.statuses || options.statuses.includes(leave.status)) &&
          (!options.fromDate || leave.attendanceDate >= options.fromDate) &&
          (!options.toDate || leave.attendanceDate <= options.toDate)
      );
      return { records: clone(records), total: records.length, incomplete: false };
    },
    listTrainingFeedback: async (options = {}) => {
      let records = state.feedback.filter(
        (feedback) =>
          (!options.studentUserId || feedback.studentUserId === options.studentUserId) &&
          (!options.studentUserIds ||
            options.studentUserIds.includes(feedback.studentUserId)) &&
          (!options.trainingGroupId ||
            feedback.trainingGroupId === options.trainingGroupId) &&
          (!options.fromDate || feedback.attendanceDate >= options.fromDate) &&
          (!options.toDate || feedback.attendanceDate <= options.toDate)
      );
      records = clone(records).sort((left, right) =>
        right.attendanceDate.localeCompare(left.attendanceDate)
      );
      return { records, total: records.length, incomplete: false };
    },
    listApprovedPerformanceRecordsForStatistics: async (options = {}) => {
      let records = state.performances.filter(
        (record) =>
          record.status === 'approved' &&
          (!options.eventCode || record.eventCode === options.eventCode) &&
          (!options.studentUserIds ||
            options.studentUserIds.includes(record.studentUserId)) &&
          (!options.fromDate || record.achievedAt >= options.fromDate) &&
          (!options.toDate || record.achievedAt <= options.toDate)
      );
      records = clone(records).sort((left, right) => {
        if (left.achievedAt !== right.achievedAt) {
          return left.achievedAt.localeCompare(right.achievedAt);
        }
        return left._id.localeCompare(right._id);
      });
      const max = options.maxRecords || 10000;
      return {
        records: records.slice(0, max),
        total: records.length,
        incomplete: records.length > max
      };
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
  DISABLED_STUDENT,
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
