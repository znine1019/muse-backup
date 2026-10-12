'use strict';

const {
  AUDIT_ACTIONS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const { loadActiveActor } = require('../lib/session');
const {
  validateGroupCoachPayload,
  validateGroupName,
  validateTrainingGroupStatusPayload,
  validateGroupSeasonLabel
} = require('../lib/validation');

function createGroupAdminActions({ repository }) {
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

    return {
      groups: groups.map((group) => ({
        id: group._id,
        groupId: group.groupId || group._id,
        name: group.name,
        seasonLabel: group.seasonLabel || '未标注',
        enabled: group.enabled === true,
        coachUserIds: coachMemberships
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
    const existingGroup = await repository.getTrainingGroup(groupId);

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
    'admin.list_training_groups': listTrainingGroups,
    'admin.set_training_group_enabled': setTrainingGroupEnabled,
    'admin.set_group_coach': setGroupCoach
  };
}

module.exports = createGroupAdminActions;
