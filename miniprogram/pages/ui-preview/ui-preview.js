'use strict';

/**
 * 开发者专用：V1.6.5 界面试穿页（黑底白字 + 深蓝，三方向 × 两屏，本地虚构动效预览）
 *
 * 安全边界：
 * 1. 复用 miniprogram/demo/demo-guard.js：仅 develop/trial 环境 + 真实 developer 角色可访问，release 自动拒绝；
 * 2. 不引入 services/api，不调用任何云函数或数据库，不写 wx.setStorage；
 * 3. 数据全部来自 miniprogram/demo/student-demo.js 的虚构演示对象，严禁包含真实学生信息；
 * 4. 所有动效仅操作 transform / opacity，并在 onHide / onUnload 完整清理定时器。
 */

const { checkDemoAccess } = require('../../demo/demo-guard');
const { buildStudentWorkbench } = require('../../demo/student-demo');
const { getSessionDestination } = require('../../utils/session');

const DIRECTIONS = Object.freeze([
  { id: 'v1', label: 'V1 矢量竞速', grammar: '位移主导 · 仪表盘', sigName: '三层蓝白光环扩散' },
  { id: 'v2', label: 'V2 态变遥测', grammar: '形变主导 · 时间轴', sigName: 'PB 卡 3D 立体翻面' },
  { id: 'v3', label: 'V3 光栅脉动', grammar: '光栅扫描 · 卡片流', sigName: '光栅扫描 + 名次置换' }
]);

const SCREENS = Object.freeze([
  { id: 'student', label: '学生首页' },
  { id: 'coach', label: '教练工作台' }
]);

const RANK_INITIAL = Object.freeze([
  { id: 'r1', rank: 1, name: '林越（虚构）', group: '短跑组（虚构）', value: '11.70 秒', pct: 95 },
  { id: 'r2', rank: 2, name: '周远（虚构）', group: '短跑组（虚构）', value: '11.84 秒', pct: 86 },
  { id: 'r3', rank: 3, name: '许微（虚构）', group: '短跑组（虚构）', value: '11.96 秒', pct: 78 }
]);

const RANK_SWAPPED = Object.freeze([
  { id: 'r2', rank: 1, name: '周远（虚构）', group: '短跑组（虚构）', value: '11.62 秒', pct: 97 },
  { id: 'r1', rank: 2, name: '林越（虚构）', group: '短跑组（虚构）', value: '11.70 秒', pct: 94 },
  { id: 'r3', rank: 3, name: '许微（虚构）', group: '短跑组（虚构）', value: '11.96 秒', pct: 78 }
]);

Page({
  data: {
    loading: true,
    ready: false,
    denied: false,
    error: '',
    fallbackUrl: '/pages/index/index',

    directions: DIRECTIONS,
    screens: SCREENS,
    activeDir: 'v1',
    activeDirMeta: DIRECTIONS[0],
    activeScreen: 'student',
    daylight: false,

    staggerReady: true,
    skeletonActive: false,
    revealFade: false,

    pbDisplay: '11.70',
    rateDisplay: '92',
    pendingDisplay: '3',
    coachCheckedDisplay: '11/12',

    submitPhase: 'idle', // idle | submitting | success
    pulseActive: false,
    cardFlipped: false,
    rasterScanning: false,
    rankSwapped: false,
    rankRows: RANK_INITIAL,

    studentInfo: null,
    todaySessions: [],
    notices: [],
    coachTodos: [],
    feedbackTip: ''
  },

  onLoad() {
    this._timers = [];
    this.verifyAndInit();
  },

  onHide() {
    this.clearAllTimers();
  },

  onUnload() {
    this.clearAllTimers();
  },

  clearAllTimers() {
    if (!Array.isArray(this._timers)) return;
    while (this._timers.length) {
      clearTimeout(this._timers.pop());
    }
  },

  schedule(fn, ms) {
    const id = setTimeout(() => {
      this._timers = (this._timers || []).filter((t) => t !== id);
      fn();
    }, ms);
    this._timers.push(id);
    return id;
  },

  async verifyAndInit() {
    try {
      const session = await getApp().ensureSession({ force: true });
      const access = checkDemoAccess(session);
      if (!access.ok) {
        this.setData({
          loading: false,
          ready: false,
          denied: true,
          error: access.reason,
          fallbackUrl: getSessionDestination(session).url
        });
        return;
      }

      const wb = buildStudentWorkbench();
      const studentInfo = {
        name: `${wb.student.name}（${wb.student.tag}）`,
        group: wb.student.trainingGroupName,
        pbEvent: wb.pb.eventName,
        pbNum: Number(wb.pb.value) || 11.7,
        pbUnit: wb.pb.unit,
        pbDate: wb.pb.achievedAt,
        rateNum: Number(wb.monthStats.attendanceRatePercent) || 92,
        validText: `${wb.monthStats.validAttendance}/${wb.monthStats.actualExpected} 场`,
        goalText: wb.pb.goalText
      };
      const coachTodos = [
        { id: 'ct1', type: '待批请假', student: `${wb.student.name}（虚构）`, detail: '晚间力量课 · 课业冲突（无附件）', done: false },
        { id: 'ct2', type: '待审成绩', student: '周远（虚构）', detail: '100米 11.62 秒 · 复核后入正式榜', done: false },
        { id: 'ct3', type: '待核材料', student: '许微（虚构）', detail: '市公开赛意向材料 2 份（内部核验≠官方成功）', done: false }
      ];

      this.setData(
        {
          loading: false,
          ready: true,
          denied: false,
          error: '',
          studentInfo,
          todaySessions: wb.todaySessions.slice(0, 2),
          notices: wb.notices.slice(0, 2),
          coachTodos
        },
        () => {
          this.runCountUp(studentInfo.pbNum, studentInfo.rateNum, coachTodos.length);
        }
      );
    } catch (err) {
      this.setData({
        loading: false,
        ready: false,
        denied: true,
        error: (err && err.message) || '试穿页身份校验失败。'
      });
    }
  },

  runCountUp(pbTarget, rateTarget, todoTarget) {
    const steps = 20;
    const intervalMs = 30; // 20 * 30ms = 600ms
    let cur = 0;
    const step = () => {
      cur += 1;
      const p = cur / steps;
      const eased = 1 - Math.pow(1 - p, 3);
      this.setData({
        pbDisplay: (pbTarget * eased).toFixed(2),
        rateDisplay: String(Math.round(rateTarget * eased)),
        pendingDisplay: String(Math.round(todoTarget * eased))
      });
      if (cur < steps) {
        this.schedule(step, intervalMs);
      }
    };
    step();
  },

  replayStaggerAndCount() {
    this.clearAllTimers();
    this.setData({ staggerReady: false, revealFade: false });
    this.schedule(() => {
      this.setData({ staggerReady: true });
      const info = this.data.studentInfo;
      if (info) {
        const remain = this.data.coachTodos.filter((t) => !t.done).length;
        this.runCountUp(info.pbNum, info.rateNum, remain);
      }
    }, 30);
  },

  onSelectDir(e) {
    const dir = e.currentTarget.dataset.dir;
    if (!dir || dir === this.data.activeDir) return;
    const meta = DIRECTIONS.find((d) => d.id === dir) || DIRECTIONS[0];
    this.setData({
      activeDir: dir,
      activeDirMeta: meta,
      submitPhase: 'idle',
      pulseActive: false,
      cardFlipped: false,
      rasterScanning: false,
      feedbackTip: `已切换至 ${meta.label}（${meta.grammar}）`
    });
    this.replayStaggerAndCount();
  },

  onSelectScreen(e) {
    const scr = e.currentTarget.dataset.screen;
    if (!scr || scr === this.data.activeScreen) return;
    this.setData({
      activeScreen: scr,
      submitPhase: 'idle',
      pulseActive: false,
      feedbackTip: ''
    });
    this.replayStaggerAndCount();
  },

  onToggleDaylight() {
    this.setData({
      daylight: !this.data.daylight,
      feedbackTip: !this.data.daylight ? '已开启日光高对比（白底黑字+深蓝）' : '已返回黑底白字+深蓝'
    });
  },

  onDemoSkeleton() {
    this.clearAllTimers();
    this.setData({ skeletonActive: true, revealFade: false, feedbackTip: '骨架屏 shimmer 扫光 1.2s…' });
    this.schedule(() => {
      this.setData({
        skeletonActive: false,
        revealFade: true,
        feedbackTip: '骨架屏结束，内容 200ms 上移淡入完成'
      });
      const info = this.data.studentInfo;
      if (info) {
        const remain = this.data.coachTodos.filter((t) => !t.done).length;
        this.runCountUp(info.pbNum, info.rateNum, remain);
      }
    }, 1200);
  },

  onDemoSubmit() {
    if (this.data.submitPhase === 'submitting') return;
    this.setData({
      submitPhase: 'submitting',
      pulseActive: false,
      feedbackTip: '按钮变形进度环处理中（本地演示，无接口写入）…'
    });
    this.schedule(() => {
      const triggerPulse = this.data.activeDir === 'v1';
      this.setData({
        submitPhase: 'success',
        pulseActive: triggerPulse,
        feedbackTip: triggerPulse
          ? '成功 400ms 环形确认 + V1 招牌三层蓝白光环扩散'
          : '成功 400ms 环形确认（本地演示）'
      });
      this.schedule(() => {
        this.setData({ submitPhase: 'idle', pulseActive: false });
      }, 1050);
    }, 520);
  },

  onFlipCard() {
    this.setData({
      cardFlipped: !this.data.cardFlipped,
      feedbackTip: !this.data.cardFlipped ? 'V2 招牌动效：3D 翻面查看审核溯源' : '已翻回 PB 正面'
    });
  },

  onTriggerRasterSwap() {
    const nextSwap = !this.data.rankSwapped;
    this.setData({
      rasterScanning: true,
      rankSwapped: nextSwap,
      rankRows: nextSwap ? RANK_SWAPPED : RANK_INITIAL,
      feedbackTip: 'V3 招牌动效：蓝白光栅扫描 + 排行名次置换（540ms）'
    });
    this.schedule(() => {
      this.setData({ rasterScanning: false });
    }, 560);
  },

  onApproveTodo(e) {
    const id = e.currentTarget.dataset.id;
    const next = this.data.coachTodos.map((t) => (t.id === id ? { ...t, done: true } : t));
    const remain = next.filter((t) => !t.done).length;
    this.setData({
      coachTodos: next,
      pendingDisplay: String(remain),
      feedbackTip: '已演示审批通过（仅改变本页内存，未写库）'
    });
  },

  onBackFallback() {
    wx.reLaunch({ url: this.data.fallbackUrl || '/pages/index/index' });
  }
});
