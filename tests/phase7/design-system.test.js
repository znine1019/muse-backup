'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

const APP_WXSS = read('miniprogram/app.wxss');
const WORKBENCHES = ['student', 'coach', 'admin'];

function pageFile(page, extension) {
  return `miniprogram/pages/${page}/${page}.${extension}`;
}

test('阶段7-1 设计令牌覆盖颜色、字号与触控目标', () => {
  for (const token of [
    '#000000',
    '#0A0C10',
    '#111419',
    '#00A6FF',
    '#38BDF8',
    '#FFFFFF',
    '#A3ADB8',
    '#006BB3',
    '#005596',
    'rgba(255, 255, 255, 0.24)'
  ]) {
    assert.ok(APP_WXSS.includes(token), `缺少 V1.6.5 黑科技蓝设计令牌值 ${token}`);
  }

  assert.match(APP_WXSS, /--jg-touch:\s*88rpx/, '触控目标令牌应为 88rpx');
  assert.match(APP_WXSS, /\.jg-body\s*\{[^}]*font-size:\s*27rpx/, '正文字号应为 27rpx');
  assert.match(APP_WXSS, /\.jg-data-num\s*\{[^}]*font-size:\s*66rpx/, '数据卡主数值应为 66rpx');
  assert.match(APP_WXSS, /tabular-nums/, '数字应使用等宽数字');
});

test('阶段7-1 新增样式使用 jg- 命名空间且不覆盖旧公共类', () => {
  /* 旧公共类必须保留，未改造页面继续可用 */
  for (const legacy of [
    '.container',
    '.brand',
    '.title',
    '.card {',
    '.card-title',
    '.button-primary',
    '.button-secondary',
    '.button-danger',
    '.form-card',
    '.field-label',
    '.input,',
    '.list-item',
    '.section-title',
    '.notice'
  ]) {
    assert.ok(APP_WXSS.includes(legacy), `旧公共样式被删除：${legacy}`);
  }

  /* 新增段落必须使用 jg- 前缀；不允许出现新的裸标签或通用类选择器 */
  const phase7Start = APP_WXSS.indexOf('阶段7-1｜F1 融合设计系统');
  assert.ok(phase7Start > 0, '应能定位阶段7新增段落');
  const phase7Block = APP_WXSS.slice(phase7Start);
  const selectors = phase7Block.match(/^[.#a-zA-Z][^{]*\{/gm) || [];
  for (const selector of selectors) {
    const head = selector.replace(/\{$/, '').trim();
    if (head === 'page' || head.startsWith('@') || head.startsWith('/*')) {
      continue;
    }
    const tokens = head.split(',').map((item) => item.trim()).filter(Boolean);
    for (const token of tokens) {
      assert.ok(
        token.includes('jg-'),
        `阶段7新增选择器缺少 jg- 命名空间：${token}`
      );
    }
  }
});

test('阶段7-2 三个工作台使用的 jg- 类都必须有定义', () => {
  const componentCss = [
    read('miniprogram/components/jg-page-head/jg-page-head.wxss'),
    read('miniprogram/components/jg-empty/jg-empty.wxss')
  ].join('\n');

  for (const page of WORKBENCHES) {
    const wxml = read(pageFile(page, 'wxml'));
    const pageCss = read(pageFile(page, 'wxss'));
    const css = `${APP_WXSS}\n${pageCss}\n${componentCss}`;
    const classAttributes = wxml.match(/class="[^"]*"/g) || [];
    const used = new Set();
    for (const attribute of classAttributes) {
      const tokens = attribute.match(/jg-[a-z0-9-]+/g) || [];
      for (const token of tokens) {
        used.add(token);
      }
    }
    assert.ok(used.size > 0, `${page} 工作台应使用 jg- 设计系统类`);
    for (const token of used) {
      assert.ok(
        css.includes(`.${token}`),
        `${page}.wxml 使用了未定义的样式类 .${token}`
      );
    }
  }
});

test('阶段7-2 公共组件样式自包含且不依赖 app.wxss', () => {
  const headCss = read('miniprogram/components/jg-page-head/jg-page-head.wxss');
  const emptyCss = read('miniprogram/components/jg-empty/jg-empty.wxss');

  assert.match(headCss, /\.head-title\s*\{/, '页面头部组件应自带标题样式');
  assert.match(headCss, /font-size:\s*4[26]rpx/, '页面头部组件应自带主标题字号');
  assert.match(emptyCss, /\.empty-t\s*\{/, '空状态组件应自带标题样式');
  assert.match(emptyCss, /min-height:\s*88rpx/, '空状态组件按钮应满足触控目标');

  for (const page of WORKBENCHES) {
    const config = JSON.parse(read(pageFile(page, 'json')));
    assert.equal(
      config.usingComponents['jg-page-head'],
      '/components/jg-page-head/jg-page-head',
      `${page} 应注册 jg-page-head`
    );
    assert.equal(
      config.usingComponents['jg-empty'],
      '/components/jg-empty/jg-empty',
      `${page} 应注册 jg-empty`
    );
  }
});

test('阶段7-2 工作台不直连数据库且不引入演示数据模块到正式页面', () => {
  for (const page of WORKBENCHES) {
    const js = read(pageFile(page, 'js'));
    assert.doesNotMatch(js, /wx\.cloud\.database\s*\(/, `${page} 不得直连数据库`);
    assert.doesNotMatch(js, /process\.env/, `${page} 不得读取云函数环境变量`);
    assert.ok(
      js.includes("require('../../services/api')"),
      `${page} 必须通过 services/api 调用云函数`
    );
  }

  /* 只有开发者工作台允许保留受环境开关控制的 DEMO 预览入口 */
  assert.match(read(pageFile('admin', 'js')), /isDemoAllowed/);
  assert.doesNotMatch(read(pageFile('student', 'js')), /isDemoAllowed/);
  assert.doesNotMatch(read(pageFile('coach', 'js')), /isDemoAllowed/);
});

test('阶段7-2 既有 trend-chart 组件保持可用', () => {
  const chartJs = read('miniprogram/components/trend-chart/trend-chart.js');
  assert.match(chartJs, /Component\(/, 'trend-chart 应为自定义组件');
  assert.match(chartJs, /createSelectorQuery/, 'trend-chart 应保留 Canvas 绘制逻辑');
  assert.match(chartJs, /series/, 'trend-chart 应保留 series 数据契约');
});
