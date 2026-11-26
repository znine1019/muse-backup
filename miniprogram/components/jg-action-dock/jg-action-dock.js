'use strict';

Component({
  properties: {
    items: { type: Array, value: [] },
    activeKey: { type: String, value: '' },
    daylight: { type: Boolean, value: false },
    hidden: { type: Boolean, value: false }
  },

  methods: {
    onTapItem(event) {
      const item = event.currentTarget.dataset.item;
      if (!item) return;
      this.triggerEvent('select', { key: item.key, url: item.url || '', item });
    }
  }
});
