import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { difficultyAt, INNER_RADIUS, intersectsOrbit, multiplierFor } from './logic.js';
import { Sound } from './audio.js';
import { SpaceVisuals, themeAt } from './visuals.js';

function boot(savedValue = null, blocked = false, reducedMotion = true) {
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
  const window = { matchMedia: () => ({ matches: reducedMotion }), devicePixelRatio: 1, addEventListener: (event, handler) => { handlers[`window:${event}`] = handler; } };
  let seed = 314159;
  const gameMath = Object.create(Math);
  gameMath.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let callback;
  let time = 0;
  const context = vm.createContext({ document, window, HTMLElement: Element, difficultyAt, INNER_RADIUS, intersectsOrbit, multiplierFor, Sound, SpaceVisuals, themeAt, Math: gameMath,
    localStorage: { getItem: () => { if (blocked) throw new Error('blocked'); return savedValue; }, setItem: () => { if (blocked) throw new Error('blocked'); } },
    performance: { now: () => time }, ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } },
    requestAnimationFrame: (fn) => { callback = fn; }
  });
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('import.meta.env.DEV', 'true');
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

test('sound and orbit buttons return keyboard control to the flight canvas', () => {
  const runtime = boot();
  const canvas = runtime.elements.get('game');
  const sound = runtime.elements.get('sound-button');
  const control = runtime.elements.get('switch-button');
  runtime.game.start();
  sound.focus();
  sound.click();
  assert.equal(runtime.document.activeElement, canvas);
  runtime.key('Space');
  assert.equal(runtime.game.lane, 1);
  control.focus();
  control.click();
  assert.equal(runtime.document.activeElement, canvas);
  assert.equal(runtime.game.lane, 0);
  runtime.key('ArrowUp');
  assert.equal(runtime.game.lane, 1);
});

test('pointer orbit control switches on press once, ignores secondary presses and respects pause', () => {
  const runtime = boot();
  const control = runtime.elements.get('switch-button');
  runtime.game.start();
  const press = (button = 0) => control.events.pointerdown({ button, preventDefault() {} });
  press(2);
  assert.equal(runtime.game.lane, 0);
  press();
  assert.equal(runtime.game.lane, 1);
  control.events.click({ detail: 1 });
  assert.equal(runtime.game.lane, 1);
  runtime.game.pause();
  press();
  assert.equal(runtime.game.lane, 1);
  runtime.game.resume();
  press();
  assert.equal(runtime.game.lane, 1);
  runtime.step(1.1);
  press();
  assert.equal(runtime.game.lane, 0);
});

test('visual motion settings keep the same rewards and fair flight through sector changes', () => {
  const results = [];
  for (const reducedMotion of [true, false]) {
    const runtime = boot(null, false, reducedMotion);
    runtime.game.start();
    for (let frame = 0; frame < 65 * 60; frame++) {
      const rock = runtime.game.entities.filter((entity) => entity.type === 'rock' && entity.gap > -0.1).sort((a, b) => a.gap - b.gap)[0];
      if (rock && rock.gap < 0.6 && runtime.game.lane === rock.lane) runtime.game.switchOrbit();
      runtime.step(1 / 60);
      assert.equal(runtime.game.state, 'playing');
    }
    assert.ok(runtime.game.energy > 25);
    assert.equal(runtime.elements.get('sector-name').textContent, '황금빛 잔광');
    results.push({ score: runtime.game.score, energy: runtime.game.energy, elapsed: runtime.game.elapsed, lane: runtime.game.lane });
    runtime.game.pause();
    const stoppedAt = runtime.game.elapsed;
    runtime.step(1);
    assert.equal(runtime.game.elapsed, stoppedAt);
    runtime.game.start();
    assert.equal(runtime.elements.get('sector-name').textContent, '케플러의 새벽');
  }
  assert.deepEqual(results[0], results[1]);
});
