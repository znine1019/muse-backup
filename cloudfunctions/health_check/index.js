'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
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
