'use strict';

/**
 * V1.6 四角色功能目录（阶段8）
 *
 * 单一配置 + 角色差异化展示 + 一个可复用分类页面。
 * 目录只收录**仓库中真实存在**的页面；新增条目前必须确认对应页面已注册。
 * 本配置仅用于前端展示与导航，**不构成权限依据**：
 * 所有数据访问仍由云函数按可信微信身份重新校验角色与数据范围。
 */

const FEATURE_CATALOG = Object.freeze({
  student: {
    label: '学生',
    tone: 'brand',
    categories: [
      {
        key: 'training',
        label: '训练与计划',
        items: [
          {
            id: 'student-plans',
            name: '训练计划',
            desc: '查看本人训组已发布的训练安排',
            url: '/pages/student-plans/student-plans',
            tone: 'brand'
          },
          {
            id: 'student-attendance',
            name: '签到与请假',
            desc: 'GPS 签到、请假申请与历史记录',
            url: '/pages/student-attendance/student-attendance',
            tone: 'ok'
          },
          {
            id: 'student-feedback',
            name: '训练反馈',
            desc: '提交完成情况与主观用力程度',
            url: '/pages/student-feedback/student-feedback',
            tone: 'plain'
          }
        ]
      },
      {
        key: 'performance',
        label: '成绩与数据',
        items: [
          {
            id: 'performance',
            name: '成绩申报',
            desc: '申报成绩，需教练审核后生效',
            url: '/pages/performance/performance',
            tone: 'accent'
          },
          {
            id: 'student-report',
            name: '运动数据报告',
            desc: '身体指标与正式成绩趋势',
            url: '/pages/student-report/student-report',
            tone: 'brand'
          },
          {
            id: 'student-statistics',
            name: '训练统计',
            desc: '个人考勤、成绩与反馈统计',
            url: '/pages/student-statistics/student-statistics',
            tone: 'ok'
          },
          {
            id: 'performance-leaderboard',
            name: '成绩排行榜',
            desc: '仅使用已审核的正式成绩',
            url: '/pages/performance-leaderboard/performance-leaderboard',
            tone: 'plain'
          },
          {
            id: 'attendance-statistics',
            name: '考勤统计与排行',
            desc: '出勤率与最低样本口径',
            url: '/pages/attendance-statistics/attendance-statistics',
            tone: 'brand'
          }
        ]
      },
      {
        key: 'communication',
        label: '赛事与通知',
        items: [
          {
            id: 'student-competitions',
            name: '赛事意向',
            desc: '提交参赛意向并查看教练办理进度',
            url: '/pages/student-competitions/student-competitions',
            tone: 'accent'
          },
          {
            id: 'student-notices',
            name: '俱乐部通知',
            desc: '重要通知置顶与已读状态',
            url: '/pages/student-notices/student-notices',
            tone: 'brand'
          }
        ]
      },
      {
        key: 'account',
        label: '个人中心',
        items: [
          {
            id: 'profile-edit',
            name: '完善个人档案',
            desc: '身高体重、主项与体考目标',
            url: '/pages/profile-edit/profile-edit',
            tone: 'brand'
          },
          {
            id: 'link-manage',
            name: '亲子关联',
            desc: '生成家长关联凭证、确认或解除关联',
            url: '/pages/link-manage/link-manage',
            tone: 'ok'
          }
        ]
      }
    ]
  },

  coach: {
    label: '教练员',
    tone: 'brand',
    categories: [
      {
        key: 'training',
        label: '训练管理',
        items: [
          {
            id: 'coach-plan-list',
            name: '训练计划',
            desc: '创建、发布、归档与复制计划',
            url: '/pages/coach-plan-list/coach-plan-list',
            tone: 'brand'
          },
          {
            id: 'attendance-manage',
            name: '考勤管理',
            desc: '建场次、名单、人工核实与请假审批',
            url: '/pages/attendance-manage/attendance-manage',
            tone: 'ok'
          }
        ]
      },
      {
        key: 'students',
        label: '学生与成绩',
        items: [
          {
            id: 'coach-performance-review',
            name: '成绩审核',
            desc: '审核通过后才计入正式成绩与 PB',
            url: '/pages/coach-performance-review/coach-performance-review',
            tone: 'ok'
          },
          {
            id: 'stats-workbench',
            name: '统计与排行',
            desc: '授权训练组统计与 XLSX 导出',
            url: '/pages/stats-workbench/stats-workbench',
            tone: 'brand'
          }
        ]
      },
      {
        key: 'communication',
        label: '赛事与沟通',
        items: [
          {
            id: 'competition-manage',
            name: '赛事管理',
            desc: '发布赛事、办理报名与导出名单',
            url: '/pages/competition-manage/competition-manage',
            tone: 'accent'
          },
          {
            id: 'notice-manage',
            name: '通知管理',
            desc: '发布与撤回训练组通知',
            url: '/pages/notice-manage/notice-manage',
            tone: 'brand'
          },
          {
            id: 'feedback-manage',
            name: '训练反馈管理',
            desc: '查看反馈并补充教练评价',
            url: '/pages/feedback-manage/feedback-manage',
            tone: 'plain'
          }
        ]
      }
    ]
  },

  parent: {
    label: '家长',
    tone: 'accent',
    note:
      '家长端为只读：学生概览、训练计划、成绩、考勤、反馈、赛事与通知都在「家长工作台」内按已授权关联范围展示，目录条目直接定位到对应分区；关联申请与解除属于授权管理，单独进入关联学生管理页。',
    categories: [
      {
        key: 'children',
        label: '学生概览',
        items: [
          {
            id: 'parent-overview',
            name: '学生概览',
            desc: '关联学生的 PB、出勤与关键指标（只读）',
            url: '/pages/parent/parent?section=overview',
            tone: 'accent'
          },
          {
            id: 'parent-plans',
            name: '训练计划',
            desc: '本月已发布训练安排（只读）',
            url: '/pages/parent/parent?section=plans',
            tone: 'brand'
          },
          {
            id: 'parent-performance',
            name: '运动成绩',
            desc: '仅展示教练已审核的正式成绩（只读）',
            url: '/pages/parent/parent?section=performance',
            tone: 'ok'
          },
          {
            id: 'parent-attendance',
            name: '考勤记录',
            desc: '本月签到状态，不展示精确位置（只读）',
            url: '/pages/parent/parent?section=attendance',
            tone: 'plain'
          },
          {
            id: 'parent-feedback',
            name: '训练反馈',
            desc: '学生完成情况与自评强度（只读）',
            url: '/pages/parent/parent?section=feedback',
            tone: 'brand'
          },
          {
            id: 'parent-events',
            name: '赛事与通知',
            desc: '赛事意向进度与俱乐部通知（只读）',
            url: '/pages/parent/parent?section=events',
            tone: 'accent'
          },
          {
            id: 'parent-workbench',
            name: '家长工作台',
            desc: '从页面顶部开始查看全部只读分区',
            url: '/pages/parent/parent',
            tone: 'brand'
          }
        ]
      },
      {
        key: 'account',
        label: '关联与账号',
        items: [
          {
            id: 'parent-bind',
            name: '关联学生管理',
            desc: '使用凭证申请关联、查看状态与解除关联',
            url: '/pages/parent-bind/parent-bind',
            tone: 'brand'
          },
          {
            id: 'parent-account',
            name: '个人中心',
            desc: '关联状态与退出当前会话',
            url: '/pages/parent/parent?section=account',
            tone: 'plain'
          }
        ]
      }
    ]
  },

  developer: {
    label: '开发者',
    tone: 'accent',
    categories: [
      {
        key: 'review',
        label: '审核与核验',
        items: [
          {
            id: 'admin',
            name: '注册审核与账号管理',
            desc: '学生/家长注册审核、角色与账号状态',
            url: '/pages/admin/admin',
            tone: 'ok'
          },
          {
            id: 'link-review',
            name: '家长关联审核',
            desc: '核验学生已确认的家长关联申请',
            url: '/pages/link-review/link-review',
            tone: 'accent'
          }
        ]
      },
      {
        key: 'business',
        label: '全局业务管理',
        items: [
          {
            id: 'dev-performance-review',
            name: '成绩审核（全局）',
            desc: '审核通过后才计入正式成绩与 PB',
            url: '/pages/coach-performance-review/coach-performance-review',
            tone: 'ok'
          },
          {
            id: 'dev-attendance-manage',
            name: '考勤管理',
            desc: '场次、名单、人工核实与请假审批',
            url: '/pages/attendance-manage/attendance-manage',
            tone: 'brand'
          },
          {
            id: 'dev-stats-workbench',
            name: '统计工作台',
            desc: '全局统计、排行榜与 XLSX 导出',
            url: '/pages/stats-workbench/stats-workbench',
            tone: 'brand'
          },
          {
            id: 'dev-plan-list',
            name: '训练计划',
            desc: '全局计划查看与管理',
            url: '/pages/coach-plan-list/coach-plan-list',
            tone: 'plain'
          },
          {
            id: 'dev-competition-manage',
            name: '赛事管理',
            desc: '赛事发布、意向办理与名单导出',
            url: '/pages/competition-manage/competition-manage',
            tone: 'accent'
          },
          {
            id: 'dev-notice-manage',
            name: '通知管理',
            desc: '全体可见通知的发布与撤回',
            url: '/pages/notice-manage/notice-manage',
            tone: 'brand'
          },
          {
            id: 'dev-feedback-manage',
            name: '训练反馈管理',
            desc: '查看反馈与补充教练评价',
            url: '/pages/feedback-manage/feedback-manage',
            tone: 'plain'
          }
        ]
      },
      {
        key: 'system',
        label: '系统视角',
        items: [
          {
            id: 'dev-coach-application',
            name: '申请教练员身份',
            desc: '提交本人教练实名资料，审核通过后开通教练工作台',
            url: '/pages/coach-register/coach-register',
            tone: 'accent',
            hideWhenRole: 'coach'
          },
          {
            id: 'dev-coach-workbench',
            name: '切换教练工作台',
            desc: '当前账号已具有教练角色时可切换教练工作台',
            url: '/pages/coach/coach',
            tone: 'brand',
            requiresRole: 'coach'
          }
        ]
      }
    ]
  }
});

const ROLE_ORDER = Object.freeze(['student', 'coach', 'parent', 'developer']);

/** 跨执行上下文安全的数组判定（小程序运行时与本地 VM 测试环境一致） */
function asArray(value) {
  if (!value || typeof value.length !== 'number') {
    return [];
  }
  return Array.prototype.map.call(value, (item) => String(item));
}

/** 角色是否在目录中（用于过滤前端展示，不作为权限依据） */
function hasCatalog(role) {
  return Boolean(FEATURE_CATALOG[role]);
}

/** 取某角色的分类（深拷贝，避免调用方修改配置） */
function categoriesForRole(role) {
  const entry = FEATURE_CATALOG[role];
  if (!entry) {
    return [];
  }
  return entry.categories.map((category) => ({
    key: category.key,
    label: category.label,
    items: category.items.map((item) => ({ ...item, role }))
  }));
}

/** 取某角色的扁平功能列表 */
function featuresForRole(role) {
  return categoriesForRole(role).reduce((all, category) => all.concat(category.items), []);
}

/** 按会话角色集过滤出可用角色（保持固定顺序） */
function availableRoles(roles) {
  const list = asArray(roles);
  return ROLE_ORDER.filter((role) => list.includes(role) && hasCatalog(role));
}

/** 按当前真实会话角色过滤单个功能入口，不作为服务端权限依据 */
function isFeatureAvailable(item, roles) {
  const roleList = asArray(roles);
  if (item && item.requiresRole && !roleList.includes(item.requiresRole)) {
    return false;
  }
  if (item && item.hideWhenRole && roleList.includes(item.hideWhenRole)) {
    return false;
  }
  return true;
}

/** 全部配置中出现过的路由（供路由完整性测试使用） */
function allRoutes() {
  const routes = [];
  for (const role of ROLE_ORDER) {
    for (const item of featuresForRole(role)) {
      if (item.url && routes.indexOf(item.url) === -1) {
        routes.push(item.url);
      }
    }
  }
  return routes;
}

module.exports = {
  FEATURE_CATALOG,
  ROLE_ORDER,
  allRoutes,
  availableRoles,
  categoriesForRole,
  featuresForRole,
  hasCatalog,
  isFeatureAvailable
};
