'use strict';

const { getPerformanceEvent } = require('./performance-events');
const { dateOnlyFromValue } = require('./dates');

function compareBest(left, right, comparison) {
  if (left.value !== right.value) {
    return comparison === 'lower'
      ? left.value - right.value
      : right.value - left.value;
  }
  const leftDate = dateOnlyFromValue(left.achievedAt);
  const rightDate = dateOnlyFromValue(right.achievedAt);
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }
  return String(left._id || left.performanceId || '').localeCompare(
    String(right._id || right.performanceId || '')
  );
}

function selectBestPerformance(records, comparison) {
  return (records || [])
    .filter((record) => record && record.value !== undefined)
    .sort((left, right) => compareBest(left, right, comparison))[0] || null;
}

function maskStudentName(name) {
  const normalized = String(name || '未命名学生').trim();
  if (normalized.length <= 1) {
    return normalized;
  }
  if (normalized.length === 2) {
    return `${normalized[0]}*`;
  }
  return `${normalized[0]}${'*'.repeat(Math.max(1, normalized.length - 1))}`;
}

function buildPerformanceRows(records) {
  return (records || [])
    .map((record) => ({
      performanceId: record._id,
      studentUserId: record.studentUserId,
      eventCode: record.eventCode,
      eventName: record.eventName,
      value: record.value,
      unit: record.unit,
      comparison: record.comparison,
      achievedAt: dateOnlyFromValue(record.achievedAt),
      status: record.status || 'approved',
      reviewedAt: record.reviewedAt
        ? new Date(record.reviewedAt).toISOString()
        : null
    }))
    .sort((left, right) => {
      if (left.achievedAt !== right.achievedAt) {
        return left.achievedAt.localeCompare(right.achievedAt);
      }
      if (left.eventCode !== right.eventCode) {
        return left.eventCode.localeCompare(right.eventCode);
      }
      return left.performanceId.localeCompare(right.performanceId);
    });
}

function buildPerformanceLeaderboard(input) {
  const records = input.records || [];
  const profilesMap = input.profilesMap || new Map();
  const groupNamesMap = input.groupNamesMap || new Map();
  const coachNamesMap = input.coachNamesMap || new Map();
  const historicalRecords = input.historicalRecords || [];
  const byStudent = new Map();

  for (const record of records) {
    const list = byStudent.get(record.studentUserId) || [];
    list.push(record);
    byStudent.set(record.studentUserId, list);
  }

  const rows = [];
  for (const [studentUserId, studentRecords] of byStudent.entries()) {
    const best = selectBestPerformance(studentRecords, input.comparison);
    if (!best) {
      continue;
    }
    const historicalBest = selectBestPerformance(
      historicalRecords.filter((record) => record.studentUserId === studentUserId),
      input.comparison
    );
    const profile = profilesMap.get(studentUserId) || {};
    const isSelf = input.viewerUserId === studentUserId;
    rows.push({
      studentUserId,
      studentName:
        input.maskOthers && !isSelf
          ? maskStudentName(profile.name)
          : profile.name || '未命名学生',
      isSelf,
      eventCode: best.eventCode,
      eventName: best.eventName,
      value: best.value,
      unit: best.unit,
      comparison: best.comparison,
      achievedAt: dateOnlyFromValue(best.achievedAt),
      performanceId: best._id,
      trainingGroupNames: groupNamesMap.get(studentUserId) || [],
      coachNames: coachNamesMap.get(studentUserId) || [],
      historicalPersonalBest: historicalBest
        ? {
            value: historicalBest.value,
            unit: historicalBest.unit,
            achievedAt: dateOnlyFromValue(historicalBest.achievedAt)
          }
        : null
    });
  }

  rows.sort((left, right) => {
    if (left.value !== right.value) {
      return input.comparison === 'lower'
        ? left.value - right.value
        : right.value - left.value;
    }
    if (left.achievedAt !== right.achievedAt) {
      return left.achievedAt.localeCompare(right.achievedAt);
    }
    return left.studentUserId.localeCompare(right.studentUserId);
  });

  let lastValue = null;
  let lastRank = 0;
  rows.forEach((row, index) => {
    if (lastValue === null || row.value !== lastValue) {
      lastRank = index + 1;
      lastValue = row.value;
    }
    row.rank = lastRank;
  });

  return rows;
}

function buildPerformanceSummary(records) {
  const approved = records || [];
  const eventCounts = {};
  const studentIds = new Set();
  const personalBests = new Map();
  for (const record of approved) {
    studentIds.add(record.studentUserId);
    eventCounts[record.eventCode] = (eventCounts[record.eventCode] || 0) + 1;
    const key = `${record.studentUserId}|${record.eventCode}`;
    const current = personalBests.get(key);
    if (!current || compareBest(record, current, record.comparison) < 0) {
      personalBests.set(key, record);
    }
  }
  return {
    approvedCount: approved.length,
    studentCount: studentIds.size,
    eventCounts: Object.entries(eventCounts)
      .map(([eventCode, count]) => ({
        eventCode,
        eventName: (getPerformanceEvent(eventCode) || {}).name || eventCode,
        count
      }))
      .sort((left, right) => right.count - left.count || left.eventCode.localeCompare(right.eventCode)),
    personalBestCount: personalBests.size
  };
}

function buildFeedbackSummary(feedbackRecords) {
  const records = feedbackRecords || [];
  const result = {
    total: records.length,
    completed: 0,
    partial: 0,
    notCompleted: 0,
    coachReviewed: 0,
    attentionCount: 0,
    averageRpe: null,
    recentRpe: []
  };
  let rpeTotal = 0;
  let rpeCount = 0;
  const sorted = [...records].sort(
    (left, right) =>
      new Date(left.attendanceDate || left.createdAt || 0).getTime() -
      new Date(right.attendanceDate || right.createdAt || 0).getTime()
  );
  for (const record of sorted) {
    if (record.completionStatus === 'completed') {
      result.completed += 1;
    } else if (record.completionStatus === 'partial') {
      result.partial += 1;
    } else if (record.completionStatus === 'not_completed') {
      result.notCompleted += 1;
    }
    if (record.coachComment) {
      result.coachReviewed += 1;
    }
    if (
      record.completionStatus === 'not_completed' ||
      Number(record.rpe) >= 8 ||
      /困难|疼痛|受伤|不适/.test(record.comment || '')
    ) {
      result.attentionCount += 1;
    }
    const rpe = Number(record.rpe);
    if (Number.isFinite(rpe)) {
      rpeTotal += rpe;
      rpeCount += 1;
      result.recentRpe.push({
        date: dateOnlyFromValue(record.attendanceDate || record.createdAt),
        value: rpe
      });
    }
  }
  result.averageRpe = rpeCount
    ? Number((rpeTotal / rpeCount).toFixed(2))
    : null;
  result.recentRpe = result.recentRpe.slice(-20);
  return result;
}

function buildGroupPerformanceSummary(
  records,
  studentGroupIdsMap = new Map(),
  groupsMap = new Map()
) {
  const byGroup = new Map();
  for (const record of records || []) {
    const groupIds = studentGroupIdsMap.get(record.studentUserId) || [];
    for (const groupId of groupIds.length ? groupIds : ['__ungrouped__']) {
      const current = byGroup.get(groupId) || {
        trainingGroupId: groupId,
        trainingGroupName: (groupsMap.get(groupId) || {}).name || '未标注训练组',
        approvedCount: 0,
        studentIds: new Set(),
        eventCounts: {}
      };
      current.approvedCount += 1;
      current.studentIds.add(record.studentUserId);
      current.eventCounts[record.eventCode] =
        (current.eventCounts[record.eventCode] || 0) + 1;
      byGroup.set(groupId, current);
    }
  }
  return Array.from(byGroup.values()).map((group) => ({
    trainingGroupId: group.trainingGroupId,
    trainingGroupName: group.trainingGroupName,
    approvedCount: group.approvedCount,
    studentCount: group.studentIds.size,
    eventCounts: group.eventCounts
  }));
}

module.exports = {
  buildFeedbackSummary,
  buildGroupPerformanceSummary,
  buildPerformanceLeaderboard,
  buildPerformanceRows,
  buildPerformanceSummary,
  compareBest,
  maskStudentName,
  selectBestPerformance
};
