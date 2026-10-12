'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CHART_JS = 'miniprogram/components/trend-chart/trend-chart.js';
const CHART_WXML = 'miniprogram/components/trend-chart/trend-chart.wxml';

function loadComponent() {
  const file = path.join(PROJECT_ROOT, CHART_JS);
  const source = fs.readFileSync(file, 'utf8');
  let component = null;
  const nextTickQueue = [];
  const wx = {
    nextTick: (callback) => nextTickQueue.push(callback),
    getSystemInfoSync: () => ({ pixelRatio: 2 })
  };

  vm.runInNewContext(
    source,
    {
      Component: (value) => {
        component = value;
      },
      wx,
      console
    },
    { filename: file }
  );

  assert.ok(component, 'trend-chart should register a Component');
  return { component, nextTickQueue };
}

function createContextRecorder() {
  const calls = [];
  const context = {};
  for (const name of [
    'clearRect',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'arc',
    'fill',
    'fillText',
    'scale'
  ]) {
    context[name] = (...args) => {
      calls.push({ name, args });
    };
  }
  return { context, calls };
}

function createInstance(series, options = {}) {
  const { context, calls } = createContextRecorder();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context
  };
  const size = options.size || { width: 300, height: 180 };
  const instance = {
    data: { series, comparison: options.comparison || 'lower' },
    setData(update) {
      Object.assign(this.data, update);
    },
    createSelectorQuery() {
      return {
        select() {
          return this;
        },
        fields() {
          return this;
        },
        exec(callback) {
          callback([{ node: canvas, width: size.width, height: size.height }]);
        }
      };
    }
  };
  return { instance, canvas, calls };
}

function canvasTextLabels(calls) {
  return calls
    .filter((call) => call.name === 'fillText')
    .map((call) => call.args[0]);
}

test('empty series shows the empty state without querying the canvas', () => {
  const { component } = loadComponent();
  const { instance } = createInstance([]);
  instance.createSelectorQuery = () => {
    throw new Error('canvas should not be queried without data');
  };

  component.methods.drawChart.call(instance);

  assert.equal(instance.data.ready, false);
});

test('single point shows the current value instead of faking a trend point', () => {
  const { component } = loadComponent();
  const { instance } = createInstance([{ date: '2026-01-01', value: 12.8 }]);
  instance.createSelectorQuery = () => {
    throw new Error('single point should not query the canvas');
  };

  component.methods.drawChart.call(instance);

  assert.equal(instance.data.ready, false);
  const wxml = fs.readFileSync(path.join(PROJECT_ROOT, CHART_WXML), 'utf8');
  assert.match(wxml, /series\.length === 1/);
  assert.match(wxml, /暂无足够历史数据形成趋势/);
  assert.match(wxml, /series\[0\]\.value/);
});

test('canvas 2d uses the device pixel ratio and plots points with date labels', () => {
  const { component } = loadComponent();
  const { instance, canvas, calls } = createInstance([
    { date: '2026-01-01', value: 13.2 },
    { date: '2026-02-01', value: 12.8 }
  ]);

  component.methods.drawChart.call(instance);

  assert.equal(canvas.width, 600);
  assert.equal(canvas.height, 360);
  assert.deepEqual(calls.find((call) => call.name === 'scale').args, [2, 2]);
  assert.equal(calls.filter((call) => call.name === 'clearRect').length, 1);
  assert.equal(calls.filter((call) => call.name === 'lineTo').length, 3);
  assert.equal(calls.filter((call) => call.name === 'arc').length, 2);

  const labels = canvasTextLabels(calls);
  assert.equal(labels.length, 4);
  assert.ok(labels.includes('01-01'));
  assert.ok(labels.includes('02-01'));
});

test('canvas falls back to a stable size when layout reports zero', () => {
  const { component } = loadComponent();
  const { instance, canvas } = createInstance(
    [
      { date: '2026-01-01', value: 5.1 },
      { date: '2026-02-01', value: 5.6 }
    ],
    { size: { width: 0, height: 0 }, comparison: 'higher' }
  );

  component.methods.drawChart.call(instance);

  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
});

test('chart labels key dates without printing every point', () => {
  const { component } = loadComponent();
  const series = [];
  for (let index = 0; index < 10; index += 1) {
    series.push({
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      value: 12 + index
    });
  }
  const { instance, calls } = createInstance(series);

  component.methods.drawChart.call(instance);

  const labels = canvasTextLabels(calls);
  assert.deepEqual(labels.slice(-3), ['01-01', '01-05', '01-10']);
});

test('scheduled redraws are coalesced', () => {
  const { component, nextTickQueue } = loadComponent();
  const instance = {
    data: { series: [] },
    setData() {},
    drawCount: 0,
    drawChart() {
      this.drawCount += 1;
    }
  };

  component.methods.scheduleDraw.call(instance);
  component.methods.scheduleDraw.call(instance);
  assert.equal(nextTickQueue.length, 1);

  nextTickQueue[0]();
  assert.equal(instance.drawCount, 1);
  assert.equal(instance._drawPending, false);
  assert.equal(typeof component.observers['series, comparison'], 'function');
});
