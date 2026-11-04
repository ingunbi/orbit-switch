import test from 'node:test';
import assert from 'node:assert/strict';
import { Sound } from './audio.js';

function audioDevice({ stereo = true } = {}) {
  const device = { currentTime: 0, state: 'running', destination: {}, oscillators: [], gains: [], panners: [], resumed: 0 };
  const parameter = () => ({
    events: [],
    setValueAtTime(value, at) { this.events.push({ kind: 'value', value, at }); },
    setTargetAtTime(value, at) { this.events.push({ kind: 'target', value, at }); },
    exponentialRampToValueAtTime(value, at) { this.events.push({ kind: 'ramp', value, at }); },
    cancelScheduledValues() {}
  });
  const node = () => ({ connect() {}, disconnected: false, disconnect() { this.disconnected = true; } });
  device.createGain = () => {
    const gain = { ...node(), gain: parameter() };
    device.gains.push(gain);
    return gain;
  };
  device.createOscillator = () => {
    const oscillator = { ...node(), frequency: parameter(), starts: [], stops: [], start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); } };
    device.oscillators.push(oscillator);
    return oscillator;
  };
  if (stereo) device.createStereoPanner = () => {
    const panner = { ...node(), pan: parameter() };
    device.panners.push(panner);
    return panner;
  };
  device.resume = () => { device.resumed += 1; return Promise.resolve(); };
  device.advanceTo = (time) => {
    device.currentTime = time;
    for (const oscillator of device.oscillators) {
      if (!oscillator.ended && oscillator.stops.at(-1) <= time) {
        oscillator.ended = true;
        oscillator.onended?.();
      }
    }
  };
  return device;
}

test('muting stops active voices, prevents new sounds and reuses the audio device when enabled', () => {
  let enabled = false;
  let created = 0;
  const device = audioDevice();
  const sound = new Sound(() => enabled, () => { created += 1; return device; });
  sound.unlock();
  assert.equal(created, 0);
  enabled = true;
  sound.unlock();
  sound.start();
  assert.ok(device.oscillators.length > 0);
  const voices = device.oscillators.length;
  enabled = false;
  sound.unlock();
  assert.equal(device.gains[0].gain.events.at(-1).value, 0);
  assert.ok(device.oscillators.every((voice) => voice.stops.at(-1) <= device.currentTime + 0.04));
  sound.collect(3, 1);
  assert.equal(device.oscillators.length, voices);
  enabled = true;
  sound.unlock();
  assert.equal(created, 1);
  assert.ok(device.gains[0].gain.events.at(-1).value > 0);
});

test('background rhythm pauses and schedules one beat after a delayed frame instead of catching up', () => {
  const device = audioDevice();
  const sound = new Sound(() => true, () => device);
  sound.unlock();
  sound.setPlaying(true);
  sound.tick(0);
  assert.equal(device.oscillators.length, 0);
  device.currentTime = 0.2;
  sound.tick(0.2);
  assert.equal(device.oscillators.length, 2);
  sound.tick(0.2);
  assert.equal(device.oscillators.length, 2);
  device.currentTime = 120;
  sound.tick(120, 4);
  assert.equal(device.oscillators.length, 3);
  sound.setPlaying(false);
  assert.equal(device.gains[1].gain.events.at(-1).value, 0);
  device.currentTime = 130;
  sound.tick(130, 4);
  assert.equal(device.oscillators.length, 3);
  sound.crash();
  const afterCrash = device.oscillators.length;
  assert.ok(afterCrash > 3);
  sound.setPlaying(true);
  sound.tick(130, 4);
  assert.equal(device.oscillators.length, afterCrash);
  device.currentTime = 130.2;
  sound.tick(130.2, 4);
  assert.ok(device.oscillators.length > afterCrash && device.oscillators.length <= afterCrash + 3);
});

test('finished tones disconnect their nodes and stereo is optional', () => {
  const device = audioDevice();
  const sound = new Sound(() => true, () => device);
  sound.unlock();
  sound.switch(1);
  assert.ok(device.panners.every((panner) => panner.pan.events[0].value > 0));
  for (const voice of device.oscillators) voice.onended();
  assert.ok(device.oscillators.every((voice) => voice.disconnected));
  assert.ok(device.gains.slice(2).every((gain) => gain.disconnected));
  assert.ok(device.panners.every((panner) => panner.disconnected));
  const mono = audioDevice({ stereo: false });
  const fallback = new Sound(() => true, () => mono);
  fallback.unlock();
  fallback.collect(9);
  assert.ok(mono.oscillators.length > 0);
});

test('missing or failing audio devices never prevent gameplay calls', () => {
  for (const factory of [() => null, () => { throw new Error('audio blocked'); }]) {
    const sound = new Sound(() => true, factory);
    assert.doesNotThrow(() => {
      sound.unlock(); sound.setPlaying(true); sound.start(); sound.switch();
      sound.collect(3); sound.sector(2); sound.tick(60); sound.surge(); sound.setPlaying(false); sound.crash();
    });
  }
});

test('maximum combo adds occasional quiet harmony without increasing the music bus level', () => {
  const playPhrase = (multiplier) => {
    const device = audioDevice();
    const sound = new Sound(() => true, () => device);
    sound.unlock(); sound.setPlaying(true); sound.tick(0, multiplier);
    for (let beat = 1; beat <= 8; beat++) {
      device.advanceTo(beat * 0.5);
      sound.tick(device.currentTime, multiplier);
    }
    return { device, sound };
  };
  const normal = playPhrase(1);
  const maximum = playPhrase(4);
  assert.ok(maximum.device.oscillators.length > normal.device.oscillators.length);
  assert.ok(maximum.device.oscillators.length <= normal.device.oscillators.length + 4);
  assert.equal(maximum.sound.music.gain.events.at(-1).value, normal.sound.music.gain.events.at(-1).value);
  const musicPeaks = maximum.device.gains.slice(2).flatMap((node) => node.gain.events.filter((event) => event.kind === 'ramp').map((event) => event.value));
  assert.ok(musicPeaks.every((value) => value <= 0.028));
});

test('surge is a short three-note response that cannot pile up from repeated calls or play while paused', () => {
  const device = audioDevice();
  const sound = new Sound(() => true, () => device);
  sound.unlock(); sound.setPlaying(true);
  sound.surge();
  assert.equal(device.oscillators.length, 3);
  assert.ok(device.oscillators.every((voice) => voice.starts[0] >= device.currentTime + 0.1));
  for (let repeat = 0; repeat < 10; repeat++) sound.surge();
  assert.equal(device.oscillators.length, 3);
  device.advanceTo(0.8);
  sound.surge();
  assert.equal(device.oscillators.length, 6);
  sound.setPlaying(false);
  device.advanceTo(1.6);
  sound.surge();
  assert.equal(device.oscillators.length, 6);
});

test('extended maximum-combo playback releases accent nodes and muting cancels a pending surge', () => {
  let enabled = true;
  const device = audioDevice();
  const sound = new Sound(() => enabled, () => device);
  sound.unlock(); sound.setPlaying(true); sound.tick(0, 4);
  let chain = 0;
  for (let step = 1; step <= 900; step++) {
    device.advanceTo(step * 0.2);
    sound.tick(device.currentTime, 4);
    if (step % 4 === 0) {
      chain += 1;
      sound.collect(chain, chain % 2);
      if (chain >= 12 && chain % 6 === 0) sound.surge();
    }
    assert.ok(sound.voices.size < 24);
  }
  device.advanceTo(181);
  sound.surge();
  assert.ok(sound.voices.size > 0);
  const beforeMute = device.oscillators.length;
  enabled = false;
  sound.unlock();
  sound.collect(228); sound.surge(); sound.tick(181, 4);
  assert.equal(device.oscillators.length, beforeMute);
  device.advanceTo(181.1);
  assert.equal(sound.voices.size, 0);
  assert.ok(device.oscillators.every((voice) => voice.disconnected));
  assert.ok(device.gains.slice(2).every((gain) => gain.disconnected));
  assert.ok(device.panners.every((panner) => panner.disconnected));
  assert.equal(sound.master.gain.events.at(-1).value, 0);
});
