'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createGroupAdminActions = require('../../cloudfunctions/api/actions/groups');
const { AUDIT_ACTIONS } = require('../../cloudfunctions/api/lib/constants');
const { IDENTITY, createConcurrentRepository } = require('./helpers');

function createHarness() {
  const repository = createConcurrentRepository();
  const developer = repository.seedStudent({
    _id: 'usr_def005_dev',
    openid: 'openid_def005_dev',
    status: 'active',
    roles: ['developer'],
    createdAt: new Date('2026-10-01T00:00:00Z')
  });
  repository.seedRoleBinding(developer._id, 'developer', 'active', {
    grantedBy: 'secure_bootstrap'
  });
  const group = repository.seedRecord('training_groups', {
    _id: 'group_def005_target',
    groupId: 'group_def005_target',
    name: '并发删除测试组',
    seasonLabel: '2026秋',
    enabled: true,
    createdBy: developer._id
  });
  const actions = createGroupAdminActions({ repository });
  return { repository, developer, group, actions };
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

function deleteGroupPayload(groupId) {
  return {
    trainingGroupId: groupId,
    confirmationText: 'DELETE_TRAINING_GROUP'
  };
}

function groupDeletionAudits(repository, groupId) {
  return repository
    .readCollection('audit_logs')
    .filter(
      (entry) =>
        entry.action === AUDIT_ACTIONS.GROUP_DELETED &&
        entry.targetId === groupId
    );
}

test('DEF-005 事务外检查通过后并发插入 group_memberships 时删除必须失败且不归档不写审计', async () => {
  const { repository, developer, group, actions } = createHarness();
  const hook = pauseNextTransaction(repository);

  try {
    const deletion = actions['admin.delete_training_group']({
      identity: IDENTITY(developer.openid),
      payload: deleteGroupPayload(group._id)
    });
    await hook.entered;
    repository.seedRecord('group_memberships', {
      _id: 'gm_def005_race',
      groupId: group._id,
      userId: 'usr_def005_student',
      roleInGroup: 'student',
      status: 'active'
    });
    hook.release();
    await assert.rejects(
      deletion,
      (error) => error.code === 'TRAINING_GROUP_HAS_ASSOCIATIONS'
    );
  } finally {
    hook.restore();
  }

  const storedGroup = repository
    .readCollection('training_groups')
    .find((entry) => entry._id === group._id);
  assert.equal(storedGroup.enabled, true);
  assert.notEqual(storedGroup.status, 'deleted');
  assert.equal(storedGroup.deletedAt, undefined);
  assert.equal(groupDeletionAudits(repository, group._id).length, 0);
});

test('DEF-005 事务外检查通过后并发插入 training_feedback 时删除必须失败且不归档不写审计', async () => {
  const { repository, developer, group, actions } = createHarness();
  const hook = pauseNextTransaction(repository);

  try {
    const deletion = actions['admin.delete_training_group']({
      identity: IDENTITY(developer.openid),
      payload: deleteGroupPayload(group._id)
    });
    await hook.entered;
    repository.seedRecord('training_feedback', {
      _id: 'fb_def005_race',
      trainingGroupId: group._id,
      studentUserId: 'usr_def005_student',
      sessionId: 'sess_def005_fictional',
      completionStatus: 'completed',
      rpe: 6
    });
    hook.release();
    await assert.rejects(
      deletion,
      (error) => error.code === 'TRAINING_GROUP_HAS_ASSOCIATIONS'
    );
  } finally {
    hook.restore();
  }

  const storedGroup = repository
    .readCollection('training_groups')
    .find((entry) => entry._id === group._id);
  assert.equal(storedGroup.enabled, true);
  assert.notEqual(storedGroup.status, 'deleted');
  assert.equal(storedGroup.deletedAt, undefined);
  assert.equal(groupDeletionAudits(repository, group._id).length, 0);
});

test('DEF-005 无任何关联时删除成功归档并写1条审计且重复删除幂等', async () => {
  const { repository, developer, group, actions } = createHarness();

  const first = await actions['admin.delete_training_group']({
    identity: IDENTITY(developer.openid),
    payload: deleteGroupPayload(group._id)
  });
  assert.equal(first.trainingGroupId, group._id);
  assert.equal(first.status, 'deleted');
  assert.equal(first.alreadyDeleted, false);
  assert.ok(repository.counters.lastTransactionOperations <= 20);
  assert.equal(repository.counters.lastTransactionOperations, 15);

  const storedGroup = repository
    .readCollection('training_groups')
    .find((entry) => entry._id === group._id);
  assert.equal(storedGroup.status, 'deleted');
  assert.equal(storedGroup.enabled, false);
  assert.equal(groupDeletionAudits(repository, group._id).length, 1);

  const second = await actions['admin.delete_training_group']({
    identity: IDENTITY(developer.openid),
    payload: deleteGroupPayload(group._id)
  });
  assert.equal(second.trainingGroupId, group._id);
  assert.equal(second.alreadyDeleted, true);
  assert.equal(groupDeletionAudits(repository, group._id).length, 1);
});
