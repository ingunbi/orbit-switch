import test from 'node:test';
import assert from 'node:assert/strict';
import { SpaceVisuals, themeAt } from './visuals.js';

function drawing() {
  const commands = [];
  const ctx = new Proxy({}, {
    get: (_, key) => key === 'createRadialGradient'
      ? () => ({ addColorStop() {} })
      : (...args) => commands.push([key, ...args]),
    set: () => true
  });
  return { ctx, commands };
}

test('sector themes change at the same twenty-second boundaries and cycle safely', () => {
  assert.equal(themeAt(19.99).name, '케플러의 새벽');
  assert.equal(themeAt(20).name, '청록 성운');
  assert.equal(themeAt(40).name, '자수정 성해');
  assert.equal(themeAt(60).name, '황금빛 잔광');
  assert.equal(themeAt(80).name, '오로라 회랑');
  assert.equal(themeAt(100).sector, 6);
  assert.equal(themeAt(100).accent, themeAt(0).accent);
  assert.equal(themeAt(-1).sector, 1);
  assert.equal(themeAt(Infinity).sector, 1);
});

test('effects freeze during pause, expire after resuming and clear for a new flight', () => {
  const { ctx } = drawing();
  const visual = new SpaceVisuals(ctx);
  visual.resize(900, 650, 450, 338, 210);
  visual.switchOrbit(0, 0.67, 1);
  visual.collect(0, 1, 50, 2, true);
  visual.crash(1, 0.67);
  visual.setSector(40);
  visual.sector(3);
  const beforePause = visual.diagnostics;
  visual.update(10, false);
  assert.deepEqual(visual.diagnostics, beforePause);
  visual.update(2);
  assert.equal(visual.diagnostics.eventCount, 0);
  assert.equal(visual.diagnostics.pulseCount, 0);
  visual.collect(0, 1, 25, 1);
  visual.reset();
  assert.equal(visual.diagnostics.time, 0);
  assert.equal(visual.diagnostics.eventCount, 0);
  assert.equal(visual.diagnostics.sector, 1);
});

test('repeated switches and rewards have bounded effects and no per-frame gradient work', () => {
  const { ctx } = drawing();
  const visual = new SpaceVisuals(ctx);
  visual.resize(360, 540, 180, 280, 120);
  for (let index = 0; index < 200; index++) {
    visual.switchOrbit(index, 0.67, 1);
    visual.collect(index, 1, 100, 4, true);
    visual.sector(1);
  }
  assert.ok(visual.diagnostics.eventCount <= 10);
  assert.ok(visual.diagnostics.pulseCount <= 8);
  assert.equal(visual.diagnostics.starCount, 108);
  for (let index = 0; index < 20; index++) {
    visual.update(1 / 60);
    visual.setSector(10);
    visual.drawBackground();
    visual.drawAccents();
    visual.drawForeground();
  }
  assert.equal(visual.diagnostics.gradientBuilds, 1);
  visual.setSector(20);
  assert.equal(visual.diagnostics.gradientBuilds, 2);
});

test('reduced motion keeps scenery and feedback geometry still while allowing fade-out', () => {
  const { ctx, commands } = drawing();
  const visual = new SpaceVisuals(ctx, { reducedMotion: true });
  visual.resize(360, 540, 180, 280, 120);
  visual.switchOrbit(0, 0.67, 1);
  visual.collect(0, 1, 25, 1, true);
  visual.crash(1, 0.67);
  const frame = () => {
    commands.length = 0;
    visual.drawBackground(); visual.drawAccents(); visual.drawForeground();
    return commands.map((command) => [...command]);
  };
  const first = frame();
  visual.update(0.1);
  assert.deepEqual(frame(), first);
  visual.update(1);
  assert.equal(visual.diagnostics.eventCount, 0);
  assert.equal(visual.diagnostics.pulseCount, 0);
});
