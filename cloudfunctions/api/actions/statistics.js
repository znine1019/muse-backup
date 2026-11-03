'use strict';

const {
  ATTENDANCE_SESSION_STATUS,
  LEAVE_STATUS,
  MEMBERSHIP_STATUS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { addDays, periodRange } = require('../lib/dates');
const { fail } = require('../lib/errors');
const {
  buildAttendanceDetailRows,
  buildAttendanceStatistics
} = require('../lib/attendance-rules');
const {
  getPerformanceEvent,
  listAllPerformanceEvents
} = require('../lib/performance-events');
const { buildAutomaticReport } = require('../lib/report-builder');
const { loadActiveActor } = require('../lib/session');
const {
  buildFeedbackSummary,
  buildPerformanceLeaderboard,
  buildPerformanceRows,
  buildPerformanceSummary,
  maskStudentName
} = require('../lib/statistics-builder');
const {
  validateAttendanceLeaderboardPayload,
  validateExportPayload,
  validatePerformanceLeaderboardPayload,
  validateStatisticsPeriodPayload
} = require('../lib/validation');

const DEFAULT_EXPORT_MAX_ROWS = 2000;
const MAX_STATISTICS_SESSIONS = 5000;
const MAX_STATISTICS_RECORDS = 20000;
const MAX_COACH_MEMBERSHIPS = 5000;

function isDeveloper(actor) {
  return actor.roles.includes(ROLES.DEVELOPER);
}

function profileHasRealName(profile) {
  return Boolean(
    profile &&
      typeof profile.name === 'string' &&
      profile.name.trim().length > 0
  );
}

function serializePeriod(range) {
  return {
    periodType: range.periodType,
    year: range.year,
    month: range.month,
    quarter: range.quarter,
    startDate: range.startDate,
    endExclusive: range.endExclusive,
    label: range.label,
    rangeText: range.rangeText
  };
}

function emptyAttendanceSummary() {
  return {
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
    notStarted: 0,
    attendanceRate: null,
    lateRate: null
  };
}

function emptyAttendanceRow(studentUserId, studentName) {
  return {
    studentUserId,
    studentName,
    trainingGroupIds: [],
    trainingGroupNames: [],
    plannedExpected: 0,
    approvedLeave: 0,
    actualExpected: 0,
    validAttendance: 0,
    late: 0,
    pendingVerification: 0,
    absent: 0,
    pending: 0,
    notStarted: 0,
    sampleSessions: 0,
    sampleSufficient: false,
    attendanceRate: null,
    lateRate: null,
    rank: null
  };
}

function buildStudentGroupMaps(memberships, groupsMap, coachNamesByGroup = new Map()) {
  const studentGroupIdsMap = new Map();
  const studentGroupNamesMap = new Map();
  const studentCoachNamesMap = new Map();
  for (const membership of memberships) {
    if (membership.roleInGroup && membership.roleInGroup !== ROLES.STUDENT) {
      continue;
    }
    const groupIds = studentGroupIdsMap.get(membership.userId) || new Set();
    groupIds.add(membership.groupId);
    studentGroupIdsMap.set(membership.userId, groupIds);

    const group = groupsMap.get(membership.groupId);
    if (!group) {
      continue;
    }
    const names = studentGroupNamesMap.get(membership.userId) || [];
    const groupName = group.name || '未命名训练组';
    if (!names.includes(groupName)) {
      names.push(groupName);
    }
    studentGroupNamesMap.set(membership.userId, names);

    const coachNames = studentCoachNamesMap.get(membership.userId) || [];
    for (const coachName of coachNamesByGroup.get(membership.groupId) || []) {
      if (coachName && !coachNames.includes(coachName)) {
        coachNames.push(coachName);
      }
    }
    studentCoachNamesMap.set(membership.userId, coachNames);
  }
  return {
    studentGroupIdsMap,
    studentGroupNamesMap,
    studentCoachNamesMap
  };
}


function isActiveCoachUser(user) {
  return Boolean(
    user &&
      user.status === USER_STATUS.ACTIVE &&
      Array.isArray(user.roles) &&
      user.roles.includes(ROLES.COACH)
  );
}

async function listActiveCoachMembershipsForGroups(repository, groupIds) {
  const records = [];
  for (let index = 0; index < groupIds.length; index += 100) {
    const chunk = groupIds.slice(index, index + 100);
    const batch = await repository.queryAll(
      repository.membershipCollection,
      {
        groupId: repository.db.command.in(chunk),
        roleInGroup: ROLES.COACH,
        status: MEMBERSHIP_STATUS.ACTIVE
      },
      MAX_COACH_MEMBERSHIPS + 1
    );
    records.push(...batch);
    if (records.length > MAX_COACH_MEMBERSHIPS) {
      fail(
        'STATISTICS_INCOMPLETE',
        '教练成员数据读取不完整，暂时无法生成准确统计。'
      );
    }
  }
  return records;
}

async function getScopeCoachContext(repository, scope) {
  if (!scope.coachContextPromise) {
    scope.coachContextPromise = (async () => {
      const memberships = await listActiveCoachMembershipsForGroups(
        repository,
        scope.groupIds
      );
      const userIds = Array.from(
        new Set(memberships.map((membership) => membership.userId).filter(Boolean))
      );
      const usersMap = await repository.getUsersMap(userIds);
      const coachProfilesMap = await repository.getCoachProfilesMap(userIds);
      const seenRelations = new Set();
      const validCoachIdsByGroup = new Map();
      const validCoachIds = new Set();

      for (const membership of memberships) {
        if (
          !membership.groupId ||
          !membership.userId ||
          !scope.groupsMap.has(membership.groupId)
        ) {
          continue;
        }
        const relationKey = `${membership.groupId}|${membership.userId}`;
        if (seenRelations.has(relationKey)) {
          continue;
        }
        if (!isActiveCoachUser(usersMap.get(membership.userId))) {
          continue;
        }
        const coachProfile = coachProfilesMap.get(membership.userId);
        if (
          !coachProfile ||
          coachProfile.reviewStatus !== 'approved' ||
          !profileHasRealName(coachProfile)
        ) {
          continue;
        }
        seenRelations.add(relationKey);
        validCoachIds.add(membership.userId);
        const groupCoachIds = validCoachIdsByGroup.get(membership.groupId) || new Set();
        groupCoachIds.add(membership.userId);
        validCoachIdsByGroup.set(membership.groupId, groupCoachIds);
      }

      const coachNamesByGroup = new Map();
      for (const [groupId, groupCoachIds] of validCoachIdsByGroup.entries()) {
        const names = Array.from(groupCoachIds)
          .map((userId) => ({
            userId,
            name: String(coachProfilesMap.get(userId).name).trim()
          }))
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name, 'zh-CN') ||
              left.userId.localeCompare(right.userId)
          )
          .map((item) => item.name)
          .filter(Boolean);
        coachNamesByGroup.set(groupId, names);
      }

      return {
        coachCount: validCoachIds.size,
        coachIds: Array.from(validCoachIds).sort(),
        coachNamesByGroup
      };
    })();
  }
  return scope.coachContextPromise;
}

function decoratePerformanceRecords(records, profilesMap, groupNamesMap, coachNamesMap) {
  return buildPerformanceRows(records)
    .filter((record) => profileHasRealName(profilesMap.get(record.studentUserId)))
    .map((record) => ({
    ...record,
    studentName: profilesMap.get(record.studentUserId).name.trim(),
    trainingGroupNames: groupNamesMap.get(record.studentUserId) || [],
    coachNames: coachNamesMap.get(record.studentUserId) || []
    }));
}

function createStatisticsActions({ repository }) {
  async function resolveScope(actor, requestedGroupId) {
    let groupIds = [];
    let groupsMap = new Map();
    if (isDeveloper(actor)) {
      if (requestedGroupId) {
        const group = await repository.getTrainingGroup(requestedGroupId);
        if (!group) {
          fail('TRAINING_GROUP_NOT_FOUND', '训练组不存在。');
        }
        groupIds = [requestedGroupId];
        groupsMap = await repository.getGroupsMap(groupIds);
      } else {
        const groups = await repository.listAllTrainingGroups();
        groupIds = groups.map((group) => group._id);
        groupsMap = new Map(groups.map((group) => [group._id, group]));
      }
    } else if (actor.roles.includes(ROLES.COACH)) {
      const coachGroupIds = await repository.getCoachGroupIds(actor._id);
      groupIds = requestedGroupId ? [requestedGroupId] : coachGroupIds;
      if (requestedGroupId && !coachGroupIds.includes(requestedGroupId)) {
        fail('OUT_OF_SCOPE', '只能查看本人负责训练组的统计数据。');
      }
      groupsMap = await repository.getGroupsMap(groupIds);
    } else {
      const studentGroupIds = await repository.getStudentGroupIds(actor._id);
      groupIds = requestedGroupId ? [requestedGroupId] : studentGroupIds;
      if (requestedGroupId && !studentGroupIds.includes(requestedGroupId)) {
        fail('OUT_OF_SCOPE', '只能查看本人所属训练组的统计数据。');
      }
      groupsMap = await repository.getGroupsMap(groupIds);
    }

    const membershipResult = await repository.listMembershipsForGroups(groupIds);
    if (membershipResult.incomplete) {
      fail(
        'STATISTICS_INCOMPLETE',
        '训练组成员数据读取不完整，暂时无法生成准确统计。'
      );
    }
    const memberships = membershipResult.records || [];
    const membershipStudentIds = Array.from(
      new Set(memberships.map((membership) => membership.userId).filter(Boolean))
    );
    const fallbackStudentIds = membershipStudentIds.length
      ? membershipStudentIds
      : await repository.getStudentUserIdsForGroups(groupIds);
    const profilesMap = await repository.getProfilesMap(fallbackStudentIds);
    const validStudentIds = fallbackStudentIds.filter((userId) =>
      profileHasRealName(profilesMap.get(userId))
    );
    const validStudentIdSet = new Set(validStudentIds);
    const activeStudentIds = Array.from(
      new Set(
        memberships
          .filter(
            (membership) =>
              membership.status === MEMBERSHIP_STATUS.ACTIVE &&
              validStudentIdSet.has(membership.userId)
          )
          .map((membership) => membership.userId)
      )
    );
    return {
      groupIds,
      groupsMap,
      memberships,
      allStudentIds: validStudentIds,
      activeStudentIds
    };
  }

  async function loadGroupMapsForScope(scope) {
    const coachContext = await getScopeCoachContext(repository, scope);
    return buildStudentGroupMaps(
      scope.memberships,
      scope.groupsMap,
      coachContext.coachNamesByGroup
    );
  }

  async function loadAttendance(scope, range, studentIds) {
    if (!scope.groupIds.length) {
      return {
        sessions: [],
        records: [],
        leaves: [],
        memberships: [],
        profilesMap: new Map(),
        groupsMap: scope.groupsMap
      };
    }
    const sessionsResult = await repository.listAttendanceSessions({
      groupIds: scope.groupIds,
      fromDate: range.startDate,
      toDate: addDays(range.endExclusive, -1),
      maxRecords: MAX_STATISTICS_SESSIONS
    });
    if (sessionsResult.incomplete) {
      fail(
        'STATISTICS_INCOMPLETE',
        '考勤场次读取不完整，请缩小统计周期或训练组范围。'
      );
    }
    const sessions = sessionsResult.records || [];
    const sessionIds = sessions.map((session) => session.sessionId || session._id);
    const recordsResult = await repository.listAttendanceRecordsBySessions(
      sessionIds,
      { maxRecords: MAX_STATISTICS_RECORDS }
    );
    const leavesResult = await repository.listLeaveRequests({
      sessionIds,
      statuses: [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED],
      maxRecords: MAX_STATISTICS_RECORDS
    });
    if (recordsResult.incomplete || leavesResult.incomplete) {
      fail(
        'STATISTICS_INCOMPLETE',
        '考勤或请假记录读取不完整，请缩小统计周期或训练组范围。'
      );
    }
    const profileIds = Array.from(
      new Set(
        [
          ...(studentIds || []),
          ...(scope.allStudentIds || []),
          ...recordsResult.records.map((record) => record.studentUserId),
          ...leavesResult.records.map((leave) => leave.studentUserId)
        ].filter(Boolean)
      )
    );
    const profilesMap = await repository.getProfilesMap(profileIds);
    return {
      sessions,
      records: recordsResult.records,
      leaves: leavesResult.records,
      memberships: scope.memberships,
      profilesMap,
      groupsMap: scope.groupsMap
    };
  }

  function buildAttendanceResult(dataset, studentIds) {
    return buildAttendanceStatistics({
      sessions: dataset.sessions,
      records: dataset.records,
      leaves: dataset.leaves,
      memberships: dataset.memberships,
      profilesMap: dataset.profilesMap,
      groupsMap: dataset.groupsMap,
      studentIds
    });
  }

  async function loadPerformance(scope, range, eventCode, maxRecords = 10000) {
    if (!scope.allStudentIds.length) {
      return { records: [], total: 0, incomplete: false };
    }
    return repository.listApprovedPerformanceRecordsForStatistics({
      studentUserIds: scope.allStudentIds,
      eventCode,
      fromDate: range.startDate,
      toDate: addDays(range.endExclusive, -1),
      maxRecords
    });
  }

  async function getMeta({ identity }) {
    const actor = await loadActiveActor(repository, identity, []);
    const scope = await resolveScope(actor, '');
    const coachContext = await getScopeCoachContext(repository, scope);
    return {
      role: isDeveloper(actor)
        ? ROLES.DEVELOPER
        : actor.roles.includes(ROLES.COACH)
          ? ROLES.COACH
          : ROLES.STUDENT,
      events: listAllPerformanceEvents(),
      groups: Array.from(scope.groupsMap.values()).map((group) => ({
        id: group._id,
        groupId: group.groupId || group._id,
        name: group.name,
        seasonLabel: group.seasonLabel || '未标注',
        enabled: group.enabled === true,
        coachNames: coachContext.coachNamesByGroup.get(group._id) || []
      })),
      minAttendanceSampleSessions: 3
    };
  }

  async function getMyOverview({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateStatisticsPeriodPayload(payload || {});
    const range = periodRange(input);
    const [profile, groupIds] = await Promise.all([
      repository.getProfile(actor._id),
      repository.getStudentGroupIds(actor._id)
    ]);
    if (!profileHasRealName(profile)) {
      fail('PROFILE_NOT_FOUND', '学生档案不存在。');
    }
    const groupsMap = await repository.getGroupsMap(groupIds);
    const membershipResult = await repository.listMembershipsForGroups(groupIds);
    if (membershipResult.incomplete) {
      fail('STATISTICS_INCOMPLETE', '训练组成员数据读取不完整。');
    }
    const scope = {
      groupIds,
      groupsMap,
      memberships: membershipResult.records,
      allStudentIds: [actor._id],
      activeStudentIds: [actor._id]
    };
    const [
      attendanceDataset,
      periodPerformanceResult,
      historicalPerformanceResult,
      feedbackResult
    ] = await Promise.all([
      loadAttendance(scope, range, [actor._id]),
      repository.listApprovedPerformanceRecordsForStatistics({
        studentUserIds: [actor._id],
        fromDate: range.startDate,
        toDate: addDays(range.endExclusive, -1),
        maxRecords: 10000
      }),
      repository.listApprovedPerformanceRecordsForStatistics({
        studentUserIds: [actor._id],
        maxRecords: 10000
      }),
      repository.listTrainingFeedback({
        studentUserId: actor._id,
        fromDate: range.startDate,
        toDate: addDays(range.endExclusive, -1),
        maxRecords: 5000
      })
    ]);
    if (
      periodPerformanceResult.incomplete ||
      historicalPerformanceResult.incomplete ||
      feedbackResult.incomplete
    ) {
      fail('STATISTICS_INCOMPLETE', '个人统计数据读取不完整。');
    }
    const attendance = buildAttendanceResult(attendanceDataset);
    const attendanceRow =
      attendance.students.find((row) => row.studentUserId === actor._id) ||
      emptyAttendanceRow(actor._id, profile.name || '本人');
    const report = buildAutomaticReport({
      profile,
      measurements: [],
      performanceRecords: historicalPerformanceResult.records
    });
    const latestPerformances = [];
    const seenEvents = new Set();
    for (const record of [...historicalPerformanceResult.records]
      .sort(
        (left, right) =>
          new Date(right.achievedAt || 0).getTime() -
          new Date(left.achievedAt || 0).getTime()
      )) {
      if (!seenEvents.has(record.eventCode)) {
        seenEvents.add(record.eventCode);
        latestPerformances.push({
          eventCode: record.eventCode,
          eventName: record.eventName,
          value: record.value,
          unit: record.unit,
          achievedAt: record.achievedAt,
          comparison: record.comparison
        });
      }
    }
    return {
      period: serializePeriod(range),
      profile: {
        userId: actor._id,
        name: profile.name || '本人',
        primaryEventCode: profile.primaryEventCode || '',
        primaryEventName: profile.primaryEventName || '',
        examGoal: profile.examGoal || {}
      },
      groups: Array.from(groupsMap.values()).map((group) => ({
        id: group._id,
        name: group.name,
        seasonLabel: group.seasonLabel || '未标注'
      })),
      performance: {
        approvedCount: periodPerformanceResult.records.length,
        historicalApprovedCount: historicalPerformanceResult.records.length,
        personalBests: report.personalBests,
        stageChanges: report.stageChanges,
        targetComparison: report.targetComparison,
        latestPerformances,
        summary: buildPerformanceSummary(periodPerformanceResult.records)
      },
      attendance: attendanceRow,
      feedback: buildFeedbackSummary(feedbackResult.records),
      dataQuality: {
        performanceComplete:
          periodPerformanceResult.incomplete === false &&
          historicalPerformanceResult.incomplete === false,
        feedbackComplete: feedbackResult.incomplete === false,
        membershipHistoryReliable: false,
        membershipHistoryNote:
          '历史训练组名单没有逐场快照，出勤结果按现有成员关系时间范围估算。'
      }
    };
  }

  async function getManageOverview({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.COACH,
      ROLES.DEVELOPER
    ]);
    const input = validateStatisticsPeriodPayload(payload || {});
    const range = periodRange(input);
    const scope = await resolveScope(actor, input.trainingGroupId);
    const studentIds = scope.allStudentIds;
    const [attendanceDataset, performanceResult, feedbackResult, coachContext] = await Promise.all([
      loadAttendance(scope, range, studentIds),
      loadPerformance(scope, range, '', MAX_STATISTICS_RECORDS),
      studentIds.length
        ? repository.listTrainingFeedback({
            studentUserIds: studentIds,
            fromDate: range.startDate,
            toDate: addDays(range.endExclusive, -1),
            maxRecords: MAX_STATISTICS_RECORDS
          })
        : Promise.resolve({ records: [], total: 0, incomplete: false }),
      getScopeCoachContext(repository, scope)
    ]);
    if (performanceResult.incomplete || feedbackResult.incomplete) {
      fail('STATISTICS_INCOMPLETE', '管理统计数据读取不完整。');
    }
    const attendance = buildAttendanceResult(attendanceDataset);
    const groupPerformanceSummary = [];
    for (const [groupId, group] of scope.groupsMap.entries()) {
      const groupStudentIds = studentIds.filter((studentId) =>
        scope.memberships.some(
          (membership) =>
            membership.userId === studentId && membership.groupId === groupId
        )
      );
      const groupPerformance = performanceResult.records.filter((record) =>
        groupStudentIds.includes(record.studentUserId)
      );
      groupPerformanceSummary.push({
        trainingGroupId: groupId,
        trainingGroupName: group.name || '未命名训练组',
        studentCount: groupStudentIds.length,
        approvedCount: groupPerformance.length,
        eventCounts: groupPerformance.reduce((counts, record) => {
          counts[record.eventCode] = (counts[record.eventCode] || 0) + 1;
          return counts;
        }, {})
      });
    }
    const groupComparison = groupPerformanceSummary.map((group) => {
      const groupAttendance = attendance.students.filter((row) =>
        row.trainingGroupIds.includes(group.trainingGroupId)
      );
      const actualExpected = groupAttendance.reduce(
        (total, row) => total + row.actualExpected,
        0
      );
      const validAttendance = groupAttendance.reduce(
        (total, row) => total + row.validAttendance,
        0
      );
      return {
        ...group,
        actualExpected,
        validAttendance,
        attendanceRate:
          actualExpected > 0
            ? Number((validAttendance / actualExpected).toFixed(4))
            : null
      };
    });
    const activeStudentIds = new Set(scope.activeStudentIds);
    return {
      period: serializePeriod(range),
      scope: {
        groupIds: scope.groupIds,
        groupCount: scope.groupIds.length,
        enabledGroupCount: Array.from(scope.groupsMap.values()).filter(
          (group) => group.enabled === true
        ).length,
        studentCount: Array.from(activeStudentIds).length,
        coachCount: coachContext.coachCount
      },
      attendance,
      performance: {
        approvedCount: performanceResult.records.length,
        summary: buildPerformanceSummary(performanceResult.records),
        groups: groupPerformanceSummary
      },
      feedback: buildFeedbackSummary(feedbackResult.records),
      groupComparison,
      dataQuality: attendance.dataQuality
    };
  }

  async function getPerformanceLeaderboard({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH,
      ROLES.STUDENT
    ]);
    const input = validatePerformanceLeaderboardPayload(payload || {});
    const range = periodRange(input);
    const scope = await resolveScope(actor, input.trainingGroupId);
    const [recordsResult, historicalResult] = await Promise.all([
      loadPerformance(scope, range, input.eventCode, MAX_STATISTICS_RECORDS),
      loadPerformance(scope, { startDate: '2000-01-01', endExclusive: '2101-01-01' }, input.eventCode, MAX_STATISTICS_RECORDS)
    ]);
    if (recordsResult.incomplete || historicalResult.incomplete) {
      fail('STATISTICS_INCOMPLETE', '成绩历史读取不完整，排行榜结果不可靠。');
    }
    const profilesMap = await repository.getProfilesMap(scope.allStudentIds);
    const groupMaps = await loadGroupMapsForScope(scope);
    const rows = buildPerformanceLeaderboard({
      records: recordsResult.records,
      historicalRecords: historicalResult.records,
      profilesMap,
      groupNamesMap: groupMaps.studentGroupNamesMap,
      coachNamesMap: groupMaps.studentCoachNamesMap,
      viewerUserId: actor._id,
      maskOthers: actor.roles.includes(ROLES.STUDENT),
      comparison: (getPerformanceEvent(input.eventCode) || {}).comparison || 'lower'
    });
    return {
      period: serializePeriod(range),
      event: getPerformanceEvent(input.eventCode),
      rows,
      total: rows.length,
      dataQuality: {
        approvedOnly: true,
        historicalComplete: historicalResult.incomplete === false,
        scope: input.trainingGroupId ? 'selected_group' : 'authorized_groups'
      }
    };
  }

  async function getAttendanceLeaderboard({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH,
      ROLES.STUDENT
    ]);
    const input = validateAttendanceLeaderboardPayload(payload || {});
    const range = periodRange(input);
    const scope = await resolveScope(actor, input.trainingGroupId);
    const dataset = await loadAttendance(scope, range, scope.allStudentIds);
    const result = buildAttendanceResult(dataset, scope.allStudentIds);
    const groupMaps = await loadGroupMapsForScope(scope);
    const rows = result.students.map((row) => ({
      ...row,
      isSelf: row.studentUserId === actor._id,
      studentName: actor.roles.includes(ROLES.STUDENT) && row.studentUserId !== actor._id
        ? maskStudentName(row.studentName)
        : row.studentName,
      coachNames: groupMaps.studentCoachNamesMap.get(row.studentUserId) || []
    }));
    return {
      period: serializePeriod(range),
      summary: result.summary,
      sessionCounts: result.sessionCounts,
      rows,
      total: rows.length,
      dataQuality: result.dataQuality
    };
  }

  async function exportPerformanceRows({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH,
      ROLES.STUDENT
    ]);
    const input = validateExportPayload(payload || {});
    const range = periodRange(input);
    const scope = await resolveScope(actor, input.trainingGroupId);
    const studentIds = actor.roles.includes(ROLES.STUDENT)
      ? [actor._id]
      : scope.allStudentIds;
    const maxRows = input.maxRows || DEFAULT_EXPORT_MAX_ROWS;
    const result = await repository.listApprovedPerformanceRecordsForStatistics({
      studentUserIds: studentIds,
      eventCode: input.eventCode,
      fromDate: range.startDate,
      toDate: addDays(range.endExclusive, -1),
      maxRecords: maxRows + 1
    });
    if (result.incomplete || result.total > maxRows) {
      fail(
        'EXPORT_RANGE_TOO_LARGE',
        `当前导出范围超过${maxRows}条，请缩小统计周期或训练组范围。`
      );
    }
    const profilesMap = await repository.getProfilesMap(studentIds);
    const groupMaps = await loadGroupMapsForScope(scope);
    return {
      format: 'xlsx',
      period: serializePeriod(range),
      total: result.total,
      truncated: false,
      maxRows,
      rows: decoratePerformanceRecords(
        result.records,
        profilesMap,
        groupMaps.studentGroupNamesMap,
        groupMaps.studentCoachNamesMap
      )
    };
  }

  async function exportAttendanceRows({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH,
      ROLES.STUDENT
    ]);
    const input = validateExportPayload(payload || {});
    const range = periodRange(input);
    const scope = await resolveScope(actor, input.trainingGroupId);
    const studentIds = actor.roles.includes(ROLES.STUDENT)
      ? [actor._id]
      : scope.allStudentIds;
    const maxRows = input.maxRows || DEFAULT_EXPORT_MAX_ROWS;
    const dataset = await loadAttendance(scope, range, studentIds);
    const detailRows = buildAttendanceDetailRows({
      sessions: dataset.sessions,
      records: dataset.records,
      leaves: dataset.leaves,
      memberships: dataset.memberships,
      studentIds
    });
    if (detailRows.length > maxRows) {
      fail(
        'EXPORT_RANGE_TOO_LARGE',
        `当前导出范围超过${maxRows}条，请缩小统计周期或训练组范围。`
      );
    }
    const profilesMap = await repository.getProfilesMap(studentIds);
    const groupMaps = await loadGroupMapsForScope(scope);
    const rows = detailRows
      .filter((row) => profileHasRealName(profilesMap.get(row.studentUserId)))
      .map((row) => ({
      trainingGroupId: row.trainingGroupId,
      trainingGroupName:
        (scope.groupsMap.get(row.trainingGroupId) || {}).name || '未命名训练组',
      attendanceDate: row.attendanceDate,
      studentUserId: row.studentUserId,
      studentName:
        profilesMap.get(row.studentUserId).name.trim(),
      status: row.status,
      phase: row.phase,
      checkInAt: row.checkInAt ? new Date(row.checkInAt).toISOString() : '',
      late: row.late,
      leaveStatus: row.leaveStatus,
      manualVerified: row.manualVerified,
      recordSource: row.recordSource,
      coachNames: groupMaps.studentCoachNamesMap.get(row.studentUserId) || []
    }));
    return {
      format: 'xlsx',
      period: serializePeriod(range),
      total: rows.length,
      truncated: false,
      maxRows,
      rows
    };
  }

  return {
    'statistics.get_meta': getMeta,
    'statistics.get_my_overview': getMyOverview,
    'statistics.get_manage_overview': getManageOverview,
    'leaderboard.performance': getPerformanceLeaderboard,
    'leaderboard.attendance': getAttendanceLeaderboard,
    'export.performance_rows': exportPerformanceRows,
    'export.attendance_rows': exportAttendanceRows
  };
}

module.exports = createStatisticsActions;
