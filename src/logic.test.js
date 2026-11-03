import test from 'node:test';
import assert from 'node:assert/strict';
import { difficultyAt, intersectsOrbit, multiplierFor } from './logic.js';

test('a debris encounter can be escaped by choosing the other orbit', () => {
  assert.equal(intersectsOrbit(0.67, 0, 0), true);
  assert.equal(intersectsOrbit(1, 0, 0), false);
  assert.equal(intersectsOrbit(1, 0, 1), true);
  assert.equal(intersectsOrbit(0.67, 0, 1), false);
});

test('collision respects the visible flight path during a switch', () => {
  assert.equal(intersectsOrbit(0.835, 0, 0), false);
  assert.equal(intersectsOrbit(0.835, 0, 1), false);
  assert.equal(intersectsOrbit(0.67, Math.PI, 0), false);
});

test('difficulty stays bounded and collection rewards plateau at four times', () => {
  assert.equal(multiplierFor(0), 1);
  assert.equal(multiplierFor(3), 2);
  assert.equal(multiplierFor(9), 4);
  assert.equal(multiplierFor(100), 4);
  const late = difficultyAt(600);
  assert.equal(late.speed, 1.8);
  assert.equal(late.interval, 0.78);
  assert.ok(difficultyAt(40).speed > difficultyAt(0).speed);
});
