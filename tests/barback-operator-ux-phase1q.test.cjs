const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');
const voiceStart = html.indexOf('const VoiceGuide = {');
const voiceEnd = html.indexOf('let phase1MeasureUnit', voiceStart);
const voice = html.slice(voiceStart, voiceEnd);

test('Phase 1Q adds safe Voice Guide diagnostics', () => {
  for (const marker of [
    'id="phase1-voice-diagnostics"',
    'Speech API:',
    'Utterance API:',
    'Voices loaded:',
    'Last voice test:',
    'id="phase1-voice-last-test"',
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
});

test('Phase 1Q requires callable speech APIs and tracks loaded voices', () => {
  assert.match(voice, /window\.speechSynthesis/);
  assert.match(voice, /typeof synth\.speak === 'function'/);
  assert.match(voice, /typeof window\.SpeechSynthesisUtterance === 'function'/);
  assert.match(voice, /synth\.getVoices\(\)/);
  assert.match(voice, /voiceschanged/);
  assert.match(voice, /this\.voices\.length \? String\(this\.voices\.length\) : 'loading'/);
});

test('Phase 1Q Test Voice is direct, uncoupled from message throttle, and safe when blocked', () => {
  assert.match(voice, /testVoice\(\)/);
  assert.match(voice, /synth\.cancel\(\)/);
  assert.match(voice, /const phrase = phraseOverride \|\| \(this\.enabled \? 'Voice Guide is on\.' : 'Voice test\. Guide is off\.'\);/);
  assert.match(voice, /new window\.SpeechSynthesisUtterance\(phrase\)/);
  assert.match(voice, /synth\.speak\(utterance\)/);
  assert.match(voice, /Voice blocked by this browser\. Try Test Voice again or use Safari for voice/);
  assert.match(voice, /this\.lastVoiceTest = 'sent'/);
  assert.match(voice, /lastVoiceTest = 'unavailable'/);
  const testVoiceStart = voice.indexOf('testVoice(');
  const testVoiceEnd = voice.indexOf('announceOperationalState(', testVoiceStart);
  assert.ok(testVoiceStart >= 0 && testVoiceEnd > testVoiceStart);
  assert.doesNotMatch(voice.slice(testVoiceStart, testVoiceEnd), /lastMessage === message/);
});

test('Phase 1Q preserves opt-in item names, local settings, scale, tare, and scan markers', () => {
  for (const marker of [
    "barbackVoiceGuideEnabled",
    "barbackVoiceGuideSpeakItemNames",
    'SPEAK ITEM NAMES',
    'hasWebBluetoothScaleSupport',
    'CONNECT / DETAILS',
    'ACCESSORY / TARE',
    'SCANNED — NOT ADDED YET',
    'SpeechSynthesisUtterance',
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(voice, /if \(!this\.speakItemNames\) return this\.speak\(generic, options\)/);
  assert.doesNotMatch(voice, /AudioContext|new Audio\(/);
  assert.doesNotMatch(voice, /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
