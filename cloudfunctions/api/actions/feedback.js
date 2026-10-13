'use strict';

const {
  ATTENDANCE_RECORD_STATUS,
  AUDIT_ACTIONS,
  COLLECTIONS,
  FEEDBACK_COMPLETION,
  ROLES
} = require('../lib/constants');
const { addDays, clubDateOnly } = require('../lib/dates');
const { fail } = require('../lib/errors');
const { loadActiveActor } = require('../lib/session');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  safeId,
  validateFeedbackQueryPayload,
  validateFeedbackReviewPayload,
  validateFeedbackSubmitPayload,
  validateFeedbackUpdatePayload
} = require('../lib/validation');

function isDeveloper(actor) {
  return actor.roles.includes(ROLES.DEVELOPER);
}

function readableFeedback(feedback, extra = {}) {
  return {
    id: feedback._id,
    feedbackId: feedback.feedbackId || feedback._id,
    studentUserId: feedback.studentUserId,
    studentName: extra.studentName || '',
    trainingGroupId: feedback.trainingGroupId,
    sessionId: feedback.sessionId,
    planId: feedback.planId || '',
    sessionTitle: extra.sessionTitle || '',
    attendanceDate: feedback.attendanceDate,
    completionStatus: feedback.completionStatus,
    rpe: feedback.rpe,
    comment: feedback.comment || '',
    coachComment: feedback.coachComment || '',
    coachCommentBy: feedback.coachCommentBy || '',
    coachCommentAt: feedback.coachCommentAt || null,
    coachCommentVersion: Number(feedback.coachCommentVersion) || 0,
    version: Number(feedback.version) || 1,
    createdAt: feedback.createdAt || null,
    updatedAt: feedback.updatedAt || null,
    needsAttention: extra.needsAttention === true
  };
}

function feedbackNeedsAttention(feedback) {
  return (
    feedback.completionStatus === FEEDBACK_COMPLETION.NOT_COMPLETED ||
    feedback.rpe >= 8 ||
    /困难|疼痛|受伤|不适/.test(feedback.comment || '')
  );
}

function createFeedbackActions({ repository }) {
  async function loadManageActor(identity) {
    return loadActiveActor(repository, identity, [
      ROLES.COACH,
      ROLES.DEVELOPER
    ]);
  }

  async function loadEligibleSessions(actor) {
    const groupIds = await repository.getStudentGroupIds(actor._id);
    const groupsMap = await repository.getGroupsMap(groupIds);
    const enabledGroupIds = groupIds.filter(
      (groupId) => (groupsMap.get(groupId) || {}).enabled === true
    );
    if (!enabledGroupIds.length) {
      return [];
    }
    const fromDate = addDays(clubDateOnly(), -30);
    const recordsResult = await repository.listAttendanceRecordsByStudent(
      actor._id,
      { fromDate }
    );
    const eligibleRecords = recordsResult.records.filter((record) =>
      [
        ATTENDANCE_RECORD_STATUS.CHECKED_IN,
        ATTENDANCE_RECORD_STATUS.LATE
      ].includes(record.status)
    );
    const feedbackResult = await repository.listTrainingFeedback({
      studentUserId: actor._id,
      maxRecords: 300
    });
    const feedbackMap = new Map(
      feedbackResult.records.map((feedback) => [feedback.sessionId, feedback])
    );
    const sessions = [];
    for (const record of eligibleRecords) {
      const session = await repository.getAttendanceSession(record.sessionId);
      if (!session) {
        continue;
      }
      sessions.push({
        session: {
          sessionId: session.sessionId || session._id,
          title: session.title || session.locationName,
          attendanceDate: session.attendanceDate,
          trainingGroupId: session.trainingGroupId,
          trainingGroupName:
            (groupsMap.get(session.trainingGroupId) || {}).name || '',
          planId: session.planId || ''
        },
        attendanceStatus: record.status,
        feedback: feedbackMap.has(record.sessionId)
          ? readableFeedback(feedbackMap.get(record.sessionId))
          : null
      });
    }
    return sessions.sort((left, right) =>
      String(right.session.attendanceDate).localeCompare(
        String(left.session.attendanceDate)
      )
    );
  }

  async function listEligibleSessionsForStudent({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    return { sessions: await loadEligibleSessions(actor) };
  }

  async function listMyFeedback({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const result = await repository.listTrainingFeedback({
      studentUserId: actor._id,
      maxRecords: 300
    });
    return {
      feedback: result.records.map((item) => readableFeedback(item))
    };
  }

  async function submitFeedback({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateFeedbackSubmitPayload(payload);
    const session = await repository.getAttendanceSession(input.sessionId);
    if (!session) {
      fail('SESSION_NOT_FOUND', '训练场次不存在。');
    }
    const groupIds = await repository.getStudentGroupIds(actor._id);
    if (!groupIds.includes(session.trainingGroupId)) {
      fail('OUT_OF_SCOPE', '只能反馈本人训练组的训练场次。');
    }
    const attendance = await repository.getAttendanceRecord(
      input.sessionId,
      actor._id
    );
    if (
      !attendance ||
      ![
        ATTENDANCE_RECORD_STATUS.CHECKED_IN,
        ATTENDANCE_RECORD_STATUS.LATE
      ].includes(attendance.status)
    ) {
      fail(
        'ATTENDANCE_REQUIRED',
        '只有已签到或迟到的训练场次可以提交反馈；请假或未签到不能默认生成完成训练反馈。'
      );
    }
    const feedbackId = repository.feedbackIdForStudentSession(
      actor._id,
      input.sessionId
    );
    const existing = await repository.getTrainingFeedback(feedbackId);
    if (existing) {
      return { feedback: readableFeedback(existing), duplicate: true };
    }
    const now = new Date();
    const feedbackData = {
      feedbackId,
      studentUserId: actor._id,
      trainingGroupId: session.trainingGroupId,
      sessionId: input.sessionId,
      planId: session.planId || '',
      attendanceDate: session.attendanceDate,
      completionStatus: input.completionStatus,
      rpe: input.rpe,
      comment: input.comment,
      coachComment: '',
      coachCommentBy: '',
      coachCommentAt: null,
      coachCommentVersion: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.TRAINING_FEEDBACK)
        .doc(feedbackId);
      const current = await getDocumentOrNull(reference);
      if (current) {
        return;
      }
      await reference.set({ data: feedbackData });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_feedback_submit_${feedbackId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.FEEDBACK_SUBMITTED,
            targetType: 'training_feedback',
            targetId: feedbackId,
            result: 'success',
            metadata: {
              sessionId: input.sessionId,
              completionStatus: input.completionStatus,
              rpe: input.rpe
            },
            createdAt: now
          }
        });
    });
    const saved = await repository.getTrainingFeedback(feedbackId);
    return { feedback: readableFeedback(saved), duplicate: false };
  }

  async function updateFeedback({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateFeedbackUpdatePayload(payload);
    const feedback = await repository.getTrainingFeedback(input.feedbackId);
    if (!feedback || feedback.studentUserId !== actor._id) {
      fail('FEEDBACK_NOT_FOUND', '训练反馈不存在。');
    }
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.TRAINING_FEEDBACK)
        .doc(input.feedbackId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('FEEDBACK_NOT_FOUND', '训练反馈不存在。');
      }
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('FEEDBACK_VERSION_CONFLICT', '反馈已被更新，请重新加载。');
      }
      await reference.update({
        data: {
          completionStatus: input.completionStatus,
          rpe: input.rpe,
          comment: input.comment,
          version: input.expectedVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_feedback_update_${input.feedbackId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.FEEDBACK_UPDATED,
            targetType: 'training_feedback',
            targetId: input.feedbackId,
            result: 'success',
            metadata: { fromVersion: input.expectedVersion },
            createdAt: now
          }
        });
    });
    const updated = await repository.getTrainingFeedback(input.feedbackId);
    return { feedback: readableFeedback(updated) };
  }

  async function listManagedFeedback({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateFeedbackQueryPayload(payload || {});
    let studentUserIds = null;
    if (!isDeveloper(actor)) {
      const coachGroups = await repository.getCoachGroupIds(actor._id);
      const groupIds = input.trainingGroupId
        ? [input.trainingGroupId]
        : coachGroups;
      if (input.trainingGroupId && !coachGroups.includes(input.trainingGroupId)) {
        fail('OUT_OF_SCOPE', '只能查看本人负责训练组的反馈。');
      }
      studentUserIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentUserIds.length) {
        return { feedback: [], attentionCount: 0 };
      }
    }
    if (input.studentUserId && studentUserIds) {
      if (!studentUserIds.includes(input.studentUserId)) {
        fail('OUT_OF_SCOPE', '只能查看本人负责训练组学生的反馈。');
      }
      studentUserIds = [input.studentUserId];
    }
    const result = await repository.listTrainingFeedback({
      studentUserIds,
      studentUserId: input.studentUserId && !studentUserIds ? input.studentUserId : '',
      trainingGroupId: input.trainingGroupId,
      planId: input.planId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      maxRecords: 300
    });
    const filtered = result.records.filter(
      (feedback) => !input.needsAttention || feedbackNeedsAttention(feedback)
    );
    const studentIds = Array.from(
      new Set(filtered.map((feedback) => feedback.studentUserId))
    );
    const profilesMap = await repository.getProfilesMap(studentIds);
    const feedbackList = filtered.map((feedback) =>
      readableFeedback(feedback, {
        studentName: (profilesMap.get(feedback.studentUserId) || {}).name || '',
        needsAttention: feedbackNeedsAttention(feedback)
      })
    );
    return {
      feedback: feedbackList,
      attentionCount: feedbackList.filter((item) => item.needsAttention).length
    };
  }

  async function reviewFeedback({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateFeedbackReviewPayload(payload);
    const feedback = await repository.getTrainingFeedback(input.feedbackId);
    if (!feedback) {
      fail('FEEDBACK_NOT_FOUND', '训练反馈不存在。');
    }
    if (!isDeveloper(actor)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      const studentIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentIds.includes(feedback.studentUserId)) {
        fail('OUT_OF_SCOPE', '只能评价本人负责训练组学生的反馈。');
      }
    }
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.TRAINING_FEEDBACK)
        .doc(input.feedbackId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('FEEDBACK_NOT_FOUND', '训练反馈不存在。');
      }
      if (
        (Number(current.coachCommentVersion) || 0) !==
        input.expectedCoachCommentVersion
      ) {
        fail('FEEDBACK_COMMENT_CONFLICT', '评价已被其他教练更新，请重新加载。');
      }
      await reference.update({
        data: {
          coachComment: input.comment,
          coachCommentBy: actor._id,
          coachCommentAt: now,
          coachCommentVersion: input.expectedCoachCommentVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_feedback_review_${input.feedbackId}_${input.expectedCoachCommentVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.FEEDBACK_REVIEWED,
            targetType: 'training_feedback',
            targetId: input.feedbackId,
            result: 'success',
            metadata: {
              studentUserId: current.studentUserId,
              sessionId: current.sessionId,
              fromCommentVersion: input.expectedCoachCommentVersion,
              toCommentVersion: input.expectedCoachCommentVersion + 1
            },
            createdAt: now
          }
        });
    });
    const updated = await repository.getTrainingFeedback(input.feedbackId);
    return { feedback: readableFeedback(updated) };
  }

  return {
    'feedback.list_eligible_sessions': listEligibleSessionsForStudent,
    'feedback.list_mine': listMyFeedback,
    'feedback.submit': submitFeedback,
    'feedback.update': updateFeedback,
    'feedback.list_manage': listManagedFeedback,
    'feedback.review': reviewFeedback
  };
}

module.exports = createFeedbackActions;
