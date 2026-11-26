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
      const track = this.data.daylight ? '#C9D6E3' : '#1E2C3A';
      const fill = this.data.incomplete ? '#7FB2FF' : '#2F6FBF';
      const displayText = empty ? '—' : (this.data.valueText || `${pct}%`);
      this.setData({
        ringStyle: `background: conic-gradient(${fill} 0deg ${deg}deg, ${track} ${deg}deg 360deg);`,
        displayText
      });
    }
  }
});
