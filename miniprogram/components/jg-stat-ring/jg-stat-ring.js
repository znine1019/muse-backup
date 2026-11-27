'use strict';

Component({
  properties: {
    percent: { type: Number, value: 0 },
    valueText: { type: String, value: '' },
    label: { type: String, value: '出勤率' },
    empty: { type: Boolean, value: false },
    incomplete: { type: Boolean, value: false },
    daylight: { type: Boolean, value: false }
  },

  data: {
    ringStyle: '',
    displayText: '0%'
  },

  observers: {
    'percent, valueText, empty, incomplete, daylight': function () {
      this.syncRing();
    }
  },

  lifetimes: {
    attached() {
      this.syncRing();
    }
  },

  methods: {
    syncRing() {
      const empty = Boolean(this.data.empty);
      const pct = empty ? 0 : Math.max(0, Math.min(100, Number(this.data.percent) || 0));
      const deg = Math.round((pct / 100) * 360);
      const track = this.data.daylight ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.12)';
      const fill = this.data.daylight
        ? '#006BB3'
        : (this.data.incomplete ? '#38BDF8' : '#00A6FF');
      const displayText = empty ? '—' : (this.data.valueText || `${pct}%`);
      this.setData({
        ringStyle: `background: conic-gradient(${fill} 0deg ${deg}deg, ${track} ${deg}deg 360deg);`,
        displayText
      });
    }
  }
});
