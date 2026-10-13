'use strict';

/**
 * V1.6 阶段8.5｜关联凭证失败限流的并发阈值行为（真实 action 驱动）
 *
 * 目的：把「账号级限流是软限制」这一事实固化为可复现的测试，
 *       而不是用静态检查或笼统断言掩盖。测试直接调用真实 action
 *       `parent.redeem_invite`，只替换仓储，不修改生产逻辑。
 *
 * 结论（见报告）：
 *   - 计数更新本身是原子的（生产用 db.command.inc），不存在丢计数/覆盖。
 *   - 阈值判断发生在自增之前，属于「检查-再自增」，不是原子限流：
 *     同一账号在计数=9 时并发 N 个失败请求，N 个都会通过预检，
 *     最终计数为 9+N；N 本身不被限流逻辑限制。
 *   - 凭证级 maxAttempts 同样是先读后 inc，存在同类特性。
 *   - 残余风险在既定威胁模型下可接受：邀请码字母表 32 字符 × 长度 10，
     256 % 32 = 0 无取模偏置，最终有效熵 = 10 × log2(32) = 50 位
     （32^10 ≈ 2^50）；随机字节输入 160 位/实际消费 80 位不是凭证熵。
     有效期 30 分钟且需真实家长身份，在线穷举不可行。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const createParentActions = require(path.resolve(
  __dirname,
  '..',
  '..',
  'cloudfunctions/api/actions/parent.js'
));

/* 与生产一致的凭证字母表（去易混淆字符） */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function fakeCode(seed) {
  let code = '';
  for (let index = 0; index < 10; index += 1) {
    code += ALPHABET[(seed * 7 + index * 3) % ALPHABET.length];
  }
  return code;
}

/**
 * 最坏交错模型：
 *   - 每次请求读到独立的 actor 快照（真实 CloudBase 每次请求读同一文档）
 *   - 所有并发请求都先读到旧计数，再一起进入后续逻辑
 *   - recordParentInviteFailure 作用于持久层（原子自增语义）
 */
function createRaceRepository({ openId, startCount, concurrency }) {
  const stored = {
    _id: `usr_${openId}`,
    openid: openId,
    status: 'active',
    roles: ['parent'],
    inviteFailCount: startCount,
    inviteFailWindowAt: new Date()
  };

  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  return {
    stored,
    async ensureUser() {
      return { ...stored };
    },
    async getUserById() {
      return { ...stored };
    },
    async getUsersMap() {
      return new Map();
    },
    async listParentLinks() {
      arrived += 1;
      if (arrived === concurrency) {
        release();
      }
      /* 所有请求都读到旧 actor 后才继续，模拟最坏并发交错 */
      await gate;
      return [];
    },
    async recordParentInviteFailure() {
      const inWindow =
        stored.inviteFailWindowAt &&
        Date.now() - new Date(stored.inviteFailWindowAt).getTime() < 15 * 60 * 1000;
      stored.inviteFailCount = inWindow ? Number(stored.inviteFailCount || 0) + 1 : 1;
      stored.inviteFailWindowAt = inWindow ? stored.inviteFailWindowAt : new Date();
      return stored.inviteFailCount;
    }
  };
}

async function burst({ startCount, concurrency, openId = 'o_parent' }) {
  const repository = createRaceRepository({ openId, startCount, concurrency });
  const actions = createParentActions({ repository });
  const identity = { appid: 'wx_test', openid: openId };

  const codes = Array.from({ length: concurrency }, (_, index) => fakeCode(index));
  const results = await Promise.all(
    codes.map((code) =>
      actions['parent.redeem_invite']({ identity, payload: { code } })
        .then(() => 'ALLOWED')
        .catch((error) => error.code || `ERR:${error.message}`)
    )
  );

  const distribution = results.reduce((all, code) => {
    all[code] = (all[code] || 0) + 1;
    return all;
  }, {});

  return { distribution, stored: repository.stored };
}

test('限流：已达阈值的账号会被直接拒绝（严格边界）', async () => {
  const { distribution, stored } = await burst({ startCount: 10, concurrency: 5 });

  assert.equal(
    distribution.INVITE_REQUESTS_LIMITED,
    5,
    '计数达到上限后，进入预检的请求应全部被限流'
  );
  assert.equal(stored.inviteFailCount, 10, '被限流的请求不得继续累加计数');
});

test('限流：计数在窗口过期后重新开始，不沿用旧窗口', async () => {
  const repository = createRaceRepository({
    openId: 'o_parent',
    startCount: 10,
    concurrency: 1
  });
  /* 把窗口起点推到 16 分钟前，模拟窗口过期 */
  repository.stored.inviteFailWindowAt = new Date(Date.now() - 16 * 60 * 1000);
  repository.listParentLinks = async () => [];

  const actions = createParentActions({ repository });
  await assert.rejects(
    () =>
      actions['parent.redeem_invite']({
        identity: { appid: 'wx_test', openid: 'o_parent' },
        payload: { code: fakeCode(1) }
      }),
    (error) => error.code === 'INVALID_INVITE_CODE'
  );

  assert.equal(repository.stored.inviteFailCount, 1, '过期窗口应重置为 1');
  assert.ok(
    Date.now() - new Date(repository.stored.inviteFailWindowAt).getTime() < 5000,
    '过期后应开启新的失败窗口'
  );
});

test('限流：阈值前 1 次时并发突发会整体越过阈值（软限制的实证）', async () => {
  const concurrency = 20;
  const { distribution, stored } = await burst({ startCount: 9, concurrency });

  const blocked = distribution.INVITE_REQUESTS_LIMITED || 0;
  const allowed = concurrency - blocked;

  assert.equal(
    allowed,
    concurrency,
    '并发请求在自增落库前都读到旧计数，因此全部通过预检'
  );
  assert.equal(
    stored.inviteFailCount,
    9 + concurrency,
    '最终计数为起始值 + 并发数，说明阈值可被单次并发爆发越过'
  );
});

test('限流：越过阈值的幅度随并发数线性增长（不是硬上限）', async () => {
  const small = await burst({ startCount: 9, concurrency: 5 });
  const large = await burst({ startCount: 9, concurrency: 50 });

  assert.equal(small.stored.inviteFailCount, 14);
  assert.equal(large.stored.inviteFailCount, 59);
  assert.ok(
    large.stored.inviteFailCount > small.stored.inviteFailCount,
    '缺少原子限流时，爆发规模越大越过的失败次数越多'
  );
});

test('限流：计数更新本身不丢失（原子 inc 语义）', async () => {
  const concurrency = 20;
  const { stored } = await burst({ startCount: 9, concurrency });

  assert.equal(
    stored.inviteFailCount,
    29,
    '每个通过预检的请求都应被计数，不出现丢更新'
  );
});

test('限流：不同账号之间计数相互隔离', async () => {
  const first = createRaceRepository({ openId: 'o_parent_a', startCount: 0, concurrency: 1 });
  const second = createRaceRepository({ openId: 'o_parent_b', startCount: 0, concurrency: 1 });

  const actions = createParentActions({ repository: first });
  await assert.rejects(
    () =>
      actions['parent.redeem_invite']({
        identity: { appid: 'wx_test', openid: 'o_parent_a' },
        payload: { code: fakeCode(3) }
      }),
    (error) => error.code === 'INVALID_INVITE_CODE'
  );

  assert.equal(first.stored.inviteFailCount, 1, 'A 账号应累加失败次数');
  assert.equal(second.stored.inviteFailCount, 0, 'B 账号不应受影响');
});
