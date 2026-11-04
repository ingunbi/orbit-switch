import test from 'node:test';
import assert from 'node:assert/strict';
import { SpaceVisuals, themeAt } from './visuals.js';

function drawing() {
  const commands = [];
  const properties = { globalAlpha: 1 };
  const ctx = new Proxy({}, {
    get: (_, key) => key in properties ? properties[key] : /^create(Radial|Linear)Gradient$/.test(key)
      ? () => ({ addColorStop() {} })
      : (...args) => commands.push([key, ...args]),
    set: (_, key, value) => { properties[key] = value; return true; }
  });
  return { ctx, commands, properties };
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

test('theme crossfade pauses, blends planet colors and holds at most two cached gradient sets', () => {
  const { ctx } = drawing();
  const visual = new SpaceVisuals(ctx);
  visual.resize(900, 650, 450, 338, 210);
  const first = visual.palette;
  visual.setSector(20);
  assert.equal(visual.palette.accent, first.accent);
  assert.equal(visual.palette.planetMid, first.planetMid);
  assert.equal(visual.palette.sector, 2);
  assert.equal(visual.diagnostics.gradientSetCount, 2);
  visual.update(1.1);
  assert.notEqual(visual.palette.accent, first.accent);
  assert.notEqual(visual.palette.accent, themeAt(20).accent);
  assert.notEqual(visual.palette.planetMid, first.planetMid);
  const paused = { palette: visual.palette, diagnostics: visual.diagnostics };
  visual.update(5, false);
  assert.deepEqual({ palette: visual.palette, diagnostics: visual.diagnostics }, paused);
  visual.resize(360, 540, 180, 280, 120);
  assert.equal(visual.diagnostics.gradientSetCount, 2);
  assert.deepEqual(visual.palette, paused.palette);
  const builds = visual.diagnostics.gradientBuilds;
  for (let frame = 0; frame < 10; frame++) visual.drawBackground();
  assert.equal(visual.diagnostics.gradientBuilds, builds);
  visual.update(1.1);
  assert.deepEqual(visual.palette, themeAt(20));
  assert.equal(visual.diagnostics.gradientSetCount, 1);
  visual.setSector(40);
  visual.update(0.6);
  const interrupted = visual.palette;
  visual.setSector(60);
  assert.equal(visual.palette.accent, interrupted.accent);
  assert.equal(visual.diagnostics.gradientSetCount, 2);
  visual.reset();
  assert.deepEqual(visual.palette, themeAt(0));
  assert.equal(visual.diagnostics.gradientSetCount, 1);
});

test('live reduced motion freezes current star and aurora positions and clears moving impacts', () => {
  const { ctx, commands } = drawing();
  const visual = new SpaceVisuals(ctx);
  visual.resize(360, 540, 180, 280, 120);
  visual.update(3);
  const scenery = () => {
    commands.length = 0;
    visual.drawBackground(); visual.drawAccents();
    return commands.map((command) => [...command]);
  };
  const before = scenery();
  visual.collect(0.2, 1, 100, 4, true);
  visual.crash(0.3, 1);
  visual.setReducedMotion(true);
  assert.equal(visual.diagnostics.eventCount, 0);
  assert.equal(visual.diagnostics.pulseCount, 0);
  assert.deepEqual(visual.getCameraOffset(), { x: 0, y: 0 });
  visual.update(5);
  assert.deepEqual(scenery(), before);
  assert.equal(visual.diagnostics.motionTime, 3);
  visual.setReducedMotion(false);
  visual.update(0.1);
  assert.notDeepEqual(scenery(), before);
});

test('signal intensity is bounded and decorative meteor activity never grows a queue or gradient work', () => {
  const { ctx } = drawing();
  const visual = new SpaceVisuals(ctx);
  visual.resize(360, 540, 180, 280, 120);
  visual.setSignal(100);
  assert.equal(visual.diagnostics.signal, 4);
  visual.setSignal(-1);
  assert.equal(visual.diagnostics.signal, 1);
  visual.setSignal(NaN);
  assert.equal(visual.diagnostics.signal, 1);
  visual.setSignal(4);
  let sawMeteor = false;
  for (let frame = 0; frame < 1200; frame++) {
    visual.update(0.1);
    assert.ok(visual.diagnostics.meteorCount <= 1);
    sawMeteor ||= visual.diagnostics.meteorCount === 1;
  }
  assert.equal(sawMeteor, true);
  assert.equal(visual.diagnostics.gradientBuilds, 1);
  visual.setReducedMotion(true);
  assert.equal(visual.diagnostics.meteorCount, 0);
  visual.update(20);
  assert.equal(visual.diagnostics.meteorCount, 0);
  visual.reset();
  assert.equal(visual.diagnostics.signal, 1);
});

test('impact shake stays below three pixels, decays quickly and is absent with reduced motion', () => {
  const { ctx } = drawing();
  const visual = new SpaceVisuals(ctx);
  visual.crash(0.5, 1);
  for (let frame = 0; frame < 25; frame++) {
    const offset = visual.getCameraOffset();
    assert.ok(Math.abs(offset.x) <= 3 && Math.abs(offset.y) <= 3);
    visual.update(0.01);
  }
  const tail = visual.getCameraOffset();
  assert.ok(Math.abs(tail.x) < 0.04 && Math.abs(tail.y) < 0.04);
  visual.update(0.1);
  assert.deepEqual(visual.getCameraOffset(), { x: 0, y: 0 });
  visual.setReducedMotion(true);
  visual.crash(0.5, 1);
  assert.deepEqual(visual.getCameraOffset(), { x: 0, y: 0 });
});

test('nebula surfaces are reused through rendering and resize while planet clouds remain clipped', () => {
  const { ctx, commands } = drawing();
  const surfaces = [];
  const surfaceFactory = (width, height) => {
    const surface = { width, height, pixels: null, getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image) => { surface.pixels = image.data; }
    }) };
    surfaces.push(surface);
    return surface;
  };
  const visual = new SpaceVisuals(ctx, { surfaceFactory });
  visual.resize(360, 540, 180, 280, 120);
  assert.equal(surfaces.length, 2);
  assert.equal(visual.diagnostics.planetTextureCount, 1);
  commands.length = 0;
  visual.drawBackground();
  assert.ok(commands.some(([operation, surface]) => operation === 'drawImage' && surface === surfaces[1]));
  commands.length = 0;
  visual.drawPlanetClouds(46);
  assert.ok(commands.findIndex(([operation]) => operation === 'clip') < commands.findIndex(([operation]) => operation === 'drawImage'));
  assert.ok(commands.some(([operation, x, y, radius]) => operation === 'arc' && x === 180 && y === 280 && radius === 46));
  assert.equal(commands.filter(([operation, surface]) => operation === 'drawImage' && surface === surfaces[0]).length, 2);
  visual.resize(900, 650, 450, 338, 210);
  for (let frame = 0; frame < 20; frame++) {
    visual.update(1 / 60); visual.drawBackground(); visual.drawPlanetClouds(80);
  }
  assert.equal(surfaces.length, 2);
  visual.setSector(20);
  assert.equal(surfaces.length, 3);
  visual.resize(360, 540, 180, 280, 120);
  assert.equal(surfaces.length, 3);
  assert.equal(visual.diagnostics.textureCacheSize, 2);
  assert.equal(visual.diagnostics.gradientSetCount, 2);
  visual.update(2.2);
  visual.setSector(40);
  assert.equal(visual.diagnostics.textureCacheSize, 2);
  assert.equal(visual.diagnostics.planetTextureCount, 1);
});

test('unsupported texture surfaces keep the gradient scene working without rebuilding per frame', () => {
  const { ctx, commands } = drawing();
  const visual = new SpaceVisuals(ctx, { surfaceFactory: () => null });
  visual.resize(360, 540, 180, 280, 120);
  for (let frame = 0; frame < 20; frame++) {
    visual.update(1 / 60); visual.drawBackground(); visual.drawPlanetClouds(45);
  }
  assert.equal(commands.some(([operation]) => operation === 'drawImage'), false);
  assert.ok(commands.some(([operation]) => operation === 'fillRect'));
  assert.equal(visual.diagnostics.planetTextureCount, 0);
  assert.equal(visual.diagnostics.textureBuilds, 2);
});

test('launch warp ends before encounters and reduced motion uses a static short highlight', () => {
  const { ctx, commands } = drawing();
  const visual = new SpaceVisuals(ctx, { surfaceFactory: () => null });
  visual.resize(360, 540, 180, 280, 120);
  visual.launch(-Math.PI / 2, 0.67);
  assert.equal(visual.diagnostics.launchCount, 1);
  visual.update(0.2);
  visual.drawForeground();
  assert.ok(commands.filter(([operation]) => operation === 'lineTo').length >= 10);
  const paused = visual.diagnostics;
  visual.update(1, false);
  assert.deepEqual(visual.diagnostics, paused);
  visual.update(0.56);
  assert.equal(visual.diagnostics.launchCount, 0);
  visual.setReducedMotion(true);
  visual.launch(-Math.PI / 2, 0.67);
  commands.length = 0;
  visual.drawForeground();
  const first = commands.map((command) => [...command]);
  assert.equal(commands.some(([operation]) => operation === 'lineTo'), false);
  visual.update(0.1);
  commands.length = 0;
  visual.drawForeground();
  assert.deepEqual(commands, first);
  visual.update(0.15);
  assert.equal(visual.diagnostics.launchCount, 0);
});

test('energy target is finite, survives reset and scales the three absorption motes on resize', () => {
  const { ctx, commands } = drawing();
  const visual = new SpaceVisuals(ctx, { surfaceFactory: () => null });
  visual.setEnergyTarget(-5, 8);
  assert.deepEqual(visual.diagnostics.energyTarget, { x: 0, y: 1 });
  visual.setEnergyTarget(NaN, Infinity);
  assert.deepEqual(visual.diagnostics.energyTarget, { x: 0, y: 1 });
  visual.setEnergyTarget(0.9, 0.1);
  visual.reset();
  assert.deepEqual(visual.diagnostics.energyTarget, { x: 0.9, y: 0.1 });
  visual.resize(200, 300, 100, 150, 80);
  visual.collect(0, 1, 25, 1);
  assert.equal(visual.diagnostics.moteCount, 3);
  visual.update(0.64);
  visual.drawForeground();
  const firstMote = commands.filter(([operation]) => operation === 'arc').slice(-3)[0];
  assert.ok(Math.hypot(firstMote[1] - 180, firstMote[2] - 30) < 30);
  commands.length = 0;
  visual.resize(400, 600, 200, 300, 160);
  visual.drawForeground();
  const resizedMote = commands.filter(([operation]) => operation === 'arc').slice(-3)[0];
  assert.ok(Math.abs(resizedMote[1] - firstMote[1] * 2) < 0.001);
  assert.ok(Math.abs(resizedMote[2] - firstMote[2] * 2) < 0.001);
  visual.update(0.18);
  assert.equal(visual.diagnostics.moteCount, 0);
  assert.equal(visual.diagnostics.eventCount, 1);
  visual.update(0.1);
  assert.equal(visual.diagnostics.eventCount, 0);
  visual.setReducedMotion(true);
  visual.collect(0, 1, 25, 1);
  assert.equal(visual.diagnostics.moteCount, 0);
});

test('rapid launch and collection feedback keeps at most thirty motes and ten shared events', () => {
  const { ctx } = drawing();
  const visual = new SpaceVisuals(ctx, { surfaceFactory: () => null });
  visual.resize(360, 540, 180, 280, 120);
  for (let index = 0; index < 200; index++) {
    visual.launch(index, 0.67);
    visual.collect(index, 1, 100, 4);
  }
  assert.ok(visual.diagnostics.moteCount <= 30);
  assert.ok(visual.diagnostics.eventCount <= 10);
  const textureBuilds = visual.diagnostics.textureBuilds;
  for (let frame = 0; frame < 60; frame++) {
    visual.update(1 / 60); visual.drawForeground();
  }
  assert.equal(visual.diagnostics.moteCount, 0);
  assert.equal(visual.diagnostics.launchCount, 0);
  assert.equal(visual.diagnostics.eventCount, 0);
  assert.equal(visual.diagnostics.textureBuilds, textureBuilds);
});

test('perfect and shield feedback freeze together, expire independently and never shake the world', () => {
  const { ctx } = drawing();
  const visual = new SpaceVisuals(ctx, { surfaceFactory: () => null });
  visual.resize(360, 540, 180, 280, 120);
  visual.perfect(0.2, 1);
  visual.shieldBreak(0.2, 1);
  visual.shieldReady();
  assert.equal(visual.diagnostics.eventCount, 2);
  assert.equal(visual.diagnostics.pulseCount, 1);
  const paused = visual.diagnostics;
  visual.update(1, false);
  assert.deepEqual(visual.diagnostics, paused);
  assert.deepEqual(visual.getCameraOffset(), { x: 0, y: 0 });
  visual.update(0.44);
  visual.drawForeground();
  assert.equal(visual.diagnostics.eventCount, 2);
  visual.update(0.02);
  assert.equal(visual.diagnostics.eventCount, 1);
  visual.update(0.1);
  assert.equal(visual.diagnostics.eventCount, 0);
  assert.equal(visual.diagnostics.pulseCount, 1);
  visual.update(0.15);
  assert.equal(visual.diagnostics.pulseCount, 0);
  assert.deepEqual(visual.getCameraOffset(), { x: 0, y: 0 });
});

test('ship shield aura follows world coordinates, preserves caller-owned grace and clears on reset', () => {
  const { ctx, commands } = drawing();
  const visual = new SpaceVisuals(ctx, { surfaceFactory: () => null });
  visual.resize(360, 540, 180, 280, 120);
  visual.drawShipAura(0, 1);
  assert.equal(commands.length, 0);
  visual.setShield(true);
  visual.drawShipAura(0, 1);
  const arcs = commands.filter(([operation]) => operation === 'arc');
  assert.ok(arcs.length >= 2);
  assert.ok(arcs.every(([, x, y, radius]) => x === 300 && y === 280 && radius < 15));
  visual.setShield(false, 0.5);
  const before = visual.diagnostics.shield;
  visual.update(0.3);
  assert.deepEqual(visual.diagnostics.shield, before);
  commands.length = 0;
  visual.drawShipAura(0, 1);
  assert.equal(commands.filter(([operation]) => operation === 'arc').length, 2);
  visual.setShield(false, Infinity);
  assert.deepEqual(visual.diagnostics.shield, { active: false, grace: 0 });
  commands.length = 0;
  visual.drawShipAura(0, 1);
  assert.equal(commands.length, 0);
  visual.setShield(true, 100);
  assert.equal(visual.diagnostics.shield.grace, 1);
  visual.reset();
  assert.deepEqual(visual.diagnostics.shield, { active: false, grace: 0 });
});

test('reduced motion keeps perfect and barrier feedback still and grace outline brightness steady', () => {
  const { ctx, commands, properties } = drawing();
  const visual = new SpaceVisuals(ctx, { reducedMotion: true, surfaceFactory: () => null });
  visual.resize(360, 540, 180, 280, 120);
  visual.perfect(0.3, 1);
  visual.shieldBreak(0.3, 1);
  visual.shieldReady();
  visual.setShield(false, 0.5);
  const frame = () => {
    commands.length = 0;
    visual.drawForeground(); visual.drawShipAura(0.3, 1);
    return { commands: commands.map((command) => [...command]), brightness: properties.globalAlpha };
  };
  const first = frame();
  visual.update(0.1);
  assert.deepEqual(frame(), first);
  assert.deepEqual(visual.getCameraOffset(), { x: 0, y: 0 });
  visual.update(0.21);
  assert.equal(visual.diagnostics.eventCount, 0);
  assert.equal(visual.diagnostics.pulseCount, 0);
  visual.setReducedMotion(false);
  visual.setShield(true);
  visual.perfect(0.2, 1); visual.shieldBreak(0.2, 1); visual.shieldReady();
  visual.setReducedMotion(true);
  assert.equal(visual.diagnostics.eventCount, 0);
  assert.equal(visual.diagnostics.pulseCount, 0);
  assert.equal(visual.diagnostics.shield.active, true);
});

test('new shield and timing effects share existing event budgets and avoid texture work', () => {
  const { ctx } = drawing();
  const visual = new SpaceVisuals(ctx, { surfaceFactory: () => null });
  visual.resize(360, 540, 180, 280, 120);
  const builds = visual.diagnostics.textureBuilds;
  for (let index = 0; index < 200; index++) {
    visual.perfect(index, 1);
    visual.shieldBreak(index, 1);
    visual.collect(index, 1, 100, 4, true);
    visual.shieldReady();
  }
  assert.ok(visual.diagnostics.eventCount <= 10);
  assert.ok(visual.diagnostics.pulseCount <= 8);
  assert.ok(visual.diagnostics.moteCount <= 30);
  visual.drawForeground();
  visual.update(1.2);
  assert.equal(visual.diagnostics.eventCount, 0);
  assert.equal(visual.diagnostics.pulseCount, 0);
  assert.equal(visual.diagnostics.textureBuilds, builds);
});
