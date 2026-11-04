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
  assert.equal(device.oscillators.length, 5);
  sound.setPlaying(true);
  sound.tick(130, 4);
  assert.equal(device.oscillators.length, 5);
  device.currentTime = 130.2;
  sound.tick(130.2, 4);
  assert.equal(device.oscillators.length, 6);
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
      sound.collect(3); sound.sector(2); sound.tick(60); sound.setPlaying(false); sound.crash();
    });
  }
});
