'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('V1.6.5 试穿页已在 app.json 注册且四件套齐全', () => {
  const appJson = JSON.parse(read('miniprogram/app.json'));
  assert.ok(appJson.pages.includes('pages/ui-preview/ui-preview'), 'ui-preview 必须注册在 app.json');
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    const full = path.join(ROOT, `miniprogram/pages/ui-preview/ui-preview.${ext}`);
    assert.ok(fs.existsSync(full), `缺少 ui-preview.${ext}`);
  }
});

test('V1.6.5 试穿页严格守卫：仅 develop/trial + 真实 developer，零接口/存储写入', () => {
  const js = read('miniprogram/pages/ui-preview/ui-preview.js');
  const jsClean = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(jsClean, /require\(['"]\.\.\/\.\.\/demo\/demo-guard['"]\)/, '必须复用 demo-guard');
  assert.match(jsClean, /checkDemoAccess\(session\)/, '必须校验 develop/trial + developer');
  assert.doesNotMatch(jsClean, /services\/api/, '严禁引入 services/api');
  assert.doesNotMatch(jsClean, /wx\.setStorage|wx\.cloud/, '严禁写入 storage 或访问云端');
  assert.match(jsClean, /onUnload\(\)/, '必须实现 onUnload 清理定时/动画帧');
});

test('V1.6.5 试穿页无橙色残留、无禁用 CSS、且包含三方向与核心动效', () => {
  const wxml = read('miniprogram/pages/ui-preview/ui-preview.wxml');
  const wxss = read('miniprogram/pages/ui-preview/ui-preview.wxss');
  const wxssClean = wxss.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(wxml, /V1\.6\.5 试穿 · 演示数据/, '页头必须固定标注 V1.6.5 试穿 · 演示数据');
  assert.doesNotMatch(wxssClean + wxml, /#EE8300|#FF9E2C|#A84E00/i, '不得存在任何橙色残留');
  assert.doesNotMatch(wxssClean, /display\s*:\s*(inline-)?grid\b/i, '禁止 CSS Grid');
  assert.doesNotMatch(wxssClean, /backdrop-filter|filter\s*:\s*blur|position\s*:\s*sticky/i, '禁止禁用 CSS');
  assert.match(wxss, /pv-stagger-in/, '必须包含列表 stagger 入场');
  assert.match(wxss, /pv-shimmer/, '必须包含骨架屏 1.2s shimmer');
  assert.match(wxss, /pv-ring-burst/, '必须包含 V1 三层光环扩散');
  assert.match(wxss, /rotateY\(180deg\)/, '必须包含 V2 3D 翻面');
  assert.match(wxss, /pv-raster-sweep/, '必须包含 V3 光栅扫描');
});

test('开发者工作台已增加受 demoAvailable 守卫的 V1.6.5 界面试穿入口', () => {
  const adminWxml = read('miniprogram/pages/admin/admin.wxml');
  const adminJs = read('miniprogram/pages/admin/admin.js');
  assert.match(adminWxml, /V1\.6\.5 界面试穿/);
  assert.match(adminWxml, /bindtap="goUiPreview"/);
  assert.match(adminJs, /goUiPreview\(\)\s*\{[\s\S]*if\s*\(!this\.data\.demoAvailable\)[\s\S]*\/pages\/ui-preview\/ui-preview/);
});
