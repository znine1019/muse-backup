'use strict';

const {
  AUDIT_ACTIONS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { loadActiveActor } = require('../lib/session');
const {
  validateRolePayload,
  validateUserStatusPayload
} = require('../lib/validation');

function createUserAdminActions({ repository }) {
  async function hasAnotherActiveDeveloper(targetUserId) {
    const result = await repository.userCollection
      .where({ roles: ROLES.DEVELOPER })
      .limit(100)
      .get();
    return (result.data || []).some(
      (user) => user._id !== targetUserId && user.status === USER_STATUS.ACTIVE
    );
  }

  async function listUsers({ identity }) {
    await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const allUsers = await repository.queryAll(repository.userCollection, null, 300);
    const users = allUsers.sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      return rightTime - leftTime;
    });
    const profileMap = await repository.getProfilesMap(users.map((user) => user._id));

    return {
      users: users.map((user) => ({
        userId: user._id,
        status: user.status,
        roles: Array.isArray(user.roles) ? user.roles : [],
        displayName: (profileMap.get(user._id) || {}).name || '未填写姓名',
        createdAt: user.createdAt || null
      }))
    };
  }

  async function assignRole({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const roleInput = validateRolePayload(payload);
    const targetUser = await repository.getUserById(roleInput.targetUserId);
    if (!targetUser) {
      fail('USER_NOT_FOUND', '未找到目标用户。');
    }

    if (!roleInput.grant && roleInput.role === ROLES.DEVELOPER) {
      if (!(await hasAnotherActiveDeveloper(targetUser._id))) {
        fail('LAST_DEVELOPER', '不能撤销系统中最后一个有效开发者。');
      }
    }

    const currentRoles = Array.isArray(targetUser.roles) ? targetUser.roles : [];
    const nextRoles = roleInput.grant
      ? Array.from(new Set([...currentRoles, roleInput.role]))
      : currentRoles.filter((role) => role !== roleInput.role);
    let nextStatus = targetUser.status;

    if (targetUser.status !== USER_STATUS.DISABLED) {
      if (roleInput.grant) {
        nextStatus = USER_STATUS.ACTIVE;
      } else if (!nextRoles.length) {
        nextStatus = USER_STATUS.PENDING_PROFILE;
      }
    }

    await repository.userCollection.doc(targetUser._id).update({
      data: {
        status: nextStatus,
        roles: nextRoles,
        updatedAt: repository.db.serverDate()
      }
    });
    await repository.setRoleBinding({
      userId: targetUser._id,
      role: roleInput.role,
      grantedBy: actor._id,
      active: roleInput.grant
    });
    await repository.writeAudit({
      actorUserId: actor._id,
      action: roleInput.grant ? AUDIT_ACTIONS.ROLE_GRANTED : AUDIT_ACTIONS.ROLE_REVOKED,
      targetType: 'user',
      targetId: targetUser._id,
      result: 'success',
      metadata: { role: roleInput.role }
    });

    return {
      userId: targetUser._id,
      status: nextStatus,
      roles: nextRoles
    };
  }

  async function setUserStatus({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const input = validateUserStatusPayload(payload);
    const targetUser = await repository.getUserById(input.targetUserId);
    if (!targetUser) {
      fail('USER_NOT_FOUND', '未找到目标用户。');
    }
    if (
      input.status === USER_STATUS.DISABLED &&
      (targetUser.roles || []).includes(ROLES.DEVELOPER) &&
      !(await hasAnotherActiveDeveloper(targetUser._id))
    ) {
      fail('LAST_DEVELOPER', '不能停用系统中最后一个有效开发者。');
    }
    if (input.status === USER_STATUS.ACTIVE && !(targetUser.roles || []).length) {
      fail('USER_HAS_NO_ROLE', '请先为用户授予至少一个角色，再启用账号。');
    }

    await repository.userCollection.doc(targetUser._id).update({
      data: {
        status: input.status,
        updatedAt: repository.db.serverDate()
      }
    });
    await repository.writeAudit({
      actorUserId: actor._id,
      action:
        input.status === USER_STATUS.ACTIVE
          ? AUDIT_ACTIONS.USER_ENABLED
          : AUDIT_ACTIONS.USER_DISABLED,
      targetType: 'user',
      targetId: targetUser._id,
      result: 'success',
      metadata: { status: input.status }
    });

    return {
      userId: targetUser._id,
      status: input.status,
      roles: targetUser.roles || []
    };
  }

  return {
    'admin.assign_role': assignRole,
    'admin.list_users': listUsers,
    'admin.set_user_status': setUserStatus
  };
}

module.exports = createUserAdminActions;
