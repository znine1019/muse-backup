'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  getStatusLabel,
  sessionHasRole
} = require('../../utils/session');

const GENDER_LABELS = Object.freeze({
  male: '男',
  female: '女',
  unspecified: '未说明'
});

const ATTENDANCE_STATUS_LABELS = Object.freeze({
  not_started: '未到签到时间',
  pending: '待签到',
  checked_in: '已签到',
  late: '迟到',
  leave_approved: '已批准请假',
  pending_verification: '待核实',
  absent: '未签到',
  cancelled: '已取消'
});

const ATTENDANCE_PHASE_LABELS = Object.freeze({
  not_started: '未开始',
  open: '签到中',
  closed: '已结束',
  cancelled: '已取消'
});

/* 常用功能：全部指向现有真实页面，不新增路由 */
/* 常用功能入口全部指向现有真实页面（阶段1—阶段6 已注册路由），本页不新增任何路由 */

function todayIso() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function percentText(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  return `${Math.round(number * 10000) / 100}%`;
}

function formatMetric(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return `${value || ''} ${unit || ''}`.trim();
  }
  if (unit === '秒' && number >= 60) {
    const minutes = Math.floor(number / 60);
    const seconds = Math.round((number % 60) * 100) / 100;
    return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  }
  return `${number} ${unit || ''}`.trim();
}

function shortDate(value) {
  if (!value) {
    return '';
  }
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : text;
}

/* 逐区块独立加载：单个接口失败不影响其它区块 */
function settle(promise) {
  return promise.then(
    (data) => ({ ok: true, data }),
    (error) => ({ ok: false, error })
  );
}

Page({
  data: {
    loading: true,
    sessionError: '',
    headMeta: '',
    headName: '',
    headEvent: '',
    headGroup: '',
    statusLabel: '',
    profileState: { loading: true, error: '' },
    profile: null,
    genderLabel: '',
    todayState: { loading: true, error: '' },
    todayDate: '',
    todaySessions: [],
    statsState: { loading: true, error: '' },
    stats: null,
    noticeState: { loading: true, error: '' },
    notices: [],
    noticeMeta: '',
    noticeActionText: '查看全部',
    unreadCount: 0,
    busy: false
  },

  onShow() {
    this.loadPage();
  },

  onPullDownRefresh() {
    this.loadPage({ fromPullDown: true });
  },

  async loadPage(options = {}) {
    const fromPullDown = options.fromPullDown === true;
    this.setData({
      loading: true,
      sessionError: '',
      profileState: { loading: true, error: '' },
      todayState: { loading: true, error: '' },
      statsState: { loading: true, error: '' },
      noticeState: { loading: true, error: '' }
    });

    let session = null;
    try {
      session = await getApp().ensureSession({ force: true });
    } catch (error) {
      this.setData({
        loading: false,
        sessionError: error.message || '身份校验失败，请重新登录。'
      });
      if (fromPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    if (!sessionHasRole(session, 'student')) {
      wx.reLaunch({ url: getSessionDestination(session).url });
      return;
    }

    this.setData({ loading: false });

    /* 4 个现有只读接口并行发起，各区块独立渲染与独立错误重试 */
    await Promise.all([
      this.loadProfile(),
      this.loadTodayAttendance(),
      this.loadStatistics(),
      this.loadNotices()
    ]);

    if (fromPullDown) {
      wx.stopPullDownRefresh();
    }
  },

  async loadProfile() {
    this.setData({ 'profileState.loading': true, 'profileState.error': '' });
    const result = await settle(api.getProfile());
    if (!result.ok) {
      this.setData({
        'profileState.loading': false,
        'profileState.error': result.error.message || '个人档案加载失败。'
      });
      return;
    }
    const profile = result.data.profile || null;
    const primaryEvent = profile
      ? profile.primaryEventName || profile.primaryTrainingProject || ''
      : '';
    this.setData({
      'profileState.loading': false,
      'profileState.error': '',
      profile,
      genderLabel: profile ? GENDER_LABELS[profile.gender] || '未说明' : '',
      statusLabel: getStatusLabel(result.data.userStatus),
      headName: profile ? profile.name || '' : '',
      headEvent: primaryEvent
    });
    this.refreshHead();
  },

  async loadTodayAttendance() {
    this.setData({ 'todayState.loading': true, 'todayState.error': '' });
    const result = await settle(api.getStudentTodayAttendance());
    if (!result.ok) {
      this.setData({
        'todayState.loading': false,
        'todayState.error': result.error.message || '今日训练加载失败。'
      });
      return;
    }
    const sessions = (result.data.sessions || []).map((item) => {
      const session = item.session || {};
      return {
        sessionId: session.sessionId,
        title: session.title || session.locationName || '训练场次',
        locationName: session.locationName || '',
        trainingGroupName: session.trainingGroupName || '',
        checkInOpenTime: session.checkInOpenTime || '',
        checkInCloseTime: session.checkInCloseTime || '',
        latitude: session.latitude,
        radiusMeters: session.radiusMeters,
        status: item.status,
        statusLabel: ATTENDANCE_STATUS_LABELS[item.status] || item.status,
        phaseLabel: ATTENDANCE_PHASE_LABELS[session.phase] || session.phase || '',
        canCheckIn: item.status === 'pending',
        isDone: item.status === 'checked_in' || item.status === 'late'
      };
    });
    this.setData({
      'todayState.loading': false,
      'todayState.error': '',
      todayDate: result.data.date || todayIso(),
      todaySessions: sessions
    });
  },

  async loadStatistics() {
    this.setData({ 'statsState.loading': true, 'statsState.error': '' });
    const now = new Date();
    const result = await settle(
      api.getMyStatistics({
        periodType: 'month',
        year: now.getFullYear(),
        month: now.getMonth() + 1
      })
    );
    if (!result.ok) {
      this.setData({
        'statsState.loading': false,
        'statsState.error': result.error.message || '个人统计加载失败。'
      });
      return;
    }
    const payload = result.data || {};
    const attendance = payload.attendance || {};
    const performance = payload.performance || {};
    const personalBests = performance.personalBests || [];
    const best = personalBests[0] || null;
    const target = performance.targetComparison || null;
    const rateText = percentText(attendance.attendanceRate);

    this.setData({
      'statsState.loading': false,
      'statsState.error': '',
      stats: {
        periodLabel: (payload.period || {}).label || '',
        attendanceRateText: rateText,
        attendanceRatePercent: Number.isFinite(Number(attendance.attendanceRate))
          ? Math.min(100, Math.round(Number(attendance.attendanceRate) * 100))
          : 0,
        validAttendance: Number(attendance.validAttendance) || 0,
        actualExpected: Number(attendance.actualExpected) || 0,
        late: Number(attendance.late) || 0,
        absent: Number(attendance.absent) || 0,
        pendingVerification: Number(attendance.pendingVerification) || 0,
        approvedCount: Number(performance.approvedCount) || 0,
        hasPb: Boolean(best),
        pbEventName: best ? best.eventName : '',
        pbValueText: best ? formatMetric(best.value, best.unit) : '',
        pbRawValue: best
          ? best.unit === '秒' && Number(best.value) >= 60
            ? formatMetric(best.value, best.unit)
            : best.value
          : '',
        pbUnit: best && !(best.unit === '秒' && Number(best.value) >= 60) ? best.unit : '',
        pbDate: best ? shortDate(best.date || best.achievedAt) : '',
        targetEventName: target ? target.eventName : '',
        targetText:
          target && target.hasCurrentResult
            ? formatMetric(target.currentValue, target.unit)
            : '',
        targetValueText: target ? formatMetric(target.targetValue, target.unit) : '',
        targetAchieved: Boolean(target && target.achieved),
        changes: (performance.stageChanges || []).slice(0, 3).map((item) => ({
          eventName: item.eventName,
          fromText: formatMetric(item.firstValue, item.unit),
          toText: formatMetric(item.latestValue, item.unit),
          changeText: `${item.change > 0 ? '+' : ''}${item.change} ${item.unit || ''}`.trim(),
          improved: Number(item.change) > 0,
          date: shortDate(item.latestDate),
          metaText: `${formatMetric(item.firstValue, item.unit)} → ${formatMetric(item.latestValue, item.unit)}${item.latestDate ? ` · ${shortDate(item.latestDate)}` : ''}`
        })),
        changesTotal: (performance.stageChanges || []).length,
        dataQualityNote: (payload.dataQuality || {}).membershipHistoryNote || ''
      },
      headEvent: (payload.profile || {}).primaryEventName || this.data.headEvent,
      headGroup: ((payload.groups || [])[0] || {}).name || ''
    });
    this.refreshHead();
  },

  async loadNotices() {
    this.setData({ 'noticeState.loading': true, 'noticeState.error': '' });
    const result = await settle(api.listStudentNotices({}));
    if (!result.ok) {
      this.setData({
        'noticeState.loading': false,
        'noticeState.error': result.error.message || '通知加载失败。'
      });
      return;
    }
    const notices = (result.data.notices || []).slice(0, 3).map((notice) => ({
      noticeId: notice.noticeId,
      title: notice.title,
      content: notice.content,
      isImportant: notice.priority === 'important',
      isRead: Boolean(notice.isRead),
      categoryLabel: notice.categoryLabel || '',
      timeText: shortDate(notice.publishedAt)
    }));
    const unreadCount = Number(result.data.unreadCount) || 0;
    this.setData({
      'noticeState.loading': false,
      'noticeState.error': '',
      notices,
      unreadCount,
      noticeMeta: unreadCount ? `未读 ${unreadCount} 条` : '全部已读',
      noticeActionText: unreadCount ? `查看全部（${unreadCount}）` : '查看全部'
    });
  },

  refreshHead() {
    const meta = [this.data.headName, this.data.headEvent, this.data.headGroup]
      .filter(Boolean)
      .join(' · ');
    if (meta !== this.data.headMeta) {
      this.setData({ headMeta: meta });
    }
  },

  retryProfile() {
    this.loadProfile();
  },

  retryToday() {
    this.loadTodayAttendance();
  },

  retryStats() {
    this.loadStatistics();
  },

  retryNotices() {
    this.loadNotices();
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/student-plans/student-plans' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/student-report/student-report' });
  },

  goPerformance() {
    wx.navigateTo({ url: '/pages/performance/performance' });
  },

  goStatistics() {
    wx.navigateTo({ url: '/pages/student-statistics/student-statistics' });
  },

  goPerformanceLeaderboard() {
    wx.navigateTo({ url: '/pages/performance-leaderboard/performance-leaderboard' });
  },

  goAttendanceStatistics() {
    wx.navigateTo({ url: '/pages/attendance-statistics/attendance-statistics' });
  },

  goAttendance() {
    wx.navigateTo({ url: '/pages/student-attendance/student-attendance' });
  },

  goCompetitions() {
    wx.navigateTo({ url: '/pages/student-competitions/student-competitions' });
  },

  goNotices() {
    wx.navigateTo({ url: '/pages/student-notices/student-notices' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/student-feedback/student-feedback' });
  },

  goEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  },

  async goHome() {
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '退出当前会话',
        content: '退出后需要重新进行微信登录，校内数据不会删除。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
