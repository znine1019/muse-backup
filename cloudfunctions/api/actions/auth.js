'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const {
  assertBootstrapAllowed,
  buildCompletedConfig,
  parseAllowedOpenIds
} = require('../lib/bootstrap-policy');
const { fail } = require('../lib/errors');
const { buildSession, loadUser } = require('../lib/session');
const { getDocumentOrNull } = require('../lib/transaction');
const { requiredString } = require('../lib/validation');

function createAuthActions({ repository }) {
  async function login({ identity }) {
    const user = await loadUser(repository, identity);
    return { session: buildSession(user) };
  }

  async function bootstrap({ identity, payload }) {
    const providedCode = requiredString(payload.bootstrapCode, '初始化码', 128);
    const expectedCode = process.env.BOOTSTRAP_ADMIN_CODE || '';
    const allowedOpenIds = parseAllowedOpenIds(
      process.env.BOOTSTRAP_ADMIN_OPENIDS || ''
    );

    if (!expectedCode || expectedCode.length < 16 || !allowedOpenIds.length) {
      fail('BOOTSTRAP_DISABLED', '开发者初始化功能暂未启用。');
    }

    const user = await loadUser(repository, identity);
    const existingDevelopers = await repository.userCollection
      .where({ roles: ROLES.DEVELOPER })
      .limit(1)
      .get();
    if ((existingDevelopers.data || []).length > 0) {
      fail('BOOTSTRAP_COMPLETED', '开发者账号已经存在。');
    }

    const result = await repository.db.runTransaction(async (transaction) => {
      const configReference = transaction
        .collection(COLLECTIONS.SYSTEM_CONFIG)
        .doc('bootstrap');
      const config = await getDocumentOrNull(configReference);
      assertBootstrapAllowed({
        identity,
        providedCode,
        expectedCode,
        allowedOpenIds,
        config
      });

      const userReference = transaction
        .collection(COLLECTIONS.USERS)
        .doc(user._id);
      const currentUser = await getDocumentOrNull(userReference);
      if (!currentUser) {
        fail('USER_NOT_FOUND', '当前用户账号不存在。');
      }

      const roles = Array.from(
        new Set([...(currentUser.roles || []), ROLES.DEVELOPER])
      );
      const completedAt = repository.db.serverDate();
      await configReference.update({
        data: buildCompletedConfig({
          initializedBy: currentUser._id,
          completedAt
        })
      });
      await userReference.update({
        data: {
          status: USER_STATUS.ACTIVE,
          roles,
          updatedAt: repository.db.serverDate()
        }
      });
      await transaction
        .collection(COLLECTIONS.ROLE_BINDINGS)
        .doc(repository.roleBindingId(currentUser._id, ROLES.DEVELOPER))
        .set({
          data: {
            userId: currentUser._id,
            role: ROLES.DEVELOPER,
            status: 'active',
            grantedBy: 'secure_bootstrap',
            grantedAt: repository.db.serverDate(),
            updatedAt: repository.db.serverDate()
          }
        });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_bootstrap_${currentUser._id}`)
        .set({
          data: {
            actorUserId: currentUser._id,
            action: AUDIT_ACTIONS.DEVELOPER_BOOTSTRAPPED,
            targetType: 'user',
            targetId: currentUser._id,
            result: 'success',
            metadata: { method: 'preauthorized_openid_and_one_time_code' },
            createdAt: repository.db.serverDate()
          }
        });

      return {
        _id: currentUser._id,
        status: USER_STATUS.ACTIVE,
        roles
      };
    });

    return { session: buildSession(result) };
  }

  return {
    'auth.bootstrap': bootstrap,
    'auth.login': login
  };
}

module.exports = createAuthActions;
