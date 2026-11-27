'use strict';

/**
 * F1-A2｜统一视觉规范落地回归测试
 *
 * 目的：把本轮"四角色一致视觉 + 不损失功能"的要求固化成可执行断言，
 *       防止后续改动把品牌色、触控目标、入口数量或只读语义改回去。
 *
 * 只做静态结构断言，不代表官方微信编译结果。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

const APP_JSON = JSON.parse(read('miniprogram/app.json'));
const APP_WXSS = read('miniprogram/app.wxss');

/* V1.6.5 黑+白+科技蓝 核心色值（禁用深海军蓝与任何第四色相） */
const APPROVED_COLORS = [
  ['OLED纯黑画布', '#000000'],
  ['碳黑承托', '#0A0C10'],
  ['石墨面', '#111419'],
  ['主电光科技蓝', '#00A6FF'],
  ['高亮电光科技蓝', '#38BDF8'],
  ['纯白主文字', '#FFFFFF'],
  ['次级灰白', '#A3ADB8'],
  ['日光纸白', '#F4F6F8'],
  ['日光深灰次文', '#4B5563'],
  ['日光加深科技蓝', '#006BB3']
];

/* F1-A 范围内页面 */
const F1_PAGES = ['student', 'coach', 'admin', 'parent', 'all-features', 'role-select'];

/* 阶段0—6 遗留青绿体系（这些页面上不应再出现） */
const LEGACY_TOKENS = [
  '#123C4D',
  '#207788',
  '#437A86',
  '#E9F6F8',
  '#10263C',
  '#F4F7FA',
  '#14293D',
  '#D95F0E'
];

/* 遗留类名（按 class token 精确匹配，避免 .jg-card 误判为 .card） */
const LEGACY_CLASSES = new Set([
  'container',
  'brand',
  'title',
  'sub',
  'card',
  'card-title',
  'card-sub',
  'pill',
  'row',
  'kpi',
  'kpi-label',
  'notice',
  'action',
  'button-primary',
  'button-secondary',
  'button-danger',
  'form-card',
  'field',
  'field-label',
  'input',
  'picker-field',
  'textarea',
  'muted',
  'error',
  'success',
  'empty',
  'tag',
  'list-item',
  'list-title',
  'list-meta',
  'section-title',
  'section-sub'
]);

function pageFile(page, extension) {
  return `miniprogram/pages/${page}/${page}.${extension}`;
}

function classTokens(source) {
  const tokens = [];
  const matches = source.match(/class="([^"]*)"/g) || [];
  for (const attribute of matches) {
    const value = attribute.replace(/^class="/, '').replace(/"$/, '');
    /* 去掉 {{...}} 动态片段，只保留静态类名 */
    const cleaned = value.replace(/\{\{[^}]*\}\}/g, ' ');
    for (const token of cleaned.split(/\s+/)) {
      if (token) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

/* ---------------------------------------------------------------- 全局视觉 */

test('F1-A 全局导航栏与窗口背景统一为品牌色', () => {
  assert.equal(
    APP_JSON.window.navigationBarBackgroundColor,
    '#000000',
    '导航栏背景应为 OLED 纯黑 #000000（禁用深海军蓝）'
  );
  assert.equal(APP_JSON.window.navigationBarTextStyle, 'white', '导航栏文字应为白色');
  assert.equal(APP_JSON.window.backgroundColor, '#000000', '窗口背景应为 OLED 纯黑 #000000');
});

test('F1-A 不存在页面级导航栏/窗口覆盖（改动 app.json 即可全站统一）', () => {
  const keys = [
    'navigationBarBackgroundColor',
    'navigationBarTextStyle',
    'backgroundColor',
    'backgroundTextStyle',
    'navigationStyle'
  ];
  for (const page of APP_JSON.pages) {
    const config = JSON.parse(read(`miniprogram/${page}.json`));
    for (const key of keys) {
      assert.equal(
        config[key],
        undefined,
        `${page} 不应单独覆盖 ${key}，否则会破坏全站统一`
      );
    }
  }
});

test('F1-A 设计令牌包含本轮批准的全部核心色值', () => {
  for (const [label, hex] of APPROVED_COLORS) {
    assert.ok(APP_WXSS.includes(hex), `${label} 缺少色值 ${hex}`);
  }
});

test('F1-A V1.6.5 彻底清除橙色与深海军蓝，使用黑+白+科技蓝令牌', () => {
  assert.ok(
    APP_WXSS.includes('--jg-accent: #00A6FF') && APP_WXSS.includes('--jg-accent-hi: #38BDF8'),
    '主科技蓝与高亮科技蓝令牌必须为 #00A6FF / #38BDF8'
  );
  for (const file of [
    'miniprogram/app.wxss',
    'miniprogram/components/jg-page-head/jg-page-head.wxss'
  ]) {
    const css = read(file);
    assert.ok(!/#D95F0E|#F2711C|#B54A07|#EE8300|#16304F|#132D49/i.test(css), `${file} 不应再残留任何橙色或深海军蓝`);
  }
});

/* 计算 WCAG 相对对比度，用于验证文字可读性 */
function relativeLuminance(hex) {
  const channels = hex
    .replace('#', '')
    .match(/../g)
    .map((part) => parseInt(part, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

test('F1-A 文字对比度不低于 AA 4.5:1', () => {
  const pairs = [
    ['主文字/OLED纯黑', '#FFFFFF', '#000000'],
    ['主文字/石墨面', '#FFFFFF', '#111419'],
    ['次文字/OLED纯黑', '#A3ADB8', '#000000'],
    ['次文字/石墨面', '#A3ADB8', '#111419'],
    ['主按钮黑字/纯白底', '#000000', '#FFFFFF'],
    ['黑字/电光科技蓝', '#000000', '#00A6FF'],
    ['电光科技蓝/纯黑底', '#00A6FF', '#000000'],
    ['高亮科技蓝/纯黑底', '#38BDF8', '#000000'],
    ['高亮科技蓝/石墨面', '#38BDF8', '#111419'],
    ['日光正文/纯白画布', '#000000', '#FFFFFF'],
    ['日光次文/纯白画布', '#4B5563', '#FFFFFF'],
    ['日光次文/纸白带', '#4B5563', '#F4F6F8'],
    ['日光加深科技蓝/纯白', '#006BB3', '#FFFFFF'],
    ['日光数值科技蓝/纯白', '#005596', '#FFFFFF']
  ];
  for (const [label, fg, bg] of pairs) {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `${label} 对比度 ${ratio.toFixed(2)}:1 低于 AA 4.5:1`);
  }
});

test('F1-A 强调按钮使用高对比黑字白底（不再使用低对比橙底）', () => {
  const rule = APP_WXSS.match(/\.jg-btn-accent\s*\{[^}]*\}/);
  assert.ok(rule, '应存在 .jg-btn-accent 规则');
  assert.ok(
    !/#F2711C|#EE8300/i.test(rule[0]),
    '.jg-btn-accent 不得使用旧橙色'
  );
  assert.ok(
    rule[0].includes('--jg-cta-text'),
    '.jg-btn-accent 应使用高对比主 CTA 令牌'
  );
});

test('F1-A 兼容性备援：不依赖 flex gap，数字字体双声明', () => {
  const jgBlock = APP_WXSS.slice(APP_WXSS.indexOf('阶段7-1'));
  assert.ok(jgBlock.length > 0, '应能定位 jg- 设计系统段落');
  assert.ok(
    !/^\s*gap\s*:/m.test(jgBlock),
    'jg- 段落不得使用 flex gap（旧版 iOS 微信不生效）'
  );
  assert.ok(
    jgBlock.includes("font-feature-settings: 'tnum'"),
    '数字等宽需提供 font-feature-settings 兜底'
  );
  assert.ok(
    jgBlock.includes('font-variant-numeric: tabular-nums'),
    '数字等宽需保留 font-variant-numeric'
  );
});

test('F1-A 触控目标：可交互元素有效高度不少于 88rpx', () => {
  const rules = [
    ['.jg-btn', /\.jg-btn\s*\{[^}]*min-height:\s*88rpx/],
    ['.jg-chip-tap', /\.jg-chip-tap\s*\{[^}]*min-height:\s*88rpx/],
    ['.jg-jump-chip', /\.jg-jump-chip\s*\{[^}]*min-height:\s*88rpx/],
    ['.jg-input', /\.jg-input\s*\{[^}]*min-height:\s*88rpx/]
  ];
  for (const [name, pattern] of rules) {
    assert.match(APP_WXSS, pattern, `${name} 的触控高度应 ≥88rpx`);
  }
});

/* ------------------------------------------------------------ 页面一致性 */

test('F1-A 六个目标页面已迁移到 jg- 设计语言且无遗留青绿值', () => {
  for (const page of F1_PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    const wxss = read(pageFile(page, 'wxss'));

    assert.match(wxml, /class="jg-page/, `${page} 根容器应使用 jg-page`);

    for (const token of LEGACY_TOKENS) {
      assert.ok(!wxml.includes(token), `${page}.wxml 残留遗留色值 ${token}`);
      assert.ok(!wxss.includes(token), `${page}.wxss 残留遗留色值 ${token}`);
    }

    for (const token of classTokens(wxml)) {
      assert.ok(
        !LEGACY_CLASSES.has(token),
        `${page}.wxml 残留遗留类 .${token}`
      );
    }

    /* 骨架屏高度改用工具类，不再内联 style 高度 */
    assert.ok(
      !/style="height:/.test(wxml),
      `${page}.wxml 不应再内联 style 高度（改用 jg-skel-* 工具类）`
    );
  }
});

test('F1-A 全部 jg- 类都有定义（防止用了未定义的样式）', () => {
  const defined = new Set();
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(full);
      } else if (entry.name.endsWith('.wxss')) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(/\.(jg-[a-z0-9-]+)/g)) {
          defined.add(match[1]);
        }
      }
    }
  };
  collect(path.join(PROJECT_ROOT, 'miniprogram'));

  for (const page of F1_PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    /* 只看 class 属性内的静态类名；<jg-page-head> 这类组件标签不是样式类 */
    const attributes = wxml.match(/class="[^"]*"/g) || [];
    for (const attribute of attributes) {
      const cleaned = attribute.replace(/\{\{[^}]*\}\}/g, ' ');
      for (const token of cleaned.match(/jg-[a-z0-9-]+/g) || []) {
        /* jg-tile-{{tone}} 为动态拼接，静态侧无法判定具体 tone */
        if (token === 'jg-tile-') {
          continue;
        }
        assert.ok(defined.has(token), `${page}.wxml 使用了未定义的样式 .${token}`);
      }
    }
  }
});

test('F1-A 角色选择页迁移到 jg- 并注册公共组件', () => {
  const wxml = read(pageFile('role-select', 'wxml'));
  const config = JSON.parse(read(pageFile('role-select', 'json')));

  assert.match(wxml, /<jg-page-head/, '角色选择页应使用统一页头组件');
  assert.match(wxml, /<jg-empty/, '角色选择页应使用统一空状态组件');
  assert.equal(
    config.usingComponents['jg-page-head'],
    '/components/jg-page-head/jg-page-head'
  );
  assert.equal(config.usingComponents['jg-empty'], '/components/jg-empty/jg-empty');
  assert.ok(wxml.includes('bindtap="selectRole"'), '角色选择动作必须保留');
});

test('F1-A developer 工作台四个分区使用一致的区块标题', () => {
  const wxml = read(pageFile('admin', 'wxml'));
  const sectionHeaders = wxml.match(/jg-sect-t"/g) || [];
  assert.ok(
    sectionHeaders.length >= 4,
    `开发者工作台应有 ≥4 个统一区块标题（实际 ${sectionHeaders.length}）`
  );
  /* 不应再出现"卡片标题承担区块标题"的旧写法 */
  assert.ok(
    !/<text class="jg-card-t">账号与角色<\/text>/.test(wxml),
    '账号与角色应使用区块标题而非卡片标题'
  );
  assert.ok(
    !/<text class="jg-card-t">训练组与教练范围<\/text>/.test(wxml),
    '训练组与教练范围应使用区块标题而非卡片标题'
  );
});

/* -------------------------------------------------------- 功能与业务保护 */

test('F1-A 学生首页保留原有 6 个常用入口且路由处理器不变', () => {
  const wxml = read(pageFile('student', 'wxml'));

  const handlers = [
    'goPlans',
    'goReport',
    'goPerformance',
    'goStatistics',
    'goPerformanceLeaderboard',
    'goCompetitions'
  ];
  for (const handler of handlers) {
    assert.match(
      wxml,
      new RegExp(`bindtap="${handler}"`),
      `学生常用入口 ${handler} 不得丢失`
    );
  }

  const tiles = wxml.match(/class="jg-tile jg-tile-[a-z]+"/g) || [];
  assert.equal(tiles.length, 6, `学生常用入口应保持 6 个（实际 ${tiles.length}）`);
  assert.match(wxml, /class="jg-tiles"/, '学生首页应采用 V1 双列快捷面板布局');

  /* 6 个入口之外，"全部功能"与退出必须仍在 */
  assert.match(wxml, /bindtap="goAllFeatures"/, '学生首页应保留全部功能入口');
  assert.match(wxml, /bindtap="goHome"/, '学生首页应保留退出入口');
});

test('F1-A 四个工作台都保留「全部功能」入口且指向同一页面', () => {
  const pages = { student: 'student', coach: 'coach', parent: 'parent', admin: 'admin' };
  for (const [role, dir] of Object.entries(pages)) {
    const js = read(pageFile(dir, 'js'));
    const wxml = read(pageFile(dir, 'wxml'));
    assert.ok(js.includes('goAllFeatures('), `${role} 工作台应定义 goAllFeatures`);
    assert.match(
      js,
      /navigateTo\(\{\s*url:\s*'\/pages\/all-features\/all-features'\s*\}\)/,
      `${role} 工作台应跳转到全部功能页`
    );
    assert.ok(
      wxml.includes('bindtap="goAllFeatures"'),
      `${role} 工作台应提供全部功能入口按钮`
    );
  }
});

test('F1-A 家长端视觉改造未引入写入能力（只读语义）', () => {
  const wxml = read(pageFile('parent', 'wxml'));
  const js = read(pageFile('parent', 'js'));

  /* 只读页面不得出现实底主按钮/强调写按钮 */
  assert.ok(!wxml.includes('jg-btn-accent'), '家长端不得出现橙色主行动按钮');
  assert.ok(
    !wxml.includes('class="jg-btn '),
    '家长端不得出现实底主按钮（仅允许幽灵按钮）'
  );

  /* 只读数据接口保持不变，未新增写接口调用 */
  const writeApis = /(submit|create|update|review|revoke|redeem|approve|reject)[A-Za-z]*\(/g;
  const calls = (js.match(writeApis) || []).filter((name) => !/^(createWorkbench|updateTime)/.test(name));
  assert.deepEqual(calls, [], `家长工作台不应调用写接口：${calls.join(', ')}`);

  /* section 深链接与关联管理入口必须保留 */
  assert.match(wxml, /scroll-into-view="/, '家长页内跳转不得丢失');
  assert.match(js, /pendingSection|section/, '家长 section 深链接解析不得丢失');
  assert.match(wxml, /bindtap="goBind"/, '家长关联管理入口不得丢失');
});

test('F1-A 全部功能目录配置与角色映射未被视觉改造改动', () => {
  const catalog = require(path.join(PROJECT_ROOT, 'miniprogram/config/feature-catalog.js'));
  assert.deepEqual(catalog.ROLE_ORDER, ['student', 'coach', 'parent', 'developer']);
  for (const role of catalog.ROLE_ORDER) {
    assert.ok(catalog.hasCatalog(role), `${role} 应存在功能目录`);
    assert.ok(catalog.featuresForRole(role).length > 0, `${role} 目录不得为空`);
  }
  /* 家长端仍然只读且 section 深链接保留 */
  const parentUrls = catalog.featuresForRole('parent').map((item) => item.url);
  for (const url of parentUrls) {
    const pathOnly = url.split('?')[0];
    assert.ok(
      ['/pages/parent/parent', '/pages/parent-bind/parent-bind'].includes(pathOnly),
      `家长端入口只能指向只读页面：${url}`
    );
  }
  assert.ok(
    parentUrls.some((url) => url.includes('?section=')),
    '家长端 section 深链接不得丢失'
  );
});
