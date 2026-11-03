import { difficultyAt, INNER_RADIUS, intersectsOrbit, multiplierFor } from './logic.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;
const colors = { mint: '#84e6c5', lime: '#c6f477', coral: '#f29a80' };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

class Sound {
  constructor() { this.context = null; }
  unlock() {
    if (!soundOn) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context ??= new AudioContext();
      this.context.resume().catch(() => {});
    } catch { /* The game also works without audio support. */ }
  }
  note(frequency, duration = 0.1, delay = 0, type = 'sine', volume = 0.05) {
    if (!soundOn || !this.context || this.context.state !== 'running') return;
    const at = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }
  switch() { this.note(260, 0.07, 0, 'triangle', 0.035); this.note(390, 0.09, 0.025, 'sine', 0.025); }
  collect(chain) { const base = [523.25, 587.33, 659.25, 783.99, 880][chain % 5]; this.note(base, 0.15); this.note(base * 1.5, 0.14, 0.05, 'sine', 0.025); }
  start() { [261.63, 329.63, 392, 523.25].forEach((f, i) => this.note(f, 0.2, i * 0.065, 'sine', 0.035)); }
  crash() { this.note(130, 0.32, 0, 'triangle', 0.08); this.note(65, 0.4, 0.08, 'sine', 0.06); }
}

const audio = new Sound();
const stars = Array.from({ length: 100 }, () => ({ x: Math.random(), y: Math.random(), size: Math.random() * 1.15 + 0.3, alpha: Math.random() * 0.45 + 0.15, phase: Math.random() * TAU }));
let width = 0, height = 0, cx = 0, cy = 0, unit = 0;
let state = 'intro';
let elapsed = 0, ambientTime = 0, score = 0, energy = 0, chain = 0, maxChain = 0;
let playerAngle = -Math.PI / 2, playerRadius = INNER_RADIUS, lane = 0;
let shipVisible = true, spawnCountdown = 0.65, waveNumber = 0, previousHazard = 0;
let entities = [], particles = [], trail = [];
let flash = 0, feedbackTime = 0, uiCountdown = 0, lastSector = 1, countdownRemaining = 0;
let resumePending = false;
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
  $('altitude').textContent = lane === 0 ? 'LOW' : 'HIGH';
  $('velocity').textContent = difficultyAt(elapsed).speed.toFixed(2);
  $('multiplier').textContent = `×${multiplierFor(chain)}`;
  $('chain-description').textContent = chain > 0 ? `${chain}개 연속 수집 · ${chain >= 9 ? '최대 배수 도달!' : `${3 - chain % 3}개 더 모으면 배수 상승`}` : '에너지 3개마다 배수가 올라가요';
  [...$('signal-bars').children].forEach((bar, index) => bar.classList.toggle('active', index < chain));
}

function feedback(text) {
  $('feedback').textContent = text;
  $('feedback').classList.add('show');
  feedbackTime = 1.3;
}

function resetFlight() {
  elapsed = 0; score = 0; energy = 0; chain = 0; maxChain = 0;
  playerAngle = -Math.PI / 2; playerRadius = INNER_RADIUS; lane = 0;
  shipVisible = true; spawnCountdown = 0.65; waveNumber = 0;
  entities = []; particles = []; trail = [];
  flash = 0; lastSector = 1; feedbackTime = 0;
  resumePending = false;
  $('feedback').classList.remove('show');
  updateHud();
}

function start() {
  audio.unlock();
  resetFlight();
  state = 'playing';
  showPanel(null);
  syncControls();
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
  lane = 1 - lane;
  audio.unlock();
  audio.switch();
  burst(cx + Math.cos(playerAngle) * playerRadius * unit, cy + Math.sin(playerAngle) * playerRadius * unit, colors.mint, 5, 15);
  $('altitude').textContent = lane === 0 ? 'LOW' : 'HIGH';
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
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
  feedback('READY');
  feedbackTime = 1.05;
  syncControls();
  canvas.focus({ preventScroll: true });
}

function endFlight() {
  if (state !== 'playing') return;
  state = 'ended';
  shipVisible = false;
  const finalScore = Math.floor(score);
  const newBest = finalScore > best;
  best = Math.max(best, finalScore);
  save();
  flash = 0.7;
  burst(cx + Math.cos(playerAngle) * playerRadius * unit, cy + Math.sin(playerAngle) * playerRadius * unit, colors.coral, 34, 95);
  audio.crash();
  $('result-label').textContent = newBest ? 'PERSONAL BEST / NEW RECORD' : 'TRANSMISSION ENDED';
  $('result-title').textContent = newBest ? '가장 멀리 간 오늘.' : '항해 기록 도착.';
  $('result-score').textContent = pad(score);
  $('result-energy').textContent = energy;
  $('result-time').textContent = `${Math.floor(elapsed)}초`;
  $('result-chain').textContent = maxChain;
  $('result-message').textContent = elapsed < 12 ? '붉은 파편이 다가오면 반대 궤도로 전환해 보세요.' : maxChain >= 9 ? '빛나는 연속 수집! 다음 항해에서 기록을 이어가요.' : '좋은 항해였어요. 다음 궤도에서 다시 만나요.';
  updateHud();
  syncControls();
  showPanel('ended');
  announce(`항해 종료. 점수 ${Math.floor(score)}점. 에너지 ${energy}개.${newBest ? ' 최고 기록입니다.' : ''}`);
  $('restart-button').focus({ preventScroll: true });
}

function spawnWave() {
  waveNumber += 1;
  // One hazardous track per encounter leaves a readable escape route.
  // No late random spawns: every encounter starts half an orbit ahead.
  let hazardLane = Math.random() < 0.5 ? 0 : 1;
  if (waveNumber === 1) hazardLane = 0;
  if (waveNumber % 3 === 0) hazardLane = 1 - previousHazard;
  previousHazard = hazardLane;
  entities.push({ type: 'rock', lane: hazardLane, gap: Math.PI, size: 0.063, seed: Math.random() * 10, rotation: Math.random() * TAU, passed: false });
  entities.push({ type: 'energy', lane: 1 - hazardLane, gap: Math.PI - 0.02, size: 0.042, seed: waveNumber });
}

function burst(x, y, color, count = 14, speed = 50) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * TAU;
    const velocity = (0.3 + Math.random() * 0.7) * speed;
    particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, age: 0, life: 0.35 + Math.random() * 0.35, color, size: Math.random() * 2 + 1 });
  }
}

function update(dt) {
  ambientTime += dt;
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
  if (state === 'intro') {
    playerAngle += dt * (reducedMotion ? 0.13 : 0.32);
    playerRadius = 0.835 + Math.sin(ambientTime * 0.7) * 0.165;
    return;
  }
  if (state !== 'playing') return;
  if (resumePending) {
    countdownRemaining -= dt;
    if (countdownRemaining <= 0) { resumePending = false; syncControls(); announce('항해를 계속합니다.'); }
    return;
  }
  elapsed += dt;
  const difficulty = difficultyAt(elapsed);
  if (difficulty.sector > lastSector) {
    lastSector = difficulty.sector;
    feedback(`SECTOR ${pad(lastSector, 2)}`);
    audio.note(523, 0.2); audio.note(784, 0.25, 0.09);
  }
  score += dt * 10;
  playerAngle = (playerAngle + dt * difficulty.speed) % TAU;
  playerRadius += ((lane === 0 ? INNER_RADIUS : 1) - playerRadius) * (1 - Math.exp(-dt * 20));
  spawnCountdown -= dt;
  if (spawnCountdown <= 0) {
    spawnWave();
    spawnCountdown += difficulty.interval;
  }
  for (const entity of entities) {
    entity.gap -= (difficulty.speed + 0.48) * dt;
    entity.rotation = (entity.rotation || 0) + dt * 0.45;
    if (entity.gone) continue;
    if (intersectsOrbit(playerRadius, entity.gap, entity.lane, entity.size)) {
      if (entity.type === 'rock') {
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
      feedback(chain % 3 === 0 && chain <= 9 ? `SIGNAL ×${multiplierFor(chain)}` : `+${bonus}`);
      audio.collect(chain);
    }
    if (entity.type === 'energy' && entity.gap < -0.19 && !entity.gone) {
      entity.gone = true;
      chain = 0;
    }
    if (entity.type === 'rock' && entity.gap < -0.25 && !entity.passed) {
      entity.passed = true;
      score += 5;
    }
  }
  entities = entities.filter((e) => !e.gone && e.gap > -0.9);
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
  ctx.fillStyle = '#081b17'; ctx.fillRect(0, 0, width, height);
  const atmosphere = ctx.createRadialGradient(cx, cy, unit * 0.05, cx, cy, unit * 1.75);
  atmosphere.addColorStop(0, '#244a3233'); atmosphere.addColorStop(0.5, '#163a2c55'); atmosphere.addColorStop(1, '#07181300');
  ctx.fillStyle = atmosphere; ctx.fillRect(0, 0, width, height);
  for (const star of stars) {
    const twinkle = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(ambientTime * 0.6 + star.phase);
    circle(star.x * width, star.y * height, star.size, `rgba(156,205,177,${star.alpha * twinkle})`);
  }
  ctx.strokeStyle = '#81b4940b'; ctx.lineWidth = 1;
  const spacing = 45;
  for (let x = cx % spacing; x < width; x += spacing) {
    for (let y = cy % spacing; y < height; y += spacing) {
      ctx.beginPath();ctx.moveTo(x - 2, y);ctx.lineTo(x + 2, y);ctx.moveTo(x,y - 2);ctx.lineTo(x,y + 2);ctx.stroke();
    }
  }
}

function renderOrbits() {
  ctx.save();
  for (let i = 0; i < 72; i++) {
    const angle = i / 72 * TAU;
    const inner = unit * 1.13;
    const outer = inner + (i % 6 === 0 ? 7 : 3);
    ctx.strokeStyle = i % 6 === 0 ? '#67997b55' : '#67997b22';
    ctx.lineWidth = 1;
    ctx.beginPath();ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);ctx.lineTo(cx + Math.cos(angle) * outer,cy + Math.sin(angle) * outer);ctx.stroke();
  }
  ctx.setLineDash([2, 6]);
  circle(cx, cy, unit * 1.035, null, '#6c9e7c26');
  for (const radius of [INNER_RADIUS, 1]) {
    ctx.setLineDash([]);
    circle(cx, cy, unit * radius, null, '#81c6a23a');
    ctx.setLineDash([1, 6]);
    circle(cx, cy, unit * radius, null, '#84b69744');
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
  const r = unit * 0.39;
  const halo = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.6);
  halo.addColorStop(0, '#a0dc622b');halo.addColorStop(1, '#7ac58b00');
  circle(cx, cy, r * 1.6, halo);
  ctx.save();
  circle(cx, cy, r, null, '#9fce8460', 1.5);
  ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.clip();
  const gradient = ctx.createRadialGradient(cx-r*.45,cy-r*.5,r*.1,cx+r*.3,cy+r*.35,r*1.4);
  gradient.addColorStop(0,'#618d58');gradient.addColorStop(.4,'#395c3a');gradient.addColorStop(1,'#152e23');
  ctx.fillStyle=gradient;ctx.fillRect(cx-r,cy-r,r*2,r*2);
  ctx.translate(cx,cy);ctx.rotate(-.35);
  ctx.strokeStyle='#a5d17b18';ctx.lineWidth=r*.11;
  for(let y=-1.5;y<1.5;y+=.36){ctx.beginPath();ctx.ellipse(-r*.32,r*y,r*1.25,r*.18,0,0,TAU);ctx.stroke();}
  ctx.fillStyle='#aed16b33';
  ctx.beginPath();ctx.moveTo(-r*.75,-r*.48);ctx.bezierCurveTo(-r*.2,-r*.85,r*.05,-r*.56,-r*.22,-r*.2);ctx.bezierCurveTo(-r*.48,r*.02,-r*.05,r*.25,-r*.42,r*.39);ctx.bezierCurveTo(-r*.6,r*.15,-r*.4,-r*.16,-r*.8,-r*.1);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(r*.2,r*.15);ctx.bezierCurveTo(r*.75,-r*.13,r*.9,r*.22,r*.52,r*.58);ctx.bezierCurveTo(r*.2,r*.89,-r*.1,r*.65,r*.2,r*.15);ctx.fill();
  const shadow=ctx.createLinearGradient(-r,-r,r,r);shadow.addColorStop(0,'#d5ff9f10');shadow.addColorStop(.45,'#08241d00');shadow.addColorStop(1,'#00130cc0');ctx.fillStyle=shadow;ctx.fillRect(-r,-r,r*2,r*2);
  ctx.restore();
  ctx.save();ctx.translate(cx,cy);ctx.rotate(-.4);
  ctx.beginPath();ctx.ellipse(0,0,r*1.35,r*.26,0,0,Math.PI);ctx.strokeStyle='#b9d38b55';ctx.lineWidth=1;ctx.stroke();ctx.restore();
}

function renderRock(x, y, size, rotation, seed) {
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);
  ctx.shadowBlur=12;ctx.shadowColor='#e97f5f55';ctx.fillStyle='#795044';ctx.strokeStyle=colors.coral;ctx.lineWidth=1.4;
  ctx.beginPath();
  for(let i=0;i<7;i++){const angle=i/7*TAU;const r=size*(.8+.2*Math.sin(seed+i*2.4));i===0?ctx.moveTo(Math.cos(angle)*r,Math.sin(angle)*r):ctx.lineTo(Math.cos(angle)*r,Math.sin(angle)*r);}
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.shadowBlur=0;ctx.strokeStyle='#d3886888';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-size*.42,-size*.2);ctx.lineTo(size*.1,-size*.45);ctx.lineTo(size*.38,0);ctx.stroke();
  ctx.restore();
}

function renderEnergy(x,y,size,phase){
  const pulse=1+Math.sin(ambientTime*4+phase)*.09;
  ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.shadowColor=colors.lime;ctx.shadowBlur=15;
  ctx.fillStyle=colors.lime;ctx.fillRect(-size*.5*pulse,-size*.5*pulse,size*pulse,size*pulse);
  ctx.shadowBlur=0;ctx.strokeStyle='#c6f47744';ctx.lineWidth=1;ctx.strokeRect(-size,-size,size*2,size*2);ctx.restore();
}

function renderEntities() {
  let shown = entities;
  if(state === 'intro') shown=[{type:'rock',lane:0,gap:1.55,size:.063,seed:2,rotation:ambientTime*.1},{type:'rock',lane:1,gap:3.7,size:.063,seed:4,rotation:-ambientTime*.13},{type:'energy',lane:1,gap:2.5,size:.042,seed:1},{type:'energy',lane:0,gap:5.4,size:.042,seed:3}];
  for(const entity of shown){
    if(entity.gone)continue;
    const radius=(entity.lane===0?INNER_RADIUS:1)*unit;
    const angle=playerAngle+entity.gap;
    const x=cx+Math.cos(angle)*radius,y=cy+Math.sin(angle)*radius;
    if(entity.type==='rock')renderRock(x,y,entity.size*unit,entity.rotation,entity.seed);
    else renderEnergy(x,y,entity.size*unit,entity.seed);
  }
}

function renderShip(){
  if(!shipVisible)return;
  for(const point of trail){const alpha=(1-point.age/.45)*.34;circle(cx+Math.cos(point.angle)*point.radius*unit,cy+Math.sin(point.angle)*point.radius*unit,2.2,`rgba(132,230,197,${alpha})`);}
  const x=cx+Math.cos(playerAngle)*playerRadius*unit,y=cy+Math.sin(playerAngle)*playerRadius*unit;
  const size=Math.max(8,unit*.052);
  ctx.save();ctx.translate(x,y);ctx.rotate(playerAngle+Math.PI/2);
  ctx.shadowBlur=16;ctx.shadowColor='#baf48299';
  ctx.fillStyle=colors.lime;ctx.beginPath();ctx.moveTo(size,0);ctx.lineTo(-size*.75,-size*.62);ctx.lineTo(-size*.4,0);ctx.lineTo(-size*.75,size*.62);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;ctx.fillStyle='#ecffe1';ctx.beginPath();ctx.moveTo(size*.65,0);ctx.lineTo(-size*.42,-size*.28);ctx.lineTo(-size*.2,0);ctx.closePath();ctx.fill();
  ctx.fillStyle=colors.mint;ctx.globalAlpha=.65;ctx.beginPath();ctx.moveTo(-size*.5,-size*.2);ctx.lineTo(-size*(1.2+Math.sin(ambientTime*28)*.15),0);ctx.lineTo(-size*.5,size*.2);ctx.fill();ctx.restore();
}

function render(){
  if(width===0||height===0)return;
  renderBackground();renderOrbits();renderPlanet();renderEntities();renderShip();
  for(const p of particles){ctx.globalAlpha=1-p.age/p.life;circle(p.x,p.y,p.size,p.color);}ctx.globalAlpha=1;
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
$('switch-button').addEventListener('click', switchOrbit);
$('sound-button').addEventListener('click', () => { soundOn=!soundOn;audio.unlock();syncSound();save();if(soundOn)audio.note(660,.13); });
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

syncSound();syncControls();updateHud();resize();requestAnimationFrame(frame);
if(import.meta.env.DEV)window.__game={get state(){return state;},get score(){return score;},get energy(){return energy;},get lane(){return lane;},get elapsed(){return elapsed;},get entities(){return entities.map(e=>({...e}));},start,pause,resume,switchOrbit,endFlight};
