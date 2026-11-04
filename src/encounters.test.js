import test from 'node:test';
import assert from 'node:assert/strict';
import { difficultyAt, INNER_RADIUS, OUTER_RADIUS } from './logic.js';
import { planWave, perfectSwitchFor } from './encounters.js';

test('the first three waves teach a single safe encounter before cross and stream patterns', () => {
  for (let wave = 1; wave <= 3; wave++) {
    for (const roll of [0, 0.49, 0.5, 1]) {
      const plan = planWave(wave, 0, 0, roll);
      assert.equal(plan.kind, 'single');
      assert.equal(plan.label, '단일 접근');
      assert.equal(plan.encounters.length, 1);
      assert.equal(plan.encounters[0].energyCount, 1);
      assert.equal(plan.encounters[0].after, 0);
      assert.equal(plan.interval, difficultyAt(0).interval);
      if (wave === 1) assert.equal(plan.encounters[0].lane, 0);
      if (wave === 3) assert.equal(plan.encounters[0].lane, 1);
    }
  }
  assert.equal(planWave(2, 0, 0, 0.49).encounters[0].lane, 0);
  assert.equal(planWave(2, 0, 0, 0.5).encounters[0].lane, 1);
});

test('cross waves alternate hazards with enough room before the next wave; streams reward one safe lane', () => {
  const cross = planWave(4, 120, 0, 0.2);
  assert.equal(cross.kind, 'cross');
  assert.equal(cross.label, '교차 2연타');
  assert.deepEqual(cross.encounters, [{ after: 0, lane: 0, energyCount: 1 }, { after: 0.72, lane: 1, energyCount: 1 }]);
  assert.equal(cross.interval, 1.5);
  const stream = planWave(6, 120, 1, 0.9);
  assert.equal(stream.kind, 'stream');
  assert.equal(stream.label, '에너지 흐름');
  assert.deepEqual(stream.encounters, [{ after: 0, lane: 0, energyCount: 3 }]);
  assert.equal(stream.interval, 0.78);
  assert.equal(planWave(12, 120, 1, 0.9).encounters[0].lane, 0);
});

test('queued encounters remain ordered and leave one clear lane across long late-game schedules', () => {
  for (let seed = 1; seed <= 24; seed++) {
    let state = seed;
    let nextWaveAt = 120;
    let lastAt = -Infinity;
    let previousHazard = 0;
    for (let wave = 1; wave <= 120; wave++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const plan = planWave(wave, nextWaveAt, previousHazard, state / 4294967296);
      let previousAfter = -Infinity;
      for (const encounter of plan.encounters) {
        const arrivesAt = nextWaveAt + encounter.after;
        assert.ok(encounter.after > previousAfter);
        assert.ok(arrivesAt - lastAt >= 0.72 - 1e-9);
        assert.ok(encounter.lane === 0 || encounter.lane === 1);
        assert.notEqual(1 - encounter.lane, encounter.lane, 'the other orbit remains a clear escape route');
        assert.ok(encounter.energyCount === 1 || encounter.energyCount === 3);
        previousAfter = encounter.after;
        lastAt = arrivesAt;
      }
      assert.ok(nextWaveAt + plan.interval - lastAt >= 0.78 - 1e-9);
      previousHazard = plan.encounters.at(-1).lane;
      nextWaveAt += plan.interval;
    }
  }
});

test('plans are repeatable without ambient RNG and do not share mutable descriptors', () => {
  const first = planWave(8, 45, 1, 0.3);
  const second = planWave(8, 45, 1, 0.3);
  assert.deepEqual(first, second);
  first.encounters[0].lane = 1;
  first.encounters.pop();
  assert.equal(second.encounters.length, 2);
  assert.equal(second.encounters[0].lane, 0);
  const previousRandom = Math.random;
  try {
    Math.random = () => { throw new Error('planner must only consume the provided roll'); };
    assert.deepEqual(second, planWave(8, 45, 1, 0.3));
  } finally { Math.random = previousRandom; }
});

test('perfect switching accepts the inclusive final timing window on either occupied orbit', () => {
  for (const speed of [1, 1.4, 1.8]) {
    for (const hazardLane of [0, 1]) {
      const encounter = { speed, hazardLane, fromLane: hazardLane, toLane: 1 - hazardLane, shipRadius: hazardLane === 0 ? INNER_RADIUS : OUTER_RADIUS };
      for (const time of [0.16, 0.24, 0.36]) assert.equal(perfectSwitchFor({ ...encounter, gap: (speed + 0.48) * time }), true);
      for (const time of [0.1, 0.159, 0.361, 0.5]) assert.equal(perfectSwitchFor({ ...encounter, gap: (speed + 0.48) * time }), false);
    }
  }
});

test('early, late, wrong-direction, already switching and malformed perfect candidates are rejected', () => {
  const candidate = { gap: (1.8 + 0.48) * 0.24, speed: 1.8, fromLane: 0, toLane: 1, hazardLane: 0, shipRadius: INNER_RADIUS };
  for (const change of [
    { gap: 0 }, { gap: -0.1 }, { gap: Infinity }, { gap: NaN },
    { speed: 0 }, { speed: -1 }, { speed: Infinity },
    { fromLane: 1 }, { toLane: 0 }, { hazardLane: 1 },
    { fromLane: 0.5 }, { toLane: '1' }, { hazardLane: null },
    { shipRadius: 0.835 }, { shipRadius: Infinity }, { shipRadius: NaN }
  ]) assert.equal(perfectSwitchFor({ ...candidate, ...change }), false);
  assert.equal(perfectSwitchFor(), false);
  assert.equal(perfectSwitchFor(null), false);
  assert.equal(perfectSwitchFor({ ...candidate, shipRadius: INNER_RADIUS + 0.1 }), true);
  assert.equal(perfectSwitchFor({ ...candidate, shipRadius: INNER_RADIUS + 0.1001 }), false);
});
