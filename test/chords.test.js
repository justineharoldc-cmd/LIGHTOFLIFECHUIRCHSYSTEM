const test = require('node:test'), assert = require('node:assert');
const C = require('../public/chords.js');

test('transposes chord lines and keeps column alignment', () => {
  assert.strictEqual(C.transposeText('G  D/F#  Em7  C', 2), 'A  E/G#  F#m7 D');
});
test('uses flats when asked', () => {
  assert.strictEqual(C.transposeText('C F G', 3, { flats: true }), 'Eb Ab Bb');
});
test('does not touch lyrics that merely start with a note letter', () => {
  const s = 'Amazing grace how sweet\nBe still and know';
  assert.strictEqual(C.transposeText(s, 5), s);
});
test('labelled chord lines (Intro: G D) transpose', () => {
  assert.strictEqual(C.transposeText('Intro: G D Em C', 2), 'Intro: A E F#m D');
});
test('inline bracket chords transpose', () => {
  assert.strictEqual(C.transposeText('[G]Amazing [D/F#]grace', 2), '[A]Amazing [E/G#]grace');
});
test('key helpers', () => {
  assert.strictEqual(C.semitones('G', 'Bb'), 3);
  assert.strictEqual(C.transposeKey('Em', 3, false), 'Gm');
  assert.strictEqual(C.useFlats('Bb'), true);
  assert.strictEqual(C.useFlats('G'), false);
});
test('detects key', () => {
  assert.strictEqual(C.detectKey('G  D  Em  C\nG  D  C'), 'G');
  assert.strictEqual(C.detectKey('Am  F  C  G\nAm'), 'Am');
});
test('nashville numbers', () => {
  assert.strictEqual(C.toNumbers('G  D/F#  Em  C', 'G'), '1  5/7   6m  4');
});
test('chords over lyrics <-> ChordPro round trip', () => {
  const over = 'G       D\nAmazing grace';
  const inline = C.overToInline(over);
  assert.strictEqual(inline, '[G]Amazing [D]grace');
  assert.strictEqual(C.inlineToOver(inline).text, over);
});
test('ChordPro directives become metadata', () => {
  const r = C.inlineToOver('{title: Test}\n{key: A}\n{soc}\n[A]Hello');
  assert.deepStrictEqual(r.meta, { title: 'Test', key: 'A' });
  assert.strictEqual(r.text, '[Chorus]\nA\nHello');
});
test('strips chords for lyrics-only view', () => {
  assert.strictEqual(C.stripChords('[Verse]\nG   D\nHello world\n[C]Again'), '[Verse]\nHello world\nAgain');
});
