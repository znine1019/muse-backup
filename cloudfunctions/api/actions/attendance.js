'use strict';

const {
  ATTENDANCE_RECORD_STATUS,
  ATTENDANCE_SESSION_STATUS,
  AUDIT_ACTIONS,
  COLLECTIONS,
  LEAVE_STATUS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const {
  clubDateOnly,
  clubTimeParts,
  timeToMinutes
} = require('../lib/dates');
const { fail } = require('../lib/errors');
const {
  buildRosterSummary,
  deriveStudentStatus,
  sessionPhase
} = require('../lib/attendance-rules');
const { haversineMeters, roundCoordinate } = require('../lib/geo');
const { loadActiveActor } = require('../lib/session');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  validateAttendanceCheckInPayload,
  validateAttendanceManualPayload,
  validateAttendanceQueryPayload,
  validateAttendanceSessionActionPayload,
  validateAttendanceSessionCreatePayload,
  validateAttendanceSessionUpdatePayload,
  validateLeaveCancelPayload,
  validateLeaveCreatePayload,
  validateLeaveReviewPayload
} = require('../lib/validation');

function isDeveloper(actor) {
  return actor.roles.includes(ROLES.DEVELOPER);
}


function readableSession(session, extra = {}) {
  return {
    id: session._id,
    sessionId: session.sessionId || session._id,
    trainingGroupId: session.trainingGroupId,
    trainingGroupName: extra.trainingGroupName || '',
    planId: session.planId || '',
    title: session.title || '',
    attendanceDate: session.attendanceDate,
    locationName: session.locationName,
    radiusMeters: session.radiusMeters,
    accuracyThresholdMeters: session.accuracyThresholdMeters,
    checkInOpenTime: session.checkInOpenTime,
    checkInCloseTime: session.checkInCloseTime,
    lateAfterTime: session.lateAfterTime,
    status: session.status,
    phase: extra.phase || sessionPhase(session),
    version: Number(session.version) || 1,
    createdBy: session.createdBy,
    createdAt: session.createdAt || null,
    updatedAt: session.updatedAt || null
  };
}

function readableRecord(record) {
  return {
    recordId: record._id,
    sessionId: record.sessionId,
    studentUserId: record.studentUserId,
    trainingGroupId: record.trainingGroupId,
    attendanceDate: record.attendanceDate,
    status: record.status,
    checkInAt: record.checkInAt || null,
    distanceMeters: record.distanceMeters,
    accuracyMeters: record.accuracyMeters,
    verificationReason: record.verificationReason || '',
    source: record.source || 'gps',
    leaveRequestId: record.leaveRequestId || '',
    originalStatus: record.originalStatus || '',
    adjustedBy: record.adjustedBy || '',
    adjustedAt: record.adjustedAt || null,
    adjustReason: record.adjustReason || '',
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
  };
}

function readableLeave(leave, extra = {}) {
  return {
    id: leave._id,
    leaveId: leave.leaveId || leave._id,
    studentUserId: leave.studentUserId,
    studentName: extra.studentName || '',
    trainingGroupId: leave.trainingGroupId,
    trainingGroupName: extra.trainingGroupName || '',
    sessionId: leave.sessionId,
    attendanceDate: leave.attendanceDate,
    sessionTitle: extra.sessionTitle || '',
    reason: leave.reason,
    status: leave.status,
    reviewedBy: leave.reviewedBy || '',
    reviewedAt: leave.reviewedAt || null,
    reviewComment: leave.reviewComment || '',
    cancelledAt: leave.cancelledAt || null,
    createdAt: leave.createdAt || null,
    updatedAt: leave.updatedAt || null
  };
}



function createAttendanceActions({ repository }) {
  async function loadManageActor(identity) {
    return loadActiveActor(repository, identity, [
      ROLES.COACH,
      ROLES.DEVELOPER
    ]);
  }

  async function assertGroupManageable(actor, trainingGroupId) {
    const group = await repository.getTrainingGroup(trainingGroupId);
    if (!group) {
      fail('TRAINING_GROUP_NOT_FOUND', '训练组不存在。');
    }
    if (!isDeveloper(actor)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      if (!groupIds.includes(trainingGroupId)) {
        fail('OUT_OF_SCOPE', '只能管理本人负责训练组的考勤。');
      }
    }
    return group;
  }

  async function listManageSessions({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateAttendanceQueryPayload(payload || {});
    let groupIds = null;
    if (!isDeveloper(actor)) {
      groupIds = await repository.getCoachGroupIds(actor._id);
      if (input.trainingGroupId && !groupIds.includes(input.trainingGroupId)) {
        fail('OUT_OF_SCOPE', '只能查看本人负责训练组的考勤。');
      }
    }

    const result = await repository.listAttendanceSessions({
      groupIds: input.trainingGroupId ? [input.trainingGroupId] : groupIds,
      statuses: null,
      fromDate: input.date || input.fromDate,
      toDate: input.date || input.toDate,
      maxRecords: 300
    });
    const groupIdsInResult = Array.from(
      new Set(result.records.map((session) => session.trainingGroupId))
    );
    const groupsMap = await repository.getGroupsMap(groupIdsInResult);

    return {
      sessions: result.records.map((session) =>
        readableSession(session, {
          trainingGroupName: (groupsMap.get(session.trainingGroupId) || {}).name || ''
        })
      ),
      total: result.total,
      truncated: result.incomplete
    };
  }

  async function getSessionRoster({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const sessionId = String((payload && payload.sessionId) || '');
    const session = await repository.getAttendanceSession(sessionId);
    if (!session) {
      fail('SESSION_NOT_FOUND', '考勤场次不存在。');
    }
    const group = await assertGroupManageable(actor, session.trainingGroupId);
    const studentIds = await repository.getStudentUserIdsForGroups([
      session.trainingGroupId
    ]);
    const [profilesMap, recordsResult, leavesResult] = await Promise.all([
      repository.getProfilesMap(studentIds),
      repository.listAttendanceRecordsBySession(sessionId),
      repository.listLeaveRequests({
        sessionIds: [sessionId],
        statuses: [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED]
      })
    ]);
    const recordsMap = new Map(
      recordsResult.records.map((record) => [record.studentUserId, record])
    );
    const leavesMap = new Map(
      leavesResult.records.map((leave) => [leave.studentUserId, leave])
    );

    const roster = studentIds.map((studentUserId) => {
      const record = recordsMap.get(studentUserId) || null;
      const leave = leavesMap.get(studentUserId) || null;
      return {
        studentUserId,
        studentName: (profilesMap.get(studentUserId) || {}).name || '',
        status: deriveStudentStatus(session, record, leave),
        leaveStatus: leave ? leave.status : '',
        leaveReason: leave && leave.status === LEAVE_STATUS.APPROVED ? leave.reason : '',
        record: record ? readableRecord(record) : null
      };
    });

    return {
      session: readableSession(session, { trainingGroupName: group.name }),
      roster,
      summary: buildRosterSummary(roster)
    };
  }

  async function createSession({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateAttendanceSessionCreatePayload(payload);
    const group = await assertGroupManageable(actor, input.trainingGroupId);
    if (group.enabled !== true) {
      fail('TRAINING_GROUP_DISABLED', '训练组已停用，不能创建考勤场次。');
    }
    if (input.planId) {
      const plan = await repository.getTrainingPlan(input.planId);
      if (!plan || plan.trainingGroupId !== input.trainingGroupId) {
        fail('PLAN_NOT_FOUND', '关联训练计划不存在或不属于该训练组。');
      }
    }

    const sessionId = repository.attendanceSessionIdForRequest(
      actor._id,
      input.clientRequestId
    );
    const existing = await repository.getAttendanceSession(sessionId);
    if (existing) {
      return {
        session: readableSession(existing, { trainingGroupName: group.name }),
        duplicate: true
      };
    }

    const now = new Date();
    const sessionData = {
      sessionId,
      trainingGroupId: input.trainingGroupId,
      planId: input.planId,
      title: input.title,
      attendanceDate: input.attendanceDate,
      locationName: input.locationName,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      accuracyThresholdMeters: input.accuracyThresholdMeters,
      checkInOpenTime: input.checkInOpenTime,
      checkInCloseTime: input.checkInCloseTime,
      lateAfterTime: input.lateAfterTime,
      status: ATTENDANCE_SESSION_STATUS.SCHEDULED,
      version: 1,
      createdBy: actor._id,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };

    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.ATTENDANCE_SESSIONS)
        .doc(sessionId);
      const current = await getDocumentOrNull(reference);
      if (current) {
        return;
      }
      await reference.set({ data: sessionData });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_attendance_session_create_${sessionId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.ATTENDANCE_SESSION_CREATED,
            targetType: 'attendance_session',
            targetId: sessionId,
            result: 'success',
            metadata: {
              trainingGroupId: input.trainingGroupId,
              attendanceDate: input.attendanceDate,
              planId: input.planId
            },
            createdAt: now
          }
        });
    });

    const created = await repository.getAttendanceSession(sessionId);
    return {
      session: readableSession(created, { trainingGroupName: group.name }),
      duplicate: false
    };
  }

  async function updateSession({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateAttendanceSessionUpdatePayload(payload);
    const session = await repository.getAttendanceSession(input.sessionId);
    if (!session) {
      fail('SESSION_NOT_FOUND', '考勤场次不存在。');
    }
    const group = await assertGroupManageable(actor, session.trainingGroupId);
    if (sessionPhase(session) !== 'not_started') {
      fail('SESSION_ALREADY_STARTED', '考勤已开始，不能修改场次配置。');
    }

    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.ATTENDANCE_SESSIONS)
        .doc(input.sessionId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('SESSION_NOT_FOUND', '考勤场次不存在。');
      }
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('SESSION_VERSION_CONFLICT', '考勤场次已被其他操作更新，请重新加载。');
      }
      const update = {
        title: input.title,
        attendanceDate: input.attendanceDate,
        locationName: input.locationName,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        accuracyThresholdMeters: input.accuracyThresholdMeters,
        checkInOpenTime: input.checkInOpenTime,
        checkInCloseTime: input.checkInCloseTime,
        lateAfterTime: input.lateAfterTime,
        version: input.expectedVersion + 1,
        updatedAt: now
      };
      await reference.update({ data: update });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_attendance_session_update_${input.sessionId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.ATTENDANCE_SESSION_UPDATED,
            targetType: 'attendance_session',
            targetId: input.sessionId,
            result: 'success',
            metadata: {
              fromVersion: input.expectedVersion,
              toVersion: input.expectedVersion + 1
            },
            createdAt: now
          }
        });
    });

    const updated = await repository.getAttendanceSession(input.sessionId);
    return { session: readableSession(updated, { trainingGroupName: group.name }) };
  }

  async function cancelSession({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateAttendanceSessionActionPayload(payload);
    const session = await repository.getAttendanceSession(input.sessionId);
    if (!session) {
      fail('SESSION_NOT_FOUND', '考勤场次不存在。');
    }
    const group = await assertGroupManageable(actor, session.trainingGroupId);
    if (session.status === ATTENDANCE_SESSION_STATUS.CANCELLED) {
      return {
        session: readableSession(session, { trainingGroupName: group.name }),
        alreadyCancelled: true
      };
    }
    if (sessionPhase(session) === 'closed') {
      fail('SESSION_CLOSED', '考勤已结束，不能取消场次。');
    }

    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.ATTENDANCE_SESSIONS)
        .doc(input.sessionId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('SESSION_NOT_FOUND', '考勤场次不存在。');
      }
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('SESSION_VERSION_CONFLICT', '考勤场次已被其他操作更新，请重新加载。');
      }
      await reference.update({
        data: {
          status: ATTENDANCE_SESSION_STATUS.CANCELLED,
          version: input.expectedVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_attendance_session_cancel_${input.sessionId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.ATTENDANCE_SESSION_CANCELLED,
            targetType: 'attendance_session',
            targetId: input.sessionId,
            result: 'success',
            metadata: { fromVersion: input.expectedVersion },
            createdAt: now
          }
        });
    });

    const updated = await repository.getAttendanceSession(input.sessionId);
    return {
      session: readableSession(updated, { trainingGroupName: group.name }),
      alreadyCancelled: false
    };
  }

  async function checkIn({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateAttendanceCheckInPayload(payload);
    const session = await repository.getAttendanceSession(input.sessionId);
    if (!session) {
      fail('SESSION_NOT_FOUND', '考勤场次不存在。');
    }
    if (session.status === ATTENDANCE_SESSION_STATUS.CANCELLED) {
      fail('SESSION_CANCELLED', '该考勤场次已取消。');
    }
    const group = await repository.getTrainingGroup(session.trainingGroupId);
    if (!group || group.enabled !== true) {
      fail('TRAINING_GROUP_DISABLED', '训练组已停用，不能签到。');
    }
    const groupIds = await repository.getStudentGroupIds(actor._id);
    if (!groupIds.includes(session.trainingGroupId)) {
      fail('OUT_OF_SCOPE', '只能签到本人所属训练组的考勤。');
    }
    const phase = sessionPhase(session);
    if (phase !== 'open') {
      fail('CHECK_IN_NOT_OPEN', '当前不在签到开放时间内。');
    }

    const existing = await repository.getAttendanceRecord(
      input.sessionId,
      actor._id
    );
    if (existing) {
      return {
        record: readableRecord(existing),
        duplicate: true
      };
    }

    const distanceMeters = haversineMeters(
      session.latitude,
      session.longitude,
      input.latitude,
      input.longitude
    );
    const accuracy = input.accuracy === null ? null : input.accuracy;
    const tolerance = Math.min(Math.max(accuracy || 0, 0), 50);
    if (distanceMeters > session.radiusMeters + tolerance) {
      fail('OUT_OF_RANGE', '当前位置超出签到范围，请联系教练人工核实。');
    }

    const now = new Date();
    const parts = clubTimeParts(now);
    const lateAfterMinutes = timeToMinutes(session.lateAfterTime);
    let status = ATTENDANCE_RECORD_STATUS.CHECKED_IN;
    let verificationReason = '';
    if (distanceMeters > session.radiusMeters) {
      status = ATTENDANCE_RECORD_STATUS.PENDING_VERIFICATION;
      verificationReason = 'near_boundary';
    } else if (accuracy === null) {
      status = ATTENDANCE_RECORD_STATUS.PENDING_VERIFICATION;
      verificationReason = 'accuracy_unknown';
    } else if (accuracy > session.accuracyThresholdMeters) {
      status = ATTENDANCE_RECORD_STATUS.PENDING_VERIFICATION;
      verificationReason = 'low_accuracy';
    } else if (parts.minutes > lateAfterMinutes) {
      status = ATTENDANCE_RECORD_STATUS.LATE;
    }

    const recordId = repository.attendanceRecordId(input.sessionId, actor._id);
    const recordData = {
      recordId,
      sessionId: input.sessionId,
      studentUserId: actor._id,
      trainingGroupId: session.trainingGroupId,
      attendanceDate: session.attendanceDate,
      status,
      checkInAt: now,
      latitude: roundCoordinate(input.latitude, 4),
      longitude: roundCoordinate(input.longitude, 4),
      accuracyMeters: accuracy,
      distanceMeters,
      verificationReason,
      source: 'gps',
      leaveRequestId: '',
      originalStatus: '',
      adjustedBy: '',
      adjustedAt: null,
      adjustReason: '',
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };

    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.ATTENDANCE_RECORDS)
        .doc(recordId);
      const current = await getDocumentOrNull(reference);
      if (current) {
        return;
      }
      await reference.set({ data: recordData });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_attendance_checkin_${recordId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.ATTENDANCE_CHECKED_IN,
            targetType: 'attendance_record',
            targetId: recordId,
            result: 'success',
            metadata: {
              sessionId: input.sessionId,
              status,
              verificationReason,
              distanceBand:
                distanceMeters <= session.radiusMeters ? 'inside' : 'boundary'
            },
            createdAt: now
          }
        });
    });

    const created = await repository.getAttendanceRecord(
      input.sessionId,
      actor._id
    );
    return {
      record: readableRecord(created),
      duplicate: false
    };
  }

  async function manualVerify({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateAttendanceManualPayload(payload);
    const session = await repository.getAttendanceSession(input.sessionId);
    if (!session) {
      fail('SESSION_NOT_FOUND', '考勤场次不存在。');
    }
    await assertGroupManageable(actor, session.trainingGroupId);

    const studentIds = await repository.getStudentUserIdsForGroups([
      session.trainingGroupId
    ]);
    if (!studentIds.includes(input.studentUserId)) {
      fail('OUT_OF_SCOPE', '该学生不属于本考勤场次的训练组。');
    }

    const recordId = repository.attendanceRecordId(
      input.sessionId,
      input.studentUserId
    );
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.ATTENDANCE_RECORDS)
        .doc(recordId);
      const current = await getDocumentOrNull(reference);
      if (current) {
        await reference.update({
          data: {
            status: input.status,
            originalStatus: current.originalStatus || current.status,
            adjustedBy: actor._id,
            adjustedAt: now,
            adjustReason: input.reason,
            verificationReason: current.verificationReason || 'manual_verified',
            updatedAt: now
          }
        });
      } else {
        await reference.set({
          data: {
            recordId,
            sessionId: input.sessionId,
            studentUserId: input.studentUserId,
            trainingGroupId: session.trainingGroupId,
            attendanceDate: session.attendanceDate,
            status: input.status,
            checkInAt: null,
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            distanceMeters: null,
            verificationReason: 'manual_verified',
            source: 'manual',
            leaveRequestId: '',
            originalStatus: '',
            adjustedBy: actor._id,
            adjustedAt: now,
            adjustReason: input.reason,
            createdAt: now,
            updatedAt: now,
            schemaVersion: 1
          }
        });
      }

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_attendance_manual_${recordId}_${now.getTime()}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.ATTENDANCE_MANUAL_VERIFIED,
            targetType: 'attendance_record',
            targetId: recordId,
            result: 'success',
            metadata: {
              sessionId: input.sessionId,
              studentUserId: input.studentUserId,
              status: input.status,
              reason: input.reason
            },
            createdAt: now
          }
        });
    });

    const updated = await repository.getAttendanceRecord(
      input.sessionId,
      input.studentUserId
    );
    return { record: readableRecord(updated) };
  }

  async function getStudentToday({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const date = clubDateOnly();
    const groupIds = await repository.getStudentGroupIds(actor._id);
    if (!groupIds.length) {
      return { date, sessions: [] };
    }
    const groupsMap = await repository.getGroupsMap(groupIds);
    const enabledGroupIds = groupIds.filter(
      (groupId) => (groupsMap.get(groupId) || {}).enabled === true
    );
    if (!enabledGroupIds.length) {
      return { date, sessions: [] };
    }

    const sessionsResult = await repository.listAttendanceSessions({
      groupIds: enabledGroupIds,
      fromDate: date,
      toDate: date,
      maxRecords: 100
    });
    const sessionIds = sessionsResult.records.map(
      (session) => session.sessionId || session._id
    );
    const [recordsResult, leavesResult] = await Promise.all([
      repository.listAttendanceRecordsByStudent(actor._id, {
        fromDate: date,
        toDate: date
      }),
      sessionIds.length
        ? repository.listLeaveRequests({
            studentUserIds: [actor._id],
            sessionIds,
            statuses: [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED]
          })
        : Promise.resolve({ records: [] })
    ]);
    const recordsMap = new Map(
      recordsResult.records.map((record) => [record.sessionId, record])
    );
    const leavesMap = new Map(
      leavesResult.records.map((leave) => [leave.sessionId, leave])
    );

    return {
      date,
      sessions: sessionsResult.records.map((session) => {
        const record = recordsMap.get(session.sessionId || session._id) || null;
        const leave = leavesMap.get(session.sessionId || session._id) || null;
        return {
          session: readableSession(session, {
            trainingGroupName:
              (groupsMap.get(session.trainingGroupId) || {}).name || ''
          }),
          status: deriveStudentStatus(session, record, leave),
          leaveStatus: leave ? leave.status : '',
          record: record ? readableRecord(record) : null
        };
      })
    };
  }

  async function listStudentRecords({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateAttendanceQueryPayload(payload || {});
    const [recordsResult, leavesResult] = await Promise.all([
      repository.listAttendanceRecordsByStudent(actor._id, {
        fromDate: input.fromDate,
        toDate: input.toDate,
        maxRecords: 300
      }),
      repository.listLeaveRequests({
        studentUserIds: [actor._id],
        fromDate: input.fromDate,
        toDate: input.toDate,
        maxRecords: 300
      })
    ]);
    const summary = {
      total: recordsResult.records.length,
      checkedIn: 0,
      late: 0,
      leaveApproved: 0,
      pendingVerification: 0,
      absent: 0
    };
    for (const record of recordsResult.records) {
      if (record.status === ATTENDANCE_RECORD_STATUS.CHECKED_IN) {
        summary.checkedIn += 1;
      } else if (record.status === ATTENDANCE_RECORD_STATUS.LATE) {
        summary.late += 1;
      } else if (record.status === ATTENDANCE_RECORD_STATUS.LEAVE_APPROVED) {
        summary.leaveApproved += 1;
      } else if (
        record.status === ATTENDANCE_RECORD_STATUS.PENDING_VERIFICATION
      ) {
        summary.pendingVerification += 1;
      } else if (record.status === ATTENDANCE_RECORD_STATUS.ABSENT) {
        summary.absent += 1;
      }
    }
    return {
      records: recordsResult.records.map(readableRecord),
      leaves: leavesResult.records.map(readableLeave),
      summary
    };
  }

  async function createLeave({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateLeaveCreatePayload(payload);
    const session = await repository.getAttendanceSession(input.sessionId);
    if (!session) {
      fail('SESSION_NOT_FOUND', '考勤场次不存在。');
    }
    if (session.status === ATTENDANCE_SESSION_STATUS.CANCELLED) {
      fail('SESSION_CANCELLED', '该考勤场次已取消。');
    }
    const group = await repository.getTrainingGroup(session.trainingGroupId);
    if (!group || group.enabled !== true) {
      fail('TRAINING_GROUP_DISABLED', '训练组已停用，不能提交请假。');
    }
    const groupIds = await repository.getStudentGroupIds(actor._id);
    if (!groupIds.includes(session.trainingGroupId)) {
      fail('OUT_OF_SCOPE', '只能为本人所属训练组提交请假。');
    }
    if (session.attendanceDate < clubDateOnly()) {
      fail('SESSION_IN_PAST', '已结束的训练场次不能申请请假。');
    }

    const existingRecord = await repository.getAttendanceRecord(
      input.sessionId,
      actor._id
    );
    if (
      existingRecord &&
      [
        ATTENDANCE_RECORD_STATUS.CHECKED_IN,
        ATTENDANCE_RECORD_STATUS.LATE,
        ATTENDANCE_RECORD_STATUS.PENDING_VERIFICATION
      ].includes(existingRecord.status)
    ) {
      fail('ALREADY_CHECKED_IN', '已有签到记录，不能提交请假，请联系教练处理。');
    }

    const existingPending = await repository.listLeaveRequests({
      studentUserIds: [actor._id],
      sessionIds: [input.sessionId],
      statuses: [LEAVE_STATUS.PENDING]
    });
    if (existingPending.records.length) {
      return {
        leave: readableLeave(existingPending.records[0], {
          trainingGroupName: group.name,
          sessionTitle: session.title || session.locationName
        }),
        duplicate: true
      };
    }

    const leaveId = repository.leaveRequestId(
      actor._id,
      input.sessionId,
      input.clientRequestId
    );
    const existing = await repository.getLeaveRequest(leaveId);
    if (existing) {
      return {
        leave: readableLeave(existing, {
          trainingGroupName: group.name,
          sessionTitle: session.title || session.locationName
        }),
        duplicate: true
      };
    }

    const now = new Date();
    const leaveData = {
      leaveId,
      studentUserId: actor._id,
      trainingGroupId: session.trainingGroupId,
      sessionId: input.sessionId,
      attendanceDate: session.attendanceDate,
      reason: input.reason,
      status: LEAVE_STATUS.PENDING,
      reviewedBy: '',
      reviewedAt: null,
      reviewComment: '',
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };

    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.LEAVE_REQUESTS)
        .doc(leaveId);
      const current = await getDocumentOrNull(reference);
      if (current) {
        return;
      }
      await reference.set({ data: leaveData });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_leave_submit_${leaveId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.LEAVE_SUBMITTED,
            targetType: 'leave_request',
            targetId: leaveId,
            result: 'success',
            metadata: {
              sessionId: input.sessionId,
              attendanceDate: session.attendanceDate
            },
            createdAt: now
          }
        });
    });

    const created = await repository.getLeaveRequest(leaveId);
    return {
      leave: readableLeave(created, {
        trainingGroupName: group.name,
        sessionTitle: session.title || session.locationName
      }),
      duplicate: false
    };
  }

  async function cancelLeave({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateLeaveCancelPayload(payload);
    const leave = await repository.getLeaveRequest(input.leaveId);
    if (!leave || leave.studentUserId !== actor._id) {
      fail('LEAVE_NOT_FOUND', '请假申请不存在。');
    }
    if (leave.status !== LEAVE_STATUS.PENDING) {
      fail('LEAVE_NOT_PENDING', '只有待审批的请假可以撤销。');
    }

    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.LEAVE_REQUESTS)
        .doc(input.leaveId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('LEAVE_NOT_FOUND', '请假申请不存在。');
      }
      if (current.status !== LEAVE_STATUS.PENDING) {
        fail('LEAVE_NOT_PENDING', '只有待审批的请假可以撤销。');
      }
      await reference.update({
        data: {
          status: LEAVE_STATUS.CANCELLED,
          cancelledAt: now,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_leave_cancel_${input.leaveId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.LEAVE_CANCELLED,
            targetType: 'leave_request',
            targetId: input.leaveId,
            result: 'success',
            metadata: { sessionId: current.sessionId },
            createdAt: now
          }
        });
    });

    const updated = await repository.getLeaveRequest(input.leaveId);
    return { leave: readableLeave(updated) };
  }

  async function listMyLeaves({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const result = await repository.listLeaveRequests({
      studentUserIds: [actor._id],
      maxRecords: 300
    });
    const sessionIds = Array.from(
      new Set(result.records.map((leave) => leave.sessionId))
    );
    const sessionsMap = new Map();
    for (const sessionId of sessionIds) {
      const session = await repository.getAttendanceSession(sessionId);
      if (session) {
        sessionsMap.set(sessionId, session);
      }
    }
    return {
      leaves: result.records.map((leave) =>
        readableLeave(leave, {
          sessionTitle: (sessionsMap.get(leave.sessionId) || {}).title || ''
        })
      )
    };
  }

  async function listPendingLeaves({ identity }) {
    const actor = await loadManageActor(identity);
    let studentUserIds = null;
    if (!isDeveloper(actor)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      studentUserIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentUserIds.length) {
        return { leaves: [], pendingCount: 0 };
      }
    }

    const [result, pendingCount] = await Promise.all([
      repository.listLeaveRequests({
        studentUserIds,
        statuses: [LEAVE_STATUS.PENDING],
        maxRecords: 300
      }),
      repository.countPendingLeaveRequests(studentUserIds)
    ]);
    const studentIds = Array.from(
      new Set(result.records.map((leave) => leave.studentUserId))
    );
    const [profilesMap, groupsMap] = await Promise.all([
      repository.getProfilesMap(studentIds),
      repository.getGroupsMap(
        Array.from(new Set(result.records.map((leave) => leave.trainingGroupId)))
      )
    ]);
    const sessionsMap = new Map();
    for (const sessionId of Array.from(
      new Set(result.records.map((leave) => leave.sessionId))
    )) {
      const session = await repository.getAttendanceSession(sessionId);
      if (session) {
        sessionsMap.set(sessionId, session);
      }
    }

    return {
      leaves: result.records.map((leave) =>
        readableLeave(leave, {
          studentName: (profilesMap.get(leave.studentUserId) || {}).name || '',
          trainingGroupName:
            (groupsMap.get(leave.trainingGroupId) || {}).name || '',
          sessionTitle: (sessionsMap.get(leave.sessionId) || {}).title || ''
        })
      ),
      pendingCount
    };
  }

  async function listReviewedLeaves({ identity }) {
    const actor = await loadManageActor(identity);
    let studentUserIds = null;
    if (!isDeveloper(actor)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      studentUserIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentUserIds.length) {
        return { leaves: [] };
      }
    }
    const result = await repository.listLeaveRequests({
      studentUserIds,
      statuses: [
        LEAVE_STATUS.APPROVED,
        LEAVE_STATUS.REJECTED,
        LEAVE_STATUS.CANCELLED
      ],
      maxRecords: 300
    });
    const studentIds = Array.from(
      new Set(result.records.map((leave) => leave.studentUserId))
    );
    const profilesMap = await repository.getProfilesMap(studentIds);
    return {
      leaves: result.records.map((leave) =>
        readableLeave(leave, {
          studentName: (profilesMap.get(leave.studentUserId) || {}).name || ''
        })
      )
    };
  }

  async function reviewLeave({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateLeaveReviewPayload(payload);
    const leave = await repository.getLeaveRequest(input.leaveId);
    if (!leave) {
      fail('LEAVE_NOT_FOUND', '请假申请不存在。');
    }
    await assertGroupManageable(actor, leave.trainingGroupId);
    if (leave.status !== LEAVE_STATUS.PENDING) {
      fail('LEAVE_NOT_PENDING', '该请假申请已经处理。');
    }

    const approved = input.decision === 'approve';
    const now = new Date();
    const recordId = repository.attendanceRecordId(
      leave.sessionId,
      leave.studentUserId
    );

    await repository.db.runTransaction(async (transaction) => {
      const leaveReference = transaction
        .collection(COLLECTIONS.LEAVE_REQUESTS)
        .doc(input.leaveId);
      const currentLeave = await getDocumentOrNull(leaveReference);
      if (!currentLeave) {
        fail('LEAVE_NOT_FOUND', '请假申请不存在。');
      }
      if (currentLeave.status !== LEAVE_STATUS.PENDING) {
        fail('LEAVE_NOT_PENDING', '该请假申请已经处理。');
      }

      const recordReference = transaction
        .collection(COLLECTIONS.ATTENDANCE_RECORDS)
        .doc(recordId);
      const currentRecord = await getDocumentOrNull(recordReference);
      if (
        approved &&
        currentRecord &&
        [
          ATTENDANCE_RECORD_STATUS.CHECKED_IN,
          ATTENDANCE_RECORD_STATUS.LATE,
          ATTENDANCE_RECORD_STATUS.PENDING_VERIFICATION
        ].includes(currentRecord.status)
      ) {
        fail(
          'ATTENDANCE_CONFLICT',
          '该学生已有真实签到记录，不能直接批准请假，请人工核实。'
        );
      }

      await leaveReference.update({
        data: {
          status: approved ? LEAVE_STATUS.APPROVED : LEAVE_STATUS.REJECTED,
          reviewedBy: actor._id,
          reviewedAt: now,
          reviewComment: input.comment,
          updatedAt: now
        }
      });

      if (approved) {
        if (currentRecord) {
          await recordReference.update({
            data: {
              status: ATTENDANCE_RECORD_STATUS.LEAVE_APPROVED,
              originalStatus:
                currentRecord.originalStatus || currentRecord.status,
              leaveRequestId: input.leaveId,
              verificationReason: 'leave_approved',
              updatedAt: now
            }
          });
        } else {
          await recordReference.set({
            data: {
              recordId,
              sessionId: leave.sessionId,
              studentUserId: leave.studentUserId,
              trainingGroupId: leave.trainingGroupId,
              attendanceDate: leave.attendanceDate,
              status: ATTENDANCE_RECORD_STATUS.LEAVE_APPROVED,
              checkInAt: null,
              latitude: null,
              longitude: null,
              accuracyMeters: null,
              distanceMeters: null,
              verificationReason: 'leave_approved',
              source: 'system',
              leaveRequestId: input.leaveId,
              originalStatus: '',
              adjustedBy: '',
              adjustedAt: null,
              adjustReason: '',
              createdAt: now,
              updatedAt: now,
              schemaVersion: 1
            }
          });
        }
      }

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_leave_review_${input.leaveId}_${now.getTime()}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: approved
              ? AUDIT_ACTIONS.LEAVE_APPROVED
              : AUDIT_ACTIONS.LEAVE_REJECTED,
            targetType: 'leave_request',
            targetId: input.leaveId,
            result: 'success',
            metadata: {
              decision: input.decision,
              sessionId: leave.sessionId,
              studentUserId: leave.studentUserId
            },
            createdAt: now
          }
        });
    });

    const updated = await repository.getLeaveRequest(input.leaveId);
    return { leave: readableLeave(updated) };
  }

  return {
    'attendance.list_manage_sessions': listManageSessions,
    'attendance.get_session_roster': getSessionRoster,
    'attendance.create_session': createSession,
    'attendance.update_session': updateSession,
    'attendance.cancel_session': cancelSession,
    'attendance.manual_verify': manualVerify,
    'attendance.get_student_today': getStudentToday,
    'attendance.list_student_records': listStudentRecords,
    'attendance.check_in': checkIn,
    'leave.create': createLeave,
    'leave.cancel': cancelLeave,
    'leave.list_mine': listMyLeaves,
    'leave.list_pending': listPendingLeaves,
    'leave.list_reviewed': listReviewedLeaves,
    'leave.review': reviewLeave
  };
}

module.exports = createAttendanceActions;
