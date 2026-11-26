'use strict';

(function () {
  const DATA = window.JOGER_R3_DATA;
  const params = new URLSearchParams(window.location.search);
  const state = {
    screen: params.get('screen') || '01-student',
    viewState: params.get('state') || 'normal',
    parentStudentIndex: 0,
    parentSection: 'overview',
    statsMode: 'performance',
    statsPeriod: 'month',
    attendanceRole: 'student',
    selectedSpot: 'east',
    checkedInFeedback: '',
    planType: '单日专项',
    planBasicOpen: true,
    planItemsOpen: true,
    planItems: DATA.plan.initialItems.map((item) => ({ ...item })),
    nextPlanId: 4
  };

  const titleEl = document.getElementById('screenTitle');
  const roleEl = document.getElementById('screenRole');
  const bodyEl = document.getElementById('screenBody');
  const navTop = document.getElementById('navRowTop');
  const navBottom = document.getElementById('navRowBottom');

  function esc(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderNav() {
    const topItems = DATA.screens.slice(0, 4);
    const bottomItems = DATA.screens.slice(4);
    const toHtml = (list) =>
      list
        .map(
          (s) =>
            `<button type="button" class="v1-nav-btn ${state.screen === s.id ? 'is-active' : ''}" data-screen="${s.id}">${esc(s.short)}</button>`
        )
        .join('');
    navTop.innerHTML = toHtml(topItems);
    navBottom.innerHTML = toHtml(bottomItems);

    document.querySelectorAll('.v1-state-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.state === state.viewState);
    });
  }

  function renderNonNormalState() {
    if (state.viewState === 'loading') {
      return `
        <div class="v1-skel"></div>
        <div class="v1-skel"></div>
        <div class="v1-skel"></div>
        <div class="v1-note">正在从云函数加载授权范围数据（演示加载态）…</div>
      `;
    }
    if (state.viewState === 'empty') {
      return `
        <div class="v1-empty">
          <div class="v1-card-title">当前暂无可展示记录</div>
          <div class="v1-row-m">系统仅展示真实录入与审核通过的业务数据，不填充模拟占位值。</div>
          <button type="button" class="v1-btn" data-action="reset-state">返回正常演示</button>
        </div>
      `;
    }
    return `
      <div class="v1-err-box">
        <div class="v1-card-title">数据加载未完成</div>
        <div class="v1-row-m">网络波动或服务端校验拒绝（错误码示例：NETWORK_ERROR），未写入任何业务数据。</div>
        <button type="button" class="v1-btn v1-btn-danger" data-action="reset-state">重新加载</button>
      </div>
    `;
  }

  function renderStudent() {
    const s = DATA.student;
    return `
      <section class="v1-hero">
        <div class="v1-hero-k">今日训练指令 · ${esc(s.group)}</div>
        <div class="v1-hero-num-row">
          <span class="v1-hero-num">${esc(s.pb.value)}</span>
          <span class="v1-hero-unit">${esc(s.pb.unit)} · ${esc(s.pb.event)} PB</span>
        </div>
        <div class="v1-hero-meta">${esc(s.todaySession.title)}（${esc(s.todaySession.time)}）· ${esc(s.todaySession.status)}</div>
        <div class="v1-hero-metrics">
          <div class="v1-hero-metric">
            <div class="v1-hero-metric-l">本月出勤率</div>
            <div class="v1-hero-metric-v">${esc(s.monthlyAttendance.rate)}</div>
          </div>
          <div class="v1-hero-metric">
            <div class="v1-hero-metric-l">已入部</div>
            <div class="v1-hero-metric-v">${s.joinedDays} 天</div>
          </div>
        </div>
      </section>

      <section class="v1-deck">
        ${s.quickEntries
          .map(
            (e) =>
              `<button type="button" class="v1-deck-btn" data-screen="${e.screen}"><span>${esc(e.label)}</span><span class="v1-chip v1-chip-ok">${esc(e.tag)}</span></button>`
          )
          .join('')}
      </section>

      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">俱乐部通知</div>
          <div class="v1-card-sub">${s.notices.length} 条</div>
        </div>
        ${s.notices
          .map(
            (n) => `
          <div class="v1-row">
            <div class="v1-row-main">
              <div class="v1-row-t">${esc(n.title)}</div>
              <div class="v1-row-m">发布日期 ${esc(n.date)} · ${n.unread ? '未读' : '已读'}</div>
            </div>
            <span class="v1-chip ${n.priority === '重要' ? 'v1-chip-err' : 'v1-chip-neutral'}">${esc(n.priority)}</span>
          </div>`
          )
          .join('')}
      </section>
    `;
  }

  function renderCoach() {
    const c = DATA.coach;
    const f = c.todayFocus;
    return `
      <section class="v1-hero">
        <div class="v1-hero-k">今日考勤焦点 · ${esc(f.date)}</div>
        <div class="v1-hero-num-row">
          <span class="v1-hero-num">${f.checkedIn}/${f.expected}</span>
          <span class="v1-hero-unit">已签到人数</span>
        </div>
        <div class="v1-hero-meta">${esc(f.title)} · 开放窗口 ${esc(f.window)}</div>
        <div class="v1-hero-metrics">
          <div class="v1-hero-metric"><div class="v1-hero-metric-l">待人工核实</div><div class="v1-hero-metric-v">${f.pendingVerify}</div></div>
          <div class="v1-hero-metric"><div class="v1-hero-metric-l">迟到</div><div class="v1-hero-metric-v">${f.late}</div></div>
          <div class="v1-hero-metric"><div class="v1-hero-metric-l">已批请假</div><div class="v1-hero-metric-v">${f.leaveApproved}</div></div>
        </div>
      </section>

      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">待办审核队列</div>
          <div class="v1-card-sub">${c.todos.length} 项</div>
        </div>
        ${c.todos
          .map(
            (t) => `
          <div class="v1-row">
            <div class="v1-row-main">
              <div class="v1-row-t">${esc(t.type)} · ${esc(t.student)}</div>
              <div class="v1-row-m">${esc(t.detail)}</div>
            </div>
            <span class="v1-chip ${t.priority === 'P1' ? 'v1-chip-warn' : 'v1-chip-neutral'}">${esc(t.priority)}</span>
          </div>`
          )
          .join('')}
      </section>

      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">赛事意向与材料核验</div>
          <div class="v1-card-sub">内部意向≠官方报名</div>
        </div>
        ${c.competitions
          .map(
            (item) => `
          <div class="v1-row">
            <div class="v1-row-main">
              <div class="v1-row-t">${esc(item.title)}</div>
              <div class="v1-row-m">意向 ${item.intentCount} 人 · 已传材料 ${item.materialCount} 份 · ${esc(item.status)}</div>
            </div>
          </div>`
          )
          .join('')}
      </section>
    `;
  }

  function renderParent() {
    const stu = DATA.parent.students[state.parentStudentIndex];
    return `
      <div class="v1-note">家长端为严格只读视图：无任何修改学生数据入口，不展示精确 GPS 坐标与教练内部评价。</div>
      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">切换已授权关联学生</div>
          <div class="v1-card-sub">共 ${DATA.parent.students.length} 人</div>
        </div>
        <div class="v1-btn-row">
          ${DATA.parent.students
            .map(
              (item, idx) =>
                `<button type="button" class="v1-btn v1-btn-ghost ${idx === state.parentStudentIndex ? 'is-active' : ''}" data-parent-stu="${idx}">${esc(item.name)}</button>`
            )
            .join('')}
        </div>
        <div class="v1-btn-row">
          ${DATA.parent.sections
            .map(
              (sec) =>
                `<button type="button" class="v1-btn v1-btn-ghost ${state.parentSection === sec.id ? 'is-active' : ''}" data-parent-sec="${sec.id}">${esc(sec.label)}</button>`
            )
            .join('')}
        </div>
      </section>

      <section class="v1-hero">
        <div class="v1-hero-k">${esc(stu.group)} · 只读概览</div>
        <div class="v1-hero-num-row">
          <span class="v1-hero-num">${esc(stu.pb)}</span>
          <span class="v1-hero-unit">${esc(stu.pbEvent)}</span>
        </div>
        <div class="v1-hero-metrics">
          <div class="v1-hero-metric"><div class="v1-hero-metric-l">本月出勤</div><div class="v1-hero-metric-v">${esc(stu.attendanceRate)}</div></div>
          <div class="v1-hero-metric"><div class="v1-hero-metric-l">有效出勤</div><div class="v1-hero-metric-v">${esc(stu.validDays)}</div></div>
          <div class="v1-hero-metric"><div class="v1-hero-metric-l">已批请假</div><div class="v1-hero-metric-v">${esc(stu.approvedLeave)}</div></div>
        </div>
      </section>

      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">当前查看分区：${esc((DATA.parent.sections.find((s) => s.id === state.parentSection) || {}).label)}</div>
          <div class="v1-card-sub">只读</div>
        </div>
        ${
          state.parentSection === 'plans'
            ? stu.plans
                .map((p) => `<div class="v1-row"><div class="v1-row-main"><div class="v1-row-t">${esc(p.title)}</div><div class="v1-row-m">${esc(p.period)} · ${esc(p.items)}</div></div></div>`)
                .join('')
            : state.parentSection === 'performance'
            ? stu.performances
                .map((p) => `<div class="v1-row"><div class="v1-row-main"><div class="v1-row-t">${esc(p.event)}</div><div class="v1-row-m">取得日期 ${esc(p.date)}（已审核）</div></div><div class="v1-num">${esc(p.value)}</div></div>`)
                .join('')
            : state.parentSection === 'attendance'
            ? stu.attendance
                .map((a) => `<div class="v1-row"><div class="v1-row-main"><div class="v1-row-t">${esc(a.date)}</div><div class="v1-row-m">${esc(a.status)}</div></div></div>`)
                .join('')
            : state.parentSection === 'feedback'
            ? stu.feedback
                .map((f) => `<div class="v1-row"><div class="v1-row-main"><div class="v1-row-t">${esc(f.date)} · ${esc(f.completion)}</div><div class="v1-row-m">学生自评强度 RPE ${esc(f.rpe)}</div></div></div>`)
                .join('')
            : stu.events
                .map((e) => `<div class="v1-row"><div class="v1-row-main"><div class="v1-row-t">${esc(e.title)}</div><div class="v1-row-m">${esc(e.type)}</div></div><span class="v1-chip v1-chip-warn">${esc(e.badge)}</span></div>`)
                .join('')
        }
      </section>
    `;
  }

  function renderDeveloper() {
    const d = DATA.developer;
    return `
      <section class="v1-hero">
        <div class="v1-hero-k">系统运行状态 · ${esc(d.system.env)}</div>
        <div class="v1-hero-num-row">
          <span class="v1-hero-num">23</span>
          <span class="v1-hero-unit">集合全 ADMINONLY</span>
        </div>
        <div class="v1-hero-meta">云函数 ${esc(d.system.apiStatus)} · 存储：${esc(d.system.storageAcl)}</div>
      </section>

      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">账号与角色审批队列</div>
          <div class="v1-card-sub">${d.approvals.length} 项待审</div>
        </div>
        ${d.approvals
          .map(
            (a) => `
          <div class="v1-row">
            <div class="v1-row-main">
              <div class="v1-row-t">${esc(a.name)}</div>
              <div class="v1-row-m">${esc(a.roleType)} · ${esc(a.detail)}</div>
            </div>
            <span class="v1-chip v1-chip-warn">待审</span>
          </div>`
          )
          .join('')}
      </section>

      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">训练组与教练归属范围</div>
          <div class="v1-card-sub">共 ${d.groups.length} 组</div>
        </div>
        ${d.groups
          .map(
            (g) => `
          <div class="v1-row">
            <div class="v1-row-main">
              <div class="v1-row-t">${esc(g.name)}</div>
              <div class="v1-row-m">负责教练：${esc(g.coaches)} · 成员 ${g.students} 人</div>
            </div>
            <span class="v1-chip v1-chip-ok">启用</span>
          </div>`
          )
          .join('')}
      </section>

      <div class="v1-note">审计留痕约束：所有角色授予/撤销、账号删除、关联审核及材料下载均由服务端事务写入 audit_logs，前端不持有授权决定权。</div>
    `;
  }

  function renderStats() {
    const isPerf = state.statsMode === 'performance';
    const rows = isPerf
      ? DATA.stats.performance[state.statsPeriod]
      : DATA.stats.attendance[state.statsPeriod];
    return `
      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">榜单类型与统计周期</div>
        </div>
        <div class="v1-btn-row">
          <button type="button" class="v1-btn v1-btn-ghost ${isPerf ? 'is-active' : ''}" data-stats-mode="performance">成绩排行榜</button>
          <button type="button" class="v1-btn v1-btn-ghost ${!isPerf ? 'is-active' : ''}" data-stats-mode="attendance">考勤排行榜</button>
        </div>
        <div class="v1-btn-row">
          ${DATA.stats.periods
            .map(
              (p) =>
                `<button type="button" class="v1-btn v1-btn-ghost ${state.statsPeriod === p.key ? 'is-active' : ''}" data-stats-period="${p.key}">${esc(p.label)}</button>`
            )
            .join('')}
        </div>
      </section>

      <div class="v1-note ${isPerf ? '' : 'v1-note-warn'}">
        ${
          isPerf
            ? '正式成绩口径：仅计入教练审核通过的记录，未审核与驳回申报绝不进入正式排行。'
            : '估算口径提示：周期内若训练组成员历史不完整，系统不生成正式名次（rank 置空），且样本不足 3 场不领先。'
        }
      </div>

      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">${isPerf ? '100米 正式成绩榜' : '训练组考勤统计'}</div>
          <button type="button" class="v1-btn v1-btn-ghost" data-action="mock-export">导出 XLSX</button>
        </div>
        ${rows
          .map(
            (r) => `
          <div class="v1-row">
            <div class="v1-row-main">
              <div class="v1-row-t">#${esc(r.rank)} ${esc(r.name)}</div>
              <div class="v1-row-m">${esc(r.group)} ${isPerf ? `· 教练 ${esc(r.coach)} · 历史PB ${esc(r.pb)}` : `· 有效 ${esc(r.valid)} · ${esc(r.note)}`}</div>
            </div>
            <div class="v1-num">${esc(isPerf ? r.value : r.rate)}</div>
          </div>`
          )
          .join('')}
      </section>
    `;
  }

  function renderAttendance() {
    const spot =
      DATA.attendance.spots.find((s) => s.id === state.selectedSpot) ||
      DATA.attendance.spots[0];
    const isStudent = state.attendanceRole === 'student';
    return `
      <section class="v1-card">
        <div class="v1-btn-row">
          <button type="button" class="v1-btn v1-btn-ghost ${isStudent ? 'is-active' : ''}" data-att-role="student">学生主动签到</button>
          <button type="button" class="v1-btn v1-btn-ghost ${!isStudent ? 'is-active' : ''}" data-att-role="coach">教练创建场次</button>
        </div>
      </section>

      <section class="v1-card">
        <div class="v1-card-head">
          <div class="v1-card-title">场地范围静态示意（无地图 SDK）</div>
          <div class="v1-card-sub">半径 ${esc(spot.radius)}</div>
        </div>
        <div class="v1-map-box">
          <div class="v1-map-track"></div>
          <div class="v1-map-pin">${esc(spot.label)}</div>
          <div class="v1-map-caption">坐标：${esc(spot.coordText)}</div>
        </div>
        <div class="v1-btn-row">
          ${DATA.attendance.spots
            .map(
              (sp) =>
                `<button type="button" class="v1-btn v1-btn-ghost ${state.selectedSpot === sp.id ? 'is-active' : ''}" data-spot="${sp.id}">${esc(sp.label)}</button>`
            )
            .join('')}
        </div>
      </section>

      ${
        isStudent
          ? `
        <section class="v1-card">
          <div class="v1-card-title">今日单次主动定位签到</div>
          <div class="v1-row-m">仅在点击签到时请求一次位置，由服务端计算距离；无签退功能，请假不上传附件。</div>
          <button type="button" class="v1-btn v1-btn-block" data-action="mock-checkin">发起一次定位并签到</button>
          ${state.checkedInFeedback ? `<div class="v1-note">${esc(state.checkedInFeedback)}</div>` : ''}
        </section>`
          : `
        <section class="v1-card">
          <div class="v1-card-title">新建考勤场次（表单示例）</div>
          <div class="v1-field">
            <label class="v1-label" for="v1SessionTitle">场次标题</label>
            <input id="v1SessionTitle" class="v1-input" value="短跑一队傍晚训练" />
          </div>
          <div class="v1-field">
            <label class="v1-label" for="v1SessionWin">开放时间与迟到线</label>
            <input id="v1SessionWin" class="v1-input" value="16:15 - 16:45（迟到线 16:30）" />
          </div>
          <button type="button" class="v1-btn v1-btn-block" data-action="mock-checkin">保存考勤场次（演示）</button>
          ${state.checkedInFeedback ? `<div class="v1-note">${esc(state.checkedInFeedback)}</div>` : ''}
        </section>`
      }
    `;
  }

  function renderPlan() {
    return `
      <div class="v1-note">全部训练计划由教练人工编写并发布，系统不自动生成或推荐训练计划。</div>
      <section class="v1-card">
        <button type="button" class="v1-accordion-btn" data-toggle="basic">
          <span>一、基础信息与计划类型</span>
          <span>${state.planBasicOpen ? '收起' : '展开'}</span>
        </button>
        ${
          state.planBasicOpen
            ? `
          <div class="v1-btn-row">
            ${DATA.plan.types
              .map(
                (t) =>
                  `<button type="button" class="v1-btn v1-btn-ghost ${state.planType === t ? 'is-active' : ''}" data-plan-type="${esc(t)}">${esc(t)}</button>`
              )
              .join('')}
          </div>
          <div class="v1-field">
            <label class="v1-label" for="v1PlanTitle">计划标题</label>
            <input id="v1PlanTitle" class="v1-input" value="短跑一队·${esc(state.planType)}训练安排" />
          </div>
          <div class="v1-field">
            <label class="v1-label" for="v1PlanGroup">适用训练组</label>
            <input id="v1PlanGroup" class="v1-input" value="短跑一队 · 2026秋" />
          </div>`
            : ''
        }
      </section>

      <section class="v1-card">
        <button type="button" class="v1-accordion-btn" data-toggle="items">
          <span>二、训练内容条目（共 ${state.planItems.length} 项）</span>
          <span>${state.planItemsOpen ? '收起' : '展开'}</span>
        </button>
        ${
          state.planItemsOpen
            ? `
          ${state.planItems
            .map(
              (item, idx) => `
            <div class="v1-row">
              <div class="v1-row-main">
                <div class="v1-row-t">${idx + 1}. ${esc(item.name)}</div>
                <div class="v1-row-m">${esc(item.sets)} · ${esc(item.reps)} · 间歇 ${esc(item.rest)}</div>
              </div>
              <button type="button" class="v1-btn v1-btn-danger" data-del-item="${item.id}">删除</button>
            </div>`
            )
            .join('')}
          <button type="button" class="v1-btn v1-btn-ghost v1-btn-block" data-action="add-plan-item">+ 新增训练内容条目</button>`
            : ''
        }
      </section>
    `;
  }

  function render() {
    const meta =
      DATA.screens.find((s) => s.id === state.screen) || DATA.screens[0];
    titleEl.textContent = meta.label;
    roleEl.textContent = meta.role;
    renderNav();

    if (state.viewState !== 'normal') {
      bodyEl.innerHTML = renderNonNormalState();
      return;
    }

    const renderers = {
      '01-student': renderStudent,
      '02-coach': renderCoach,
      '03-parent': renderParent,
      '04-developer': renderDeveloper,
      '05-stats': renderStats,
      '06-attendance': renderAttendance,
      '07-plan': renderPlan
    };
    bodyEl.innerHTML = (renderers[state.screen] || renderStudent)();
  }

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.screen) {
      state.screen = btn.dataset.screen;
      state.viewState = 'normal';
      state.checkedInFeedback = '';
      render();
      window.scrollTo(0, 0);
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
    if (btn.dataset.parentStu !== undefined) {
      state.parentStudentIndex = Number(btn.dataset.parentStu) || 0;
      render();
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
    if (btn.dataset.attRole) {
      state.attendanceRole = btn.dataset.attRole;
      state.checkedInFeedback = '';
      render();
      return;
    }
    if (btn.dataset.spot) {
      state.selectedSpot = btn.dataset.spot;
      render();
      return;
    }
    if (btn.dataset.action === 'mock-checkin') {
      state.checkedInFeedback = '本地演示反馈：已模拟提交（未调用云函数、未写入业务数据）。';
      render();
      return;
    }
    if (btn.dataset.action === 'mock-export') {
      state.viewState = 'normal';
      btn.textContent = '已生成演示 XLSX';
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
    if (btn.dataset.action === 'add-plan-item') {
      const id = state.nextPlanId++;
      state.planItems.push({
        id,
        name: `放松慢跑与静态拉伸 #${id}`,
        sets: '2组',
        reps: '400米',
        rest: '120秒'
      });
      render();
      return;
    }
    if (btn.dataset.delItem) {
      const id = Number(btn.dataset.delItem);
      state.planItems = state.planItems.filter((item) => item.id !== id);
      render();
    }
  });

  render();
})();
