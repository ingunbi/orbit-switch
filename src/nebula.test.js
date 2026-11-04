import test from 'node:test';
import assert from 'node:assert/strict';
import { nebulaPixels, createNebulaTexture } from './nebula.js';

test('nebula gas is deterministic, seed-dependent and independent of ambient randomness', () => {
  const first = nebulaPixels(48, 17, '#7bdce8');
  assert.deepEqual(first, nebulaPixels(48, 17, '#7bdce8'));
  assert.notDeepEqual(first, nebulaPixels(48, 18, '#7bdce8'));
  const previousRandom = Math.random;
  try {
    Math.random = () => { throw new Error('game RNG must not be sampled'); };
    assert.deepEqual(first, nebulaPixels(48, 17, '#7bdce8'));
  } finally { Math.random = previousRandom; }
});

test('gas has transparent space, broad soft clouds and brighter filaments with fixed RGB', () => {
  const side = 192;
  const pixels = nebulaPixels(side, 0x9e3779b9, '#84e6c5');
  let transparent = 0, visible = 0, bright = 0;
  let largestStep = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const index = (y * side + x) * 4;
      assert.equal(pixels[index], 0x84);
      assert.equal(pixels[index + 1], 0xe6);
      assert.equal(pixels[index + 2], 0xc5);
      const alpha = pixels[index + 3];
      assert.ok(alpha >= 0 && alpha <= 170);
      if (alpha === 0) transparent += 1;
      if (alpha > 15) visible += 1;
      if (alpha > 110) bright += 1;
      if (x > 0) largestStep = Math.max(largestStep, Math.abs(alpha - pixels[index - 1]));
      if (y > 0) largestStep = Math.max(largestStep, Math.abs(alpha - pixels[index - side * 4 + 3]));
    }
  }
  assert.ok(transparent > side * side * 0.1);
  assert.ok(visible > side * side * 0.1);
  assert.ok(bright > side * side * 0.002);
  assert.ok(largestStep < 60, 'cloud shading remains smooth instead of isolated bright star pixels');
});

test('both APIs use the same bounded size normalization and invalid colors fall back to white', () => {
  for (const [input, expected] of [[0, 16], [18.6, 19], [400, 256], [NaN, 192], [Infinity, 192], ['32', 192]]) {
    let dimensions;
    assert.equal(createNebulaTexture({ size: input, surfaceFactory: (width, height) => { dimensions = [width, height]; return null; } }), null);
    assert.deepEqual(dimensions, [expected, expected]);
  }
  assert.equal(nebulaPixels(0).length, 16 * 16 * 4);
  assert.equal(nebulaPixels(18.6).length, 19 * 19 * 4);
  assert.equal(nebulaPixels(400).length, 256 * 256 * 4);
  const white = nebulaPixels(16, 1, '#abc');
  assert.deepEqual(Array.from(white.slice(0, 3)), [255, 255, 255]);
});

test('texture creation uploads RGBA pixels to the supplied canvas exactly once', () => {
  let upload;
  let uploads = 0;
  const surface = {
    getContext(kind) {
      assert.equal(kind, '2d');
      return {
        createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
        putImageData(image, x, y) { uploads += 1; upload = image.data; assert.deepEqual([x, y], [0, 0]); }
      };
    }
  };
  const result = createNebulaTexture({ size: 32, seed: 7, color: '#b7a4ed', surfaceFactory: (width, height) => { assert.deepEqual([width, height], [32, 32]); return surface; } });
  assert.equal(result, surface);
  assert.deepEqual([surface.width, surface.height], [32, 32]);
  assert.equal(uploads, 1);
  assert.deepEqual(upload, nebulaPixels(32, 7, '#b7a4ed'));
});

test('unavailable or failing surfaces and pixel upload APIs gracefully return null', () => {
  const factories = [
    () => null,
    () => { throw new Error('device unavailable'); },
    () => ({}),
    () => ({ getContext() { throw new Error('context unavailable'); } }),
    () => ({ getContext: () => ({}) }),
    () => ({ getContext: () => ({ createImageData: () => ({}), putImageData() {} }) }),
    () => ({ getContext: () => ({ createImageData() { throw new Error('allocation failed'); }, putImageData() {} }) }),
    () => ({ getContext: () => ({ createImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4) }), putImageData() { throw new Error('upload failed'); } }) })
  ];
  for (const surfaceFactory of factories) assert.equal(createNebulaTexture({ size: 16, surfaceFactory }), null);
  if (typeof globalThis.OffscreenCanvas !== 'function' && !globalThis.document) assert.equal(createNebulaTexture(), null);
});
