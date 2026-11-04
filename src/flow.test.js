import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { difficultyAt, INNER_RADIUS, intersectsOrbit, multiplierFor } from './logic.js';
import { Sound } from './audio.js';
import { SpaceVisuals, themeAt } from './visuals.js';
import { planWave, perfectSwitchFor } from './encounters.js';

function boot(savedValue = null, blocked = false, reducedMotion = true, flightSeed = 314159) {
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
  const motionPreference = { matches: reducedMotion, addEventListener: (event, handler) => { handlers[`motion:${event}`] = handler; } };
  const window = { matchMedia: () => motionPreference, devicePixelRatio: 1, addEventListener: (event, handler) => { handlers[`window:${event}`] = handler; } };
  let seed = flightSeed >>> 0;
  const gameMath = Object.create(Math);
  gameMath.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let callback;
  let time = 0;
  const context = vm.createContext({ document, window, HTMLElement: Element, difficultyAt, INNER_RADIUS, intersectsOrbit, multiplierFor, Sound, SpaceVisuals, themeAt, planWave, perfectSwitchFor, Math: gameMath,
    localStorage: { getItem: () => { if (blocked) throw new Error('blocked'); return savedValue; }, setItem: () => { if (blocked) throw new Error('blocked'); } },
    performance: { now: () => time }, ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } },
    requestAnimationFrame: (fn) => { callback = fn; }
  });
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('import.meta.env.DEV', 'true');
  vm.runInContext(source, context);
  return { game: window.__game, elements, document,
    frame(dt = 1 / 60) { time += dt * 1000; callback(time); },
    step(seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) { time += 1000 / 60; callback(time); } },
    key(code, target = document.activeElement || document.getElementById('game')) { handlers['window:keydown']({ code, target, repeat: false, preventDefault: noop }); },
    hide() { document.hidden = true; handlers['document:visibilitychange'](); },
    setReducedMotion(matches) { motionPreference.matches = matches; handlers['motion:change']({ matches }); }
  };
}

function smartStep(runtime, timing = 0.28, dt = 1 / 60) {
  const rock = runtime.game.entities.filter((entity) => entity.type === 'rock' && !entity.gone && entity.gap > -0.1).sort((a, b) => a.gap - b.gap)[0];
  if (rock && rock.gap / (difficultyAt(runtime.game.elapsed).speed + 0.48) <= timing && runtime.game.lane === rock.lane) runtime.game.switchOrbit();
  runtime.frame(dt);
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
    let previousEnergy = 0;
    for (let frame = 0; frame < 65 * 60; frame++) {
      const rock = runtime.game.entities.filter((entity) => entity.type === 'rock' && entity.gap > -0.1).sort((a, b) => a.gap - b.gap)[0];
      if (rock && rock.gap < 0.6 && runtime.game.lane === rock.lane) runtime.game.switchOrbit();
      runtime.step(1 / 60);
      assert.equal(runtime.game.state, 'playing');
      if (runtime.game.energy !== previousEnergy) {
        previousEnergy = runtime.game.energy;
        if (previousEnergy === 12 || previousEnergy === 18) {
          assert.equal(runtime.elements.get('combo-beacon').textContent, '×4');
        }
        if (previousEnergy === 18) {
          // The new MAX SIGNAL celebration adds no points to the existing rewards.
          assert.ok(Math.abs(runtime.game.score - (1425 + runtime.game.dodges * 5 + runtime.game.perfectDodges * 20 + runtime.game.elapsed * 10)) < 1e-6);
        }
      }
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

test('impact freezes the score and flight before showing the result card', () => {
  const runtime = boot(null, false, false);
  runtime.game.start();
  runtime.step(0.2);
  runtime.game.endFlight();
  assert.equal(runtime.game.state, 'ended');
  assert.equal(runtime.elements.get('result-panel').hidden, true);
  assert.equal(runtime.elements.get('overlay').hidden, true);
  const stoppedAt = { elapsed: runtime.game.elapsed, score: runtime.game.score };
  runtime.key('Space');
  runtime.step(0.3);
  assert.deepEqual({ elapsed: runtime.game.elapsed, score: runtime.game.score }, stoppedAt);
  assert.equal(runtime.elements.get('result-panel').hidden, true);
  runtime.step(0.4);
  assert.equal(runtime.elements.get('result-panel').hidden, false);
  assert.equal(runtime.document.activeElement, runtime.elements.get('restart-button'));
  runtime.elements.get('restart-button').click();
  assert.equal(runtime.game.state, 'playing');
  assert.equal(runtime.game.score, 0);
});

test('enabling reduced motion during impact immediately reveals the result and keeps controls usable', () => {
  const runtime = boot(null, false, false);
  runtime.game.start();
  runtime.step(0.2);
  runtime.game.endFlight();
  assert.equal(runtime.elements.get('result-panel').hidden, true);
  runtime.setReducedMotion(true);
  assert.equal(runtime.elements.get('result-panel').hidden, false);
  runtime.elements.get('restart-button').click();
  runtime.game.endFlight();
  assert.equal(runtime.elements.get('result-panel').hidden, false);
  runtime.elements.get('restart-button').click();
  runtime.setReducedMotion(false);
  runtime.key('Space');
  assert.equal(runtime.game.lane, 1);
  runtime.game.endFlight();
  assert.equal(runtime.elements.get('result-panel').hidden, true);
});

test('one shield absorbs the first real hit and its grace timer freezes through pause and READY', () => {
  const runtime = boot();
  runtime.game.start();
  assert.equal(runtime.game.shield, true);
  for (let frame = 0; frame < 240 && runtime.game.shield; frame++) runtime.step(1 / 60);
  assert.equal(runtime.game.state, 'playing');
  assert.equal(runtime.game.shield, false);
  assert.equal(runtime.game.shieldCharge, 0);
  assert.ok(runtime.game.shieldGrace > 0);
  const grace = runtime.game.shieldGrace;
  runtime.game.pause();
  runtime.step(1);
  assert.equal(runtime.game.shieldGrace, grace);
  runtime.game.resume();
  runtime.step(0.9);
  assert.equal(runtime.game.shieldGrace, grace);
  runtime.game.start();
  assert.equal(runtime.game.shield, true);
  assert.equal(runtime.game.shieldGrace, 0);
});

test('eight collected energy items recharge the shield once and further collection does not bank a second shield', () => {
  const runtime = boot();
  runtime.game.start();
  for (let frame = 0; frame < 240 && runtime.game.shield; frame++) runtime.step(1 / 60);
  assert.equal(runtime.game.shield, false);
  for (let frame = 0; frame < 1800 && runtime.game.energy < 16; frame++) {
    smartStep(runtime);
    assert.equal(runtime.game.state, 'playing');
    if (runtime.game.energy < 8) assert.equal(runtime.game.shield, false);
    else {
      assert.equal(runtime.game.shield, true);
      assert.equal(runtime.game.shieldCharge, 0);
    }
  }
  assert.ok(runtime.game.energy >= 16);
});

test('without switching an uncharged second hit ends the flight', () => {
  const runtime = boot();
  runtime.game.start();
  for (let frame = 0; frame < 720 && runtime.game.state === 'playing'; frame++) runtime.step(1 / 60);
  assert.equal(runtime.game.state, 'ended');
  assert.equal(runtime.game.shield, false);
  assert.equal(runtime.elements.get('result-panel').hidden, false);
});

test('cross-pattern pending encounters freeze while paused and spawn only after READY finishes', () => {
  const runtime = boot();
  runtime.game.start();
  for (let frame = 0; frame < 600 && runtime.game.pendingCount === 0; frame++) smartStep(runtime);
  assert.equal(runtime.game.pendingCount, 1);
  runtime.game.pause();
  const count = runtime.game.entities.length;
  runtime.step(2);
  assert.equal(runtime.game.entities.length, count);
  assert.equal(runtime.game.pendingCount, 1);
  runtime.game.resume();
  runtime.step(0.9);
  assert.equal(runtime.game.pendingCount, 1);
  for (let frame = 0; frame < 60; frame++) smartStep(runtime);
  assert.equal(runtime.game.pendingCount, 0);
  assert.equal(runtime.game.state, 'playing');
  runtime.game.start();
  assert.equal(runtime.game.pendingCount, 0);
});

test('a well-timed safe switch awards exactly twenty extra points while early switching does not', () => {
  const runtime = boot();
  runtime.game.start();
  for (let frame = 0; frame < 300 && runtime.game.perfectDodges === 0; frame++) smartStep(runtime);
  assert.equal(runtime.game.perfectDodges, 1);
  assert.equal(runtime.game.dodges, 1);
  assert.equal(runtime.game.energy, 1);
  assert.equal(runtime.game.shield, true);
  assert.ok(Math.abs(runtime.game.score - (25 + 5 + 20 + runtime.game.elapsed * 10)) < 1e-6);
  const early = boot();
  early.game.start();
  for (let frame = 0; frame < 360; frame++) smartStep(early, 0.7);
  assert.equal(early.game.perfectDodges, 0);
  assert.equal(early.game.state, 'playing');
});

test('late cross and energy-stream patterns remain avoidable at the maximum frame step across multiple seeds', () => {
  for (const seed of [1, 17, 64, 511, 65535]) {
    const runtime = boot(null, false, true, seed);
    runtime.game.start();
    for (let frame = 0; frame < Math.ceil(160 / 0.035); frame++) {
      smartStep(runtime, 0.28, 0.035);
      assert.equal(runtime.game.state, 'playing', `seed ${seed}, frame ${frame}`);
      assert.equal(runtime.game.shield, true, `a safe path must not depend on absorbing a hit: seed ${seed}, frame ${frame}`);
    }
    assert.ok(runtime.game.energy > 120);
    assert.ok(runtime.game.perfectDodges > 20);
  }
});
