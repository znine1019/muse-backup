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
  const measurementCollection = db.collection(COLLECTIONS.BODY_MEASUREMENTS);
  const performanceCollection = db.collection(COLLECTIONS.PERFORMANCE_RECORDS);
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

  function measurementIdForUser(userId, measuredAt, heightCm, weightKg) {
    return deterministicId(
      'measure',
      userId,
      measuredAt,
      String(heightCm),
      String(weightKg)
    );
  }

  function performanceIdForSubmission(
    studentUserId,
    eventCode,
    achievedAt,
    value
  ) {
    return deterministicId(
      'perf',
      studentUserId,
      eventCode,
      achievedAt,
      String(value)
    );
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


  async function getMeasurement(measurementId) {
    return getDoc(measurementCollection, measurementId);
  }

  async function countWhere(collection, where) {
    const result = await collection.where(where).count();
    return Number(result.total) || 0;
  }

  async function fetchAllOrdered(collection, where, orderBy, options = {}) {
    const batchSize = options.batchSize || 100;
    const maxRecords = options.maxRecords || 5000;
    const total = await countWhere(collection, where);
    if (!total) {
      return { records: [], total: 0, incomplete: false };
    }

    const records = [];
    const seen = new Set();
    let offset = 0;
    while (offset < total && records.length < maxRecords) {
      let query = collection.where(where);
      for (const order of orderBy) {
        query = query.orderBy(order.field, order.direction);
      }
      const limit = Math.min(
        batchSize,
        total - offset,
        maxRecords - records.length
      );
      const result = await query.skip(offset).limit(limit).get();
      const batch = result.data || [];
      if (!batch.length) {
        break;
      }
      for (const record of batch) {
        const key = record._id || `${offset}:${records.length}`;
        if (!seen.has(key)) {
          seen.add(key);
          records.push(record);
        }
      }
      offset += batch.length;
    }

    return {
      records,
      total,
      incomplete: records.length !== total
    };
  }

  async function listMeasurements(userId, maxRecords = 100) {
    const result = await measurementCollection
      .where({ userId })
      .limit(Math.min(maxRecords, 100))
      .get();
    return (result.data || []).sort(
      (left, right) =>
        new Date(right.measuredAt || 0).getTime() -
        new Date(left.measuredAt || 0).getTime()
    );
  }

  async function getPerformanceRecord(performanceId) {
    return getDoc(performanceCollection, performanceId);
  }

  async function listMeasurementsForReport(userId, options = {}) {
    return fetchAllOrdered(
      measurementCollection,
      { userId },
      [
        { field: 'measuredAt', direction: 'asc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 5000 }
    );
  }

  async function listPerformanceRecords(userId, maxRecords = 100) {
    const result = await performanceCollection
      .where({ studentUserId: userId })
      .limit(Math.min(maxRecords, 100))
      .get();
    return (result.data || []).sort(
      (left, right) =>
        new Date(right.achievedAt || 0).getTime() -
        new Date(left.achievedAt || 0).getTime()
    );
  }

  async function listPendingPerformanceRecords(maxRecords = 300) {
    const result = await fetchAllOrdered(
      performanceCollection,
      { status: 'pending' },
      [
        { field: 'createdAt', direction: 'asc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords }
    );
    return result.records;
  }

  async function listApprovedPerformanceRecords(userId, options = {}) {
    return fetchAllOrdered(
      performanceCollection,
      { studentUserId: userId, status: 'approved' },
      [
        { field: 'achievedAt', direction: 'asc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 5000 }
    );
  }
  async function getStudentUserIdsForGroups(groupIds) {
    if (!groupIds.length) {
      return [];
    }
    const userIds = new Set();
    for (let index = 0; index < groupIds.length; index += 100) {
      const chunk = groupIds.slice(index, index + 100);
      const result = await fetchAllOrdered(
        membershipCollection,
        {
          groupId: db.command.in(chunk),
          roleInGroup: ROLES.STUDENT,
          status: MEMBERSHIP_STATUS.ACTIVE
        },
        [
          { field: 'groupId', direction: 'asc' },
          { field: '_id', direction: 'asc' }
        ],
        { maxRecords: 5000 }
      );
      for (const item of result.records) {
        userIds.add(item.userId);
      }
    }
    return Array.from(userIds);
  }

  async function getStudentGroupNamesMap(userIds) {
    const resultMap = new Map();
    if (!userIds.length) {
      return resultMap;
    }

    const memberships = [];
    for (let index = 0; index < userIds.length; index += 100) {
      const chunk = userIds.slice(index, index + 100);
      const batch = await queryAll(
        membershipCollection,
        {
          userId: db.command.in(chunk),
          roleInGroup: ROLES.STUDENT,
          status: MEMBERSHIP_STATUS.ACTIVE
        },
        Math.max(chunk.length * 10, 100)
      );
      memberships.push(...batch);
    }

    const groupIds = Array.from(
      new Set(memberships.map((item) => item.groupId))
    );
    const groupsMap = await getGroupsMap(groupIds);
    for (const membership of memberships) {
      const group = groupsMap.get(membership.groupId);
      if (!group) {
        continue;
      }
      const names = resultMap.get(membership.userId) || [];
      names.push(`${group.name}（${group.seasonLabel || '未标注'}）`);
      resultMap.set(membership.userId, names);
    }
    return resultMap;
  }

  async function countPendingPerformanceRecords(studentUserIds) {
    if (!studentUserIds) {
      return countWhere(performanceCollection, { status: 'pending' });
    }
    if (!studentUserIds.length) {
      return 0;
    }
    let total = 0;
    for (let index = 0; index < studentUserIds.length; index += 100) {
      const chunk = studentUserIds.slice(index, index + 100);
      total += await countWhere(performanceCollection, {
        status: 'pending',
        studentUserId: db.command.in(chunk)
      });
    }
    return total;
  }

  async function listAllProfiles(maxRecords = 300) {
    return queryAll(profileCollection, null, maxRecords);
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
    bodyMeasurementCollection: measurementCollection,
    db,
    ensureUser,
    getMeasurement,
    getPerformanceRecord,
    getCoachGroupIds,
    getStudentUserIdsForGroups,
    getGroupsMap,
    getLatestReview,
    getProfile,
    getProfilesMap,
    getSystemConfig,
    getTrainingGroup,
    getUserById,
    groupCollection,
    listAllProfiles,
    listApprovedPerformanceRecords,
    listAllTrainingGroups,
    listEnabledTrainingGroups,
    listMeasurements,
    listMeasurementsForReport,
    listPendingPerformanceRecords,
    listPerformanceRecords,
    countPendingPerformanceRecords,
    membershipCollection,
    getStudentGroupNamesMap,
    membershipId,
    measurementIdForUser,
    performanceCollection,
    performanceIdForSubmission,
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
