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
const {
  canReviewRegistration,
  nextParentAuthorizationVersion
} = require('../lib/policy');
const { loadActiveActor } = require('../lib/session');
const { assertRegistrationPending } = require('../lib/state-guards');
const { getDocumentOrNull } = require('../lib/transaction');
const { validateReviewPayload } = require('../lib/validation');

function formatTrainingGroupName(group) {
  if (!group) {
    return '未选择';
  }
  return `${group.name}（${group.seasonLabel || '未标注'}）`;
}

function createRegistrationActions({ repository }) {
  async function listPendingRegistrations({ identity }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH
    ]);
    const isDeveloper = actor.roles.includes(ROLES.DEVELOPER);
    let coachGroupIds = [];

    if (!isDeveloper) {
      coachGroupIds = await repository.getCoachGroupIds(actor._id);
      if (!coachGroupIds.length) {
        return { registrations: [] };
      }
    }

    const where = { reviewStatus: REVIEW_STATUS.PENDING };
    if (!isDeveloper) {
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

    const studentRegistrations = profiles
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
          profileType: ROLES.STUDENT,
          name: profile.name,
          gender: profile.gender,
          birthDate: profile.birthDate,
          heightCm: profile.heightCm,
          weightKg: profile.weightKg,
          primaryTrainingProject: profile.primaryTrainingProject,
          requestedTrainingGroupId: profile.requestedTrainingGroupId || '',
          requestedTrainingGroupName:
            formatTrainingGroupName(groupMap.get(profile.requestedTrainingGroupId)),
        submittedAt: profile.submittedAt
      }));

    /* 家长注册没有训练组归属，仅开发者可见与审核 */
    const parentRegistrations = isDeveloper
      ? (
          await repository.queryAll(
            repository.parentProfileCollection,
            { reviewStatus: REVIEW_STATUS.PENDING },
            200
          )
        )
          .sort((left, right) => {
            const leftTime = new Date(left.submittedAt || 0).getTime();
            const rightTime = new Date(right.submittedAt || 0).getTime();
            return rightTime - leftTime;
          })
          .map((profile) => ({
            userId: profile.userId,
            profileId: profile._id,
            profileType: ROLES.PARENT,
            name: profile.name,
            gender: '',
            birthDate: '',
            heightCm: null,
            weightKg: null,
            primaryTrainingProject: '',
            parentRelation: profile.relation || 'guardian',
            requestedTrainingGroupId: '',
            requestedTrainingGroupName: '家长账号',
            submittedAt: profile.submittedAt
          }))
      : [];

    return { registrations: studentRegistrations.concat(parentRegistrations) };
  }

  async function reviewRegistration({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH
    ]);
    const reviewInput = validateReviewPayload(payload);
    const initialUser = await repository.getUserById(reviewInput.targetUserId);
    if (reviewInput.profileType === ROLES.PARENT) {
      return reviewParentRegistration({ actor, reviewInput });
    }

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


  /**
   * 家长注册审核：仅开发者可执行。
   * 通过后授予 parent 角色；驳回时若账号已拥有其它角色则保持可用，避免误伤既有权限。
   */
  async function reviewParentRegistration({ actor, reviewInput }) {
    if (!actor.roles.includes(ROLES.DEVELOPER)) {
      fail('OUT_OF_SCOPE', '家长注册审核仅开发者可以执行。');
    }

    const initialUser = await repository.getUserById(reviewInput.targetUserId);
    if (!initialUser) {
      fail('USER_NOT_FOUND', '未找到待审核用户。');
    }
    const profileId = repository.parentProfileIdForUser(initialUser._id);
    const initialProfile = await repository.getParentProfile(initialUser._id);
    if (!initialProfile || initialProfile.reviewStatus !== REVIEW_STATUS.PENDING) {
      fail('REVIEW_NOT_PENDING', '该家长资料当前不可审核。');
    }

    const approved = reviewInput.decision === 'approve';

    return repository.db.runTransaction(async (transaction) => {
      const profileReference = transaction
        .collection(COLLECTIONS.PARENT_PROFILES)
        .doc(profileId);
      const currentProfile = await getDocumentOrNull(profileReference);
      if (!currentProfile || currentProfile.reviewStatus !== REVIEW_STATUS.PENDING) {
        fail('REVIEW_NOT_PENDING', '该家长资料已被处理。');
      }

      const userReference = transaction
        .collection(COLLECTIONS.USERS)
        .doc(initialUser._id);
      const currentUser = await getDocumentOrNull(userReference);
      if (!currentUser) {
        fail('USER_NOT_FOUND', '未找到待审核用户。');
      }
      if (currentUser.status === USER_STATUS.DISABLED) {
        fail('ACCOUNT_DISABLED', '该账号已停用，请先启用账号再审核注册资料。');
      }

      const currentRoles = currentUser.roles || [];
      const otherRoles = currentRoles.filter((role) => role !== ROLES.PARENT);
      const nextRoles = approved
        ? Array.from(new Set([...currentRoles, ROLES.PARENT]))
        : currentRoles;
      const nextParentVersion = approved
        ? nextParentAuthorizationVersion(currentUser)
        : undefined;
      let nextStatus = USER_STATUS.ACTIVE;
      if (!approved && !otherRoles.length) {
        nextStatus = USER_STATUS.REJECTED;
      }

      await userReference.update({
        data: {
          status: nextStatus,
          roles: nextRoles,
          pendingProfileType: approved || otherRoles.length ? '' : ROLES.PARENT,
          ...(approved ? { parentAuthorizationVersion: nextParentVersion } : {}),
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

      if (currentProfile.currentReviewId) {
        await transaction
          .collection(COLLECTIONS.REGISTRATION_REVIEWS)
          .doc(currentProfile.currentReviewId)
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
          .doc(repository.roleBindingId(initialUser._id, ROLES.PARENT))
          .set({
            data: {
              userId: initialUser._id,
              role: ROLES.PARENT,
              status: 'active',
              grantedBy: actor._id,
              grantedAt: repository.db.serverDate(),
              updatedAt: repository.db.serverDate()
            }
          });
      }

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_parent_review', initialUser._id, profileId, actor._id))
        .set({
          data: {
            actorUserId: actor._id,
            action: approved
              ? AUDIT_ACTIONS.REGISTRATION_APPROVED
              : AUDIT_ACTIONS.REGISTRATION_REJECTED,
            targetType: 'user',
            targetId: initialUser._id,
            result: 'success',
            metadata: { profileType: ROLES.PARENT, decision: reviewInput.decision },
            createdAt: repository.db.serverDate()
          }
        });

      return {
        userId: initialUser._id,
        status: nextStatus,
        roles: nextRoles,
        profileType: ROLES.PARENT
      };
    });
  }

  return {
    'admin.list_pending_registrations': listPendingRegistrations,
    'admin.review_registration': reviewRegistration
  };
}

module.exports = createRegistrationActions;
