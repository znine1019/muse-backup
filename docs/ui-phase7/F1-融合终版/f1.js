/* ==========================================================================
   乔格训迹 V1.6 · 阶段7 · F1 融合终版交互层
   纯本地模拟：不连接 CloudBase、不调用定位接口、不写入任何真实数据。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 模拟数据 ---------- */
  var BASE = {
    all: { students: 33, rate: 94.2, attendance: 268, expected: 284, approved: 126, feedback: 89, attention: 6, rpe: 7.1 },
    g1:  { students: 18, rate: 94.2, attendance: 148, expected: 157, approved: 71, feedback: 48, attention: 4, rpe: 7.2 },
    g2:  { students: 15, rate: 91.5, attendance: 120, expected: 131, approved: 55, feedback: 41, attention: 2, rpe: 6.9 },
    mid: { students: 16, rate: 96.1, attendance: 301, expected: 313, approved: 88, feedback: 63, attention: 1, rpe: 6.6 }
  };
  var GROUP_LABEL = { all: '全部训练组', g1: '短跑一组', g2: '短跑二组', mid: '中长跑组' };

  var PERIODS = {
    month: {
      label: '2026年10月', estimated: false, scale: 1,
      trendKey: ['第1周', '第2周', '第3周', '第4周'],
      trend: {
        rate: [91, 88, 95, 94],
        approved: [22, 31, 28, 45],
        feedback: [18, 24, 21, 26]
      }
    },
    quarter: {
      label: '2026年 Q3', estimated: false, scale: 2.85,
      trendKey: ['7月', '8月', '9月'],
      trend: {
        rate: [88, 92, 94],
        approved: [78, 96, 112],
        feedback: [54, 66, 72]
      }
    },
    year: {
      label: '2026年全年', estimated: true, scale: 9.4,
      trendKey: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      trend: {
        rate: [64, 72, 58, 79, 85, 74, 88, 82, 91, 94, null, null],
        approved: [42, 55, 38, 61, 74, 66, 88, 79, 96, 112, null, null],
        feedback: [28, 36, 22, 41, 52, 44, 61, 58, 70, 74, null, null]
      }
    }
  };

  var METRIC = {
    rate: { name: '出勤率', unit: '%', decimals: 0 },
    approved: { name: '已审核成绩', unit: '条', decimals: 0 },
    feedback: { name: '训练反馈', unit: '条', decimals: 0 }
  };

  var PLAN_TYPES = {
    sprint: {
      name: '短跑专项',
      hint: '短跑按「距离 → 组数 → 次数 → 组间休息」组织，其余参数可渐进展开。',
      core: [
        { k: 'distance', label: '距离', value: 60, unit: '米', min: 10, max: 400, step: 10, type: 'num' },
        { k: 'sets', label: '组数', value: 6, unit: '组', min: 1, max: 20, step: 1, type: 'num' },
        { k: 'reps', label: '每组次数', value: 1, unit: '次', min: 1, max: 20, step: 1, type: 'num' },
        { k: 'rest', label: '组间休息', value: 180, unit: '秒', min: 15, max: 600, step: 15, type: 'num' }
      ]
    },
    strength: {
      name: '力量训练',
      hint: '力量训练以「动作 → 组数 → 次数 → 负荷」为核心，负荷可填写重量或 %1RM。',
      core: [
        { k: 'movement', label: '动作', value: '杠铃深蹲', type: 'text' },
        { k: 'sets', label: '组数', value: 5, unit: '组', min: 1, max: 20, step: 1, type: 'num' },
        { k: 'reps', label: '每组次数', value: 5, unit: '次', min: 1, max: 30, step: 1, type: 'num' },
        { k: 'load', label: '负荷', value: '80% 1RM', type: 'text' }
      ]
    },
    endurance: {
      name: '速度耐力',
      hint: '速度耐力按「距离 → 组数 → 组间休息 → 目标强度」组织，用于乳酸耐受与配速控制。',
      core: [
        { k: 'distance', label: '距离', value: 150, unit: '米', min: 50, max: 1000, step: 10, type: 'num' },
        { k: 'sets', label: '组数', value: 5, unit: '组', min: 1, max: 20, step: 1, type: 'num' },
        { k: 'rest', label: '组间休息', value: 120, unit: '秒', min: 15, max: 600, step: 15, type: 'num' },
        { k: 'intensity', label: '目标强度', value: '90%', type: 'text' }
      ]
    },
    recovery: {
      name: '恢复训练',
      hint: '恢复训练按「时长 → 强度 → 方式 → 组数」组织，避免高负荷，优先保证恢复质量。',
      core: [
        { k: 'duration', label: '时长', value: 30, unit: '分钟', min: 5, max: 120, step: 5, type: 'num' },
        { k: 'intensity', label: '强度', value: '低强度', type: 'text' },
        { k: 'method', label: '方式', value: '慢跑 + 拉伸', type: 'text' },
        { k: 'sets', label: '组数', value: 3, unit: '组', min: 1, max: 10, step: 1, type: 'num' }
      ]
    }
  };

  var state = {
    screen: 'student',
    vw: '390',
    statPeriod: 'month',
    statGroup: 'g1',
    statMetric: 'rate',
    planType: 'sprint',
    planCore: {},
    planItems: [],
    planSeq: 0,
    locationPicked: false,
    checkedIn: false,
    coachTab: 'all',
    radius: 150,
    accuracy: 50
  };

  var TIMES = ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30'];

  /* ---------- 工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmt(n, d) {
    if (n === null || n === undefined) return '—';
    var v = Number(n).toFixed(d || 0);
    return d ? v : String(Math.round(Number(n)));
  }
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2100);
  }

  /* ---------- 页面切换 ---------- */
  function applyScreen(target) {
    state.screen = target;
    $$('.device-wrap').forEach(function (w) {
      w.style.display = (target === 'all' || w.dataset.screen === target) ? '' : 'none';
    });
    $$('#boardTabs button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.go === target));
    });
  }

  /* ---------- 统计工作台 ---------- */
  function currentStats() {
    var base = BASE[state.statGroup] || BASE.g1;
    var p = PERIODS[state.statPeriod];
    var scale = p.scale * (state.statGroup === 'all' ? 1 : 1);
    return {
      period: p,
      groupLabel: GROUP_LABEL[state.statGroup],
      students: base.students,
      rate: p.estimated ? Math.max(0, base.rate - 1.6) : base.rate,
      attendance: Math.round(base.attendance * scale),
      expected: Math.round(base.expected * scale),
      approved: Math.round(base.approved * scale),
      feedback: Math.round(base.feedback * scale),
      attention: state.statPeriod === 'year' ? base.attention + 2 : base.attention,
      rpe: base.rpe
    };
  }

  function renderStats() {
    var s = currentStats();
    var setText = function (sel, v) { var el = $(sel); if (el) el.textContent = v; };
    setText('#statPeriodLabel', s.period.label);
    setText('#statGroupLabel', s.groupLabel);
    setText('#statRate', fmt(s.rate, 1));
    setText('#statAttendance', fmt(s.attendance));
    setText('#statExpected', fmt(s.expected));
    setText('#statApproved', fmt(s.approved));
    setText('#statFeedback', fmt(s.feedback));
    setText('#statAttention', fmt(s.attention));
    setText('#statRpe', fmt(s.rpe, 1));
    setText('#statStudents', s.students + ' 名学生');
    setText('#statStudents2', String(s.students));

    var rateChip = $('#statRateChip');
    if (rateChip) {
      rateChip.textContent = s.period.estimated ? '估算口径' : '环比 +2.1 个百分点';
      rateChip.className = 'd-chip ' + (s.period.estimated ? 'goal' : 'up');
    }
    var caveat = $('#statCaveat');
    if (caveat) caveat.classList.toggle('hide', !s.period.estimated);

    // 训练组对比（随周期缩放）
    var groups = [
      { n: '短跑一组', v: 94.2, me: state.statGroup === 'g1' },
      { n: '短跑二组', v: 91.5, me: state.statGroup === 'g2' },
      { n: '中长跑组', v: 96.1, me: state.statGroup === 'mid' }
    ];
    var cmpHost = $('#statCmp');
    if (cmpHost) {
      cmpHost.innerHTML = groups.map(function (g) {
        var v = Math.max(0, g.v - (s.period.estimated ? 1.4 : 0));
        var num = fmt(v, 1) + '%';
        return '<div class="cmp-r"><span class="cn">' + g.n + (g.me ? ' · 当前' : '') + '</span>' +
          '<span class="cb"><i class="' + (g.me ? 'me' : '') + '" style="width:' + v + '%"></i></span>' +
          '<span class="cv">' + num + '</span></div>';
      }).join('');
    }

    renderChart();
  }

  function renderChart() {
    var s = currentStats();
    var host = $('#statBars');
    if (!host) return;
    var raw = s.period.trend[state.statMetric].slice();
    if (state.statGroup !== 'all') {
      var shift = state.statGroup === 'g1' ? 0 : (state.statGroup === 'g2' ? -2.4 : 1.8);
      raw = raw.map(function (v) { return v === null ? null : Math.max(0, Number(v) + (state.statMetric === 'rate' ? shift : 0)); });
    }
    var nums = raw.filter(function (v) { return v !== null; }).map(Number);
    var max = Math.max.apply(null, nums.concat([1]));
    var m = METRIC[state.statMetric];
    host.innerHTML = raw.map(function (v, i) {
      var isNow = i === raw.length - 1 || (state.statPeriod === 'year' && i === 9);
      if (v === null) {
        return '<div class="b" style="height:6px;background:#EEF2F7" data-null="1"></div>';
      }
      var h = Math.max(8, Math.round((Number(v) / max) * 100));
      var shown = state.statMetric === 'rate' ? fmt(v, 0) : fmt(v, 0);
      return '<div class="b' + (isNow ? ' now' : '') + (state.statMetric === 'rate' && isNow ? ' hot' : '') +
        '" style="height:' + h + '%"><span class="bv">' + shown + '</span></div>';
    }).join('');
    var xHost = $('#statBarX');
    if (xHost) {
      xHost.innerHTML = s.period.trendKey.map(function (k) { return '<span>' + k + '</span>'; }).join('');
    }
    var unitEl = $('#statChartUnit');
    if (unitEl) unitEl.textContent = m.unit + ' · ' + m.name;
    var totalEl = $('#statChartTotal');
    if (totalEl) {
      var sum = nums.reduce(function (a, b) { return a + b; }, 0);
      totalEl.textContent = state.statMetric === 'rate'
        ? '均值 ' + fmt(sum / Math.max(1, nums.length), 1) + '%'
        : '合计 ' + fmt(sum) + ' ' + m.unit;
    }
  }

  /* ---------- 训练计划：核心参数动态渲染 ---------- */
  function initPlanCore() {
    state.planCore = {};
    PLAN_TYPES[state.planType].core.forEach(function (c) {
      state.planCore[c.k] = c.type === 'num' ? c.value : c.value;
    });
  }

  function renderPlan() {
    var t = PLAN_TYPES[state.planType];
    $$('#planTypes .typecard').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.ptype === state.planType));
    });
    var hint = $('#planTypeHint');
    if (hint) hint.textContent = t.hint;

    var host = $('#planCore');
    if (host) {
      host.innerHTML = t.core.map(function (c) {
        var v = state.planCore[c.k];
        if (c.type === 'num') {
          return '<div class="core"><div class="co-l"><span>' + c.label + '</span><span class="co-tag">核心</span></div>' +
            '<div class="stepper" style="margin-top:9px;border:none;padding:0">' +
            '<button class="sb" data-act="core-step" data-key="' + c.k + '" data-dir="-1" aria-label="' + c.label + '减少">−</button>' +
            '<span class="sv">' + v + '<em>' + c.unit + '</em></span>' +
            '<button class="sb" data-act="core-step" data-key="' + c.k + '" data-dir="1" aria-label="' + c.label + '增加">+</button>' +
            '</div></div>';
        }
        return '<div class="core inputcore"><div class="co-l"><span>' + c.label + '</span><span class="co-tag">核心</span></div>' +
          '<div class="input" style="margin-top:9px;min-height:42px"><input data-act="core-text" data-key="' + c.k + '" value="' + v + '" aria-label="' + c.label + '"></div></div>';
      }).join('');
    }
    renderPlanItems();
  }

  function coreSummary() {
    var t = PLAN_TYPES[state.planType];
    return t.core.map(function (c) {
      var v = state.planCore[c.k];
      return '<span class="pchip">' + c.label + ' <b>' + v + (c.unit || '') + '</b></span>';
    }).join('');
  }

  function renderPlanItems() {
    var host = $('#planItems');
    var empty = $('#planItemsEmpty');
    if (!host) return;
    var counter = $('#planItemCount');
    if (counter) counter.textContent = state.planItems.length + ' 项';
    if (!state.planItems.length) {
      host.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    host.innerHTML = state.planItems.map(function (it, i) {
      return '<div class="iblock"><div class="ib-h"><span class="ib-n">' + (i + 1) + '</span>' +
        '<span class="ib-t">' + it.name + ' <span class="chip brand">' + it.typeName + '</span></span>' +
        '<button class="ib-x" data-act="plan-del-item" data-id="' + it.id + '">删除</button></div>' +
        '<div class="ib-params">' + it.summary + '</div></div>';
    }).join('');
  }

  /* ---------- 教练待办 ---------- */
  function applyCoachTab(cat) {
    state.coachTab = cat;
    var host = $('#coachTodos');
    if (!host) return;
    var rows = $$('.todo', host);
    var shown = 0;
    rows.forEach(function (r) {
      var match = (cat === 'all' || r.dataset.cat === cat);
      r.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    $$('#coachTabs .tab').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.cat === cat));
    });
    var empty = $('#coachEmpty');
    if (empty) empty.style.display = shown ? 'none' : '';
  }

  function refreshCoachCounts() {
    var rows = $$('#coachTodos .todo').filter(function (r) { return r.style.display !== 'none' || true; });
    var alive = $$('#coachTodos .todo');
    var counts = { all: alive.length, leave: 0, score: 0, event: 0, feedback: 0 };
    alive.forEach(function (r) { if (counts[r.dataset.cat] !== undefined) counts[r.dataset.cat]++; });
    $$('#coachTabs .tab').forEach(function (b) {
      var n = b.querySelector('.n');
      if (n) n.textContent = counts[b.dataset.cat] || 0;
    });
    var strip = $('#coachPendingTotal');
    if (strip) strip.textContent = '共 ' + counts.all + ' 项';
    return counts;
  }

  /* ---------- GPS 地图模拟 ---------- */
  var MAP_BASE = { lat: 30.6582, lng: 104.0653 };
  function setMapPosition(px, py) {
    var map = $('#gpsMap');
    if (!map) return;
    var rect = map.getBoundingClientRect();
    px = Math.max(12, Math.min(rect.width - 12, px));
    py = Math.max(12, Math.min(rect.height - 12, py));
    var pin = $('.pin', map);
    var ring = $('.ring', map);
    if (pin) { pin.style.left = px + 'px'; pin.style.top = py + 'px'; }
    if (ring) { ring.style.left = px + 'px'; ring.style.top = py + 'px'; }
    var hint = $('.mhint', map);
    if (hint) hint.classList.add('hide');
    // 线性映射为模拟坐标（非真实地理数据）
    var dLat = (rect.height / 2 - py) / rect.height * 0.0055;
    var dLng = (px - rect.width / 2) / rect.width * 0.0062;
    var lat = (MAP_BASE.lat + dLat).toFixed(5);
    var lng = (MAP_BASE.lng + dLng).toFixed(5);
    var out = $('#gpsCoords');
    if (out) out.textContent = lat + ', ' + lng;
    state.locationPicked = true;
    var pub = $('#gpsPublish');
    if (pub) { pub.removeAttribute('disabled'); pub.removeAttribute('aria-disabled'); }
    var badge = $('#gpsStep2State');
    if (badge) badge.textContent = '已选点';
  }

  function setRadius(r) {
    state.radius = r;
    var el = $('#radiusValue');
    if (el) el.textContent = r;
    var ring = $('#gpsMap .ring');
    if (ring) {
      var size = Math.round(56 + (r / 500) * 150);
      ring.style.width = size + 'px';
      ring.style.height = size + 'px';
    }
    var note = $('#radiusReadout');
    if (note) note.textContent = r + ' 米';
  }

  function setAccuracy(a) {
    state.accuracy = a;
    var el = $('#accuracyValue');
    if (el) el.textContent = a;
    var note = $('#accuracyReadout');
    if (note) note.textContent = '±' + a + ' 米';
  }

  /* ---------- 事件 ---------- */
  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act;

    // 看板：页面切换 / 视口切换
    if (act === 'screen') { applyScreen(el.dataset.go); window.scrollTo({ top: 0 }); return; }
    if (act === 'vw') {
      state.vw = el.dataset.vw;
      document.body.dataset.vw = state.vw;
      $$('.btns[data-group="vw"] button').forEach(function (b) {
        b.setAttribute('aria-selected', String(b.dataset.vw === state.vw));
      });
      $$('.devlabel .sz').forEach(function (s) { s.textContent = state.vw === '375' ? '375×812' : '390×844'; });
      return;
    }

    // 通用 tab 组
    if (act === 'tab') {
      var group = el.dataset.group;
      var val = el.dataset.val;
      var host = el.closest('[data-tabgroup="' + group + '"]') || el.parentElement;
      $$('[data-act="tab"][data-group="' + group + '"]', host).forEach(function (b) {
        b.setAttribute('aria-selected', String(b.dataset.val === val));
      });
      if (group === 'coach') applyCoachTab(val);
      if (group === 'statPeriod') { state.statPeriod = val; renderStats(); }
      if (group === 'statMetric') { state.statMetric = val; renderChart(); }
      if (group === 'planCoreTab') { /* 纯展示占位 */ }
      return;
    }

    // 轻提示（纯展示入口）
    if (act === 'toast') { toast(el.dataset.msg || '原型演示：该功能在全站实施轮实现'); return; }

    // 统计：切换训练组（模拟筛选）
    if (act === 'cycle-group') {
      var order = ['g1', 'g2', 'mid', 'all'];
      var ci = order.indexOf(state.statGroup);
      state.statGroup = order[(ci + 1) % order.length];
      var shortEl = $('#statGroupShort');
      if (shortEl) shortEl.textContent = GROUP_LABEL[state.statGroup];
      renderStats();
      toast('已切换到「' + GROUP_LABEL[state.statGroup] + '」（模拟筛选）');
      return;
    }

    // 学生签到
    if (act === 'checkin') {
      if (state.checkedIn) { toast('今日已签到，无需重复操作'); return; }
      state.checkedIn = true;
      var st = $('#todayState');
      if (st) { st.textContent = '已签到 16:04'; st.className = 'chip ok'; }
      var btn = $('#checkinBtn');
      if (btn) { btn.textContent = '已签到'; btn.setAttribute('aria-disabled', 'true'); btn.disabled = true; }
      toast('签到成功（模拟）：16:04 · 田径场 A 区范围内');
      return;
    }

    // 教练待办处理
    if (act === 'todo-done') {
      var row = el.closest('.todo');
      var label = el.dataset.label || '已处理';
      if (row) {
        row.style.transition = 'opacity .2s';
        row.style.opacity = '0';
        setTimeout(function () {
          row.remove();
          refreshCoachCounts();
          applyCoachTab(state.coachTab);
        }, 180);
      }
      toast(label + '（模拟，不写入真实数据）');
      return;
    }

    // 数值步进器（通用）
    if (act === 'step') {
      var target = $(el.dataset.target);
      if (!target) return;
      var min = Number(el.dataset.min), max = Number(el.dataset.max), step = Number(el.dataset.step || 1);
      var cur = Number(target.dataset.value || target.textContent.replace(/[^\d.-]/g, '')) || 0;
      var next = Math.max(min, Math.min(max, cur + Number(el.dataset.dir) * step));
      target.dataset.value = String(next);
      target.textContent = String(next);
      var read = el.dataset.readout ? $(el.dataset.readout) : null;
      if (read) read.textContent = next;
      if (el.dataset.effect === 'radius') setRadius(next);
      if (el.dataset.effect === 'accuracy') setAccuracy(next);
      return;
    }

    // 折叠分组
    if (act === 'acc') {
      var acc = el.closest('.acc');
      if (acc) acc.dataset.open = acc.dataset.open === 'true' ? 'false' : 'true';
      return;
    }

    // 地图
    if (act === 'use-location') {
      var map = $('#gpsMap');
      if (map) {
        var r = map.getBoundingClientRect();
        setMapPosition(r.width / 2 + 18, r.height / 2 - 26);
      }
      var acc0 = $('#gpsAccuracy'); if (acc0) acc0.textContent = '±18 米';
      toast('已使用当前位置（模拟定位，未调用真实接口）');
      return;
    }

    // 时间选择（点击循环预设，模拟 picker）
    if (act === 'time') {
      var idx = Number(el.dataset.idx || 0);
      var next2 = TIMES[(TIMES.indexOf(el.dataset.val) + 1) % TIMES.length];
      el.dataset.val = next2;
      var span = el.querySelector('span');
      if (span) span.textContent = next2;
      toast('时间已调整为 ' + next2 + '（模拟 picker）');
      return;
    }

    // 训练类型切换
    if (act === 'plan-type') {
      state.planType = el.dataset.ptype;
      initPlanCore();
      renderPlan();
      toast('已切换到「' + PLAN_TYPES[state.planType].name + '」，核心参数已按专项调整');
      return;
    }

    // 核心参数步进
    if (act === 'core-step') {
      var t = PLAN_TYPES[state.planType];
      var def = t.core.filter(function (c) { return c.k === el.dataset.key; })[0];
      if (!def) return;
      var val = Number(state.planCore[def.k]) + Number(el.dataset.dir) * def.step;
      val = Math.max(def.min, Math.min(def.max, val));
      state.planCore[def.k] = val;
      var sv = el.parentElement.querySelector('.sv');
      if (sv) sv.innerHTML = val + '<em>' + def.unit + '</em>';
      return;
    }

    // 添加 / 删除训练内容
    if (act === 'plan-add-item') {
      var ty = PLAN_TYPES[state.planType];
      state.planSeq += 1;
      state.planItems.push({
        id: 'item' + state.planSeq,
        name: ty.name + ' ' + state.planSeq,
        typeName: ty.name,
        summary: coreSummary()
      });
      renderPlanItems();
      toast('已添加训练内容（模拟，不写入真实计划）');
      return;
    }
    if (act === 'plan-del-item') {
      state.planItems = state.planItems.filter(function (i) { return i.id !== el.dataset.id; });
      renderPlanItems();
      toast('已移除该训练内容');
      return;
    }

    // 表单提交
    if (act === 'gps-publish') {
      if (!state.locationPicked) { toast('请先选择签到地点'); return; }
      toast('已发布考勤场次（模拟，未写入数据库）');
      return;
    }
    if (act === 'plan-save') { toast('草稿已保存（模拟，未写入数据库）'); return; }
    if (act === 'plan-publish') {
      if (!state.planItems.length) { toast('请至少添加一项训练内容'); return; }
      toast('训练计划已发布（模拟，未写入数据库）');
      return;
    }
  }

  function onMapClick(e) {
    var map = e.currentTarget;
    var rect = map.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;
    setMapPosition(px, py);
  }

  function onInput(e) {
    var el = e.target.closest('[data-act="core-text"]');
    if (el) { state.planCore[el.dataset.key] = el.value; }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    var params = new URLSearchParams(window.location.search);
    var shot = params.get('shot');
    var full = params.get('full');
    var vw = params.get('vw');
    if (vw === '375' || vw === '390') state.vw = vw;
    document.body.dataset.vw = state.vw;

    initPlanCore();
    renderPlan();

    var map = $('#gpsMap');
    if (map) map.addEventListener('click', onMapClick);
    setRadius(state.radius);
    setAccuracy(state.accuracy);

    renderStats();
    refreshCoachCounts();
    applyCoachTab('all');

    $$('.btns[data-group="vw"] button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.vw === state.vw));
    });

    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);

    if (shot) {
      document.body.classList.add('shot');
      document.body.classList.add(shot === 'all' ? 'gallery' : 'single');
      if (full) document.body.classList.add('full');
      applyScreen(shot === 'all' ? 'all' : shot);
    } else {
      applyScreen('all');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
