'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createReportActions = require('../../cloudfunctions/api/actions/report');

const STUDENT_A = { _id: 'usr_student_a', status: 'active', roles: ['student'] };
const STUDENT_B = { _id: 'usr_student_b', status: 'active', roles: ['student'] };
const COACH = { _id: 'usr_coach_a', status: 'active', roles: ['coach'] };
const DEVELOPER = {
  _id: 'usr_developer',
  status: 'active',
  roles: ['developer']
};
const DISABLED_COACH = {
  _id: 'usr_coach_disabled',
  status: 'disabled',
  roles: ['coach']
};
const IDENTITIES = {
  student: { appid: 'wx_test_app', openid: 'openid_student_0001' },
  coach: { appid: 'wx_test_app', openid: 'openid_coach_0001' },
  developer: { appid: 'wx_test_app', openid: 'openid_developer_0001' },
  disabledCoach: {
    appid: 'wx_test_app',
    openid: 'openid_coach_disabled_0001'
  }
};

function createRepository() {
  const profiles = new Map([
    [
      STUDENT_A._id,
      {
        _id: 'profile_a',
        userId: STUDENT_A._id,
        name: '模拟学生甲',
        examGoal: {}
      }
    ],
    [
      STUDENT_B._id,
      {
        _id: 'profile_b',
        userId: STUDENT_B._id,
        name: '模拟学生乙',
        examGoal: {}
      }
    ]
  ]);

  return {
    ensureUser: async (identity) => {
      if (identity.openid === IDENTITIES.student.openid) {
        return { ...STUDENT_A };
      }
      if (identity.openid === IDENTITIES.coach.openid) {
        return { ...COACH };
      }
      if (identity.openid === IDENTITIES.disabledCoach.openid) {
        return { ...DISABLED_COACH };
      }
      return { ...DEVELOPER };
    },
    getProfile: async (userId) => profiles.get(userId) || null,
    listMeasurementsForReport: async () => ({
      records: [],
      total: 0,
      incomplete: false
    }),
    listApprovedPerformanceRecords: async (userId) =>
      userId === STUDENT_A._id
        ? {
            records: [
              {
                _id: 'perf_a_1',
                eventCode: '100m',
                eventName: '100米',
                value: 12.8,
                unit: '秒',
                comparison: 'lower',
                achievedAt: new Date('2026-02-01T00:00:00.000Z'),
                status: 'approved'
              }
            ],
            total: 1,
            incomplete: false
          }
        : { records: [], total: 0, incomplete: false },
    getUserById: async (userId) =>
      userId === STUDENT_A._id
        ? { ...STUDENT_A }
        : userId === STUDENT_B._id
          ? { ...STUDENT_B }
          : null,
    getCoachGroupIds: async () => ['group_a'],
    getStudentUserIdsForGroups: async () => [STUDENT_A._id]
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

test('student reads only own report', async () => {
  const actions = createReportActions({ repository: createRepository() });
  const result = await actions['report.get_my_report']({
    identity: IDENTITIES.student,
    payload: {}
  });
  assert.equal(result.report.profile.userId, STUDENT_A._id);
  assert.equal(result.report.personalBests[0].value, 12.8);
});

test('coach report access is limited to assigned groups', async () => {
  const actions = createReportActions({ repository: createRepository() });
  const own = await actions['admin.get_student_report']({
    identity: IDENTITIES.coach,
    payload: { targetUserId: STUDENT_A._id }
  });
  assert.equal(own.report.profile.userId, STUDENT_A._id);

  const error = await captureError(
    actions['admin.get_student_report']({
      identity: IDENTITIES.coach,
      payload: { targetUserId: STUDENT_B._id }
    })
  );
  assert.equal(error.code, 'OUT_OF_SCOPE');
});

test('student cannot use administrator report action', async () => {
  const actions = createReportActions({ repository: createRepository() });
  const error = await captureError(
    actions['admin.get_student_report']({
      identity: IDENTITIES.student,
      payload: { targetUserId: STUDENT_B._id }
    })
  );
  assert.equal(error.code, 'FORBIDDEN');
});

test('student report ignores a client-supplied target user id', async () => {
  const actions = createReportActions({ repository: createRepository() });
  const result = await actions['report.get_my_report']({
    identity: IDENTITIES.student,
    payload: { targetUserId: STUDENT_B._id }
  });
  assert.equal(result.report.profile.userId, STUDENT_A._id);
  assert.equal(result.report.personalBests.length, 1);
});

test('developer can read any student report without group scope', async () => {
  const actions = createReportActions({ repository: createRepository() });
  const result = await actions['admin.get_student_report']({
    identity: IDENTITIES.developer,
    payload: { targetUserId: STUDENT_B._id }
  });
  assert.equal(result.report.profile.userId, STUDENT_B._id);
});

test('disabled coach cannot read a student report', async () => {
  const actions = createReportActions({ repository: createRepository() });
  const error = await captureError(
    actions['admin.get_student_report']({
      identity: IDENTITIES.disabledCoach,
      payload: { targetUserId: STUDENT_A._id }
    })
  );
  assert.equal(error.code, 'ACCOUNT_DISABLED');
});

test('report access rejects a target that is not an active student', async () => {
  const actions = createReportActions({ repository: createRepository() });
  const error = await captureError(
    actions['admin.get_student_report']({
      identity: IDENTITIES.developer,
      payload: { targetUserId: COACH._id }
    })
  );
  assert.equal(error.code, 'STUDENT_NOT_FOUND');
});

test('report keeps a personal best located beyond 300 approved records', async () => {
  const records = [];
  for (let index = 0; index < 350; index += 1) {
    records.push({
      _id: `perf_${index}`,
      eventCode: '100m',
      eventName: '100米',
      value: Number((20 - index * 0.01).toFixed(2)),
      unit: '秒',
      comparison: 'lower',
      achievedAt: new Date(2026, 0, 1 + index),
      status: 'approved'
    });
  }
  const repository = {
    ...createRepository(),
    listApprovedPerformanceRecords: async () => ({
      records,
      total: records.length,
      incomplete: false
    })
  };
  const actions = createReportActions({ repository });
  const result = await actions['report.get_my_report']({
    identity: IDENTITIES.student,
    payload: {}
  });

  assert.equal(result.report.personalBests[0].value, 16.51);
  assert.equal(result.report.stageChanges[0].latestValue, 16.51);
  assert.equal(result.report.performanceSeries['100m'].length, 120);
  assert.equal(result.report.performanceMeta.approvedTotal, 350);
});

test('report fails explicitly when approved history cannot be read completely', async () => {
  const repository = {
    ...createRepository(),
    listApprovedPerformanceRecords: async () => ({
      records: [],
      total: 400,
      incomplete: true
    })
  };
  const actions = createReportActions({ repository });
  const error = await captureError(
    actions['report.get_my_report']({ identity: IDENTITIES.student, payload: {} })
  );
  assert.equal(error.code, 'REPORT_INCOMPLETE');
});
