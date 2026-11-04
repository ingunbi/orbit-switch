const TAU = Math.PI * 2;
const THEMES = [
  { name: '케플러의 새벽', accent: '#84e6c5', planetLight: '#83aa71', planetMid: '#3c6550', planetDark: '#142f28' },
  { name: '청록 성운', accent: '#7bdce8', planetLight: '#78b6b7', planetMid: '#315e68', planetDark: '#132e36' },
  { name: '자수정 성해', accent: '#b7a4ed', planetLight: '#a29ab9', planetMid: '#57516f', planetDark: '#262237' },
  { name: '황금빛 잔광', accent: '#e4c68b', planetLight: '#b5ab75', planetMid: '#696044', planetDark: '#302d22' },
  { name: '오로라 회랑', accent: '#91d7c9', planetLight: '#89bda9', planetMid: '#3d6960', planetDark: '#183832' }
];

export function themeAt(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const sector = 1 + Math.floor(safeSeconds / 20);
  return { sector, ...THEMES[(sector - 1) % THEMES.length] };
}

// Visual randomness is independent of encounter generation.
export class SpaceVisuals {
  constructor(ctx, { reducedMotion = false } = {}) {
    this.ctx = ctx;
    this.reducedMotion = reducedMotion;
    this.seed = 0x9e3779b9;
    this.time = 0;
    this.width = 0;
    this.height = 0;
    this.unit = 0;
    this.cx = 0;
    this.cy = 0;
    this.theme = themeAt(0);
    this.events = [];
    this.pulses = [];
    this.gradients = [];
    this.gradientBuilds = 0;
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
      gradientBuilds: this.gradientBuilds
    };
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
    const radius = Math.max(this.width, this.height);
    const clouds = [
      [this.width * 0.13, this.height * 0.23, radius * 0.68, '17'],
      [this.width * 0.94, this.height * 0.82, radius * 0.63, '0e'],
      [this.cx, this.cy, this.unit * 1.5, '0e']
    ];
    this.gradients = clouds.map(([x, y, size, opacity]) => {
      const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, size);
      gradient.addColorStop(0, this.theme.accent + opacity);
      gradient.addColorStop(0.45, this.theme.accent + '07');
      gradient.addColorStop(1, this.theme.accent + '00');
      return gradient;
    });
    this.gradientBuilds += 1;
  }

  setSector(seconds) {
    const next = themeAt(seconds);
    if (next.sector === this.theme.sector) return;
    const colorChanged = next.accent !== this.theme.accent;
    this.theme = next;
    if (colorChanged) this.buildGradients();
  }

  reset() {
    this.events = [];
    this.pulses = [];
    this.time = 0;
    this.setSector(0);
  }

  update(dt, animate = true) {
    if (!animate || !Number.isFinite(dt) || dt <= 0) return;
    this.time += dt;
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

  collect(angle, radius, points, multiplier, milestone = false) {
    this.addEvent({ type: 'collect', angle, radius, points, multiplier, life: this.reducedMotion ? 0.5 : 0.9 });
    if (milestone) this.addPulse({ type: 'combo', color: '#c6f477', life: this.reducedMotion ? 0.35 : 1.15 });
  }

  crash(angle, radius) {
    this.addEvent({ type: 'crash', angle, radius, life: this.reducedMotion ? 0.35 : 0.8 });
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
    for (const gradient of this.gradients) {
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    for (const star of this.stars) {
      const drift = this.reducedMotion ? 0 : this.time * 0.0022 * star.depth;
      const x = ((star.x + drift) % 1) * this.width;
      const y = (star.y + (this.reducedMotion ? 0 : Math.sin(this.time * 0.05 + star.phase) * 0.006 * star.depth)) * this.height;
      const twinkle = this.reducedMotion ? 1 : 0.78 + Math.sin(this.time * 0.8 + star.phase) * 0.22;
      ctx.globalAlpha = star.alpha * twinkle;
      ctx.fillStyle = star.depth === 1 ? '#d3ecdd' : this.theme.accent;
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
    ctx.restore();
  }

  drawAccents() {
    if (!this.unit) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.14;
    const rotation = this.reducedMotion ? 0.4 : this.time * 0.028;
    for (let index = 0; index < 3; index++) {
      const angle = rotation + index * TAU / 3;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, this.unit * 1.13, angle, angle + 0.23);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.045;
    this.circle(this.cx, this.cy, this.unit * 0.455);
    ctx.stroke();
    ctx.restore();
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
    ctx.globalAlpha = (1 - progress) * 0.75;
    ctx.strokeStyle = '#c6f477';
    ctx.lineWidth = 1.2;
    this.circle(x, y, this.unit * (0.035 + expansion * 0.12));
    ctx.stroke();
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
  }

  drawCrash(event, progress) {
    const ctx = this.ctx;
    const x = this.cx + Math.cos(event.angle) * event.radius * this.unit;
    const y = this.cy + Math.sin(event.angle) * event.radius * this.unit;
    ctx.globalAlpha = (1 - progress) * 0.7;
    ctx.strokeStyle = '#f29a80';
    ctx.lineWidth = 1.5;
    const expansion = this.reducedMotion ? 0 : progress * 0.3;
    this.circle(x, y, this.unit * (0.055 + expansion));
    ctx.stroke();
    if (this.reducedMotion) return;
    ctx.globalAlpha *= 0.45;
    this.circle(x, y, this.unit * (0.035 + expansion * 0.7));
    ctx.stroke();
  }

  drawForeground() {
    if (!this.unit) return;
    const ctx = this.ctx;
    for (const pulse of this.pulses) {
      const progress = pulse.age / pulse.life;
      ctx.save();
      ctx.globalAlpha = (1 - progress) * (pulse.type === 'combo' ? 0.42 : 0.26);
      ctx.strokeStyle = pulse.color;
      ctx.lineWidth = pulse.type === 'combo' ? 1.6 : 1;
      const radius = this.reducedMotion ? 0.45 : 0.43 + progress * (pulse.type === 'combo' ? 0.65 : 0.88);
      this.circle(this.cx, this.cy, this.unit * radius);
      ctx.stroke();
      ctx.restore();
    }
    for (const event of this.events) {
      const progress = event.age / event.life;
      ctx.save();
      if (event.type === 'switch') this.drawSwitch(event, progress);
      if (event.type === 'collect') this.drawCollect(event, progress);
      if (event.type === 'crash') this.drawCrash(event, progress);
      ctx.restore();
    }
  }
}
