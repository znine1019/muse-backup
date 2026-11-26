'use strict';

/**
 * 乔格训迹 V1.6.5 动效交互核心引擎（由 V1/V2/V3 各自配置变体渲染与招牌动效）
 */
window.createV165Prototype = function (variantCfg) {
  const DATA = window.JOGER_V165_DATA;
  const MOTION = window.JOGER_V165_MOTION;
  const params = new URLSearchParams(window.location.search);

  const state = {
    screen: params.get('screen') || '01-student',
    prevScreenIndex: 0,
    navDir: 'fwd',
    viewState: params.get('state') || 'normal',
    daylight: params.get('daylight') === '1',
    parentStudentIndex: 0,
    parentSection: 'overview',
    statsMode: 'performance',
    statsPeriod: 'month',
    chartEvent: '100m',
    chartDataMode: 'normal', // normal | empty | incomplete
    attendanceRole: 'student',
    selectedSpot: 'east',
    submitPhase: 'idle', // idle | submitting | success
    pulseActive: false,
    cardFlipped: false,
    rasterScanActive: false,
    planType: '单日专项',
    planBasicOpen: true,
    planItemsOpen: true,
    planTitleError: '',
    planItems: DATA.plan.initialItems.map((i) => ({ ...i })),
    nextPlanId: 4,
    swipedId: null,
    doneTodoIds: [],
    selectedTodoIds: [],
    multiSelectMode: false,
    drawerOpen: false,
    drawerTitle: '',
    drawerBody: '',
    ptrOpen: false,
    labLog: '就绪：点击下方任意按钮，原地触发并重复演示对应动效。',
    labFlip: false,
    labPulse: false,
    labRankAlt: false,
    labShake: false,
    labSubmitPhase: 'idle',
    labEmptyMode: false,
    labSkelMode: false
  };

  const titleEl = document.getElementById('screenTitle');
  const roleEl = document.getElementById('screenRole');
  const bodyEl = document.getElementById('screenBody');
  const navTop = document.getElementById('navRowTop');
  const navBottom = document.getElementById('navRowBottom');
  const daylightBtn = document.getElementById('daylightBtn');
  const ptrEl = document.getElementById('ptrIndicator');
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const drawerPanel = document.getElementById('drawerPanel');
  const drawerTitleEl = document.getElementById('drawerTitle');
  const drawerBodyEl = document.getElementById('drawerBody');
  const toastEl = document.getElementById('toastEl');
  const scanOverlay = document.getElementById('scanOverlay');
  let toastTimer = null;

  function esc(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), 1800);
  }

  function openDrawer(title, htmlBody) {
    state.drawerOpen = true;
    state.drawerTitle = title;
    state.drawerBody = htmlBody;
    drawerTitleEl.textContent = title;
    drawerBodyEl.innerHTML = htmlBody;
    drawerPanel.style.transform = '';
    drawerBackdrop.classList.add('is-open');
  }

  function closeDrawer() {
    state.drawerOpen = false;
    drawerPanel.style.transform = '';
    drawerBackdrop.classList.remove('is-open');
  }

  function triggerPullRefresh(cb) {
    if (!ptrEl) return;
    state.ptrOpen = true;
    ptrEl.classList.add('is-open');
    showToast('自定义赛道指示器刷新中…');
    setTimeout(() => {
      state.ptrOpen = false;
      ptrEl.classList.remove('is-open');
      showToast('已刷新演示时间戳（未调用接口）');
      if (cb) cb();
    }, 680);
  }

  function syncDaylightClass() {
    document.body.classList.toggle('is-daylight', state.daylight);
    if (daylightBtn) {
      daylightBtn.classList.toggle('is-on', state.daylight);
      daylightBtn.textContent = state.daylight ? '日光:开' : '日光模式';
    }
  }

  function renderNav() {
    const topItems = DATA.screens.slice(0, 4);
    const bottomItems = DATA.screens.slice(4);
    const btnCls = variantCfg.navBtnClass;
    const toHtml = (list) =>
      list
        .map(
          (s) =>
            `<button type="button" class="${btnCls} ${state.screen === s.id ? 'is-active' : ''}" data-screen="${s.id}">${esc(s.short)}</button>`
        )
        .join('');
    navTop.innerHTML = toHtml(topItems);
    navBottom.innerHTML = toHtml(bottomItems);

    document.querySelectorAll('.jg-state-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.state === state.viewState);
    });
  }

  function renderEmptyIllustration() {
    return `
      <svg width="72" height="54" viewBox="0 0 72 54" aria-hidden="true">
        <rect x="6" y="10" width="60" height="34" rx="17" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 4" />
        <circle cx="36" cy="27" r="7" fill="none" stroke="#2F6FBF" stroke-width="2.5" />
      </svg>`;
  }

  function renderNonNormal() {
    if (state.viewState === 'loading') {
      return `
        <div class="jg-skel-card"></div>
        <div class="jg-skel-card"></div>
        <div class="jg-skel-card"></div>
        <div class="jg-card">
          <div class="jg-card-title">骨架屏 Shimmer 扫光（1.2s）</div>
          <div class="jg-row-m">加载结束后将以 200ms 上移淡入切换至正式内容。</div>
          <button type="button" class="jg-btn jg-btn-primary jg-btn-block" data-action="finish-skeleton">模拟加载完成（200ms 淡入）</button>
        </div>`;
    }
    if (state.viewState === 'empty') {
      return `
        <div class="jg-empty-box" id="emptyStateBox">
          ${renderEmptyIllustration()}
          <div class="jg-card-title">当前暂无实测业务记录</div>
          <div class="jg-row-m">系统仅呈现真实录入与审核通过的数据，不以占位假值冒充实测。</div>
          <button type="button" class="jg-btn jg-btn-primary" data-action="empty-to-data">插画淡出并滑入演示数据</button>
        </div>`;
    }
    return `
      <div class="jg-err-box">
        <div class="jg-card-title">读取中断（演示错误态）</div>
        <div class="jg-row-m">示例错误码：CLOUD_TIMEOUT / PERMISSION_DENIED，当前未产生任何写入。</div>
        <button type="button" class="jg-btn jg-btn-danger" data-action="reset-state">重新加载</button>
      </div>`;
  }

  /* ================= 1. 学生首页（按方案区分：仪表盘 / 时间轴 / 卡片流） ================= */
  function renderStudent() {
    const s = DATA.student;
    if (variantCfg.id === 'v1') {
      return `
        <section class="v1-cockpit jg-stagger jg-stagger-0">
          <div class="jg-card-head">
            <span class="jg-brand-k">今日训练结论 · ${esc(s.group)}</span>
            <span class="jg-pill jg-pill-accent">${esc(s.todaySession.status)}</span>
          </div>
          <div class="jg-ring-row">
            <canvas class="jg-ring-canvas" id="studentRingCanvas" width="108" height="108"></canvas>
            <div class="v1-cockpit-nums">
              <div class="jg-card-sub">${esc(s.pb.event)} 审核 PB</div>
              <div class="v1-big-num jg-num" data-countup="${s.pb.numeric}" data-decimals="2" data-suffix="${esc(s.pb.unit)}">${s.pb.numeric}${esc(s.pb.unit)}</div>
              <div class="jg-row-m">${esc(s.todaySession.title)} · ${esc(s.todaySession.time)}</div>
            </div>
          </div>
          <div class="jg-btn-row">
            <button type="button" class="jg-btn jg-btn-primary jg-btn-grow" data-screen="06-attendance">去主动签到</button>
            <button type="button" class="jg-btn jg-btn-grow" data-action="open-session-drawer">今日详情抽屉</button>
          </div>
        </section>

        <section class="v1-quick-grid jg-stagger jg-stagger-1">
          ${s.quickEntries
            .map(
              (e) => `<button type="button" class="v1-quick-btn" data-screen="${e.screen}"><span>${esc(e.label)}</span><span class="jg-pill jg-pill-accent">${esc(e.tag)}</span></button>`
            )
            .join('')}
        </section>

        <section class="jg-card jg-stagger jg-stagger-2">
          <div class="jg-card-head">
            <div class="jg-card-title">俱乐部通知</div>
            <button type="button" class="jg-btn" data-action="trigger-ptr">下拉刷新</button>
          </div>
          ${s.notices
            .map(
              (n) => `
            <div class="jg-row">
              <div class="jg-row-main">
                <div class="jg-row-t">${esc(n.title)}</div>
                <div class="jg-row-m">${esc(n.date)} · ${n.unread ? '未读' : '已读'}</div>
              </div>
              <span class="jg-pill ${n.priority === '重要' ? 'jg-pill-accent' : ''}">${esc(n.priority)}</span>
            </div>`
            )
            .join('')}
        </section>`;
    }

    if (variantCfg.id === 'v2') {
      return `
        <section class="v2-flip-scene jg-stagger jg-stagger-0">
          <div class="v2-flip-card ${state.cardFlipped ? 'is-flipped' : ''}" id="pbFlipCard">
            <div class="v2-flip-face v2-flip-front">
              <div class="jg-card-head">
                <span class="jg-brand-k">PB 遥测数据卡 · 招牌 3D 翻面</span>
                <span class="jg-pill jg-pill-ok">${esc(s.pb.status)}</span>
              </div>
              <div class="v2-pb-row">
                <span class="v2-big-num jg-num" data-countup="${s.pb.numeric}" data-decimals="2" data-suffix="${esc(s.pb.unit)}">${s.pb.numeric}${esc(s.pb.unit)}</span>
                <span class="jg-pill jg-pill-accent">较上次 ${esc(s.pb.delta)}</span>
              </div>
              <div class="jg-row-m">${esc(s.name)} · ${esc(s.group)} · 本月出勤 <strong class="jg-num" data-countup="${s.monthlyAttendance.rateNumeric}" data-decimals="1" data-suffix="%">${s.monthlyAttendance.rateNumeric}%</strong></div>
              <button type="button" class="jg-btn jg-btn-primary jg-btn-block" data-action="flip-pb-card">翻转查看审核溯源（3D 形变）</button>
            </div>
            <div class="v2-flip-face v2-flip-back">
              <div class="jg-card-head">
                <span class="jg-brand-k">审核溯源背面</span>
                <span class="jg-pill jg-pill-accent">${esc(s.pb.date)}</span>
              </div>
              <div class="jg-row-m">复核教练：${esc(s.pb.reviewer)} · 原纪录：${esc(s.pb.prevValue)}</div>
              <div class="jg-row-m">规则：仅教练审核通过的实测 PB 可进入正式成绩排行。</div>
              <button type="button" class="jg-btn jg-btn-primary jg-btn-block" data-action="flip-pb-card">翻回正面指标</button>
            </div>
          </div>
        </section>

        <section class="jg-card jg-stagger jg-stagger-1">
          <div class="jg-card-head">
            <div class="jg-card-title">今日训练过程时间轴</div>
            <button type="button" class="jg-btn" data-action="trigger-ptr">刷新</button>
          </div>
          <div class="v2-timeline">
            ${s.timeline
              .map(
                (t, idx) => `
              <div class="v2-tl-item ${idx === 0 ? 'is-now' : ''}">
                <div class="v2-tl-dot"></div>
                <div class="v2-tl-body">
                  <div class="jg-card-head">
                    <span class="jg-row-t">${esc(t.time)} · ${esc(t.title)}</span>
                    <span class="jg-pill ${idx === 0 ? 'jg-pill-accent' : ''}">${esc(t.status)}</span>
                  </div>
                  <div class="jg-row-m">${esc(t.meta)}</div>
                </div>
              </div>`
              )
              .join('')}
          </div>
          <div class="jg-btn-row">
            <button type="button" class="jg-btn jg-btn-primary jg-btn-grow" data-screen="06-attendance">进入定位签到</button>
            <button type="button" class="jg-btn jg-btn-grow" data-action="open-session-drawer">通知与入口抽屉</button>
          </div>
        </section>`;
    }

    // V3 光栅脉动：任务推进卡片流
    return `
      <section class="v3-mission-bar jg-stagger jg-stagger-0">
        <div class="v3-step is-now"><span class="jg-num">01</span><span>定位签到</span></div>
        <div class="v3-step"><span class="jg-num">02</span><span>执行计划</span></div>
        <div class="v3-step"><span class="jg-num">03</span><span>提交反馈</span></div>
      </section>

      <section class="v3-stream-card v3-rail-accent jg-stagger jg-stagger-1">
        <div class="jg-card-head">
          <div class="jg-card-title">当前任务 · ${esc(s.todaySession.title)}</div>
          <span class="jg-pill jg-pill-accent">${esc(s.todaySession.status)}</span>
        </div>
        <div class="jg-row-m">${esc(s.todaySession.time)} · ${esc(s.todaySession.location)}</div>
        <div class="jg-btn-row">
          <button type="button" class="jg-btn jg-btn-primary jg-btn-grow" data-screen="06-attendance">立即定位签到</button>
          <button type="button" class="jg-btn jg-btn-grow" data-action="open-session-drawer">任务详情</button>
        </div>
      </section>

      <section class="v3-stream-card jg-stagger jg-stagger-2">
        <div class="jg-card-head">
          <div class="jg-card-title">个人档案速览</div>
          <button type="button" class="jg-btn" data-action="trigger-ptr">刷新</button>
        </div>
        <div class="jg-ring-row">
          <canvas class="jg-ring-canvas" id="studentRingCanvas" width="108" height="108"></canvas>
          <div class="jg-row-main">
            <div class="jg-row-m">${esc(s.pb.event)} 正式 PB</div>
            <div class="v3-big-num jg-num" data-countup="${s.pb.numeric}" data-decimals="2" data-suffix="${esc(s.pb.unit)}">${s.pb.numeric}${esc(s.pb.unit)}</div>
            <div class="jg-row-m">已入部 ${s.joinedDays} 天 · 通知 ${s.notices.length} 条</div>
          </div>
        </div>
      </section>`;
  }

  /* ================= 2. 教练工作台（含日光模式焦点 + 左滑审批 + 长按多选） ================= */
  function renderCoach() {
    const c = DATA.coach;
    const f = c.todayFocus;
    const pendingCount = c.todos.filter((t) => !state.doneTodoIds.includes(t.id)).length;
    return `
      <section class="jg-card jg-stagger jg-stagger-0">
        <div class="jg-card-head">
          <div class="jg-card-title">今日考勤焦点 · ${esc(f.window)}</div>
          <span class="jg-pill jg-pill-accent">待办 <span class="jg-num" data-countup="${pendingCount}">${pendingCount}</span></span>
        </div>
        <div class="jg-ring-row">
          <canvas class="jg-ring-canvas" id="coachRingCanvas" width="108" height="108"></canvas>
          <div class="jg-row-main">
            <div class="jg-row-t">${esc(f.title)}</div>
            <div class="jg-row-m">已签 <strong class="jg-num">${f.checkedIn}/${f.expected}</strong> · 迟到 ${f.late} · 待核实 ${f.pendingVerify} · 请假 ${f.leaveApproved}</div>
            <div class="jg-row-m">1 米强光可辨大字号 · 右上角可切日光模式</div>
          </div>
        </div>
      </section>

      <section class="jg-card jg-stagger jg-stagger-1">
        <div class="jg-card-head">
          <div class="jg-card-title">待办审批（左滑审批 / 长按多选）</div>
          <button type="button" class="jg-btn" data-action="toggle-multiselect">${state.multiSelectMode ? `退出多选(${state.selectedTodoIds.length})` : '批量多选'}</button>
        </div>
        ${c.todos
          .map((t) => {
            const isSwiped = state.swipedId === t.id;
            const isDone = state.doneTodoIds.includes(t.id);
            const isSel = state.selectedTodoIds.includes(t.id);
            return `
            <div class="jg-swipe-wrap ${isSwiped ? 'is-swiped' : ''} ${isDone ? 'is-done' : ''} ${isSel ? 'is-selected' : ''}" data-swipe-id="${t.id}">
              <div class="jg-swipe-actions">
                <button type="button" class="jg-swipe-act-btn jg-swipe-approve" data-todo-act="approve" data-todo-id="${t.id}">通过</button>
                <button type="button" class="jg-swipe-act-btn jg-swipe-reject" data-todo-act="reject" data-todo-id="${t.id}">退回</button>
              </div>
              <div class="jg-swipe-fg" data-swipe-fg="${t.id}">
                <div class="jg-row-main">
                  <div class="jg-row-t">${isSel ? '✓ ' : ''}${esc(t.type)} · ${esc(t.student)}</div>
                  <div class="jg-row-m">${esc(t.detail)}</div>
                </div>
                <button type="button" class="jg-btn" data-swipe-toggle="${t.id}">${isDone ? '已处理' : isSwiped ? '收起' : '左滑'}</button>
              </div>
            </div>`;
          })
          .join('')}
        ${
          state.multiSelectMode && state.selectedTodoIds.length > 0
            ? `<button type="button" class="jg-btn jg-btn-primary jg-btn-block" data-action="batch-approve">批量通过已选 ${state.selectedTodoIds.length} 项（演示）</button>`
            : ''
        }
      </section>

      <section class="jg-card jg-stagger jg-stagger-2">
        <div class="jg-card-head">
          <div class="jg-card-title">赛事意向与材料核验</div>
          <span class="jg-card-sub">内部意向≠官方报名</span>
        </div>
        ${c.competitions
          .map(
            (item) => `
          <div class="jg-row">
            <div class="jg-row-main">
              <div class="jg-row-t">${esc(item.title)}</div>
              <div class="jg-row-m">意向 ${item.intentCount} 人 · 材料 ${item.materialCount} 份 · ${esc(item.status)}</div>
            </div>
            <span class="jg-pill jg-pill-accent">${item.materialCount}/${item.intentCount}</span>
          </div>`
          )
          .join('')}
      </section>`;
  }

  /* ================= 3. 家长工作台（严格只读 + 局部遮罩学生切换） ================= */
  function renderParent() {
    const stu = DATA.parent.students[state.parentStudentIndex];
    const secLabel = (DATA.parent.sections.find((s) => s.id === state.parentSection) || {}).label;
    return `
      <div class="jg-note jg-stagger jg-stagger-0">严格只读视图：家长无任何写入口，不展示精确 GPS 坐标与教练内部评价。</div>

      <section class="jg-card jg-stagger jg-stagger-1">
        <div class="jg-card-head">
          <div class="jg-card-title">切换关联学生（局部过渡不刷新外壳）</div>
          <span class="jg-pill">只读</span>
        </div>
        <div class="jg-btn-row">
          ${DATA.parent.students
            .map(
              (item, idx) =>
                `<button type="button" class="jg-btn jg-btn-grow ${idx === state.parentStudentIndex ? 'is-active' : ''}" data-parent-stu="${idx}">${esc(item.name)}</button>`
            )
            .join('')}
        </div>
        <div class="jg-btn-row">
          ${DATA.parent.sections
            .map(
              (sec) =>
                `<button type="button" class="jg-btn ${state.parentSection === sec.id ? 'is-active' : ''}" data-parent-sec="${sec.id}">${esc(sec.label)}</button>`
            )
            .join('')}
        </div>
      </section>

      <div class="jg-scope-stage jg-stagger jg-stagger-2" id="parentScopeStage">
        <div class="jg-scope-wipe"></div>
        <section class="jg-card">
          <div class="jg-card-head">
            <div class="jg-card-title">${esc(stu.name)} · ${esc(secLabel)}</div>
            <span class="jg-pill jg-pill-accent">${esc(stu.group)}</span>
          </div>
          <div class="jg-ring-row">
            <canvas class="jg-ring-canvas" id="parentRingCanvas" width="108" height="108"></canvas>
            <div class="jg-row-main">
              <div class="jg-row-m">${esc(stu.event)} 审核 PB</div>
              <div class="jg-val-accent" style="font-size:22px">${esc(stu.pbText)}</div>
              <div class="jg-row-m">有效出勤 ${esc(stu.validDays)} · 请假 ${esc(stu.approvedLeave)}</div>
            </div>
          </div>
          ${
            state.parentSection === 'plans'
              ? stu.plans
                  .map((p) => `<div class="jg-row"><div class="jg-row-main"><div class="jg-row-t">${esc(p.title)}</div><div class="jg-row-m">${esc(p.period)} · ${esc(p.items)}</div></div></div>`)
                  .join('')
              : state.parentSection === 'performance'
              ? stu.performances
                  .map((p) => `<div class="jg-row"><div class="jg-row-main"><div class="jg-row-t">${esc(p.event)}</div><div class="jg-row-m">${esc(p.date)}（已审）</div></div><span class="jg-val-accent">${esc(p.value)}</span></div>`)
                  .join('')
              : state.parentSection === 'attendance'
              ? stu.attendance
                  .map((a) => `<div class="jg-row"><div class="jg-row-main"><div class="jg-row-t">${esc(a.date)}</div><div class="jg-row-m">${esc(a.status)}</div></div></div>`)
                  .join('')
              : state.parentSection === 'feedback'
              ? stu.feedback
                  .map((f) => `<div class="jg-row"><div class="jg-row-main"><div class="jg-row-t">${esc(f.date)} · ${esc(f.completion)}</div><div class="jg-row-m">自评强度 RPE ${esc(f.rpe)}</div></div></div>`)
                  .join('')
              : stu.events
                  .map((e) => `<div class="jg-row"><div class="jg-row-main"><div class="jg-row-t">${esc(e.title)}</div><div class="jg-row-m">${esc(e.type)}</div></div><span class="jg-pill jg-pill-accent">${esc(e.badge)}</span></div>`)
                  .join('')
          }
        </section>
      </div>`;
  }

  /* ================= 4. 开发者控制台 ================= */
  function renderDeveloper() {
    const d = DATA.developer;
    return `
      <section class="jg-card jg-stagger jg-stagger-0">
        <div class="jg-card-head">
          <div class="jg-card-title">运行状态基线</div>
          <span class="jg-pill jg-pill-ok">Active</span>
        </div>
        <div class="jg-row">
          <div class="jg-row-main">
            <div class="jg-row-t">云环境 ${esc(d.system.env)}</div>
            <div class="jg-row-m">${esc(d.system.apiStatus)} · 存储 ${esc(d.system.storageAcl)}</div>
          </div>
          <span class="jg-val-accent" data-countup="${d.system.collectionsCount}" data-suffix=" 集合">${d.system.collectionsCount} 集合</span>
        </div>
      </section>

      <section class="jg-card jg-stagger jg-stagger-1">
        <div class="jg-card-head">
          <div class="jg-card-title">账号与角色审批队列</div>
          <span class="jg-pill jg-pill-accent">${d.approvals.length} 待审</span>
        </div>
        ${d.approvals
          .map(
            (a) => `
          <div class="jg-row">
            <div class="jg-row-main">
              <div class="jg-row-t">${esc(a.name)} · ${esc(a.roleType)}</div>
              <div class="jg-row-m">${esc(a.detail)} · ${esc(a.time)}</div>
            </div>
            <span class="jg-pill jg-pill-accent">待审</span>
          </div>`
          )
          .join('')}
      </section>

      <section class="jg-card jg-stagger jg-stagger-2">
        <div class="jg-card-head">
          <div class="jg-card-title">训练组与教练范围</div>
          <span class="jg-card-sub">${d.groups.length} 组</span>
        </div>
        ${d.groups
          .map(
            (g) => `
          <div class="jg-row">
            <div class="jg-row-main">
              <div class="jg-row-t">${esc(g.name)}</div>
              <div class="jg-row-m">教练：${esc(g.coaches)} · 成员 ${g.students} 人</div>
            </div>
            <span class="jg-pill jg-pill-ok">启用</span>
          </div>`
          )
          .join('')}
      </section>

      <div class="jg-note jg-stagger jg-stagger-3">审计约束：全部角色变更、删除、关联终审与材料下载均由云函数服务端事务写入 audit_logs。</div>`;
  }

  /* ================= 5. 统计与排行榜（Canvas 2D 趋势图 + 环形 + FLIP 名次置换 + V3 光栅扫描） ================= */
  function renderStats() {
    const isPerf = state.statsMode === 'performance';
    const rows = isPerf
      ? DATA.stats.performance[state.statsPeriod]
      : DATA.stats.attendance[state.statsPeriod];
    return `
      <section class="jg-card jg-stagger jg-stagger-0">
        <div class="jg-card-head">
          <div class="jg-card-title">榜单维度与统计周期</div>
          <button type="button" class="jg-btn" data-action="mock-export">导出 XLSX</button>
        </div>
        <div class="jg-btn-row">
          <button type="button" class="jg-btn jg-btn-grow ${isPerf ? 'is-active' : ''}" data-stats-mode="performance">成绩排行榜</button>
          <button type="button" class="jg-btn jg-btn-grow ${!isPerf ? 'is-active' : ''}" data-stats-mode="attendance">考勤排行榜</button>
        </div>
        <div class="jg-btn-row">
          ${DATA.stats.periods
            .map(
              (p) =>
                `<button type="button" class="jg-btn jg-btn-grow ${state.statsPeriod === p.key ? 'is-active' : ''}" data-stats-period="${p.key}">${esc(p.label)}</button>`
            )
            .join('')}
        </div>
      </section>

      <section class="jg-card jg-stagger jg-stagger-1">
        <div class="jg-card-head">
          <div class="jg-card-title">Canvas 2D 成绩趋势曲线</div>
          <span class="jg-card-sub">左→右生长 + 120ms 标签</span>
        </div>
        <div class="jg-btn-row">
          <button type="button" class="jg-btn ${state.chartEvent === '100m' ? 'is-active' : ''}" data-chart-event="100m">100米</button>
          <button type="button" class="jg-btn ${state.chartEvent === '200m' ? 'is-active' : ''}" data-chart-event="200m">200米</button>
          <button type="button" class="jg-btn ${state.chartEvent === 'jump' ? 'is-active' : ''}" data-chart-event="jump">跳远</button>
        </div>
        <div class="jg-btn-row">
          <button type="button" class="jg-btn ${state.chartDataMode === 'normal' ? 'is-active' : ''}" data-chart-mode="normal">正常实测</button>
          <button type="button" class="jg-btn ${state.chartDataMode === 'incomplete' ? 'is-active' : ''}" data-chart-mode="incomplete">估算不完整</button>
          <button type="button" class="jg-btn ${state.chartDataMode === 'empty' ? 'is-active' : ''}" data-chart-mode="empty">无数据态</button>
        </div>
        <div class="jg-canvas-box">
          <canvas class="jg-trend-canvas" id="statsTrendCanvas"></canvas>
        </div>
      </section>

      <div class="jg-note ${isPerf ? '' : 'jg-note-warn'} jg-stagger jg-stagger-2">
        ${
          isPerf
            ? '正式成绩口径：仅计入教练已审核通过的实测记录，未审或驳回申报禁止入榜。'
            : '估算口径提示：周期内历史成员不完整时不输出正式名次（rank 置空），且样本不足 3 场不领先。'
        }
      </div>

      <section class="jg-card jg-stagger jg-stagger-3">
        <div class="jg-card-head">
          <div class="jg-card-title">${isPerf ? '100米 正式排行' : '训练组考勤估算'}</div>
          <button type="button" class="jg-btn jg-btn-primary" data-action="trigger-rank-swap">名次置换演示</button>
        </div>
        <div class="jg-rank-list ${state.rasterScanActive ? 'is-raster-scan' : ''}" id="rankListBox">
          <div class="v3-raster-beam"></div>
          ${rows
            .map(
              (r) => `
            <div class="jg-rank-item" data-rank-id="${r.id}">
              <div class="jg-rank-top">
                <div class="jg-row-main">
                  <div class="jg-row-t">#${esc(r.rank)} ${esc(r.name)}</div>
                  <div class="jg-row-m">${esc(r.group)} ${isPerf ? `· PB ${esc(r.pb)}` : `· 有效 ${esc(r.valid)} · ${esc(r.note)}`}</div>
                </div>
                <span class="jg-val-accent">${esc(isPerf ? r.value : r.rate)}</span>
              </div>
              <div class="jg-rank-bar-track">
                <div class="jg-rank-bar-fill" style="transform: scaleX(${(r.scorePct / 100).toFixed(2)})"></div>
              </div>
            </div>`
            )
            .join('')}
        </div>
      </section>`;
  }

  /* ================= 6. 考勤签到（日光模式 + V1 招牌打卡光环扩散 + 提交进度环变形） ================= */
  function renderAttendance() {
    const spot = DATA.attendance.spots.find((s) => s.id === state.selectedSpot) || DATA.attendance.spots[0];
    const isStudent = state.attendanceRole === 'student';
    return `
      <section class="jg-card jg-stagger jg-stagger-0">
        <div class="jg-btn-row">
          <button type="button" class="jg-btn jg-btn-grow ${isStudent ? 'is-active' : ''}" data-att-role="student">学生主动签到</button>
          <button type="button" class="jg-btn jg-btn-grow ${!isStudent ? 'is-active' : ''}" data-att-role="coach">教练创建场次</button>
        </div>
      </section>

      <section class="jg-card jg-stagger jg-stagger-1">
        <div class="jg-card-head">
          <div class="jg-card-title">静态围栏选点区（无地图 SDK）</div>
          <span class="jg-pill jg-pill-accent">半径 ${esc(spot.radius)}</span>
        </div>
        <div class="jg-map-box ${state.pulseActive ? 'is-pulsing' : ''}" id="checkinMapBox">
          <div class="v1-pulse-ring v1-pulse-1"></div>
          <div class="v1-pulse-ring v1-pulse-2"></div>
          <div class="v1-pulse-ring v1-pulse-3"></div>
          <div class="jg-map-ring">${esc(spot.label)}</div>
          <div class="jg-map-coord">${esc(spot.coordText)}</div>
        </div>
        <div class="jg-btn-row">
          ${DATA.attendance.spots
            .map(
              (sp) =>
                `<button type="button" class="jg-btn jg-btn-grow ${state.selectedSpot === sp.id ? 'is-active' : ''}" data-spot="${sp.id}">${esc(sp.label)}</button>`
            )
            .join('')}
        </div>
      </section>

      <section class="jg-card jg-stagger jg-stagger-2">
        ${
          isStudent
            ? `
          <div class="jg-card-title">单次主动定位签到（无签退 · 无请假附件）</div>
          <div class="jg-row-m">点击后按钮变形为进度环，400ms 环形确认并触发赛道光环扩散。</div>
          <button type="button" class="jg-btn jg-btn-primary jg-btn-block" data-action="submit-checkin">
            ${
              state.submitPhase === 'submitting'
                ? '<span class="jg-btn-spinner"></span><span>服务端测距核验中…</span>'
                : state.submitPhase === 'success'
                ? '<span class="jg-btn-check">✓</span><span>签到成功（演示）</span>'
                : '发起一次定位并签到'
            }
          </button>`
            : `
          <div class="jg-card-title">新建考勤场次（含聚焦流光与校验抖动）</div>
          <div class="jg-field">
            <label class="jg-label" for="attTitleInput">场次标题</label>
            <div class="jg-input-wrap" id="attTitleWrap">
              <input id="attTitleInput" class="jg-input" value="短跑一队傍晚训练" />
              <div class="jg-focus-bar"></div>
            </div>
          </div>
          <div class="jg-field">
            <label class="jg-label" for="attWinInput">开放窗口与迟到线</label>
            <div class="jg-input-wrap">
              <input id="attWinInput" class="jg-input" value="16:15 - 16:45（迟到线 16:30）" />
              <div class="jg-focus-bar"></div>
            </div>
          </div>
          <button type="button" class="jg-btn jg-btn-primary jg-btn-block" data-action="submit-checkin">
            ${
              state.submitPhase === 'submitting'
                ? '<span class="jg-btn-spinner"></span><span>保存中…</span>'
                : state.submitPhase === 'success'
                ? '<span class="jg-btn-check">✓</span><span>场次已创建（演示）</span>'
                : '创建考勤场次（演示）'
            }
          </button>`
        }
      </section>`;
  }

  /* ================= 7. 训练计划编辑（聚焦流光 + 校验单次抖动 + 增删条目 + 折叠） ================= */
  function renderPlan() {
    return `
      <div class="jg-note jg-stagger jg-stagger-0">全部训练计划由教练人工编排与发布，系统不含任何 AI 自动生成训练计划功能。</div>

      <section class="jg-card jg-stagger jg-stagger-1">
        <button type="button" class="jg-btn jg-btn-block" data-toggle="basic">
          <span>一、基础属性与类型（${state.planBasicOpen ? '点击收起' : '点击展开'}）</span>
        </button>
        ${
          state.planBasicOpen
            ? `
          <div class="jg-btn-row">
            ${DATA.plan.types
              .map(
                (t) =>
                  `<button type="button" class="jg-btn jg-btn-grow ${state.planType === t ? 'is-active' : ''}" data-plan-type="${esc(t)}">${esc(t)}</button>`
              )
              .join('')}
          </div>
          <div class="jg-field">
            <label class="jg-label" for="planTitleInput">计划标题（清空后点校验可触发单次 180ms 抖动）</label>
            <div class="jg-input-wrap ${state.planTitleError ? 'is-error' : ''}" id="planTitleWrap">
              <input id="planTitleInput" class="jg-input" value="短跑一队·${esc(state.planType)}训练安排" />
              <div class="jg-focus-bar"></div>
            </div>
            ${state.planTitleError ? `<div class="jg-field-err">${esc(state.planTitleError)}</div>` : ''}
          </div>
          <div class="jg-btn-row">
            <button type="button" class="jg-btn jg-btn-grow" data-action="test-plan-shake">校验失败抖动演示</button>
            <button type="button" class="jg-btn jg-btn-primary jg-btn-grow" data-action="submit-checkin">
              ${
                state.submitPhase === 'submitting'
                  ? '<span class="jg-btn-spinner"></span><span>提交中…</span>'
                  : state.submitPhase === 'success'
                  ? '<span class="jg-btn-check">✓</span><span>已保存</span>'
                  : '保存计划（演示）'
              }
            </button>
          </div>`
            : ''
        }
      </section>

      <section class="jg-card jg-stagger jg-stagger-2">
        <button type="button" class="jg-btn jg-btn-block" data-toggle="items">
          <span>二、训练内容条目（共 ${state.planItems.length} 项 · ${state.planItemsOpen ? '收起' : '展开'}）</span>
        </button>
        ${
          state.planItemsOpen
            ? `
          ${state.planItems
            .map(
              (item, idx) => `
            <div class="jg-row">
              <div class="jg-row-main">
                <div class="jg-row-t">${idx + 1}. ${esc(item.name)}</div>
                <div class="jg-row-m">${esc(item.sets)} · ${esc(item.reps)} · 间歇 ${esc(item.rest)}</div>
              </div>
              <button type="button" class="jg-btn jg-btn-danger" data-del-item="${item.id}">删除</button>
            </div>`
            )
            .join('')}
          <button type="button" class="jg-btn jg-btn-primary jg-btn-block" data-action="add-plan-item">+ 新增训练内容条目</button>`
            : ''
        }
      </section>`;
  }

  /* ================= 8. 动效演示页（13 项动效一键触发、可重复播放） ================= */
  function renderMotionLab() {
    return `
      <section class="jg-card jg-stagger jg-stagger-0">
        <div class="jg-card-head">
          <div class="jg-card-title">${esc(variantCfg.name)} · 动效实验室</div>
          <span class="jg-pill jg-pill-accent">${esc(variantCfg.grammar)}</span>
        </div>
        <div class="jg-lab-log" id="labLogBox">${esc(state.labLog)}</div>
        <div class="jg-row">
          <div class="jg-row-main">
            <div class="jg-row-m">演示计数目标</div>
            <div class="jg-val-accent" style="font-size:24px" id="labCountNum" data-countup="94.6" data-decimals="1" data-suffix="%">94.6%</div>
          </div>
          <div class="jg-input-wrap ${state.labShake ? 'is-error' : ''}" id="labInputWrap" style="width:168px">
            <input class="jg-input" value="聚焦流光 / 抖动测试" aria-label="动效测试输入框" />
            <div class="jg-focus-bar"></div>
          </div>
        </div>
        <div class="jg-canvas-box">
          <canvas class="jg-trend-canvas" id="labTrendCanvas"></canvas>
        </div>
      </section>

      <section class="jg-card jg-stagger jg-stagger-1">
        <div class="jg-card-head">
          <div class="jg-card-title">13 项动效触发清单（点击可重复播放）</div>
          <span class="jg-card-sub">≤320ms / 招牌≤600ms</span>
        </div>
        ${DATA.motionLabItems
          .map(
            (m) => `
          <div class="jg-lab-item">
            <div class="jg-row-main">
              <div class="jg-row-t">${esc(m.title)}</div>
              <div class="jg-row-m">${esc(m.desc)}</div>
            </div>
            <button type="button" class="jg-btn jg-btn-primary" data-lab-play="${m.id}">播放</button>
          </div>`
          )
          .join('')}
      </section>`;
  }

  function hydrateDynamicVisuals() {
    MOTION.runCountUps(bodyEl);
    const sRing = document.getElementById('studentRingCanvas');
    if (sRing) {
      MOTION.drawRingGauge(sRing, {
        percent: DATA.student.monthlyAttendance.rateNumeric,
        sub: '本月出勤',
        daylight: state.daylight
      });
    }
    const cRing = document.getElementById('coachRingCanvas');
    if (cRing) {
      MOTION.drawRingGauge(cRing, {
        percent: DATA.coach.todayFocus.rateNumeric,
        sub: '本场签到',
        daylight: state.daylight
      });
    }
    const pRing = document.getElementById('parentRingCanvas');
    if (pRing) {
      const stu = DATA.parent.students[state.parentStudentIndex];
      MOTION.drawRingGauge(pRing, {
        percent: stu.attendanceNumeric,
        sub: '出勤率',
        daylight: state.daylight
      });
    }
    const trendCanvas = document.getElementById('statsTrendCanvas');
    if (trendCanvas) {
      const ev = DATA.stats.chartEvents[state.chartEvent] || DATA.stats.chartEvents['100m'];
      MOTION.drawTrendChart(trendCanvas, {
        points: ev.points,
        lowerBetter: ev.lowerBetter,
        mode: state.chartDataMode,
        daylight: state.daylight
      });
    }
    const labCanvas = document.getElementById('labTrendCanvas');
    if (labCanvas) {
      const ev = DATA.stats.chartEvents['100m'];
      MOTION.drawTrendChart(labCanvas, {
        points: ev.points,
        lowerBetter: ev.lowerBetter,
        mode: 'normal',
        daylight: state.daylight
      });
    }
  }

  function triggerPageTransition() {
    bodyEl.classList.remove('is-enter-fwd', 'is-enter-back');
    void bodyEl.offsetWidth;
    bodyEl.classList.add(state.navDir === 'back' ? 'is-enter-back' : 'is-enter-fwd');
    if (scanOverlay && variantCfg.id === 'v3') {
      scanOverlay.classList.remove('is-active');
      void scanOverlay.offsetWidth;
      scanOverlay.classList.add('is-active');
    }
  }

  function render(opts) {
    const cfg = opts || {};
    syncDaylightClass();
    const meta = DATA.screens.find((s) => s.id === state.screen) || DATA.screens[0];
    titleEl.textContent = meta.label;
    roleEl.textContent = meta.role;
    renderNav();

    if (state.viewState !== 'normal') {
      bodyEl.innerHTML = renderNonNormal();
      if (cfg.animatePage) triggerPageTransition();
      return;
    }

    const map = {
      '01-student': renderStudent,
      '02-coach': renderCoach,
      '03-parent': renderParent,
      '04-developer': renderDeveloper,
      '05-stats': renderStats,
      '06-attendance': renderAttendance,
      '07-plan': renderPlan,
      '08-motion': renderMotionLab
    };
    bodyEl.innerHTML = (map[state.screen] || renderStudent)();
    if (cfg.animatePage) triggerPageTransition();
    if (cfg.revealAfterSkeleton) bodyEl.classList.add('jg-reveal-in');
    hydrateDynamicVisuals();
  }

  function runSubmitMorph(onSuccessExtra) {
    if (state.submitPhase === 'submitting') return;
    state.submitPhase = 'submitting';
    render();
    setTimeout(() => {
      state.submitPhase = 'success';
      if (onSuccessExtra) onSuccessExtra();
      render();
      setTimeout(() => {
        state.submitPhase = 'idle';
        state.pulseActive = false;
        render();
      }, 1050);
    }, 520);
  }

  function runRankFlipSwap() {
    const listBox = document.getElementById('rankListBox');
    const beforeRects = new Map();
    if (listBox) {
      listBox.querySelectorAll('[data-rank-id]').forEach((el) => {
        beforeRects.set(el.dataset.rankId, el.getBoundingClientRect().top);
      });
    }
    const order = ['month', 'quarter', 'year'];
    const cur = order.indexOf(state.statsPeriod);
    state.statsPeriod = order[(cur + 1) % order.length];
    state.rasterScanActive = true;
    render();
    const afterBox = document.getElementById('rankListBox');
    if (afterBox && !MOTION.reducedMotion()) {
      afterBox.querySelectorAll('[data-rank-id]').forEach((el) => {
        const prevTop = beforeRects.get(el.dataset.rankId);
        if (prevTop === undefined) return;
        const delta = prevTop - el.getBoundingClientRect().top;
        if (Math.abs(delta) > 1) {
          el.style.transition = 'none';
          el.style.transform = `translateY(${delta}px)`;
          void el.offsetWidth;
          el.style.transition = 'transform 460ms cubic-bezier(0.16, 1, 0.3, 1)';
          el.style.transform = 'translateY(0)';
        }
      });
    }
    setTimeout(() => {
      state.rasterScanActive = false;
      const box = document.getElementById('rankListBox');
      if (box) box.classList.remove('is-raster-scan');
    }, 560);
  }

  function navigateTo(screenId) {
    const newIdx = DATA.screens.findIndex((s) => s.id === screenId);
    const oldIdx = DATA.screens.findIndex((s) => s.id === state.screen);
    state.navDir = newIdx < oldIdx ? 'back' : 'fwd';
    state.prevScreenIndex = oldIdx;
    state.screen = screenId;
    state.viewState = 'normal';
    state.submitPhase = 'idle';
    state.pulseActive = false;
    render({ animatePage: true });
    window.scrollTo(0, 0);
  }

  function playLabMotion(id) {
    if (id === 'm01') {
      state.navDir = state.navDir === 'fwd' ? 'back' : 'fwd';
      state.labLog = `已触发 #01 页面转场（方向：${state.navDir === 'fwd' ? '前进' : '后退'}，≤320ms）`;
      render({ animatePage: true });
      return;
    }
    if (id === 'm02') {
      state.labLog = '已触发 #02 列表 Stagger 错峰入场（32–40ms 间隔，位移 10px）';
      render();
      return;
    }
    if (id === 'm03') {
      state.labLog = '已触发 #03 数字 Count-up 600ms 等宽递增';
      const el = document.getElementById('labCountNum');
      if (el) MOTION.animateCountUp(el, 94.6, { decimals: 1, suffix: '%', duration: 600 });
      const log = document.getElementById('labLogBox');
      if (log) log.textContent = state.labLog;
      return;
    }
    if (id === 'm04') {
      state.viewState = 'loading';
      render();
      setTimeout(() => {
        state.viewState = 'normal';
        state.labLog = '已触发 #04 骨架屏 1.2s 扫光 → 内容 200ms 上移淡入';
        render({ revealAfterSkeleton: true });
      }, 900);
      return;
    }
    if (id === 'm05') {
      state.labLog = '已触发 #05 底部抽屉弹性打开（可下滑或点击关闭）';
      openDrawer(
        '底部弹性抽屉（支持下滑手势关闭）',
        '<div class="jg-row-m">遮罩 200ms 渐入，面板使用弹性曲线弹出。按住顶部灰条向下拖拽超过 64px 或点击下方按钮即可收起。</div><button type="button" class="jg-btn jg-btn-primary jg-btn-block" data-action="close-drawer">收起抽屉</button>'
      );
      return;
    }
    if (id === 'm06') {
      state.labLog = '已触发 #06 表单聚焦流光 & 单次 180ms 校验抖动';
      const wrap = document.getElementById('labInputWrap');
      const log = document.getElementById('labLogBox');
      if (log) log.textContent = state.labLog;
      if (wrap) {
        wrap.classList.remove('is-error', 'is-focused');
        void wrap.offsetWidth;
        wrap.classList.add('is-focused', 'is-error');
        setTimeout(() => wrap.classList.remove('is-error'), 420);
      }
      return;
    }
    if (id === 'm07') {
      state.labLog = '已触发 #07 提交进度环 → 400ms 成功环形确认（见考勤/计划页主按钮）';
      navigateTo('06-attendance');
      setTimeout(() => runSubmitMorph(() => { state.pulseActive = true; }), 160);
      return;
    }
    if (id === 'm08') {
      navigateTo('03-parent');
      setTimeout(() => {
        state.parentStudentIndex = (state.parentStudentIndex + 1) % DATA.parent.students.length;
        render();
        const st = document.getElementById('parentScopeStage');
        if (st) st.classList.add('is-wiping');
        showToast('已触发 #08 局部遮罩学生切换');
      }, 220);
      return;
    }
    if (id === 'm09') {
      state.labLog = '已触发 #09 Canvas 2D 趋势图左→右生长 + 120ms 标签淡入';
      const log = document.getElementById('labLogBox');
      if (log) log.textContent = state.labLog;
      const c = document.getElementById('labTrendCanvas');
      if (c) {
        const ev = DATA.stats.chartEvents['100m'];
        MOTION.drawTrendChart(c, { points: ev.points, lowerBetter: ev.lowerBetter, mode: 'normal', daylight: state.daylight });
      }
      return;
    }
    if (id === 'm10') {
      state.labLog = '已触发 #10 自定义深蓝赛道下拉刷新指示器';
      const log = document.getElementById('labLogBox');
      if (log) log.textContent = state.labLog;
      triggerPullRefresh();
      return;
    }
    if (id === 'm11') {
      state.viewState = 'empty';
      render();
      setTimeout(() => {
        const box = document.getElementById('emptyStateBox');
        if (box) box.classList.add('is-leaving');
        setTimeout(() => {
          state.viewState = 'normal';
          state.labLog = '已触发 #11 空态插画淡出 → 列表错峰滑入';
          render();
        }, 200);
      }, 450);
      return;
    }
    if (id === 'm12') {
      navigateTo('02-coach');
      setTimeout(() => {
        state.swipedId = 't1';
        render();
        showToast('已触发 #12 左滑审批展开');
      }, 240);
      return;
    }
    if (id === 'm13') {
      if (variantCfg.id === 'v1') {
        navigateTo('06-attendance');
        setTimeout(() => runSubmitMorph(() => { state.pulseActive = true; }), 180);
      } else if (variantCfg.id === 'v2') {
        navigateTo('01-student');
        setTimeout(() => {
          state.cardFlipped = !state.cardFlipped;
          render();
          showToast('V2 招牌动效：PB 遥测卡 3D 翻面');
        }, 220);
      } else {
        navigateTo('05-stats');
        setTimeout(() => runRankFlipSwap(), 220);
      }
    }
  }

  // 事件委托
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) {
      if (event.target === drawerBackdrop) closeDrawer();
      return;
    }
    if (btn.id === 'daylightBtn') {
      state.daylight = !state.daylight;
      render();
      showToast(state.daylight ? '已切换日光高对比模式' : '已返回黑底深蓝标准模式');
      return;
    }
    if (btn.dataset.screen) {
      navigateTo(btn.dataset.screen);
      return;
    }
    if (btn.dataset.state) {
      state.viewState = btn.dataset.state;
      render();
      return;
    }
    if (btn.dataset.action === 'reset-state') {
      state.viewState = 'normal';
      render();
      return;
    }
    if (btn.dataset.action === 'finish-skeleton') {
      state.viewState = 'normal';
      render({ revealAfterSkeleton: true });
      return;
    }
    if (btn.dataset.action === 'empty-to-data') {
      const box = document.getElementById('emptyStateBox');
      if (box) box.classList.add('is-leaving');
      setTimeout(() => {
        state.viewState = 'normal';
        render();
      }, 190);
      return;
    }
    if (btn.dataset.action === 'open-session-drawer') {
      const s = DATA.student.todaySession;
      openDrawer(
        '今日训练场次详情（底部抽屉）',
        `<div class="jg-row-t">${esc(s.title)}</div><div class="jg-row-m">时间：${esc(s.time)} · 地点：${esc(s.location)}</div><div class="jg-row-m">签到窗：${esc(s.checkInWindow)} · 仅单次主动定位签到，无签退。</div><button type="button" class="jg-btn jg-btn-primary jg-btn-block" data-action="close-drawer">知道了（也可下滑关闭）</button>`
      );
      return;
    }
    if (btn.dataset.action === 'close-drawer') {
      closeDrawer();
      return;
    }
    if (btn.dataset.action === 'trigger-ptr') {
      triggerPullRefresh();
      return;
    }
    if (btn.dataset.action === 'flip-pb-card') {
      state.cardFlipped = !state.cardFlipped;
      const card = document.getElementById('pbFlipCard');
      if (card) card.classList.toggle('is-flipped', state.cardFlipped);
      else render();
      return;
    }
    if (btn.dataset.action === 'toggle-multiselect') {
      state.multiSelectMode = !state.multiSelectMode;
      if (!state.multiSelectMode) state.selectedTodoIds = [];
      render();
      return;
    }
    if (btn.dataset.swipeToggle) {
      const id = btn.dataset.swipeToggle;
      if (state.multiSelectMode) {
        if (state.selectedTodoIds.includes(id)) {
          state.selectedTodoIds = state.selectedTodoIds.filter((x) => x !== id);
        } else {
          state.selectedTodoIds.push(id);
        }
        render();
        return;
      }
      state.swipedId = state.swipedId === id ? null : id;
      render();
      return;
    }
    if (btn.dataset.todoAct && btn.dataset.todoId) {
      const id = btn.dataset.todoId;
      if (!state.doneTodoIds.includes(id)) state.doneTodoIds.push(id);
      state.swipedId = null;
      render();
      showToast(btn.dataset.todoAct === 'approve' ? '已演示审批通过（未写库）' : '已演示退回修改（未写库）');
      return;
    }
    if (btn.dataset.action === 'batch-approve') {
      state.selectedTodoIds.forEach((id) => {
        if (!state.doneTodoIds.includes(id)) state.doneTodoIds.push(id);
      });
      state.selectedTodoIds = [];
      state.multiSelectMode = false;
      render();
      showToast('已批量通过演示待办（未写库）');
      return;
    }
    if (btn.dataset.parentStu !== undefined) {
      state.parentStudentIndex = Number(btn.dataset.parentStu) || 0;
      render();
      const stage = document.getElementById('parentScopeStage');
      if (stage) {
        stage.classList.remove('is-wiping');
        void stage.offsetWidth;
        stage.classList.add('is-wiping');
      }
      return;
    }
    if (btn.dataset.parentSec) {
      state.parentSection = btn.dataset.parentSec;
      render();
      return;
    }
    if (btn.dataset.statsMode) {
      state.statsMode = btn.dataset.statsMode;
      render();
      return;
    }
    if (btn.dataset.statsPeriod) {
      state.statsPeriod = btn.dataset.statsPeriod;
      render();
      return;
    }
    if (btn.dataset.chartEvent) {
      state.chartEvent = btn.dataset.chartEvent;
      render();
      return;
    }
    if (btn.dataset.chartMode) {
      state.chartDataMode = btn.dataset.chartMode;
      render();
      return;
    }
    if (btn.dataset.action === 'trigger-rank-swap') {
      runRankFlipSwap();
      return;
    }
    if (btn.dataset.action === 'mock-export') {
      showToast('已生成演示 XLSX（未访问云端）');
      return;
    }
    if (btn.dataset.attRole) {
      state.attendanceRole = btn.dataset.attRole;
      state.submitPhase = 'idle';
      state.pulseActive = false;
      render();
      return;
    }
    if (btn.dataset.spot) {
      state.selectedSpot = btn.dataset.spot;
      render();
      return;
    }
    if (btn.dataset.action === 'submit-checkin') {
      runSubmitMorph(() => {
        if (state.screen === '06-attendance') state.pulseActive = true;
      });
      return;
    }
    if (btn.dataset.toggle === 'basic') {
      state.planBasicOpen = !state.planBasicOpen;
      render();
      return;
    }
    if (btn.dataset.toggle === 'items') {
      state.planItemsOpen = !state.planItemsOpen;
      render();
      return;
    }
    if (btn.dataset.planType) {
      state.planType = btn.dataset.planType;
      render();
      return;
    }
    if (btn.dataset.action === 'test-plan-shake') {
      state.planTitleError = '计划标题不能为空（单次 180ms 抖动校验演示）';
      render();
      return;
    }
    if (btn.dataset.action === 'add-plan-item') {
      const id = state.nextPlanId++;
      state.planItems.push({ id, name: `核心稳定性与慢跑放松 #${id}`, sets: '2组', reps: '400米', rest: '120秒' });
      render();
      return;
    }
    if (btn.dataset.delItem) {
      const id = Number(btn.dataset.delItem);
      state.planItems = state.planItems.filter((i) => i.id !== id);
      render();
      return;
    }
    if (btn.dataset.labPlay) {
      playLabMotion(btn.dataset.labPlay);
    }
  });

  // 底部抽屉下滑关闭手势（交互 #5）
  let drawerDragY = null;
  if (drawerPanel) {
    drawerPanel.addEventListener('pointerdown', (e) => {
      drawerDragY = e.clientY;
    });
    drawerPanel.addEventListener('pointermove', (e) => {
      if (drawerDragY === null) return;
      const dy = Math.max(0, e.clientY - drawerDragY);
      drawerPanel.style.transform = `translateY(${dy}px)`;
    });
    drawerPanel.addEventListener('pointerup', (e) => {
      if (drawerDragY === null) return;
      const dy = e.clientY - drawerDragY;
      drawerDragY = null;
      if (dy > 64) closeDrawer();
      else drawerPanel.style.transform = '';
    });
  }

  // 待办左滑 + 长按多选手势（交互 #12）
  let swipeStartX = null;
  let longPressTimer = null;
  document.addEventListener('pointerdown', (e) => {
    const fg = e.target.closest('[data-swipe-fg]');
    if (!fg) return;
    const id = fg.dataset.swipeFg;
    swipeStartX = e.clientX;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      state.multiSelectMode = true;
      if (!state.selectedTodoIds.includes(id)) state.selectedTodoIds.push(id);
      render();
      showToast('长按触发批量多选模式');
    }, 480);
  });
  document.addEventListener('pointerup', (e) => {
    clearTimeout(longPressTimer);
    if (swipeStartX === null) return;
    const fg = e.target.closest('[data-swipe-fg]');
    const dx = e.clientX - swipeStartX;
    swipeStartX = null;
    if (!fg) return;
    const id = fg.dataset.swipeFg;
    if (dx < -40) {
      state.swipedId = id;
      render();
    } else if (dx > 40 && state.swipedId === id) {
      state.swipedId = null;
      render();
    }
  });

  // 供 Edge CDP 自动化录屏与关键帧脚本安全调用
  window.__V165_API = {
    navigateTo,
    playLabMotion,
    openDrawer,
    closeDrawer,
    triggerPullRefresh,
    runSubmitMorph,
    runRankFlipSwap,
    setState(patch) {
      Object.assign(state, patch);
      render();
    },
    getState() {
      return { ...state };
    }
  };

  render();
};
