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
  const nums = [0, 2, 4].map((i) => {
    const s = parseInt(clean.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * nums[0] + 0.7152 * nums[1] + 0.0722 * nums[2];
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

test('V1.6.5 品牌色板与全局窗口配置为黑+白+科技蓝，无 native tabBar', () => {
  const appJson = JSON.parse(read('miniprogram/app.json'));
  assert.equal(appJson.window.navigationBarBackgroundColor, '#000000');
  assert.equal(appJson.window.navigationBarTextStyle, 'white');
  assert.equal(appJson.window.backgroundColor, '#000000');
  assert.equal(appJson.tabBar, undefined, '禁止引入原生 tabBar');
  assert.equal(appJson.pages.length, 37, '应保持 37 个已注册页面');

  const appWxss = read('miniprogram/app.wxss');
  const tokens = [
    '--jg-void: #000000',
    '--jg-base: #0A0C10',
    '--jg-surface: #111419',
    '--jg-accent: #00A6FF',
    '--jg-accent-hi: #38BDF8',
    '--jg-line: rgba(255, 255, 255, 0.24)',
    '--jg-text-hi: #FFFFFF',
    '--jg-text-mid: #A3ADB8',
    '--jg-cta-bg: #FFFFFF',
    '--jg-cta-text: #000000'
  ];
  for (const token of tokens) {
    assert.ok(appWxss.includes(token), `app.wxss 缺少 V1.6.5 令牌：${token}`);
  }
  assert.ok(appWxss.includes('.jg-page.jg-daylight'), '必须定义日光高对比模式 .jg-page.jg-daylight');
});

test('V1.6.5 暗夜与日光高对比核心配色对比度均满足 WCAG AA (>= 4.5:1)', () => {
  const pairs = [
    ['暗夜主文/OLED纯黑', '#FFFFFF', '#000000'],
    ['暗夜次文/石墨面', '#A3ADB8', '#111419'],
    ['暗夜主科技蓝/纯黑', '#00A6FF', '#000000'],
    ['暗夜高亮科技蓝/纯黑', '#38BDF8', '#000000'],
    ['暗夜主按钮黑字/纯白底', '#000000', '#FFFFFF'],
    ['日光正文/纯白面', '#000000', '#FFFFFF'],
    ['日光次文/纯白面', '#4B5563', '#FFFFFF'],
    ['日光加深科技蓝/纯白', '#006BB3', '#FFFFFF'],
    ['日光数值科技蓝/纯白', '#005596', '#FFFFFF'],
    ['日光主按钮白字/纯黑底', '#FFFFFF', '#000000']
  ];
  for (const [label, fg, bg] of pairs) {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `${label} (${fg} on ${bg}) 对比度仅 ${ratio.toFixed(2)}:1 < 4.5:1`);
  }
});

test('V1.6.5 全站 miniprogram 零橙色残留', () => {
  const orangeRe = /#(F2711C|B54A07|D95F0E|EE8300|FF9E2C|FDEDE2|FFF6E5|FEF6E7|B45309|7A4308|8A5A12|FFC46B|F1DDB6|F7D0B4)\b/i;
  const files = walkFiles(path.join(ROOT, 'miniprogram'), ['.wxss', '.wxml', '.js', '.json']);
  const hits = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const clean = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    const m = clean.match(orangeRe);
    if (m) {
      hits.push(`${path.relative(ROOT, file)} => ${m[0]}`);
    }
  }
  assert.deepEqual(hits, [], `发现橙色残留：${hits.join('; ')}`);
});

test('V1.6.5 动效类齐全、曲线统一、禁用 CSS 清零、含减弱动效与 3D 降级', () => {
  const appWxss = read('miniprogram/app.wxss');
  const motionClasses = [
    '.jg-enter-fwd',
    '.jg-enter-back',
    '.jg-rise',
    '.jg-stagger',
    '.jg-num-roll',
    '.jg-skel-shimmer',
    '.jg-reveal',
    '.jg-scan',
    '.jg-flip',
    '.jg-shake',
    '.jg-spin-ring',
    '.jg-check-pop',
    '.jg-pulse-ring',
    '.jg-timeline',
    '.jg-drawer-mask',
    '.jg-swipe-box',
    '.jg-ptr-ring'
  ];
  for (const cls of motionClasses) {
    assert.ok(appWxss.includes(cls), `app.wxss 缺少动效类 ${cls}`);
  }
  assert.ok(appWxss.includes('cubic-bezier(0.16, 1, 0.3, 1)'), '必须使用统一缓动曲线 cubic-bezier(0.16, 1, 0.3, 1)');
  assert.ok(appWxss.includes('@supports not (transform-style: preserve-3d)'), 'app.wxss 必须含 3D 翻面 2D 降级');
  assert.ok(appWxss.includes('@media (prefers-reduced-motion: reduce)'), 'app.wxss 必须含减弱动效降级');

  const wxssFiles = [
    'miniprogram/app.wxss',
    'miniprogram/components/jg-flip-card/jg-flip-card.wxss',
    'miniprogram/components/jg-stat-ring/jg-stat-ring.wxss',
    'miniprogram/components/jg-action-dock/jg-action-dock.wxss',
    'miniprogram/components/jg-page-head/jg-page-head.wxss',
    'miniprogram/components/jg-empty/jg-empty.wxss'
  ];
  for (const rel of wxssFiles) {
    const clean = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(clean, /display\s*:\s*(inline-)?grid\b/i, `${rel} 禁止 CSS Grid`);
    assert.doesNotMatch(clean, /backdrop-filter|filter\s*:\s*blur|position\s*:\s*sticky/i, `${rel} 禁止 backdrop-filter/blur/sticky`);
    assert.doesNotMatch(clean, /\*/, `${rel} 禁止 WXSS 通配符选择器 *`);
  }
});

test('V1.6.5 三大自包含新组件与 WXS 手势层、Canvas DPR 限制符合规范', () => {
  for (const comp of ['jg-flip-card', 'jg-stat-ring', 'jg-action-dock']) {
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      const full = path.join(ROOT, `miniprogram/components/${comp}/${comp}.${ext}`);
      assert.ok(fs.existsSync(full), `缺少组件文件 ${comp}.${ext}`);
    }
  }
  const flipJs = read('miniprogram/components/jg-flip-card/jg-flip-card.js');
  const flipWxss = read('miniprogram/components/jg-flip-card/jg-flip-card.wxss');
  assert.match(flipJs, /SDKVersion/, 'jg-flip-card 必须检查基础库版本以自动降级 2D');
  assert.match(flipWxss, /@supports not \(transform-style: preserve-3d\)/, 'jg-flip-card 必须有 2D 降级');
  assert.match(flipWxss, /@media \(prefers-reduced-motion: reduce\)/, 'jg-flip-card 必须支持减弱动效');

  const dockWxss = read('miniprogram/components/jg-action-dock/jg-action-dock.wxss');
  assert.match(dockWxss, /height:\s*88rpx/, '单排操作坞行高应为 88rpx (<= 112rpx)');
  assert.match(dockWxss, /env\(safe-area-inset-bottom\)/, '操作坞必须贴合底部安全区');

  assert.ok(fs.existsSync(path.join(ROOT, 'miniprogram/utils/motion.wxs')), '缺少渲染层 WXS 手势控制器');
  const trendJs = read('miniprogram/components/trend-chart/trend-chart.js');
  assert.match(trendJs, /Math\.min\(.*2\)/, 'Canvas DPR 必须锁定 <= 2');
  assert.match(trendJs, /detached\s*\(\)/, 'Canvas 组件必须在 detached 清理动画帧');

  const previewJs = read('miniprogram/pages/ui-preview/ui-preview.js');
  assert.doesNotMatch(previewJs, /const\s+steps\s*=\s*20/, '试穿页不得使用 setData 逐帧循环');
});

test('V1.6.5 7 个核心页落地横向 Deck + 双栏表 + 底部抽屉 + 分步表单，37 页全覆盖且入口版本为 V1.6.5', () => {
  const studentWxml = read('miniprogram/pages/student/student.wxml');
  assert.match(studentWxml, /<jg-flip-card/, '学生首页 PB 卡应支持 3D 翻面');
  assert.match(studentWxml, /<jg-stat-ring/, '学生首页应包含环形出勤仪表');
  assert.match(studentWxml, /jg-timeline/, '学生首页今日训练应使用局部时间轴');
  assert.match(studentWxml, /<jg-deck-rail/, '学生首页应挂载顶部横向索引轨');
  assert.match(studentWxml, /<swiper/, '学生首页应使用横向 Deck swiper');
  assert.doesNotMatch(studentWxml, /<jg-action-dock/, '学生首页不得保留底部 5 项跳转坞');

  const coachWxml = read('miniprogram/pages/coach/coach.wxml');
  assert.match(coachWxml, /motion\.wxs/, '教练页应引入 WXS 手势层');
  assert.match(coachWxml, /jg-swipe-box/, '教练待办行应支持左滑手势');
  assert.match(coachWxml, /<jg-stat-ring/, '教练页应包含到课率环形仪表');
  assert.match(coachWxml, /<jg-deck-rail/, '教练页应挂载顶部横向索引轨');
  assert.match(coachWxml, /<swiper/, '教练页应使用横向 Deck swiper');
  assert.doesNotMatch(coachWxml, /<jg-action-dock/, '教练页不得保留底部 5 项跳转坞');

  const parentWxml = read('miniprogram/pages/parent/parent.wxml');
  assert.match(parentWxml, /jg-reveal/, '家长页切换学生应使用遮罩揭示');
  assert.match(parentWxml, /<jg-flip-card/, '家长页 PB 卡应支持只读翻面');
  assert.match(parentWxml, /<jg-deck-rail/, '家长页应挂载只读顶部横向索引轨');
  assert.match(parentWxml, /<swiper/, '家长页应使用横向 Deck swiper');
  assert.doesNotMatch(parentWxml, /<jg-action-dock/, '家长页不得保留底部 5 项跳转坞');

  const adminWxml = read('miniprogram/pages/admin/admin.wxml');
  assert.match(adminWxml, /<jg-deck-rail/, '开发者页应挂载顶部横向索引轨');
  assert.match(adminWxml, /<swiper/, '开发者页应使用横向 Deck swiper');
  assert.doesNotMatch(adminWxml, /<jg-action-dock/, '开发者页不得保留底部 5 项跳转坞');
  assert.match(adminWxml, /goUiPreview/, '开发者页必须保留 ui-preview 入口');

  const rankWxml = read('miniprogram/pages/performance-leaderboard/performance-leaderboard.wxml');
  assert.match(rankWxml, /jg-scan/, '排行榜切换条件应触发光栅扫描');
  assert.match(rankWxml, /jg-tbl/, '排行榜应使用双栏连续粗野表格');
  assert.match(rankWxml, /jg-drawer-sheet/, '排行榜应使用底部筛选与详情抽屉');

  const attWxml = read('miniprogram/pages/student-attendance/student-attendance.wxml');
  assert.match(attWxml, /jg-pulse-wrap/, '签到页结果应包含三层脉冲确认');
  assert.match(attWxml, /<jg-deck-rail/, '签到页应使用 3 页横向 Deck');
  assert.doesNotMatch(attWxml, /<jg-action-dock/, '长表单页不得放置底栏操作坞');

  const planEditWxml = read('miniprogram/pages/coach-plan-edit/coach-plan-edit.wxml');
  assert.match(planEditWxml, /jg-timeline/, '计划编辑页训练内容应使用局部时间轴');
  assert.match(planEditWxml, /<jg-deck-rail/, '计划编辑页应使用 3 步横向表单');
  assert.doesNotMatch(planEditWxml, /<jg-action-dock/, '计划编辑长表单页不得放置底栏操作坞');

  const indexWxml = read('miniprogram/pages/index/index.wxml');
  assert.match(indexWxml, /V1\.6\.5/, '入口页版本号应更新为 V1.6.5');

  const appJson = JSON.parse(read('miniprogram/app.json'));
  for (const p of appJson.pages) {
    const wxml = read(`miniprogram/${p}.wxml`);
    if (p === 'pages/ui-preview/ui-preview') {
      assert.match(wxml, /pv-page/, '试穿页根容器完整');
    } else {
      assert.match(wxml, /jg-page/, `${p} 必须使用 V1.6.5 jg-page 体系`);
      assert.match(wxml, /jg-enter-fwd/, `${p} 必须接入方向性入场动效`);
    }
  }
});
