'use strict';

Component({
  properties: {
    title: { type: String, value: '' },
    meta: { type: String, value: '' },
    roleLabel: { type: String, value: '' },
    roleTone: { type: String, value: 'brand' },
    daylight: { type: Boolean, value: false },
    showDaylightToggle: { type: Boolean, value: false },
    compact: { type: Boolean, value: false }
  },
  methods: {
    onToggleDaylight() {
      this.triggerEvent('toggledaylight');
    }
  }
});
