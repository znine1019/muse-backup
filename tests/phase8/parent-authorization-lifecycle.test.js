'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createUserAdminActions = require('../../cloudfunctions/api/actions/users');
const createRegistrationActions = require('../../cloudfunctions/api/actions/registrations');
const { IDENTITY, createFakeRepository, createParentActions } = require('./helpers');

const SEED = {
  studentGroupIds: ['group_a'],
  groups: [{ _id: 'group_a', name: '短跑组', seasonLabel: '2026', enabled: true }],
  plans: [],
  approvedPerformances: [],
  attendance: [],
  feedback: [],
  registrations: [],
  notices: []
};

function setup() {
  const repository = createFakeRepository(SEED);
  const actions = createParentActions(repository);
  const userActions = createUserAdminActions({ repository });
  const registrationActions = createRegistrationActions({ repository });
  const dev = repository.seedStudent({
    _id: 'usr_dev',
    openid: 'openid_dev',
    status: 'active',
    roles: ['developer'],
    displayName: '开发者'
  });
  repository.seedRoleBinding(dev._id, 'developer', 'active', {
    grantedBy: 'secure_bootstrap'
  });
  const studentA = repository.seedStudent({
    _id: 'usr_stu_a',
    openid: 'openid_stu_a',
    status: 'active',
    roles: ['student'],
    displayName: '学生甲'
  });
  const studentB = repository.seedStudent({
    _id: 'usr_stu_b',
    openid: 'openid_stu_b',
    status: 'active',
    roles: ['student'],
    displayName: '学生乙'
  });
  const studentC = repository.seedStudent({
    _id: 'usr_stu_c',
    openid: 'openid_stu_c',
    status: 'active',
    roles: ['student'],
    displayName: '学生丙'
  });
  const parent = repository.seedStudent({
    _id: 'usr_par',
    openid: 'openid_par',
    status: 'active',
    roles: ['parent'],
    parentAuthorizationVersion: 1,
    displayName: '家长甲'
  });
  repository.seedProfile('usr_stu_a', { name: '学生甲', primaryEventName: '100米' });
  repository.seedProfile('usr_stu_b', { name: '学生乙', primaryEventName: '100米' });
  repository.seedProfile('usr_stu_c', { name: '学生丙', primaryEventName: '100米' });
  repository.seedParentProfile('usr_par', {
    userId: 'usr_par',
    name: '家长甲',
    relation: 'guardian',
    reviewStatus: 'approved'
  });
  return {
    repository,
    actions,
    userActions,
    registrationActions,
    dev,
    studentA,
    studentB,
    studentC,
    parent
  };
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to be rejected');
}

async function redeem(ctx, student) {
  const invite = await ctx.actions['parent.create_invite']({
    identity: IDENTITY(student.openid),
    payload: {}
  });
  return ctx.actions['parent.redeem_invite']({
    identity: IDENTITY(ctx.parent.openid),
    payload: { code: invite.code }
  });
}

async function createActiveLink(ctx, student) {
  await redeem(ctx, student);
  const linkId = ctx.repository.parentLinkIdForPair(ctx.parent._id, student._id);
  await ctx.actions['parent.student_decision']({
    identity: IDENTITY(student.openid),
    payload: { linkId, decision: 'confirm' }
  });
  await ctx.actions['parent.review_link']({
    identity: IDENTITY(ctx.dev.openid),
    payload: { linkId, decision: 'approve' }
  });
  return linkId;
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

test('SEC-01 admin.assign_role拒绝直接授予parent', async () => {
  const ctx = setup();
  const candidate = ctx.repository.seedStudent({
    _id: 'usr_candidate',
    openid: 'openid_candidate',
    status: 'pending_profile',
    roles: []
  });

  const error = await captureError(
    ctx.userActions['admin.assign_role']({
      identity: IDENTITY(ctx.dev.openid),
      payload: {
        targetUserId: candidate._id,
        role: 'parent',
        grant: true
      }
    })
  );

  assert.equal(error.code, 'PARENT_ROLE_APPROVAL_REQUIRED');
  assert.deepEqual((await ctx.repository.getUserById(candidate._id)).roles, []);
});

test('SEC-01 合法家长注册审核仍可授予parent并建立授权代次', async () => {
  const ctx = setup();
  const candidate = ctx.repository.seedStudent({
    _id: 'usr_new_parent',
    openid: 'openid_new_parent',
    status: 'pending_review',
    roles: []
  });
  ctx.repository.seedParentProfile(candidate._id, {
    userId: candidate._id,
    name: '家长乙',
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
  assert.equal(
    (await ctx.repository.getParentProfile(candidate._id)).reviewStatus,
    'approved'
  );
});

test('SEC-01 未approved家长不能核销邀请码', async () => {
  const ctx = setup();
  ctx.repository.seedParentProfile(ctx.parent._id, {
    userId: ctx.parent._id,
    name: '家长甲',
    relation: 'guardian',
    reviewStatus: 'pending'
  });
  const invite = await ctx.actions['parent.create_invite']({
    identity: IDENTITY(ctx.studentA.openid),
    payload: {}
  });

  const error = await captureError(
    ctx.actions['parent.redeem_invite']({
      identity: IDENTITY(ctx.parent.openid),
      payload: { code: invite.code }
    })
  );

  assert.equal(error.code, 'PARENT_PROFILE_NOT_APPROVED');
});

test('SEC-01 历史异常parent角色不能绕过资料审核读取数据', async () => {
  const ctx = setup();
  ctx.repository.seedParentProfile(ctx.parent._id, {
    userId: ctx.parent._id,
    name: '家长甲',
    relation: 'guardian',
    reviewStatus: 'pending'
  });
  await ctx.repository.db.runTransaction(async (transaction) => {
    await transaction
      .collection('parent_links')
      .doc(ctx.repository.parentLinkIdForPair(ctx.parent._id, ctx.studentA._id))
      .set({
        data: {
          kind: 'relation',
          parentUserId: ctx.parent._id,
          studentUserId: ctx.studentA._id,
          status: 'active',
          parentAuthorizationVersion: 1
        }
      });
  });

  const error = await captureError(
    ctx.actions['parent.get_student_overview']({
      identity: IDENTITY(ctx.parent.openid),
      payload: { studentUserId: ctx.studentA._id }
    })
  );

  assert.equal(error.code, 'PARENT_PROFILE_NOT_APPROVED');
});

test('SEC-01 正常approved家长可以完成关联并读取白名单数据', async () => {
  const ctx = setup();
  await createActiveLink(ctx, ctx.studentA);

  const overview = await ctx.actions['parent.get_student_overview']({
    identity: IDENTITY(ctx.parent.openid),
    payload: { studentUserId: ctx.studentA._id }
  });

  assert.equal(overview.student.name, '学生甲');
  assert.equal(JSON.stringify(overview).includes('latitude'), false);
  assert.equal(JSON.stringify(overview).includes('coachComment'), false);
});

test('SEC-01 撤销parent角色同步撤销多条active和pending关联', async () => {
  const ctx = setup();
  const activeA = await createActiveLink(ctx, ctx.studentA);
  const activeB = await createActiveLink(ctx, ctx.studentB);
  await redeem(ctx, ctx.studentC);
  const pendingC = ctx.repository.parentLinkIdForPair(ctx.parent._id, ctx.studentC._id);

  const result = await revokeParentRole(ctx);

  assert.deepEqual(result.roles, []);
  assert.equal(result.parentAuthorizationVersion, 2);
  assert.equal(result.revokedLinkCount, 3);
  for (const linkId of [activeA, activeB, pendingC]) {
    const record = ctx.repository
      .readCollection('parent_links')
      .find((item) => item._id === linkId);
    assert.equal(record.status, 'revoked');
    assert.equal(record.revokedBy, ctx.dev._id);
    assert.equal(record.revokeReason, 'parent_role_revoked');
    assert.equal(record.revokedByRoleChange, true);
    assert.ok(record.revokedAt);
  }
  const audits = ctx.repository.readCollection('audit_logs');
  assert.equal(audits.some((item) => item.action === 'admin.role.revoked'), true);
  assert.equal(audits.some((item) => item.action === 'parent.link.revoked'), true);
});

test('SEC-01 重新获得parent角色不能恢复旧关联或旧授权代次', async () => {
  const ctx = setup();
  const linkId = await createActiveLink(ctx, ctx.studentA);
  await revokeParentRole(ctx);

  await ctx.repository.userCollection.doc(ctx.parent._id).update({
    data: {
      roles: ['parent'],
      status: 'active'
    }
  });
  await ctx.repository.db.runTransaction(async (transaction) => {
    await transaction.collection('parent_links').doc(linkId).update({
      data: { status: 'active' }
    });
  });

  const error = await captureError(
    ctx.actions['parent.get_student_overview']({
      identity: IDENTITY(ctx.parent.openid),
      payload: { studentUserId: ctx.studentA._id }
    })
  );
  assert.equal(error.code, 'PARENT_AUTHORIZATION_STALE');
});

test('SEC-01 pending关联在撤权后不能被开发者意外批准', async () => {
  const ctx = setup();
  await redeem(ctx, ctx.studentA);
  const linkId = ctx.repository.parentLinkIdForPair(ctx.parent._id, ctx.studentA._id);
  await ctx.actions['parent.student_decision']({
    identity: IDENTITY(ctx.studentA.openid),
    payload: { linkId, decision: 'confirm' }
  });
  await revokeParentRole(ctx);

  const error = await captureError(
    ctx.actions['parent.review_link']({
      identity: IDENTITY(ctx.dev.openid),
      payload: { linkId, decision: 'approve' }
    })
  );
  assert.equal(error.code, 'LINK_NOT_PENDING');
});

test('SEC-01 重复撤权保持幂等且不重复递增授权代次', async () => {
  const ctx = setup();
  const first = await revokeParentRole(ctx);
  const second = await revokeParentRole(ctx);

  assert.equal(first.parentAuthorizationVersion, 2);
  assert.equal(second.parentAuthorizationVersion, undefined);
  assert.equal(second.revokedLinkCount, 0);
  assert.equal(
    (await ctx.repository.getUserById(ctx.parent._id)).parentAuthorizationVersion,
    2
  );
});

test('SEC-01 撤权事务失败不会提前移除角色或扩大访问', async () => {
  const ctx = setup();
  const linkId = await createActiveLink(ctx, ctx.studentA);
  const originalRunTransaction = ctx.repository.db.runTransaction;
  ctx.repository.db.runTransaction = async () => {
    throw new Error('simulated revoke failure');
  };

  const error = await captureError(revokeParentRole(ctx));
  assert.match(error.message, /simulated revoke failure/);
  assert.deepEqual((await ctx.repository.getUserById(ctx.parent._id)).roles, ['parent']);
  assert.equal(
    ctx.repository.readCollection('parent_links').find((item) => item._id === linkId).status,
    'active'
  );

  ctx.repository.db.runTransaction = originalRunTransaction;
  const overview = await ctx.actions['parent.get_student_overview']({
    identity: IDENTITY(ctx.parent.openid),
    payload: { studentUserId: ctx.studentA._id }
  });
  assert.equal(overview.student.name, '学生甲');
});

test('SEC-01 账号停用与parent角色撤销保持不同语义', async () => {
  const ctx = setup();
  const linkId = await createActiveLink(ctx, ctx.studentA);

  await ctx.userActions['admin.set_user_status']({
    identity: IDENTITY(ctx.dev.openid),
    payload: {
      targetUserId: ctx.parent._id,
      status: 'disabled'
    }
  });
  assert.deepEqual((await ctx.repository.getUserById(ctx.parent._id)).roles, ['parent']);
  assert.equal(
    ctx.repository.readCollection('parent_links').find((item) => item._id === linkId).status,
    'active'
  );
  const disabledError = await captureError(
    ctx.actions['parent.get_student_overview']({
      identity: IDENTITY(ctx.parent.openid),
      payload: { studentUserId: ctx.studentA._id }
    })
  );
  assert.equal(disabledError.code, 'ACCOUNT_DISABLED');

  await ctx.userActions['admin.set_user_status']({
    identity: IDENTITY(ctx.dev.openid),
    payload: {
      targetUserId: ctx.parent._id,
      status: 'active'
    }
  });
  const overview = await ctx.actions['parent.get_student_overview']({
    identity: IDENTITY(ctx.parent.openid),
    payload: { studentUserId: ctx.studentA._id }
  });
  assert.equal(overview.student.name, '学生甲');
});
