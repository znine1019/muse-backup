'use strict';

Component({
  options: {
    multipleSlots: true
  },

  properties: {
    flipped: { type: Boolean, value: false },
    daylight: { type: Boolean, value: false },
    degrade2d: { type: Boolean, value: false },
    frontActionText: { type: String, value: '翻面查看明细' },
    backActionText: { type: String, value: '翻回正面结论' }
  },

  data: {
    innerFlipped: false,
    autoDegrade: false
  },

  observers: {
    flipped(val) {
      this.setData({ innerFlipped: Boolean(val) });
    }
  },

  lifetimes: {
    attached() {
      let autoDegrade = false;
      try {
        const info = typeof wx.getAppBaseInfo === 'function'
          ? wx.getAppBaseInfo()
          : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {});
        const sdk = String((info && info.SDKVersion) || '3.0.0').split('.').map(Number);
        if (sdk[0] < 2 || (sdk[0] === 2 && sdk[1] < 16)) {
          autoDegrade = true;
        }
      } catch (_) {
        autoDegrade = false;
      }
      this.setData({ innerFlipped: Boolean(this.data.flipped), autoDegrade });
    }
  },

  methods: {
    onToggleFlip() {
      const next = !this.data.innerFlipped;
      this.setData({ innerFlipped: next });
      this.triggerEvent('flip', { flipped: next });
    }
  }
});
