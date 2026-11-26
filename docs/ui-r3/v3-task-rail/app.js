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
    coachCompOpen: true,
    devGroupsOpen: true,
    planItems: DATA.plan.initialItems.map((item) => ({ ...item })),
    nextPlanId: 4
  };

  const titleEl = document.getElementById('screenTitle');
  const roleEl = document.getElementById('screenRole');
  const stepperEl = document.getElementById('workflowStepper');
  const bodyEl = document.getElementById('screenBody');
  const dockEl = document.getElementById('actionDock');
  const navTop = document.getElementById('navRowTop');
  const navBottom = document.getElementById('navRowBottom');

  const STEPPERS = {
    '01-student': ['01 查看任务', '02 定位签到', '03 留痕归档'],
    '02-coach': ['01 核验考勤', '02 审批待办', '03 赛事材料'],
    '03-parent': ['01 选定学生', '02 查阅摘要', '03 只读边界'],
    '04-developer': ['01 巡检环境', '02 角色终审', '03 审计留痕'],
    '05-stats': ['01 选择口径', '02 核对排行', '03 导出表格'],
    '06-attendance': ['01 确认围栏', '02 单次定位', '03 记录考勤'],
    '07-plan': ['01 配置基础', '02 编排条目', '03 人工发布']
  };

  function esc(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderChrome() {
    const topItems = DATA.screens.slice(0, 4);
    const bottomItems = DATA.screens.slice(4);
    const toHtml = (list) =>
      list
        .map(
          (s) =>
            `<button type="button" class="v3-nav-btn ${state.screen === s.id ? 'is-active' : ''}" data-screen="${s.id}">${esc(s.short)}</button>`
        )
        .join('');
    navTop.innerHTML = toHtml(topItems);
    navBottom.innerHTML = toHtml(bottomItems);

    document.querySelectorAll('.v3-state-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.state === state.viewState);
    });

    const steps = STEPPERS[state.screen] || STEPPERS['01-student'];
    stepperEl.innerHTML = steps
      .map(
        (label, idx) => `
        <div class="v3-step ${idx === 0 ? 'is-current' : ''}">
          <span class="v3-step-no">STEP ${idx + 1}</span>
          <span class="v3-step-text">${esc(label.replace(/^0\d\s*/, ''))}</span>
        </div>`
      )
      .join('');
  }

  function renderDock() {
    if (state.viewState !== 'normal') {
      dockEl.innerHTML = `<button type="button" class="v3-btn v3-btn-pine v3-btn-block" data-action="reset-state">恢复正常演示视图</button>`;
      return;
    }
    if (state.screen === '01-student') {
      dockEl.innerHTML = `
        <button type="button" class="v3-btn v3-btn-pine v3-btn-grow" data-screen="06-attendance">去主动签到</button>
        <button type="button" class="v3-btn v3-btn-grow" data-screen="05-stats">查看成绩榜</button>
      `;
      return;
    }
    if (state.screen === '02-coach') {
      dockEl.innerHTML = `
        <button type="button" class="v3-btn v3-btn-terra v3-btn-grow" data-screen="06-attendance">进入考勤场次</button>
        <button type="button" class="v3-btn v3-btn-pine v3-btn-grow" data-screen="07-plan">编写训练计划</button>
      `;
      return;
    }
    if (state.screen === '03-parent') {
      const nextIdx = (state.parentStudentIndex + 1) % DATA.parent.students.length;
      dockEl.innerHTML = `
        <div class="v3-dock-note">只读守护模式 · 无写操作</div>
        <button type="button" class="v3-btn" data-parent-stu="${nextIdx}">切换另一学生</button>
      `;
      return;
    }
    if (state.screen === '04-developer') {
      dockEl.innerHTML = `
        <button type="button" class="v3-btn v3-btn-pine v3-btn-grow" data-screen="02-coach">查看教练视图</button>
        <button type="button" class="v3-btn v3-btn-grow" data-screen="05-stats">核对统计口径</button>
      `;
      return;
    }
    if (state.screen === '05-stats') {
      dockEl.innerHTML = `
        <button type="button" class="v3-btn v3-btn-pine v3-btn-block" data-action="mock-export">导出当前周期 XLSX（演示）</button>
      `;
      return;
    }
    if (state.screen === '06-attendance') {
      dockEl.innerHTML = `
        <button type="button" class="v3-btn v3-btn-pine v3-btn-block" data-action="mock-checkin">${
          state.attendanceRole === 'student' ? '发起一次定位并签到' : '保存考勤场次（演示）'
        }</button>
      `;
      return;
    }
    dockEl.innerHTML = `
      <button type="button" class="v3-btn v3-btn-grow" data-action="add-plan-item">+ 新增条目</button>
      <button type="button" class="v3-btn v3-btn-pine v3-btn-grow" data-action="mock-checkin">保存计划（演示）</button>
    `;
  }

  function renderNonNormal() {
    if (state.viewState === 'loading') {
      return `
        <div class="v3-skel"></div>
        <div class="v3-skel"></div>
        <div class="v3-skel"></div>
        <div class="v3-banner-note">正在按服务端权限范围拉取当前任务流数据…</div>
      `;
    }
    if (state.viewState === 'empty') {
      return `
        <section class="v3-rail v3-rail-info">
          <div class="v3-rail-title">当前任务轨暂无记录</div>
          <div class="v3-item-m">所有展示项均来自真实业务录入与审核，空列表时不自动捏造数据。</div>
          <button type="button" class="v3-btn v3-btn-pine" data-action="reset-state">返回正常视图</button>
        </section>
      `;
    }
    return `
      <section class="v3-rail v3-rail-danger">
        <div class="v3-rail-title">任务数据读取失败</div>
        <div class="v3-item-m">服务端校验或网络异常（示例：PERMISSION_OR_NETWORK），未修改任何业务数据。</div>
        <button type="button" class="v3-btn v3-btn-danger" data-action="reset-state">重试加载</button>
      </section>
    `;
  }

  function renderStudent() {
    const s = DATA.student;
    return `
      <section class="v3-rail v3-rail-urgent">
        <div class="v3-rail-head">
          <div class="v3-rail-title">今日首要任务 · ${esc(s.todaySession.title)}</div>
          <span class="v3-badge v3-badge-terra">${esc(s.todaySession.status)}</span>
        </div>
        <div class="v3-item-m">${esc(s.todaySession.time)} · ${esc(s.todaySession.location)} · 签到窗 ${esc(s.todaySession.checkInWindow)}</div>
      </section>

      <section class="v3-rail">
        <div class="v3-rail-head">
          <div class="v3-rail-title">${esc(s.name)} · 训练档案</div>
          <span class="v3-rail-sub">${esc(s.group)}</span>
        </div>
        <div class="v3-stat-row">
          <div class="v3-stat-box">
            <div class="v3-stat-k">${esc(s.pb.event)} 审核PB</div>
            <div class="v3-stat-v is-pine">${esc(s.pb.value)}${esc(s.pb.unit)}</div>
          </div>
          <div class="v3-stat-box">
            <div class="v3-stat-k">本月出勤率</div>
            <div class="v3-stat-v">${esc(s.monthlyAttendance.rate)}</div>
          </div>
        </div>
      </section>

      <section class="v3-rail v3-rail-info">
        <div class="v3-rail-head">
          <div class="v3-rail-title">俱乐部通知</div>
          <span class="v3-rail-sub">${s.notices.length} 条</span>
        </div>
        ${s.notices
          .map(
            (n) => `
          <div class="v3-item">
            <div class="v3-item-main">
              <div class="v3-item-t">${esc(n.title)}</div>
              <div class="v3-item-m">${esc(n.date)} · ${n.unread ? '未读' : '已读'}</div>
            </div>
            <span class="v3-badge ${n.priority === '重要' ? 'v3-badge-terra' : 'v3-badge-neutral'}">${esc(n.priority)}</span>
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
      <section class="v3-rail v3-rail-urgent">
        <div class="v3-rail-head">
          <div class="v3-rail-title">高优先待办审批</div>
          <span class="v3-badge v3-badge-terra">${c.todos.length} 项待处理</span>
        </div>
        ${c.todos
          .map(
            (t) => `
          <div class="v3-item">
            <div class="v3-item-main">
              <div class="v3-item-t">${esc(t.type)} · ${esc(t.student)}</div>
              <div class="v3-item-m">${esc(t.detail)}</div>
            </div>
            <span class="v3-badge ${t.priority === 'P1' ? 'v3-badge-terra' : 'v3-badge-neutral'}">${esc(t.priority)}</span>
          </div>`
          )
          .join('')}
      </section>

      <section class="v3-rail">
        <div class="v3-rail-head">
          <div class="v3-rail-title">今日考勤进展</div>
          <span class="v3-rail-sub">${esc(f.window)}</span>
        </div>
        <div class="v3-stat-row">
          <div class="v3-stat-box">
            <div class="v3-stat-k">已签到</div>
            <div class="v3-stat-v is-pine">${f.checkedIn}/${f.expected}</div>
          </div>
          <div class="v3-stat-box">
            <div class="v3-stat-k">待核实</div>
            <div class="v3-stat-v is-terra">${f.pendingVerify}</div>
          </div>
          <div class="v3-stat-box">
            <div class="v3-stat-k">迟到/请假</div>
            <div class="v3-stat-v">${f.late}/${f.leaveApproved}</div>
          </div>
        </div>
      </section>

      <section class="v3-rail v3-rail-info">
        <button type="button" class="v3-disclosure-btn" data-toggle="coach-comp">
          <span>赛事意向与材料核验（${c.competitions.length}）</span>
          <span class="v3-disclosure-tag">${state.coachCompOpen ? '收起' : '展开'}</span>
        </button>
        ${
          state.coachCompOpen
            ? `
          <div class="v3-banner-warn v3-banner-note">内部审核通过不代表官方赛事平台报名成功，仍需教练线下/官方渠道正式提交。</div>
          ${c.competitions
            .map(
              (item) => `
            <div class="v3-item">
              <div class="v3-item-main">
                <div class="v3-item-t">${esc(item.title)}</div>
                <div class="v3-item-m">意向 ${item.intentCount} 人 · 已传材料 ${item.materialCount} 份 · ${esc(item.status)}</div>
              </div>
              <span class="v3-badge v3-badge-info">${item.materialCount}/${item.intentCount}</span>
            </div>`
            )
            .join('')}`
            : ''
        }
      </section>
    `;
  }

  function renderParent() {
    const stu = DATA.parent.students[state.parentStudentIndex];
    const secLabel = (DATA.parent.sections.find((s) => s.id === state.parentSection) || {}).label;
    return `
      <div class="v3-banner-note">家长工作台为严格只读视图：禁止任何写入，隐藏精确 GPS 坐标与教练内部评语。</div>

      <section class="v3-rail v3-rail-info">
        <div class="v3-rail-head">
          <div class="v3-rail-title">已关联学生与分区</div>
          <span class="v3-badge v3-badge-info">只读</span>
        </div>
        <div class="v3-btn-row">
          ${DATA.parent.students
            .map(
              (item, idx) =>
                `<button type="button" class="v3-btn v3-btn-grow ${idx === state.parentStudentIndex ? 'is-active' : ''}" data-parent-stu="${idx}">${esc(item.name)}</button>`
            )
            .join('')}
        </div>
        <div class="v3-btn-row">
          ${DATA.parent.sections
            .map(
              (sec) =>
                `<button type="button" class="v3-btn ${state.parentSection === sec.id ? 'is-active' : ''}" data-parent-sec="${sec.id}">${esc(sec.label)}</button>`
            )
            .join('')}
        </div>
      </section>

      <section class="v3-rail">
        <div class="v3-rail-head">
          <div class="v3-rail-title">${esc(stu.name)} · ${esc(secLabel)}</div>
          <span class="v3-rail-sub">${esc(stu.group)}</span>
        </div>
        <div class="v3-stat-row">
          <div class="v3-stat-box">
            <div class="v3-stat-k">审核 PB</div>
            <div class="v3-stat-v is-pine">${esc(stu.pb)}</div>
          </div>
          <div class="v3-stat-box">
            <div class="v3-stat-k">本月出勤</div>
            <div class="v3-stat-v">${esc(stu.attendanceRate)}</div>
          </div>
        </div>
        ${
          state.parentSection === 'plans'
            ? stu.plans
                .map((p) => `<div class="v3-item"><div class="v3-item-main"><div class="v3-item-t">${esc(p.title)}</div><div class="v3-item-m">${esc(p.period)} · ${esc(p.items)}</div></div></div>`)
                .join('')
            : state.parentSection === 'performance'
            ? stu.performances
                .map((p) => `<div class="v3-item"><div class="v3-item-main"><div class="v3-item-t">${esc(p.event)}</div><div class="v3-item-m">日期 ${esc(p.date)}（教练已审）</div></div><span class="v3-item-val">${esc(p.value)}</span></div>`)
                .join('')
            : state.parentSection === 'attendance'
            ? stu.attendance
                .map((a) => `<div class="v3-item"><div class="v3-item-main"><div class="v3-item-t">${esc(a.date)}</div><div class="v3-item-m">${esc(a.status)}</div></div></div>`)
                .join('')
            : state.parentSection === 'feedback'
            ? stu.feedback
                .map((f) => `<div class="v3-item"><div class="v3-item-main"><div class="v3-item-t">${esc(f.date)} · ${esc(f.completion)}</div><div class="v3-item-m">强度 RPE ${esc(f.rpe)}</div></div></div>`)
                .join('')
            : stu.events
                .map((e) => `<div class="v3-item"><div class="v3-item-main"><div class="v3-item-t">${esc(e.title)}</div><div class="v3-item-m">${esc(e.type)}</div></div><span class="v3-badge v3-badge-terra">${esc(e.badge)}</span></div>`)
                .join('')
        }
      </section>
    `;
  }

  function renderDeveloper() {
    const d = DATA.developer;
    return `
      <section class="v3-rail">
        <div class="v3-rail-head">
          <div class="v3-rail-title">云端基线状态</div>
          <span class="v3-badge v3-badge-pine">Active</span>
        </div>
        <div class="v3-stat-row">
          <div class="v3-stat-box">
            <div class="v3-stat-k">ADMINONLY 集合</div>
            <div class="v3-stat-v is-pine">23</div>
          </div>
          <div class="v3-stat-box">
            <div class="v3-stat-k">待终审账号</div>
            <div class="v3-stat-v is-terra">${d.system.pendingReviews}</div>
          </div>
        </div>
        <div class="v3-item-m">环境 ${esc(d.system.env)} · ${esc(d.system.apiStatus)} · 存储：${esc(d.system.storageAcl)}</div>
      </section>

      <section class="v3-rail v3-rail-urgent">
        <div class="v3-rail-head">
          <div class="v3-rail-title">账号与角色终审轨</div>
          <span class="v3-badge v3-badge-terra">${d.approvals.length} 待审</span>
        </div>
        ${d.approvals
          .map(
            (a) => `
          <div class="v3-item">
            <div class="v3-item-main">
              <div class="v3-item-t">${esc(a.name)} · ${esc(a.roleType)}</div>
              <div class="v3-item-m">${esc(a.detail)}</div>
            </div>
            <span class="v3-badge v3-badge-terra">待审</span>
          </div>`
          )
          .join('')}
      </section>

      <section class="v3-rail v3-rail-info">
        <button type="button" class="v3-disclosure-btn" data-toggle="dev-groups">
          <span>训练组与教练范围（${d.groups.length} 组）</span>
          <span class="v3-disclosure-tag">${state.devGroupsOpen ? '收起' : '展开'}</span>
        </button>
        ${
          state.devGroupsOpen
            ? d.groups
                .map(
                  (g) => `
                <div class="v3-item">
                  <div class="v3-item-main">
                    <div class="v3-item-t">${esc(g.name)}</div>
                    <div class="v3-item-m">教练 ${esc(g.coaches)} · 成员 ${g.students} 人</div>
                  </div>
                  <span class="v3-badge v3-badge-pine">启用</span>
                </div>`
                )
                .join('')
            : ''
        }
      </section>

      <div class="v3-banner-note">审计约束：所有高权限变更、删除与材料下载均由云函数服务端事务写入 audit_logs。</div>
    `;
  }

  function renderStats() {
    const isPerf = state.statsMode === 'performance';
    const rows = isPerf
      ? DATA.stats.performance[state.statsPeriod]
      : DATA.stats.attendance[state.statsPeriod];
    return `
      <section class="v3-rail">
        <div class="v3-rail-head">
          <div class="v3-rail-title">榜单类型与统计周期</div>
          <span class="v3-rail-sub">底部可导出 XLSX</span>
        </div>
        <div class="v3-btn-row">
          <button type="button" class="v3-btn v3-btn-grow ${isPerf ? 'is-active' : ''}" data-stats-mode="performance">成绩排行榜</button>
          <button type="button" class="v3-btn v3-btn-grow ${!isPerf ? 'is-active' : ''}" data-stats-mode="attendance">考勤排行榜</button>
        </div>
        <div class="v3-btn-row">
          ${DATA.stats.periods
            .map(
              (p) =>
                `<button type="button" class="v3-btn v3-btn-grow ${state.statsPeriod === p.key ? 'is-active' : ''}" data-stats-period="${p.key}">${esc(p.label)}</button>`
            )
            .join('')}
        </div>
      </section>

      <div class="v3-banner-note ${isPerf ? '' : 'v3-banner-warn'}">
        ${
          isPerf
            ? '正式成绩口径：仅计入教练审核通过记录，未审与驳回申报不入榜。'
            : '历史成员不完整估算口径提示：周期内缺历史成员快照时不输出正式名次（rank 置空），样本不足 3 场不领先。'
        }
      </div>

      <section class="v3-rail v3-rail-info">
        <div class="v3-rail-head">
          <div class="v3-rail-title">${isPerf ? '100米 正式成绩排行' : '训练组考勤统计'}</div>
          <span class="v3-badge v3-badge-pine">${rows.length} 条</span>
        </div>
        ${rows
          .map(
            (r) => `
          <div class="v3-item">
            <div class="v3-item-main">
              <div class="v3-item-t">#${esc(r.rank)} ${esc(r.name)}</div>
              <div class="v3-item-m">${esc(r.group)} ${isPerf ? `· 教练 ${esc(r.coach)} · PB ${esc(r.pb)}` : `· 有效 ${esc(r.valid)} · ${esc(r.note)}`}</div>
            </div>
            <span class="v3-item-val">${esc(isPerf ? r.value : r.rate)}</span>
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
      <section class="v3-rail">
        <div class="v3-rail-head">
          <div class="v3-rail-title">考勤角色模式</div>
          <span class="v3-badge v3-badge-pine">无签退</span>
        </div>
        <div class="v3-btn-row">
          <button type="button" class="v3-btn v3-btn-grow ${isStudent ? 'is-active' : ''}" data-att-role="student">学生主动签到</button>
          <button type="button" class="v3-btn v3-btn-grow ${!isStudent ? 'is-active' : ''}" data-att-role="coach">教练创建场次</button>
        </div>
      </section>

      <section class="v3-rail v3-rail-info">
        <div class="v3-rail-head">
          <div class="v3-rail-title">静态围栏选点区（无地图 SDK）</div>
          <span class="v3-rail-sub">半径 ${esc(spot.radius)}</span>
        </div>
        <div class="v3-map-zone">
          <div class="v3-map-target">${esc(spot.label)}</div>
          <div class="v3-map-meta">${esc(spot.coordText)}</div>
        </div>
        <div class="v3-btn-row">
          ${DATA.attendance.spots
            .map(
              (sp) =>
                `<button type="button" class="v3-btn v3-btn-grow ${state.selectedSpot === sp.id ? 'is-active' : ''}" data-spot="${sp.id}">${esc(sp.label)}</button>`
            )
            .join('')}
        </div>
      </section>

      <section class="v3-rail ${isStudent ? 'v3-rail-urgent' : ''}">
        <div class="v3-rail-head">
          <div class="v3-rail-title">${isStudent ? '单次主动定位签到说明' : '新建场次参数'}</div>
          <span class="v3-rail-sub">底部主按钮提交</span>
        </div>
        ${
          isStudent
            ? `<div class="v3-item-m">点击底部主操作按钮仅触发一次前台定位并交由服务端测距；系统不存在签退，请假不传附件。</div>`
            : `
          <div class="v3-field">
            <label class="v3-label" for="v3SessionTitle">场次标题</label>
            <input id="v3SessionTitle" class="v3-input" value="短跑一队傍晚训练" />
          </div>
          <div class="v3-field">
            <label class="v3-label" for="v3SessionWin">签到窗口与迟到线</label>
            <input id="v3SessionWin" class="v3-input" value="16:15 - 16:45（迟到线 16:30）" />
          </div>`
        }
        ${state.checkedInFeedback ? `<div class="v3-banner-note">${esc(state.checkedInFeedback)}</div>` : ''}
      </section>
    `;
  }

  function renderPlan() {
    return `
      <div class="v3-banner-note">全部训练计划均由教练手工编写与发布，系统不含任何 AI 生成计划逻辑。</div>

      <section class="v3-rail">
        <button type="button" class="v3-disclosure-btn" data-toggle="basic">
          <span>一、基础属性与类型</span>
          <span class="v3-disclosure-tag">${state.planBasicOpen ? '收起' : '展开'}</span>
        </button>
        ${
          state.planBasicOpen
            ? `
          <div class="v3-btn-row">
            ${DATA.plan.types
              .map(
                (t) =>
                  `<button type="button" class="v3-btn v3-btn-grow ${state.planType === t ? 'is-active' : ''}" data-plan-type="${esc(t)}">${esc(t)}</button>`
              )
              .join('')}
          </div>
          <div class="v3-field">
            <label class="v3-label" for="v3PlanTitle">计划标题</label>
            <input id="v3PlanTitle" class="v3-input" value="短跑一队·${esc(state.planType)}训练安排" />
          </div>
          <div class="v3-field">
            <label class="v3-label" for="v3PlanGroup">目标训练组</label>
            <input id="v3PlanGroup" class="v3-input" value="短跑一队 · 2026秋" />
          </div>`
            : ''
        }
      </section>

      <section class="v3-rail v3-rail-urgent">
        <button type="button" class="v3-disclosure-btn" data-toggle="items">
          <span>二、训练内容条目（${state.planItems.length} 项）</span>
          <span class="v3-disclosure-tag">${state.planItemsOpen ? '收起' : '展开'}</span>
        </button>
        ${
          state.planItemsOpen
            ? `
          ${state.planItems
            .map(
              (item, idx) => `
            <div class="v3-item">
              <div class="v3-item-main">
                <div class="v3-item-t">${idx + 1}. ${esc(item.name)}</div>
                <div class="v3-item-m">${esc(item.sets)} · ${esc(item.reps)} · 间歇 ${esc(item.rest)}</div>
              </div>
              <button type="button" class="v3-btn v3-btn-danger" data-del-item="${item.id}">删除</button>
            </div>`
            )
            .join('')}
          ${state.checkedInFeedback ? `<div class="v3-banner-note">${esc(state.checkedInFeedback)}</div>` : ''}`
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
    renderChrome();
    renderDock();

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
      state.checkedInFeedback = '本地演示反馈：底部操作坞已响应（未调用云函数，未写入业务数据）。';
      render();
      return;
    }
    if (btn.dataset.action === 'mock-export') {
      btn.textContent = '已生成演示 XLSX（未写库）';
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
    if (btn.dataset.toggle === 'coach-comp') {
      state.coachCompOpen = !state.coachCompOpen;
      render();
      return;
    }
    if (btn.dataset.toggle === 'dev-groups') {
      state.devGroupsOpen = !state.devGroupsOpen;
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
