'use strict';

/**
 * F1-D2b｜四角色工作台账户与安全区域回归测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PAGES = ['student', 'coach', 'parent', 'admin'];

function read(page, extension) {
  return fs.readFileSync(
    path.join(PROJECT_ROOT, `miniprogram/pages/${page}/${page}.${extension}`),
    'utf8'
  );
}

function handlerNames(wxml) {
  return [...wxml.matchAll(/(?:bindtap|bindinput|bindchange|bindsubmit|catchtap)="([A-Za-z0-9_]+)"/g)].map(
    (match) => match[1]
  );
}

test('F1-D2b 四个工作台均有独立账户与安全区域', () => {
  for (const page of PAGES) {
    const wxml = read(page, 'wxml');
    const headingIndex = wxml.indexOf('账户与安全');
    const logoutIndex = wxml.indexOf('bindtap="goHome"');
    assert.ok(headingIndex > 0, `${page} 应存在账户与安全区域`);
    assert.ok(logoutIndex > headingIndex, `${page} 退出入口应位于账户与安全区域内`);
    assert.equal(
      (wxml.match(/bindtap="goHome"/g) || []).length,
      1,
      `${page} 应只有一个退出当前会话入口`
    );
  }
});

test('F1-D2b 退出入口不再位于普通业务列表中', () => {
  const sectionMarkers = {
    student: ['常用功能', '更多功能', '账户与安全'],
    coach: ['常用管理入口', '账户与安全'],
    parent: ['个人中心', '账户与安全'],
    admin: ['全局管理入口', '账户与安全']
  };

  for (const page of PAGES) {
    const wxml = read(page, 'wxml');
    const logoutIndex = wxml.indexOf('bindtap="goHome"');
    const accountIndex = wxml.indexOf('账户与安全');
    const businessIndex = wxml.indexOf(sectionMarkers[page][0]);

    assert.ok(businessIndex >= 0, `${page} 应保留原业务区`);
    assert.ok(accountIndex > businessIndex, `${page} 账户区应位于业务区之后`);
    assert.ok(logoutIndex > accountIndex, `${page} 退出入口应位于账户区内部`);

    const businessListEnd = wxml.indexOf('</view>', accountIndex);
    assert.ok(businessListEnd > accountIndex, `${page} 账户区结构应完整`);
  }
});

test('F1-D2b 四个工作台原有退出事件绑定保留', () => {
  for (const page of PAGES) {
    const wxml = read(page, 'wxml');
    const js = read(page, 'js');
    assert.match(wxml, /bindtap="goHome"/, `${page} 应保留 goHome 绑定`);
    assert.match(js, /goHome\s*\(\)/, `${page} 应保留 goHome 处理器`);
  }
});

test('F1-D2b 学生业务入口不减少', () => {
  const handlers = handlerNames(read('student', 'wxml'));
  for (const handler of [
    'goPlans',
    'goAttendance',
    'goPerformance',
    'goCompetitions',
    'goNotices',
    'goFeedback',
    'goStatistics',
    'goReport',
    'goEditProfile',
    'goLinkManage',
    'goAllFeatures',
    'goHome'
  ]) {
    assert.ok(handlers.includes(handler), `学生工作台缺少 ${handler}`);
  }
});

test('F1-D2b 教练业务入口不减少', () => {
  const handlers = handlerNames(read('coach', 'wxml'));
  for (const handler of [
    'goAttendanceManage',
    'goPlans',
    'goPerformanceReview',
    'goStatsWorkbench',
    'goCompetitionManage',
    'goNoticeManage',
    'goFeedbackManage',
    'goAllFeatures',
    'goHome'
  ]) {
    assert.ok(handlers.includes(handler), `教练工作台缺少 ${handler}`);
  }
});

test('F1-D2b 家长业务入口与只读约束不减少', () => {
  const wxml = read('parent', 'wxml');
  const handlers = handlerNames(wxml);
  for (const handler of ['goBind', 'goAllFeatures', 'goHome', 'onJumpTap', 'onStudentChange']) {
    assert.ok(handlers.includes(handler), `家长工作台缺少 ${handler}`);
  }
  assert.ok(wxml.includes('id="sec-account"'), '家长 section 深链接不得丢失');
  assert.ok(wxml.includes('scroll-into-view'), '家长页内定位不得丢失');
  assert.ok(!wxml.includes('class="jg-btn '), '家长工作台不得出现实底按钮');
  assert.ok(!wxml.includes('jg-btn-accent'), '家长工作台不得出现强调写按钮');
});

test('F1-D2b 开发者业务入口不减少', () => {
  const handlers = handlerNames(read('admin', 'wxml'));
  for (const handler of [
    'goAllFeatures',
    'goCoachWorkbench',
    'goLinkReview',
    'goPerformanceReview',
    'goAttendanceManage',
    'goStatsWorkbench',
    'goPlans',
    'goCompetitionManage',
    'goNoticeManage',
    'goFeedbackManage',
    'goHome'
  ]) {
    assert.ok(handlers.includes(handler), `开发者工作台缺少 ${handler}`);
  }
});

test('F1-D2b 未新增账号删除、清空或重置入口', () => {
  for (const page of PAGES) {
    const wxml = read(page, 'wxml');
    for (const forbidden of [
      '删除账号',
      '注销账号',
      '清空数据',
      '重置系统',
      '重新初始化',
      '删除当前账号'
    ]) {
      assert.ok(!wxml.includes(forbidden), `${page} 不应新增危险入口：${forbidden}`);
    }
  }
});

test('F1-D2b 四页面身份判断与业务 JS 引用未改变', () => {
  const expected = {
    student: "sessionHasRole(session, 'student')",
    coach: "sessionHasRole(session, 'coach')",
    parent: "sessionHasRole(session, 'parent')",
    admin: "sessionHasRole(session, 'developer')"
  };
  for (const page of PAGES) {
    const js = read(page, 'js');
    assert.ok(js.includes(expected[page]), `${page} 身份判断不得丢失`);
    assert.ok(js.includes('getSessionDestination'), `${page} 应保留无权限跳转`);
  }
});
