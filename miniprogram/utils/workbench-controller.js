'use strict';

/**
 * 阶段7-2｜工作台刷新控制器
 *
 * 目标：返回工作台时不再清空已显示的数据，改为 stale-while-revalidate：
 *   1. 已有有效数据 → 立即保留内容，后台静默刷新（不显示骨架屏）
 *   2. 无数据 → 才显示骨架屏
 *   3. 同一区块的并发请求合并；旧请求结果不会覆盖新结果
 *   4. 会话/角色身份变化 → 缓存失效（调用方清空数据）
 *   5. 权限失效（停用/未审核/无角色/身份失效）→ 调用方清空数据并跳转
 *   6. 只使用当前会话内的页面内存状态，不做任何本地持久化缓存
 *
 * 所有数据都保存在页面实例内存中（同一会话、同一登录身份），
 * 退出登录或 reLaunch 后页面实例销毁，缓存随之消失。
 */

/* 返回工作台时的最小自动刷新间隔：避免频繁往返重复拉取全部数据 */
const MIN_AUTO_REFRESH_MS = 15000;

/* 会话强制复核间隔：超过该时长后重新调用登录接口确认角色与状态 */
const SESSION_REVALIDATE_MS = 60000;

/* 需要立即失效缓存并跳转的服务端错误码 */
const PERMISSION_LOST_CODES = Object.freeze([
  'ACCOUNT_DISABLED',
  'ACCOUNT_NOT_ACTIVE',
  'FORBIDDEN',
  'UNAUTHENTICATED'
]);

/* 会话身份指纹：用户 ID + 账号状态 + 角色集合（角色变化即视为新身份） */
function identityOf(session) {
  const user = (session && session.user) || {};
  const roles = Array.isArray(user.roles) ? user.roles.slice().sort().join('+') : '';
  return `${user.id || ''}#${user.status || ''}#${roles}`;
}

function isPermissionLostError(error) {
  return Boolean(error && PERMISSION_LOST_CODES.includes(error.code));
}

function formatClock(timestamp) {
  const date = new Date(timestamp || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createWorkbenchController(page) {
  const inflight = {};
  const seq = {};
  let identity = '';
  let lastLoadedAt = 0;
  let lastSessionAt = 0;
  /* 会话代次：退出登录 / 权限失效 / 身份变化时递增，旧请求结果不再回填 */
  let generation = 0;

  function syncIdentity(session) {
    const next = identityOf(session);
    const changed = Boolean(identity) && next !== identity;
    identity = next;
    return !changed;
  }

  return {
    hasData() {
      return page.data.hasData === true;
    },

    /* 返回工作台时是否需要真正发起请求 */
    shouldAutoRefresh({ force = false, needsRefresh = false } = {}) {
      if (force || needsRefresh || !lastLoadedAt) {
        return true;
      }
      return Date.now() - lastLoadedAt >= MIN_AUTO_REFRESH_MS;
    },

    /* 会话是否需要重新校验（角色/停用变化） */
    sessionStale() {
      if (!lastSessionAt) {
        return true;
      }
      return Date.now() - lastSessionAt >= SESSION_REVALIDATE_MS;
    },

    markSessionChecked() {
      lastSessionAt = Date.now();
    },

    markLoaded() {
      lastLoadedAt = Date.now();
    },

    reset() {
      lastLoadedAt = 0;
      lastSessionAt = 0;
      identity = '';
      generation += 1;
    },

    generation() {
      return generation;
    },

    /* 身份变化时返回 false，调用方需清空页面缓存 */
    syncIdentity,

    /**
     * 按区块执行请求：
     *   - 同一区块并发请求复用同一 Promise（避免重复请求）
     *   - 返回 null 表示该结果已过期（被更新的请求取代），调用方应直接丢弃
     */
    run(name, factory) {
      if (inflight[name]) {
        return inflight[name];
      }
      const token = (seq[name] || 0) + 1;
      seq[name] = token;
      const startedGeneration = generation;
      const isFresh = () => startedGeneration === generation && token === seq[name];
      const task = Promise.resolve()
        .then(factory)
        .then(
          (value) => (isFresh() ? { ok: true, value } : null),
          (error) => (isFresh() ? { ok: false, error } : null)
        )
        .then((result) => {
          if (inflight[name] === task) {
            delete inflight[name];
          }
          return result;
        });
      inflight[name] = task;
      return task;
    },

    /* 仅在值真正变化时 setData，减少渲染抖动 */
    setIfChanged(payload) {
      const changed = {};
      let count = 0;
      for (const key of Object.keys(payload)) {
        let same = false;
        try {
          same = JSON.stringify(page.data[key]) === JSON.stringify(payload[key]);
        } catch (error) {
          same = false;
        }
        if (!same) {
          changed[key] = payload[key];
          count += 1;
        }
      }
      if (count) {
        page.setData(changed);
      }
      return count;
    }
  };
}

module.exports = {
  MIN_AUTO_REFRESH_MS,
  PERMISSION_LOST_CODES,
  SESSION_REVALIDATE_MS,
  createWorkbenchController,
  formatClock,
  identityOf,
  isPermissionLostError
};
