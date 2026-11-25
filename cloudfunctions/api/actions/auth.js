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
const { AppError, fail } = require('../lib/errors');
const {
  buildSession,
  buildUnregisteredSession,
  getUserByIdentity,
  loadUser
} = require('../lib/session');
const { getDocumentOrNull } = require('../lib/transaction');

const BOOTSTRAP_LOG_TAG = '[api][bootstrap]';
const BOOTSTRAP_ERROR_CATEGORY = 'unexpected_bootstrap_error';

function safeDiagnosticValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }
  return String(value).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80);
}

function logBootstrapFailure(stage, error) {
  console.error(BOOTSTRAP_LOG_TAG, {
    stage,
    errorName: safeDiagnosticValue(error && error.name) || 'Error',
    errorCode: safeDiagnosticValue(error && error.code),
    errCode: safeDiagnosticValue(error && error.errCode),
    category: BOOTSTRAP_ERROR_CATEGORY
  });
}

function isAppError(error) {
  return error instanceof AppError || (error && error.name === 'AppError');
}

function requiredBootstrapCode(value) {
  if (typeof value !== 'string') {
    fail('INVALID_FIELD', '初始化码格式不正确。');
  }
  const normalized = value.trim();
  if (!normalized) {
    fail('INVALID_FIELD', '请填写初始化码。');
  }
  if (normalized.length > 128) {
    fail('INVALID_FIELD', '初始化码不能超过128个字符。');
  }
  return normalized;
}

function createAuthActions({ repository }) {
  async function login({ identity }) {
    const user = await getUserByIdentity(repository, identity);
    if (!user) {
      return {
        session: buildUnregisteredSession(),
        registered: false
      };
    }
    if (user.status === USER_STATUS.DELETED) {
      fail('ACCOUNT_DELETED', '账号已删除，无法继续访问。');
    }
    return { session: buildSession(user) };
  }

  async function bootstrap({ identity, payload }) {
    let stage = 'validate_request';
    try {
      const providedCode = requiredBootstrapCode(payload.bootstrapCode);
      const expectedCode = process.env.BOOTSTRAP_ADMIN_CODE || '';
      const allowedOpenIds = parseAllowedOpenIds(
        process.env.BOOTSTRAP_ADMIN_OPENIDS || ''
      );

      if (!expectedCode || expectedCode.length < 16 || !allowedOpenIds.length) {
        fail('BOOTSTRAP_DISABLED', '开发者初始化功能暂未启用。');
      }

      stage = 'load_user';
      const user = await loadUser(repository, identity);
      stage = 'check_existing_developers';
      const existingDevelopers = await repository.userCollection
        .where({ roles: ROLES.DEVELOPER })
        .limit(1)
        .get();
      if ((existingDevelopers.data || []).length > 0) {
        fail('BOOTSTRAP_COMPLETED', '开发者账号已经存在。');
      }

      stage = 'start_transaction';
      const result = await repository.db.runTransaction(async (transaction) => {
        stage = 'transaction_load_config';
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

        stage = 'transaction_load_user';
        const userReference = transaction
          .collection(COLLECTIONS.USERS)
          .doc(user._id);
        const currentUser = await getDocumentOrNull(userReference);
        if (!currentUser) {
          fail('USER_NOT_FOUND', '当前用户账号不存在。');
        }

        stage = 'transaction_build_updates';
        const roles = Array.from(
          new Set([...(currentUser.roles || []), ROLES.DEVELOPER])
        );
        const completedAt = new Date();

        stage = 'transaction_update_config';
        await configReference.update({
          data: {
            ...buildCompletedConfig({
              initializedBy: currentUser._id,
              completedAt
            }),
            updatedAt: completedAt
          }
        });

        stage = 'transaction_update_user';
        await userReference.update({
          data: {
            status: USER_STATUS.ACTIVE,
            roles,
            updatedAt: completedAt
          }
        });

        stage = 'transaction_create_role_binding';
        await transaction
          .collection(COLLECTIONS.ROLE_BINDINGS)
          .doc(repository.roleBindingId(currentUser._id, ROLES.DEVELOPER))
          .set({
            data: {
              userId: currentUser._id,
              role: ROLES.DEVELOPER,
              status: 'active',
              grantedBy: 'secure_bootstrap',
              grantedAt: completedAt,
              updatedAt: completedAt
            }
          });

        stage = 'transaction_write_audit';
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
              createdAt: completedAt
            }
          });

        stage = 'transaction_complete';
        return {
          _id: currentUser._id,
          status: USER_STATUS.ACTIVE,
          roles
        };
      });

      return { session: buildSession(result) };
    } catch (error) {
      if (!isAppError(error)) {
        logBootstrapFailure(stage, error);
      }
      throw error;
    }
  }

  return {
    'auth.bootstrap': bootstrap,
    'auth.login': login
  };
}

module.exports = createAuthActions;
