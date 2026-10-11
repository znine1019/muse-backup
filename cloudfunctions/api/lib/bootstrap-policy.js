'use strict';

const crypto = require('crypto');
const { fail } = require('./errors');

function secureStringEqual(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string' || expected.length < 16) {
    return false;
  }
  const inputDigest = crypto.createHash('sha256').update(input).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(inputDigest, expectedDigest);
}

function parseAllowedOpenIds(value) {
  if (typeof value !== 'string') {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 16)
    )
  );
}

function secureOpenIdMatch(openid, allowedOpenIds) {
  if (typeof openid !== 'string' || !openid) {
    return false;
  }
  let matched = false;
  for (const allowedOpenId of allowedOpenIds) {
    matched = secureStringEqual(openid, allowedOpenId) || matched;
  }
  return matched;
}

function assertBootstrapAllowed({
  identity,
  providedCode,
  expectedCode,
  allowedOpenIds,
  config
}) {
  if (!config) {
    fail('BOOTSTRAP_NOT_READY', '开发者初始化配置尚未准备完成。');
  }

  const identityAllowed = secureOpenIdMatch(identity.openid, allowedOpenIds);
  const codeAllowed = secureStringEqual(providedCode, expectedCode);
  if (!identityAllowed || !codeAllowed) {
    fail('BOOTSTRAP_REJECTED', '初始化身份或初始化码校验失败。');
  }

  if (config.developerInitialized === true) {
    fail('BOOTSTRAP_COMPLETED', '开发者账号已经完成初始化。');
  }

  return true;
}

function buildCompletedConfig({ initializedBy, completedAt }) {
  return {
    developerInitialized: true,
    state: 'completed',
    initializedBy,
    initializedAt: completedAt
  };
}

module.exports = {
  assertBootstrapAllowed,
  buildCompletedConfig,
  parseAllowedOpenIds,
  secureStringEqual
};
