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

  if (!where) {
    return true;
  }
  return Object.entries(where).every(([field, expected]) => {
    if (expected && typeof expected === 'object' && expected.__in) {
      return expected.__in.includes(record[field]);
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

function createFakeRepository(seed = {}) {
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
  const counters = { reads: 0, writes: 0, transactions: 0 };

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

  const db = {
    serverDate: () => new Date(),
    command: {
      in: (values) => ({ __in: values }),
      inc: (value) => ({ __inc: value })
    },
    async runTransaction(handler) {
      counters.transactions += 1;
      const transaction = {
        collection(name) {
          const col = collection(name);
          return {
            doc(id) {
              return {
                async get() {
                  counters.reads += 1;
                  const record = col.get(id);
                  if (!record) {
                    throw new Error('document not found');
                  }
                  return { data: clone(record) };
                },
                async set({ data }) {
                  counters.writes += 1;
                  const record = { _id: id, ...clone(data) };
                  col.set(id, record);
                  syncUsers(name, record);
                  return { ok: true };
                },
                async update({ data }) {
                  counters.writes += 1;
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
          };
        }
      };
      return handler(transaction);
    }
  };

  const repository = {
    db,
    counters,
    usersById,
    usersByOpenId,

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
    parentProfileIdForUser: (userId) => `parent_profile_${userId}`,
    profileIdForUser: (userId) => `profile_${userId}`,
    roleBindingId: (userId, role) => `role_${userId}_${role}`,
    membershipId: (groupId, userId) => `member_${groupId}_${userId}`,
    profileCollection: { __name: 'student_profiles' },
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
    async queryAll() {
      counters.reads += 1;
      return [];
    },
    parentProfileCollection: { __name: 'parent_profiles' },

    seedStudent(user) {
      usersById.set(user._id, user);
      if (user.openid) {
      usersByOpenId.set(user.openid, user);
      }
      /* 事务内的 doc(id).get() 读取的是 users 集合，种子数据需同步写入 */
      collection('users').set(user._id, user);
      return user;
    },
    seedProfile(userId, profile) {
      collection('student_profiles').set(`profile_${userId}`, {
        _id: `profile_${userId}`,
        ...profile
      });
    },
    readCollection(name) {
      return Array.from(collection(name).values()).map(clone);
    }
  };

  return repository;
}

function createParentActions(repository) {
  return require('../../cloudfunctions/api/actions/parent')({ repository });
}

const IDENTITY = (openid) => ({ appid: 'wx_test', openid });

module.exports = {
  IDENTITY,
  createFakeRepository,
  createParentActions
};
