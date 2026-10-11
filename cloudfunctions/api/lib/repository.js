'use strict';

const crypto = require('crypto');
const {
  COLLECTIONS,
  MEMBERSHIP_STATUS,
  ROLES,
  USER_STATUS
} = require('./constants');

function isNotFoundError(error) {
  const message = String((error && error.message) || '').toLowerCase();
  return (
    message.includes('not exist') ||
    message.includes('not found') ||
    message.includes('document not found')
  );
}

function deterministicId(prefix, ...values) {
  const digest = crypto
    .createHash('sha256')
    .update(values.join('|'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function compareTrainingGroups(left, right) {
  const seasonOrder = String(right.seasonLabel || '').localeCompare(
    String(left.seasonLabel || ''),
    'zh-CN'
  );
  if (seasonOrder) {
    return seasonOrder;
  }
  return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
}

function createRepository(db) {
  const userCollection = db.collection(COLLECTIONS.USERS);
  const profileCollection = db.collection(COLLECTIONS.STUDENT_PROFILES);
  const reviewCollection = db.collection(COLLECTIONS.REGISTRATION_REVIEWS);
  const roleCollection = db.collection(COLLECTIONS.ROLE_BINDINGS);
  const groupCollection = db.collection(COLLECTIONS.TRAINING_GROUPS);
  const membershipCollection = db.collection(COLLECTIONS.GROUP_MEMBERSHIPS);
  const auditCollection = db.collection(COLLECTIONS.AUDIT_LOGS);
  const systemCollection = db.collection(COLLECTIONS.SYSTEM_CONFIG);

  async function getDoc(collection, id) {
    try {
      const result = await collection.doc(id).get();
      return result.data || null;
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  function userIdForIdentity(identity) {
    return deterministicId('usr', identity.appid || 'unknown-app', identity.openid);
  }

  function profileIdForUser(userId) {
    return deterministicId('profile', userId);
  }

  function roleBindingId(userId, role) {
    return deterministicId('role', userId, role);
  }

  function membershipId(groupId, userId) {
    return deterministicId('member', groupId, userId);
  }

  async function getUserById(userId) {
    return getDoc(userCollection, userId);
  }

  async function getUserByOpenId(openid) {
    const result = await userCollection.where({ _openid: openid }).limit(1).get();
    return (result.data || [])[0] || null;
  }

  async function ensureUser(identity) {
    const userId = userIdForIdentity(identity);
    let user = await getUserById(userId);

    if (user) {
      return user;
    }

    user = await getUserByOpenId(identity.openid);
    if (user) {
      return user;
    }

    const userData = {
      _id: userId,
      _openid: identity.openid,
      unionid: identity.unionid || '',
      status: USER_STATUS.PENDING_PROFILE,
      roles: [],
      schemaVersion: 1,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };

    try {
      await userCollection.add({ data: userData });
    } catch (error) {
      user = await getUserById(userId);
      if (!user) {
        user = await getUserByOpenId(identity.openid);
      }
      if (!user) {
        throw error;
      }
      return user;
    }

    user = await getUserById(userId);
    if (!user) {
      throw new Error('USER_CREATE_READBACK_FAILED');
    }

    await writeAudit({
      actorUserId: userId,
      action: 'auth.login.created',
      targetType: 'user',
      targetId: userId,
      result: 'success',
      metadata: { status: USER_STATUS.PENDING_PROFILE }
    });

    return user;
  }

  async function getProfile(userId) {
    return getDoc(profileCollection, profileIdForUser(userId));
  }

  async function getLatestReview(userId) {
    const result = await reviewCollection.where({ userId }).limit(20).get();
    return (result.data || []).sort((left, right) => {
      const leftTime = new Date(left.createdAt || left.submittedAt || 0).getTime();
      const rightTime = new Date(right.createdAt || right.submittedAt || 0).getTime();
      return rightTime - leftTime;
    })[0] || null;
  }

  async function getTrainingGroup(groupId) {
    return getDoc(groupCollection, groupId);
  }

  async function getCoachGroupIds(userId) {
    const result = await membershipCollection
      .where({
        userId,
        roleInGroup: ROLES.COACH,
        status: MEMBERSHIP_STATUS.ACTIVE
      })
      .limit(100)
      .get();
    return (result.data || []).map((item) => item.groupId);
  }

  async function queryAll(collection, where, maxRecords = 300) {
    const batchSize = 100;
    const records = [];
    let offset = 0;

    while (records.length < maxRecords) {
      const query = where ? collection.where(where) : collection;
      const result = await query
        .skip(offset)
        .limit(Math.min(batchSize, maxRecords - records.length))
        .get();
      const batch = result.data || [];
      records.push(...batch);
      if (batch.length < batchSize) {
        break;
      }
      offset += batch.length;
    }

    return records;
  }

  async function listEnabledTrainingGroups() {
    const groups = await queryAll(groupCollection, { enabled: true }, 300);
    return groups.sort(compareTrainingGroups);
  }

  async function listAllTrainingGroups() {
    const groups = await queryAll(groupCollection, null, 300);
    return groups.sort(compareTrainingGroups);
  }

  async function getProfilesMap(userIds) {
    if (!userIds.length) {
      return new Map();
    }
    const profiles = [];
    for (let index = 0; index < userIds.length; index += 100) {
      const chunk = userIds.slice(index, index + 100);
      const batch = await queryAll(
        profileCollection,
        { userId: db.command.in(chunk) },
        chunk.length
      );
      profiles.push(...batch);
    }
    return new Map(profiles.map((profile) => [profile.userId, profile]));
  }

  async function getGroupsMap(groupIds) {
    if (!groupIds.length) {
      return new Map();
    }
    const groups = [];
    for (let index = 0; index < groupIds.length; index += 100) {
      const chunk = groupIds.slice(index, index + 100);
      const batch = await queryAll(
        groupCollection,
        { _id: db.command.in(chunk) },
        chunk.length
      );
      groups.push(...batch);
    }
    return new Map(groups.map((group) => [group._id, group]));
  }

  async function writeAudit(entry) {
    await auditCollection.add({
      data: {
        actorUserId: entry.actorUserId || '',
        action: entry.action,
        targetType: entry.targetType || '',
        targetId: entry.targetId || '',
        result: entry.result || 'success',
        metadata: entry.metadata || {},
        createdAt: db.serverDate()
      }
    });
  }

  async function setRoleBinding({ userId, role, grantedBy, active }) {
    const id = roleBindingId(userId, role);
    await roleCollection.doc(id).set({
      data: {
        userId,
        role,
        status: active ? 'active' : 'revoked',
        grantedBy,
        updatedAt: db.serverDate(),
        ...(active ? { grantedAt: db.serverDate() } : { revokedAt: db.serverDate() })
      }
    });
  }

  async function setGroupMembership({
    userId,
    groupId,
    roleInGroup,
    assignedBy,
    active
  }) {
    const id = membershipId(groupId, userId);
    await membershipCollection.doc(id).set({
      data: {
        userId,
        groupId,
        roleInGroup,
        status: active ? MEMBERSHIP_STATUS.ACTIVE : MEMBERSHIP_STATUS.INACTIVE,
        assignedBy,
        updatedAt: db.serverDate(),
        ...(active ? { assignedAt: db.serverDate() } : { removedAt: db.serverDate() })
      }
    });
  }

  async function setSystemConfig(id, data) {
    await systemCollection.doc(id).set({
      data: {
        ...data,
        updatedAt: db.serverDate()
      }
    });
  }

  async function getSystemConfig(id) {
    return getDoc(systemCollection, id);
  }

  return {
    auditCollection,
    db,
    ensureUser,
    getCoachGroupIds,
    getGroupsMap,
    getLatestReview,
    getProfile,
    getProfilesMap,
    getSystemConfig,
    getTrainingGroup,
    getUserById,
    groupCollection,
    listAllTrainingGroups,
    listEnabledTrainingGroups,
    membershipCollection,
    membershipId,
    profileCollection,
    profileIdForUser,
    reviewCollection,
    queryAll,
    roleBindingId,
    roleCollection,
    setGroupMembership,
    setRoleBinding,
    setSystemConfig,
    systemCollection,
    userCollection,
    userIdForIdentity,
    writeAudit
  };
}

module.exports = {
  createRepository,
  deterministicId
};
