'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createAuthActions = require('../../cloudfunctions/api/actions/auth');

const PRIMARY_OPENID = 'openid_primary_admin_0001';
const CODE = 'bootstrap-code-1234567890';
const USER_ID = 'usr_primary_admin';

function clone(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)])
    );
  }
  return value;
}

function cloneState(state) {
  return {
    config: clone(state.config),
    users: clone(state.users),
    roleBindings: clone(state.roleBindings),
    auditLogs: clone(state.auditLogs)
  };
}

function replaceState(target, source) {
  target.config = source.config;
  target.users = source.users;
  target.roleBindings = source.roleBindings;
  target.auditLogs = source.auditLogs;
}

function collectionState(state, collectionName) {
  if (collectionName === 'system_config') {
    return { get: () => state.config, set: (id, value) => (state.config = value) };
  }
  if (collectionName === 'users') {
    return {
      get: (id) => state.users.find((item) => item._id === id) || null,
      set: (id, value) => {
        const index = state.users.findIndex((item) => item._id === id);
        if (index >= 0) {
          state.users[index] = value;
        } else {
          state.users.push({ _id: id, ...value });
        }
      }
    };
  }
  if (collectionName === 'role_bindings') {
    return {
      get: (id) => state.roleBindings[id] || null,
      set: (id, value) => (state.roleBindings[id] = { _id: id, ...value })
    };
  }
  if (collectionName === 'audit_logs') {
    return {
      get: (id) => state.auditLogs[id] || null,
      set: (id, value) => (state.auditLogs[id] = { _id: id, ...value })
    };
  }
  throw new Error(`Unexpected collection: ${collectionName}`);
}

function createMemoryRepository(options = {}) {
  let state = {
    config: options.config || { developerInitialized: false, state: 'ready' },
    users: clone(
      options.users || [
        {
          _id: USER_ID,
          _openid: PRIMARY_OPENID,
          status: 'pending_profile',
          roles: []
        }
      ]
    ),
    roleBindings: {},
    auditLogs: {}
  };
  const writes = [];
  const counts = {
    runTransaction: 0,
    serverDate: 0
  };

  function createFailure() {
    const error = new Error(
      'raw failure message must not appear in bootstrap diagnostics'
    );
    error.name = 'DatabaseTransactionError';
    error.code = 'DATABASE_TEST_FAILURE';
    error.errCode = '-502001';
    return error;
  }

  function createReference(draft, collectionName, id) {
    const collection = collectionState(draft, collectionName);
    return {
      async get() {
        const document = collection.get(id);
        if (!document) {
          throw new Error('document not found');
        }
        return { data: clone(document) };
      },
      async update({ data }) {
        if (
          options.failOn === `${collectionName}_update` ||
          options.failOn === `${collectionName}_update:${id}`
        ) {
          throw createFailure();
        }
        const current = collection.get(id);
        if (!current) {
          throw new Error('document not found');
        }
        const next = { ...current, ...clone(data) };
        writes.push({
          type: 'update',
          collection: collectionName,
          id,
          payload: clone({ data })
        });
        collection.set(id, next);
      },
      async set({ data }) {
        if (
          options.failOn === `${collectionName}_set` ||
          options.failOn === `${collectionName}_set:${id}`
        ) {
          throw createFailure();
        }
        writes.push({
          type: 'set',
          collection: collectionName,
          id,
          payload: clone({ data })
        });
        collection.set(id, clone(data));
      }
    };
  }

  const repository = {
    ensureUser: async () => clone(state.users[0]),
    roleBindingId: (userId, role) => `role_${role}_${userId}`,
    userCollection: {
      where: () => ({
        limit: () => ({
          get: async () => ({
            data: state.users
              .filter((user) => (user.roles || []).includes('developer'))
              .slice(0, 1)
          })
        })
      })
    },
    db: {
      async runTransaction(work) {
        counts.runTransaction += 1;
        const draft = cloneState(state);
        const transaction = {
          collection(collectionName) {
            return {
              doc(id) {
                return createReference(draft, collectionName, id);
              }
            };
          }
        };
        const result = await work(transaction);
        replaceState(state, draft);
        return result;
      },
      serverDate() {
        counts.serverDate += 1;
        throw new Error('serverDate must not be used by bootstrap transaction');
      }
    }
  };

  return {
    repository,
    counts,
    writes,
    snapshot: () => cloneState(state)
  };
}

function installBootstrapEnvironment(t) {
  const previousCode = process.env.BOOTSTRAP_ADMIN_CODE;
  const previousOpenIds = process.env.BOOTSTRAP_ADMIN_OPENIDS;
  process.env.BOOTSTRAP_ADMIN_CODE = CODE;
  process.env.BOOTSTRAP_ADMIN_OPENIDS = PRIMARY_OPENID;

  t.after(() => {
    if (previousCode === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_CODE;
    } else {
      process.env.BOOTSTRAP_ADMIN_CODE = previousCode;
    }
    if (previousOpenIds === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_OPENIDS;
    } else {
      process.env.BOOTSTRAP_ADMIN_OPENIDS = previousOpenIds;
    }
  });
}

function bootstrap(actions) {
  return actions['auth.bootstrap']({
    identity: { appid: 'wx-test-app', openid: PRIMARY_OPENID },
    payload: { bootstrapCode: CODE }
  });
}

test('pending user bootstrap commits developer role and unified Date timestamps', async (t) => {
  installBootstrapEnvironment(t);
  const memory = createMemoryRepository();
  const actions = createAuthActions({ repository: memory.repository });

  const result = await bootstrap(actions);
  const state = memory.snapshot();

  assert.equal(result.session.user.status, 'active');
  assert.deepEqual(result.session.user.roles, ['developer']);
  assert.equal(state.config.developerInitialized, true);
  assert.equal(state.config.state, 'completed');
  assert.equal(state.users[0].status, 'active');
  assert.deepEqual(state.users[0].roles, ['developer']);
  assert.equal(state.roleBindings[`role_developer_${USER_ID}`].role, 'developer');
  assert.equal(
    state.auditLogs[`audit_bootstrap_${USER_ID}`].action,
    'auth.bootstrap.developer_created'
  );
  assert.equal(memory.counts.serverDate, 0);
});

test('all bootstrap timestamps use one ordinary Date and serialize safely', async (t) => {
  installBootstrapEnvironment(t);
  const memory = createMemoryRepository();
  const actions = createAuthActions({ repository: memory.repository });

  await bootstrap(actions);

  const configWrite = memory.writes.find(
    (write) => write.collection === 'system_config' && write.type === 'update'
  );
  const userWrite = memory.writes.find(
    (write) => write.collection === 'users' && write.type === 'update'
  );
  const roleWrite = memory.writes.find(
    (write) => write.collection === 'role_bindings' && write.type === 'set'
  );
  const auditWrite = memory.writes.find(
    (write) => write.collection === 'audit_logs' && write.type === 'set'
  );

  assert.ok(configWrite);
  assert.ok(userWrite);
  assert.ok(roleWrite);
  assert.ok(auditWrite);
  assert.equal(
    Object.prototype.hasOwnProperty.call(configWrite.payload, 'updatedAt'),
    false
  );

  const timestamps = [
    configWrite.payload.data.initializedAt,
    configWrite.payload.data.updatedAt,
    userWrite.payload.data.updatedAt,
    roleWrite.payload.data.grantedAt,
    roleWrite.payload.data.updatedAt,
    auditWrite.payload.data.createdAt
  ];

  assert.ok(timestamps.every((value) => value instanceof Date));
  assert.equal(
    timestamps.every((value) => value.getTime() === timestamps[0].getTime()),
    true
  );
  assert.equal(
    typeof JSON.parse(JSON.stringify(configWrite.payload.data.updatedAt)),
    'string'
  );
});

test('bootstrap transaction failure leaves no partial database state', async (t) => {
  installBootstrapEnvironment(t);
  const memory = createMemoryRepository({ failOn: 'audit_logs_set' });
  const before = memory.snapshot();
  const actions = createAuthActions({ repository: memory.repository });
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  t.after(() => {
    console.error = originalError;
  });

  await assert.rejects(bootstrap(actions), /raw failure message/);
  assert.deepEqual(memory.snapshot(), before);
  assert.equal(memory.counts.runTransaction, 1);
  assert.equal(memory.counts.serverDate, 0);

  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[api][bootstrap]');
  assert.deepEqual(Object.keys(logs[0][1]).sort(), [
    'category',
    'errCode',
    'errorCode',
    'errorName',
    'stage'
  ]);
  assert.deepEqual(logs[0][1], {
    stage: 'transaction_write_audit',
    errorName: 'DatabaseTransactionError',
    errorCode: 'DATABASE_TEST_FAILURE',
    errCode: '-502001',
    category: 'unexpected_bootstrap_error'
  });

  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes(PRIMARY_OPENID), false);
  assert.equal(serializedLogs.includes(CODE), false);
  assert.equal(serializedLogs.includes('raw failure message'), false);
});

test('existing developer rejects bootstrap before a transaction starts', async (t) => {
  installBootstrapEnvironment(t);
  const memory = createMemoryRepository({
    users: [
      {
        _id: USER_ID,
        _openid: PRIMARY_OPENID,
        status: 'active',
        roles: ['developer']
      }
    ]
  });
  const actions = createAuthActions({ repository: memory.repository });
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  t.after(() => {
    console.error = originalError;
  });

  await assert.rejects(
    bootstrap(actions),
    (error) => error && error.code === 'BOOTSTRAP_COMPLETED'
  );
  assert.equal(memory.counts.runTransaction, 0);
  assert.equal(logs.length, 0);
});
