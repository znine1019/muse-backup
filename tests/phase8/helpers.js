'use strict';

/**
 * 阶段8（V1.6 家长域）本地隔离测试仓储。
 * 完全在内存中模拟 CloudBase，不连接生产数据库，不伪造 OpenID。
 */

const crypto = require('crypto');

function clone(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  }
  return value;
}

function matches(record, where) {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([field, expected]) => {
    if (expected && typeof expected === 'object' && expected.__in) {
      return Array.isArray(record[field])
        ? record[field].some((item) => expected.__in.includes(item))
        : expected.__in.includes(record[field]);
    }
    if (Array.isArray(record[field])) {
      return record[field].includes(expected);
    }
    return record[field] === expected;
  });
}

/* 应用写入数据：支持 CloudBase 原子自增指令 db.command.inc */
function applyData(existing, data) {
  const next = { ...existing };
  for (const [field, value] of Object.entries(data || {})) {
    if (value && typeof value === 'object' && typeof value.__inc === 'number') {
      next[field] = Number(existing[field] || 0) + value.__inc;
    } else {
      next[field] = clone(value);
    }
  }
  return next;
}

function createFakeRepository(seed = {}, options = {}) {
  const collections = new Map();
  function collection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  const usersByOpenId = new Map(Object.entries(seed.usersByOpenId || {}));
  const usersById = new Map();
  for (const user of usersByOpenId.values()) {
    usersById.set(user._id, user);
  }
  const counters = {
    reads: 0,
    writes: 0,
    transactions: 0,
    lastTransactionReads: 0,
    lastTransactionWrites: 0,
    lastTransactionOperations: 0,
    maxTransactionOperations: 0,
    transactionAttempts: 0,
    transactionConflicts: 0,
    transactionRetries: 0
  };

  /* 事务内对 users 集合的写入同步到外部映射，保证事务提交后读取与断言看到同一份数据 */
  function syncUsers(name, record) {
    if (name !== 'users' || !record || !record._id) {
      return;
    }
    const merged = { ...(usersById.get(record._id) || {}), ...record };
    usersById.set(record._id, merged);
    if (merged.openid) {
      usersByOpenId.set(merged.openid, merged);
    }
  }

  function cloneRecords(records) {
    return new Map(
      Array.from(records.entries()).map(([id, record]) => [id, clone(record)])
    );
  }

  const documentRevisions = new Map();
  const collectionRevisions = new Map();
  let revisionCounter = 0;

  function documentKey(name, id) {
    return `${name}\u0000${id}`;
  }

  function documentRevision(name, id) {
    return documentRevisions.get(documentKey(name, id)) || 0;
  }

  function collectionRevision(name) {
    return collectionRevisions.get(name) || 0;
  }

  function bumpRevisions(name, ids) {
    revisionCounter += 1;
    for (const id of ids) {
      documentRevisions.set(documentKey(name, id), revisionCounter);
    }
    if (ids.length) {
      collectionRevisions.set(name, revisionCounter);
    }
  }

  function snapshotState() {
    return {
      collections: new Map(
        Array.from(collections.entries()).map(([name, records]) => [
          name,
          cloneRecords(records)
        ])
      ),
      usersById: cloneRecords(usersById),
      usersByOpenId: cloneRecords(usersByOpenId),
      documentRevisions: new Map(documentRevisions),
      collectionRevisions: new Map(collectionRevisions)
    };
  }

  function restoreState(snapshot) {
    collections.clear();
    for (const [name, records] of snapshot.collections.entries()) {
      collections.set(name, cloneRecords(records));
    }
    usersById.clear();
    for (const [id, user] of snapshot.usersById.entries()) {
      usersById.set(id, clone(user));
    }
    usersByOpenId.clear();
    for (const [openid, user] of snapshot.usersByOpenId.entries()) {
      usersByOpenId.set(openid, clone(user));
    }
  }

  async function runOptimisticTransaction(handler) {
    counters.transactions += 1;
    const maxAttempts = Math.max(1, Number(options.transactionMaxAttempts) || 6);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      counters.transactionAttempts += 1;
      const snapshot = snapshotState();
      const readDocuments = new Set();
      const writeDocuments = new Set();
      const readCollections = new Set();
      let transactionReads = 0;
      let transactionWrites = 0;
      const countRead = () => {
        counters.reads += 1;
        transactionReads += 1;
      };
      const countWrite = () => {
        counters.writes += 1;
        transactionWrites += 1;
      };
      const shadowCollection = (name) => {
        if (!snapshot.collections.has(name)) {
          snapshot.collections.set(name, new Map());
        }
        return snapshot.collections.get(name);
      };
      const transaction = {
        collection(name) {
          const col = shadowCollection(name);
          return {
            doc(id) {
              const key = documentKey(name, id);
              return {
                async get() {
                  countRead();
                  readDocuments.add(key);
                  await Promise.resolve();
                  const record = col.get(id);
                  if (!record) {
                    throw new Error('document not found');
                  }
                  return { data: clone(record) };
                },
                async set({ data }) {
                  countWrite();
                  writeDocuments.add(key);
                  await Promise.resolve();
                  col.set(id, { _id: id, ...clone(data) });
                  return { ok: true };
                },
                async update({ data }) {
                  countWrite();
                  writeDocuments.add(key);
                  await Promise.resolve();
                  const existing = col.get(id);
                  if (!existing) {
                    throw new Error('document not found');
                  }
                  col.set(id, applyData(existing, data));
                  return { ok: true };
                }
              };
            },
            where(where) {
              let limit = 100;
              return {
                limit(value) {
                  limit = Number(value) || limit;
                  return this;
                },
                async get() {
                  countRead();
                  readCollections.add(name);
                  await Promise.resolve();
                  return {
                    data: Array.from(col.values())
                      .filter((record) => matches(record, where))
                      .slice(0, limit)
                      .map(clone)
                  };
                },
                async count() {
                  countRead();
                  readCollections.add(name);
                  await Promise.resolve();
                  return {
                    total: Array.from(col.values()).filter((record) =>
                      matches(record, where)
                    ).length
                  };
                }
              };
            }
          };
        }
      };
      try {
        if (typeof db.transactionBarrier === 'function') {
          await db.transactionBarrier({ attempt, transactionId: counters.transactions });
        }
        const result = await handler(transaction);
        counters.lastTransactionReads = transactionReads;
        counters.lastTransactionWrites = transactionWrites;
        counters.lastTransactionOperations = transactionReads + transactionWrites;
        counters.maxTransactionOperations = Math.max(
          counters.maxTransactionOperations,
          counters.lastTransactionOperations
        );
        const conflict =
          Array.from(new Set([...readDocuments, ...writeDocuments])).some((key) => {
            const separator = key.indexOf('\u0000');
            return (
              documentRevision(key.slice(0, separator), key.slice(separator + 1)) !==
              (snapshot.documentRevisions.get(key) || 0)
            );
          }) ||
          Array.from(readCollections).some(
            (name) =>
              collectionRevision(name) !==
              (snapshot.collectionRevisions.get(name) || 0)
          );
        if (conflict) {
          counters.transactionConflicts += 1;
          if (attempt < maxAttempts) {
            counters.transactionRetries += 1;
            continue;
          }
          const error = new Error('transaction conflict retry limit reached');
          error.code = 'TRANSACTION_CONFLICT';
          throw error;
        }
        const writesByCollection = new Map();
        for (const key of writeDocuments) {
          const separator = key.indexOf('\u0000');
          const name = key.slice(0, separator);
          const id = key.slice(separator + 1);
          const ids = writesByCollection.get(name) || [];
          ids.push(id);
          writesByCollection.set(name, ids);
        }
        for (const [name, ids] of writesByCollection.entries()) {
          const targetCollection = collection(name);
          const sourceCollection = shadowCollection(name);
          for (const id of ids) {
            const record = clone(sourceCollection.get(id));
            targetCollection.set(id, record);
            syncUsers(name, record);
          }
          bumpRevisions(name, ids);
        }
        return result;
      } catch (error) {
        counters.lastTransactionReads = transactionReads;
        counters.lastTransactionWrites = transactionWrites;
        counters.lastTransactionOperations = transactionReads + transactionWrites;
        counters.maxTransactionOperations = Math.max(
          counters.maxTransactionOperations,
          counters.lastTransactionOperations
        );
        throw error;
      }
    }
    throw new Error('unreachable transaction state');
  }

  const db = {
    serverDate: () => new Date(),
    transactionBarrier: null,
    command: {
      in: (values) => ({ __in: values }),
      inc: (value) => ({ __inc: value })
    },
    async runTransaction(handler) {
      if (options.optimisticTransactions === true) {
        return runOptimisticTransaction(handler);
      }
      counters.transactions += 1;
      const snapshot = snapshotState();
      let transactionReads = 0;
      let transactionWrites = 0;
      const countRead = () => {
        counters.reads += 1;
        transactionReads += 1;
      };
      const countWrite = () => {
        counters.writes += 1;
        transactionWrites += 1;
      };
      const transaction = {
        collection(name) {
          const col = collection(name);
          return {
            doc(id) {
              return {
                async get() {
                  countRead();
                  const record = col.get(id);
                  if (!record) {
                    throw new Error('document not found');
                  }
                  return { data: clone(record) };
                },
                async set({ data }) {
                  countWrite();
                  const record = { _id: id, ...clone(data) };
                  col.set(id, record);
                  syncUsers(name, record);
                  return { ok: true };
                },
                async update({ data }) {
                  countWrite();
                  const existing = col.get(id);
                  if (!existing) {
                    throw new Error('document not found');
                  }
                  const record = applyData(existing, data);
                  col.set(id, record);
                  syncUsers(name, record);
                  return { ok: true };
                }
              };
            }
            ,
            where(where) {
              let limit = 100;
              return {
                limit(value) {
                  limit = Number(value) || limit;
                  return this;
                },
                async get() {
                  countRead();
                  return {
                    data: Array.from(col.values())
                      .filter((record) => matches(record, where))
                      .slice(0, limit)
                      .map(clone)
                  };
                },
                async count() {
                  countRead();
                  return {
                    total: Array.from(col.values()).filter((record) =>
                      matches(record, where)
                    ).length
                  };
                }
              };
            }
          };
        }
      };
      try {
        const result = await handler(transaction);
        counters.lastTransactionReads = transactionReads;
        counters.lastTransactionWrites = transactionWrites;
        counters.lastTransactionOperations = transactionReads + transactionWrites;
        counters.maxTransactionOperations = Math.max(
          counters.maxTransactionOperations,
          counters.lastTransactionOperations
        );
        return result;
      } catch (error) {
        restoreState(snapshot);
        counters.lastTransactionReads = transactionReads;
        counters.lastTransactionWrites = transactionWrites;
        counters.lastTransactionOperations = transactionReads + transactionWrites;
        counters.maxTransactionOperations = Math.max(
          counters.maxTransactionOperations,
          counters.lastTransactionOperations
        );
        throw error;
      }
    }
  };

  const repository = {
    parentLinkCollection: { __name: 'parent_links' },
    auditCollection: { __name: 'audit_logs' },
    bodyMeasurementCollection: { __name: 'body_measurements' },
    clubNoticeCollection: { __name: 'club_notices' },
    competitionCollection: { __name: 'competitions' },
    competitionRegistrationCollection: { __name: 'competition_registrations' },
    groupCollection: { __name: 'training_groups' },
    membershipCollection: { __name: 'group_memberships' },
    reviewCollection: { __name: 'registration_reviews' },
    roleCollection: { __name: 'role_bindings' },
    noticeReadCollection: { __name: 'notice_reads' },
    performanceCollection: { __name: 'performance_records' },
    trainingFeedbackCollection: { __name: 'training_feedback' },
    trainingPlanCollection: { __name: 'training_plans' },
    attendanceSessionCollection: { __name: 'attendance_sessions' },
    attendanceRecordCollection: { __name: 'attendance_records' },
    leaveRequestCollection: { __name: 'leave_requests' },
    db,
    counters,
    usersById,
    usersByOpenId,
    snapshot: snapshotState,
    restore: restoreState,

    userIdForIdentity: (identity) =>
      `usr_${crypto
        .createHash('sha256')
        .update(`${identity.appid || 'unknown-app'}|${identity.openid}`)
        .digest('hex')
        .slice(0, 32)}`,
    async getUserByIdentity(identity) {
      return (
        usersById.get(repository.userIdForIdentity(identity)) ||
        usersByOpenId.get(identity.openid) ||
        null
      );
    },
    hasRealNameProfile(profile) {
      return Boolean(
        profile &&
          typeof profile.name === 'string' &&
          profile.name.trim().length > 0
      );
    },

    async ensureUser(identity) {
      const existing = usersByOpenId.get(identity.openid);
      if (existing) {
        return existing;
      }
      const created = {
        _id: `usr_${identity.openid}`,
        openid: identity.openid,
        status: 'pending_profile',
        roles: []
      };
      usersByOpenId.set(identity.openid, created);
      usersById.set(created._id, created);
      /* 事务内的 doc(id).get() 读取的是 users 集合，新建账号需同步写入 */
      collection('users').set(created._id, created);
      return created;
    },
    async getUserById(userId) {
      return usersById.get(userId) || null;
    },
    userCollection: {
      __name: 'users',
      where(where) {
        return {
          limit(limit) {
            return {
              async get() {
                const records = Array.from(usersById.values())
                  .filter((record) => matches(record, where))
                  .slice(0, limit)
                  .map(clone);
                return { data: records };
              }
            };
          }
        };
      },
      doc(id) {
        return {
          async get() {
            const record = collection('users').get(id);
            if (!record) {
              throw new Error('document not found');
            }
            return { data: clone(record) };
          },
          async update({ data }) {
            const existing = collection('users').get(id);
            if (!existing) {
              throw new Error('document not found');
            }
            const record = applyData(existing, data);
            collection('users').set(id, record);
            syncUsers('users', record);
            return { ok: true };
          }
        };
      }
    },
    async writeAudit(entry) {
      const id = `audit_${collection('audit_logs').size + 1}`;
      collection('audit_logs').set(id, {
        _id: id,
        ...clone(entry),
        createdAt: new Date()
      });
    },
    async setRoleBinding({ userId, role, grantedBy, active }) {
      const id = repository.roleBindingId(userId, role);
      collection('role_bindings').set(id, {
        _id: id,
        userId,
        role,
        status: active ? 'active' : 'revoked',
        grantedBy,
        ...(active ? { grantedAt: new Date() } : { revokedAt: new Date() }),
        updatedAt: new Date()
      });
    },
    async getUsersMap(userIds) {
      const map = new Map();
      for (const id of userIds) {
        const user = usersById.get(id);
        if (user) {
          map.set(id, user);
        }
      }
      return map;
    },
    async getProfilesMap(userIds) {
      const map = new Map();
      for (const id of userIds) {
        const profile = collection('student_profiles').get(`profile_${id}`);
        if (profile) {
          map.set(id, profile);
        }
      }
      return map;
    },
    async getParentProfilesMap(userIds) {
      const map = new Map();
      for (const id of userIds) {
        const profile = collection('parent_profiles').get(`parent_profile_${id}`);
        if (profile) {
          map.set(id, profile);
        }
      }
      return map;
    },
    async getCoachProfilesMap(userIds) {
      const map = new Map();
      for (const id of userIds) {
        const profile = collection('coach_profiles').get(`coach_profile_${id}`);
        if (profile) {
          map.set(id, profile);
        }
      }
      return map;
    },
    async getStudentGroupIds() {
      return seed.studentGroupIds || [];
    },
    async getGroupsMap(groupIds) {
      const map = new Map();
      for (const groupId of groupIds) {
        const group = (seed.groups || []).find((item) => item._id === groupId);
        if (group) {
          map.set(groupId, group);
        }
      }
      return map;
    },
    async getTrainingGroup(groupId) {
      const group = collection('training_groups').get(groupId) ||
        (seed.groups || []).find((item) => item._id === groupId);
      return group && !group.deletedAt && group.status !== 'deleted' ? clone(group) : null;
    },
    async getTrainingGroupIncludingDeleted(groupId) {
      return clone(
        collection('training_groups').get(groupId) ||
          (seed.groups || []).find((item) => item._id === groupId) ||
          null
      );
    },
    async listAllTrainingGroups() {
      return Array.from(collection('training_groups').values())
        .concat(seed.groups || [])
        .filter((group) => !group.deletedAt && group.status !== 'deleted')
        .map(clone);
    },
    async listEnabledTrainingGroups() {
      return Array.from(collection('training_groups').values())
        .concat(seed.groups || [])
        .filter(
          (group) =>
            group.enabled === true && !group.deletedAt && group.status !== 'deleted'
        )
        .map(clone);
    },
    parentProfileIdForUser: (userId) => `parent_profile_${userId}`,
    coachProfileIdForUser: (userId) => `coach_profile_${userId}`,
    profileIdForUser: (userId) => `profile_${userId}`,
    roleBindingId: (userId, role) => `role_${userId}_${role}`,
    membershipId: (groupId, userId) => `member_${groupId}_${userId}`,
    profileCollection: { __name: 'student_profiles' },
    parentProfileCollection: { __name: 'parent_profiles' },
    coachProfileCollection: { __name: 'coach_profiles' },
    async getProfile(userId) {
      counters.reads += 1;
      return clone(collection('student_profiles').get(`profile_${userId}`) || null);
    },
    async getLatestReview() {
      return null;
    },
    async getCoachGroupIds() {
      return seed.coachGroupIds || [];
    },
    parentInviteIdForRequest: (studentUserId, requestId) =>
      `parent_invite_${crypto
        .createHash('sha256')
        .update(`${studentUserId}|${requestId}`)
        .digest('hex')
        .slice(0, 16)}`,
    parentLinkIdForPair: (parentUserId, studentUserId) =>
      `parent_link_${crypto
        .createHash('sha256')
        .update(`${parentUserId}|${studentUserId}`)
        .digest('hex')
        .slice(0, 16)}`,

    async getParentProfile(userId) {
      counters.reads += 1;
      return clone(collection('parent_profiles').get(`parent_profile_${userId}`) || null);
    },
    async getCoachProfile(userId) {
      counters.reads += 1;
      return clone(collection('coach_profiles').get(`coach_profile_${userId}`) || null);
    },
    async getParentLink(linkId) {
      counters.reads += 1;
      return clone(collection('parent_links').get(linkId) || null);
    },
    async listParentLinks(where, maxRecords = 100) {
      counters.reads += 1;
      return Array.from(collection('parent_links').values())
        .filter((record) => matches(record, where))
        .slice(0, maxRecords)
        .map(clone);
    },
    async countParentLinksByStatus(where) {
      counters.reads += 1;
      return Array.from(collection('parent_links').values()).filter((record) =>
        matches(record, where)
      ).length;
    },
    async expireParentInvite(inviteId) {
      const existing = collection('parent_links').get(inviteId);
      if (existing) {
        collection('parent_links').set(inviteId, {
          ...existing,
          status: 'expired',
          updatedAt: new Date()
        });
      }
    },
    async incrementInviteAttempts(inviteId) {
      const existing = collection('parent_links').get(inviteId);
      if (!existing) {
        return 0;
      }
      const next = Number(existing.attempts || 0) + 1;
      collection('parent_links').set(inviteId, { ...existing, attempts: next });
      return next;
    },
    async recordParentInviteFailure(userId) {
      /* 与生产实现一致：计数写在 users 文档上 */
      const user = usersById.get(userId);
      if (!user) {
        return 0;
      }
      const windowAt = user.inviteFailWindowAt
        ? new Date(user.inviteFailWindowAt).getTime()
        : 0;
      const inWindow = windowAt && Date.now() - windowAt < 15 * 60 * 1000;
      const next = inWindow ? Number(user.inviteFailCount || 0) + 1 : 1;
      user.inviteFailCount = next;
      user.inviteFailWindowAt = inWindow ? user.inviteFailWindowAt : new Date();
      return next;
    },

    async listTrainingPlans() {
      counters.reads += 1;
      return { records: seed.plans || [] };
    },
    async listApprovedPerformanceRecordsForStatistics() {
      counters.reads += 1;
      return { records: seed.approvedPerformances || [] };
    },
    async listAttendanceRecordsByStudent() {
      counters.reads += 1;
      return { records: seed.attendance || [] };
    },
    async listTrainingFeedback() {
      counters.reads += 1;
      return { records: seed.feedback || [] };
    },
    async listRegistrations() {
      counters.reads += 1;
      return { records: seed.registrations || [] };
    },
    async listClubNotices() {
      counters.reads += 1;
      return { records: seed.notices || [] };
    },
    async queryAll(collectionRef, where, maxRecords = 100) {
      counters.reads += 1;
      const name = collectionRef && collectionRef.__name;
      if (!name) {
        return [];
      }
      return Array.from(collection(name).values())
        .filter((record) => matches(record, where))
        .slice(0, maxRecords)
        .map(clone);
    },
    async countWhere(collectionRef, where) {
      counters.reads += 1;
      const name = collectionRef && collectionRef.__name;
      if (!name) {
        return 0;
      }
      return Array.from(collection(name).values()).filter((record) =>
        matches(record, where)
      ).length;
    },

    seedStudent(user) {
      usersById.set(user._id, user);
      if (user.openid) {
      usersByOpenId.set(user.openid, user);
      }
      /* 事务内的 doc(id).get() 读取的是 users 集合，种子数据需同步写入 */
      collection('users').set(user._id, user);
      return user;
    },
    seedRoleBinding(userId, role, status = 'active', extra = {}) {
      const id = repository.roleBindingId(userId, role);
      const record = {
        _id: id,
        userId,
        role,
        status,
        grantedAt: new Date(),
        updatedAt: new Date(),
        ...extra
      };
      collection('role_bindings').set(id, record);
      return record;
    },
    seedCoachProfile(userId, profile) {
      collection('coach_profiles').set(`coach_profile_${userId}`, {
        _id: `coach_profile_${userId}`,
        userId,
        ...profile
      });
    },
    seedProfile(userId, profile) {
      collection('student_profiles').set(`profile_${userId}`, {
        _id: `profile_${userId}`,
        ...profile
      });
    },
    seedParentProfile(userId, profile) {
      collection('parent_profiles').set(`parent_profile_${userId}`, {
        _id: `parent_profile_${userId}`,
        ...profile
      });
    },
    seedRecord(name, record) {
      collection(name).set(record._id, clone(record));
      return record;
    },
    readCollection(name) {
      return Array.from(collection(name).values()).map(clone);
    }
  };

  return repository;
}

function createConcurrentRepository(seed = {}) {
  return createFakeRepository(seed, { optimisticTransactions: true });
}

function createParentActions(repository) {
  return require('../../cloudfunctions/api/actions/parent')({ repository });
}

const IDENTITY = (openid) => ({ appid: 'wx_test', openid });

module.exports = {
  IDENTITY,
  createFakeRepository,
  createConcurrentRepository,
  createParentActions
};
