'use strict';

Component({
  properties: {
    title: { type: String, value: '' },
    unit: { type: String, value: '' },
    comparison: { type: String, value: 'higher' },
    emptyText: { type: String, value: '数据不足，暂时无法生成趋势。' },
    series: { type: Array, value: [] }
  },

  data: {
    ready: false
  },

  observers: {
    'series, comparison': function () {
      this.scheduleDraw();
    }
  },

  lifetimes: {
    attached() {
      this.scheduleDraw();
    }
  },

  methods: {
    scheduleDraw() {
      if (this._drawPending) {
        return;
      }
      this._drawPending = true;
      wx.nextTick(() => {
        this._drawPending = false;
        this.drawChart();
      });
    },

    drawChart() {
      const series = Array.isArray(this.data.series) ? this.data.series : [];
      if (series.length < 2) {
        this.setData({ ready: false });
        return;
      }

      this.createSelectorQuery()
        .select('.chart-canvas')
        .fields({ node: true, size: true })
        .exec((result) => {
          const target = result && result[0];
          if (!target || !target.node) {
            return;
          }
          const canvas = target.node;
          const context = canvas.getContext('2d');
          const systemInfo = wx.getSystemInfoSync();
          const dpr = systemInfo.pixelRatio || 1;
          const width = target.width || 320;
          const height = target.height || 180;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          context.scale(dpr, dpr);
          context.clearRect(0, 0, width, height);

          const values = series.map((item) => Number(item.value));
          const minValue = Math.min(...values);
          const maxValue = Math.max(...values);
          const span = maxValue - minValue || 1;
          const padding = { left: 42, right: 14, top: 16, bottom: 36 };
          const plotWidth = width - padding.left - padding.right;
          const plotHeight = height - padding.top - padding.bottom;

          context.strokeStyle = '#d9e2ec';
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(padding.left, padding.top);
          context.lineTo(padding.left, padding.top + plotHeight);
          context.lineTo(padding.left + plotWidth, padding.top + plotHeight);
          context.stroke();

          const points = series.map((item, index) => ({
            x:
              padding.left +
              (series.length === 1
                ? plotWidth / 2
                : (index / (series.length - 1)) * plotWidth),
            y:
              padding.top +
              ((maxValue - Number(item.value)) / span) * plotHeight
          }));

          context.strokeStyle = '#2b6cb0';
          context.lineWidth = 2;
          context.beginPath();
          points.forEach((point, index) => {
            if (index === 0) {
              context.moveTo(point.x, point.y);
            } else {
              context.lineTo(point.x, point.y);
            }
          });
          context.stroke();

          context.fillStyle = '#2b6cb0';
          points.forEach((point) => {
            context.beginPath();
            context.arc(point.x, point.y, 3, 0, Math.PI * 2);
            context.fill();
          });

          context.fillStyle = '#52606d';
          context.font = '11px sans-serif';
          context.textAlign = 'left';
          context.fillText(String(maxValue), 4, padding.top + 4);
          context.fillText(String(minValue), 4, padding.top + plotHeight);

          const labelIndexes = series.length <= 3
            ? series.map((item, index) => index)
            : [0, Math.floor((series.length - 1) / 2), series.length - 1];
          const uniqueLabelIndexes = Array.from(new Set(labelIndexes));
          context.textAlign = 'center';
          for (const index of uniqueLabelIndexes) {
            const label = String(series[index].date || '').slice(5);
            if (!label) {
              continue;
            }
            const x = Math.min(
              Math.max(points[index].x, padding.left),
              padding.left + plotWidth
            );
            context.fillText(label, x, height - 10);
          }
        });
    }
  }
});
