'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createStatisticsActions = require('../../cloudfunctions/api/actions/statistics');
const { clubDateOnly } = require('../../cloudfunctions/api/lib/dates');
const {
  GROUP_A,
  IDENTITIES,
  STUDENT_A,
  createHarness
} = require('../phase6/helpers');

function currentPayload(extra = {}) {
  const today = clubDateOnly();
  return {
    periodType: 'month',
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    ...extra
  };
}

test('V1.6.2 管理统计与导出不包含无实名资料学生', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  const unnamedUserId = 'usr_v162_stats_unnamed';
  harness.state.usersByOpenId.set('openid_v162_stats_unnamed', {
    _id: unnamedUserId,
    status: 'active',
    roles: ['student']
  });
  harness.state.memberships.push({
    _id: 'member_v162_stats_unnamed',
    userId: unnamedUserId,
    groupId: GROUP_A,
    roleInGroup: 'student',
    status: 'active',
    assignedAt: new Date('2026-01-01T00:00:00.000Z')
  });
  harness.state.profiles.set(unnamedUserId, {
    _id: 'profile_v162_stats_unnamed',
    userId: unnamedUserId,
    name: '   '
  });
  harness.state.sessions.push({
    _id: 'session_v162_stats',
    sessionId: 'session_v162_stats',
    trainingGroupId: GROUP_A,
    attendanceDate: today,
    status: 'scheduled'
  });
  harness.state.records.push(
    {
      _id: 'record_v162_named',
      sessionId: 'session_v162_stats',
      studentUserId: STUDENT_A._id,
      trainingGroupId: GROUP_A,
      attendanceDate: today,
      status: 'checked_in'
    },
    {
      _id: 'record_v162_unnamed',
      sessionId: 'session_v162_stats',
      studentUserId: unnamedUserId,
      trainingGroupId: GROUP_A,
      attendanceDate: today,
      status: 'checked_in'
    }
  );
  harness.state.performances.push(
    {
      _id: 'performance_v162_named',
      performanceId: 'performance_v162_named',
      studentUserId: STUDENT_A._id,
      eventCode: '100m',
      eventName: '100米',
      value: 12.1,
      unit: '秒',
      comparison: 'lower',
      achievedAt: today,
      status: 'approved'
    },
    {
      _id: 'performance_v162_unnamed',
      performanceId: 'performance_v162_unnamed',
      studentUserId: unnamedUserId,
      eventCode: '100m',
      eventName: '100米',
      value: 11.1,
      unit: '秒',
      comparison: 'lower',
      achievedAt: today,
      status: 'approved'
    }
  );

  const actions = createStatisticsActions({ repository: harness.repository });
  const overview = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.developer,
    payload: currentPayload()
  });
  const performanceExport = await actions['export.performance_rows']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ maxRows: 50 })
  });
  const attendanceExport = await actions['export.attendance_rows']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ maxRows: 50 })
  });

  assert.equal(overview.scope.studentCount, 3);
  assert.equal(
    overview.performance.rows === undefined ||
      overview.performance.rows.every((row) => row.studentUserId !== unnamedUserId),
    true
  );
  assert.equal(
    performanceExport.rows.some((row) => row.studentUserId === unnamedUserId),
    false
  );
  assert.equal(
    attendanceExport.rows.some((row) => row.studentUserId === unnamedUserId),
    false
  );
  assert.equal(
    performanceExport.rows.some((row) => row.studentUserId === STUDENT_A._id),
    true
  );
  assert.equal(
    attendanceExport.rows.some((row) => row.studentUserId === STUDENT_A._id),
    true
  );
});
