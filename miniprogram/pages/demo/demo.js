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
const { buildStudentWorkbench, buildStudentModule, catalog: STUDENT_CATALOG } = require('../../demo/student-demo');
const { buildParentWorkbench, buildParentModule, catalog: PARENT_CATALOG } = require('../../demo/parent-demo');
const { getSessionDestination } = require('../../utils/session');

const ROLE_TONES = Object.freeze({
  student: 'brand',
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

    student: null,
    parent: null,
    module: null,
    catalogGroups: [],
    activeSection: '',
    simulatedSubmit: ''
  },

  onLoad(options = {}) {
    const role = isSupportedDemoRole(options.role) ? options.role : '';
    const moduleId = options.module || '';
    const view = moduleId ? 'module' : options.view === 'catalog' ? 'catalog' : 'workbench';
    const studentIndex = Number(options.student) || 0;
    const section = options.section || '';

    this.routeState = { role, moduleId, studentIndex, section };

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
      denied: false
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
    const { role, moduleId, studentIndex } = this.routeState;
    const isParent = role === 'parent';
    const catalog = isParent ? PARENT_CATALOG : STUDENT_CATALOG;
    const catalogGroups = groupCatalog(catalog);

    if (moduleId) {
      const module = isParent
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
    wx.navigateTo({ url: `/pages/demo/demo?${parts.join('&')}` });
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

  goSection(event) {
    const section = event.currentTarget.dataset.section;
    if (section) {
      this.setData({ activeSection: section });
    }
  },

  /* 演示中的"模拟提交"：只改变本地状态，绝不调用业务接口 */
  simulateSubmit() {
    this.setData({ simulatedSubmit: '本地模拟已完成（未写入任何业务数据）' });
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
