'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createStatisticsActions = require('../../cloudfunctions/api/actions/statistics');
const {
  ATTENDANCE_RECORD_STATUS,
  LEAVE_STATUS
} = require('../../cloudfunctions/api/lib/constants');
const {
  addDays,
  clubDateOnly,
  periodRange
} = require('../../cloudfunctions/api/lib/dates');
const {
  COACH_A,
  DEVELOPER,
  DISABLED_STUDENT,
  GROUP_A,
  GROUP_B,
  IDENTITIES,
  STUDENT_A,
  STUDENT_B,
  STUDENT_C,
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

function session(id, groupId, attendanceDate, overrides = {}) {
  return {
    _id: id,
    sessionId: id,
    trainingGroupId: groupId,
    attendanceDate,
    status: 'scheduled',
    checkInOpenTime: '00:00',
    checkInCloseTime: '23:59',
    lateAfterTime: '08:15',
    ...overrides
  };
}

function record(sessionId, studentUserId, status, overrides = {}) {
  return {
    _id: `record_${sessionId}_${studentUserId}`,
    sessionId,
    studentUserId,
    trainingGroupId: GROUP_A,
    attendanceDate: clubDateOnly(),
    status,
    source: 'gps',
    checkInAt: null,
    ...overrides
  };
}

function leave(sessionId, studentUserId, status, overrides = {}) {
  return {
    _id: `leave_${sessionId}_${studentUserId}`,
    leaveId: `leave_${sessionId}_${studentUserId}`,
    sessionId,
    studentUserId,
    trainingGroupId: GROUP_A,
    attendanceDate: clubDateOnly(),
    status,
    reason: '私人原因',
    ...overrides
  };
}

function performance(
  id,
  studentUserId,
  eventCode,
  value,
  achievedAt,
  status = 'approved',
  overrides = {}
) {
  const event = {
    '100m': { name: '100米', unit: '秒', comparison: 'lower' },
    long_jump: { name: '跳远', unit: '米', comparison: 'higher' }
  }[eventCode];
  return {
    _id: id,
    performanceId: id,
    studentUserId,
    eventCode,
    eventName: event.name,
    value,
    unit: event.unit,
    comparison: event.comparison,
    achievedAt,
    status,
    reviewedAt: new Date(`${achievedAt}T00:00:00.000Z`),
    source: 'student_report',
    ...overrides
  };
}

test('statistics meta respects each role scope', async () => {
  const harness = createHarness();
  const actions = createStatisticsActions({ repository: harness.repository });
  const developer = await actions['statistics.get_meta']({ identity: IDENTITIES.developer, payload: {} });
  assert.equal(developer.groups.length, 2);
  const coach = await actions['statistics.get_meta']({ identity: IDENTITIES.coachA, payload: {} });
  assert.deepEqual(coach.groups.map((group) => group.id), [GROUP_A]);
  const student = await actions['statistics.get_meta']({ identity: IDENTITIES.studentA, payload: {} });
  assert.deepEqual(student.groups.map((group) => group.id), [GROUP_A]);
});

test('coach cannot request another group statistics', async () => {
  const harness = createHarness();
  const actions = createStatisticsActions({ repository: harness.repository });
  const error = await captureError(
    actions['statistics.get_manage_overview']({
      identity: IDENTITIES.coachA,
      payload: currentPayload({ trainingGroupId: GROUP_B })
    })
  );
  assert.equal(error.code, 'OUT_OF_SCOPE');
});

test('performance leaderboard uses approved records and keeps historical PB separate', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  const older = addDays(today, -40);
  harness.state.performances.push(
    performance('perf_a_old', STUDENT_A._id, '100m', 11.5, older),
    performance('perf_a_current', STUDENT_A._id, '100m', 11.8, today),
    performance('perf_a_pending', STUDENT_A._id, '100m', 10.9, today, 'pending'),
    performance('perf_b_current', STUDENT_B._id, '100m', 12.0, today)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.performance']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ eventCode: '100m', trainingGroupId: GROUP_A })
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].studentUserId, STUDENT_A._id);
  assert.equal(result.rows[0].rank, 1);
  assert.equal(result.rows[0].value, 11.8);
  assert.equal(result.rows[0].historicalPersonalBest.value, 11.5);
  assert.equal(result.rows.some((row) => row.performanceId === 'perf_a_pending'), false);
});

test('performance leaderboard uses higher-is-better for distance events', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.performances.push(
    performance('jump_a', STUDENT_A._id, 'long_jump', 4.2, today),
    performance('jump_b', STUDENT_B._id, 'long_jump', 5.0, today)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.performance']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ eventCode: 'long_jump', trainingGroupId: GROUP_A })
  });
  assert.equal(result.rows[0].studentUserId, STUDENT_B._id);
  assert.equal(result.rows[0].value, 5.0);
});

test('performance leaderboard assigns standard tied ranks and stable order', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.memberships.push({
    _id: 'member_d_a',
    userId: 'usr_student_d',
    groupId: GROUP_A,
    roleInGroup: 'student',
    status: 'active',
    assignedAt: new Date('2026-01-01T00:00:00.000Z')
  });
  harness.state.profiles.set('usr_student_d', {
    userId: 'usr_student_d',
    name: '学生丁',
    examGoal: {}
  });
  harness.state.performances.push(
    performance('tie_a', STUDENT_A._id, '100m', 12.0, today),
    performance('tie_b', STUDENT_B._id, '100m', 12.0, today),
    performance('tie_d', 'usr_student_d', '100m', 12.4, today)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.performance']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ eventCode: '100m', trainingGroupId: GROUP_A })
  });
  assert.deepEqual(result.rows.map((row) => row.rank), [1, 1, 3]);
});

test('student sees own rank with other competitors masked', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.performances.push(
    performance('sa', STUDENT_A._id, '100m', 12.1, today),
    performance('sb', STUDENT_B._id, '100m', 11.9, today)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.performance']({
    identity: IDENTITIES.studentA,
    payload: currentPayload({ eventCode: '100m' })
  });
  const selfRow = result.rows.find((row) => row.studentUserId === STUDENT_A._id);
  const otherRow = result.rows.find((row) => row.studentUserId === STUDENT_B._id);
  assert.equal(selfRow.isSelf, true);
  assert.match(otherRow.studentName, /\*/);
});

test('developer sees authorized global performance data', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.performances.push(
    performance('global_a', STUDENT_A._id, '100m', 12.1, today),
    performance('global_c', STUDENT_C._id, '100m', 11.9, today)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.performance']({
    identity: IDENTITIES.developer,
    payload: currentPayload({ eventCode: '100m' })
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].studentUserId, STUDENT_C._id);
});

test('attendance statistics distinguish leave, verification, absence and open sessions', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.sessions.push(
    session('s1', GROUP_A, addDays(today, -6)),
    session('s2', GROUP_A, addDays(today, -5)),
    session('s3', GROUP_A, addDays(today, -4)),
    session('s4', GROUP_A, addDays(today, -3)),
    session('s_open', GROUP_A, today, {
      checkInOpenTime: '00:00',
      checkInCloseTime: '23:59'
    })
  );
  harness.state.records.push(
    record('s1', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.CHECKED_IN),
    record('s2', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.LATE),
    record('s3', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.PENDING_VERIFICATION)
  );
  harness.state.leaves.push(
    leave('s2', STUDENT_B._id, LEAVE_STATUS.APPROVED)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.attendance']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(result.summary.approvedLeave, 1);
  assert.equal(result.summary.pendingVerification, 1);
  assert.equal(result.summary.rateExpected, 7);
  assert.equal(result.summary.rateValid, 2);
  assert.equal(result.summary.attendanceRate, 0.2857);
  assert.equal(result.dataQuality.hasOpenSessions, true);
});

test('cancelled sessions are excluded from attendance denominators', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.sessions.push(
    session('cancelled', GROUP_A, addDays(today, -2), { status: 'cancelled' }),
    session('valid', GROUP_A, addDays(today, -1))
  );
  harness.state.records.push(
    record('valid', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.CHECKED_IN)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.attendance']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(result.sessionCounts.total, 2);
  assert.equal(result.sessionCounts.cancelled, 1);
  assert.equal(result.sessionCounts.closed, 1);
  assert.equal(result.summary.plannedExpected, 2);
});

test('zero denominator attendance rate is null instead of fake 100 percent', async () => {
  const harness = createHarness();
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.attendance']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(result.summary.attendanceRate, null);
  assert.equal(result.rows.length, 0);
});

test('attendance rows expose sample size and minimum sample marker', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.sessions.push(
    session('sample_1', GROUP_A, addDays(today, -2)),
    session('sample_2', GROUP_A, addDays(today, -1))
  );
  harness.state.records.push(
    record('sample_1', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.CHECKED_IN),
    record('sample_2', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.CHECKED_IN)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.attendance']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  const row = result.rows.find((item) => item.studentUserId === STUDENT_A._id);
  assert.equal(row.sampleSessions, 2);
  assert.equal(row.sampleSufficient, false);
  assert.equal(row.rank, null);
});

test('attendance ranking is withheld when membership history is ambiguous', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.sessions.push(
    session('limited_1', GROUP_A, addDays(today, -2)),
    session('limited_2', GROUP_A, addDays(today, -1))
  );
  harness.state.records.push(
    record('limited_1', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.CHECKED_IN),
    record('limited_2', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.CHECKED_IN)
  );
  harness.state.memberships.find(
    (membership) =>
      membership.userId === STUDENT_A._id &&
      membership.groupId === GROUP_A
  ).assignedAt = new Date(`${addDays(today, -2)}T00:00:00.000Z`);
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['leaderboard.attendance']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(result.dataQuality.formalAttendanceRankingAllowed, false);
  assert.equal(result.rows.find((row) => row.studentUserId === STUDENT_A._id).rank, null);
});

test('personal statistics include PB, attendance and RPE summary', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.sessions.push(session('personal_session', GROUP_A, addDays(today, -1)));
  harness.state.records.push(
    record('personal_session', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.CHECKED_IN)
  );
  harness.state.performances.push(
    performance('personal_pb', STUDENT_A._id, '100m', 12.2, today)
  );
  harness.state.feedback.push({
    _id: 'feedback_personal',
    feedbackId: 'feedback_personal',
    studentUserId: STUDENT_A._id,
    trainingGroupId: GROUP_A,
    attendanceDate: today,
    completionStatus: 'completed',
    rpe: 6,
    comment: '状态正常',
    coachComment: ''
  });
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['statistics.get_my_overview']({
    identity: IDENTITIES.studentA,
    payload: currentPayload()
  });
  assert.equal(result.performance.personalBests[0].value, 12.2);
  assert.equal(result.attendance.validAttendance, 1);
  assert.equal(result.feedback.total, 1);
  assert.equal(result.feedback.averageRpe, 6);
});

test('personal statistics separate period results from historical personal best', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.performances.push(
    performance('personal_old_pb', STUDENT_A._id, '100m', 11.5, addDays(today, -60)),
    performance('personal_current', STUDENT_A._id, '100m', 11.8, today)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['statistics.get_my_overview']({
    identity: IDENTITIES.studentA,
    payload: currentPayload()
  });
  assert.equal(result.performance.approvedCount, 1);
  assert.equal(result.performance.historicalApprovedCount, 2);
  assert.equal(result.performance.personalBests[0].value, 11.5);
  assert.equal(result.performance.latestPerformances[0].value, 11.8);
});

test('management overview summarizes groups and marks stable membership scope', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.sessions.push(session('manage_session', GROUP_A, addDays(today, -1)));
  harness.state.records.push(
    record('manage_session', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.CHECKED_IN)
  );
  harness.state.performances.push(
    performance('manage_perf', STUDENT_A._id, '100m', 12.0, today)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(result.scope.studentCount, 2);
  assert.equal(result.performance.approvedCount, 1);
  assert.equal(result.groupComparison[0].attendanceRate, 0.5);
  assert.equal(result.dataQuality.membershipHistoryReliable, true);
});

test('performance export only emits approved rows and enforces an explicit cap', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.performances.push(
    performance('export_ok', STUDENT_A._id, '100m', 12.2, today),
    performance('export_pending', STUDENT_A._id, '100m', 11.9, today, 'pending')
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['export.performance_rows']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A, maxRows: 10 })
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, 'approved');
  assert.equal(result.rows[0].studentName, '学生甲');

  const error = await captureError(
    actions['export.performance_rows']({
      identity: IDENTITIES.coachA,
      payload: currentPayload({ trainingGroupId: GROUP_A, maxRows: 0 })
    })
  );
  assert.equal(error.code, 'INVALID_FIELD');
});

test('performance export checks the exact row cap and detects one extra record', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  for (let index = 0; index < 2000; index += 1) {
    harness.state.performances.push(
      performance(`cap_${index}`, STUDENT_A._id, '100m', 11 + index / 1000, today)
    );
  }
  const actions = createStatisticsActions({ repository: harness.repository });
  const exact = await actions['export.performance_rows']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A, maxRows: 2000 })
  });
  assert.equal(exact.total, 2000);
  assert.equal(exact.rows.length, 2000);
  assert.equal(exact.truncated, false);

  harness.state.performances.push(
    performance('cap_extra', STUDENT_A._id, '100m', 12.5, today)
  );
  const tooLarge = await captureError(
    actions['export.performance_rows']({
      identity: IDENTITIES.coachA,
      payload: currentPayload({ trainingGroupId: GROUP_A, maxRows: 2000 })
    })
  );
  assert.equal(tooLarge.code, 'EXPORT_RANGE_TOO_LARGE');
});
test('attendance export omits leave reason and GPS coordinates', async () => {
  const harness = createHarness();
  const today = clubDateOnly();
  harness.state.sessions.push(session('export_attendance', GROUP_A, addDays(today, -1)));
  harness.state.records.push(
    record('export_attendance', STUDENT_A._id, ATTENDANCE_RECORD_STATUS.CHECKED_IN, {
      latitude: 30.1234,
      longitude: 120.1234
    })
  );
  harness.state.leaves.push(
    leave('export_attendance', STUDENT_B._id, LEAVE_STATUS.APPROVED)
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['export.attendance_rows']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A, maxRows: 20 })
  });
  assert.equal(result.rows.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(result.rows[0], 'reason'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.rows[0], 'latitude'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.rows[0], 'longitude'), false);
});

test('disabled student cannot read statistics', async () => {
  const harness = createHarness();
  const actions = createStatisticsActions({ repository: harness.repository });
  const error = await captureError(
    actions['statistics.get_my_overview']({
      identity: IDENTITIES.disabledStudent,
      payload: currentPayload()
    })
  );
  assert.equal(error.code, 'ACCOUNT_DISABLED');
});

test('statistics period helpers use UTC+8 quarter and end-exclusive boundaries', () => {
  const month = periodRange({ periodType: 'month', year: 2026, month: 10 });
  const quarter = periodRange({ periodType: 'quarter', year: 2026, quarter: 4 });
  const year = periodRange({ periodType: 'year', year: 2026 });
  assert.equal(month.startDate, '2026-10-01');
  assert.equal(month.endExclusive, '2026-11-01');
  assert.equal(quarter.startDate, '2026-10-01');
  assert.equal(quarter.endExclusive, '2027-01-01');
  assert.equal(year.startDate, '2026-01-01');
  assert.equal(year.endExclusive, '2027-01-01');
});

test('feedback summary reports completion and attention without ranking RPE', async () => {
  const harness = createHarness();
  harness.state.feedback.push(
    {
      _id: 'fb1',
      studentUserId: STUDENT_A._id,
      trainingGroupId: GROUP_A,
      attendanceDate: clubDateOnly(),
      completionStatus: 'not_completed',
      rpe: 9,
      comment: '身体不适',
      coachComment: '已关注'
    }
  );
  const actions = createStatisticsActions({ repository: harness.repository });
  const result = await actions['statistics.get_manage_overview']({
    identity: IDENTITIES.coachA,
    payload: currentPayload({ trainingGroupId: GROUP_A })
  });
  assert.equal(result.feedback.total, 1);
  assert.equal(result.feedback.attentionCount, 1);
  assert.equal(result.feedback.coachReviewed, 1);
});
