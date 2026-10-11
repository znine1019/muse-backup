'use strict';

const {
  AUDIT_ACTIONS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { loadActiveActor } = require('../lib/session');
const {
  validateGroupCoachPayload,
  validateGroupName
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
        name: group.name,
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
    const existingResult = await repository.groupCollection
      .where({ name, enabled: true })
      .limit(1)
      .get();

    if ((existingResult.data || []).length) {
      return {
        group: {
          id: existingResult.data[0]._id,
          name: existingResult.data[0].name,
          enabled: true,
          coachUserIds: []
        }
      };
    }

    const addResult = await repository.groupCollection.add({
      data: {
        name,
        enabled: true,
        createdBy: actor._id,
        createdAt: repository.db.serverDate(),
        updatedAt: repository.db.serverDate()
      }
    });
    await repository.writeAudit({
      actorUserId: actor._id,
      action: AUDIT_ACTIONS.GROUP_CREATED,
      targetType: 'training_group',
      targetId: addResult._id,
      result: 'success',
      metadata: { name }
    });

    return {
      group: {
        id: addResult._id,
        name,
        enabled: true,
        coachUserIds: []
      }
    };
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
    'admin.set_group_coach': setGroupCoach
  };
}

module.exports = createGroupAdminActions;
