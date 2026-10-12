'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createGroupAdminActions = require('../../cloudfunctions/api/actions/groups');
const { deterministicId } = require('../../cloudfunctions/api/lib/repository');

const DEVELOPER = {
  _id: 'usr_developer',
  status: 'active',
  roles: ['developer']
};
const IDENTITY = {
  appid: 'wx_test_app',
  openid: 'openid_developer_0001'
};

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to be rejected');
}

function createRepository(initialGroup, overrides = {}) {
  let group = initialGroup ? { ...initialGroup } : null;
  const updates = [];
  const writes = [];
  const audits = [];
  const repository = {
    ensureUser: async () => DEVELOPER,
    getTrainingGroup: async () => (group ? { ...group } : null),
    getUserById: async () => null,
    groupCollection: {
      doc: (id) => ({
        async set({ data }) {
          writes.push({ type: 'set', id, data });
          group = { _id: id, ...data };
          return {};
        },
        async update({ data }) {
          updates.push({ id, data });
          group = { ...group, ...data };
          return {};
        }
      })
    },
    setGroupMembership: async (payload) => {
      writes.push({ type: 'membership', payload });
    },
    writeAudit: async (entry) => {
      audits.push(entry);
    },
    db: {
      command: {
        in: (values) => ({ operator: 'in', values })
      },
      serverDate: () => new Date()
    }
  };

  return Object.assign(repository, overrides, {
    getUpdates: () => updates,
    getWrites: () => writes,
    getAudits: () => audits,
    getGroup: () => ({ ...group })
  });
}

test('developer can disable and re-enable a training group with audit records', async () => {
  const repository = createRepository({
    _id: 'group_a',
    groupId: 'group_a',
    name: '模拟短跑组',
    seasonLabel: '2026测试周期',
    enabled: true
  });
  const actions = createGroupAdminActions({ repository });

  const disabled = await actions['admin.set_training_group_enabled']({
    identity: IDENTITY,
    payload: { trainingGroupId: 'group_a', enabled: false }
  });
  assert.equal(disabled.group.enabled, false);
  assert.equal(repository.getGroup().enabled, false);

  const enabled = await actions['admin.set_training_group_enabled']({
    identity: IDENTITY,
    payload: { trainingGroupId: 'group_a', enabled: true }
  });
  assert.equal(enabled.group.enabled, true);

  assert.deepEqual(
    repository.getAudits().map((entry) => entry.metadata.enabled),
    [false, true]
  );
  assert.equal(
    repository.getAudits().every(
      (entry) => entry.action === 'admin.training_group.status_changed'
    ),
    true
  );
});

test('setting the same training group status is idempotent', async () => {
  const repository = createRepository({
    _id: 'group_a',
    groupId: 'group_a',
    name: '模拟短跑组',
    seasonLabel: '2026测试周期',
    enabled: false
  });
  const actions = createGroupAdminActions({ repository });

  const result = await actions['admin.set_training_group_enabled']({
    identity: IDENTITY,
    payload: { trainingGroupId: 'group_a', enabled: false }
  });

  assert.equal(result.group.enabled, false);
  assert.equal(repository.getUpdates().length, 0);
  assert.equal(repository.getAudits().length, 0);
});

test('missing training group status update is rejected', async () => {
  const repository = createRepository(null);
  const actions = createGroupAdminActions({ repository });

  const error = await captureError(
    actions['admin.set_training_group_enabled']({
      identity: IDENTITY,
      payload: { trainingGroupId: 'group_missing', enabled: false }
    })
  );

  assert.equal(error.code, 'TRAINING_GROUP_NOT_FOUND');
  assert.equal(repository.getUpdates().length, 0);
  assert.equal(repository.getAudits().length, 0);
});

test('developer creates a training group once and writes creation audit', async () => {
  const repository = createRepository(null);
  const actions = createGroupAdminActions({ repository });

  const result = await actions['admin.create_training_group']({
    identity: IDENTITY,
    payload: { name: '模拟短跑组', seasonLabel: '2026测试周期' }
  });

  assert.equal(result.group.name, '模拟短跑组');
  assert.equal(result.group.enabled, true);
  assert.equal(repository.getWrites().length, 1);
  const expectedGroupId = deterministicId(
    'group',
    '模拟短跑组'.toLowerCase(),
    '2026测试周期'.toLowerCase()
  );
  assert.equal(result.group.id, expectedGroupId);
  assert.equal(repository.getWrites()[0].id, expectedGroupId);
  assert.equal(repository.getWrites()[0].data.groupId, expectedGroupId);
  assert.equal(
    Object.prototype.hasOwnProperty.call(repository.getWrites()[0].data, '_id'),
    false
  );
  assert.equal(repository.getAudits().length, 1);
  assert.equal(repository.getAudits()[0].action, 'admin.training_group.created');
  assert.equal(repository.getAudits()[0].result, 'success');
});

test('training group write failure stops creation audit', async () => {
  const repository = createRepository(null, {
    groupCollection: {
      doc: () => ({
        async set() {
          throw new Error('simulated training group write failure');
        }
      })
    }
  });
  const actions = createGroupAdminActions({ repository });

  await assert.rejects(
    actions['admin.create_training_group']({
      identity: IDENTITY,
      payload: { name: '模拟短跑组', seasonLabel: '2026测试周期' }
    }),
    /simulated training group write failure/
  );
  assert.equal(repository.getAudits().length, 0);
});

test('duplicate training group creation is idempotent', async () => {
  const repository = createRepository({
    _id: 'group_existing',
    groupId: 'group_existing',
    name: '模拟短跑组',
    seasonLabel: '2026测试周期',
    enabled: true
  });
  const actions = createGroupAdminActions({ repository });

  const result = await actions['admin.create_training_group']({
    identity: IDENTITY,
    payload: { name: '模拟短跑组', seasonLabel: '2026测试周期' }
  });

  assert.equal(result.group.id, 'group_existing');
  assert.equal(repository.getWrites().length, 0);
  assert.equal(repository.getAudits().length, 0);
});

test('developer assigns and removes a coach membership with audit', async () => {
  const repository = createRepository(
    {
      _id: 'group_a',
      groupId: 'group_a',
      name: '模拟短跑组',
      seasonLabel: '2026测试周期',
      enabled: true
    },
    {
      getUserById: async () => ({
        _id: 'usr_coach',
        status: 'active',
        roles: ['coach']
      })
    }
  );
  const actions = createGroupAdminActions({ repository });

  const removed = await actions['admin.set_group_coach']({
    identity: IDENTITY,
    payload: {
      coachUserId: 'usr_coach',
      trainingGroupId: 'group_a',
      active: false
    }
  });

  assert.equal(removed.active, false);
  assert.equal(repository.getWrites()[0].type, 'membership');
  assert.equal(repository.getWrites()[0].payload.active, false);
  assert.equal(
    repository.getAudits()[0].action,
    'admin.training_group.coach_assigned'
  );
  assert.equal(repository.getAudits()[0].metadata.active, false);
});
