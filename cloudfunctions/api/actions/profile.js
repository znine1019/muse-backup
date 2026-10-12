'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  REVIEW_STATUS,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const { loadUser, readableProfile } = require('../lib/session');
const { getProfileSubmissionDecision } = require('../lib/state-guards');
const { getDocumentOrNull } = require('../lib/transaction');
const { validateProfilePayload } = require('../lib/validation');

function createProfileActions({ repository }) {
  async function getProfile({ identity }) {
    const user = await loadUser(repository, identity, { allowDisabled: true });
    if (user.status === USER_STATUS.DISABLED) {
      return {
        userStatus: user.status,
        profile: null,
        reviewComment: ''
      };
    }

    const profile = await repository.getProfile(user._id);
    const review = await repository.getLatestReview(user._id);
    return {
      userStatus: user.status,
      profile: readableProfile(profile),
      reviewComment: (review && review.comment) || (profile && profile.reviewComment) || ''
    };
  }

  async function submitProfile({ identity, payload, context }) {
    const initialUser = await loadUser(repository, identity);
    const initialDecision = getProfileSubmissionDecision(initialUser.status);
    if (initialDecision.action === 'idempotent') {
      return {
        userStatus: USER_STATUS.PENDING_REVIEW,
        reviewStatus: REVIEW_STATUS.PENDING,
        duplicate: true
      };
    }

    const profile = validateProfilePayload(payload);
    if (profile.requestedTrainingGroupId) {
      const group = await repository.getTrainingGroup(profile.requestedTrainingGroupId);
      if (!group || group.enabled !== true) {
        fail('INVALID_TRAINING_GROUP', '申请的训练组不存在或已停用。');
      }
    }

    const profileId = repository.profileIdForUser(initialUser._id);
    const reviewId = deterministicId(
      'review',
      initialUser._id,
      context.requestId || String(Date.now())
    );

    return repository.db.runTransaction(async (transaction) => {
      const userReference = transaction
        .collection(COLLECTIONS.USERS)
        .doc(initialUser._id);
      const currentUser = await getDocumentOrNull(userReference);
      if (!currentUser) {
        fail('USER_NOT_FOUND', '当前用户账号不存在。');
      }
      const currentDecision = getProfileSubmissionDecision(currentUser.status);
      if (currentDecision.action === 'idempotent') {
        return {
          userStatus: USER_STATUS.PENDING_REVIEW,
          reviewStatus: REVIEW_STATUS.PENDING,
          duplicate: true
        };
      }

      const profileReference = transaction
        .collection(COLLECTIONS.STUDENT_PROFILES)
        .doc(profileId);
      const submittedAt = repository.db.serverDate();

      await profileReference.set({
        data: {
          userId: currentUser._id,
          ...profile,
          reviewStatus: REVIEW_STATUS.PENDING,
          reviewComment: '',
          submittedAt,
          updatedAt: repository.db.serverDate(),
          currentReviewId: reviewId,
          schemaVersion: 1
        }
      });
      await transaction
        .collection(COLLECTIONS.REGISTRATION_REVIEWS)
        .doc(reviewId)
        .set({
          data: {
            userId: currentUser._id,
            profileId,
            status: REVIEW_STATUS.PENDING,
            comment: '',
            submittedAt: repository.db.serverDate(),
            createdAt: repository.db.serverDate()
          }
        });
      await userReference.update({
        data: {
          status: USER_STATUS.PENDING_REVIEW,
          updatedAt: repository.db.serverDate()
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_profile_submit_${reviewId}`)
        .set({
          data: {
            actorUserId: currentUser._id,
            action: AUDIT_ACTIONS.PROFILE_SUBMITTED,
            targetType: 'student_profile',
            targetId: profileId,
            result: 'success',
            metadata: {
              requestedTrainingGroupId: profile.requestedTrainingGroupId || ''
            },
            createdAt: repository.db.serverDate()
          }
        });

      return {
        userStatus: USER_STATUS.PENDING_REVIEW,
        reviewStatus: REVIEW_STATUS.PENDING,
        duplicate: false
      };
    });
  }

  return {
    'profile.get': getProfile,
    'profile.submit': submitProfile
  };
}

module.exports = createProfileActions;
