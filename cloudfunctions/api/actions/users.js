'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  PARENT_LINK_KIND,
  PARENT_LINK_STATUS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const { loadActiveActor } = require('../lib/session');
const {
  nextParentAuthorizationVersion,
  parentAuthorizationVersion
} = require('../lib/policy');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  validateRolePayload,
  validateUserStatusPayload
} = require('../lib/validation');

const MAX_PARENT_LINKS_PER_REVOCATION = 50;
const REVOCABLE_PARENT_LINK_STATUSES = Object.freeze([
  PARENT_LINK_STATUS.ACTIVE,
  PARENT_LINK_STATUS.PENDING_STUDENT,
  PARENT_LINK_STATUS.PENDING_REVIEW
]);

function createUserAdminActions({ repository }) {
  async function revokeParentRole({ actor, targetUser }) {
    const links = await repository.queryAll(
      repository.parentLinkCollection,
      {
        kind: PARENT_LINK_KIND.RELATION,
        parentUserId: targetUser._id,
        status: repository.db.command.in(REVOCABLE_PARENT_LINK_STATUSES)
      },
      MAX_PARENT_LINKS_PER_REVOCATION + 1
    );
    if (links.length > MAX_PARENT_LINKS_PER_REVOCATION) {
      fail(
        'PARENT_LINK_REVOKE_LIMIT',
        '待失效的亲子关联过多，请分批处理后重试。'
      );
    }

    const currentRoles = Array.isArray(targetUser.roles) ? targetUser.roles : [];
    if (!currentRoles.includes(ROLES.PARENT) && !links.length) {
      return {
        userId: targetUser._id,
        status: targetUser.status,
        roles: currentRoles,
        revokedLinkCount: 0
      };
    }

    return repository.db.runTransaction(async (transaction) => {
      const userReference = transaction
        .collection(COLLECTIONS.USERS)
        .doc(targetUser._id);
      const currentUser = await getDocumentOrNull(userReference);
      if (!currentUser) {
        fail('USER_NOT_FOUND', '未找到目标用户。');
      }

      const currentUserRoles = Array.isArray(currentUser.roles)
        ? currentUser.roles
        : [];
      const nextRoles = currentUserRoles.filter((role) => role !== ROLES.PARENT);
      let nextStatus = currentUser.status;
      if (currentUser.status !== USER_STATUS.DISABLED && !nextRoles.length) {
        nextStatus = USER_STATUS.PENDING_PROFILE;
      }
      const nextVersion = nextParentAuthorizationVersion(currentUser);
      const timestamp = repository.db.serverDate();

      await userReference.update({
        data: {
          status: nextStatus,
          roles: nextRoles,
          parentAuthorizationVersion: nextVersion,
          updatedAt: timestamp
        }
      });

      await transaction
        .collection(COLLECTIONS.ROLE_BINDINGS)
        .doc(repository.roleBindingId(currentUser._id, ROLES.PARENT))
        .set({
          data: {
            userId: currentUser._id,
            role: ROLES.PARENT,
            status: 'revoked',
            grantedBy: actor._id,
            revokedAt: timestamp,
            updatedAt: timestamp
          }
        });

      let revokedLinkCount = 0;
      for (const link of links) {
        const reference = transaction
          .collection(COLLECTIONS.PARENT_LINKS)
          .doc(link._id);
        const currentLink = await getDocumentOrNull(reference);
        if (
          !currentLink ||
          !REVOCABLE_PARENT_LINK_STATUSES.includes(currentLink.status)
        ) {
          continue;
        }
        await reference.update({
          data: {
            status: PARENT_LINK_STATUS.REVOKED,
            revokedBy: actor._id,
            revokedAt: timestamp,
            revokeReason: 'parent_role_revoked',
            revokedByRoleChange: true,
            authorizationVersionAtRevocation: parentAuthorizationVersion(currentLink),
            updatedAt: timestamp
          }
        });
        await transaction
          .collection(COLLECTIONS.AUDIT_LOGS)
          .doc(
            deterministicId(
              'audit_parent_link_role_revoke',
              currentLink._id,
              actor._id,
              String(nextVersion)
            )
          )
          .set({
            data: {
              actorUserId: actor._id,
              action: AUDIT_ACTIONS.PARENT_LINK_REVOKED,
              targetType: 'parent_link',
              targetId: currentLink._id,
              result: 'success',
              metadata: {
                reason: 'parent_role_revoked',
                parentUserId: currentUser._id
              },
              createdAt: timestamp
            }
          });
        revokedLinkCount += 1;
      }

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(
          deterministicId(
            'audit_role_parent_revoke',
            currentUser._id,
            actor._id,
            String(nextVersion)
          )
        )
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.ROLE_REVOKED,
            targetType: 'user',
            targetId: currentUser._id,
            result: 'success',
            metadata: {
              role: ROLES.PARENT,
              revokedLinkCount,
              parentAuthorizationVersion: nextVersion
            },
            createdAt: timestamp
          }
        });

      return {
        userId: currentUser._id,
        status: nextStatus,
        roles: nextRoles,
        revokedLinkCount,
        parentAuthorizationVersion: nextVersion
      };
    });
  }

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
    if (roleInput.role === ROLES.PARENT && roleInput.grant) {
      fail(
        'PARENT_ROLE_APPROVAL_REQUIRED',
        '家长角色只能通过家长注册审核授予。'
      );
    }
    const targetUser = await repository.getUserById(roleInput.targetUserId);
    if (!targetUser) {
      fail('USER_NOT_FOUND', '未找到目标用户。');
    }

    if (roleInput.role === ROLES.PARENT) {
      return revokeParentRole({ actor, targetUser });
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
