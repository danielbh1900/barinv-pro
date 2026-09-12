const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

test('Phase 1M adds an explicit Voice Guide control and local preference', () => {
  assert.match(html, /id="phase1-voice-guide"/);
  assert.match(html, /id="phase1-voice-toggle"/);
  assert.match(html, /id="phase1-voice-test"/);
  assert.match(html, /Voice Guide: Off/);
  assert.match(html, /const BARBACK_VOICE_GUIDE_KEY = 'barbackVoiceGuideEnabled'/);
  assert.match(html, /localStorage\.getItem\(BARBACK_VOICE_GUIDE_KEY\)/);
  assert.match(html, /localStorage\.setItem\(BARBACK_VOICE_GUIDE_KEY/);
});

test('Phase 1M uses spoken browser voice with safe unsupported handling', () => {
  const start = html.indexOf('const VoiceGuide = {');
  const end = html.indexOf('let phase1MeasureUnit', start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /window\.speechSynthesis/);
  assert.match(source, /window\.SpeechSynthesisUtterance/);
  assert.match(source, /Voice unavailable on this browser/);
  assert.match(source, /Tap Test Voice to enable audio/);
  assert.doesNotMatch(source, /AudioContext|new Audio\(/);
});

test('Phase 1M keeps voice announcements short, deduplicated, and user-enabled', () => {
  assert.match(html, /if \(!this\.enabled \|\| !this\.supported \|\| !message\) return false/);
  assert.match(html, /lastMessage === message && now - this\.lastSpokenAt < wait/);
  assert.match(html, /if \(opts\.urgent\) window\.speechSynthesis\.cancel\(\)/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('scanned'/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('blocked'/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('added'/);
  assert.match(html, /VoiceGuide\.announceOperationalState\('failed'/);
});

test('Phase 1M preserves Phase 1J/1K/1L surfaces and adds no persistence path', () => {
  for (const marker of [
    'SCANNED — NOT ADDED YET', 'ADDED TO DRAFT', 'MEASURED WEIGHT ON SCALE',
    'ACCESSORY / TARE', 'NO CAP / 0g', 'BOTTLE CAP / −4g',
    'POUR SPOUT / −16g', 'CUSTOM TARE', 'NET SAVED WEIGHT',
    'Enter measured gross weight', 'RETURNED UNITS', 'BOTTLE / ITEM QUANTITY'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const voiceStart = html.indexOf('const VoiceGuide = {');
  const voiceEnd = html.indexOf('let phase1MeasureUnit', voiceStart);
  const source = html.slice(voiceStart, voiceEnd);
  assert.doesNotMatch(source, /eventsInsert|saveCore|addToReview|syncOutbox|fetch\(|\.from\(/);
});
