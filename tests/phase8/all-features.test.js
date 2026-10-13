'use strict';

/**
 * V1.6 阶段8第四轮｜四角色「全部功能」功能目录与分类页测试
 *
 * 覆盖：
 *   1. 统一功能目录配置（四角色分类、字段完整性）
 *   2. 目录中的每个路由都已在 app.json 注册且文件真实存在
 *   3. 四个工作台都存在「全部功能」入口且指向真实页面
 *   4. 家长端目录只读，不出现任何写入入口
 *   5. 多角色激活角色解析（令牌与身份绑定、角色变化失效）
 *   6. 「全部功能」页面行为：分类展示、角色切换、无权限跳转、入口导航
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CATALOG_PATH = path.join(PROJECT_ROOT, 'miniprogram/config/feature-catalog.js');
const ACTIVE_ROLE_PATH = path.join(PROJECT_ROOT, 'miniprogram/utils/active-role.js');
const ALL_FEATURES_JS = path.join(PROJECT_ROOT, 'miniprogram/pages/all-features/all-features.js');

const catalog = require(CATALOG_PATH);
const ACTIVE_ROLE = require(ACTIVE_ROLE_PATH);

const ROLES = ['student', 'coach', 'parent', 'developer'];

const WORKBENCHES = {
  student: { dir: 'student', handler: 'goAllFeatures' },
  coach: { dir: 'coach', handler: 'goAllFeatures' },
  parent: { dir: 'parent', handler: 'goAllFeatures' },
  developer: { dir: 'admin', handler: 'goAllFeatures' }
};

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relativePath));
}

function appPages() {
  return JSON.parse(read('miniprogram/app.json')).pages;
}

/* 目录条目允许带查询参数（如家长端 ?section=plans），注册校验只看路径部分 */
function routeToPage(route) {
  return route.split('?')[0].replace(/^\//, '');
}

/* ---------------------------------------------------------------- 目录配置 */

test('功能目录：四个角色都有分类且分类/条目字段完整', () => {
  assert.deepEqual(catalog.ROLE_ORDER, ROLES);

  for (const role of ROLES) {
    assert.ok(catalog.hasCatalog(role), `角色 ${role} 应存在目录`);
    const categories = catalog.categoriesForRole(role);
    assert.ok(categories.length >= 1, `角色 ${role} 至少应有一个分类`);

    const ids = new Set();
    for (const category of categories) {
      assert.ok(category.key, `角色 ${role} 的分类缺少 key`);
      assert.ok(category.label, `角色 ${role} 的分类缺少名称`);
      assert.ok(category.items.length >= 1, `分类 ${category.key} 不应为空`);

      for (const item of category.items) {
        assert.ok(item.id, `分类 ${category.key} 存在缺少 id 的功能`);
        assert.ok(!ids.has(item.id), `角色 ${role} 功能 id 重复：${item.id}`);
        ids.add(item.id);
        assert.ok(item.name, `功能 ${item.id} 缺少名称`);
        assert.match(item.url, /^\/pages\//, `功能 ${item.id} 的路由必须以 /pages/ 开头`);
        assert.equal(item.role, role, `功能 ${item.id} 的角色应为 ${role}`);
      }
    }
  }
});

test('功能目录：每个路由都已注册且对应页面文件真实存在', () => {
  const registered = new Set(appPages());

  for (const role of ROLES) {
    for (const item of catalog.featuresForRole(role)) {
      const page = routeToPage(item.url);
      assert.ok(registered.has(page), `${role}/${item.id} 的路由 ${page} 未在 app.json 注册`);
      for (const extension of ['js', 'json', 'wxml', 'wxss']) {
        assert.ok(
          fileExists(`miniprogram/${page}.${extension}`),
          `${role}/${item.id} 缺少页面文件 ${page}.${extension}`
        );
      }
    }
  }

  /* allRoutes() 只返回去重后的真实路由 */
  const routes = catalog.allRoutes();
  assert.equal(new Set(routes).size, routes.length, 'allRoutes 不应包含重复路由');
});

test('功能目录：可用角色只保留已授权且存在目录的角色并保持固定顺序', () => {
  assert.deepEqual(
    catalog.availableRoles(['developer', 'student', 'coach', 'parent']),
    ROLES,
    '应按固定顺序返回'
  );
  assert.deepEqual(
    catalog.availableRoles(['developer', 'unknown', 'student']),
    ['student', 'developer'],
    '应过滤未知角色'
  );
  assert.deepEqual(catalog.availableRoles([]), []);
  assert.deepEqual(catalog.availableRoles(null), []);
  assert.deepEqual(catalog.categoriesForRole('unknown'), []);
});

test('功能目录：家长端为只读，不出现任何写入入口', () => {
  const features = catalog.featuresForRole('parent');
  assert.ok(features.length >= 1, '家长端至少应有一个入口');

  const writeKeywords = ['发布', '创建', '编辑', '删除', '提交成绩', '审批', '驳回', '导出'];
  for (const item of features) {
    for (const keyword of writeKeywords) {
      assert.ok(
        !item.name.includes(keyword),
        `家长端不应出现写入入口「${item.name}」（含关键词 ${keyword}）`
      );
    }
    const pathOnly = item.url.split('?')[0];
    assert.ok(
      ['/pages/parent/parent', '/pages/parent-bind/parent-bind'].includes(pathOnly),
      `家长端入口只能指向只读页面：${item.url}`
    );
    /* 父页面内部定位只能用已存在的分区锚点 */
    if (item.url.includes('?')) {
      assert.ok(
        item.url.startsWith('/pages/parent/parent?section='),
        `家长端参数只允许定位分区：${item.url}`
      );
    }
  }
});

/* ------------------------------------------------------------ 工作台入口 */

test('工作台入口：四个工作台都提供「全部功能」入口并跳转到已注册页面', () => {
  const registered = new Set(appPages());
  assert.ok(registered.has('pages/all-features/all-features'), 'all-features 页面应已注册');

  for (const role of ROLES) {
    const { dir, handler } = WORKBENCHES[role];
    const js = read(`miniprogram/pages/${dir}/${dir}.js`);
    const wxml = read(`miniprogram/pages/${dir}/${dir}.wxml`);

    assert.ok(js.includes(`${handler}(`), `${dir} 应定义 ${handler} 方法`);
    assert.match(
      js,
      /navigateTo\(\{\s*url:\s*'\/pages\/all-features\/all-features'\s*\}\)/,
      `${dir}.js 应通过 navigateTo 进入全部功能`
    );
    assert.ok(
      wxml.includes(`bindtap="${handler}"`),
      `${dir}.wxml 应提供全部功能入口按钮`
    );
    assert.ok(wxml.includes('全部功能'), `${dir}.wxml 入口应标注为「全部功能」`);
  }
});

test('工作台入口：四个工作台原有的全部跳转目标仍然注册（入口是新增而非替换）', () => {
  const registered = new Set(appPages());

  for (const role of ROLES) {
    const { dir } = WORKBENCHES[role];
    const source = read(`miniprogram/pages/${dir}/${dir}.js`);
    const matches = source.match(/url:\s*['"`]\/pages\/[^'"`?]+/g) || [];
    assert.ok(matches.length >= 1, `${dir} 至少应有一个页面跳转`);

    for (const match of matches) {
      const page = match.replace(/url:\s*['"`]/, '').replace(/^\//, '');
      assert.ok(registered.has(page), `${dir} 跳转目标 ${page} 未在 app.json 注册`);
    }

    /* 原有业务入口不得因本轮改动被删除 */
    assert.match(source, /goHome\(/, `${dir} 应保留退出入口`);
  }
});

/* ------------------------------------------------------- 激活角色（纯逻辑） */

test('激活角色：令牌只对同一 userId 且角色集合一致的身份有效', () => {
  const token = ACTIVE_ROLE.tokenOf({ userId: 'user_a', roles: ['coach', 'developer'] });

  assert.ok(ACTIVE_ROLE.isTokenValid({ userId: 'user_a', roles: ['developer', 'coach'] }, token));
  assert.ok(
    !ACTIVE_ROLE.isTokenValid({ userId: 'user_b', roles: ['developer', 'coach'] }, token),
    '不同用户不得复用激活角色'
  );
  assert.ok(
    !ACTIVE_ROLE.isTokenValid({ userId: 'user_a', roles: ['developer'] }, token),
    '角色集合变化后应失效'
  );
  assert.ok(!ACTIVE_ROLE.isTokenValid(null, token));
  assert.ok(!ACTIVE_ROLE.isTokenValid({ userId: 'user_a', roles: [] }, null));
});

test('激活角色：优先记忆值，记忆非法时回退到第一个可用角色', () => {
  const hadWx = Object.prototype.hasOwnProperty.call(global, 'wx');
  const previousWx = global.wx;
  const store = {};

  global.wx = {
    getStorageSync: (key) => store[key],
    setStorageSync: (key, value) => {
      store[key] = value;
    },
    removeStorageSync: (key) => {
      delete store[key];
    }
  };

  try {
    const session = { user: { id: 'user_a', status: 'active', roles: ['student', 'developer'] } };

    /* 无记忆值时回退到第一个可用角色 */
    assert.equal(ACTIVE_ROLE.resolveActiveRole(session, ['student', 'developer']), 'student');

    /* 记忆值与当前授权一致时保留 */
    ACTIVE_ROLE.saveActiveRole('developer', ACTIVE_ROLE.sessionToken(session));
    assert.equal(ACTIVE_ROLE.resolveActiveRole(session, ['student', 'developer']), 'developer');

    /* 身份（userId）变化后记忆失效，回退默认 */
    const otherSession = { user: { id: 'user_b', status: 'active', roles: ['student', 'developer'] } };
    assert.equal(ACTIVE_ROLE.resolveActiveRole(otherSession, ['student', 'developer']), 'student');

    /* 角色被撤销后记忆失效，回退默认 */
    const shrunk = { user: { id: 'user_a', status: 'active', roles: ['student'] } };
    assert.equal(ACTIVE_ROLE.resolveActiveRole(shrunk, ['student']), 'student');

    /* 退出登录清理 */
    ACTIVE_ROLE.clearActiveRole();
    assert.equal(ACTIVE_ROLE.resolveActiveRole(session, ['student', 'developer']), 'student');

    /* 无可用角色时返回空串，由调用方按会话跳转 */
    assert.equal(ACTIVE_ROLE.resolveActiveRole(session, []), '');
  } finally {
    if (hadWx) {
      global.wx = previousWx;
    } else {
      delete global.wx;
    }
  }
});

/* ------------------------------------------------------- 全部功能页面行为 */

function loadAllFeaturesPage({ session, storage = {}, wxOverrides = {} } = {}) {
  const source = fs.readFileSync(ALL_FEATURES_JS, 'utf8');
  let page = null;

  const wx = {
    navigateTo: () => {},
    reLaunch: () => {},
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => {
      storage[key] = value;
    },
    removeStorageSync: (key) => {
      delete storage[key];
    },
    ...wxOverrides
  };

  vm.runInNewContext(
    source,
    {
      require: (request) => {
        if (request.includes('feature-catalog')) {
          return require(CATALOG_PATH);
        }
        if (request.includes('utils/session')) {
          return {
            getRoleLabel: (role) =>
              ({ developer: '开发者', coach: '教练员', student: '学生', parent: '家长' }[role] ||
                role),
            getSessionDestination: (value) => {
              const user = (value && value.user) || {};
              if (!user || !user.roles || !user.roles.length) {
                return { url: '/pages/index/index' };
              }
              if (user.roles.includes('developer')) {
                return { url: '/pages/admin/admin' };
              }
              if (user.roles.includes('coach')) {
                return { url: '/pages/coach/coach' };
              }
              if (user.roles.includes('parent')) {
                return { url: '/pages/parent/parent' };
              }
              return { url: '/pages/student/student' };
            }
          };
        }
        if (request.includes('utils/active-role')) {
          return require(ACTIVE_ROLE_PATH);
        }
        throw new Error(`未打桩的依赖：${request}`);
      },
      Page: (value) => {
        page = value;
      },
      getApp: () => ({
        ensureSession: async () => session,
        globalData: { session }
      }),
      wx,
      console,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Promise,
      JSON
    },
    { filename: ALL_FEATURES_JS }
  );

  assert.ok(page, 'all-features 页面应注册 Page');
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      for (const [key, value] of Object.entries(update)) {
        this.data[key] = value;
      }
    }
  };
  for (const [key, value] of Object.entries(page)) {
    if (typeof value === 'function') {
      instance[key] = value.bind(instance);
    }
  }
  return { page, instance, wx };
}

function activeSession(roles, id = 'user_1') {
  return { sessionVersion: 1, user: { id, status: 'active', roles } };
}

test('全部功能页：学生会话按真实目录分类渲染', async () => {
  const { instance } = loadAllFeaturesPage({ session: activeSession(['student']) });
  await instance.loadCatalog();

  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.activeRole, 'student');
  assert.equal(instance.data.roleLabel, '学生');
  assert.deepEqual(
    instance.data.categories.map((category) => category.label),
    catalog.categoriesForRole('student').map((category) => category.label)
  );
  assert.equal(
    instance.data.categories.flatMap((category) => category.items).length,
    catalog.featuresForRole('student').length
  );
  assert.equal(instance.data.roleChips.length, 1, '单角色不显示切换器');
});

test('全部功能页：多角色账号展示角色切换且切换后目录随之变化', async () => {
  const { instance } = loadAllFeaturesPage({
    session: activeSession(['developer', 'coach'])
  });
  await instance.loadCatalog();

  assert.deepEqual(instance.data.availableRoles, ['coach', 'developer']);
  assert.equal(instance.data.activeRole, 'coach', '默认使用目录顺序中的第一个已授权角色');
  assert.equal(instance.data.roleChips.length, 2);

  instance.onRoleTap({ currentTarget: { dataset: { role: 'developer' } } });
  assert.equal(instance.data.activeRole, 'developer');
  assert.equal(instance.data.roleLabel, '开发者');
  assert.deepEqual(
    instance.data.categories.map((category) => category.label),
    catalog.categoriesForRole('developer').map((category) => category.label)
  );

  /* 未授权角色不可切换 */
  instance.onRoleTap({ currentTarget: { dataset: { role: 'parent' } } });
  assert.equal(instance.data.activeRole, 'developer');
});

test('全部功能页：家长会话可按分区定位全部只读能力且无写入入口', async () => {
  const { instance } = loadAllFeaturesPage({ session: activeSession(['parent']) });
  await instance.loadCatalog();

  assert.equal(instance.data.activeRole, 'parent');
  const items = instance.data.categories.flatMap((category) => category.items);

  /* 只指向两个只读页面，不出现任何写入类业务页 */
  for (const item of items) {
    const pathOnly = item.url.split('?')[0];
    assert.ok(
      ['/pages/parent/parent', '/pages/parent-bind/parent-bind'].includes(pathOnly),
      `家长端入口只能指向只读页面：${item.url}`
    );
  }

  /* 学生概览/计划/成绩/考勤/反馈/赛事通知均可从目录直接定位 */
  const sections = items
    .map((item) => (item.url.match(/[?&]section=([a-z]+)/) || [])[1])
    .filter(Boolean);
  for (const section of [
    'overview',
    'plans',
    'performance',
    'attendance',
    'feedback',
    'events'
  ]) {
    assert.ok(sections.includes(section), `家长目录缺少可定位分区：${section}`);
  }

  /* 关联管理是授权操作，仍应可达 */
  assert.ok(
    items.some((item) => item.url === '/pages/parent-bind/parent-bind'),
    '家长目录应保留关联学生管理入口'
  );
});

test('家长工作台提供页内分区跳转且锚点与目录一致', () => {
  const wxml = read('miniprogram/pages/parent/parent.wxml');
  const js = read('miniprogram/pages/parent/parent.js');

  assert.match(wxml, /scroll-into-view="\{\{scrollIntoView\}\}"/, '页面应支持 scroll-into-view');

  const anchors = (wxml.match(/id="sec-([a-z]+)"/g) || []).map((value) =>
    value.replace(/id="sec-/, '').replace(/"/, '')
  );
  assert.ok(anchors.length >= 6, `家长工作台应有足够的分区锚点（实际 ${anchors.length}）`);

  /* 目录里出现的每个 section 参数都必须有对应锚点 */
  const catalogSections = catalog
    .featuresForRole('parent')
    .map((item) => (item.url.match(/[?&]section=([a-z]+)/) || [])[1])
    .filter(Boolean);
  for (const section of catalogSections) {
    assert.ok(anchors.includes(section), `目录分区 ${section} 缺少对应锚点 sec-${section}`);
  }

  /* onLoad 解析 section，点击分区时滚动定位 */
  assert.match(js, /onLoad\(options = \{\}\)/, '应实现 onLoad 以解析 section 参数');
  assert.match(js, /onJumpTap\(/, '应实现页内跳转点击处理');
  assert.match(js, /scrollIntoView: `sec-\$\{section\}`/, '应按分区设置滚动目标');
});

test('全部功能页：未启用账号不渲染目录并按会话跳转', async () => {
  let redirected = '';
  const { instance } = loadAllFeaturesPage({
    session: { user: { id: 'user_1', status: 'pending_review', roles: [] } },
    wxOverrides: {
      reLaunch: (options) => {
        redirected = options.url;
      }
    }
  });
  await instance.loadCatalog();

  assert.equal(instance.data.categories.length, 0);
  assert.equal(instance.data.loading, false);
  assert.ok(instance.data.error, '应给出明确的不可用提示');
  assert.equal(redirected, '/pages/index/index');
});

test('全部功能页：账号没有可展示目录时不暴露任何功能入口', async () => {
  let redirected = '';
  const { instance } = loadAllFeaturesPage({
    session: { user: { id: 'user_1', status: 'active', roles: ['unknown_role'] } },
    wxOverrides: {
      reLaunch: (options) => {
        redirected = options.url;
      }
    }
  });
  await instance.loadCatalog();

  assert.equal(instance.data.categories.length, 0);
  assert.equal(instance.data.availableRoles.length, 0);
  assert.ok(redirected, '应跳转回会话入口而不是停在空页面');
});

test('全部功能页：点击功能条目跳转到真实页面，返回按钮回到当前工作台', async () => {
  const navigated = [];
  const relaunched = [];
  const { instance } = loadAllFeaturesPage({
    session: activeSession(['coach']),
    wxOverrides: {
      navigateTo: (options) => navigated.push(options.url),
      reLaunch: (options) => relaunched.push(options.url)
    }
  });
  await instance.loadCatalog();

  instance.onItemTap({
    currentTarget: { dataset: { url: '/pages/coach-plan-list/coach-plan-list' } }
  });
  assert.deepEqual(navigated, ['/pages/coach-plan-list/coach-plan-list']);

  /* 无 url 时不产生跳转 */
  instance.onItemTap({ currentTarget: { dataset: {} } });
  assert.equal(navigated.length, 1);

  instance.goWorkbench();
  assert.deepEqual(relaunched, ['/pages/coach/coach']);
});
