import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { difficultyAt, INNER_RADIUS, intersectsOrbit, multiplierFor } from './logic.js';

function boot(savedValue = null, blocked = false) {
  const handlers = {};
  const elements = new Map();
  const document = { hidden: false, addEventListener: (event, handler) => { handlers[`document:${event}`] = handler; } };
  const noop = () => {};
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop: noop }) : noop, set: () => true });
  class Element {
    constructor(id) { this.id = id; this.children = []; this.events = {}; this.classList = { add: noop, remove: noop, toggle: noop }; this.hidden = false; this.disabled = false; }
    setAttribute() {}
    addEventListener(event, handler) { this.events[event] = handler; }
    focus() { document.activeElement = this; }
    click() { if (!this.disabled) this.events.click?.({ target: this }); }
    closest(selector) { return this.id.endsWith('button') && selector.includes('button') ? this : null; }
    getContext() { return drawing; }
    getBoundingClientRect() { return { width: 900, height: 650 }; }
  }
  document.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  document.getElementById('signal-bars').children = Array.from({ length: 12 }, () => new Element('bar'));
  const window = { matchMedia: () => ({ matches: true }), devicePixelRatio: 1, addEventListener: (event, handler) => { handlers[`window:${event}`] = handler; } };
  let callback;
  let time = 0;
  const context = vm.createContext({ document, window, HTMLElement: Element, difficultyAt, INNER_RADIUS, intersectsOrbit, multiplierFor, Math,
    localStorage: { getItem: () => { if (blocked) throw new Error('blocked'); return savedValue; }, setItem: () => { if (blocked) throw new Error('blocked'); } },
    performance: { now: () => time }, ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } },
    requestAnimationFrame: (fn) => { callback = fn; }
  });
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '').replace('import.meta.env.DEV', 'true');
  vm.runInContext(source, context);
  return { game: window.__game, elements, document,
    step(seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) { time += 1000 / 60; callback(time); } },
    key(code, target = document.activeElement || document.getElementById('game')) { handlers['window:keydown']({ code, target, repeat: false, preventDefault: noop }); },
    hide() { document.hidden = true; handlers['document:visibilitychange'](); }
  };
}

test('keyboard controls, pause from a focused button, hidden tab and restart keep a coherent flight state', () => {
  const runtime = boot();
  runtime.elements.get('start-button').click();
  assert.equal(runtime.game.state, 'playing');
  runtime.step(0.2);
  runtime.key('Space');
  assert.equal(runtime.game.lane, 1);
  runtime.key('KeyP');
  assert.equal(runtime.game.state, 'paused');
  const stoppedAt = runtime.game.elapsed;
  runtime.step(0.4);
  assert.equal(runtime.game.elapsed, stoppedAt);
  runtime.key('KeyP');
  assert.equal(runtime.game.state, 'playing');
  runtime.step(1.2);
  assert.ok(runtime.game.elapsed > stoppedAt);
  runtime.hide();
  assert.equal(runtime.game.state, 'paused');
  runtime.elements.get('resume-button').click();
  assert.equal(runtime.game.state, 'paused');
  runtime.document.hidden = false;
  runtime.elements.get('resume-button').click();
  runtime.step(1.1);
  runtime.game.endFlight();
  assert.equal(runtime.game.state, 'ended');
  runtime.elements.get('restart-button').click();
  assert.equal(runtime.game.state, 'playing');
  assert.equal(runtime.game.score, 0);
  assert.equal(runtime.game.energy, 0);
  assert.equal(runtime.game.elapsed, 0);
});

test('corrupt, primitive and blocked browser storage never prevent starting or saving a run', () => {
  for (const saved of ['{broken', 'null', 'true', '"string"', '{"best":-100,"sound":false}', '{"best":1e309}']) {
    const runtime = boot(saved);
    runtime.game.start();
    runtime.step(0.1);
    runtime.game.endFlight();
    assert.equal(runtime.game.state, 'ended');
    assert.equal(runtime.elements.get('best').textContent, '00001');
  }
  const blocked = boot(null, true);
  blocked.game.start();
  blocked.game.endFlight();
  assert.equal(blocked.game.state, 'ended');
});
