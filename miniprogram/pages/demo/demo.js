'use strict';

/**
 * 开发者专用演示预览页（学生端 / 家长端 DEMO）
 *
 * 安全模型（每次进入都执行，含直接以路径打开）：
 *   1. 环境必须是 develop / trial；
 *   2. 会话必须是真实 developer；
 *   3. 校验通过前不构建、不渲染任何演示数据。
 *
 * 数据来源：miniprogram/demo/student-demo.js 与 parent-demo.js 的本地虚构数据。
 * 本页**不引入 services/api**，因此不存在调用正式业务接口（含写入）的可能。
 * 演示中的"模拟提交"只改变页面内存状态。
 */

const {
  DEMO_MARKER,
  DEMO_NOTICE,
  checkDemoAccess,
  clearDemoState,
  isSupportedDemoRole,
  roleLabel
} = require('../../demo/demo-guard');
const {
  buildStudentWorkbench,
  buildStudentModule,
  getStudentNotice,
  catalog: STUDENT_CATALOG
} = require('../../demo/student-demo');
const {
  buildParentWorkbench,
  buildParentModule,
  getParentNotice,
  getParentCompetition,
  catalog: PARENT_CATALOG
} = require('../../demo/parent-demo');
const {
  buildCoachWorkbench,
  buildCoachModule,
  buildCoachDetail,
  catalog: COACH_CATALOG
} = require('../../demo/coach-demo');
const store = require('../../demo/showcase-store');
const { getSessionDestination } = require('../../utils/session');

const ROLE_TONES = Object.freeze({
  student: 'brand',
  coach: 'ok',
  parent: 'accent'
});

Page({
  data: {
    ready: false,
    loading: true,
    error: '',
    denied: false,

    demoMarker: DEMO_MARKER,
    demoNotice: DEMO_NOTICE,

    role: '',
    roleLabel: '',
    roleTone: 'brand',
    isParent: false,
    view: 'workbench',
    pageTitle: '演示预览',
    pageMeta: '',
    detail: null,
    localRead: false,

    student: null,
    coach: null,
    parent: null,
    module: null,
    catalogGroups: [],
    activeSection: '',
    simulatedSubmit: ''
  },

  onLoad(options = {}) {
    const role = isSupportedDemoRole(options.role) ? options.role : '';
    const moduleId = options.module || '';
    /* 详情类型：notice（通知正文）/ competition（赛事意向），均在同一演示页内渲染 */
    const detailType = options.detail || '';
    const detailId = options.id || '';
    const view = detailType
      ? 'detail'
      : moduleId
      ? 'module'
      : options.view === 'catalog'
      ? 'catalog'
      : 'workbench';
    const studentIndex = Number(options.student) || 0;
    const coachIndex = Number(options.coach) || 0;
    const section = options.section || '';

    this.routeState = { role, moduleId, detailType, detailId, studentIndex, coachIndex, section };

    this.setData({
      role,
      roleLabel: roleLabel(role),
      roleTone: ROLE_TONES[role] || 'brand',
      isParent: role === 'parent',
      view,
      activeSection: section,
      loading: true,
      ready: false,
      error: '',
      denied: false,
      detail: null,
      localRead: false
    });

    this.loadDemo();
  },

  async loadDemo() {
    const { role } = this.routeState;
    if (!role) {
      this.setData({
        loading: false,
        ready: false,
        denied: true,
        error: '演示参数不正确：仅支持 role=student 或 role=parent。'
      });
      return;
    }

    try {
      const session = await getApp().ensureSession({ force: true });
      const access = checkDemoAccess(session);
      if (!access.ok) {
        /* 拒绝进入：不构建任何演示数据 */
        this.setData({
          loading: false,
          ready: false,
          denied: true,
          error: access.reason,
          demoDestination: getSessionDestination(session).url
        });
        return;
      }
      this.applyDemoData();
    } catch (error) {
      this.setData({
        loading: false,
        ready: false,
        error: error.message || '演示数据加载失败。'
      });
    }
  },

  applyDemoData() {
    const { role, moduleId, detailType, studentIndex, coachIndex } = this.routeState;
    const isParent = role === 'parent';
    const isCoach = role === 'coach';
    const catalog = isCoach ? COACH_CATALOG : isParent ? PARENT_CATALOG : STUDENT_CATALOG;
    const catalogGroups = groupCatalog(catalog);

    /* 演示详情（通知正文 / 赛事意向）：同样复用本演示页 */
    if (detailType) {
      const detail = this.buildDemoDetail();
      this.setData({
        loading: false,
        ready: true,
        error: '',
        denied: false,
        isParent,
        catalogGroups,
        module: null,
        detail,
        localRead: detail.isRead === true,
        pageTitle: detail.title,
        pageMeta: detail.metaLine
      });
      return;
    }

    if (moduleId) {
      const module = isCoach
        ? buildCoachModule(moduleId, (this.data.coach && this.data.coach.coach.id) || undefined)
        : isParent
        ? buildParentModule(moduleId, studentIndex)
        : buildStudentModule(moduleId);
      this.setData({
        loading: false,
        ready: true,
        error: '',
        denied: false,
        isParent,
        catalogGroups,
        module,
        pageTitle: module.name,
        pageMeta: module.subtitle || '',
        simulatedSubmit: ''
      });
      return;
    }

    if (this.data.view === 'catalog') {
      this.setData({
        loading: false,
        ready: true,
        error: '',
        denied: false,
        isParent,
        catalogGroups,
        module: null,
        pageTitle: `${roleLabel(role)}全部功能`,
        pageMeta: `共 ${catalog.length} 项已实现的演示功能`
      });
      return;
    }

    if (isCoach) {
      const coach = buildCoachWorkbench();
      this.setData({
        loading: false,
        ready: true,
        error: '',
        denied: false,
        isCoach,
        catalogGroups,
        module: null,
        coach,
        pageTitle: '教练员工作台（演示）',
        pageMeta: `${coach.coach.name} · ${coach.coach.groupNames.join('、')}（虚构授权）`
      });
      return;
    }

    if (isParent) {
      const parent = buildParentWorkbench(studentIndex);
      this.setData({
        loading: false,
        ready: true,
        error: '',
        denied: false,
        isParent,
        catalogGroups,
        module: null,
        parent,
        pageTitle: '家长工作台（演示）',
        pageMeta: `仅可查看 ${parent.students.length} 名虚构学生的训练情况（只读）`
      });
      return;
    }

    const student = buildStudentWorkbench();
    this.setData({
      loading: false,
      ready: true,
      error: '',
      denied: false,
      isParent,
      catalogGroups,
      module: null,
      student,
      pageTitle: '学生工作台（演示）',
      pageMeta: `${student.student.name}（虚构） · ${student.student.primaryEventName} · ${student.student.trainingGroupName}`
    });
  },

  /*
   * 构建演示详情（学生端通知正文 / 家长端通知与赛事意向）。
   * 数据全部来自本地演示层；找不到条目直接报错，不返回空壳内容。
   */
  buildDemoDetail() {
    const { role, detailType, detailId } = this.routeState;

    /* 教练端：计划 / 请假 / 成绩 / 反馈 / 赛事意向 详情 + 模拟操作按钮 */
    if (role === 'coach') {
      return buildCoachDetail(detailType, detailId);
    }

    if (role === 'parent') {
      if (detailType === 'competition') {
        const found = getParentCompetition(detailId);
        return {
          isNotice: false,
          typeLabel: '赛事意向',
          title: found.entry.title,
          chip: found.entry.chip,
          tone: 'accent',
          metaLine: `${found.student.name}（虚构）· ${found.entry.metaText}`,
          body: found.entry.detailText,
          isRead: true
        };
      }
      if (detailType !== 'notice') {
        throw new Error('演示详情类型不支持。');
      }
      const found = getParentNotice(detailId);
      return {
        isNotice: true,
        typeLabel: '俱乐部通知',
        title: found.entry.title,
        chip: found.entry.chip === '重要' ? '重要通知' : '普通通知',
        tone: found.entry.chip === '重要' ? 'danger' : '',
        metaLine: `${found.entry.categoryLabel} · 发布于 ${found.entry.publishedAt} · ${found.student.name}（虚构）`,
        body: found.entry.detailText,
        isRead: true
      };
    }

    if (detailType !== 'notice') {
      throw new Error('演示详情类型不支持。');
    }
    const notice = getStudentNotice(detailId);
    return {
      isNotice: true,
      typeLabel: '俱乐部通知',
      title: notice.title,
      chip: notice.isImportant ? '重要通知' : notice.isRead ? '已读' : '未读',
      tone: notice.isImportant ? 'danger' : notice.isRead ? '' : 'brand',
      metaLine: `${notice.categoryLabel} · 发布于 ${notice.publishedAt} · ${notice.publisherText}`,
      body: notice.content,
      isRead: notice.isRead
    };
  },

  /* 进入演示子模块（同一演示页 + module 参数，返回上一级可用） */
  goModule(event) {
    const moduleId = event.currentTarget.dataset.module || event.currentTarget.dataset.id;
    if (!moduleId) {
      return;
    }
    this.navigateDemo({ module: moduleId });
  },

  goCatalog() {
    this.navigateDemo({ view: 'catalog' });
  },

  goWorkbench() {
    this.navigateDemo({ view: 'workbench' });
  },

  navigateDemo(extra = {}) {
    const { role, studentIndex } = this.routeState;
    const student = this.data.parent ? this.data.parent.studentIndex : studentIndex;
    const parts = [`role=${encodeURIComponent(role)}`];
    if (extra.module) {
      parts.push(`module=${encodeURIComponent(extra.module)}`);
    } else if (extra.view === 'catalog') {
      parts.push('view=catalog');
    }
    if (role === 'parent') {
      parts.push(`student=${student}`);
    }
    if (role === 'coach') {
      parts.push(`coach=${this.data.coach ? this.data.coach.coachIndex : 0}`);
    }
    wx.navigateTo({ url: `/pages/demo/demo?${parts.join('&')}` });
  },

  /*
   * 打开演示详情（通知正文 / 赛事意向）：仍跳回本演示页，
   * 因此上一页（通知列表/工作台）的状态会被小程序原生保留。
   */
  openDetail(event) {
    const dataset = event.currentTarget.dataset;
    const detailType = dataset.detail || dataset.detailType;
    const detailId = dataset.id || dataset.detailId;
    if (!detailType || !detailId) {
      return;
    }
    const { role } = this.routeState;
    const student = this.data.parent ? this.data.parent.studentIndex : this.routeState.studentIndex;
    const parts = [
      `role=${encodeURIComponent(role)}`,
      `detail=${encodeURIComponent(detailType)}`,
      `id=${encodeURIComponent(detailId)}`
    ];
    if (role === 'parent') {
      parts.push(`student=${student}`);
    }
    wx.navigateTo({ url: `/pages/demo/demo?${parts.join('&')}` });
  },

  /* 从详情返回列表：优先走原生返回以保留上一页状态；直接打开详情时退回工作台 */
  goBackToList() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages && pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    this.navigateDemo({ view: 'workbench' });
  },

  /* 标记已读：只改本地模拟状态，不写入任何业务数据 */
  simulateMarkRead() {
    this.setData({ localRead: true });
  },

  /* 家长端本地切换学生：只切换本地演示数据，不发起任何请求 */
  onStudentChange(event) {
    const index = Number(event.detail.value);
    if (!Number.isFinite(index)) {
      return;
    }
    this.routeState.studentIndex = index;
    const parent = buildParentWorkbench(index);
    this.setData({ parent, simulatedSubmit: '' });
  },

  /* 家长端快捷定位：切换选中态，并真实滚动到对应分区 */
  goSection(event) {
    const section = event.currentTarget.dataset.section;
    if (!section) {
      return;
    }
    /* 关联未生效时快捷入口不会渲染；此处再兜一层，避免被直接调用触发定位 */
    if (this.data.parent && this.data.parent.linkActive === false) {
      return;
    }
    this.setData({ activeSection: section });
    this.scrollToSection(section);
  },

  /*
   * 页面级定位：优先用 wx.pageScrollTo 的 selector（基础库 2.7.3+）；
   * 该能力不可用时退回“测量元素偏移 + scrollTop”的兼容路径。
   * 每次点击都重新执行，因此连续点同一分区或快速切换分区均能生效。
   */
  scrollToSection(section) {
    if (typeof wx === 'undefined' || typeof wx.pageScrollTo !== 'function') {
      return;
    }
    const selector = `#sec-${section}`;
    wx.pageScrollTo({
      selector,
      duration: 300,
      fail: () => this.scrollToSectionByOffset(selector)
    });
  },

  /* 兼容路径：旧基础库不支持 selector 时，按元素相对偏移计算目标 scrollTop */
  scrollToSectionByOffset(selector) {
    if (typeof wx.createSelectorQuery !== 'function') {
      return;
    }
    wx.createSelectorQuery()
      .select(selector)
      .boundingClientRect((rect) => {
        if (!rect) {
          return;
        }
        wx.createSelectorQuery()
          .selectViewport()
          .scrollOffset((viewport) => {
            const current = viewport && viewport.scrollTop ? Number(viewport.scrollTop) : 0;
            const target = current + Number(rect.top || 0) - 12;
            wx.pageScrollTo({ scrollTop: target > 0 ? target : 0, duration: 300 });
          })
          .exec();
      })
      .exec();
  },

  /*
   * 演示中的"模拟提交"：只写入本地模拟数据源，绝不调用业务接口。
   * 带 submitKind 的模块（如教练发布通知）会真正写入统一数据源，以便联动到其他角色。
   */
  simulateSubmit() {
    const kind = this.data.module && this.data.module.submitKind;
    if (kind) {
      const result = this.runDemoAction(kind, '');
      this.setData({ simulatedSubmit: result.ok ? '已在本地模拟数据源中生效（未写入任何正式数据）' : `模拟失败：${result.reason}` });
      if (result.ok) {
        this.applyDemoData();
      }
      return;
    }
    this.setData({ simulatedSubmit: '本地模拟已完成（未写入任何业务数据）' });
  },

  /* 教练端模拟操作入口：全部写入本地统一数据源 */
  onDemoAction(event) {
    const kind = event.currentTarget.dataset.kind;
    const id = event.currentTarget.dataset.id || '';
    const result = this.runDemoAction(kind, id);
    wx.showToast({ title: result.ok ? '已在本地演示数据中生效' : (result.reason || '操作未生效'), icon: 'none' });
    if (result.ok) {
      /* 重新构建当前视图，让列表与详情反映最新模拟状态 */
      this.applyDemoData();
    }
  },

  runDemoAction(kind, id) {
    switch (kind) {
      case 'publish-plan':
        return store.publishPlan(id);
      case 'approve-leave':
        return store.reviewLeave(id, 'approve');
      case 'reject-leave':
        return store.reviewLeave(id, 'reject');
      case 'approve-performance':
        return store.reviewPerformance(id, 'approve');
      case 'reject-performance':
        return store.reviewPerformance(id, 'reject');
      case 'comment-feedback':
        return store.reviewFeedback(id);
      case 'register-intent':
        return store.advanceCompetitionIntent(id, store.COMPETITION_STATUS.REGISTERED, '教练已在赛事官方渠道完成报名（虚构）。');
      case 'publish-notice':
        return store.publishNotice({
          title: '演示：训练时间调整',
          categoryLabel: '训练安排',
          publishedAt: '2026-06-20 10:00',
          publisherText: '教练（虚构）',
          priority: 'normal',
          content: '因场地安排，本周训练顺延 30 分钟，请提前到场热身。',
          groupIds: store.GROUPS.map((group) => group.id)
        });
      default:
        return { ok: false, reason: '未知的演示操作' };
    }
  },

  /* 教练切换：按预置授权展示不同训练组与名册 */
  onCoachChange(event) {
    const index = Number(event.detail.value);
    const option = (this.data.coach && this.data.coach.coachOptions[index]) || null;
    if (!option) {
      return;
    }
    this.routeState.coachIndex = index;
    const coach = buildCoachWorkbench(option.id);
    this.setData({ coach, simulatedSubmit: '' });
  },

  retry() {
    this.loadDemo();
  },

  goDeniedDestination() {
    wx.reLaunch({ url: this.data.demoDestination || '/pages/index/index' });
  },

  /* 退出演示：清理本地演示状态并回到开发者工作台，真实角色不变 */
  goAdmin() {
    clearDemoState();
    wx.reLaunch({ url: '/pages/admin/admin' });
  }
});

function groupCatalog(items) {
  const groups = [];
  for (const item of items) {
    let group = groups.find((entry) => entry.label === item.group);
    if (!group) {
      group = { label: item.group, items: [] };
      groups.push(group);
    }
    group.items.push({ ...item });
  }
  return groups;
}
