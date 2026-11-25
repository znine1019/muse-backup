'use strict';

const { COLLECTIONS, USER_STATUS } = require('./constants');
const { fail } = require('./errors');
const { deterministicId } = require('./repository');
const { getDocumentOrNull } = require('./transaction');

async function resolveRegistrationIdentity(repository, identity, profileType) {
  const existingUser =
    typeof repository.getUserByIdentity === 'function'
      ? await repository.getUserByIdentity(identity)
      : typeof repository.ensureUser === 'function'
        ? await repository.ensureUser(identity)
        : null;

  if (
    existingUser &&
    [USER_STATUS.DELETED, USER_STATUS.DISABLED].includes(existingUser.status)
  ) {
    fail(
      existingUser.status === USER_STATUS.DELETED
        ? 'ACCOUNT_DELETED'
        : 'ACCOUNT_DISABLED',
      existingUser.status === USER_STATUS.DELETED
        ? '账号已删除，无法继续访问。'
        : '账号已停用，无法提交注册资料。'
    );
  }

  return {
    existingUser,
    userId: existingUser
      ? existingUser._id
      : typeof repository.userIdForIdentity === 'function'
        ? repository.userIdForIdentity(identity)
        : deterministicId('usr', identity.appid || 'unknown-app', identity.openid),
    profileType
  };
}

async function getOrCreateRegistrationUser(
  repository,
  transaction,
  { userId, profileType }
) {
  const userReference = transaction.collection(COLLECTIONS.USERS).doc(userId);
  const currentUser = await getDocumentOrNull(userReference);

  if (currentUser) {
    if (currentUser.status === USER_STATUS.DELETED) {
      fail('ACCOUNT_DELETED', '账号已删除，无法继续访问。');
    }
    if (currentUser.status === USER_STATUS.DISABLED) {
      fail('ACCOUNT_DISABLED', '账号已停用，无法提交注册资料。');
    }
    return { user: currentUser, userReference, created: false };
  }

  const createdAt = repository.db.serverDate();
  const user = {
    _id: userId,
    status: USER_STATUS.PENDING_PROFILE,
    roles: [],
    pendingProfileType: profileType,
    createdAt,
    updatedAt: createdAt,
    schemaVersion: 1
  };
  await userReference.set({ data: user });
  return { user, userReference, created: true };
}

module.exports = {
  getOrCreateRegistrationUser,
  resolveRegistrationIdentity
};
