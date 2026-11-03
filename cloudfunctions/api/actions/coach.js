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
const { loadOptionalUser } = require('../lib/session');
const {
  getOrCreateRegistrationUser,
  resolveRegistrationIdentity
} = require('../lib/registration-account');
const { getDocumentOrNull } = require('../lib/transaction');
const { validateCoachProfilePayload } = require('../lib/validation');

function readableCoachProfile(profile) {
  if (!profile) {
    return null;
  }
  return {
    id: profile._id,
    userId: profile.userId,
    name: profile.name || '',
    identityNote: profile.identityNote || '',
    reviewStatus: profile.reviewStatus || '',
    reviewComment: profile.reviewComment || '',
    currentReviewId: profile.currentReviewId || '',
    submittedAt: profile.submittedAt || null,
    reviewedAt: profile.reviewedAt || null,
    source: profile.source || ''
  };
}

function createCoachActions({ repository }) {
  async function getCoachProfile({ identity }) {
    const user = await loadOptionalUser(repository, identity);
    if (!user) {
      return {
        userStatus: 'unregistered',
        registered: false,
        pendingProfileType: '',
        roles: [],
        profile: null
      };
    }
    const profile = await repository.getCoachProfile(user._id);
    return {
      userStatus: user.status,
      registered: true,
      pendingProfileType: user.pendingProfileType || '',
      roles: user.roles || [],
      profile: readableCoachProfile(profile)
    };
  }

  async function submitCoachProfile({ identity, payload }) {
    const input = validateCoachProfilePayload(payload);
    const registration = await resolveRegistrationIdentity(
      repository,
      identity,
      ROLES.COACH
    );
    const profileId = repository.coachProfileIdForUser(registration.userId);

    return repository.db.runTransaction(async (transaction) => {
      const account = await getOrCreateRegistrationUser(
        repository,
        transaction,
        registration
      );
      const { user: currentUser, userReference } = account;
      const profileReference = transaction
        .collection(COLLECTIONS.COACH_PROFILES)
        .doc(profileId);
      const currentProfile = await getDocumentOrNull(profileReference);
      if (
        currentProfile &&
        currentProfile.reviewStatus === REVIEW_STATUS.APPROVED
      ) {
        fail('COACH_PROFILE_APPROVED', '教练实名资料已通过审核，无需重复提交。');
      }
      if (
        currentProfile &&
        currentProfile.reviewStatus === REVIEW_STATUS.PENDING
      ) {
        fail('REVIEW_ALREADY_PENDING', '教练实名资料正在审核中，请勿重复提交。');
      }
      if (
        currentUser.status === USER_STATUS.PENDING_REVIEW &&
        currentUser.pendingProfileType &&
        currentUser.pendingProfileType !== ROLES.COACH
      ) {
        fail(
          'REGISTRATION_ALREADY_PENDING',
          '当前账号已有待审核注册资料，请先完成原审核。'
        );
      }

      const existingCoach = (currentUser.roles || []).includes(ROLES.COACH);
      const source = existingCoach ? 'legacy_backfill' : 'self_registration';
      const nextSubmissionCount =
        (Number(currentProfile && currentProfile.submissionCount) || 0) + 1;
      const reviewId = deterministicId(
        'coach_review',
        currentUser._id,
        nextSubmissionCount
      );
      const nextStatus =
        currentUser.status === USER_STATUS.ACTIVE
          ? USER_STATUS.ACTIVE
          : USER_STATUS.PENDING_REVIEW;
      const submittedAt = repository.db.serverDate();

      await profileReference.set({
        data: {
          userId: currentUser._id,
          name: input.name,
          identityNote: input.identityNote,
          reviewStatus: REVIEW_STATUS.PENDING,
          reviewComment: '',
          currentReviewId: reviewId,
          submittedAt,
          reviewedBy: '',
          reviewedAt: null,
          source,
          submissionCount: nextSubmissionCount,
          createdAt:
            (currentProfile && currentProfile.createdAt) ||
            repository.db.serverDate(),
          updatedAt: repository.db.serverDate(),
          schemaVersion: 1
        }
      });

      await transaction
        .collection(COLLECTIONS.REGISTRATION_REVIEWS)
        .doc(reviewId)
        .set({
          data: {
            reviewId,
            userId: currentUser._id,
            profileId,
            profileType: ROLES.COACH,
            status: REVIEW_STATUS.PENDING,
            comment: '',
            requestedTrainingGroupId: '',
            submittedAt: repository.db.serverDate(),
            reviewedBy: '',
            reviewedAt: null
          }
        });

      await userReference.update({
        data: {
          status: nextStatus,
          pendingProfileType: ROLES.COACH,
          updatedAt: repository.db.serverDate()
        }
      });

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_coach_profile', currentUser._id, reviewId))
        .set({
          data: {
            actorUserId: currentUser._id,
            action: AUDIT_ACTIONS.COACH_PROFILE_SUBMITTED,
            targetType: 'user',
            targetId: currentUser._id,
            result: 'success',
            metadata: {
              profileType: ROLES.COACH,
              backfillExistingCoach: existingCoach
            },
            createdAt: repository.db.serverDate()
          }
        });

      return {
        status: nextStatus,
        pendingProfileType: ROLES.COACH,
        profile: readableCoachProfile({
          _id: profileId,
          userId: currentUser._id,
          name: input.name,
          identityNote: input.identityNote,
          reviewStatus: REVIEW_STATUS.PENDING,
          currentReviewId: reviewId,
          source
        })
      };
    });
  }

  return {
    'coach.get_profile': getCoachProfile,
    'coach.submit_profile': submitCoachProfile
  };
}

module.exports = createCoachActions;
