'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  ROLES
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const {
  listLegacyPerformanceEvents,
  listPerformanceEvents
} = require('../lib/performance-events');
const { hasRealNameProfile } = require('../lib/profile-name');
const { loadActiveActor } = require('../lib/session');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  validatePerformanceReviewPayload,
  validatePerformanceSubmissionPayload
} = require('../lib/validation');

function readablePerformanceRecord(record) {
  return {
    id: record._id,
    studentUserId: record.studentUserId,
    eventCode: record.eventCode,
    eventName: record.eventName,
    value: record.value,
    unit: record.unit,
    comparison: record.comparison,
    achievedAt: record.achievedAt,
    source: record.source,
    note: record.note || '',
    status: record.status,
    reviewedBy: record.reviewedBy || '',
    reviewedAt: record.reviewedAt || null,
    reviewComment: record.reviewComment || '',
    createdAt: record.createdAt || null
  };
}

function createPerformanceActions({ repository }) {
  async function listEvents({ identity }) {
    await loadActiveActor(repository, identity, []);
    return {
      events: listPerformanceEvents(),
      legacyEvents: listLegacyPerformanceEvents()
    };
  }

  async function submitPerformance({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validatePerformanceSubmissionPayload(payload);
    const performanceId = repository.performanceIdForSubmission(
      actor._id,
      input.eventCode,
      input.achievedAt,
      input.value
    );
    const completedAt = new Date();

    const result = await repository.db.runTransaction(async (transaction) => {
      const performanceReference = transaction
        .collection(COLLECTIONS.PERFORMANCE_RECORDS)
        .doc(performanceId);
      const existing = await getDocumentOrNull(performanceReference);
      if (existing) {
        return { duplicate: true, status: existing.status };
      }

      await performanceReference.set({
        data: {
          studentUserId: actor._id,
          ...input,
          source: 'student_report',
          submittedBy: actor._id,
          status: 'pending',
          reviewedBy: '',
          reviewedAt: null,
          reviewComment: '',
          createdAt: completedAt,
          updatedAt: completedAt,
          schemaVersion: 1
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_performance_submit_${performanceId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PERFORMANCE_SUBMITTED,
            targetType: 'performance_record',
            targetId: performanceId,
            result: 'success',
            metadata: {
              eventCode: input.eventCode,
              status: 'pending'
            },
            createdAt: completedAt
          }
        });

      return { duplicate: false, status: 'pending' };
    });

    return {
      performanceId,
      duplicate: result.duplicate,
      status: result.status,
      ...input
    };
  }

  async function listMine({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const records = await repository.listPerformanceRecords(actor._id, 100);
    return { performances: records.map(readablePerformanceRecord) };
  }

  async function listPendingPerformances({ identity }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH
    ]);
    let records = await repository.listPendingPerformanceRecords(300);

    if (actor.roles.includes(ROLES.COACH) && !actor.roles.includes(ROLES.DEVELOPER)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      const studentIds = await repository.getStudentUserIdsForGroups(groupIds);
      const allowedStudents = new Set(studentIds);
      records = records.filter((record) =>
        allowedStudents.has(record.studentUserId)
      );
    }

    const studentUserIds = Array.from(
      new Set(records.map((record) => record.studentUserId))
    );
    const [profilesMap, groupNamesMap] = await Promise.all([
      repository.getProfilesMap(studentUserIds),
      repository.getStudentGroupNamesMap(studentUserIds)
    ]);
    const validRecords = records.filter((record) =>
      hasRealNameProfile(profilesMap.get(record.studentUserId))
    );
    const performances = validRecords.map((record) => ({
      ...readablePerformanceRecord(record),
      studentName: profilesMap.get(record.studentUserId).name.trim(),
      trainingGroupNames: groupNamesMap.get(record.studentUserId) || []
    }));
    const pendingCount = await repository.countPendingPerformanceRecords(
      Array.from(new Set(validRecords.map((record) => record.studentUserId)))
    );

    return {
      performances,
      pendingCount,
      truncated: pendingCount > performances.length
    };
  }

  async function reviewPerformance({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH
    ]);
    const input = validatePerformanceReviewPayload(payload);
    const initialRecord = await repository.getPerformanceRecord(input.performanceId);
    if (!initialRecord) {
      fail('PERFORMANCE_NOT_FOUND', '成绩记录不存在。');
    }
    if (initialRecord.status !== 'pending') {
      fail('PERFORMANCE_NOT_PENDING', '该成绩记录已经审核。');
    }

    if (actor.roles.includes(ROLES.COACH) && !actor.roles.includes(ROLES.DEVELOPER)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      const studentIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentIds.includes(initialRecord.studentUserId)) {
        fail('OUT_OF_SCOPE', '只能审核本人负责训练组内学生的成绩。');
      }
    }

    const approved = input.decision === 'approve';
    const completedAt = new Date();
    const auditId = deterministicId(
      'audit_performance_review',
      input.performanceId,
      actor._id,
      completedAt.toISOString()
    );

    const result = await repository.db.runTransaction(async (transaction) => {
      const performanceReference = transaction
        .collection(COLLECTIONS.PERFORMANCE_RECORDS)
        .doc(input.performanceId);
      const currentRecord = await getDocumentOrNull(performanceReference);
      if (!currentRecord) {
        fail('PERFORMANCE_NOT_FOUND', '成绩记录不存在。');
      }
      if (currentRecord.status !== 'pending') {
        fail('PERFORMANCE_NOT_PENDING', '该成绩记录已经审核。');
      }

      await performanceReference.update({
        data: {
          status: approved ? 'approved' : 'rejected',
          reviewedBy: actor._id,
          reviewedAt: completedAt,
          reviewComment: input.comment,
          updatedAt: completedAt
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(auditId)
        .set({
          data: {
            actorUserId: actor._id,
            action: approved
              ? AUDIT_ACTIONS.PERFORMANCE_APPROVED
              : AUDIT_ACTIONS.PERFORMANCE_REJECTED,
            targetType: 'performance_record',
            targetId: input.performanceId,
            result: 'success',
            metadata: {
              decision: input.decision,
              eventCode: currentRecord.eventCode
            },
            createdAt: completedAt
          }
        });

      return {
        performanceId: input.performanceId,
        status: approved ? 'approved' : 'rejected'
      };
    });

    return result;
  }

  return {
    'performance.list_events': listEvents,
    'performance.submit': submitPerformance,
    'performance.list_mine': listMine,
    'admin.list_pending_performances': listPendingPerformances,
    'admin.review_performance': reviewPerformance
  };
}

module.exports = createPerformanceActions;
