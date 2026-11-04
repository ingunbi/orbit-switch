import { difficultyAt, INNER_RADIUS, OUTER_RADIUS } from './logic.js';

const CROSS_DELAY = 0.72;
const isLane = (lane) => lane === 0 || lane === 1;

// Every call creates fresh descriptors. The caller spawns each encounter with a
// full half-orbit warning, then begins the next wave after the final encounter.
export function planWave(waveNumber, seconds, previousHazard, roll = 0.5) {
  const wave = Number.isFinite(waveNumber) ? Math.max(1, Math.floor(waveNumber)) : 1;
  const elapsed = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const previous = isLane(previousHazard) ? previousHazard : 0;
  const chance = Number.isFinite(roll) ? Math.max(0, Math.min(1, roll)) : 0.5;
  let lane = chance < 0.5 ? 0 : 1;
  if (wave === 1) lane = 0;
  if (wave % 3 === 0) lane = 1 - previous;

  let kind = 'single';
  let label = '단일 접근';
  const encounters = [{ after: 0, lane, energyCount: 1 }];
  if (wave >= 4 && wave % 4 === 0) {
    kind = 'cross';
    label = '교차 2연타';
    encounters.push({ after: CROSS_DELAY, lane: 1 - lane, energyCount: 1 });
  } else if (wave >= 6 && wave % 4 === 2) {
    kind = 'stream';
    label = '에너지 흐름';
    encounters[0].energyCount = 3;
  }
  return { kind, label, encounters, interval: encounters.at(-1).after + difficultyAt(elapsed).interval };
}

// This only marks a candidate. The caller awards it after the rock is safely
// passed, so switching too late into a collision never pays a bonus.
export function perfectSwitchFor(input = {}) {
  if (!input || typeof input !== 'object') return false;
  const { gap, speed, fromLane, toLane, hazardLane, shipRadius } = input;
  if (![gap, speed, shipRadius].every(Number.isFinite) || gap <= 0 || speed < 1 || speed > 1.8) return false;
  if (![fromLane, toLane, hazardLane].every(isLane)) return false;
  if (fromLane !== hazardLane || toLane !== 1 - hazardLane) return false;
  const hazardRadius = hazardLane === 0 ? INNER_RADIUS : OUTER_RADIUS;
  if (Math.abs(shipRadius - hazardRadius) > 0.1 + Number.EPSILON * 4) return false;
  const relativeSpeed = speed + 0.48;
  return gap >= relativeSpeed * 0.16 && gap <= relativeSpeed * 0.36;
}
