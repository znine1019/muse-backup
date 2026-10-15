'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createRegistrationActions = require('../../cloudfunctions/api/actions/registrations');
const createUserAdminActions = require('../../cloudfunctions/api/actions/users');
const { AUDIT_ACTIONS } = require('../../cloudfunctions/api/lib/constants');
const { IDENTITY, createFakeRepository, createParentActions } = require('./helpers');

const PARENT_LINK_STATUS = Object.freeze({
  ACTIVE: 'active',
  PENDING_STUDENT: 'pending_student',
  PENDING_REVIEW: 'pending_review',
  REVOKED: 'revoked'
});

function setup() {
  const repository = createFakeRepository();
  const userActions = createUserAdminActions({ repository });
  const parentActions = createParentActions(repository);
  const registrationActions = createRegistrationActions({ repository });
  const dev = repository.seedStudent({
    _id: 'usr_sec02_dev',
    openid: 'openid_sec02_dev',
    status: 'active',
    roles: ['developer']
  });
  const parent = repository.seedStudent({
    _id: 'usr_sec02_parent',
    openid: 'openid_sec02_parent',
    status: 'active',
    roles: ['parent'],
    parentAuthorizationVersion: 1
  });
  const student = repository.seedStudent({
    _id: 'usr_sec02_student',
    openid: 'openid_sec02_student',
    status: 'active',
    roles: ['student']
  });
  repository.seedParentProfile(parent._id, {
    userId: parent._id,
    name: '容量测试家长',
    relation: 'guardian',
    reviewStatus: 'approved'
  });
  repository.seedProfile(student._id, {
    name: '容量测试学生',
    primaryEventName: '100米'
  });
  return { repository, userActions, parentActions, registrationActions, dev, parent, student };
}

function statusAt(statuses, index) {
  return statuses[index % statuses.length];
}

async function seedLinks(ctx, count, statuses = [PARENT_LINK_STATUS.ACTIVE]) {
  const records = Array.from({ length: count }, (_, index) => ({
    _id: `sec02_link_${index}`,
    kind: 'relation',
    parentUserId: ctx.parent._id,
    studentUserId: `usr_sec02_student_${index}`,
    status: statusAt(statuses, index),
    parentAuthorizationVersion: 1
  }));
  if (records.length) {
    await ctx.repository.db.runTransaction(async (transaction) => {
      for (const record of records) {
        await transaction.collection('parent_links').doc(record._id).set({ data: record });
      }
    });
  }
  return records;
}

async function revokeParentRole(ctx) {
  return ctx.userActions['admin.assign_role']({
    identity: IDENTITY(ctx.dev.openid),
    payload: {
      targetUserId: ctx.parent._id,
      role: 'parent',
      grant: false
    }
  });
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to be rejected');
}

function linkById(ctx, id) {
  return ctx.repository.readCollection('parent_links').find((record) => record._id === id);
}

function assertAllStatus(ctx, links, expectedStatus) {
  for (const link of links) {
    assert.equal(linkById(ctx, link._id).status, expectedStatus);
  }
}

function failTransactionAfter(repository, operationNumber) {
  const originalRunTransaction = repository.db.runTransaction;
  repository.db.runTransaction = async (handler) => {
    const before = repository.snapshot();
    let operationCount = 0;
    try {
      return await originalRunTransaction(async (transaction) => {
        const wrappedTransaction = {
          collection(name) {
            return {
              doc(id) {
                const reference = transaction.collection(name).doc(id);
                const beforeOperation = () => {
                  operationCount += 1;
                  if (operationCount === operationNumber) {
                    throw new Error('simulated SEC-02 transaction failure');
                  }
                };
                return {
                  async get() {
                    beforeOperation();
                    return reference.get();
                  },
                  async set(payload) {
                    beforeOperation();
                    return reference.set(payload);
                  },
                  async update(payload) {
                    beforeOperation();
                    return reference.update(payload);
                  }
                };
              }
            };
          }
        };
        return handler(wrappedTransaction);
      });
    } catch (error) {
      repository.restore(before);
      throw error;
    }
  };
  return () => {
    repository.db.runTransaction = originalRunTransaction;
  };
}

test('SEC-02 0条关联正常撤权', async () => {
  const ctx = setup();

  const result = await revokeParentRole(ctx);

  assert.deepEqual(result.roles, []);
  assert.equal(result.revokedLinkCount, 0);
  assert.equal(result.parentAuthorizationVersion, 2);
  assert.equal(ctx.repository.counters.lastTransactionOperations, 4);
});

test('SEC-02 1条关联正常撤权', async () => {
  const ctx = setup();
  const links = await seedLinks(ctx, 1);

  const result = await revokeParentRole(ctx);

  assert.equal(result.revokedLinkCount, 1);
  assertAllStatus(ctx, links, PARENT_LINK_STATUS.REVOKED);
  assert.equal(ctx.repository.counters.lastTransactionOperations, 7);
});

test('SEC-02 10条关联正常撤权', async () => {
  const ctx = setup();
  const links = await seedLinks(ctx, 10);

  const result = await revokeParentRole(ctx);

  assert.equal(result.revokedLinkCount, 10);
  assertAllStatus(ctx, links, PARENT_LINK_STATUS.REVOKED);
  assert.equal(ctx.repository.counters.lastTransactionOperations, 34);
});

test('SEC-02 20条安全上限正常撤权且操作数低于100', async () => {
  const ctx = setup();
  const links = await seedLinks(ctx, 20);

  const result = await revokeParentRole(ctx);

  assert.equal(result.revokedLinkCount, 20);
  assertAllStatus(ctx, links, PARENT_LINK_STATUS.REVOKED);
  assert.equal(ctx.repository.counters.lastTransactionOperations, 64);
  assert.ok(ctx.repository.counters.lastTransactionOperations < 100);
});

test('SEC-02 21条超过安全上限时拒绝且状态完全不变', async () => {
  const ctx = setup();
  const links = await seedLinks(ctx, 21);
  const transactionsBefore = ctx.repository.counters.transactions;

  const error = await captureError(revokeParentRole(ctx));

  assert.equal(error.code, 'PARENT_LINK_REVOKE_LIMIT');
  assert.equal(ctx.repository.counters.transactions, transactionsBefore);
  assert.deepEqual((await ctx.repository.getUserById(ctx.parent._id)).roles, ['parent']);
  assert.equal(
    (await ctx.repository.getUserById(ctx.parent._id)).parentAuthorizationVersion,
    1
  );
  assertAllStatus(ctx, links, PARENT_LINK_STATUS.ACTIVE);
  assert.equal(ctx.repository.readCollection('audit_logs').length, 0);
});

test('SEC-02 事务操作计数精确符合4+3N', async () => {
  const ctx = setup();
  await seedLinks(ctx, 20);

  await revokeParentRole(ctx);

  assert.equal(ctx.repository.counters.lastTransactionReads, 21);
  assert.equal(ctx.repository.counters.lastTransactionWrites, 43);
  assert.equal(ctx.repository.counters.lastTransactionOperations, 64);
  assert.equal(ctx.repository.counters.maxTransactionOperations, 64);
});

test('SEC-02 事务中途失败完整回滚', async () => {
  const ctx = setup();
  const links = await seedLinks(ctx, 5);
  const before = ctx.repository.snapshot();
  const restoreRunTransaction = failTransactionAfter(ctx.repository, 6);

  let error;
  try {
    error = await captureError(revokeParentRole(ctx));
  } finally {
    restoreRunTransaction();
  }

  assert.match(error.message, /simulated SEC-02 transaction failure/);
  assert.deepEqual(ctx.repository.snapshot(), before);
  assert.deepEqual((await ctx.repository.getUserById(ctx.parent._id)).roles, ['parent']);
  assert.equal(
    (await ctx.repository.getUserById(ctx.parent._id)).parentAuthorizationVersion,
    1
  );
  assertAllStatus(ctx, links, PARENT_LINK_STATUS.ACTIVE);
  assert.equal(ctx.repository.readCollection('audit_logs').length, 0);
});

test('SEC-02 active和pending关联全部撤销且非撤销状态不误改', async () => {
  const ctx = setup();
  const links = await seedLinks(ctx, 6, [
    PARENT_LINK_STATUS.ACTIVE,
    PARENT_LINK_STATUS.ACTIVE,
    PARENT_LINK_STATUS.PENDING_STUDENT,
    PARENT_LINK_STATUS.PENDING_REVIEW,
    'open',
    'rejected'
  ]);

  const result = await revokeParentRole(ctx);

  assert.equal(result.revokedLinkCount, 4);
  assert.equal(ctx.repository.counters.lastTransactionOperations, 16);
  assert.equal(linkById(ctx, links[0]._id).status, PARENT_LINK_STATUS.REVOKED);
  assert.equal(linkById(ctx, links[1]._id).status, PARENT_LINK_STATUS.REVOKED);
  assert.equal(linkById(ctx, links[2]._id).status, PARENT_LINK_STATUS.REVOKED);
  assert.equal(linkById(ctx, links[3]._id).status, PARENT_LINK_STATUS.REVOKED);
  assert.equal(linkById(ctx, links[4]._id).status, 'open');
  assert.equal(linkById(ctx, links[5]._id).status, 'rejected');
});

test('SEC-02 重复撤权保持幂等', async () => {
  const ctx = setup();
  const links = await seedLinks(ctx, 2);
  const first = await revokeParentRole(ctx);
  const transactionsAfterFirst = ctx.repository.counters.transactions;
  const auditsAfterFirst = ctx.repository.readCollection('audit_logs').length;

  const second = await revokeParentRole(ctx);

  assert.equal(first.revokedLinkCount, 2);
  assert.equal(second.revokedLinkCount, 0);
  assert.equal(second.parentAuthorizationVersion, undefined);
  assert.equal(ctx.repository.counters.transactions, transactionsAfterFirst);
  assert.equal(ctx.repository.readCollection('audit_logs').length, auditsAfterFirst);
  assertAllStatus(ctx, links, PARENT_LINK_STATUS.REVOKED);
});

test('SEC-02 重新授予不能恢复旧关联', async () => {
  const ctx = setup();
  const link = {
    _id: ctx.repository.parentLinkIdForPair(ctx.parent._id, ctx.student._id),
    kind: 'relation',
    parentUserId: ctx.parent._id,
    studentUserId: ctx.student._id,
    status: PARENT_LINK_STATUS.ACTIVE,
    parentAuthorizationVersion: 1
  };
  await ctx.repository.db.runTransaction(async (transaction) => {
    await transaction.collection('parent_links').doc(link._id).set({ data: link });
  });
  await revokeParentRole(ctx);
  await ctx.repository.userCollection.doc(ctx.parent._id).update({
    data: { roles: ['parent'], status: 'active' }
  });
  await ctx.repository.db.runTransaction(async (transaction) => {
    await transaction.collection('parent_links').doc(link._id).update({
      data: { status: PARENT_LINK_STATUS.ACTIVE }
    });
  });

  const error = await captureError(
    ctx.parentActions['parent.get_student_overview']({
      identity: IDENTITY(ctx.parent.openid),
      payload: { studentUserId: ctx.student._id }
    })
  );

  assert.equal(error.code, 'PARENT_AUTHORIZATION_STALE');
});

test('SEC-02 审计日志和角色绑定完整保留', async () => {
  const ctx = setup();
  await seedLinks(ctx, 2);

  await revokeParentRole(ctx);

  const audits = ctx.repository.readCollection('audit_logs');
  assert.equal(
    audits.filter((item) => item.action === AUDIT_ACTIONS.PARENT_LINK_REVOKED).length,
    2
  );
  assert.equal(
    audits.filter((item) => item.action === AUDIT_ACTIONS.ROLE_REVOKED).length,
    1
  );
  const binding = ctx.repository
    .readCollection('role_bindings')
    .find((item) => item.role === 'parent');
  assert.equal(binding.status, 'revoked');
});

test('SEC-02 正常家长注册审核不受影响', async () => {
  const ctx = setup();
  const candidate = ctx.repository.seedStudent({
    _id: 'usr_sec02_registered_parent',
    openid: 'openid_sec02_registered_parent',
    status: 'pending_review',
    roles: []
  });
  ctx.repository.seedParentProfile(candidate._id, {
    userId: candidate._id,
    name: '注册审核家长',
    relation: 'mother',
    reviewStatus: 'pending'
  });

  const result = await ctx.registrationActions['admin.review_registration']({
    identity: IDENTITY(ctx.dev.openid),
    payload: {
      targetUserId: candidate._id,
      profileType: 'parent',
      decision: 'approve'
    }
  });

  assert.deepEqual(result.roles, ['parent']);
  assert.equal(
    (await ctx.repository.getUserById(candidate._id)).parentAuthorizationVersion,
    1
  );
});

test('SEC-02 其他角色授权不受影响且不能直接授予parent', async () => {
  const ctx = setup();
  const candidate = ctx.repository.seedStudent({
    _id: 'usr_sec02_role_candidate',
    openid: 'openid_sec02_role_candidate',
    status: 'active',
    roles: []
  });

  await ctx.userActions['admin.assign_role']({
    identity: IDENTITY(ctx.dev.openid),
    payload: { targetUserId: candidate._id, role: 'coach', grant: true }
  });
  await ctx.userActions['admin.assign_role']({
    identity: IDENTITY(ctx.dev.openid),
    payload: { targetUserId: candidate._id, role: 'student', grant: true }
  });
  await ctx.userActions['admin.assign_role']({
    identity: IDENTITY(ctx.dev.openid),
    payload: { targetUserId: candidate._id, role: 'coach', grant: false }
  });

  assert.deepEqual((await ctx.repository.getUserById(candidate._id)).roles, ['student']);

  const error = await captureError(
    ctx.userActions['admin.assign_role']({
      identity: IDENTITY(ctx.dev.openid),
      payload: { targetUserId: candidate._id, role: 'parent', grant: true }
    })
  );
  assert.equal(error.code, 'PARENT_ROLE_APPROVAL_REQUIRED');
  assert.deepEqual((await ctx.repository.getUserById(candidate._id)).roles, ['student']);
});
