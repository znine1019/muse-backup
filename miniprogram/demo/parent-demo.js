'use strict';

/**
 * 家长端 DEMO 本地虚构数据（不读取 CloudBase，不调用任何业务接口）
 *
 * 严格对齐家长端字段白名单：只展示已审核成绩、考勤状态、完成情况与自评强度；
 * 不出现精确 GPS 坐标、请假原因、健康信息或教练内部评价。
 * 家长端在演示中也保持只读。
 */

const STUDENTS = Object.freeze([
  {
    id: 'demo_child_1',
    name: '林越',
    tag: '虚构演示学生',
    primaryEventName: '100米',
    trainingGroupName: '短跑组（虚构）',
    linkState: 'active',
    linkStateLabel: '关联已生效'
  },
  {
    id: 'demo_child_2',
    name: '苏晴',
    tag: '虚构演示学生',
    primaryEventName: '跳远',
    trainingGroupName: '跳跃组（虚构）',
    linkState: 'pending_review',
    linkStateLabel: '待开发者核验'
  }
]);

const DATA_BY_STUDENT = Object.freeze({
  demo_child_1: {
    overview: {
      pb: { eventName: '100米', value: '11.70', unit: '秒' },
      approvedCount: 7,
      attendance: {
        validAttendance: 11,
        actualExpected: 12,
        late: 1,
        absent: 0,
        approvedLeave: 1,
        pendingVerification: 1
      }
    },
    plans: [
      { planId: 'p1', title: '第 8 周速度耐力', rangeText: '06-15 至 06-21', itemCountText: '4 项内容' },
      { planId: 'p2', title: '第 7 周技术课', rangeText: '06-08 至 06-14', itemCountText: '3 项内容' }
    ],
    performanceRows: [
      { eventName: '100米', dateText: '取得日期：2026-06-11', valueText: '11.70 秒' },
      { eventName: '跳远', dateText: '取得日期：2026-06-05', valueText: '5.35 米' }
    ],
    attendanceRows: [
      { dateText: '06-11 速度课', chip: '已签到' },
      { dateText: '06-13 力量课', chip: '迟到' },
      { dateText: '06-16 技术课', chip: '已批准请假' }
    ],
    feedbackRows: [
      { dateText: '06-11 速度课', metaText: '全部完成 · RPE 7/10' },
      { dateText: '06-13 力量课', metaText: '部分完成 · RPE 8/10' }
    ],
    competitionRows: [
      { title: '春季田径公开赛（虚构）', metaText: '100米 · 教练处理中', chip: '教练处理中' },
      { title: '市青少年锦标赛（虚构）', metaText: '100米 · 已完成内部报名', chip: '教练已代报' }
    ],
    noticeRows: [
      { title: '本周训练调整', chip: '重要' },
      { title: '队内测试通知', chip: '普通' }
    ]
  },
  demo_child_2: {
    overview: {
      pb: { eventName: '跳远', value: '5.35', unit: '米' },
      approvedCount: 4,
      attendance: {
        validAttendance: 9,
        actualExpected: 12,
        late: 0,
        absent: 2,
        approvedLeave: 1,
        pendingVerification: 0
      }
    },
    plans: [
      { planId: 'p3', title: '第 8 周跳跃技术', rangeText: '06-15 至 06-21', itemCountText: '5 项内容' }
    ],
    performanceRows: [
      { eventName: '跳远', dateText: '取得日期：2026-06-08', valueText: '5.35 米' }
    ],
    attendanceRows: [
      { dateText: '06-10 跳跃课', chip: '已签到' },
      { dateText: '06-14 力量课', chip: '未签到' }
    ],
    feedbackRows: [
      { dateText: '06-10 跳跃课', metaText: '全部完成 · RPE 6/10' }
    ],
    competitionRows: [
      { title: '市青少年锦标赛（虚构）', metaText: '跳远 · 待教练办理', chip: '已提交意向' }
    ],
    noticeRows: [{ title: '本周训练调整', chip: '重要' }]
  }
});

const CATALOG = Object.freeze([
  { id: 'overview', name: '学生概览', group: '学生概览', tone: 'accent', icon: '览', desc: 'PB、出勤与关键指标' },
  { id: 'plans', name: '训练计划', group: '学生概览', tone: 'brand', icon: '计', desc: '已发布训练安排' },
  { id: 'performance', name: '运动成绩', group: '学生概览', tone: 'ok', icon: '绩', desc: '仅已审核正式成绩' },
  { id: 'attendance', name: '考勤记录', group: '学生概览', tone: 'plain', icon: '勤', desc: '签到状态（无位置）' },
  { id: 'feedback', name: '训练反馈', group: '学生概览', tone: 'brand', icon: '馈', desc: '完成情况与自评强度' },
  { id: 'events', name: '赛事与通知', group: '学生概览', tone: 'accent', icon: '赛', desc: '赛事进度与通知' },
  { id: 'link', name: '关联学生管理', group: '关联与账号', tone: 'brand', icon: '联', desc: '关联状态与授权管理' },
  { id: 'account', name: '个人中心', group: '关联与账号', tone: 'plain', icon: '人', desc: '身份与退出预览' }
]);

class DemoModuleError extends Error {}

function row(t, m, options = {}) {
  return {
    t,
    m,
    v: options.v || '',
    chip: options.chip || '',
    tone: options.tone || ''
  };
}

function normalizeIndex(index) {
  const value = Number(index);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(Math.floor(value), STUDENTS.length - 1);
}

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

function studentsPayload() {
  return STUDENTS.map((item) => ({ ...item }));
}

function buildParentWorkbench(index) {
  const safeIndex = normalizeIndex(index);
  const student = STUDENTS[safeIndex];
  const data = DATA_BY_STUDENT[student.id];
  return {
    students: studentsPayload(),
    studentIndex: safeIndex,
    currentStudent: { ...student },
    overview: {
      pb: { ...data.overview.pb },
      approvedCount: data.overview.approvedCount,
      attendance: { ...data.overview.attendance }
    },
    plans: data.plans.map((item) => ({ ...item })),
    performanceRows: data.performanceRows.map((item) => ({ ...item })),
    attendanceRows: data.attendanceRows.map((item) => ({ ...item })),
    feedbackRows: data.feedbackRows.map((item) => ({ ...item })),
    competitionRows: data.competitionRows.map((item) => ({ ...item })),
    noticeRows: data.noticeRows.map((item) => ({ ...item })),
    catalogGroups: groupCatalog(CATALOG),
    linkStateLabel: student.linkStateLabel
  };
}

function buildParentModule(moduleId, index) {
  const safeIndex = normalizeIndex(index);
  const definition = CATALOG.find((item) => item.id === moduleId);
  if (!definition) {
    throw new DemoModuleError(`演示模块不存在：${moduleId}`);
  }
  const student = STUDENTS[safeIndex];
  const data = DATA_BY_STUDENT[student.id];

  const header = {
    id: definition.id,
    name: definition.name,
    group: definition.group,
    icon: definition.icon,
    tone: definition.tone,
    subtitle: `${student.name}（虚构）· ${student.primaryEventName}`
  };

  if (moduleId === 'overview') {
    return Object.assign(header, {
      summary: {
        label: '个人最好成绩 PB',
        value: data.overview.pb.value,
        unit: data.overview.pb.unit,
        meta: `${data.overview.pb.eventName} · 教练已审核的正式成绩`
      },
      rows: [
        row('本月有效出勤', `应签到 ${data.overview.attendance.actualExpected} 次`, {
          v: `${data.overview.attendance.validAttendance} 次`
        }),
        row('已批准请假', '请假原因不向家长展示', { v: `${data.overview.attendance.approvedLeave} 次` }),
        row('迟到 / 未签到', '数值为虚构演示数据', {
          v: `${data.overview.attendance.late} / ${data.overview.attendance.absent}`
        })
      ],
      note: '家长端为只读视图。'
    });
  }
  if (moduleId === 'plans') {
    return Object.assign(header, {
      rows: data.plans.map((item) =>
        row(item.title, `${item.rangeText} · ${item.itemCountText}`)
      ),
      note: '仅展示教练已发布的训练计划。'
    });
  }
  if (moduleId === 'performance') {
    return Object.assign(header, {
      rows: data.performanceRows.map((item) =>
        row(item.eventName, item.dateText, { v: item.valueText })
      ),
      note: '未审核、已驳回的成绩不会展示给家长。'
    });
  }
  if (moduleId === 'attendance') {
    return Object.assign(header, {
      rows: data.attendanceRows.map((item) => row(item.dateText, '不展示精确位置，仅显示签到状态', { chip: item.chip, tone: statusTone(item.chip) })),
      note: '不展示精确 GPS 位置与请假原因。'
    });
  }
  if (moduleId === 'feedback') {
    return Object.assign(header, {
      rows: data.feedbackRows.map((item) => row(item.dateText, item.metaText)),
      note: '仅共享完成情况与学生自评强度，教练内部评价默认不向家长展示。'
    });
  }
  if (moduleId === 'events') {
    return Object.assign(header, {
      rows: data.competitionRows
        .map((item) => row(item.title, item.metaText, { chip: item.chip, tone: statusTone(item.chip) }))
        .concat(data.noticeRows.map((item) => row(item.title, '俱乐部通知', { chip: item.chip, tone: item.chip === '重要' ? 'danger' : '' }))),
      note: '报名意向不等于官方报名成功，正式报名由教练在赛事官方渠道完成。'
    });
  }
  if (moduleId === 'link') {
    return Object.assign(header, {
      rows: STUDENTS.map((item) =>
        row(item.name, `${item.tag} · 监护关系（虚构）`, {
          chip: item.linkStateLabel,
          tone: item.linkState === 'active' ? 'ok' : 'warn'
        })
      ),
      note: '演示环境不生成真实关联凭证、不修改任何授权关系；家长端始终保持只读。'
    });
  }
  if (moduleId === 'account') {
    return Object.assign(header, {
      rows: [
        row('当前身份', '演示预览中的家长视角（非真实角色）', { chip: '只读', tone: 'plain' }),
        row('关联学生', `共 ${STUDENTS.length} 名虚构学生`, { v: `${STUDENTS.length} 名` }),
        row('退出演示', '返回开发者工作台，不改变真实账号角色', { chip: '返回', tone: 'brand' })
      ],
      note: '退出演示后真实账号角色与权限保持不变。'
    });
  }
  throw new DemoModuleError(`演示模块尚未实现：${moduleId}`);
}

function statusTone(label) {
  if (!label) {
    return '';
  }
  if (label.includes('已签到') || label.includes('已批准') || label.includes('代报')) {
    return 'ok';
  }
  if (label.includes('迟到') || label.includes('未签到') || label.includes('处理中') || label.includes('待')) {
    return 'warn';
  }
  return '';
}

module.exports = {
  STUDENTS,
  buildParentModule,
  buildParentWorkbench,
  catalog: CATALOG,
  DemoModuleError
};
