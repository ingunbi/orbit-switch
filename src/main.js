import { difficultyAt, INNER_RADIUS, intersectsOrbit, multiplierFor } from './logic.js';
import { Sound } from './audio.js';
import { SpaceVisuals, themeAt } from './visuals.js';
import { planWave, perfectSwitchFor } from './encounters.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;
const colors = { mint: '#84e6c5', lime: '#c6f477', coral: '#f29a80' };
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;
const saveKey = 'orbit-switch.v1';

function readSave() {
  try {
    const saved = JSON.parse(localStorage.getItem(saveKey)) || {};
    return { best: Number.isFinite(saved.best) ? Math.max(0, Math.floor(saved.best)) : 0, sound: saved.sound === true };
  } catch {
    return { best: 0, sound: false };
  }
}

const saved = readSave();
let best = saved.best;
let soundOn = saved.sound;
function save() {
  try { localStorage.setItem(saveKey, JSON.stringify({ best, sound: soundOn })); } catch { /* A blocked save must never interrupt a flight. */ }
}

const audio = new Sound(() => soundOn);
const visuals = new SpaceVisuals(ctx, { reducedMotion });
let width = 0, height = 0, cx = 0, cy = 0, unit = 0;
let state = 'intro';
let elapsed = 0, ambientTime = 0, score = 0, energy = 0, chain = 0, maxChain = 0;
let playerAngle = -Math.PI / 2, playerRadius = INNER_RADIUS, lane = 0;
let shipVisible = true, spawnCountdown = 0.65, waveNumber = 0, previousHazard = 0;
let entities = [], particles = [], trail = [];
let pendingEncounters = [], patternLabel = '단일 접근';
let shield = true, shieldCharge = 0, shieldGrace = 0, dodges = 0, perfectDodges = 0;
let feedbackTone = 'score';
let flash = 0, feedbackTime = 0, uiCountdown = 0, lastSector = 1, countdownRemaining = 0;
let resumePending = false;
let resultRevealRemaining = 0;
let lastFrame = performance.now();

const panels = { intro: $('intro-panel'), paused: $('pause-panel'), ended: $('result-panel') };

function announce(text) { $('announcer').textContent = text; }
function pad(number, count = 5) { return Math.floor(number).toString().padStart(count, '0'); }

function resize() {
  const bounds = canvas.getBoundingClientRect();
  width = bounds.width;
  height = bounds.height;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  cx = width / 2;
  cy = height * 0.52;
  unit = Math.min(width * 0.365, height * 0.325, 270);
  visuals.resize(width, height, cx, cy, unit);
  const energyBounds = $('energy').getBoundingClientRect();
  const targetX = Number.isFinite(energyBounds.left) && Number.isFinite(bounds.left) && width > 0
    ? (energyBounds.left + energyBounds.width / 2 - bounds.left) / width : 0.83;
  const targetY = Number.isFinite(energyBounds.top) && Number.isFinite(bounds.top) && height > 0
    ? (energyBounds.top + energyBounds.height / 2 - bounds.top) / height : 0.09;
  visuals.setEnergyTarget(targetX, targetY);
}
new ResizeObserver(resize).observe(canvas);

function showPanel(name) {
  for (const [id, panel] of Object.entries(panels)) panel.hidden = id !== name;
  $('overlay').hidden = !name;
}

function syncControls() {
  const active = state === 'playing';
  $('pause-button').disabled = state !== 'playing' && state !== 'paused';
  $('pause-button').textContent = state === 'paused' ? '▷' : 'Ⅱ';
  $('pause-button').setAttribute('aria-label', state === 'paused' ? '항해 계속' : '일시정지');
  $('switch-button').disabled = !active || resumePending;
  $('flight-status').textContent = ({ intro: '탐사 대기 중', playing: resumePending ? '항해 재개 준비 중' : '궤도 신호 수신 중', paused: '신호 일시정지', ended: '이번 항해 종료' })[state];
}

function syncSound() {
  $('sound-button').setAttribute('aria-pressed', String(soundOn));
  $('sound-button').setAttribute('aria-label', soundOn ? '소리 끄기' : '소리 켜기');
  $('sound-button').title = `${soundOn ? '소리 끄기' : '소리 켜기'} (M)`;
}

function updateHud() {
  $('score').textContent = pad(score);
  $('energy').textContent = pad(energy, 2);
  $('best').textContent = pad(best);
  $('sector').textContent = pad(difficultyAt(elapsed).sector, 2);
  $('sector-label').textContent = pad(difficultyAt(elapsed).sector, 2);
  $('sector-name').textContent = themeAt(elapsed).name;
  $('altitude').textContent = lane === 0 ? 'LOW' : 'HIGH';
  $('velocity').textContent = difficultyAt(elapsed).speed.toFixed(2);
  $('multiplier').textContent = `×${multiplierFor(chain)}`;
  $('combo-beacon').textContent = `×${multiplierFor(chain)}`;
  $('combo-beacon').setAttribute('data-charged', String(multiplierFor(chain) === 4));
  $('shield-indicator').textContent = shield ? '실드 ON' : `충전 ${shieldCharge}/8`;
  $('shield-indicator').setAttribute('data-ready', String(shield));
  const approaching = entities.filter((entity) => entity.type === 'rock' && !entity.gone && entity.gap > -0.25).sort((a, b) => a.gap - b.gap)[0];
  $('pattern-indicator').textContent = approaching?.pattern || patternLabel;
  visuals.setShield(shield, shieldGrace);
  $('chain-description').textContent = chain > 0 ? `${chain}개 연속 수집 · ${chain >= 9 ? '최대 배수 도달!' : `${3 - chain % 3}개 더 모으면 배수 상승`}` : '에너지 3개마다 배수가 올라가요';
  [...$('signal-bars').children].forEach((bar, index) => bar.classList.toggle('active', index < chain));
}

function feedback(text, tone = 'score') {
  const priority = { score: 0, sector: 1, combo: 2, perfect: 3, shield: 4, ready: 5 };
  if (feedbackTime > 0 && (priority[tone] || 0) < (priority[feedbackTone] || 0)) return;
  feedbackTone = tone;
  $('feedback').textContent = text;
  $('feedback').setAttribute('data-tone', tone);
  $('feedback').classList.add('show');
  feedbackTime = tone === 'shield' ? 0.85 : tone === 'perfect' ? 0.8 : 1.3;
}

function resetFlight() {
  elapsed = 0; score = 0; energy = 0; chain = 0; maxChain = 0;
  playerAngle = -Math.PI / 2; playerRadius = INNER_RADIUS; lane = 0;
  shipVisible = true; spawnCountdown = 0.65; waveNumber = 0;
  entities = []; particles = []; trail = [];
  pendingEncounters = []; patternLabel = '단일 접근';
  shield = true; shieldCharge = 0; shieldGrace = 0; dodges = 0; perfectDodges = 0;
  feedbackTone = 'score';
  visuals.reset();
  audio.setPlaying(false);
  flash = 0; lastSector = 1; feedbackTime = 0;
  resumePending = false;
  resultRevealRemaining = 0;
  $('feedback').classList.remove('show');
  $('energy-readout').classList.remove('energy-hit');
  updateHud();
}

function start() {
  audio.unlock();
  resetFlight();
  state = 'playing';
  visuals.launch(playerAngle, playerRadius);
  showPanel(null);
  syncControls();
  audio.setPlaying(true);
  audio.start();
  announce('탐사 시작. 탭 또는 스페이스바로 궤도를 바꾸세요.');
  canvas.focus({ preventScroll: true });
}

function home() {
  state = 'intro';
  resetFlight();
  showPanel('intro');
  syncControls();
  $('start-button').focus({ preventScroll: true });
}

function switchOrbit() {
  if (state !== 'playing' || resumePending) return;
  const approaching = entities.filter((entity) => entity.type === 'rock' && !entity.gone && entity.gap > 0).sort((a, b) => a.gap - b.gap)[0];
  if (approaching && shieldGrace <= 0 && perfectSwitchFor({
    gap: approaching.gap, speed: difficultyAt(elapsed).speed, fromLane: lane,
    toLane: 1 - lane, hazardLane: approaching.lane, shipRadius: playerRadius
  })) approaching.perfect = true;
  lane = 1 - lane;
  visuals.switchOrbit(playerAngle, playerRadius, lane === 0 ? INNER_RADIUS : 1);
  audio.unlock();
  audio.switch(lane);
  burst(cx + Math.cos(playerAngle) * playerRadius * unit, cy + Math.sin(playerAngle) * playerRadius * unit, colors.mint, 5, 15);
  $('altitude').textContent = lane === 0 ? 'LOW' : 'HIGH';
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  audio.setPlaying(false);
  resumePending = false;
  showPanel('paused');
  syncControls();
  announce('일시정지되었습니다.');
  $('resume-button').focus({ preventScroll: true });
}

function resume() {
  if (state !== 'paused' || document.hidden) return;
  audio.unlock();
  state = 'playing';
  resumePending = true;
  countdownRemaining = 1.05;
  showPanel(null);
  feedback('READY', 'ready');
  feedbackTime = 1.05;
  syncControls();
  canvas.focus({ preventScroll: true });
}

function revealResults() {
  resultRevealRemaining = 0;
  showPanel('ended');
  $('restart-button').focus({ preventScroll: true });
}

function endFlight() {
  if (state !== 'playing') return;
  state = 'ended';
  audio.setPlaying(false);
  shipVisible = false;
  feedbackTime = 0;
  $('feedback').classList.remove('show');
  const finalScore = Math.floor(score);
  const newBest = finalScore > best;
  best = Math.max(best, finalScore);
  save();
  flash = 0.32;
  visuals.crash(playerAngle, playerRadius);
  burst(cx + Math.cos(playerAngle) * playerRadius * unit, cy + Math.sin(playerAngle) * playerRadius * unit, colors.coral, 34, 95);
  audio.crash();
  $('result-label').textContent = newBest ? 'PERSONAL BEST / NEW RECORD' : 'TRANSMISSION ENDED';
  $('result-title').textContent = newBest ? '가장 멀리 간 오늘.' : '항해 기록 도착.';
  $('result-score').textContent = pad(score);
  $('result-energy').textContent = energy;
  $('result-time').textContent = `${Math.floor(elapsed)}초`;
  $('result-chain').textContent = maxChain;
  $('result-perfect').textContent = perfectDodges;
  $('result-message').textContent = elapsed < 12 ? '붉은 파편이 다가오면 반대 궤도로 전환해 보세요.' : maxChain >= 9 ? '빛나는 연속 수집! 다음 항해에서 기록을 이어가요.' : '좋은 항해였어요. 다음 궤도에서 다시 만나요.';
  updateHud();
  syncControls();
  if (reducedMotion) revealResults();
  else {
    resultRevealRemaining = 0.62;
    showPanel(null);
  }
  announce(`항해 종료. 점수 ${Math.floor(score)}점. 에너지 ${energy}개.${newBest ? ' 최고 기록입니다.' : ''}`);
}

function spawnEncounter(encounter, pattern) {
  const hazardLane = encounter.lane;
  entities.push({ type: 'rock', lane: hazardLane, gap: Math.PI, size: 0.063, seed: Math.random() * 10, rotation: Math.random() * TAU, passed: false, perfect: false, pattern });
  for (let index = 0; index < encounter.energyCount; index++) {
    entities.push({ type: 'energy', lane: 1 - hazardLane, gap: Math.PI - 0.02 + index * 0.18, size: 0.042, seed: waveNumber * 3 + index });
  }
}

function spawnWave() {
  waveNumber += 1;
  const plan = planWave(waveNumber, elapsed, previousHazard, Math.random());
  patternLabel = plan.label;
  previousHazard = plan.encounters.at(-1).lane;
  for (const encounter of plan.encounters) {
    if (encounter.after === 0) spawnEncounter(encounter, plan.label);
    else pendingEncounters.push({ ...encounter, remaining: encounter.after, pattern: plan.label });
  }
  return plan.interval;
}

function burst(x, y, color, count = 14, speed = 50) {
  if (reducedMotion) { count = Math.min(count, 4); speed = 0; }
  for (let i = 0; i < count; i++) {
    const angle = visuals.random() * TAU;
    const velocity = (0.3 + visuals.random() * 0.7) * speed;
    particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, age: 0, life: 0.35 + visuals.random() * 0.35, color, size: visuals.random() * 2 + 1 });
  }
  if (particles.length > 150) particles.splice(0, particles.length - 150);
}

function update(dt) {
  if (state === 'paused') return;
  if (!resumePending) ambientTime += dt;
  visuals.update(dt, !resumePending);
  flash = Math.max(0, flash - dt * 1.8);
  if (feedbackTime > 0) {
    feedbackTime -= dt;
    if (feedbackTime <= 0) $('feedback').classList.remove('show');
  }
  for (const particle of particles) {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= Math.exp(-dt * 2);
    particle.vy *= Math.exp(-dt * 2);
  }
  particles = particles.filter((p) => p.age < p.life);
  if (state === 'ended') {
    if (resultRevealRemaining > 0) {
      resultRevealRemaining = Math.max(0, resultRevealRemaining - dt);
      if (resultRevealRemaining === 0) revealResults();
    }
    return;
  }
  if (state === 'intro') {
    if (!reducedMotion) {
      playerAngle += dt * 0.32;
      playerRadius = 0.835 + Math.sin(ambientTime * 0.7) * 0.165;
    }
    return;
  }
  if (state !== 'playing') return;
  if (resumePending) {
    countdownRemaining -= dt;
    if (countdownRemaining <= 0) { resumePending = false; audio.setPlaying(true); syncControls(); announce('항해를 계속합니다.'); }
    return;
  }
  elapsed += dt;
  shieldGrace = Math.max(0, shieldGrace - dt);
  const difficulty = difficultyAt(elapsed);
  visuals.setSector(elapsed);
  audio.tick(elapsed, multiplierFor(chain));
  if (difficulty.sector > lastSector) {
    lastSector = difficulty.sector;
    feedback(`SECTOR ${pad(lastSector, 2)}`, 'sector');
    visuals.sector(lastSector);
    audio.sector(lastSector);
    announce(`${themeAt(elapsed).name}. 섹터 ${lastSector}.`);
  }
  score += dt * 10;
  playerAngle = (playerAngle + dt * difficulty.speed) % TAU;
  playerRadius += ((lane === 0 ? INNER_RADIUS : 1) - playerRadius) * (1 - Math.exp(-dt * 20));
  for (const pending of pendingEncounters) {
    pending.remaining -= dt;
    if (pending.remaining <= 0) spawnEncounter(pending, pending.pattern);
  }
  pendingEncounters = pendingEncounters.filter((pending) => pending.remaining > 0);
  spawnCountdown -= dt;
  if (spawnCountdown <= 0) {
    spawnCountdown += spawnWave();
  }
  for (const entity of entities) {
    entity.gap -= (difficulty.speed + 0.48) * dt;
    entity.rotation = (entity.rotation || 0) + (reducedMotion ? 0 : dt * 0.45);
    if (entity.gone) continue;
    if (intersectsOrbit(playerRadius, entity.gap, entity.lane, entity.size)) {
      if (entity.type === 'rock') {
        if (shieldGrace > 0) { entity.gone = true; continue; }
        if (shield) {
          shield = false; shieldCharge = 0; shieldGrace = 0.5; chain = 0;
          entity.gone = true;
          visuals.shieldBreak(playerAngle, playerRadius);
          burst(cx + Math.cos(playerAngle) * playerRadius * unit, cy + Math.sin(playerAngle) * playerRadius * unit, colors.mint, 20, 65);
          audio.shieldBreak();
          feedback('SHIELD BREAK', 'shield');
          announce('보호막이 파편을 막았습니다. 에너지 8개를 모으면 재충전됩니다.');
          continue;
        }
        endFlight();
        break;
      }
      entity.gone = true;
      energy += 1;
      chain += 1;
      maxChain = Math.max(maxChain, chain);
      const bonus = 25 * multiplierFor(chain);
      score += bonus;
      const radius = entity.lane === 0 ? INNER_RADIUS : 1;
      const angle = playerAngle + entity.gap;
      burst(cx + Math.cos(angle) * radius * unit, cy + Math.sin(angle) * radius * unit, colors.lime);
      const milestone = chain % 3 === 0 && chain <= 9;
      const surge = chain >= 12 && chain % 6 === 0;
      visuals.collect(angle, radius, bonus, multiplierFor(chain), milestone || surge);
      $('energy-readout').classList.add('energy-hit');
      if (milestone || surge) {
        feedback(surge ? 'MAX SIGNAL' : `SIGNAL ×${multiplierFor(chain)}`, 'combo');
        announce(`연속 ${chain}개. 수집 보너스 ${multiplierFor(chain)}배.${surge ? ' 최대 신호 유지 중.' : ''}`);
      }
      audio.collect(chain, entity.lane);
      if (surge) audio.surge();
      if (!shield) {
        shieldCharge += 1;
        if (shieldCharge >= 8) {
          shield = true; shieldCharge = 0;
          visuals.shieldReady(); audio.shieldReady();
          feedback('SHIELD READY', 'shield');
          announce('보호막 재충전 완료.');
        }
      }
    }
    if (entity.type === 'energy' && entity.gap < -0.19 && !entity.gone) {
      entity.gone = true;
      chain = 0;
    }
    if (entity.type === 'rock' && entity.gap < -0.25 && !entity.passed) {
      entity.passed = true;
      dodges += 1;
      score += 5;
      if (entity.perfect) {
        perfectDodges += 1;
        score += 20;
        visuals.perfect(playerAngle, playerRadius);
        audio.perfect();
        feedback('PERFECT +20', 'perfect');
      }
    }
  }
  entities = entities.filter((e) => !e.gone && e.gap > -0.9);
  visuals.setSignal(multiplierFor(chain));
  visuals.setShield(shield, shieldGrace);
  if (!reducedMotion) {
    trail.push({ angle: playerAngle, radius: playerRadius, age: 0 });
    for (const point of trail) point.age += dt;
    trail = trail.filter((point) => point.age < 0.45);
  }
  uiCountdown -= dt;
  if (uiCountdown <= 0) { updateHud(); uiCountdown = 0.08; }
}

function circle(x, y, radius, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0, radius), 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function renderBackground() {
  visuals.drawBackground();
}

function renderOrbits() {
  const accent = visuals.palette.accent;
  ctx.save();
  for (let i = 0; i < 72; i++) {
    const angle = i / 72 * TAU;
    const inner = unit * 1.13;
    const outer = inner + (i % 6 === 0 ? 7 : 3);
    ctx.strokeStyle = accent + (i % 6 === 0 ? '55' : '22');
    ctx.lineWidth = 1;
    ctx.beginPath();ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);ctx.lineTo(cx + Math.cos(angle) * outer,cy + Math.sin(angle) * outer);ctx.stroke();
  }
  ctx.setLineDash([2, 6]);
  circle(cx, cy, unit * 1.035, null, accent + '26');
  for (const radius of [INNER_RADIUS, 1]) {
    ctx.setLineDash([]);
    circle(cx, cy, unit * radius, null, accent + '3a');
    ctx.setLineDash([1, 6]);
    circle(cx, cy, unit * radius, null, accent + '44');
  }
  ctx.setLineDash([]);
  if (state === 'playing') {
    ctx.beginPath();ctx.arc(cx, cy, unit * (lane === 0 ? INNER_RADIUS : 1), playerAngle - 0.52, playerAngle + 0.04);
    ctx.strokeStyle = '#a7ed8f';ctx.lineWidth = 2;ctx.stroke();
  }
  ctx.font = `${Math.max(7, unit * 0.036)}px Consolas, monospace`;ctx.fillStyle = '#5d8870';ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - unit * 1.2);
  ctx.fillText('S', cx, cy + unit * 1.24);
  ctx.restore();
}

function renderPlanet() {
  const theme = visuals.palette;
  const r = unit * 0.39;
  const halo = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.6);
  halo.addColorStop(0, theme.accent + '2b');halo.addColorStop(1, theme.accent + '00');
  circle(cx, cy, r * 1.6, halo);
  ctx.save();
  circle(cx, cy, r, null, theme.accent + '60', 1.5);
  ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.clip();
  const gradient = ctx.createRadialGradient(cx-r*.45,cy-r*.5,r*.1,cx+r*.3,cy+r*.35,r*1.4);
  gradient.addColorStop(0,theme.planetLight);gradient.addColorStop(.4,theme.planetMid);gradient.addColorStop(1,theme.planetDark);
  ctx.fillStyle=gradient;ctx.fillRect(cx-r,cy-r,r*2,r*2);
  visuals.drawPlanetClouds(r);
  ctx.translate(cx,cy);ctx.rotate(-.35);
  ctx.strokeStyle=theme.accent+'18';ctx.lineWidth=r*.11;
  for(let y=-1.5;y<1.5;y+=.36){ctx.beginPath();ctx.ellipse(-r*.32,r*y,r*1.25,r*.18,0,0,TAU);ctx.stroke();}
  ctx.fillStyle=theme.accent+'33';
  ctx.beginPath();ctx.moveTo(-r*.75,-r*.48);ctx.bezierCurveTo(-r*.2,-r*.85,r*.05,-r*.56,-r*.22,-r*.2);ctx.bezierCurveTo(-r*.48,r*.02,-r*.05,r*.25,-r*.42,r*.39);ctx.bezierCurveTo(-r*.6,r*.15,-r*.4,-r*.16,-r*.8,-r*.1);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(r*.2,r*.15);ctx.bezierCurveTo(r*.75,-r*.13,r*.9,r*.22,r*.52,r*.58);ctx.bezierCurveTo(r*.2,r*.89,-r*.1,r*.65,r*.2,r*.15);ctx.fill();
  const shadow=ctx.createLinearGradient(-r,-r,r,r);shadow.addColorStop(0,'#d5ff9f10');shadow.addColorStop(.45,'#08241d00');shadow.addColorStop(1,'#00130cc0');ctx.fillStyle=shadow;ctx.fillRect(-r,-r,r*2,r*2);
  ctx.restore();
  ctx.save();ctx.translate(cx,cy);ctx.rotate(-.4);
  ctx.beginPath();ctx.ellipse(0,0,r*1.35,r*.26,0,0,Math.PI);ctx.strokeStyle=theme.accent+'55';ctx.lineWidth=1;ctx.stroke();ctx.restore();
}

function renderRock(x, y, size, rotation, seed, heat = 0) {
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);
  const material = ctx.createLinearGradient(-size,-size,size,size);
  material.addColorStop(0,'#b28c77');material.addColorStop(.42,'#795044');material.addColorStop(1,'#302b32');
  ctx.shadowBlur=10+heat*7;ctx.shadowColor='#e97f5f66';ctx.fillStyle=material;ctx.strokeStyle=colors.coral;ctx.lineWidth=1.4;
  ctx.beginPath();
  for(let i=0;i<7;i++){const angle=i/7*TAU;const r=size*(.8+.2*Math.sin(seed+i*2.4));i===0?ctx.moveTo(Math.cos(angle)*r,Math.sin(angle)*r):ctx.lineTo(Math.cos(angle)*r,Math.sin(angle)*r);}
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.shadowBlur=0;ctx.clip();
  ctx.fillStyle='#211e2780';ctx.beginPath();ctx.ellipse(-size*.18,size*.13,size*.27,size*.19,.4,0,TAU);ctx.fill();
  ctx.strokeStyle='#f5c6a39c';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(-size*.58,-size*.23);ctx.lineTo(-size*.18,-size*.57);ctx.lineTo(size*.26,-size*.19);ctx.stroke();
  ctx.strokeStyle='#d3886888';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-size*.38,size*.21);ctx.lineTo(size*.1,-size*.12);ctx.lineTo(size*.43,size*.2);ctx.stroke();
  ctx.restore();
}

function renderEnergy(x,y,size,phase){
  const pulse=reducedMotion?1:1+Math.sin(ambientTime*4+phase)*.09;
  ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.shadowColor=colors.lime;ctx.shadowBlur=15;
  const crystal=ctx.createLinearGradient(-size,-size,size,size);
  crystal.addColorStop(0,'#f5ffd8');crystal.addColorStop(.45,colors.lime);crystal.addColorStop(1,'#78cba1');
  ctx.fillStyle=crystal;ctx.fillRect(-size*.5*pulse,-size*.5*pulse,size*pulse,size*pulse);
  ctx.shadowBlur=0;ctx.strokeStyle='#c6f47744';ctx.lineWidth=1;ctx.strokeRect(-size,-size,size*2,size*2);ctx.restore();
}

function renderEntities() {
  let shown = entities;
  if(state === 'intro') shown=[{type:'rock',lane:0,gap:1.55,size:.063,seed:2,rotation:reducedMotion?0:ambientTime*.1},{type:'rock',lane:1,gap:3.7,size:.063,seed:4,rotation:reducedMotion?0:-ambientTime*.13},{type:'energy',lane:1,gap:2.5,size:.042,seed:1},{type:'energy',lane:0,gap:5.4,size:.042,seed:3}];
  for(const entity of shown){
    if(entity.gone)continue;
    const radius=(entity.lane===0?INNER_RADIUS:1)*unit;
    const angle=playerAngle+entity.gap;
    const x=cx+Math.cos(angle)*radius,y=cy+Math.sin(angle)*radius;
    if(entity.type==='rock'){
      if(!reducedMotion&&state==='playing'){
        ctx.save();ctx.strokeStyle=colors.coral;ctx.lineCap='round';
        for(let index=0;index<3;index++){
          ctx.globalAlpha=.15*(1-index/3);ctx.lineWidth=Math.max(.7,entity.size*unit*.28)*(1-index*.2);
          ctx.beginPath();ctx.arc(cx,cy,radius,angle+.025+index*.035,angle+.055+index*.035);ctx.stroke();
        }
        ctx.restore();
      }
      renderRock(x,y,entity.size*unit,entity.rotation,entity.seed,Math.max(0,1-Math.abs(entity.gap)/1.6));
    }
    else renderEnergy(x,y,entity.size*unit,entity.seed);
  }
}

function renderShip(){
  if(!shipVisible)return;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  for(let i=1;i<trail.length;i++){
    const previous=trail[i-1],point=trail[i],alpha=(1-point.age/.45)*.5;
    ctx.strokeStyle=`rgba(132,230,197,${alpha})`;ctx.lineWidth=2.2;
    ctx.beginPath();ctx.moveTo(cx+Math.cos(previous.angle)*previous.radius*unit,cy+Math.sin(previous.angle)*previous.radius*unit);ctx.lineTo(cx+Math.cos(point.angle)*point.radius*unit,cy+Math.sin(point.angle)*point.radius*unit);ctx.stroke();
  }
  ctx.restore();
  const x=cx+Math.cos(playerAngle)*playerRadius*unit,y=cy+Math.sin(playerAngle)*playerRadius*unit;
  const size=Math.max(8,unit*.052);
  visuals.drawShipAura(playerAngle,playerRadius);
  ctx.save();ctx.translate(x,y);ctx.rotate(playerAngle+Math.PI/2);
  const reactor=ctx.createRadialGradient(-size*.5,0,0,-size*.5,0,size*1.3);
  reactor.addColorStop(0,'#bdfff57a');reactor.addColorStop(1,'#84e6c500');
  circle(-size*.5,0,size*1.3,reactor);
  ctx.shadowBlur=16;ctx.shadowColor='#baf48299';
  const hull=ctx.createLinearGradient(size,-size,-size,size);
  hull.addColorStop(0,'#f3ffe0');hull.addColorStop(.35,'#d5ff9d');hull.addColorStop(1,'#60bca2');
  ctx.fillStyle=hull;ctx.beginPath();ctx.moveTo(size,0);ctx.lineTo(-size*.75,-size*.62);ctx.lineTo(-size*.4,0);ctx.lineTo(-size*.75,size*.62);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;ctx.strokeStyle='#e5ffbd';ctx.lineWidth=.65;ctx.stroke();
  ctx.shadowBlur=0;ctx.fillStyle='#ecffe1';ctx.beginPath();ctx.moveTo(size*.65,0);ctx.lineTo(-size*.42,-size*.28);ctx.lineTo(-size*.2,0);ctx.closePath();ctx.fill();
  ctx.fillStyle=colors.mint;ctx.globalAlpha=.65;ctx.beginPath();ctx.moveTo(-size*.5,-size*.2);ctx.lineTo(-size*(1.2+(reducedMotion?0:Math.sin(ambientTime*28)*.15)),0);ctx.lineTo(-size*.5,size*.2);ctx.fill();ctx.restore();
}

function render(){
  if(width===0||height===0)return;
  renderBackground();
  const camera = visuals.getCameraOffset();
  ctx.save();ctx.translate(camera.x,camera.y);
  renderOrbits();visuals.drawAccents();renderPlanet();renderEntities();renderShip();
  for(const p of particles){ctx.globalAlpha=1-p.age/p.life;circle(p.x,p.y,p.size,p.color);}ctx.globalAlpha=1;
  visuals.drawForeground();
  ctx.restore();
  if(flash>0&&!reducedMotion){ctx.fillStyle=`rgba(242,154,128,${flash*.25})`;ctx.fillRect(0,0,width,height);}
}

function frame(now){
  const dt=Math.min((now-lastFrame)/1000,.035);lastFrame=now;
  if(!document.hidden){update(dt);render();}
  requestAnimationFrame(frame);
}

$('start-button').addEventListener('click', start);
$('restart-button').addEventListener('click', start);
$('pause-restart-button').addEventListener('click', start);
$('resume-button').addEventListener('click', resume);
$('home-button').addEventListener('click', home);
$('pause-button').addEventListener('click', () => state === 'paused' ? resume() : pause());
$('switch-button').addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  switchOrbit();
  if (state === 'playing') canvas.focus({ preventScroll: true });
});
// Pointer presses switch immediately; keyboard and assistive clicks still work.
$('switch-button').addEventListener('click', (event) => {
  if (event.detail) return;
  switchOrbit();
  if (state === 'playing') canvas.focus({ preventScroll: true });
});
$('sound-button').addEventListener('click', () => {
  soundOn = !soundOn;
  audio.unlock(); syncSound(); save();
  if (soundOn) audio.note(660, .13);
  if (state === 'playing') canvas.focus({ preventScroll: true });
});
$('energy-readout').addEventListener('animationend', (event) => {
  if (event.target === $('energy-readout')) $('energy-readout').classList.remove('energy-hit');
});
canvas.addEventListener('pointerdown',(event)=>{if(event.button!==0)return;event.preventDefault();if(state==='playing')switchOrbit();});
window.addEventListener('keydown',(event)=>{
  if(event.repeat)return;
  const onButton=event.target instanceof HTMLElement&&event.target.closest('button,a,input,textarea,select');
  const editingText=event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable=true]');
  if(event.code==='KeyM'&&!editingText){event.preventDefault();$('sound-button').click();return;}
  if((event.code==='Escape'||event.code==='KeyP')&&!editingText){event.preventDefault();state==='paused'?resume():pause();return;}
  if(['Space','ArrowUp','ArrowDown'].includes(event.code)&&!onButton){event.preventDefault();if(state==='playing')switchOrbit();else if(state==='intro')start();else if(state==='paused')resume();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='playing')pause();lastFrame=performance.now();});
window.addEventListener('blur',()=>{if(state==='playing')pause();});
motionPreference.addEventListener?.('change', (event) => {
  reducedMotion = event.matches;
  visuals.setReducedMotion(reducedMotion);
  trail = [];
  if (reducedMotion) {
    particles = [];
    flash = 0;
    if (state === 'ended' && resultRevealRemaining > 0) revealResults();
  }
});

syncSound();syncControls();updateHud();resize();requestAnimationFrame(frame);
if(import.meta.env.DEV)window.__game={get state(){return state;},get score(){return score;},get energy(){return energy;},get lane(){return lane;},get elapsed(){return elapsed;},get shield(){return shield;},get shieldCharge(){return shieldCharge;},get shieldGrace(){return shieldGrace;},get dodges(){return dodges;},get perfectDodges(){return perfectDodges;},get pendingCount(){return pendingEncounters.length;},get entities(){return entities.map(e=>({...e}));},start,pause,resume,switchOrbit,endFlight};
