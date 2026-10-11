'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  REVIEW_STATUS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const { canReviewRegistration } = require('../lib/policy');
const { loadActiveActor } = require('../lib/session');
const { assertRegistrationPending } = require('../lib/state-guards');
const { getDocumentOrNull } = require('../lib/transaction');
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
    const initialUser = await repository.getUserById(reviewInput.targetUserId);
    if (!initialUser) {
      fail('USER_NOT_FOUND', '未找到待审核用户。');
    }

    const initialProfile = await repository.getProfile(initialUser._id);
    assertRegistrationPending(initialProfile);

    let coachGroupIds = [];
    if (actor.roles.includes(ROLES.COACH) && !actor.roles.includes(ROLES.DEVELOPER)) {
      coachGroupIds = await repository.getCoachGroupIds(actor._id);
    }
    if (
      !canReviewRegistration(
        actor,
        initialProfile.requestedTrainingGroupId,
        coachGroupIds
      )
    ) {
      fail('OUT_OF_SCOPE', '只能审核本人负责训练组内的学生。');
    }

    const profileId = repository.profileIdForUser(initialUser._id);
    const fallbackReview = initialProfile.currentReviewId
      ? null
      : await repository.getLatestReview(initialUser._id);
    const reviewDocumentId =
      initialProfile.currentReviewId || (fallbackReview && fallbackReview._id) || '';
    const approved = reviewInput.decision === 'approve';

    return repository.db.runTransaction(async (transaction) => {
      const profileReference = transaction
        .collection(COLLECTIONS.STUDENT_PROFILES)
        .doc(profileId);
      const currentProfile = await getDocumentOrNull(profileReference);
      assertRegistrationPending(currentProfile);
      if (
        !canReviewRegistration(
          actor,
          currentProfile.requestedTrainingGroupId,
          coachGroupIds
        )
      ) {
        fail('OUT_OF_SCOPE', '只能审核本人负责训练组内的学生。');
      }

      const userReference = transaction
        .collection(COLLECTIONS.USERS)
        .doc(initialUser._id);
      const currentUser = await getDocumentOrNull(userReference);
      if (!currentUser) {
        fail('USER_NOT_FOUND', '未找到待审核用户。');
      }

      const nextRoles = approved
        ? Array.from(new Set([...(currentUser.roles || []), ROLES.STUDENT]))
        : currentUser.roles || [];
      const nextStatus = approved ? USER_STATUS.ACTIVE : USER_STATUS.REJECTED;

      await userReference.update({
        data: {
          status: nextStatus,
          roles: nextRoles,
          updatedAt: repository.db.serverDate()
        }
      });
      await profileReference.update({
        data: {
          reviewStatus: approved ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
          reviewComment: reviewInput.comment,
          reviewedBy: actor._id,
          reviewedAt: repository.db.serverDate(),
          updatedAt: repository.db.serverDate()
        }
      });

      const currentReviewDocumentId =
        currentProfile.currentReviewId || reviewDocumentId;
      if (currentReviewDocumentId) {
        await transaction
          .collection(COLLECTIONS.REGISTRATION_REVIEWS)
          .doc(currentReviewDocumentId)
          .update({
            data: {
              status: approved ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
              comment: reviewInput.comment,
              reviewedBy: actor._id,
              reviewedAt: repository.db.serverDate()
            }
          });
      }

      if (approved) {
        await transaction
          .collection(COLLECTIONS.ROLE_BINDINGS)
          .doc(repository.roleBindingId(currentUser._id, ROLES.STUDENT))
          .set({
            data: {
              userId: currentUser._id,
              role: ROLES.STUDENT,
              status: 'active',
              grantedBy: actor._id,
              grantedAt: repository.db.serverDate(),
              updatedAt: repository.db.serverDate()
            }
          });
        if (currentProfile.requestedTrainingGroupId) {
          await transaction
            .collection(COLLECTIONS.GROUP_MEMBERSHIPS)
            .doc(
              repository.membershipId(
                currentProfile.requestedTrainingGroupId,
                currentUser._id
              )
            )
            .set({
              data: {
                userId: currentUser._id,
                groupId: currentProfile.requestedTrainingGroupId,
                roleInGroup: ROLES.STUDENT,
                status: 'active',
                assignedBy: actor._id,
                assignedAt: repository.db.serverDate(),
                updatedAt: repository.db.serverDate()
              }
            });
        }
      }

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(
          deterministicId(
            'audit_registration',
            currentUser._id,
            currentProfile.currentReviewId || 'current',
            actor._id
          )
        )
        .set({
          data: {
            actorUserId: actor._id,
            action: approved
              ? AUDIT_ACTIONS.REGISTRATION_APPROVED
              : AUDIT_ACTIONS.REGISTRATION_REJECTED,
            targetType: 'user',
            targetId: currentUser._id,
            result: 'success',
            metadata: {
              decision: reviewInput.decision,
              trainingGroupId: currentProfile.requestedTrainingGroupId || ''
            },
            createdAt: repository.db.serverDate()
          }
        });

      return {
        userId: currentUser._id,
        status: nextStatus,
        roles: nextRoles
      };
    });
  }

  return {
    'admin.list_pending_registrations': listPendingRegistrations,
    'admin.review_registration': reviewRegistration
  };
}

module.exports = createRegistrationActions;
