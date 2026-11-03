'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createUserAdminActions = require('../../cloudfunctions/api/actions/users');
const { IDENTITY, createConcurrentRepository, createFakeRepository } = require('./helpers');

function seedDeveloper(repository) {
  const developer = repository.seedStudent({
    _id: 'usr_bp02b_dev',
    openid: 'openid_bp02b_dev',
    status: 'active',
    roles: ['developer'],
    createdAt: new Date('2026-10-01T00:00:00Z')
  });
  repository.seedRoleBinding(developer._id, 'developer', 'active', {
    grantedBy: 'secure_bootstrap'
  });
  repository.seedRecord('system_config', {
    _id: 'bootstrap',
    state: 'completed',
    developerInitialized: true,
    adminGuardVersion: 0,
    adminGuardUpdatedAt: null
  });
  return developer;
}

function seedManagedUser(repository, overrides = {}) {
  const user = repository.seedStudent({
    _id: 'usr_bp02b_target',
    openid: 'openid_bp02b_target',
    status: 'active',
    roles: ['student'],
    createdAt: new Date('2026-10-02T00:00:00Z'),
    ...overrides
  });
  for (const role of user.roles || []) {
    repository.seedRoleBinding(user._id, role, 'active', {
      grantedBy: 'usr_bp02b_dev'
    });
  }
  return user;
}

function pauseNextTransaction(repository) {
  const original = repository.db.runTransaction.bind(repository.db);
  let armed = true;
  let signalEntered;
  let releaseGate;
  const entered = new Promise((resolve) => {
    signalEntered = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  repository.db.runTransaction = async (handler) => {
    if (armed) {
      armed = false;
      signalEntered();
      await gate;
    }
    return original(handler);
  };
  return {
    entered,
    release: () => releaseGate(),
    restore: () => {
      repository.db.runTransaction = original;
    }
  };
}

function activeRelationsFor(repository, userId) {
  return repository
    .readCollection('role_bindings')
    .filter((binding) => binding.userId === userId && binding.status === 'active');
}

function deletionPayload(userId) {
  return {
    targetUserId: userId,
    confirmationText: 'DELETE_ACCOUNT',
    acknowledgeAssociations: true
  };
}

test('BP02-B 删除账号与并发授予角色后不得残留有效角色绑定', async () => {
  const repository = createConcurrentRepository();
  const developer = seedDeveloper(repository);
  const target = seedManagedUser(repository);
  repository.seedProfile(target._id, {
    userId: target._id,
    name: '并发角色学生',
    reviewStatus: 'approved'
  });
  repository.seedCoachProfile(target._id, {
    userId: target._id,
    name: '并发角色教练',
    reviewStatus: 'approved'
  });
  const actions = createUserAdminActions({ repository });
  const hook = pauseNextTransaction(repository);

  try {
    const deletion = actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: deletionPayload(target._id)
    });
    await hook.entered;
    await actions['admin.assign_role']({
      identity: IDENTITY(developer.openid),
      payload: { targetUserId: target._id, role: 'coach', grant: true }
    });
    hook.release();
    await deletion;
  } finally {
    hook.restore();
  }

  assert.equal(repository.usersById.get(target._id).status, 'deleted');
  assert.equal(activeRelationsFor(repository, target._id).length, 0);
});

test('BP02-B 删除账号与并发加入训练组后不得残留有效成员关系', async () => {
  const repository = createConcurrentRepository();
  const developer = seedDeveloper(repository);
  const target = seedManagedUser(repository);
  const actions = createUserAdminActions({ repository });
  const hook = pauseNextTransaction(repository);

  try {
    const deletion = actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: deletionPayload(target._id)
    });
    await hook.entered;
    repository.seedRecord('group_memberships', {
      _id: 'bp02b_concurrent_membership',
      userId: target._id,
      groupId: 'group_bp02b',
      roleInGroup: 'student',
      status: 'active'
    });
    hook.release();
    await deletion;
  } finally {
    hook.restore();
  }

  const active = repository
    .readCollection('group_memberships')
    .filter((membership) => membership.userId === target._id && membership.status === 'active');
  assert.equal(active.length, 0);
});

test('BP02-B 删除账号与并发创建家长关联后不得残留有效关联', async () => {
  const repository = createConcurrentRepository();
  const developer = seedDeveloper(repository);
  const target = seedManagedUser(repository, {
    _id: 'usr_bp02b_parent',
    openid: 'openid_bp02b_parent',
    roles: ['parent'],
    parentAuthorizationVersion: 1
  });
  const actions = createUserAdminActions({ repository });
  const hook = pauseNextTransaction(repository);

  try {
    const deletion = actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: deletionPayload(target._id)
    });
    await hook.entered;
    repository.seedRecord('parent_links', {
      _id: 'bp02b_concurrent_parent_link',
      kind: 'relation',
      parentUserId: target._id,
      studentUserId: 'usr_bp02b_student',
      status: 'active',
      parentAuthorizationVersion: 1
    });
    hook.release();
    await deletion;
  } finally {
    hook.restore();
  }

  const active = repository
    .readCollection('parent_links')
    .filter(
      (link) =>
        link.status === 'active' &&
        (link.parentUserId === target._id || link.studentUserId === target._id)
    );
  assert.equal(active.length, 0);
});

test('BP02-B 删除账号与并发停用不会恢复已删除账号', async () => {
  const repository = createConcurrentRepository();
  const developer = seedDeveloper(repository);
  const target = seedManagedUser(repository);
  const actions = createUserAdminActions({ repository });
  const hook = pauseNextTransaction(repository);

  try {
    const deletion = actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: deletionPayload(target._id)
    });
    await hook.entered;
    await actions['admin.set_user_status']({
      identity: IDENTITY(developer.openid),
      payload: { targetUserId: target._id, status: 'disabled' }
    });
    hook.release();
    await deletion;
  } finally {
    hook.restore();
  }

  assert.equal(repository.usersById.get(target._id).status, 'deleted');
  assert.deepEqual(repository.usersById.get(target._id).roles, []);
});

async function listUsersAtSize(size) {
  const repository = createFakeRepository();
  const developer = seedDeveloper(repository);
  for (let index = 0; index < size; index += 1) {
    const id = `usr_bulk_${String(index).padStart(4, '0')}`;
    repository.seedStudent({
      _id: id,
      openid: `openid_bulk_${String(index).padStart(4, '0')}`,
      status: 'active',
      roles: ['student'],
      createdAt: new Date(1700000000000 + index)
    });
    repository.seedProfile(id, {
      userId: id,
      name: `模拟学生${index}`,
      reviewStatus: 'approved'
    });
  }
  const actions = createUserAdminActions({ repository });
  const result = await actions['admin.list_users']({
    identity: IDENTITY(developer.openid)
  });
  return { result, size };
}

for (const size of [299, 300, 301, 500]) {
  test(`BP02-B 管理端用户列表在 ${size} 名实名用户时不得静默遗漏`, async () => {
    const { result } = await listUsersAtSize(size);
    assert.equal(result.users.length, size);
    assert.equal(result.totalVisible, size);
  });
}

test('BP02-B 用户数量超过管理页安全上限时必须显式失败而不是截断', async () => {
  await assert.rejects(
    listUsersAtSize(1000),
    (error) => error.code === 'USER_LIST_LIMIT_EXCEEDED'
  );
});

test('BP02-B 超过100名开发者时撤销单个角色不会被误判为最后一人', async () => {
  const repository = createConcurrentRepository();
  const developers = [];
  repository.seedRecord('system_config', {
    _id: 'bootstrap',
    state: 'completed',
    developerInitialized: true,
    adminGuardVersion: 0,
    adminGuardUpdatedAt: null
  });
  for (let index = 0; index < 102; index += 1) {
    const id = `usr_dev_bulk_${String(index).padStart(3, '0')}`;
    const developer = repository.seedStudent({
      _id: id,
      openid: `openid_dev_bulk_${String(index).padStart(3, '0')}`,
      status: 'active',
      roles: ['developer']
    });
    repository.seedRoleBinding(id, 'developer', 'active', {
      grantedBy: 'secure_bootstrap'
    });
    developers.push(developer);
  }
  const actions = createUserAdminActions({ repository });
  const actor = developers[0];
  const target = developers[1];
  await actions['admin.assign_role']({
    identity: IDENTITY(actor.openid),
    payload: { targetUserId: target._id, role: 'developer', grant: false }
  });
  assert.equal(repository.usersById.get(target._id).roles.includes('developer'), false);
  const activeDevelopers = repository
    .readCollection('role_bindings')
    .filter((binding) => binding.role === 'developer' && binding.status === 'active');
  assert.equal(activeDevelopers.length, 101);
});
