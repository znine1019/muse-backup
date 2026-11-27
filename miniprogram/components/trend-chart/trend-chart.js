'use strict';

Component({
  properties: {
    title: { type: String, value: '' },
    unit: { type: String, value: '' },
    comparison: { type: String, value: 'higher' },
    emptyText: { type: String, value: '数据不足，暂时无法生成趋势。' },
    series: { type: Array, value: [] },
    daylight: { type: Boolean, value: false }
  },

  data: {
    ready: false
  },

  observers: {
    'series, comparison': function () {
      this.scheduleDraw();
    },
    daylight: function () {
      this.scheduleDraw();
    }
  },

  lifetimes: {
    attached() {
      this._alive = true;
      this.scheduleDraw();
    },
    detached() {
      this._alive = false;
      if (this._rafId && this._canvas && typeof this._canvas.cancelAnimationFrame === 'function') {
        this._canvas.cancelAnimationFrame(this._rafId);
      }
      this._rafId = null;
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
        if (this._alive !== false) {
          this.drawChart();
        }
      });
    },

    drawChart() {
      if (this._rafId && this._canvas && typeof this._canvas.cancelAnimationFrame === 'function') {
        this._canvas.cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }

      const series = Array.isArray(this.data.series) ? this.data.series : [];
      if (series.length < 2) {
        this.setData({ ready: false });
        return;
      }

      this.createSelectorQuery()
        .select('.chart-canvas')
        .fields({ node: true, size: true })
        .exec((result) => {
          if (this._alive === false) return;
          const target = result && result[0];
          if (!target || !target.node) {
            return;
          }
          const canvas = target.node;
          this._canvas = canvas;
          const context = canvas.getContext('2d');
          const systemInfo = typeof wx.getWindowInfo === 'function'
            ? wx.getWindowInfo()
            : wx.getSystemInfoSync();
          /* DPR 上限严格锁在 2 */
          const dpr = Math.min(systemInfo.pixelRatio || 1, 2);
          const width = target.width || 320;
          const height = target.height || 180;
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          context.scale(dpr, dpr);

          const isDay = Boolean(this.data.daylight);
          const pal = isDay
            ? { bg: '#FFFFFF', axis: 'rgba(0,0,0,0.14)', line: '#006BB3', dot: '#005596', text: '#4B5563', label: '#000000', areaTop: 'rgba(0,107,179,0.16)', areaBot: 'rgba(0,107,179,0.01)' }
            : { bg: '#000000', axis: 'rgba(255,255,255,0.14)', line: '#00A6FF', dot: '#38BDF8', text: '#A3ADB8', label: '#FFFFFF', areaTop: 'rgba(0,166,255,0.24)', areaBot: 'rgba(0,166,255,0.01)' };

          const values = series.map((item) => Number(item.value));
          const minValue = Math.min(...values);
          const maxValue = Math.max(...values);
          const span = maxValue - minValue || 1;
          const padding = { left: 42, right: 14, top: 16, bottom: 36 };
          const plotWidth = width - padding.left - padding.right;
          const plotHeight = height - padding.top - padding.bottom;

          const points = series.map((item, index) => ({
            x:
              padding.left +
              (series.length === 1
                ? plotWidth / 2
                : (index / (series.length - 1)) * plotWidth),
            y:
              padding.top +
              ((maxValue - Number(item.value)) / span) * plotHeight,
            val: item.displayValue || String(item.value)
          }));

          const labelIndexes = series.length <= 3
            ? series.map((item, index) => index)
            : [0, Math.floor((series.length - 1) / 2), series.length - 1];
          const uniqueLabelIndexes = Array.from(new Set(labelIndexes));

          const hasRichCanvas =
            typeof context.save === 'function' &&
            typeof context.clip === 'function' &&
            typeof context.restore === 'function';

          const renderFrame = (lineProgress, labelAlpha) => {
            context.clearRect(0, 0, width, height);
            if (typeof context.fillRect === 'function') {
              context.fillStyle = pal.bg;
              context.fillRect(0, 0, width, height);
            }

            context.strokeStyle = pal.axis;
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(padding.left, padding.top);
            context.lineTo(padding.left, padding.top + plotHeight);
            context.lineTo(padding.left + plotWidth, padding.top + plotHeight);
            context.stroke();

            if (hasRichCanvas) {
              context.save();
              context.beginPath();
              context.rect(padding.left - 4, 0, (plotWidth + 12) * lineProgress, height);
              context.clip();
              if (typeof context.createLinearGradient === 'function') {
                const grad = context.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
                grad.addColorStop(0, pal.areaTop);
                grad.addColorStop(1, pal.areaBot);
                context.beginPath();
                context.moveTo(points[0].x, padding.top + plotHeight);
                points.forEach((pt) => context.lineTo(pt.x, pt.y));
                context.lineTo(points[points.length - 1].x, padding.top + plotHeight);
                context.closePath();
                context.fillStyle = grad;
                context.fill();
              }
            }

            context.strokeStyle = pal.line;
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

            context.fillStyle = pal.dot;
            points.forEach((point) => {
              context.beginPath();
              context.arc(point.x, point.y, 3, 0, Math.PI * 2);
              context.fill();
            });

            if (hasRichCanvas) {
              context.restore();
            }

            context.fillStyle = pal.text;
            context.font = '11px sans-serif';
            context.textAlign = 'left';
            context.fillText(String(maxValue), 4, padding.top + 4);
            context.fillText(String(minValue), 4, padding.top + plotHeight);

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

            if (hasRichCanvas && labelAlpha > 0) {
              context.save();
              context.globalAlpha = labelAlpha;
              context.fillStyle = pal.label;
              context.font = 'bold 11px sans-serif';
              context.textAlign = 'center';
              for (const index of uniqueLabelIndexes) {
                context.fillText(points[index].val, points[index].x, Math.max(12, points[index].y - 8));
              }
              context.restore();
            }
          };

          /* 真实 Canvas 2D 支持自左向右 320ms 生长 + 标签延迟 100ms 淡入 */
          if (!hasRichCanvas || typeof canvas.requestAnimationFrame !== 'function') {
            renderFrame(1, 0);
            return;
          }

          const start = Date.now();
          const lineDur = 320;
          const labelDelay = 100;
          const labelDur = 180;
          const tick = () => {
            if (this._alive === false) return;
            const elapsed = Date.now() - start;
            const p = Math.min(1, elapsed / lineDur);
            const eased = 1 - Math.pow(1 - p, 3);
            const alpha = Math.max(0, Math.min(1, (elapsed - (lineDur + labelDelay)) / labelDur));
            renderFrame(eased, alpha);
            if (elapsed < lineDur + labelDelay + labelDur) {
              this._rafId = canvas.requestAnimationFrame(tick);
            } else {
              this._rafId = null;
            }
          };
          this._rafId = canvas.requestAnimationFrame(tick);
        });
    }
  }
});
