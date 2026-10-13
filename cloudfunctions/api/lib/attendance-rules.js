'use strict';

const {
  ATTENDANCE_RECORD_STATUS,
  ATTENDANCE_SESSION_STATUS,
  LEAVE_STATUS,
  MEMBERSHIP_STATUS
} = require('./constants');
const {
  clubTimeParts,
  dateOnlyFromValue,
  timeToMinutes
} = require('./dates');

const MIN_ATTENDANCE_SAMPLE_SESSIONS = 3;

function sessionPhase(session, now = new Date()) {
  if (session.status === ATTENDANCE_SESSION_STATUS.CANCELLED) {
    return 'cancelled';
  }
  const parts = clubTimeParts(now);
  if (parts.date < session.attendanceDate) {
    return 'not_started';
  }
  if (parts.date > session.attendanceDate) {
    return 'closed';
  }
  const openMinutes = timeToMinutes(session.checkInOpenTime);
  const closeMinutes = timeToMinutes(session.checkInCloseTime);
  if (parts.minutes < openMinutes) {
    return 'not_started';
  }
  if (parts.minutes > closeMinutes) {
    return 'closed';
  }
  return 'open';
}

function deriveStudentStatus(session, record, leave) {
  if (session.status === ATTENDANCE_SESSION_STATUS.CANCELLED) {
    return 'cancelled';
  }
  if (record) {
    return record.status;
  }
  if (leave && leave.status === LEAVE_STATUS.APPROVED) {
    return ATTENDANCE_RECORD_STATUS.LEAVE_APPROVED;
  }
  const phase = sessionPhase(session);
  if (phase === 'not_started') {
    return 'not_started';
  }
  if (phase === 'open') {
    return 'pending';
  }
  return ATTENDANCE_RECORD_STATUS.ABSENT;
}

function buildRosterSummary(roster) {
  const summary = {
    expected: 0,
    checkedIn: 0,
    late: 0,
    leaveApproved: 0,
    pendingVerification: 0,
    pending: 0,
    absent: 0
  };
  for (const item of roster) {
    summary.expected += 1;
    if (item.status === ATTENDANCE_RECORD_STATUS.CHECKED_IN) {
      summary.checkedIn += 1;
    } else if (item.status === ATTENDANCE_RECORD_STATUS.LATE) {
      summary.late += 1;
    } else if (item.status === ATTENDANCE_RECORD_STATUS.LEAVE_APPROVED) {
      summary.leaveApproved += 1;
    } else if (item.status === ATTENDANCE_RECORD_STATUS.PENDING_VERIFICATION) {
      summary.pendingVerification += 1;
    } else if (item.status === ATTENDANCE_RECORD_STATUS.ABSENT) {
      summary.absent += 1;
    } else {
      summary.pending += 1;
    }
  }
  return summary;
}

function membershipCoversDate(membership, date) {
  const assignedDate = dateOnlyFromValue(membership.assignedAt);
  const removedDate = dateOnlyFromValue(membership.removedAt);
  if (assignedDate && date < assignedDate) {
    return false;
  }
  if (removedDate && date > removedDate) {
    return false;
  }
  if (!assignedDate && membership.status !== MEMBERSHIP_STATUS.ACTIVE) {
    return false;
  }
  return true;
}

function emptyStudentTotals() {
  return {
    plannedExpected: 0,
    approvedLeave: 0,
    validAttendance: 0,
    rateExpected: 0,
    rateValid: 0,
    late: 0,
    pendingVerification: 0,
    absent: 0,
    pending: 0,
    notStarted: 0,
    groupIds: new Set()
  };
}

function groupRecordsBySession(records) {
  const map = new Map();
  for (const record of records) {
    const sessionId = record.sessionId;
    if (!sessionId) {
      continue;
    }
    const byStudent = map.get(sessionId) || new Map();
    byStudent.set(record.studentUserId, record);
    map.set(sessionId, byStudent);
  }
  return map;
}

function groupLeavesBySession(leaves) {
  const map = new Map();
  for (const leave of leaves) {
    const sessionId = leave.sessionId;
    if (!sessionId) {
      continue;
    }
    const byStudent = map.get(sessionId) || new Map();
    if (
      !byStudent.has(leave.studentUserId) ||
      leave.status === LEAVE_STATUS.APPROVED
    ) {
      byStudent.set(leave.studentUserId, leave);
    }
    map.set(sessionId, byStudent);
  }
  return map;
}

function groupMembershipsByGroup(memberships) {
  const map = new Map();
  for (const membership of memberships) {
    const groupId = membership.groupId;
    if (!groupId) {
      continue;
    }
    const list = map.get(groupId) || [];
    list.push(membership);
    map.set(groupId, list);
  }
  return map;
}

function aggregateAttendance(input) {
  const sessions = input.sessions || [];
  const studentFilter = input.studentIds
    ? new Set(input.studentIds)
    : null;
  const recordsBySession = groupRecordsBySession(input.records || []);
  const leavesBySession = groupLeavesBySession(input.leaves || []);
  const membershipsByGroup = groupMembershipsByGroup(input.memberships || []);
  const byStudent = new Map();
  const sessionCounts = {
    total: sessions.length,
    valid: 0,
    cancelled: 0,
    notStarted: 0,
    open: 0,
    closed: 0
  };
  const summary = {
    plannedExpected: 0,
    approvedLeave: 0,
    actualExpected: 0,
    validAttendance: 0,
    rateExpected: 0,
    rateValid: 0,
    late: 0,
    pendingVerification: 0,
    absent: 0,
    pending: 0,
    notStarted: 0
  };

  for (const session of sessions) {
    if (!session || !session.attendanceDate) {
      continue;
    }
    const phase = sessionPhase(session, input.now || new Date());
    if (phase === 'cancelled') {
      sessionCounts.cancelled += 1;
      continue;
    }
    sessionCounts.valid += 1;
    sessionCounts[phase] += 1;

    const candidates = new Set();
    const groupMemberships = membershipsByGroup.get(session.trainingGroupId) || [];
    for (const membership of groupMemberships) {
      if (membershipCoversDate(membership, session.attendanceDate)) {
        candidates.add(membership.userId);
      }
    }
    const sessionRecords = recordsBySession.get(session.sessionId || session._id) || new Map();
    const sessionLeaves = leavesBySession.get(session.sessionId || session._id) || new Map();
    for (const studentUserId of sessionRecords.keys()) {
      candidates.add(studentUserId);
    }
    for (const studentUserId of sessionLeaves.keys()) {
      candidates.add(studentUserId);
    }

    for (const studentUserId of candidates) {
      if (studentFilter && !studentFilter.has(studentUserId)) {
        continue;
      }
      const record = sessionRecords.get(studentUserId) || null;
      const leave = sessionLeaves.get(studentUserId) || null;
      const status = deriveStudentStatus(session, record, leave);
      if (status === 'cancelled') {
        continue;
      }
      const totals = byStudent.get(studentUserId) || emptyStudentTotals();
      totals.plannedExpected += 1;
      totals.groupIds.add(session.trainingGroupId);
      summary.plannedExpected += 1;

      if (status === ATTENDANCE_RECORD_STATUS.LEAVE_APPROVED) {
        totals.approvedLeave += 1;
        summary.approvedLeave += 1;
        byStudent.set(studentUserId, totals);
        continue;
      }

      if (
        status === ATTENDANCE_RECORD_STATUS.CHECKED_IN ||
        status === ATTENDANCE_RECORD_STATUS.LATE
      ) {
        totals.validAttendance += 1;
        summary.validAttendance += 1;
        if (status === ATTENDANCE_RECORD_STATUS.LATE) {
          totals.late += 1;
          summary.late += 1;
        }
      } else if (status === ATTENDANCE_RECORD_STATUS.PENDING_VERIFICATION) {
        totals.pendingVerification += 1;
        summary.pendingVerification += 1;
      } else if (status === ATTENDANCE_RECORD_STATUS.ABSENT) {
        totals.absent += 1;
        summary.absent += 1;
      } else if (status === 'not_started') {
        totals.notStarted += 1;
        summary.notStarted += 1;
      } else {
        totals.pending += 1;
        summary.pending += 1;
      }

      if (phase === 'closed') {
        totals.rateExpected += 1;
        summary.rateExpected += 1;
        if (
          status === ATTENDANCE_RECORD_STATUS.CHECKED_IN ||
          status === ATTENDANCE_RECORD_STATUS.LATE
        ) {
          totals.rateValid += 1;
          summary.rateValid += 1;
        }
      }
      byStudent.set(studentUserId, totals);
    }
  }

  summary.actualExpected = Math.max(
    0,
    summary.plannedExpected - summary.approvedLeave
  );
  summary.attendanceRate =
    summary.rateExpected > 0
      ? Number((summary.rateValid / summary.rateExpected).toFixed(4))
      : null;
  summary.lateRate =
    summary.rateValid > 0
      ? Number((summary.late / summary.rateValid).toFixed(4))
      : null;

  return { byStudent, summary, sessionCounts };
}

function buildStudentAttendanceRows(aggregate, profilesMap = new Map(), groupsMap = new Map()) {
  const rows = Array.from(aggregate.byStudent.entries()).map(
    ([studentUserId, totals]) => {
      const actualExpected = Math.max(
        0,
        totals.plannedExpected - totals.approvedLeave
      );
      const profile = profilesMap.get(studentUserId) || {};
      const groupNames = Array.from(totals.groupIds)
        .map((groupId) => groupsMap.get(groupId) || {})
        .map((group) => group.name)
        .filter(Boolean);
      return {
        studentUserId,
        studentName: profile.name || '未命名学生',
        trainingGroupIds: Array.from(totals.groupIds),
        trainingGroupNames: groupNames,
        plannedExpected: totals.plannedExpected,
        approvedLeave: totals.approvedLeave,
        actualExpected,
        validAttendance: totals.validAttendance,
        late: totals.late,
        pendingVerification: totals.pendingVerification,
        absent: totals.absent,
        pending: totals.pending,
        notStarted: totals.notStarted,
        sampleSessions: totals.rateExpected,
        sampleSufficient:
          totals.rateExpected >= MIN_ATTENDANCE_SAMPLE_SESSIONS,
        attendanceRate:
          totals.rateExpected > 0
            ? Number((totals.rateValid / totals.rateExpected).toFixed(4))
            : null,
        lateRate:
          totals.rateValid > 0
            ? Number((totals.late / totals.rateValid).toFixed(4))
            : null
      };
    }
  );

  rows.sort((left, right) => {
    if (left.sampleSufficient !== right.sampleSufficient) {
      return left.sampleSufficient ? -1 : 1;
    }
    if (left.attendanceRate !== right.attendanceRate) {
      return (right.attendanceRate || 0) - (left.attendanceRate || 0);
    }
    if (left.actualExpected !== right.actualExpected) {
      return right.actualExpected - left.actualExpected;
    }
    return left.studentName.localeCompare(right.studentName, 'zh-CN');
  });

  let lastRate = null;
  let lastRank = 0;
  rows.forEach((row, index) => {
    if (!row.sampleSufficient || row.attendanceRate === null) {
      row.rank = null;
      return;
    }
    if (lastRate === null || row.attendanceRate !== lastRate) {
      lastRank = index + 1;
      lastRate = row.attendanceRate;
    }
    row.rank = lastRank;
  });
  return rows;
}

function buildAttendanceDetailRows(input) {
  const rows = [];
  const studentFilter = input.studentIds ? new Set(input.studentIds) : null;
  const recordsBySession = groupRecordsBySession(input.records || []);
  const leavesBySession = groupLeavesBySession(input.leaves || []);
  const membershipsByGroup = groupMembershipsByGroup(input.memberships || []);
  for (const session of input.sessions || []) {
    if (!session || session.status === ATTENDANCE_SESSION_STATUS.CANCELLED) {
      continue;
    }
    const phase = sessionPhase(session, input.now || new Date());
    const sessionId = session.sessionId || session._id;
    const candidates = new Set();
    for (const membership of membershipsByGroup.get(session.trainingGroupId) || []) {
      if (membershipCoversDate(membership, session.attendanceDate)) {
        candidates.add(membership.userId);
      }
    }
    const sessionRecords = recordsBySession.get(sessionId) || new Map();
    const sessionLeaves = leavesBySession.get(sessionId) || new Map();
    for (const studentUserId of sessionRecords.keys()) candidates.add(studentUserId);
    for (const studentUserId of sessionLeaves.keys()) candidates.add(studentUserId);
    for (const studentUserId of candidates) {
      if (studentFilter && !studentFilter.has(studentUserId)) continue;
      const record = sessionRecords.get(studentUserId) || null;
      const leave = sessionLeaves.get(studentUserId) || null;
      rows.push({
        sessionId,
        trainingGroupId: session.trainingGroupId,
        attendanceDate: session.attendanceDate,
        studentUserId,
        status: deriveStudentStatus(session, record, leave),
        phase,
        checkInAt: record && record.checkInAt ? record.checkInAt : null,
        late: Boolean(record && record.status === ATTENDANCE_RECORD_STATUS.LATE),
        leaveStatus: leave ? leave.status : '',
        manualVerified: Boolean(record && record.source === 'manual'),
        recordSource: record ? record.source || '' : ''
      });
    }
  }
  return rows.sort((left, right) => {
    if (left.attendanceDate !== right.attendanceDate) {
      return left.attendanceDate.localeCompare(right.attendanceDate);
    }
    if (left.sessionId !== right.sessionId) {
      return left.sessionId.localeCompare(right.sessionId);
    }
    return left.studentUserId.localeCompare(right.studentUserId);
  });
}

function buildAttendanceStatistics(input) {
  const aggregate = aggregateAttendance(input);
  const rows = buildStudentAttendanceRows(
    aggregate,
    input.profilesMap,
    input.groupsMap
  );
  return {
    summary: aggregate.summary,
    sessionCounts: aggregate.sessionCounts,
    students: rows,
    dataQuality: {
      membershipHistoryReliable: false,
      membershipHistoryEstimated: true,
      membershipHistoryNote:
        '现有成员关系没有逐场名单快照，历史场次名单按成员加入和退出时间推算，可能无法还原所有历史变更。',
      rateBasis: 'closed_sessions_only',
      minSampleSessions: MIN_ATTENDANCE_SAMPLE_SESSIONS,
      hasOpenSessions: aggregate.sessionCounts.open > 0
    }
  };
}

module.exports = {
  buildAttendanceDetailRows,
  MIN_ATTENDANCE_SAMPLE_SESSIONS,
  aggregateAttendance,
  buildAttendanceStatistics,
  buildRosterSummary,
  buildStudentAttendanceRows,
  deriveStudentStatus,
  membershipCoversDate,
  sessionPhase
};
