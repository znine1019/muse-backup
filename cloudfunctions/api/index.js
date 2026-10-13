'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const { createRepository } = require('./lib/repository');
const { fail, toPublicError } = require('./lib/errors');
const createAuthActions = require('./actions/auth');
const createAttendanceActions = require('./actions/attendance');
const createCompetitionActions = require('./actions/competitions');
const createDirectoryActions = require('./actions/directory');
const createFeedbackActions = require('./actions/feedback');
const createGroupAdminActions = require('./actions/groups');
const createNoticeActions = require('./actions/notices');
const createProfileActions = require('./actions/profile');
const createPerformanceActions = require('./actions/performance');
const createPlanActions = require('./actions/plans');
const createRegistrationActions = require('./actions/registrations');
const createReportActions = require('./actions/report');
const createStatisticsActions = require('./actions/statistics');
const createUserAdminActions = require('./actions/users');

const repository = createRepository(db);
const actions = Object.freeze({
  ...createAuthActions({ repository }),
  ...createAttendanceActions({ repository }),
  ...createCompetitionActions({ repository }),
  ...createDirectoryActions({ repository }),
  ...createFeedbackActions({ repository }),
  ...createProfileActions({ repository }),
  ...createNoticeActions({ repository }),
  ...createPerformanceActions({ repository }),
  ...createPlanActions({ repository }),
  ...createRegistrationActions({ repository }),
  ...createReportActions({ repository }),
  ...createStatisticsActions({ repository }),
  ...createUserAdminActions({ repository }),
  ...createGroupAdminActions({ repository })
});

function getTrustedIdentity() {
  const wxContext = cloud.getWXContext();
  if (!wxContext || !wxContext.OPENID) {
    fail('UNAUTHENTICATED', '无法获取可信微信身份，请重新登录。');
  }
  return {
    appid: wxContext.APPID || '',
    openid: wxContext.OPENID,
    unionid: wxContext.UNIONID || ''
  };
}

exports.main = async (event, context) => {
  try {
    const action = event && event.action;
    if (typeof action !== 'string' || !actions[action]) {
      fail('INVALID_ACTION', '请求的功能不存在。');
    }

    const identity = getTrustedIdentity();
    const payload =
      event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? event.payload
        : {};
    const data = await actions[action]({ identity, payload, context: context || {} });

    return {
      ok: true,
      data
    };
  } catch (error) {
    const publicError = toPublicError(error);
    console.error('[api]', publicError.code);
    return {
      ok: false,
      error: publicError
    };
  }
};
