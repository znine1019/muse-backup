'use strict';

const {
  AUDIT_ACTIONS,
  REVIEW_STATUS,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const { loadUser, readableProfile } = require('../lib/session');
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
    const user = await loadUser(repository, identity);
    if (![USER_STATUS.PENDING_PROFILE, USER_STATUS.REJECTED].includes(user.status)) {
      if (user.status === USER_STATUS.PENDING_REVIEW) {
        fail('ALREADY_PENDING_REVIEW', '资料已提交，请等待教练员审核。');
      }
      fail('PROFILE_NOT_EDITABLE', '当前账号状态不能重新提交注册资料。');
    }

    const profile = validateProfilePayload(payload);
    if (profile.requestedTrainingGroupId) {
      const group = await repository.getTrainingGroup(profile.requestedTrainingGroupId);
      if (!group || group.enabled !== true) {
        fail('INVALID_TRAINING_GROUP', '申请的训练组不存在或已停用。');
      }
    }

    const profileId = repository.profileIdForUser(user._id);
    await repository.profileCollection.doc(profileId).set({
      data: {
        _id: profileId,
        userId: user._id,
        ...profile,
        reviewStatus: REVIEW_STATUS.PENDING,
        reviewComment: '',
        submittedAt: repository.db.serverDate(),
        updatedAt: repository.db.serverDate(),
        schemaVersion: 1
      }
    });

    const reviewId = deterministicId(
      'review',
      user._id,
      context.requestId || String(Date.now())
    );
    await repository.reviewCollection.doc(reviewId).set({
      data: {
        _id: reviewId,
        userId: user._id,
        profileId,
        status: REVIEW_STATUS.PENDING,
        comment: '',
        submittedAt: repository.db.serverDate(),
        createdAt: repository.db.serverDate()
      }
    });

    await repository.userCollection.doc(user._id).update({
      data: {
        status: USER_STATUS.PENDING_REVIEW,
        updatedAt: repository.db.serverDate()
      }
    });

    const updatedUser = await repository.getUserById(user._id);
    await repository.writeAudit({
      actorUserId: user._id,
      action: AUDIT_ACTIONS.PROFILE_SUBMITTED,
      targetType: 'student_profile',
      targetId: profileId,
      result: 'success',
      metadata: {
        requestedTrainingGroupId: profile.requestedTrainingGroupId || ''
      }
    });

    return {
      userStatus: updatedUser.status,
      reviewStatus: REVIEW_STATUS.PENDING
    };
  }

  return {
    'profile.get': getProfile,
    'profile.submit': submitProfile
  };
}

module.exports = createProfileActions;
