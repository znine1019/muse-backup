'use strict';

/**
 * 乔格训迹 V1.6.5 纯原生动效与 Canvas 2D 可视化内核（零外部依赖）
 * - 遵守性能红线：仅使用 Canvas 2D / transform / opacity，不写 CSS 变量逐帧动画
 * - 支持 prefers-reduced-motion 静态降级
 * - 图表支持：正常 / 无数据(empty) / 估算不完整(incomplete) 三种数据口径态
 */
window.JOGER_V165_MOTION = (function () {
  function reducedMotion() {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function animateCountUp(el, target, opts) {
    if (!el) return;
    const cfg = opts || {};
    const decimals = cfg.decimals !== undefined ? cfg.decimals : 0;
    const prefix = cfg.prefix || '';
    const suffix = cfg.suffix || '';
    const duration = reducedMotion() ? 0 : (cfg.duration || 600);
    const numTarget = Number(target);
    if (!Number.isFinite(numTarget)) {
      el.textContent = prefix + String(target) + suffix;
      return;
    }
    if (duration <= 0) {
      el.textContent = prefix + numTarget.toFixed(decimals) + suffix;
      return;
    }
    const start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = numTarget * eased;
      el.textContent = prefix + val.toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = prefix + numTarget.toFixed(decimals) + suffix;
    }
    requestAnimationFrame(tick);
  }

  function runCountUps(container) {
    if (!container) return;
    const nodes = container.querySelectorAll('[data-countup]');
    nodes.forEach((el) => {
      const target = Number(el.dataset.countup);
      const decimals = Number(el.dataset.decimals || 0);
      const prefix = el.dataset.prefix || '';
      const suffix = el.dataset.suffix || '';
      animateCountUp(el, target, { decimals, prefix, suffix, duration: 600 });
    });
  }

  function getPalette(isDaylight) {
    if (isDaylight) {
      return {
        bg: '#FFFFFF',
        grid: '#CBD8E6',
        axis: '#2C4663',
        line: '#A84E00',
        fillTop: 'rgba(168, 78, 0, 0.22)',
        fillBot: 'rgba(168, 78, 0, 0.02)',
        dot: '#0B1728',
        label: '#0B1728',
        ringTrack: '#DCE6F0',
        ringFill: '#A84E00',
        ringWarn: '#925600'
      };
    }
    return {
      bg: '#0B1728',
      grid: '#233F5E',
      axis: '#9DB2C9',
      line: '#EE8300',
      fillTop: 'rgba(238, 131, 0, 0.30)',
      fillBot: 'rgba(238, 131, 0, 0.02)',
      dot: '#FF9E2C',
      label: '#EAF2FB',
      ringTrack: '#1A3A5C',
      ringFill: '#EE8300',
      ringWarn: '#F2B233'
    };
  }

  /**
   * 1) Canvas 2D 趋势/成绩曲线（从左到右生长 + 数值标签延迟 120ms 淡入）
   */
  function drawTrendChart(canvas, config) {
    if (!canvas) return;
    const cfg = config || {};
    const mode = cfg.mode || 'normal'; // normal | empty | incomplete
    const isDaylight = Boolean(cfg.daylight);
    const pal = getPalette(isDaylight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 320;
    const cssH = canvas.clientHeight || 164;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    function renderBase() {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    if (mode === 'empty' || !cfg.points || cfg.points.length === 0) {
      renderBase();
      ctx.strokeStyle = pal.grid;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(24, cssH / 2);
      ctx.lineTo(cssW - 24, cssH / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = pal.axis;
      ctx.font = '600 13px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无教练已审核成绩记录（不填充模拟值）', cssW / 2, cssH / 2 - 10);
      ctx.font = '500 12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('提交成绩并通过教练复核后自动绘制趋势曲线', cssW / 2, cssH / 2 + 16);
      return;
    }

    const pts = cfg.points;
    const padL = 36;
    const padR = 20;
    const padT = 26;
    const padB = 28;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;
    const ys = pts.map((p) => p.y);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);
    const span = Math.max(maxY - minY, 0.1);
    const lo = minY - span * 0.2;
    const hi = maxY + span * 0.25;

    const coords = pts.map((p, idx) => {
      const x = padL + (pts.length === 1 ? plotW / 2 : (idx / (pts.length - 1)) * plotW);
      const norm = (p.y - lo) / (hi - lo);
      // lowerBetter: smaller time sits higher on chart to visually show improvement upward
      const yRatio = cfg.lowerBetter ? norm : 1 - norm;
      const y = padT + yRatio * plotH;
      return { x, y, label: p.x, val: p.y };
    });

    const lineDur = reducedMotion() ? 0 : 320;
    const labelDelay = reducedMotion() ? 0 : 120;
    const labelDur = reducedMotion() ? 0 : 180;
    const startTs = performance.now();
    const animToken = String(Date.now()) + Math.random();
    canvas.dataset.animToken = animToken;

    function frame(now) {
      if (canvas.dataset.animToken !== animToken) return;
      const elapsed = now - startTs;
      const lineP = lineDur === 0 ? 1 : Math.min(1, elapsed / lineDur);
      const easedP = 1 - Math.pow(1 - lineP, 3);
      const labelP =
        labelDur === 0
          ? 1
          : Math.max(0, Math.min(1, (elapsed - (lineDur + labelDelay)) / labelDur));

      renderBase();

      // Horizontal reference grid lines
      ctx.strokeStyle = pal.grid;
      ctx.lineWidth = 1;
      for (let g = 0; g < 3; g++) {
        const gy = padT + (g / 2) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, gy);
        ctx.lineTo(cssW - padR, gy);
        ctx.stroke();
      }

      // X-axis labels
      ctx.fillStyle = pal.axis;
      ctx.font = '600 11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      coords.forEach((c) => {
        ctx.fillText(c.label, c.x, cssH - 8);
      });

      // Left-to-right clipped curve reveal
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL - 8, 0, (plotW + 16) * easedP, cssH);
      ctx.clip();

      // Area gradient
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, pal.fillTop);
      grad.addColorStop(1, pal.fillBot);
      ctx.beginPath();
      ctx.moveTo(coords[0].x, padT + plotH);
      coords.forEach((c) => ctx.lineTo(c.x, c.y));
      ctx.lineTo(coords[coords.length - 1].x, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Main stroke (dashed tail if incomplete / 估算口径)
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      if (mode === 'incomplete') {
        ctx.setLineDash([6, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      coords.forEach((c, idx) => {
        if (idx === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Points
      coords.forEach((c) => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = pal.dot;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = pal.bg;
        ctx.stroke();
      });
      ctx.restore();

      // Value labels fade in after 120ms delay
      if (labelP > 0) {
        ctx.save();
        ctx.globalAlpha = labelP;
        ctx.fillStyle = pal.label;
        ctx.font = '700 11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        coords.forEach((c) => {
          ctx.fillText(String(c.val), c.x, Math.max(14, c.y - 10));
        });
        if (mode === 'incomplete') {
          ctx.fillStyle = pal.line;
          ctx.textAlign = 'right';
          ctx.fillText('虚线=历史样本不完整（估算口径）', cssW - padR, 14);
        }
        ctx.restore();
      }

      if (elapsed < lineDur + labelDelay + labelDur) {
        requestAnimationFrame(frame);
      }
    }

    requestAnimationFrame(frame);
  }

  /**
   * 2) Canvas 2D 出勤率环形仪表（带绘制动画 + 空态 + 估算态）
   */
  function drawRingGauge(canvas, config) {
    if (!canvas) return;
    const cfg = config || {};
    const mode = cfg.mode || 'normal'; // normal | empty | incomplete
    const pct = Math.max(0, Math.min(100, Number(cfg.percent || 0)));
    const isDaylight = Boolean(cfg.daylight);
    const pal = getPalette(isDaylight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 108;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 10;
    const dur = reducedMotion() ? 0 : 420;
    const startTs = performance.now();
    const token = String(Date.now()) + Math.random();
    canvas.dataset.animToken = token;

    function frame(now) {
      if (canvas.dataset.animToken !== token) return;
      const p = dur === 0 ? 1 : Math.min(1, (now - startTs) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      ctx.clearRect(0, 0, size, size);

      // Track
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = pal.ringTrack;
      ctx.lineWidth = 9;
      ctx.stroke();

      if (mode !== 'empty') {
        const endAngle = -Math.PI / 2 + Math.PI * 2 * (pct / 100) * eased;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, endAngle);
        ctx.strokeStyle = mode === 'incomplete' ? pal.ringWarn : pal.ringFill;
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        if (mode === 'incomplete') ctx.setLineDash([7, 4]);
        else ctx.setLineDash([]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = pal.label;
      ctx.font = '800 18px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mode === 'empty' ? '—' : (pct * eased).toFixed(1) + '%', cx, cy - 6);

      ctx.fillStyle = pal.axis;
      ctx.font = '600 11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(
        mode === 'empty' ? '无样本' : mode === 'incomplete' ? '估算口径' : (cfg.sub || '出勤率'),
        cx,
        cy + 15
      );

      if (p < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  return {
    reducedMotion,
    animateCountUp,
    runCountUps,
    drawTrendChart,
    drawRingGauge
  };
})();
