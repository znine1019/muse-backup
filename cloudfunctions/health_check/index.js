'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  if (!wxContext || !wxContext.OPENID) {
    return {
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: '无法获取可信微信身份。'
      }
    };
  }

  let databaseReady = false;

  try {
    await db.collection('system_config').limit(1).get();
    databaseReady = true;
  } catch (error) {
    databaseReady = false;
  }

  return {
    ok: true,
    data: {
      cloudFunctionReady: true,
      databaseReady,
      serverTime: new Date().toISOString()
    }
  };
};
