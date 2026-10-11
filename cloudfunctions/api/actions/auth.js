'use strict';

const crypto = require('crypto');
const {
  AUDIT_ACTIONS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { buildSession, loadUser } = require('../lib/session');
const { requiredString } = require('../lib/validation');

function secureStringEqual(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string' || expected.length < 16) {
    return false;
  }
  const inputDigest = crypto.createHash('sha256').update(input).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(inputDigest, expectedDigest);
}

function createAuthActions({ repository }) {
  async function login({ identity }) {
    const user = await loadUser(repository, identity);
    return { session: buildSession(user) };
  }

  async function bootstrap({ identity, payload }) {
    const bootstrapCode = requiredString(payload.bootstrapCode, '初始化码', 128);
    const expectedCode = process.env.BOOTSTRAP_ADMIN_CODE || '';

    if (!expectedCode || expectedCode.length < 16) {
      fail('BOOTSTRAP_DISABLED', '开发者初始化功能暂未启用。');
    }
    if (!secureStringEqual(bootstrapCode, expectedCode)) {
      fail('BOOTSTRAP_REJECTED', '初始化码不正确。');
    }

    const existingConfig = await repository.getSystemConfig('bootstrap');
    if (existingConfig && existingConfig.developerInitialized === true) {
      fail('BOOTSTRAP_COMPLETED', '开发者账号已经完成初始化。');
    }

    const existingDevelopers = await repository.userCollection
      .where({ roles: ROLES.DEVELOPER })
      .limit(1)
      .get();
    if ((existingDevelopers.data || []).length > 0) {
      fail('BOOTSTRAP_COMPLETED', '开发者账号已经存在。');
    }

    const user = await loadUser(repository, identity);
    const roles = Array.from(new Set([...(user.roles || []), ROLES.DEVELOPER]));

    await repository.userCollection.doc(user._id).update({
      data: {
        status: USER_STATUS.ACTIVE,
        roles,
        updatedAt: repository.db.serverDate()
      }
    });
    await repository.setRoleBinding({
      userId: user._id,
      role: ROLES.DEVELOPER,
      grantedBy: 'secure_bootstrap',
      active: true
    });
    await repository.setSystemConfig('bootstrap', {
      developerInitialized: true,
      initializedBy: user._id,
      initializedAt: repository.db.serverDate()
    });
    await repository.writeAudit({
      actorUserId: user._id,
      action: AUDIT_ACTIONS.DEVELOPER_BOOTSTRAPPED,
      targetType: 'user',
      targetId: user._id,
      result: 'success',
      metadata: { method: 'one_time_bootstrap_code' }
    });

    const refreshed = await repository.getUserById(user._id);
    return { session: buildSession(refreshed) };
  }

  return {
    'auth.bootstrap': bootstrap,
    'auth.login': login
  };
}

module.exports = createAuthActions;
