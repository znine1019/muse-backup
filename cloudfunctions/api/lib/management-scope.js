'use strict';

const {
  COLLECTIONS,
  MEMBERSHIP_STATUS,
  ROLES,
  USER_STATUS
} = require('./constants');
const { fail } = require('./errors');
const { getDocumentOrNull } = require('./transaction');

function isDeveloperActor(actor) {
  return Boolean(actor && Array.isArray(actor.roles) && actor.roles.includes(ROLES.DEVELOPER));
}

function canFullyManageScope({ actor, resourceGroupIds, coachGroupIds }) {
  if (isDeveloperActor(actor)) {
    return true;
  }
  const resourceIds = Array.from(
    new Set((Array.isArray(resourceGroupIds) ? resourceGroupIds : []).filter(Boolean))
  );
  const coachIds = new Set(
    (Array.isArray(coachGroupIds) ? coachGroupIds : []).filter(Boolean)
  );
  return resourceIds.length > 0 && resourceIds.every((groupId) => coachIds.has(groupId));
}

async function loadActiveCoachGroupIdsInTransaction(transaction, userId) {
  const result = await transaction
    .collection(COLLECTIONS.GROUP_MEMBERSHIPS)
    .where({
      userId,
      roleInGroup: ROLES.COACH,
      status: MEMBERSHIP_STATUS.ACTIVE
    })
    .limit(100)
    .get();
  return Array.from(
    new Set((result.data || []).map((membership) => membership.groupId).filter(Boolean))
  );
}

async function assertCanFullyManageScopesInTransaction({
  transaction,
  actor,
  resourceGroupIdSets
}) {
  if (!actor || !actor._id || !Array.isArray(actor.roles)) {
    fail('FORBIDDEN', '当前账号没有执行此操作的权限。');
  }

  const actorReference = transaction
    .collection(COLLECTIONS.USERS)
    .doc(actor._id);
  const currentActor = await getDocumentOrNull(actorReference);
  if (!currentActor || currentActor.status !== USER_STATUS.ACTIVE) {
    fail('FORBIDDEN', '当前账号状态已变化，请重新登录。');
  }

  const effectiveRoles = actor.roles.filter((role) =>
    Array.isArray(currentActor.roles) && currentActor.roles.includes(role)
  );
  const effectiveActor = { ...currentActor, roles: effectiveRoles };

  if (isDeveloperActor(effectiveActor)) {
    return effectiveActor;
  }

  const coachGroupIds = await loadActiveCoachGroupIdsInTransaction(
    transaction,
    currentActor._id
  );
  const everyScopeManageable = (resourceGroupIdSets || []).every((groupIds) =>
    canFullyManageScope({
      actor: effectiveActor,
      resourceGroupIds: groupIds,
      coachGroupIds
    })
  );
  if (!everyScopeManageable) {
    fail('OUT_OF_SCOPE', '只能管理完整授权范围内的训练组资源。');
  }
  return effectiveActor;
}

module.exports = {
  assertCanFullyManageScopesInTransaction,
  canFullyManageScope,
  isDeveloperActor
};
