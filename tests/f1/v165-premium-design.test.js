'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walkFiles(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function relativeLuminance(hex) {
  const clean = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => {
    const c = parseInt(clean.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('R6 黑+白+科技蓝 色板完整，且 app.wxss 与组件禁用深海军蓝及第四色相', () => {
  const appWxss = read('miniprogram/app.wxss');
  const required = [
    '#000000',
    '#0A0C10',
    '#111419',
    '#00A6FF',
    '#38BDF8',
    '#FFFFFF',
    '#A3ADB8',
    'rgba(255, 255, 255, 0.14)',
    '#F4F6F8',
    '#4B5563',
    '#006BB3',
    '#005596'
  ];
  for (const token of required) {
    assert.ok(appWxss.includes(token), `app.wxss 缺少黑科技蓝令牌 ${token}`);
  }

  /* 禁用深海军蓝、藏青、暗蓝及橙/紫/金/绿/旧红等第四色相 */
  const bannedRe = /#(16304F|132D49|103A6B|0F172A|1E293B|04060A|0A0E14|0F141C|2E6BFF|8FB6FF|2B5FCC|FF5A5F|C53030|05070A|0B1219|101A24|2F6FBF|7FB2FF|1E2C3A|B9C6D4|FF6B6B|F2711C|B54A07|D95F0E|EE8300|FF9E2C|FDEDE2|FFF6E5|FEF6E7|B45309|7A4308|8A5A12|FFC46B|F1DDB6|F7D0B4|00A7C4|123C4D|207788|8B5CF6|A855F7|D4AF37|FFD700|22C55E|16A34A)\b/i;
  const coreFiles = [
    'miniprogram/app.wxss',
    'miniprogram/app.json',
    ...walkFiles(path.join(ROOT, 'miniprogram/components'), ['.wxss', '.wxml', '.js'])
  ];
  const hits = [];
  for (const file of coreFiles) {
    const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
    const clean = fs.readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    const m = clean.match(bannedRe);
    if (m) {
      hits.push(`${path.relative(ROOT, abs)} => ${m[0]}`);
    }
  }
  assert.deepEqual(hits, [], `核心样式/组件存在禁用深蓝或第四色相残留：${hits.join('; ')}`);
});

test('R6 全站所有 miniprogram/**/*.wxss 零禁用 CSS（Grid/backdrop-filter/blur/sticky/通配符*）', () => {
  const allWxss = walkFiles(path.join(ROOT, 'miniprogram'), ['.wxss']);
  assert.ok(allWxss.length >= 40, `应扫描全部 WXSS 文件（当前 ${allWxss.length}）`);
  const violations = [];
  for (const file of allWxss) {
    const clean = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rel = path.relative(ROOT, file);
    if (/display\s*:\s*(inline-)?grid\b/i.test(clean) || /grid-template-columns/i.test(clean)) {
      violations.push(`${rel}: CSS Grid`);
    }
    if (/backdrop-filter|filter\s*:\s*blur|position\s*:\s*sticky/i.test(clean)) {
      violations.push(`${rel}: backdrop-filter/blur/sticky`);
    }
    if (/\*/.test(clean)) {
      violations.push(`${rel}: 通配符 *`);
    }
  }
  assert.deepEqual(violations, [], `全站 WXSS 发现禁用属性或通配符：${violations.join('; ')}`);
});

test('R6 按钮五变体四态、去卡片化结构类与统一动效令牌齐全', () => {
  const appWxss = read('miniprogram/app.wxss');
  const requiredClasses = [
    '.jg-band',
    '.jg-band-head',
    '.jg-band-idx',
    '.jg-hero-band',
    '.jg-hero-num',
    '.jg-matrix',
    '.jg-mcell',
    '.jg-kv-grid',
    '.jg-queue-row',
    '.jg-pill-bar',
    '.jg-form-2col',
    '.jg-dot-live',
    '.jg-btn',
    '.jg-btn-secondary',
    '.jg-btn-ghost',
    '.jg-btn-danger',
    '.jg-btn-icon',
    '.jg-btn:active',
    '.jg-btn-loading',
    '.jg-btn-disabled',
    '.jg-btn-success',
    '.jg-input-focus',
    '.jg-input-error',
    '.jg-field-err',
    '.jg-seg',
    '.jg-tabs',
    '.jg-toast',
    '.jg-drawer-mask',
    '.jg-ptr-line',
    '.jg-content-in'
  ];
  for (const cls of requiredClasses) {
    assert.ok(appWxss.includes(cls), `app.wxss 缺少结构或组件类 ${cls}`);
  }
  assert.match(appWxss, /--jg-touch:\s*88rpx/);
  assert.ok(appWxss.includes('cubic-bezier(0.16, 1, 0.3, 1)'));
  assert.doesNotMatch(appWxss, /cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
  assert.match(appWxss, /--jg-dur-press:\s*90ms/);
  assert.match(appWxss, /--jg-dur-fast:\s*140ms/);
  assert.match(appWxss, /--jg-dur-base:\s*220ms/);
  assert.match(appWxss, /--jg-dur-slow:\s*320ms/);
  assert.match(appWxss, /--jg-dur-sig:\s*480ms/);
});

test('R6 翻面双分支降级、单排操作坞 <=112rpx、日光模式零低对比组合', () => {
  const flipWxss = read('miniprogram/components/jg-flip-card/jg-flip-card.wxss');
  const flipJs = read('miniprogram/components/jg-flip-card/jg-flip-card.js');
  assert.ok(flipWxss.includes('@supports not (transform-style: preserve-3d)'), '缺少 @supports 2D 降级');
  assert.match(flipJs, /SDKVersion/, '缺少低基础库 2D 降级检测');
  assert.ok(flipWxss.includes('@media (prefers-reduced-motion: reduce)'), '缺少减弱动效静态降级');

  const dockWxss = read('miniprogram/components/jg-action-dock/jg-action-dock.wxss');
  assert.match(dockWxss, /height:\s*88rpx/);
  assert.match(dockWxss, /max-height:\s*112rpx/);

  const daylightPairs = [
    ['日光纯黑正文/纯白', '#000000', '#FFFFFF'],
    ['日光纯黑正文/纸白', '#000000', '#F4F6F8'],
    ['日光深灰次文/纯白', '#4B5563', '#FFFFFF'],
    ['日光深灰次文/纸白', '#4B5563', '#F4F6F8'],
    ['日光加深科技蓝/纯白', '#006BB3', '#FFFFFF'],
    ['日光加深科技蓝/纸白', '#006BB3', '#F4F6F8'],
    ['日光数值科技蓝/纯白', '#005596', '#FFFFFF'],
    ['日光白字/加深科技蓝', '#FFFFFF', '#006BB3']
  ];
  for (const [label, fg, bg] of daylightPairs) {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `${label} 对比度 ${ratio.toFixed(2)}:1 < 4.5:1`);
  }
});

test('R6 37 页全覆盖、demo/ui-preview 守卫完好、无越权数据库直连', () => {
  const appJson = JSON.parse(read('miniprogram/app.json'));
  assert.equal(appJson.pages.length, 37);
  assert.equal(appJson.tabBar, undefined);

  for (const p of appJson.pages) {
    const js = read(`miniprogram/${p}.js`);
    const jsClean = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const wxml = read(`miniprogram/${p}.wxml`);
    assert.doesNotMatch(jsClean, /wx\.cloud\.database\s*\(/, `${p} 不得绕过 services/api 直连数据库`);
    assert.doesNotMatch(jsClean, /wx\.cloud\.callFunction\s*\(/, `${p} 不得绕过 services/api 直接调用云函数`);
    if (p === 'pages/ui-preview/ui-preview') {
      assert.match(wxml, /pv-page/);
      assert.match(jsClean, /checkDemoAccess/);
      assert.doesNotMatch(jsClean, /services\/api/);
    } else if (p === 'pages/demo/demo') {
      assert.match(wxml, /jg-page/);
      assert.match(jsClean, /checkDemoAccess/);
      assert.doesNotMatch(jsClean, /services\/api/);
    } else {
      assert.match(wxml, /jg-page/);
      assert.match(wxml, /jg-enter-fwd/);
    }
  }

  assert.ok(fs.existsSync(path.join(ROOT, 'docs/V1.6.5_黑科技蓝设计规范.md')), '缺少黑科技蓝设计规范文档');
});
