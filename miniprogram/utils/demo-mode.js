'use strict';

const ALLOWED_ENV_VERSIONS = Object.freeze(['develop', 'trial']);

function getEnvVersion() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getAccountInfoSync !== 'function') {
      return '';
    }
    const accountInfo = wx.getAccountInfoSync();
    return accountInfo &&
      accountInfo.miniProgram &&
      accountInfo.miniProgram.envVersion
      ? accountInfo.miniProgram.envVersion
      : '';
  } catch (error) {
    return '';
  }
}

function isDemoAllowed(envVersion) {
  const version = typeof envVersion === 'string' ? envVersion : getEnvVersion();
  return ALLOWED_ENV_VERSIONS.includes(version);
}

function isDemoRequest(options) {
  return Boolean(options && options.demo === '1');
}

module.exports = {
  ALLOWED_ENV_VERSIONS,
  getEnvVersion,
  isDemoAllowed,
  isDemoRequest
};
