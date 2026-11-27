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

test('R5 蓝黑白高级感色板完整且全站零禁用色、零旧色残留', () => {
  const appWxss = read('miniprogram/app.wxss');
  const required = [
    '#04060A',
    '#0A0E14',
    '#0F141C',
    '#16304F',
    '#2E6BFF',
    '#8FB6FF',
    '#FFFFFF',
    '#A9B4C2',
    'rgba(255, 255, 255, 0.08)',
    '#FF5A5F',
    '#FAFBFC',
    '#4A5568',
    '#2B5FCC',
    '#C53030'
  ];
  for (const token of required) {
    assert.ok(appWxss.includes(token), `app.wxss 缺少蓝黑白高级感令牌 ${token}`);
  }

  /* 严禁旧 R4 色值、旧 F1 色值、橙/紫/金色残留 */
  const bannedRe = /#(05070A|0B1219|101A24|132D49|2F6FBF|7FB2FF|1E2C3A|B9C6D4|FF6B6B|F7FAFC|EDF3F9|C9D6E3|33485E|F2711C|B54A07|D95F0E|EE8300|FF9E2C|FDEDE2|FFF6E5|FEF6E7|B45309|7A4308|8A5A12|FFC46B|F1DDB6|F7D0B4|103A6B|00A7C4|EDF1F6|F7F9FC|F4F8FE|E9F1FB|123C4D|207788|8B5CF6|A855F7|D4AF37|FFD700)\b/i;
  const files = walkFiles(path.join(ROOT, 'miniprogram'), ['.wxss', '.wxml', '.js', '.json']);
  const hits = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const clean = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    const match = clean.match(bannedRe);
    if (match) {
      hits.push(`${path.relative(ROOT, file)} => ${match[0]}`);
    }
  }
  assert.deepEqual(hits, [], `miniprogram 存在旧色或禁用色残留：${hits.join('; ')}`);
});

test('R5 按钮五变体四态与公共件齐全，触控高度 >= 88rpx', () => {
  const appWxss = read('miniprogram/app.wxss');
  const requiredClasses = [
    '.jg-btn',
    '.jg-btn-secondary',
    '.jg-btn-ghost',
    '.jg-btn-danger',
    '.jg-btn-icon',
    '.jg-btn:active',
    '.jg-btn-loading',
    '.jg-btn-disabled',
    '.jg-btn-success',
    '.jg-card',
    '.jg-card-outline',
    '.jg-data-card',
    '.jg-input-focus',
    '.jg-input-error',
    '.jg-field-err',
    '.jg-seg',
    '.jg-seg-item-active',
    '.jg-tabs',
    '.jg-tab-active',
    '.jg-toast',
    '.jg-drawer-mask',
    '.jg-drawer-sheet',
    '.jg-ptr-line',
    '.jg-content-in'
  ];
  for (const cls of requiredClasses) {
    assert.ok(appWxss.includes(cls), `app.wxss 缺少公共组件类 ${cls}`);
  }
  assert.match(appWxss, /--jg-touch:\s*88rpx/);
  assert.match(appWxss, /\.jg-btn-icon\s*\{[^}]*width:\s*88rpx[^}]*height:\s*88rpx/);
  assert.match(appWxss, /radial-gradient\(circle at 88% 12%, rgba\(143, 182, 255, 0\.08\)/, '主数据卡径向光透明度不得超过 8%');
});

test('R5 全站动效曲线严格统一 cubic-bezier(0.16, 1, 0.3, 1)，无旧曲线与通配符 *', () => {
  const styleFiles = [
    'miniprogram/app.wxss',
    'miniprogram/components/jg-page-head/jg-page-head.wxss',
    'miniprogram/components/jg-empty/jg-empty.wxss',
    'miniprogram/components/jg-flip-card/jg-flip-card.wxss',
    'miniprogram/components/jg-stat-ring/jg-stat-ring.wxss',
    'miniprogram/components/jg-action-dock/jg-action-dock.wxss',
    'miniprogram/pages/ui-preview/ui-preview.wxss'
  ];
  for (const rel of styleFiles) {
    const clean = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(clean.includes('cubic-bezier(0.16, 1, 0.3, 1)'), `${rel} 必须使用统一曲线 cubic-bezier(0.16, 1, 0.3, 1)`);
    assert.doesNotMatch(clean, /cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/, `${rel} 不得残留旧 R4 缓动曲线`);
    assert.doesNotMatch(clean, /display\s*:\s*(inline-)?grid\b/i, `${rel} 禁止 CSS Grid`);
    assert.doesNotMatch(clean, /backdrop-filter|filter\s*:\s*blur|position\s*:\s*sticky/i, `${rel} 禁止禁用 CSS`);
    assert.doesNotMatch(clean, /\*/, `${rel} 禁止 WXSS 通配符 *`);
  }

  const wxs = read('miniprogram/utils/motion.wxs');
  assert.ok(wxs.includes('cubic-bezier(0.16, 1, 0.3, 1)'), 'WXS 手势层必须使用统一曲线');
  assert.ok(wxs.includes('onSwipeMove') && wxs.includes('onDrawerMove') && wxs.includes('onPressStart'), 'WXS 需包含滑动/抽屉/按压控制器');

  const appWxss = read('miniprogram/app.wxss');
  assert.match(appWxss, /--jg-dur-press:\s*90ms/);
  assert.match(appWxss, /--jg-dur-fast:\s*140ms/);
  assert.match(appWxss, /--jg-dur-base:\s*220ms/);
  assert.match(appWxss, /--jg-dur-slow:\s*320ms/);
  assert.match(appWxss, /--jg-dur-sig:\s*480ms/);
  assert.match(appWxss, /\.jg-stagger-1\s*\{\s*animation-delay:\s*40ms;\s*\}/, '列表入场应为 40ms 错峰');
  assert.match(appWxss, /jg-shimmer-kf\s+1\.1s/, '骨架扫光应为 1.1s');
  assert.match(appWxss, /jg-content-in-kf\s+180ms/, '骨架后内容淡入应为 180ms');
  assert.match(appWxss, /jg-check-pop-kf\s+360ms/, '成功环形确认应为 360ms');
});

test('R5 翻面双分支降级、单排操作坞 <=112rpx、日光模式零低对比组合', () => {
  const flipWxss = read('miniprogram/components/jg-flip-card/jg-flip-card.wxss');
  const flipJs = read('miniprogram/components/jg-flip-card/jg-flip-card.js');
  assert.ok(flipWxss.includes('@supports not (transform-style: preserve-3d)'), '缺少 @supports 2D 降级');
  assert.match(flipJs, /SDKVersion/, '缺少低基础库 2D 降级检测');
  assert.ok(flipWxss.includes('@media (prefers-reduced-motion: reduce)'), '缺少减弱动效静态降级');

  const dockWxss = read('miniprogram/components/jg-action-dock/jg-action-dock.wxss');
  assert.match(dockWxss, /height:\s*88rpx/);
  assert.match(dockWxss, /max-height:\s*112rpx/);

  const daylightPairs = [
    ['日光正文/白卡', '#0A0E14', '#FFFFFF'],
    ['日光正文/白底', '#0A0E14', '#FAFBFC'],
    ['日光次文/白卡', '#4A5568', '#FFFFFF'],
    ['日光次文/白底', '#4A5568', '#FAFBFC'],
    ['日光主按钮/深蓝', '#FFFFFF', '#16304F'],
    ['日光强调蓝/白卡', '#2B5FCC', '#FFFFFF'],
    ['日光强调蓝/白底', '#2B5FCC', '#FAFBFC'],
    ['日光错误红/白卡', '#C53030', '#FFFFFF']
  ];
  for (const [label, fg, bg] of daylightPairs) {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `${label} 对比度 ${ratio.toFixed(2)}:1 < 4.5:1`);
  }
});

test('R5 37 页全覆盖、demo/ui-preview 守卫完好、无越权数据库直连', () => {
  const appJson = JSON.parse(read('miniprogram/app.json'));
  assert.equal(appJson.pages.length, 37);
  assert.equal(appJson.tabBar, undefined);

  for (const p of appJson.pages) {
    const js = read(`miniprogram/${p}.js`);
    const wxml = read(`miniprogram/${p}.wxml`);
    assert.doesNotMatch(js, /wx\.cloud\.database\s*\(/, `${p} 不得绕过 services/api 直连数据库`);
    assert.doesNotMatch(js, /wx\.cloud\.callFunction\s*\(/, `${p} 不得绕过 services/api 直接调用云函数`);
    if (p === 'pages/ui-preview/ui-preview') {
      assert.match(wxml, /pv-page/);
      assert.match(js, /checkDemoAccess/);
      assert.doesNotMatch(js, /services\/api/);
    } else if (p === 'pages/demo/demo') {
      assert.match(wxml, /jg-page/);
      assert.match(js, /checkDemoAccess/);
      assert.doesNotMatch(js, /services\/api/);
    } else {
      assert.match(wxml, /jg-page/);
      assert.match(wxml, /jg-enter-fwd/);
    }
  }

  assert.ok(fs.existsSync(path.join(ROOT, 'docs/V1.6.5_蓝黑白高级感设计规范.md')), '缺少蓝黑白高级感设计规范文档');
});
