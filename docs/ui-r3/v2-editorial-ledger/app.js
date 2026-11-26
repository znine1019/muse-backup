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

  const idxEl = document.getElementById('screenIndex');
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
            `<button type="button" class="v2-nav-btn ${state.screen === s.id ? 'is-active' : ''}" data-screen="${s.id}">${esc(s.short)}</button>`
        )
        .join('');
    navTop.innerHTML = toHtml(topItems);
    navBottom.innerHTML = toHtml(bottomItems);

    document.querySelectorAll('.v2-state-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.state === state.viewState);
    });
  }

  function renderNonNormal() {
    if (state.viewState === 'loading') {
      return `
        <div class="v2-skel-line"></div>
        <div class="v2-skel-line"></div>
        <div class="v2-skel-line"></div>
        <div class="v2-callout">账本索引加载中：正在通过服务端校验身份与数据归属…</div>
      `;
    }
    if (state.viewState === 'empty') {
      return `
        <div class="v2-state-box">
          <div class="v2-band-title">当前筛选条件下无账本记录</div>
          <div class="v2-row-sub">系统仅展示真实录入并审核通过的训练与考勤记录，不生成默认占位成绩。</div>
          <button type="button" class="v2-btn v2-btn-primary" data-action="reset-state">返回正常账本</button>
        </div>
      `;
    }
    return `
      <div class="v2-state-box v2-state-box-err">
        <div class="v2-band-title">云端读取中断</div>
        <div class="v2-row-sub">错误码示例：CLOUD_TIMEOUT。当前页面未写入任何变更，可安全重试。</div>
        <button type="button" class="v2-btn v2-btn-primary" data-action="reset-state">重新读取数据</button>
      </div>
    `;
  }

  function renderStudent() {
    const s = DATA.student;
    return `
      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">01</span>
            <span class="v2-band-title">${esc(s.name)} · 核心指标</span>
          </div>
          <span class="v2-band-meta">${esc(s.group)}</span>
        </div>
        <div class="v2-kpi-strip">
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">${esc(s.pb.event)} PB</div>
            <div class="v2-kpi-val is-accent">${esc(s.pb.value)}${esc(s.pb.unit)}</div>
            <div class="v2-kpi-sub">${esc(s.pb.status)}</div>
          </div>
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">本月出勤</div>
            <div class="v2-kpi-val">${esc(s.monthlyAttendance.rate)}</div>
            <div class="v2-kpi-sub">${s.monthlyAttendance.valid}/${s.monthlyAttendance.expected} 场</div>
          </div>
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">入部累计</div>
            <div class="v2-kpi-val">${s.joinedDays}天</div>
            <div class="v2-kpi-sub">请假 ${s.monthlyAttendance.approvedLeave} 场</div>
          </div>
        </div>
        <div class="v2-ledger-row">
          <div class="v2-row-main">
            <div class="v2-row-title">今日训练：${esc(s.todaySession.title)}</div>
            <div class="v2-row-sub">${esc(s.todaySession.time)} · ${esc(s.todaySession.location)}</div>
          </div>
          <span class="v2-tag v2-tag-crimson">${esc(s.todaySession.status)}</span>
        </div>
      </section>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">02</span>
            <span class="v2-band-title">业务目录入口</span>
          </div>
          <span class="v2-band-meta">点击直达</span>
        </div>
        ${s.quickEntries
          .map(
            (e, i) => `
          <button type="button" class="v2-index-link" data-screen="${e.screen}">
            <span class="v2-index-link-l">0${i + 1}. ${esc(e.label)}</span>
            <span class="v2-tag v2-tag-ok">${esc(e.tag)}</span>
          </button>`
          )
          .join('')}
      </section>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">03</span>
            <span class="v2-band-title">俱乐部通知记录</span>
          </div>
          <span class="v2-band-meta">${s.notices.length} 条</span>
        </div>
        <div class="v2-table-head">
          <span>标题与状态</span>
          <span>级别</span>
        </div>
        ${s.notices
          .map(
            (n) => `
          <div class="v2-ledger-row">
            <div class="v2-row-main">
              <div class="v2-row-title">${esc(n.title)}</div>
              <div class="v2-row-sub">${esc(n.date)} · ${n.unread ? '未读' : '已读'}</div>
            </div>
            <span class="v2-tag ${n.priority === '重要' ? 'v2-tag-crimson' : ''}">${esc(n.priority)}</span>
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
      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">01</span>
            <span class="v2-band-title">今日考勤台账</span>
          </div>
          <span class="v2-band-meta">${esc(f.date)}</span>
        </div>
        <div class="v2-kpi-strip">
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">已签到</div>
            <div class="v2-kpi-val is-accent">${f.checkedIn}/${f.expected}</div>
            <div class="v2-kpi-sub">${esc(f.window)}</div>
          </div>
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">待核实</div>
            <div class="v2-kpi-val">${f.pendingVerify}</div>
            <div class="v2-kpi-sub">需教练复核</div>
          </div>
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">迟到/请假</div>
            <div class="v2-kpi-val">${f.late}/${f.leaveApproved}</div>
            <div class="v2-kpi-sub">无签退字段</div>
          </div>
        </div>
      </section>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">02</span>
            <span class="v2-band-title">待办审批清单</span>
          </div>
          <span class="v2-band-meta">${c.todos.length} 项待处理</span>
        </div>
        <div class="v2-table-head">
          <span>类型 / 学生 / 说明</span>
          <span>优先级</span>
        </div>
        ${c.todos
          .map(
            (t) => `
          <div class="v2-ledger-row">
            <div class="v2-row-main">
              <div class="v2-row-title">${esc(t.type)} · ${esc(t.student)}</div>
              <div class="v2-row-sub">${esc(t.detail)}</div>
            </div>
            <span class="v2-tag ${t.priority === 'P1' ? 'v2-tag-crimson' : ''}">${esc(t.priority)}</span>
          </div>`
          )
          .join('')}
      </section>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">03</span>
            <span class="v2-band-title">赛事意向与材料台账</span>
          </div>
          <span class="v2-band-meta">意向≠官方成功</span>
        </div>
        ${c.competitions
          .map(
            (item) => `
          <div class="v2-ledger-row">
            <div class="v2-row-main">
              <div class="v2-row-title">${esc(item.title)}</div>
              <div class="v2-row-sub">意向 ${item.intentCount} 人 · 材料 ${item.materialCount} 份 · ${esc(item.status)}</div>
            </div>
            <span class="v2-tag v2-tag-info">${item.materialCount}/${item.intentCount}</span>
          </div>`
          )
          .join('')}
      </section>
    `;
  }

  function renderParent() {
    const stu = DATA.parent.students[state.parentStudentIndex];
    const secLabel = (DATA.parent.sections.find((s) => s.id === state.parentSection) || {}).label;
    return `
      <div class="v2-callout">严格只读账本：家长仅可查阅已关联学生公开摘要，无任何编辑入口，不暴露精确坐标与内部评语。</div>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">01</span>
            <span class="v2-band-title">关联学生与只读分区</span>
          </div>
          <span class="v2-band-meta">只读</span>
        </div>
        <div class="v2-ctrl-pad">
          <div class="v2-btn-row">
            ${DATA.parent.students
              .map(
                (item, idx) =>
                  `<button type="button" class="v2-btn v2-btn-grow ${idx === state.parentStudentIndex ? 'is-active' : ''}" data-parent-stu="${idx}">${esc(item.name)}</button>`
              )
              .join('')}
          </div>
          <div class="v2-btn-row">
            ${DATA.parent.sections
              .map(
                (sec) =>
                  `<button type="button" class="v2-btn ${state.parentSection === sec.id ? 'is-active' : ''}" data-parent-sec="${sec.id}">${esc(sec.label)}</button>`
              )
              .join('')}
          </div>
        </div>
        <div class="v2-kpi-strip">
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">审核 PB</div>
            <div class="v2-kpi-val is-accent">${esc(stu.pb)}</div>
            <div class="v2-kpi-sub">${esc(stu.event)}</div>
          </div>
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">本月出勤</div>
            <div class="v2-kpi-val">${esc(stu.attendanceRate)}</div>
            <div class="v2-kpi-sub">${esc(stu.validDays)}</div>
          </div>
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">已批请假</div>
            <div class="v2-kpi-val">${esc(stu.approvedLeave)}</div>
            <div class="v2-kpi-sub">${esc(stu.group)}</div>
          </div>
        </div>
      </section>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">02</span>
            <span class="v2-band-title">${esc(secLabel)}明细</span>
          </div>
          <span class="v2-band-meta">${esc(stu.name)}</span>
        </div>
        ${
          state.parentSection === 'plans'
            ? stu.plans
                .map((p) => `<div class="v2-ledger-row"><div class="v2-row-main"><div class="v2-row-title">${esc(p.title)}</div><div class="v2-row-sub">${esc(p.period)} · ${esc(p.items)}</div></div></div>`)
                .join('')
            : state.parentSection === 'performance'
            ? stu.performances
                .map((p) => `<div class="v2-ledger-row"><div class="v2-row-main"><div class="v2-row-title">${esc(p.event)}</div><div class="v2-row-sub">日期 ${esc(p.date)}（教练已审）</div></div><span class="v2-row-num">${esc(p.value)}</span></div>`)
                .join('')
            : state.parentSection === 'attendance'
            ? stu.attendance
                .map((a) => `<div class="v2-ledger-row"><div class="v2-row-main"><div class="v2-row-title">${esc(a.date)}</div><div class="v2-row-sub">${esc(a.status)}</div></div></div>`)
                .join('')
            : state.parentSection === 'feedback'
            ? stu.feedback
                .map((f) => `<div class="v2-ledger-row"><div class="v2-row-main"><div class="v2-row-title">${esc(f.date)} · ${esc(f.completion)}</div><div class="v2-row-sub">强度 RPE ${esc(f.rpe)}</div></div></div>`)
                .join('')
            : stu.events
                .map((e) => `<div class="v2-ledger-row"><div class="v2-row-main"><div class="v2-row-title">${esc(e.title)}</div><div class="v2-row-sub">${esc(e.type)}</div></div><span class="v2-tag v2-tag-crimson">${esc(e.badge)}</span></div>`)
                .join('')
        }
      </section>
    `;
  }

  function renderDeveloper() {
    const d = DATA.developer;
    return `
      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">01</span>
            <span class="v2-band-title">运行环境与权限基线</span>
          </div>
          <span class="v2-band-meta">只读快照</span>
        </div>
        <div class="v2-kpi-strip">
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">数据集合</div>
            <div class="v2-kpi-val is-accent">23</div>
            <div class="v2-kpi-sub">全 ADMINONLY</div>
          </div>
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">API 超时</div>
            <div class="v2-kpi-val">20s</div>
            <div class="v2-kpi-sub">Active</div>
          </div>
          <div class="v2-kpi-cell">
            <div class="v2-kpi-label">待审队列</div>
            <div class="v2-kpi-val">${d.system.pendingReviews}</div>
            <div class="v2-kpi-sub">需事务审计</div>
          </div>
        </div>
        <div class="v2-ledger-row">
          <div class="v2-row-main">
            <div class="v2-row-title">云环境 ${esc(d.system.env)}</div>
            <div class="v2-row-sub">云存储权限：${esc(d.system.storageAcl)}</div>
          </div>
          <span class="v2-tag v2-tag-ok">正常</span>
        </div>
      </section>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">02</span>
            <span class="v2-band-title">账号与角色终审台账</span>
          </div>
          <span class="v2-band-meta">${d.approvals.length} 条</span>
        </div>
        ${d.approvals
          .map(
            (a) => `
          <div class="v2-ledger-row">
            <div class="v2-row-main">
              <div class="v2-row-title">${esc(a.name)} · ${esc(a.roleType)}</div>
              <div class="v2-row-sub">${esc(a.detail)}</div>
            </div>
            <span class="v2-tag v2-tag-crimson">待审</span>
          </div>`
          )
          .join('')}
      </section>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">03</span>
            <span class="v2-band-title">训练组与教练范围</span>
          </div>
          <span class="v2-band-meta">${d.groups.length} 组</span>
        </div>
        ${d.groups
          .map(
            (g) => `
          <div class="v2-ledger-row">
            <div class="v2-row-main">
              <div class="v2-row-title">${esc(g.name)}</div>
              <div class="v2-row-sub">教练：${esc(g.coaches)} · 学生 ${g.students} 人</div>
            </div>
            <span class="v2-tag v2-tag-ok">启用</span>
          </div>`
          )
          .join('')}
      </section>

      <div class="v2-callout">审计说明：角色变更、关联核验、删除组/账号均由云函数服务端事务写入 audit_logs。</div>
    `;
  }

  function renderStats() {
    const isPerf = state.statsMode === 'performance';
    const rows = isPerf
      ? DATA.stats.performance[state.statsPeriod]
      : DATA.stats.attendance[state.statsPeriod];
    return `
      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">01</span>
            <span class="v2-band-title">榜单维度与周期</span>
          </div>
          <button type="button" class="v2-btn" data-action="mock-export">导出 XLSX</button>
        </div>
        <div class="v2-ctrl-pad">
          <div class="v2-btn-row">
            <button type="button" class="v2-btn v2-btn-grow ${isPerf ? 'is-active' : ''}" data-stats-mode="performance">成绩排行榜</button>
            <button type="button" class="v2-btn v2-btn-grow ${!isPerf ? 'is-active' : ''}" data-stats-mode="attendance">考勤排行榜</button>
          </div>
          <div class="v2-btn-row">
            ${DATA.stats.periods
              .map(
                (p) =>
                  `<button type="button" class="v2-btn v2-btn-grow ${state.statsPeriod === p.key ? 'is-active' : ''}" data-stats-period="${p.key}">${esc(p.label)}</button>`
              )
              .join('')}
          </div>
        </div>
      </section>

      <div class="v2-callout ${isPerf ? '' : 'v2-callout-warn'}">
        ${
          isPerf
            ? '成绩口径：仅计入教练已审核通过记录，未审核申报禁止入榜。'
            : '历史成员不完整估算口径提示：周期内成员变动缺历史快照时，不输出正式名次（rank 置空），且样本不足 3 场不领先。'
        }
      </div>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">02</span>
            <span class="v2-band-title">${isPerf ? '100米 正式成绩账本' : '训练组考勤账本'}</span>
          </div>
          <span class="v2-band-meta">${rows.length} 条记录</span>
        </div>
        <div class="v2-table-head">
          <span>名次 / 成员 / 归属</span>
          <span>${isPerf ? '最好成绩' : '有效出勤率'}</span>
        </div>
        ${rows
          .map(
            (r) => `
          <div class="v2-ledger-row">
            <div class="v2-row-main">
              <div class="v2-row-title">#${esc(r.rank)} ${esc(r.name)}</div>
              <div class="v2-row-sub">${esc(r.group)} ${isPerf ? `· 教练 ${esc(r.coach)} · 历史PB ${esc(r.pb)}` : `· 有效 ${esc(r.valid)} · ${esc(r.note)}`}</div>
            </div>
            <span class="v2-row-num">${esc(isPerf ? r.value : r.rate)}</span>
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
      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">01</span>
            <span class="v2-band-title">考勤视图切换</span>
          </div>
          <span class="v2-band-meta">单次主动定位</span>
        </div>
        <div class="v2-ctrl-pad">
          <div class="v2-btn-row">
            <button type="button" class="v2-btn v2-btn-grow ${isStudent ? 'is-active' : ''}" data-att-role="student">学生主动签到</button>
            <button type="button" class="v2-btn v2-btn-grow ${!isStudent ? 'is-active' : ''}" data-att-role="coach">教练创建场次</button>
          </div>
        </div>
      </section>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">02</span>
            <span class="v2-band-title">选点围栏示意（纯 CSS）</span>
          </div>
          <span class="v2-band-meta">半径 ${esc(spot.radius)}</span>
        </div>
        <div class="v2-map-frame">
          <div class="v2-map-ring">${esc(spot.label)}</div>
          <div class="v2-map-coord">${esc(spot.coordText)}</div>
        </div>
        <div class="v2-ctrl-pad">
          <div class="v2-btn-row">
            ${DATA.attendance.spots
              .map(
                (sp) =>
                  `<button type="button" class="v2-btn v2-btn-grow ${state.selectedSpot === sp.id ? 'is-active' : ''}" data-spot="${sp.id}">${esc(sp.label)}</button>`
              )
              .join('')}
          </div>
        </div>
      </section>

      <section class="v2-band">
        <div class="v2-band-head">
          <div class="v2-band-title-wrap">
            <span class="v2-sec-no">03</span>
            <span class="v2-band-title">${isStudent ? '执行单次定位签到' : '新建训练考勤场次'}</span>
          </div>
          <span class="v2-band-meta">无签退</span>
        </div>
        <div class="v2-ctrl-pad">
          ${
            isStudent
              ? `
            <div class="v2-row-sub">点击后向微信请求一次前台位置，由云函数判定是否在 ${esc(spot.radius)} 内；不提供签退与请假附件。</div>
            <button type="button" class="v2-btn v2-btn-primary v2-btn-block" data-action="mock-checkin">发起一次定位并签到</button>`
              : `
            <div class="v2-field">
              <label class="v2-label" for="v2SessionTitle">场次标题</label>
              <input id="v2SessionTitle" class="v2-input" value="短跑一队傍晚训练" />
            </div>
            <div class="v2-field">
              <label class="v2-label" for="v2SessionWin">签到窗口与迟到阈值</label>
              <input id="v2SessionWin" class="v2-input" value="16:15 - 16:45（迟到线 16:30）" />
            </div>
            <button type="button" class="v2-btn v2-btn-primary v2-btn-block" data-action="mock-checkin">保存场次（本地演示）</button>`
          }
          ${state.checkedInFeedback ? `<div class="v2-callout">${esc(state.checkedInFeedback)}</div>` : ''}
        </div>
      </section>
    `;
  }

  function renderPlan() {
    return `
      <div class="v2-callout">全部训练计划由教练人工录入，无自动生成或 AI 推荐功能。</div>

      <section class="v2-band">
        <button type="button" class="v2-accordion-head" data-toggle="basic">
          <span>01 · 基础配置与计划类型</span>
          <span>${state.planBasicOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        ${
          state.planBasicOpen
            ? `
          <div class="v2-ctrl-pad">
            <div class="v2-btn-row">
              ${DATA.plan.types
                .map(
                  (t) =>
                    `<button type="button" class="v2-btn v2-btn-grow ${state.planType === t ? 'is-active' : ''}" data-plan-type="${esc(t)}">${esc(t)}</button>`
                )
                .join('')}
            </div>
            <div class="v2-field">
              <label class="v2-label" for="v2PlanTitle">计划标题</label>
              <input id="v2PlanTitle" class="v2-input" value="短跑一队·${esc(state.planType)}训练安排" />
            </div>
            <div class="v2-field">
              <label class="v2-label" for="v2PlanGroup">训练组</label>
              <input id="v2PlanGroup" class="v2-input" value="短跑一队 · 2026秋" />
            </div>
          </div>`
            : ''
        }
      </section>

      <section class="v2-band">
        <button type="button" class="v2-accordion-head" data-toggle="items">
          <span>02 · 训练内容清单（${state.planItems.length} 项）</span>
          <span>${state.planItemsOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        ${
          state.planItemsOpen
            ? `
          ${state.planItems
            .map(
              (item, idx) => `
            <div class="v2-ledger-row">
              <div class="v2-row-main">
                <div class="v2-row-title">0${idx + 1}. ${esc(item.name)}</div>
                <div class="v2-row-sub">${esc(item.sets)} · ${esc(item.reps)} · 间歇 ${esc(item.rest)}</div>
              </div>
              <button type="button" class="v2-btn v2-btn-danger" data-del-item="${item.id}">删除</button>
            </div>`
            )
            .join('')}
          <div class="v2-ctrl-pad">
            <button type="button" class="v2-btn v2-btn-dark v2-btn-block" data-action="add-plan-item">+ 新增训练内容条目</button>
          </div>`
            : ''
        }
      </section>
    `;
  }

  function render() {
    const idx = DATA.screens.findIndex((s) => s.id === state.screen);
    const meta = DATA.screens[idx >= 0 ? idx : 0];
    idxEl.textContent = String((idx >= 0 ? idx : 0) + 1).padStart(2, '0');
    titleEl.textContent = meta.label;
    roleEl.textContent = meta.role;
    renderNav();

    if (state.viewState !== 'normal') {
      bodyEl.innerHTML = renderNonNormal();
      return;
    }

    const map = {
      '01-student': renderStudent,
      '02-coach': renderCoach,
      '03-parent': renderParent,
      '04-developer': renderDeveloper,
      '05-stats': renderStats,
      '06-attendance': renderAttendance,
      '07-plan': renderPlan
    };
    bodyEl.innerHTML = (map[state.screen] || renderStudent)();
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
      state.checkedInFeedback = '本地演示回执：已记录模拟提交（未调用云函数，未写入数据库）。';
      render();
      return;
    }
    if (btn.dataset.action === 'mock-export') {
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
        name: `放松慢跑与核心恢复 #${id}`,
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
