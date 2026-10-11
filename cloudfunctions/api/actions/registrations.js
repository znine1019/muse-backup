'use strict';

const {
  AUDIT_ACTIONS,
  REVIEW_STATUS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { canReviewRegistration } = require('../lib/policy');
const { loadActiveActor } = require('../lib/session');
const { validateReviewPayload } = require('../lib/validation');

function createRegistrationActions({ repository }) {
  async function listPendingRegistrations({ identity }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH
    ]);
    let coachGroupIds = [];

    if (!actor.roles.includes(ROLES.DEVELOPER)) {
      coachGroupIds = await repository.getCoachGroupIds(actor._id);
      if (!coachGroupIds.length) {
        return { registrations: [] };
      }
    }

    const where = { reviewStatus: REVIEW_STATUS.PENDING };
    if (!actor.roles.includes(ROLES.DEVELOPER)) {
      where.requestedTrainingGroupId = repository.db.command.in(coachGroupIds);
    }

    const allProfiles = await repository.queryAll(repository.profileCollection, where, 300);
    const profiles = allProfiles.sort((left, right) => {
      const leftTime = new Date(left.submittedAt || 0).getTime();
      const rightTime = new Date(right.submittedAt || 0).getTime();
      return rightTime - leftTime;
    });
    const groupMap = await repository.getGroupsMap(
      profiles.map((profile) => profile.requestedTrainingGroupId).filter(Boolean)
    );

    return {
      registrations: profiles
        .filter((profile) =>
          canReviewRegistration(
            actor,
            profile.requestedTrainingGroupId,
            coachGroupIds
          )
        )
        .map((profile) => ({
          userId: profile.userId,
          profileId: profile._id,
          name: profile.name,
          gender: profile.gender,
          birthDate: profile.birthDate,
          heightCm: profile.heightCm,
          weightKg: profile.weightKg,
          primaryTrainingProject: profile.primaryTrainingProject,
          requestedTrainingGroupId: profile.requestedTrainingGroupId || '',
          requestedTrainingGroupName:
            (groupMap.get(profile.requestedTrainingGroupId) || {}).name || '未选择',
          submittedAt: profile.submittedAt
        }))
    };
  }

  async function reviewRegistration({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH
    ]);
    const reviewInput = validateReviewPayload(payload);
    const targetUser = await repository.getUserById(reviewInput.targetUserId);
    if (!targetUser) {
      fail('USER_NOT_FOUND', '未找到待审核用户。');
    }

    const profile = await repository.getProfile(targetUser._id);
    if (!profile || profile.reviewStatus !== REVIEW_STATUS.PENDING) {
      fail('REVIEW_NOT_PENDING', '该注册资料当前不在待审核状态。');
    }

    let coachGroupIds = [];
    if (actor.roles.includes(ROLES.COACH) && !actor.roles.includes(ROLES.DEVELOPER)) {
      coachGroupIds = await repository.getCoachGroupIds(actor._id);
    }
    if (
      !canReviewRegistration(
        actor,
        profile.requestedTrainingGroupId,
        coachGroupIds
      )
    ) {
      fail('OUT_OF_SCOPE', '只能审核本人负责训练组内的学生。');
    }

    const approved = reviewInput.decision === 'approve';
    const nextRoles = approved
      ? Array.from(new Set([...(targetUser.roles || []), ROLES.STUDENT]))
      : targetUser.roles || [];
    const nextStatus = approved ? USER_STATUS.ACTIVE : USER_STATUS.REJECTED;

    await repository.userCollection.doc(targetUser._id).update({
      data: {
        status: nextStatus,
        roles: nextRoles,
        updatedAt: repository.db.serverDate()
      }
    });
    await repository.profileCollection.doc(profile._id).update({
      data: {
        reviewStatus: approved ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
        reviewComment: reviewInput.comment,
        reviewedBy: actor._id,
        reviewedAt: repository.db.serverDate(),
        updatedAt: repository.db.serverDate()
      }
    });

    const pendingReviewResult = await repository.reviewCollection
      .where({ userId: targetUser._id, status: REVIEW_STATUS.PENDING })
      .limit(10)
      .get();
    for (const review of pendingReviewResult.data || []) {
      await repository.reviewCollection.doc(review._id).update({
        data: {
          status: approved ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
          comment: reviewInput.comment,
          reviewedBy: actor._id,
          reviewedAt: repository.db.serverDate()
        }
      });
    }

    if (approved) {
      await repository.setRoleBinding({
        userId: targetUser._id,
        role: ROLES.STUDENT,
        grantedBy: actor._id,
        active: true
      });
      if (profile.requestedTrainingGroupId) {
        await repository.setGroupMembership({
          userId: targetUser._id,
          groupId: profile.requestedTrainingGroupId,
          roleInGroup: ROLES.STUDENT,
          assignedBy: actor._id,
          active: true
        });
      }
    }

    await repository.writeAudit({
      actorUserId: actor._id,
      action: approved
        ? AUDIT_ACTIONS.REGISTRATION_APPROVED
        : AUDIT_ACTIONS.REGISTRATION_REJECTED,
      targetType: 'user',
      targetId: targetUser._id,
      result: 'success',
      metadata: {
        decision: reviewInput.decision,
        trainingGroupId: profile.requestedTrainingGroupId || ''
      }
    });

    return {
      userId: targetUser._id,
      status: nextStatus,
      roles: nextRoles
    };
  }

  return {
    'admin.list_pending_registrations': listPendingRegistrations,
    'admin.review_registration': reviewRegistration
  };
}

module.exports = createRegistrationActions;
