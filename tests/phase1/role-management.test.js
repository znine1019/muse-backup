'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createUserAdminActions = require('../../cloudfunctions/api/actions/users');

const DEVELOPER = {
  _id: 'usr_developer',
  status: 'active',
  roles: ['developer']
};
const IDENTITY = {
  appid: 'wx_test_app',
  openid: 'openid_developer_0001'
};

function createRepository(targetUser) {
  const updates = [];
  const roleBindings = [];
  const audits = [];
  return {
    ensureUser: async () => DEVELOPER,
    getUserById: async () => ({ ...targetUser }),
    userCollection: {
      doc: (id) => ({
        async update({ data }) {
          updates.push({ id, data });
          return {};
        }
      })
    },
    setRoleBinding: async (payload) => {
      roleBindings.push(payload);
    },
    writeAudit: async (entry) => {
      audits.push(entry);
    },
    db: {
      serverDate: () => new Date()
    },
    getUpdates: () => updates,
    getRoleBindings: () => roleBindings,
    getAudits: () => audits
  };
}

test('developer grants coach role and writes matching binding and audit', async () => {
  const repository = createRepository({
    _id: 'usr_coach',
    status: 'pending_profile',
    roles: []
  });
  const actions = createUserAdminActions({ repository });

  const result = await actions['admin.assign_role']({
    identity: IDENTITY,
    payload: {
      targetUserId: 'usr_coach',
      role: 'coach',
      grant: true
    }
  });

  assert.equal(result.status, 'active');
  assert.deepEqual(result.roles, ['coach']);
  assert.equal(repository.getUpdates()[0].data.status, 'active');
  assert.deepEqual(repository.getRoleBindings()[0], {
    userId: 'usr_coach',
    role: 'coach',
    grantedBy: 'usr_developer',
    active: true
  });
  assert.equal(repository.getAudits()[0].action, 'admin.role.granted');
  assert.deepEqual(repository.getAudits()[0].metadata, { role: 'coach' });
});

test('developer revokes coach role and records the revoked binding', async () => {
  const repository = createRepository({
    _id: 'usr_coach',
    status: 'active',
    roles: ['coach']
  });
  const actions = createUserAdminActions({ repository });

  const result = await actions['admin.assign_role']({
    identity: IDENTITY,
    payload: {
      targetUserId: 'usr_coach',
      role: 'coach',
      grant: false
    }
  });

  assert.equal(result.status, 'pending_profile');
  assert.deepEqual(result.roles, []);
  assert.equal(repository.getRoleBindings()[0].active, false);
  assert.equal(repository.getAudits()[0].action, 'admin.role.revoked');
  assert.deepEqual(repository.getAudits()[0].metadata, { role: 'coach' });
});
