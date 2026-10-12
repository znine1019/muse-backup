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
const { loadActiveActor, loadUser, readableProfile } = require('../lib/session');
const { getProfileSubmissionDecision } = require('../lib/state-guards');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  safeId,
  validateMeasurementPayload,
  validateProfilePayload,
  validateStudentProfileUpdatePayload
} = require('../lib/validation');

function toDateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function readableMeasurement(record) {
  return {
    id: record._id,
    userId: record.userId,
    heightCm: record.heightCm,
    weightKg: record.weightKg,
    measuredAt: record.measuredAt,
    createdAt: record.createdAt || null
  };
}

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
    status: record.status,
    reviewComment: record.reviewComment || '',
    reviewedAt: record.reviewedAt || null,
    createdAt: record.createdAt || null
  };
}

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


  async function updateProfile({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const update = validateStudentProfileUpdatePayload(payload);
    const profileId = repository.profileIdForUser(actor._id);
    const completedAt = new Date();
    const auditId = deterministicId(
      'audit_profile_update',
      actor._id,
      completedAt.toISOString()
    );

    await repository.db.runTransaction(async (transaction) => {
      const profileReference = transaction
        .collection(COLLECTIONS.STUDENT_PROFILES)
        .doc(profileId);
      const profile = await getDocumentOrNull(profileReference);
      if (!profile) {
        fail('PROFILE_NOT_FOUND', '学生档案不存在。');
      }
      await profileReference.update({
        data: {
          ...update,
          updatedAt: completedAt
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(auditId)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PROFILE_UPDATED,
            targetType: 'student_profile',
            targetId: profileId,
            result: 'success',
            metadata: { fields: Object.keys(update) },
            createdAt: completedAt
          }
        });
    });

    const profile = await repository.getProfile(actor._id);
    return { profile: readableProfile(profile) };
  }

  async function addMeasurement({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const measurement = validateMeasurementPayload(payload);
    const measurementId = repository.measurementIdForUser(
      actor._id,
      measurement.measuredAt,
      measurement.heightCm,
      measurement.weightKg
    );
    const completedAt = new Date();
    const measuredAt = toDateOnly(measurement.measuredAt);

    const result = await repository.db.runTransaction(async (transaction) => {
      const measurementReference = transaction
        .collection(COLLECTIONS.BODY_MEASUREMENTS)
        .doc(measurementId);
      const existing = await getDocumentOrNull(measurementReference);
      if (existing) {
        return { duplicate: true };
      }

      const profileReference = transaction
        .collection(COLLECTIONS.STUDENT_PROFILES)
        .doc(repository.profileIdForUser(actor._id));
      const profile = await getDocumentOrNull(profileReference);
      if (!profile) {
        fail('PROFILE_NOT_FOUND', '学生档案不存在。');
      }

      await measurementReference.set({
        data: {
          userId: actor._id,
          heightCm: measurement.heightCm,
          weightKg: measurement.weightKg,
          measuredAt,
          source: 'student_report',
          submittedBy: actor._id,
          createdAt: completedAt,
          schemaVersion: 1
        }
      });
      await profileReference.update({
        data: {
          heightCm: measurement.heightCm,
          weightKg: measurement.weightKg,
          currentHeightCm: measurement.heightCm,
          currentWeightKg: measurement.weightKg,
          latestMeasurementAt: measuredAt,
          updatedAt: completedAt
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_measurement_${measurementId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.MEASUREMENT_RECORDED,
            targetType: 'body_measurement',
            targetId: measurementId,
            result: 'success',
            metadata: { measuredAt: measurement.measuredAt },
            createdAt: completedAt
          }
        });
      return { duplicate: false };
    });

    return {
      measurementId,
      duplicate: result.duplicate,
      ...measurement
    };
  }

  async function listMeasurements({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const measurements = await repository.listMeasurements(actor._id, 100);
    return { measurements: measurements.map(readableMeasurement) };
  }

  async function listStudentProfiles({ identity }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH
    ]);
    let profiles;
    if (actor.roles.includes(ROLES.DEVELOPER)) {
      profiles = await repository.listAllProfiles(300);
    } else {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      const studentIds = await repository.getStudentUserIdsForGroups(groupIds);
      const profileMap = await repository.getProfilesMap(studentIds);
      profiles = Array.from(profileMap.values());
    }
    return {
      profiles: profiles
        .filter((profile) => profile.reviewStatus === REVIEW_STATUS.APPROVED)
        .map(readableProfile)
    };
  }

  async function getStudentProfile({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH
    ]);
    const targetUserId = safeId(payload && payload.targetUserId, '学生账号');
    const targetUser = await repository.getUserById(targetUserId);
    if (
      !targetUser ||
      targetUser.status !== USER_STATUS.ACTIVE ||
      !(targetUser.roles || []).includes(ROLES.STUDENT)
    ) {
      fail('STUDENT_NOT_FOUND', '未找到有效学生账号。');
    }
    if (actor.roles.includes(ROLES.COACH) && !actor.roles.includes(ROLES.DEVELOPER)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      const studentIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentIds.includes(targetUserId)) {
        fail('OUT_OF_SCOPE', '只能查看本人负责训练组内的学生档案。');
      }
    }
    const profile = await repository.getProfile(targetUserId);
    if (!profile) {
      fail('PROFILE_NOT_FOUND', '学生档案不存在。');
    }
    const [measurements, performances] = await Promise.all([
      repository.listMeasurements(targetUserId, 20),
      repository.listPerformanceRecords(targetUserId, 20)
    ]);
    return {
      profile: readableProfile(profile),
      measurements: measurements.map(readableMeasurement),
      performances: performances.map(readablePerformanceRecord)
    };
  }

  return {
    'profile.get': getProfile,
    'profile.update': updateProfile,
    'profile.add_measurement': addMeasurement,
    'profile.list_measurements': listMeasurements,
    'admin.list_student_profiles': listStudentProfiles,
    'admin.get_student_profile': getStudentProfile,
    'profile.submit': submitProfile
  };
}

module.exports = createProfileActions;
