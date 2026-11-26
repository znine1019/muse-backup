'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const { loadActiveActor } = require('../lib/session');
const { hasRealNameProfile } = require('../lib/profile-name');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  validateGroupCoachPayload,
  validateGroupName,
  safeId,
  validateTrainingGroupDeletionPayload,
  validateTrainingGroupStatusPayload,
  validateGroupSeasonLabel
} = require('../lib/validation');

function createGroupAdminActions({ repository }) {
  async function buildTrainingGroupDeletionImpact(group) {
    const groupId = group._id;
    const containsGroupId = repository.db.command.in([groupId]);
    const counts = await Promise.all([
      repository.countWhere(repository.membershipCollection, { groupId }),
      repository.countWhere(repository.membershipCollection, {
        groupId,
        status: 'active'
      }),
      repository.countWhere(repository.profileCollection, {
        requestedTrainingGroupId: groupId
      }),
      repository.countWhere(repository.reviewCollection, {
        requestedTrainingGroupId: groupId
      }),
      repository.countWhere(repository.performanceCollection, { trainingGroupId: groupId }),
      repository.countWhere(repository.trainingPlanCollection, { trainingGroupId: groupId }),
      repository.countWhere(repository.attendanceSessionCollection, {
        trainingGroupId: groupId
      }),
      repository.countWhere(repository.attendanceRecordCollection, {
        trainingGroupId: groupId
      }),
      repository.countWhere(repository.leaveRequestCollection, { trainingGroupId: groupId }),
      repository.countWhere(repository.competitionCollection, {
        trainingGroupIds: containsGroupId
      }),
      repository.countWhere(repository.competitionRegistrationCollection, {
        trainingGroupIds: containsGroupId
      }),
      repository.countWhere(repository.clubNoticeCollection, {
        trainingGroupIds: containsGroupId
      }),
      repository.countWhere(repository.trainingFeedbackCollection, {
        trainingGroupId: groupId
      }),
      repository.countWhere(repository.auditCollection, {
        targetType: 'training_group',
        targetId: groupId
      })
    ]);
    const [
      groupMemberships,
      activeGroupMemberships,
      studentProfileRequests,
      registrationReviewRequests,
      performanceRecords,
      trainingPlans,
      attendanceSessions,
      attendanceRecords,
      leaveRequests,
      competitions,
      competitionRegistrations,
      notices,
      trainingFeedback,
      auditLogs
    ] = counts;
    const blockingAssociationCount =
      groupMemberships +
      studentProfileRequests +
      registrationReviewRequests +
      performanceRecords +
      trainingPlans +
      attendanceSessions +
      attendanceRecords +
      leaveRequests +
      competitions +
      competitionRegistrations +
      notices +
      trainingFeedback;
    const deleted = Boolean(group.status === 'deleted' || group.deletedAt);
    return {
      targetGroupId: groupId,
      name: group.name || '',
      seasonLabel: group.seasonLabel || '未标注',
      enabled: group.enabled === true,
      deleted,
      canDelete:
        !deleted &&
        blockingAssociationCount === 0,
      blockingAssociationCount,
      associationCounts: {
        groupMemberships,
        activeGroupMemberships,
        studentProfileRequests,
        registrationReviewRequests,
        performanceRecords,
        trainingPlans,
        attendanceSessions,
        attendanceRecords,
        leaveRequests,
        competitions,
        competitionRegistrations,
        notices,
        trainingFeedback,
        auditLogs
      }
    };
  }

  async function listTrainingGroups({ identity }) {
    await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const groups = await repository.listAllTrainingGroups();
    const groupIds = groups.map((group) => group._id);
    let coachMemberships = [];

    if (groupIds.length) {
      const membershipResult = await repository.membershipCollection
        .where({
          groupId: repository.db.command.in(groupIds),
          roleInGroup: ROLES.COACH,
          status: 'active'
        })
        .limit(100)
        .get();
      coachMemberships = membershipResult.data || [];
    }

    const coachProfilesMap = await repository.getCoachProfilesMap(
      Array.from(new Set(coachMemberships.map((item) => item.userId).filter(Boolean)))
    );
    const validCoachMemberships = coachMemberships.filter((membership) => {
      const profile = coachProfilesMap.get(membership.userId);
      return Boolean(
        profile &&
          profile.reviewStatus === 'approved' &&
          hasRealNameProfile(profile)
      );
    });

    return {
      groups: groups.map((group) => ({
        id: group._id,
        groupId: group.groupId || group._id,
        name: group.name,
        seasonLabel: group.seasonLabel || '未标注',
        enabled: group.enabled === true,
        coachUserIds: validCoachMemberships
          .filter((membership) => membership.groupId === group._id)
          .map((membership) => membership.userId)
      }))
    };
  }

  async function createTrainingGroup({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const name = validateGroupName(payload.name);
    const seasonLabel = validateGroupSeasonLabel(payload.seasonLabel);
    const groupId = deterministicId(
      'group',
      name.toLowerCase(),
      seasonLabel.toLowerCase()
    );
    const anyExistingGroup = repository.getTrainingGroupIncludingDeleted
      ? await repository.getTrainingGroupIncludingDeleted(groupId)
      : await repository.getTrainingGroup(groupId);

    if (anyExistingGroup && (anyExistingGroup.status === 'deleted' || anyExistingGroup.deletedAt)) {
      fail('TRAINING_GROUP_DELETED_NAME_REUSED', '同名同周期训练组已删除，不能通过创建接口恢复。');
    }
    const existingGroup = anyExistingGroup;
    if (existingGroup) {
      return {
        group: {
          id: existingGroup._id,
          groupId: existingGroup.groupId || existingGroup._id,
          name: existingGroup.name,
          seasonLabel: existingGroup.seasonLabel || '未标注',
          enabled: existingGroup.enabled === true,
          coachUserIds: []
        }
      };
    }

    await repository.groupCollection.doc(groupId).set({
      data: {
        groupId,
        name,
        seasonLabel,
        enabled: true,
        createdBy: actor._id,
        createdAt: repository.db.serverDate(),
        updatedAt: repository.db.serverDate(),
        schemaVersion: 1
      }
    });
    await repository.writeAudit({
      actorUserId: actor._id,
      action: AUDIT_ACTIONS.GROUP_CREATED,
      targetType: 'training_group',
      targetId: groupId,
      result: 'success',
      metadata: { name, seasonLabel, groupId }
    });

    return {
      group: {
        id: groupId,
        groupId,
        name,
        seasonLabel,
        enabled: true,
        coachUserIds: []
      }
    };
  }


  async function getTrainingGroupDeletionImpact({ identity, payload }) {
    await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const trainingGroupId = safeId(payload && payload.trainingGroupId, '训练组');
    const group = await repository.getTrainingGroupIncludingDeleted(trainingGroupId);
    if (!group) {
      fail('TRAINING_GROUP_NOT_FOUND', '训练组不存在。');
    }
    return { impact: await buildTrainingGroupDeletionImpact(group) };
  }

  // Transaction operation budget for deleteTrainingGroup:
  // 1 group read + up to 12 blocking-collection limit(1) reads + 1 group update + 1 audit set
  // = at most 15 operations (<= 20, well below CloudBase's 100-operation transaction limit).
  async function assertNoBlockingAssociationsInTransaction(transaction, groupId) {
    const containsGroupId = repository.db.command.in([groupId]);
    const blockingQueries = [
      { collectionName: COLLECTIONS.GROUP_MEMBERSHIPS, where: { groupId } },
      {
        collectionName: COLLECTIONS.STUDENT_PROFILES,
        where: { requestedTrainingGroupId: groupId }
      },
      {
        collectionName: COLLECTIONS.REGISTRATION_REVIEWS,
        where: { requestedTrainingGroupId: groupId }
      },
      { collectionName: COLLECTIONS.PERFORMANCE_RECORDS, where: { trainingGroupId: groupId } },
      { collectionName: COLLECTIONS.TRAINING_PLANS, where: { trainingGroupId: groupId } },
      { collectionName: COLLECTIONS.ATTENDANCE_SESSIONS, where: { trainingGroupId: groupId } },
      { collectionName: COLLECTIONS.ATTENDANCE_RECORDS, where: { trainingGroupId: groupId } },
      { collectionName: COLLECTIONS.LEAVE_REQUESTS, where: { trainingGroupId: groupId } },
      { collectionName: COLLECTIONS.COMPETITIONS, where: { trainingGroupIds: containsGroupId } },
      {
        collectionName: COLLECTIONS.COMPETITION_REGISTRATIONS,
        where: { trainingGroupIds: containsGroupId }
      },
      { collectionName: COLLECTIONS.CLUB_NOTICES, where: { trainingGroupIds: containsGroupId } },
      { collectionName: COLLECTIONS.TRAINING_FEEDBACK, where: { trainingGroupId: groupId } }
    ];

    for (const check of blockingQueries) {
      const result = await transaction
        .collection(check.collectionName)
        .where(check.where)
        .limit(1)
        .get();
      if ((result.data || []).length > 0) {
        fail(
          'TRAINING_GROUP_HAS_ASSOCIATIONS',
          '训练组仍有关联成员或历史业务数据，不能删除。'
        );
      }
    }
  }

  async function deleteTrainingGroup({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const input = validateTrainingGroupDeletionPayload(payload);
    const group = await repository.getTrainingGroupIncludingDeleted(input.trainingGroupId);
    if (!group) {
      fail('TRAINING_GROUP_NOT_FOUND', '训练组不存在。');
    }
    if (group.status === 'deleted' || group.deletedAt) {
      return {
        trainingGroupId: group._id,
        alreadyDeleted: true,
        name: group.name || ''
      };
    }
    const impact = await buildTrainingGroupDeletionImpact(group);
    if (impact.blockingAssociationCount > 0) {
      fail(
        'TRAINING_GROUP_HAS_ASSOCIATIONS',
        '训练组仍有关联成员或历史业务数据，不能删除。'
      );
    }
    const now = new Date();
    return repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.TRAINING_GROUPS)
        .doc(group._id);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('TRAINING_GROUP_NOT_FOUND', '训练组不存在。');
      }
      if (current.status === 'deleted' || current.deletedAt) {
        return {
          trainingGroupId: current._id,
          alreadyDeleted: true,
          name: current.name || ''
        };
      }
      await assertNoBlockingAssociationsInTransaction(transaction, current._id);
      await reference.update({
        data: {
          status: 'deleted',
          enabled: false,
          deletionMode: 'logical_archive',
          deletedBy: actor._id,
          deletedAt: now,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_group_delete', current._id, actor._id))
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.GROUP_DELETED,
            targetType: 'training_group',
            targetId: current._id,
            result: 'success',
            metadata: {
              deletionMode: 'logical_archive',
              blockingAssociationCount: impact.blockingAssociationCount,
              associationCounts: impact.associationCounts
            },
            createdAt: now
          }
        });
      return {
        trainingGroupId: current._id,
        name: current.name || '',
        status: 'deleted',
        alreadyDeleted: false
      };
    });
  }

  async function setTrainingGroupEnabled({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const input = validateTrainingGroupStatusPayload(payload);
    const group = await repository.getTrainingGroup(input.trainingGroupId);
    if (!group) {
      fail('TRAINING_GROUP_NOT_FOUND', '训练组不存在。');
    }

    const groupResult = {
      id: group._id,
      groupId: group.groupId || group._id,
      name: group.name,
      seasonLabel: group.seasonLabel || '未标注',
      enabled: input.enabled
    };
    if (group.enabled === input.enabled) {
      return { group: groupResult };
    }

    await repository.groupCollection.doc(group._id).update({
      data: {
        enabled: input.enabled,
        updatedAt: repository.db.serverDate()
      }
    });
    await repository.writeAudit({
      actorUserId: actor._id,
      action: AUDIT_ACTIONS.GROUP_STATUS_CHANGED,
      targetType: 'training_group',
      targetId: group._id,
      result: 'success',
      metadata: { enabled: input.enabled }
    });

    return { group: groupResult };
  }
  async function setGroupCoach({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const input = validateGroupCoachPayload(payload);
    const coach = await repository.getUserById(input.coachUserId);
    const group = await repository.getTrainingGroup(input.trainingGroupId);

    if (!coach || coach.status !== USER_STATUS.ACTIVE || !coach.roles.includes(ROLES.COACH)) {
      fail('INVALID_COACH', '目标用户不是有效教练员。');
    }
    const coachProfile = await repository.getCoachProfile(coach._id);
    if (
      !coachProfile ||
      coachProfile.reviewStatus !== 'approved' ||
      !hasRealNameProfile(coachProfile)
    ) {
      fail('INVALID_COACH', '目标教练尚未完成有效实名审核。');
    }
    if (!group) {
      fail('TRAINING_GROUP_NOT_FOUND', '训练组不存在。');
    }

    await repository.setGroupMembership({
      userId: coach._id,
      groupId: group._id,
      roleInGroup: ROLES.COACH,
      assignedBy: actor._id,
      active: input.active
    });
    await repository.writeAudit({
      actorUserId: actor._id,
      action: AUDIT_ACTIONS.GROUP_COACH_ASSIGNED,
      targetType: 'training_group',
      targetId: group._id,
      result: 'success',
      metadata: { coachUserId: coach._id, active: input.active }
    });

    return {
      groupId: group._id,
      coachUserId: coach._id,
      active: input.active
    };
  }

  return {
    'admin.create_training_group': createTrainingGroup,
    'admin.get_training_group_deletion_impact': getTrainingGroupDeletionImpact,
    'admin.delete_training_group': deleteTrainingGroup,
    'admin.list_training_groups': listTrainingGroups,
    'admin.set_training_group_enabled': setTrainingGroupEnabled,
    'admin.set_group_coach': setGroupCoach
  };
}

module.exports = createGroupAdminActions;
