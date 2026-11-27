'use strict';

Component({
  properties: {
    items: { type: Array, value: [] },
    current: { type: Number, value: 0 },
    daylight: { type: Boolean, value: false }
  },
  methods: {
    onTapTab(event) {
      const ds = (event && event.currentTarget && event.currentTarget.dataset) || {};
      const index = Number(ds.index);
      const key = ds.key || '';
      if (!Number.isFinite(index)) {
        return;
      }
      this.triggerEvent('select', { index, key });
    }
  }
});
