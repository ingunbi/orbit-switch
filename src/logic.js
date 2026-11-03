export const INNER_RADIUS = 0.67;
export const OUTER_RADIUS = 1;
export const SHIP_RADIUS = 0.047;

export function multiplierFor(chain) {
  return Math.min(4, 1 + Math.floor(chain / 3));
}

// Use actual radial position during a switch, so passing safely between tracks
// behaves the same as what the player sees on screen.
export function intersectsOrbit(shipRadius, gap, objectLane, objectRadius = 0.06) {
  const objectOrbit = objectLane === 0 ? INNER_RADIUS : OUTER_RADIUS;
  const distanceSquared = shipRadius ** 2 + objectOrbit ** 2 - 2 * shipRadius * objectOrbit * Math.cos(gap);
  return distanceSquared <= (SHIP_RADIUS + objectRadius) ** 2;
}

export function difficultyAt(seconds) {
  return {
    speed: Math.min(1.8, 1 + seconds * 0.009),
    interval: Math.max(0.78, 1.52 - seconds * 0.008),
    sector: 1 + Math.floor(seconds / 20)
  };
}
