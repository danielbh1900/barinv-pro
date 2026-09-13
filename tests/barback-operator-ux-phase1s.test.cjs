const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');
const voiceStart = html.indexOf('const VoiceGuide = {');
const voiceEnd = html.indexOf('let phase1MeasureUnit', voiceStart);
const voice = html.slice(voiceStart, voiceEnd);
const controls = html.slice(html.indexOf('function initPhase1VoiceControl'), html.indexOf('let phase1MeasureUnit'));

test('Phase 1S uses accurate ON/OFF phrases for toggle and direct Test Voice', () => {
  assert.match(voice, /const phrase = phraseOverride \|\| \(this\.enabled \? 'Voice Guide is on\.' : 'Voice test\. Guide is off\.'\);/);
  assert.match(controls, /const wasEnabled = VoiceGuide\.enabled;[\s\S]*const enabled = VoiceGuide\.setEnabled\(!wasEnabled\);[\s\S]*VoiceGuide\.testVoice\(enabled \? 'Voice Guide is on\.' : 'Voice Guide is off\.'\);/);
  assert.match(controls, /phase1-voice-test[\s\S]*VoiceGuide\.testVoice\(\);/);
  assert.doesNotMatch(controls, /phase1-voice-test[\s\S]*setEnabled\(true\)/);
});

test('Phase 1S keeps Test Voice independent from operational voice state', () => {
  assert.match(voice, /testVoice\([^)]*\)[\s\S]*this\.lastVoiceTest = 'sent'/);
  assert.match(voice, /if \(!this\.enabled \|\| !this\.supported \|\| !message\) return false/);
  assert.match(voice, /lastOperationalVoice/);
  assert.match(html, /Voice Guide: Off/);
  assert.match(html, /Voice Guide: On/);
  assert.match(html, /Last voice test:/);
});

test('Phase 1S preserves independent item names, Phase 1R dispatcher, and Bluefy scale', () => {
  for (const marker of [
    'barbackVoiceGuideEnabled', 'barbackVoiceGuideSpeakItemNames', 'SPEAK ITEM NAMES',
    'announceOperationalState', 'Scanned, not added', 'Added to draft', 'Not added',
    'hasWebBluetoothScaleSupport', 'navigator.bluetooth.requestDevice', 'CONNECT / DETAILS',
    'SCALE DETAILS', 'ACCESSORY / TARE'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(voice, /if \(!this\.speakItemNames\) return this\.speak\(generic, options\)/);
  assert.doesNotMatch(voice, /AudioContext|new Audio\(/);
});
