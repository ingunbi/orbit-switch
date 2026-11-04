import { createNebulaTexture } from './nebula.js';

const TAU = Math.PI * 2;
const THEMES = [
  { name: '케플러의 새벽', accent: '#84e6c5', planetLight: '#83aa71', planetMid: '#3c6550', planetDark: '#142f28' },
  { name: '청록 성운', accent: '#7bdce8', planetLight: '#78b6b7', planetMid: '#315e68', planetDark: '#132e36' },
  { name: '자수정 성해', accent: '#b7a4ed', planetLight: '#a29ab9', planetMid: '#57516f', planetDark: '#262237' },
  { name: '황금빛 잔광', accent: '#e4c68b', planetLight: '#b5ab75', planetMid: '#696044', planetDark: '#302d22' },
  { name: '오로라 회랑', accent: '#91d7c9', planetLight: '#89bda9', planetMid: '#3d6960', planetDark: '#183832' }
];
const TRANSITION_SECONDS = 2.2;
const COLOR_KEYS = ['accent', 'planetLight', 'planetMid', 'planetDark'];

function mixColor(from, to, progress) {
  const channels = [1, 3, 5].map((start) => {
    const a = Number.parseInt(from.slice(start, start + 2), 16);
    const b = Number.parseInt(to.slice(start, start + 2), 16);
    return Math.round(a + (b - a) * progress).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

export function themeAt(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const sector = 1 + Math.floor(safeSeconds / 20);
  return { sector, ...THEMES[(sector - 1) % THEMES.length] };
}

// Visual randomness is independent of encounter generation.
export class SpaceVisuals {
  constructor(ctx, { reducedMotion = false, surfaceFactory } = {}) {
    this.ctx = ctx;
    this.reducedMotion = reducedMotion;
    this.seed = 0x9e3779b9;
    this.time = 0;
    this.motionTime = 0;
    this.width = 0;
    this.height = 0;
    this.unit = 0;
    this.cx = 0;
    this.cy = 0;
    this.theme = themeAt(0);
    this.previousTheme = null;
    this.transitionTime = TRANSITION_SECONDS;
    this.previousGradients = null;
    this.events = [];
    this.pulses = [];
    this.gradients = null;
    this.gradientBuilds = 0;
    this.signal = 1;
    this.signalStrength = 0;
    this.shieldActive = false;
    this.shieldGrace = 0;
    this.meteor = null;
    this.nextMeteorAt = 7;
    this.surfaceFactory = surfaceFactory;
    this.textureCache = new Map();
    this.textureBuilds = 0;
    this.planetTexture = this.makeTexture('#ffffff', 0xa78452fb);
    this.energyTarget = { x: 0.8, y: 0.075 };
    this.stars = Array.from({ length: 108 }, (_, index) => ({
      x: this.random(), y: this.random(), phase: this.random() * TAU,
      depth: (index % 3 + 1) / 3, size: 0.35 + this.random() * 0.85,
      alpha: 0.17 + this.random() * 0.39, glint: index % 17 === 0
    }));
  }

  random() {
    let value = this.seed;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.seed = value >>> 0;
    return this.seed / 4294967296;
  }

  get diagnostics() {
    return {
      eventCount: this.events.length, pulseCount: this.pulses.length,
      starCount: this.stars.length, time: this.time, sector: this.theme.sector,
      motionTime: this.motionTime, signal: this.signal,
      gradientBuilds: this.gradientBuilds,
      gradientSetCount: Number(!!this.gradients) + Number(!!this.previousGradients),
      transitionProgress: Math.min(1, this.transitionTime / TRANSITION_SECONDS),
      meteorCount: Number(!!this.meteor),
      textureBuilds: this.textureBuilds,
      textureCacheSize: this.textureCache.size,
      planetTextureCount: Number(!!this.planetTexture),
      launchCount: this.events.filter((event) => event.type === 'launch').length,
      shield: { active: this.shieldActive, grace: this.shieldGrace },
      moteCount: this.reducedMotion ? 0 : this.events.reduce((total, event) => total + (event.motes?.filter((mote) => event.age < mote.delay + mote.duration).length || 0), 0),
      energyTarget: { ...this.energyTarget }
    };
  }

  get palette() {
    if (!this.previousTheme) return { ...this.theme };
    const progress = Math.min(1, this.transitionTime / TRANSITION_SECONDS);
    const eased = progress * progress * (3 - 2 * progress);
    const palette = { ...this.theme };
    for (const key of COLOR_KEYS) palette[key] = mixColor(this.previousTheme[key], this.theme[key], eased);
    return palette;
  }

  resize(width, height, cx, cy, unit) {
    this.width = width;
    this.height = height;
    this.cx = cx;
    this.cy = cy;
    this.unit = unit;
    this.buildGradients();
  }

  buildGradients() {
    if (this.width <= 0 || this.height <= 0) return;
    this.gradients = this.gradientSet(this.theme);
    this.previousGradients = this.previousTheme ? this.gradientSet(this.previousTheme) : null;
  }

  gradientSet(theme) {
    if (this.width <= 0 || this.height <= 0) return null;
    const radius = Math.max(this.width, this.height);
    const clouds = [
      [this.width * 0.13, this.height * 0.23, radius * 0.68, '17'],
      [this.width * 0.94, this.height * 0.82, radius * 0.63, '0e'],
      [this.cx, this.cy, this.unit * 1.5, '0e']
    ];
    const gradients = clouds.map(([x, y, size, opacity]) => {
      const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, size);
      gradient.addColorStop(0, theme.accent + opacity);
      gradient.addColorStop(0.45, theme.accent + '07');
      gradient.addColorStop(1, theme.accent + '00');
      return gradient;
    });
    const ribbons = [0, 1].map((index) => {
      const gradient = this.ctx.createLinearGradient(0, this.height * 0.1, this.width, this.height * 0.8);
      gradient.addColorStop(0, theme.accent + '00');
      gradient.addColorStop(0.25 + index * 0.2, theme.accent + '45');
      gradient.addColorStop(0.72, theme.accent + '18');
      gradient.addColorStop(1, theme.accent + '00');
      return gradient;
    });
    this.gradientBuilds += 1;
    return { clouds: gradients, ribbons, texture: this.nebulaTexture(theme.accent) };
  }

  makeTexture(color, seed = 0x5f3759df) {
    this.textureBuilds += 1;
    return createNebulaTexture({ size: 192, seed, color, surfaceFactory: this.surfaceFactory });
  }

  nebulaTexture(color) {
    if (this.textureCache.has(color)) {
      const texture = this.textureCache.get(color);
      this.textureCache.delete(color);
      this.textureCache.set(color, texture);
      return texture;
    }
    const texture = this.makeTexture(color);
    this.textureCache.set(color, texture);
    while (this.textureCache.size > 2) this.textureCache.delete(this.textureCache.keys().next().value);
    return texture;
  }

  setSector(seconds) {
    const next = themeAt(seconds);
    if (next.sector === this.theme.sector) return;
    const visiblePalette = this.palette;
    const interrupted = !!this.previousTheme;
    this.previousTheme = visiblePalette;
    this.previousGradients = interrupted ? this.gradientSet(visiblePalette) : this.gradients;
    this.theme = next;
    this.transitionTime = 0;
    this.gradients = this.gradientSet(next);
  }

  setSignal(multiplier = 1) {
    this.signal = Number.isFinite(multiplier) ? Math.max(1, Math.min(4, Math.floor(multiplier))) : 1;
  }

  setShield(active, grace = 0) {
    this.shieldActive = !!active;
    this.shieldGrace = Number.isFinite(grace) ? Math.max(0, Math.min(1, grace)) : 0;
  }

  setEnergyTarget(x, y) {
    if (Number.isFinite(x)) this.energyTarget.x = Math.max(0, Math.min(1, x));
    if (Number.isFinite(y)) this.energyTarget.y = Math.max(0, Math.min(1, y));
  }

  setReducedMotion(value) {
    const reduced = !!value;
    if (reduced === this.reducedMotion) return;
    this.reducedMotion = reduced;
    // Finishing moving feedback is preferable to snapping it to another position.
    this.events = [];
    this.pulses = [];
    this.meteor = null;
    this.nextMeteorAt = this.motionTime + 8;
  }

  reset() {
    this.events = [];
    this.pulses = [];
    this.time = 0;
    this.motionTime = 0;
    this.signal = 1;
    this.signalStrength = 0;
    this.shieldActive = false;
    this.shieldGrace = 0;
    this.meteor = null;
    this.nextMeteorAt = 7;
    const colorChanged = this.theme.sector !== 1;
    this.theme = themeAt(0);
    this.previousTheme = null;
    this.previousGradients = null;
    this.transitionTime = TRANSITION_SECONDS;
    if (colorChanged) this.gradients = this.gradientSet(this.theme);
  }

  update(dt, animate = true) {
    if (!animate || !Number.isFinite(dt) || dt <= 0) return;
    this.time += dt;
    if (!this.reducedMotion) {
      this.motionTime += dt;
      if (this.meteor) {
        this.meteor.age += dt;
        if (this.meteor.age >= this.meteor.life) {
          this.meteor = null;
          this.nextMeteorAt = this.motionTime + 8 + this.random() * 6;
        }
      } else if (this.motionTime >= this.nextMeteorAt) {
        this.meteor = { x: 0.7 + this.random() * 0.14, y: 0.04 + this.random() * 0.025, age: 0, life: 1.25 };
      }
    }
    this.signalStrength += ((this.signal - 1) / 3 - this.signalStrength) * (1 - Math.exp(-dt * 3));
    if (this.previousTheme) {
      this.transitionTime = Math.min(TRANSITION_SECONDS, this.transitionTime + dt);
      if (this.transitionTime === TRANSITION_SECONDS) {
        this.previousTheme = null;
        this.previousGradients = null;
      }
    }
    for (const event of this.events) event.age += dt;
    for (const pulse of this.pulses) pulse.age += dt;
    this.events = this.events.filter((event) => event.age < event.life);
    this.pulses = this.pulses.filter((pulse) => pulse.age < pulse.life);
  }

  addEvent(event) {
    this.events.push({ age: 0, ...event });
    if (this.events.length > 10) this.events.shift();
  }

  addPulse(pulse) {
    this.pulses.push({ age: 0, ...pulse });
    if (this.pulses.length > 8) this.pulses.shift();
  }

  switchOrbit(angle, fromRadius, toRadius) {
    this.addEvent({ type: 'switch', angle, fromRadius, toRadius, life: this.reducedMotion ? 0.2 : 0.36 });
  }

  launch(angle, radius) {
    const rays = Array.from({ length: this.reducedMotion ? 0 : 14 }, (_, index) => ({
      angle: index * TAU / 14 + this.random() * 0.14,
      start: 0.4 + this.random() * 0.3,
      length: 0.035 + this.random() * 0.08
    }));
    this.addEvent({ type: 'launch', angle, radius, rays, life: this.reducedMotion ? 0.24 : 0.75 });
  }

  collect(angle, radius, points, multiplier, milestone = false) {
    const motes = Array.from({ length: this.reducedMotion ? 0 : 3 }, (_, index) => ({
      delay: index * 0.045, duration: 0.66 + index * 0.03,
      bend: 0.1 + (index - 1) * 0.045 + this.random() * 0.025
    }));
    this.addEvent({ type: 'collect', angle, radius, points, multiplier, motes, life: this.reducedMotion ? 0.5 : 0.9 });
    if (milestone) this.addPulse({ type: 'combo', color: '#c6f477', life: this.reducedMotion ? 0.35 : 1.15 });
  }

  perfect(angle, radius) {
    this.addEvent({ type: 'perfect', angle, radius, life: this.reducedMotion ? 0.24 : 0.55 });
  }

  shieldBreak(angle, radius) {
    const fragments = Array.from({ length: this.reducedMotion ? 0 : 6 }, (_, index) => ({
      angle: index * TAU / 6 + this.random() * 0.15,
      reach: 0.075 + this.random() * 0.035
    }));
    this.addEvent({ type: 'shield-break', angle, radius, fragments, life: this.reducedMotion ? 0.25 : 0.45 });
  }

  shieldReady() {
    this.addPulse({ type: 'shield-ready', color: '#7bdce8', life: this.reducedMotion ? 0.3 : 0.7 });
  }

  crash(angle, radius) {
    const fragments = Array.from({ length: this.reducedMotion ? 0 : 12 }, (_, index) => ({
      angle: index * TAU / 12 + this.random() * 0.25,
      reach: 0.14 + this.random() * 0.22,
      length: 0.025 + this.random() * 0.04
    }));
    this.addEvent({ type: 'crash', angle, radius, fragments, seed: this.random() * TAU, life: this.reducedMotion ? 0.35 : 0.8 });
  }

  getCameraOffset() {
    if (this.reducedMotion) return { x: 0, y: 0 };
    const impact = this.events.findLast((event) => event.type === 'crash' && event.age < 0.28);
    if (!impact) return { x: 0, y: 0 };
    const amplitude = 3 * (1 - impact.age / 0.28) ** 2;
    return {
      x: Math.sin(impact.age * 83 + impact.seed) * amplitude,
      y: Math.cos(impact.age * 91 + impact.seed) * amplitude * 0.75
    };
  }

  sector() {
    this.addPulse({ type: 'sector', color: this.theme.accent, life: this.reducedMotion ? 0.45 : 1.9 });
  }

  circle(x, y, radius) {
    this.ctx.beginPath();
    this.ctx.arc(x, y, Math.max(0, radius), 0, TAU);
  }

  drawBackground() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#071713';
    ctx.fillRect(0, 0, this.width, this.height);
    const progress = this.previousTheme ? Math.min(1, this.transitionTime / TRANSITION_SECONDS) : 1;
    const mix = progress * progress * (3 - 2 * progress);
    if (this.previousGradients) this.drawClouds(this.previousGradients, 1 - mix);
    if (this.gradients) this.drawClouds(this.gradients, mix);
    const palette = this.palette;
    for (const star of this.stars) {
      const drift = this.motionTime * 0.0022 * star.depth;
      const x = ((star.x + drift) % 1) * this.width;
      const y = (star.y + Math.sin(this.motionTime * 0.05 + star.phase) * 0.006 * star.depth) * this.height;
      const twinkle = 0.78 + Math.sin(this.motionTime * 0.8 + star.phase) * 0.22;
      ctx.globalAlpha = star.alpha * twinkle;
      ctx.fillStyle = star.depth === 1 ? '#d3ecdd' : palette.accent;
      this.circle(x, y, star.size * (0.6 + star.depth * 0.55));
      ctx.fill();
      if (star.glint) {
        const length = 2 + star.depth * 2;
        ctx.strokeStyle = '#d3ecdd';
        ctx.lineWidth = 0.6;
        ctx.globalAlpha *= 0.45;
        ctx.beginPath();
        ctx.moveTo(x - length, y); ctx.lineTo(x + length, y);
        ctx.moveTo(x, y - length); ctx.lineTo(x, y + length);
        ctx.stroke();
      }
    }
    this.drawMeteor();
    ctx.restore();
  }

  drawClouds(set, opacity) {
    if (opacity <= 0) return;
    const ctx = this.ctx;
    ctx.globalAlpha = opacity;
    for (const gradient of set.clouds) {
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (set.texture) {
      ctx.save();
      ctx.globalAlpha = opacity * 0.2;
      ctx.globalCompositeOperation = 'screen';
      const x = -this.width * 0.09 + Math.sin(this.motionTime * 0.017) * this.width * 0.018;
      const y = -this.height * 0.09 + Math.cos(this.motionTime * 0.013) * this.height * 0.016;
      ctx.drawImage(set.texture, x, y, this.width * 1.18, this.height * 1.18);
      ctx.restore();
    }
    ctx.lineCap = 'round';
    for (let index = 0; index < 3; index++) {
      const wave = Math.sin(this.motionTime * 0.09 + index * 1.7);
      const y = this.height * (0.15 + index * 0.28);
      ctx.strokeStyle = set.ribbons[index % 2];
      for (let layer = 0; layer < 2; layer++) {
        ctx.globalAlpha = opacity * (layer === 0 ? 0.24 : 0.19);
        ctx.lineWidth = Math.max(12, this.unit * (layer === 0 ? 0.32 : 0.16));
        ctx.beginPath();
        ctx.moveTo(-this.width * 0.08, y + this.height * 0.11);
        ctx.bezierCurveTo(this.width * 0.22, y - this.height * (0.24 + wave * 0.025),
          this.width * 0.72, y + this.height * (0.29 - wave * 0.025), this.width * 1.08, y - this.height * 0.07);
        ctx.stroke();
      }
    }
  }

  drawMeteor() {
    if (!this.meteor || this.reducedMotion) return;
    const ctx = this.ctx;
    const progress = this.meteor.age / this.meteor.life;
    const x = (this.meteor.x - progress * 0.28) * this.width;
    const y = (this.meteor.y + progress * 0.095) * this.height;
    const opacity = Math.sin(progress * Math.PI) * 0.44;
    ctx.strokeStyle = '#cfe7df';
    ctx.lineWidth = 1;
    for (let index = 0; index < 3; index++) {
      const tail = (index + 1) * 0.023;
      ctx.globalAlpha = opacity * (1 - index * 0.28);
      ctx.beginPath();
      ctx.moveTo(x + this.width * tail, y - this.height * tail * 0.34);
      ctx.lineTo(x + this.width * (tail - 0.023), y - this.height * (tail - 0.023) * 0.34);
      ctx.stroke();
    }
  }

  drawAccents() {
    if (!this.unit) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.palette.accent;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.14;
    const rotation = this.motionTime * 0.028;
    for (let index = 0; index < 3; index++) {
      const angle = rotation + index * TAU / 3;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, this.unit * 1.13, angle, angle + 0.23);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.045;
    this.circle(this.cx, this.cy, this.unit * 0.455);
    ctx.stroke();
    if (this.signalStrength > 0.01) {
      ctx.strokeStyle = '#c6f477';
      ctx.globalAlpha = this.signalStrength * 0.16;
      ctx.lineWidth = 1 + this.signalStrength;
      this.circle(this.cx, this.cy, this.unit * 0.48);
      ctx.stroke();
      if (this.signal === 4) {
        ctx.globalAlpha = this.signalStrength * 0.22;
        ctx.lineWidth = 1.1;
        for (let index = 0; index < 3; index++) {
          const start = rotation * 1.7 + index * TAU / 3;
          ctx.beginPath(); ctx.arc(this.cx, this.cy, this.unit * 0.52, start, start + 0.65); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  drawPlanetClouds(radius) {
    if (!this.planetTexture || !Number.isFinite(radius) || radius <= 0) return;
    const ctx = this.ctx;
    ctx.save();
    this.circle(this.cx, this.cy, radius);
    ctx.clip();
    ctx.globalAlpha = 0.15;
    ctx.globalCompositeOperation = 'screen';
    const span = radius * 3;
    const offset = (this.motionTime * 0.008 % 1) * span;
    const x = this.cx - span / 2 + offset;
    const y = this.cy - radius * 1.4 + Math.sin(this.motionTime * 0.035) * radius * 0.08;
    ctx.drawImage(this.planetTexture, x - span, y, span, radius * 2.8);
    ctx.drawImage(this.planetTexture, x, y, span, radius * 2.8);
    ctx.restore();
  }

  drawShipAura(angle, radius) {
    if (!this.unit || (!this.shieldActive && this.shieldGrace <= 0)) return;
    const ctx = this.ctx;
    const x = this.cx + Math.cos(angle) * radius * this.unit;
    const y = this.cy + Math.sin(angle) * radius * this.unit;
    const size = Math.max(11, this.unit * 0.078);
    ctx.save();
    ctx.strokeStyle = '#7bdce8';
    ctx.lineWidth = 1;
    if (this.shieldGrace > 0) {
      ctx.globalAlpha = this.reducedMotion ? 0.62 : 0.42 + Math.sin(this.motionTime * 16) ** 2 * 0.28;
      const start = angle + Math.PI / 2;
      for (let index = 0; index < 2; index++) {
        ctx.beginPath(); ctx.arc(x, y, size * 0.9, start + index * Math.PI - 0.65, start + index * Math.PI + 0.65); ctx.stroke();
      }
    } else {
      ctx.globalAlpha = 0.48;
      ctx.shadowColor = '#7bdce8';
      ctx.shadowBlur = 5;
      this.circle(x, y, size);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = '#c4faff';
      ctx.beginPath(); ctx.arc(x, y, size + 1.8, angle + Math.PI / 2 - 0.58, angle + Math.PI / 2 + 0.58); ctx.stroke();
    }
    ctx.restore();
  }

  drawLaunch(event, progress) {
    const ctx = this.ctx;
    const x = this.cx + Math.cos(event.angle) * event.radius * this.unit;
    const y = this.cy + Math.sin(event.angle) * event.radius * this.unit;
    ctx.strokeStyle = '#c8f8e5';
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = (1 - progress) * 0.7;
    this.circle(x, y, this.unit * (this.reducedMotion ? 0.055 : 0.028 + progress * 0.1));
    ctx.stroke();
    if (this.reducedMotion) return;
    const acceleration = 1 - (1 - progress) ** 2;
    ctx.lineWidth = 0.8;
    for (const ray of event.rays) {
      const distance = this.unit * (ray.start + acceleration * 0.64);
      const length = this.unit * ray.length * (0.35 + Math.sin(progress * Math.PI));
      ctx.globalAlpha = (1 - progress) ** 1.6 * 0.48;
      ctx.beginPath();
      ctx.moveTo(this.cx + Math.cos(ray.angle) * distance, this.cy + Math.sin(ray.angle) * distance);
      ctx.lineTo(this.cx + Math.cos(ray.angle) * (distance - length), this.cy + Math.sin(ray.angle) * (distance - length));
      ctx.stroke();
    }
  }

  drawSwitch(event, progress) {
    const ctx = this.ctx;
    const angle = event.angle;
    const from = event.fromRadius * this.unit;
    const to = event.toRadius * this.unit;
    ctx.strokeStyle = '#84e6c5';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = (1 - progress) * 0.7;
    const x = this.cx + Math.cos(angle) * from;
    const y = this.cy + Math.sin(angle) * from;
    this.circle(x, y, this.unit * 0.033);
    ctx.stroke();
    if (this.reducedMotion) return;
    ctx.shadowColor = '#84e6c5';
    ctx.shadowBlur = 10;
    const middle = (from + to) / 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(this.cx + Math.cos(angle - 0.11) * middle, this.cy + Math.sin(angle - 0.11) * middle,
      this.cx + Math.cos(angle + 0.04) * to, this.cy + Math.sin(angle + 0.04) * to);
    ctx.stroke();
  }

  drawCollect(event, progress) {
    const ctx = this.ctx;
    const x = this.cx + Math.cos(event.angle) * event.radius * this.unit;
    const y = this.cy + Math.sin(event.angle) * event.radius * this.unit;
    const expansion = this.reducedMotion ? 0 : 1 - (1 - progress) ** 3;
    const charge = Math.max(0, Math.min(1, (event.multiplier - 1) / 3));
    ctx.globalAlpha = (1 - progress) * (0.75 + charge * 0.2);
    ctx.strokeStyle = '#c6f477';
    ctx.lineWidth = 1.2 + charge * 0.65;
    this.circle(x, y, this.unit * (0.035 + expansion * 0.12));
    ctx.stroke();
    if (charge > 0 && !this.reducedMotion) {
      ctx.globalAlpha *= charge * 0.55;
      this.circle(x, y, this.unit * (0.025 + expansion * 0.19));
      ctx.stroke();
    }
    if (!this.reducedMotion) {
      for (let index = 0; index < 4; index++) {
        const angle = index * Math.PI / 2 + Math.PI / 4;
        const distance = this.unit * (0.045 + expansion * 0.14);
        const px = x + Math.cos(angle) * distance;
        const py = y + Math.sin(angle) * distance;
        ctx.beginPath(); ctx.moveTo(px - 2, py); ctx.lineTo(px + 2, py);
        ctx.moveTo(px, py - 2); ctx.lineTo(px, py + 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = Math.min(1, (1 - progress) * 2.3);
    ctx.font = `500 ${Math.max(11, Math.min(17, this.unit * 0.07))}px Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d8ffac';
    const float = this.reducedMotion ? 0 : progress * Math.min(25, this.unit * 0.14);
    const labelY = Math.max(16, Math.min(this.height - 60, y - this.unit * 0.065 - float));
    const labelX = Math.max(30, Math.min(this.width - 30, x));
    ctx.fillText(`+${event.points}`, labelX, labelY);
    if (!this.reducedMotion) this.drawEnergyMotes(event, x, y);
  }

  drawEnergyMotes(event, fromX, fromY) {
    const ctx = this.ctx;
    const camera = this.getCameraOffset();
    const toX = this.energyTarget.x * this.width - camera.x;
    const toY = this.energyTarget.y * this.height - camera.y;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.hypot(dx, dy) || 1;
    for (const [index, mote] of event.motes.entries()) {
      const progress = (event.age - mote.delay) / mote.duration;
      if (progress < 0 || progress >= 1) continue;
      const bend = this.unit * mote.bend;
      const controlX = (fromX + toX) / 2 - dy / distance * bend;
      const controlY = (fromY + toY) / 2 + dx / distance * bend;
      const point = (at) => {
        const t = at * at;
        return {
          x: (1 - t) ** 2 * fromX + 2 * (1 - t) * t * controlX + t * t * toX,
          y: (1 - t) ** 2 * fromY + 2 * (1 - t) * t * controlY + t * t * toY
        };
      };
      const head = point(progress);
      const tail = point(Math.max(0, progress - 0.055));
      ctx.globalAlpha = Math.min(1, progress * 7, (1 - progress) * 9) * 0.85;
      ctx.strokeStyle = index === 1 ? '#c6f477' : '#84e6c5';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 0.8;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 5;
      ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(head.x, head.y); ctx.stroke();
      this.circle(head.x, head.y, 1.4 + (event.multiplier >= 4 ? 0.3 : 0));
      ctx.fill();
    }
  }

  drawPerfect(event, progress) {
    const ctx = this.ctx;
    const x = this.cx + Math.cos(event.angle) * event.radius * this.unit;
    const y = this.cy + Math.sin(event.angle) * event.radius * this.unit;
    const expansion = this.reducedMotion ? 0 : 1 - (1 - progress) ** 2;
    ctx.globalAlpha = (1 - progress) * 0.8;
    ctx.strokeStyle = '#a8f2db';
    ctx.lineWidth = 1.3;
    this.circle(x, y, this.unit * (0.05 + expansion * 0.09));
    ctx.stroke();
    ctx.beginPath(); ctx.arc(this.cx, this.cy, event.radius * this.unit,
      event.angle - 0.16 - expansion * 0.12, event.angle + 0.16 + expansion * 0.12); ctx.stroke();
    const glint = this.unit * (0.028 + expansion * 0.025);
    ctx.strokeStyle = '#e0fff3';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - glint, y); ctx.lineTo(x + glint, y);
    ctx.moveTo(x, y - glint); ctx.lineTo(x, y + glint); ctx.stroke();
  }

  drawShieldBreak(event, progress) {
    const ctx = this.ctx;
    const x = this.cx + Math.cos(event.angle) * event.radius * this.unit;
    const y = this.cy + Math.sin(event.angle) * event.radius * this.unit;
    const expansion = this.reducedMotion ? 0 : 1 - (1 - progress) ** 2;
    const size = Math.max(11, this.unit * 0.078);
    ctx.strokeStyle = '#7bdce8';
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = (1 - progress) * 0.75;
    this.circle(x, y, size + expansion * this.unit * 0.13);
    ctx.stroke();
    if (this.reducedMotion) return;
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = '#c4faff';
    for (const fragment of event.fragments) {
      ctx.globalAlpha = (1 - progress) ** 1.3 * 0.85;
      const reach = size + expansion * this.unit * fragment.reach;
      ctx.beginPath(); ctx.arc(x, y, reach, fragment.angle - 0.12, fragment.angle + 0.12); ctx.stroke();
    }
  }

  drawCrash(event, progress) {
    const ctx = this.ctx;
    const x = this.cx + Math.cos(event.angle) * event.radius * this.unit;
    const y = this.cy + Math.sin(event.angle) * event.radius * this.unit;
    ctx.globalAlpha = (1 - progress) ** 1.3 * 0.9;
    ctx.strokeStyle = '#f29a80';
    ctx.lineWidth = 1.5;
    const expansion = this.reducedMotion ? 0 : (1 - (1 - progress) ** 2) * 0.38;
    this.circle(x, y, this.unit * (0.055 + expansion));
    ctx.stroke();
    if (this.reducedMotion) return;
    const opacity = (1 - progress) ** 1.4;
    ctx.globalAlpha = opacity * 0.5;
    this.circle(x, y, this.unit * (0.035 + expansion * 0.7));
    ctx.stroke();
    ctx.strokeStyle = '#ffd3af';
    ctx.lineWidth = 1.5;
    for (const fragment of event.fragments) {
      const distance = this.unit * (0.025 + expansion * fragment.reach * 3);
      const tail = this.unit * fragment.length * (1 - progress);
      ctx.globalAlpha = opacity * 0.85;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(fragment.angle) * distance, y + Math.sin(fragment.angle) * distance);
      ctx.lineTo(x + Math.cos(fragment.angle) * Math.max(0, distance - tail), y + Math.sin(fragment.angle) * Math.max(0, distance - tail));
      ctx.stroke();
    }
    if (progress < 0.25) {
      ctx.globalAlpha = (1 - progress / 0.25) * 0.7;
      ctx.fillStyle = '#fff0d4';
      this.circle(x, y, this.unit * (0.018 + expansion * 0.09));
      ctx.fill();
    }
  }

  drawForeground() {
    if (!this.unit) return;
    const ctx = this.ctx;
    for (const pulse of this.pulses) {
      const progress = pulse.age / pulse.life;
      ctx.save();
      ctx.globalAlpha = (1 - progress) * (pulse.type === 'combo' ? 0.42 : pulse.type === 'shield-ready' ? 0.48 : 0.26);
      ctx.strokeStyle = pulse.color;
      ctx.lineWidth = pulse.type === 'combo' ? 1.6 : 1;
      const radius = pulse.type === 'shield-ready'
        ? this.reducedMotion ? 0.41 : 0.34 + progress * 0.13
        : this.reducedMotion ? 0.45 : 0.43 + progress * (pulse.type === 'combo' ? 0.65 : 0.88);
      this.circle(this.cx, this.cy, this.unit * radius);
      ctx.stroke();
      ctx.restore();
    }
    for (const event of this.events) {
      const progress = event.age / event.life;
      ctx.save();
      if (event.type === 'launch') this.drawLaunch(event, progress);
      if (event.type === 'switch') this.drawSwitch(event, progress);
      if (event.type === 'collect') this.drawCollect(event, progress);
      if (event.type === 'perfect') this.drawPerfect(event, progress);
      if (event.type === 'shield-break') this.drawShieldBreak(event, progress);
      if (event.type === 'crash') this.drawCrash(event, progress);
      ctx.restore();
    }
  }
}
