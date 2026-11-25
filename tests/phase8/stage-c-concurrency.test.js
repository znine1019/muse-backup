'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createUserAdminActions = require('../../cloudfunctions/api/actions/users');
const {
  IDENTITY,
  createConcurrentRepository,
  createParentActions
} = require('./helpers');

function seedDeveloper(repository, id, openid) {
  const user = repository.seedStudent({
    _id: id,
    openid,
    status: 'active',
    roles: ['developer']
  });
  repository.seedRoleBinding(id, 'developer', 'active', {
    grantedBy: 'secure_bootstrap'
  });
  return user;
}

function seedBootstrap(repository) {
  repository.seedRecord('system_config', {
    _id: 'bootstrap',
    state: 'completed',
    developerInitialized: true,
    adminGuardVersion: 0,
    adminGuardUpdatedAt: null
  });
}

function activeDeveloperCount(repository) {
  const activeBindings = new Set(
    repository
      .readCollection('role_bindings')
      .filter(
        (binding) =>
          binding.role === 'developer' && binding.status === 'active'
      )
      .map((binding) => binding.userId)
  );
  return Array.from(repository.usersById.values()).filter(
    (user) =>
      user.status === 'active' &&
      Array.isArray(user.roles) &&
      user.roles.includes('developer') &&
      activeBindings.has(user._id)
  ).length;
}

function createTwoDeveloperHarness() {
  const repository = createConcurrentRepository();
  const devA = seedDeveloper(repository, 'usr_dev_a', 'openid_dev_a');
  const devB = seedDeveloper(repository, 'usr_dev_b', 'openid_dev_b');
  seedBootstrap(repository);
  return {
    repository,
    devA,
    devB,
    actions: createUserAdminActions({ repository })
  };
}

function installFirstAttemptBarrier(repository) {
  let entered = 0;
  let releaseGate;
  let resolveBothEntered;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const bothEntered = new Promise((resolve) => {
    resolveBothEntered = resolve;
  });
  repository.db.transactionBarrier = async ({ attempt }) => {
    if (attempt !== 1) {
      return;
    }
    entered += 1;
    if (entered === 2) {
      resolveBothEntered();
    }
    await gate;
  };
  return {
    async waitUntilBothEntered() {
      await Promise.race([
        bothEntered,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('transactions did not overlap')), 1000);
        })
      ]);
    },
    release() {
      releaseGate();
    }
  };
}

async function settlePair(first, second) {
  return Promise.allSettled([first, second]);
}

test('different parents cannot redeem the same invite concurrently', async () => {
  const repository = createConcurrentRepository();
  const student = repository.seedStudent({
    _id: 'usr_student',
    openid: 'openid_student',
    status: 'active',
    roles: ['student']
  });
  const parentA = repository.seedStudent({
    _id: 'usr_parent_a',
    openid: 'openid_parent_a',
    status: 'active',
    roles: ['parent'],
    parentAuthorizationVersion: 1
  });
  const parentB = repository.seedStudent({
    _id: 'usr_parent_b',
    openid: 'openid_parent_b',
    status: 'active',
    roles: ['parent'],
    parentAuthorizationVersion: 1
  });
  for (const parent of [parentA, parentB]) {
    repository.seedParentProfile(parent._id, {
      userId: parent._id,
      name: `家长${parent._id.slice(-1)}`,
      relation: 'guardian',
      reviewStatus: 'approved'
    });
  }
  const actions = createParentActions(repository);
  const invite = await actions['parent.create_invite']({
    identity: IDENTITY(student.openid),
    payload: { clientRequestId: 'stage_c_invite_race' }
  });

  const barrier = installFirstAttemptBarrier(repository);
  const pending = settlePair(
    actions['parent.redeem_invite']({
      identity: IDENTITY(parentA.openid),
      payload: { code: invite.code }
    }),
    actions['parent.redeem_invite']({
      identity: IDENTITY(parentB.openid),
      payload: { code: invite.code }
    })
  );
  await barrier.waitUntilBothEntered();
  barrier.release();
  const settled = await pending;

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1);
  const rejected = settled.find((item) => item.status === 'rejected');
  assert.equal(rejected.reason.code, 'INVALID_INVITE_CODE');
  assert.ok(repository.counters.transactionConflicts >= 1);
  assert.ok(repository.counters.transactionRetries >= 1);

  const links = repository.readCollection('parent_links');
  const storedInvite = links.find((item) => item._id === invite.inviteId);
  const relations = links.filter((item) => item.kind === 'relation');
  assert.equal(storedInvite.status, 'used');
  assert.ok([parentA._id, parentB._id].includes(storedInvite.usedByParentUserId));
  assert.equal(relations.length, 1);
  assert.equal(relations[0].studentUserId, student._id);
  assert.equal(relations[0].status, 'pending_student');
  assert.equal(
    repository.readCollection('audit_logs').filter(
      (item) => item.action === 'parent.link.requested'
    ).length,
    1
  );
});

test('two Developers cannot revoke each other concurrently out of existence', async () => {
  const { repository, devA, devB, actions } = createTwoDeveloperHarness();
  const barrier = installFirstAttemptBarrier(repository);
  const pending = settlePair(
    actions['admin.assign_role']({
      identity: IDENTITY(devA.openid),
      payload: { targetUserId: devB._id, role: 'developer', grant: false }
    }),
    actions['admin.assign_role']({
      identity: IDENTITY(devB.openid),
      payload: { targetUserId: devA._id, role: 'developer', grant: false }
    })
  );
  await barrier.waitUntilBothEntered();
  barrier.release();
  const settled = await pending;

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.ok(activeDeveloperCount(repository) >= 1);
  assert.ok(repository.counters.transactionConflicts >= 1);
  assert.ok(repository.counters.transactionRetries >= 1);
  assert.equal(
    repository.readCollection('audit_logs').filter(
      (item) => item.action === 'admin.role.revoked'
    ).length,
    1
  );
});

test('two Developers cannot disable each other concurrently out of existence', async () => {
  const { repository, devA, devB, actions } = createTwoDeveloperHarness();
  const barrier = installFirstAttemptBarrier(repository);
  const pending = settlePair(
    actions['admin.set_user_status']({
      identity: IDENTITY(devA.openid),
      payload: { targetUserId: devB._id, status: 'disabled' }
    }),
    actions['admin.set_user_status']({
      identity: IDENTITY(devB.openid),
      payload: { targetUserId: devA._id, status: 'disabled' }
    })
  );
  await barrier.waitUntilBothEntered();
  barrier.release();
  const settled = await pending;

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.ok(activeDeveloperCount(repository) >= 1);
  assert.ok(repository.counters.transactionConflicts >= 1);
  assert.equal(
    repository.readCollection('audit_logs').filter(
      (item) => item.action === 'admin.user.disabled'
    ).length,
    1
  );
});

test('Developer deletion is rejected and cannot race away the last administrator', async () => {
  const { repository, devA, devB, actions } = createTwoDeveloperHarness();

  const deletion = await actions['admin.delete_user']({
    identity: IDENTITY(devA.openid),
    payload: {
      targetUserId: devB._id,
      confirmationText: 'DELETE_ACCOUNT',
      acknowledgeAssociations: true
    }
  }).then(
    () => null,
    (error) => error
  );
  assert.equal(deletion.code, 'DEVELOPER_DELETE_FORBIDDEN');
  assert.ok(activeDeveloperCount(repository) >= 1);
});

test('concurrent Developer grant and revoke converge to user, binding and audit state', async () => {
  const { repository, devA, devB, actions } = createTwoDeveloperHarness();
  const candidate = repository.seedStudent({
    _id: 'usr_dev_candidate',
    openid: 'openid_dev_candidate',
    status: 'active',
    roles: ['coach']
  });
  repository.seedRoleBinding(candidate._id, 'coach', 'active', {
    grantedBy: devA._id
  });
  repository.seedCoachProfile(candidate._id, {
    name: '候选开发者',
    reviewStatus: 'approved'
  });

  const barrier = installFirstAttemptBarrier(repository);
  const pending = settlePair(
    actions['admin.assign_role']({
      identity: IDENTITY(devA.openid),
      payload: { targetUserId: candidate._id, role: 'developer', grant: true }
    }),
    actions['admin.assign_role']({
      identity: IDENTITY(devB.openid),
      payload: { targetUserId: candidate._id, role: 'developer', grant: false }
    })
  );
  await barrier.waitUntilBothEntered();
  barrier.release();
  const settled = await pending;

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 2);
  assert.ok(repository.counters.transactionConflicts >= 1);
  assert.ok(repository.counters.transactionRetries >= 1);

  const current = repository.usersById.get(candidate._id);
  const binding = repository
    .readCollection('role_bindings')
    .find(
      (item) => item.userId === candidate._id && item.role === 'developer'
    );
  const hasRole = (current.roles || []).includes('developer');
  assert.equal(binding.status, hasRole ? 'active' : 'revoked');
  assert.equal(
    repository.readCollection('audit_logs').filter(
      (item) =>
        item.targetId === candidate._id &&
        ['admin.role.granted', 'admin.role.revoked'].includes(item.action)
    ).length,
    2
  );
  assert.ok(activeDeveloperCount(repository) >= 2);
});

test('Developer role without an active binding does not count as a protected administrator', async () => {
  const { repository, devA, actions } = createTwoDeveloperHarness();
  repository.seedRoleBinding(devA._id, 'developer', 'active', {
    grantedBy: 'secure_bootstrap'
  });
  repository.seedRoleBinding('usr_dev_b', 'developer', 'revoked', {
    grantedBy: 'historical_revoke'
  });
  repository.seedStudent({
    _id: 'usr_developer_ghost',
    openid: 'openid_developer_ghost',
    status: 'active',
    roles: ['developer']
  });
  repository.seedRoleBinding(
    'usr_developer_ghost',
    'developer',
    'revoked',
    { grantedBy: 'historical_mismatch' }
  );

  const error = await actions['admin.assign_role']({
    identity: IDENTITY(devA.openid),
    payload: { targetUserId: devA._id, role: 'developer', grant: false }
  }).then(
    () => null,
    (caught) => caught
  );

  assert.equal(error.code, 'LAST_DEVELOPER');
  assert.equal(activeDeveloperCount(repository), 1);
});
