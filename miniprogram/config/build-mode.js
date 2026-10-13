'use strict';

/**
 * 构建模式标记（仅存在于 demo/showcase-v1 分支）
 *
 * DEMO 展示构建与正式项目共用同一套页面代码，但必须与正式云端完全隔离：
 *   1. 不初始化 wx.cloud（app.js 在 DEMO 构建下跳过 wx.cloud.init）；
 *   2. 不调用任何云函数（services/api.js 在 DEMO 构建下直接拒绝）；
 *   3. 不读取/写入正式 CloudBase 业务数据（仅在本地虚构数据上渲染）。
 *
 * 正式 main 分支不包含本文件，因此正式构建行为完全不受影响。
 */

const BUILD_MODE = 'demo-showcase';
const IS_DEMO_BUILD = true;

module.exports = {
  BUILD_MODE,
  IS_DEMO_BUILD
};
