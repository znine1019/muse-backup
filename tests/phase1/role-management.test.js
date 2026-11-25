'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createUserAdminActions = require('../../cloudfunctions/api/actions/users');
const { IDENTITY, createFakeRepository } = require('../phase8/helpers');

function createSetup(targetOverrides = {}, options = {}) {
  const repository = createFakeRepository();
  const developer = repository.seedStudent({
    _id: 'usr_developer',
    openid: 'openid_developer_0001',
    status: 'active',
    roles: ['developer']
  });
  repository.seedRoleBinding(developer._id, 'developer', 'active', {
    grantedBy: 'secure_bootstrap'
  });
  const target = repository.seedStudent({
    _id: 'usr_coach',
    openid: 'openid_coach',
    status: 'pending_profile',
    roles: [],
    ...targetOverrides
  });
  if (options.coachProfileApproved !== false) {
    repository.seedCoachProfile(target._id, {
      userId: target._id,
      name: '测试教练',
      reviewStatus: 'approved'
    });
  }
  repository.seedProfile(target._id, {
    userId: target._id,
    name: '测试学生',
    reviewStatus: 'approved'
  });
  const actions = createUserAdminActions({ repository });
  return { repository, developer, target, actions };
}

test('developer grants coach role and writes matching binding and audit', async () => {
  const { repository, target, actions } = createSetup();

  const result = await actions['admin.assign_role']({
    identity: IDENTITY('openid_developer_0001'),
    payload: {
      targetUserId: target._id,
      role: 'coach',
      grant: true
    }
  });

  assert.equal(result.status, 'active');
  assert.deepEqual(result.roles, ['coach']);
  const user = await repository.getUserById(target._id);
  assert.equal(user.status, 'active');
  assert.deepEqual(user.roles, ['coach']);
  const binding = repository
    .readCollection('role_bindings')
    .find((item) => item.userId === target._id && item.role === 'coach');
  assert.equal(binding.status, 'active');
  assert.equal(binding.grantedBy, 'usr_developer');
  const audit = repository
    .readCollection('audit_logs')
    .find((item) => item.action === 'admin.role.granted');
  assert.equal(audit.targetId, target._id);
  assert.deepEqual(audit.metadata, { role: 'coach' });
});

test('developer revokes coach role and records the revoked binding', async () => {
  const { repository, target, actions } = createSetup({
    status: 'active',
    roles: ['coach']
  });
  repository.seedRoleBinding(target._id, 'coach', 'active', {
    grantedBy: 'usr_developer'
  });

  const result = await actions['admin.assign_role']({
    identity: IDENTITY('openid_developer_0001'),
    payload: {
      targetUserId: target._id,
      role: 'coach',
      grant: false
    }
  });

  assert.equal(result.status, 'pending_profile');
  assert.deepEqual(result.roles, []);
  const binding = repository
    .readCollection('role_bindings')
    .find((item) => item.userId === target._id && item.role === 'coach');
  assert.equal(binding.status, 'revoked');
  const audit = repository
    .readCollection('audit_logs')
    .find((item) => item.action === 'admin.role.revoked');
  assert.equal(audit.targetId, target._id);
  assert.deepEqual(audit.metadata, { role: 'coach' });
});

test('coach cannot be granted without approved coach real-name profile', async () => {
  const { repository, target, actions } = createSetup(
    {
      status: 'pending_profile',
      roles: []
    },
    { coachProfileApproved: false }
  );

  await assert.rejects(
    actions['admin.assign_role']({
      identity: IDENTITY('openid_developer_0001'),
      payload: {
        targetUserId: target._id,
        role: 'coach',
        grant: true
      }
    }),
    (error) => error.code === 'COACH_REGISTRATION_APPROVAL_REQUIRED'
  );
  assert.deepEqual((await repository.getUserById(target._id)).roles, []);
  assert.equal(
    repository
      .readCollection('role_bindings')
      .filter((item) => item.userId === target._id && item.role === 'coach').length,
    0
  );
  assert.equal(repository.readCollection('audit_logs').length, 0);
});

test('repeating an unchanged coach grant is idempotent and writes no duplicate audit', async () => {
  const { repository, target, actions } = createSetup({
    status: 'active',
    roles: ['coach']
  });
  repository.seedRoleBinding(target._id, 'coach', 'active', {
    grantedBy: 'usr_developer'
  });

  const result = await actions['admin.assign_role']({
    identity: IDENTITY('openid_developer_0001'),
    payload: {
      targetUserId: target._id,
      role: 'coach',
      grant: true
    }
  });

  assert.equal(result.duplicate, true);
  assert.equal(repository.readCollection('audit_logs').length, 0);
});
