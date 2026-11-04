const DEFAULT_SIZE = 192;
const DEFAULT_SEED = 0x9e3779b9;

// Both public entry points round finite numeric sizes, then clamp to 16..256.
// Non-numeric and non-finite values use 192; malformed colors use white.
function normalizedSize(size) {
  return Number.isFinite(size) ? Math.max(16, Math.min(256, Math.round(size))) : DEFAULT_SIZE;
}

function smoothstep(low, high, value) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

function hash(x, y, seed) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = x - ix, ty = y - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fractal(x, y, seed) {
  let sum = 0, weight = 0.5;
  for (let octave = 0; octave < 4; octave++) {
    sum += noise(x, y, seed + Math.imul(octave, 0x6d2b79f5)) * weight;
    x = x * 2.03 + 11.3;
    y = y * 2.03 - 7.1;
    weight *= 0.5;
  }
  return sum / 0.9375;
}

/** Seeded gas and filaments only. RGB stays fixed; alpha is bounded to 0..170. */
export function nebulaPixels(size = DEFAULT_SIZE, seed = DEFAULT_SEED, color = '#ffffff') {
  const side = normalizedSize(size);
  const stableSeed = Number.isFinite(seed) ? seed >>> 0 : DEFAULT_SEED;
  const hex = typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color : '#ffffff';
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const pixels = new Uint8ClampedArray(side * side * 4);
  const angle = hash(5, 17, stableSeed) * Math.PI;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const phase = hash(31, 7, stableSeed) * Math.PI * 2;
  const offsetX = hash(11, 23, stableSeed) * 20;
  const offsetY = hash(19, 37, stableSeed) * 20;

  for (let y = 0; y < side; y++) {
    const v = (y + 0.5) / side * 2 - 1;
    const verticalFade = 1 - smoothstep(0.62, 0.98, Math.abs(v));
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) / side * 2 - 1;
      const along = u * cosine + v * sine;
      const across = v * cosine - u * sine;
      const warpX = noise(u * 1.7 + 13.2, v * 1.7 - 4.6, stableSeed ^ 0x68bc21eb) - 0.5;
      const warpY = noise(u * 1.7 - 5.3, v * 1.7 + 9.1, stableSeed ^ 0x02e5be93) - 0.5;
      const nx = u * 2.7 + offsetX + warpX * 1.7;
      const ny = v * 2.7 + offsetY + warpY * 1.7;
      const density = fractal(nx, ny, stableSeed);
      const ridge = 1 - Math.abs(noise(nx * 1.4 + 2.5, ny * 1.4 - 3.7, stableSeed ^ 0x967a889b) * 2 - 1);
      const gas = smoothstep(0.23, 0.73, density);
      const filament = smoothstep(0.66, 0.98, ridge) * smoothstep(0.3, 0.62, density);
      const center = 0.22 * Math.sin(along * 2.8 + phase) + warpY * 0.3;
      const band = Math.exp(-(((across - center) / 0.48) ** 2));
      const edge = verticalFade * (1 - smoothstep(0.62, 0.98, Math.abs(u)));
      const alpha = Math.min(170, Math.max(0, Math.round((gas * 92 + filament * 103) * band * edge)));
      const index = (y * side + x) * 4;
      pixels[index] = red;
      pixels[index + 1] = green;
      pixels[index + 2] = blue;
      pixels[index + 3] = alpha;
    }
  }
  return pixels;
}

function defaultSurfaceFactory(width, height) {
  try {
    if (typeof globalThis.OffscreenCanvas === 'function') return new globalThis.OffscreenCanvas(width, height);
  } catch { /* Try an ordinary canvas if the offscreen device is unavailable. */ }
  try {
    const surface = globalThis.document?.createElement?.('canvas');
    if (!surface) return null;
    surface.width = width;
    surface.height = height;
    return surface;
  } catch { return null; }
}

/** Create once per cached theme, then composite with drawImage at render time. */
export function createNebulaTexture({ size = DEFAULT_SIZE, seed = DEFAULT_SEED, color = '#ffffff', surfaceFactory = defaultSurfaceFactory } = {}) {
  const side = normalizedSize(size);
  try {
    const surface = surfaceFactory(side, side);
    if (!surface) return null;
    surface.width = side;
    surface.height = side;
    const context = surface.getContext?.('2d');
    if (typeof context?.createImageData !== 'function' || typeof context?.putImageData !== 'function') return null;
    const image = context.createImageData(side, side);
    if (!image?.data || typeof image.data.set !== 'function') return null;
    image.data.set(nebulaPixels(side, seed, color));
    context.putImageData(image, 0, 0);
    return surface;
  } catch { return null; }
}
