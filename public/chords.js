/* Chord engine shared by the browser and the server (UMD).
 * Handles chords-over-lyrics charts and inline ChordPro ([G]word) text:
 * transpose with correct sharps/flats, slash chords, Nashville numbers,
 * key detection, and conversion between the two formats. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chords = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const DEG = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
  const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  const norm = t => String(t ?? '').replace(/\r\n?/g, '\n');
  const mod = n => ((n % 12) + 12) % 12;
  const idx = (letter, acc) => mod(BASE[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0));
  const noteName = (i, flats) => (flats ? FLAT : SHARP)[mod(i)];

  // Quality part of a chord: m7, maj7, sus4, add9, b5, 6/9, (add9) ...
  const QUAL = /^(?:maj|min|dim|aug|sus|add|omit|no|alt|m|M|\+|-|°|ø|\d+|[#b]\d+|\(|\)|,|\/\d+)*$/;

  function parse(token) {
    const m = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(token);
    if (!m || !QUAL.test(m[3])) return null;
    return { root: idx(m[1], m[2]), q: m[3], bass: m[4] ? idx(m[4], m[5]) : null };
  }

  const LABEL = /^\s*(?:intro|verse|chorus|pre[- ]?chorus|bridge|tag|outro|interlude|instrumental|ending|coda|turnaround|refrain|vamp)\s*\d*\s*:\s*/i;
  const SECTION = /^\s*[\[(]?\s*(?:intro|verse|chorus|pre[- ]?chorus|bridge|outro|interlude|instrumental|ending|coda|turnaround|refrain|vamp)\b[^:\n]*[\])]?\s*:?\s*$/i;
  const FILLER = /^(?:\|+|-+|–|\/+|x\d+|\d+x|\(?x\d+\)?|N\.?C\.?|%|\.+|~+)$/i;

  const isSection = l => l.trim().length <= 24 && SECTION.test(l);
  const chordish = w => !!(parse(w) || parse(w.replace(/^\(+|\)+$/g, '')));

  function isChordLine(line) {
    const words = line.replace(LABEL, '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return false;
    let chords = 0;
    for (const w of words) {
      if (chordish(w)) chords++;
      else if (!FILLER.test(w)) return false;
    }
    return chords > 0;
  }

  const classify = text => norm(text).split('\n').map(t => ({
    t, k: !t.trim() ? 'b' : isChordLine(t) ? 'c' : isSection(t) ? 's' : 'l'
  }));

  // Replace one token, tolerating wrapping parentheses: (G)
  function mapToken(w, fn) {
    if (parse(w)) return fn(w);
    const m = /^(\(*)(.+?)(\)*)$/.exec(w);
    return m && parse(m[2]) ? m[1] + fn(m[2]) + m[3] : w;
  }

  // Re-lay a chord line so chords keep their original columns when widths change.
  function shiftLine(line, fn) {
    let out = '';
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line))) {
      const t = mapToken(m[0], fn);
      if (out.length < m.index) out += ' '.repeat(m.index - out.length);
      else if (out.length && !out.endsWith(' ')) out += ' ';
      out += t;
    }
    return out;
  }

  // Apply fn(chordToken) to every chord in chord lines and in [bracket] chords.
  function mapChords(text, fn) {
    return norm(text).split('\n').map(line => {
      if (isChordLine(line)) return shiftLine(line, fn);
      return line.replace(/\[([^\]\n]+)\]/g, (all, c) => (parse(c) ? '[' + fn(c) + ']' : all));
    }).join('\n');
  }

  function keyInfo(key) {
    const m = /^\s*([A-G])([#b]?)(.*)$/.exec(String(key || ''));
    if (!m) return null;
    return { root: idx(m[1], m[2]), acc: m[2], rest: m[3], minor: /^m(?!aj)/.test(m[3]) };
  }
  function useFlats(key) {
    const k = keyInfo(key);
    if (!k) return false;
    if (k.acc === 'b') return true;
    return (k.minor ? [0, 2, 3, 5, 7, 10] : [1, 3, 5, 8, 10]).includes(k.root);
  }
  function transposeKey(key, n, flats) {
    const m = /^(\s*)([A-G])([#b]?)(.*)$/.exec(String(key || ''));
    return m ? m[1] + noteName(idx(m[2], m[3]) + n, flats) + m[4] : key;
  }
  function semitones(from, to) {
    const a = keyInfo(from), b = keyInfo(to);
    return a && b ? mod(b.root - a.root) : null;
  }

  function transposeText(text, n, opts = {}) {
    n = mod(n);
    if (!n) return norm(text);
    const flats = !!opts.flats;
    return mapChords(text, t => {
      const p = parse(t);
      return noteName(p.root + n, flats) + p.q + (p.bass != null ? '/' + noteName(p.bass + n, flats) : '');
    });
  }

  function toNumbers(text, key) {
    const k = keyInfo(key);
    if (!k) return norm(text);
    return mapChords(text, t => {
      const p = parse(t);
      return DEG[mod(p.root - k.root)] + p.q + (p.bass != null ? '/' + DEG[mod(p.bass - k.root)] : '');
    });
  }

  function chordsUsed(text) {
    const seen = [];
    mapChords(text, t => { if (!seen.includes(t)) seen.push(t); return t; });
    return seen;
  }

  function stripChords(text) {
    return classify(text).filter(l => l.k !== 'c')
      .map(l => l.t.replace(/\[([^\]\n]+)\]/g, (a, c) => (parse(c) ? '' : a)))
      .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Guess the key from diatonic fit plus first/last chord.
  function detectKey(text) {
    const list = [];
    mapChords(text, t => { list.push(parse(t)); return t; });
    if (!list.length) return '';
    const type = p => (/^dim|^°|^ø/.test(p.q) ? 'd' : /^m(?!aj)|^min/.test(p.q) ? 'm' : 'M');
    const first = list[0], last = list[list.length - 1];
    let best = null;
    for (let r = 0; r < 12; r++) {
      const scale = { [r]: 'M', [mod(r + 2)]: 'm', [mod(r + 4)]: 'm', [mod(r + 5)]: 'M', [mod(r + 7)]: 'M', [mod(r + 9)]: 'm', [mod(r + 11)]: 'd' };
      let score = list.filter(p => scale[p.root] === type(p) || (scale[p.root] === 'M' && type(p) === 'M')).length;
      let major = 0, minor = 0;
      if (last.root === r && type(last) === 'M') major += 3;
      if (first.root === r && type(first) === 'M') major += 2;
      if (last.root === mod(r + 9) && type(last) === 'm') minor += 3;
      if (first.root === mod(r + 9) && type(first) === 'm') minor += 2;
      score += Math.max(major, minor);
      if (!best || score > best.score) best = { r, score, minor: minor > major };
    }
    const root = best.minor ? mod(best.r + 9) : best.r;
    return KEY_NAMES[root] + (best.minor ? 'm' : '');
  }

  // Chords-over-lyrics  ->  inline ChordPro ([G]Amazing [D]grace)
  function overToInline(text) {
    const L = norm(text).split('\n'), out = [];
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (!isChordLine(l)) { out.push(l); continue; }
      const next = L[i + 1];
      const items = [];
      const re = /\S+/g;
      let m;
      while ((m = re.exec(l))) if (parse(m[0])) items.push([m.index, m[0]]);
      if (!LABEL.test(l) && next !== undefined && next.trim() && !isChordLine(next) && !isSection(next)) {
        let s = next;
        for (const [c, w] of items.reverse()) {
          if (s.length < c) s = s.padEnd(c);
          s = s.slice(0, c) + '[' + w + ']' + s.slice(c);
        }
        out.push(s.trimEnd());
        i++;
      } else {
        const label = (LABEL.exec(l) || [''])[0];
        out.push(label + l.slice(label.length).trim().split(/\s+/).map(w => (parse(w) ? '[' + w + ']' : w)).join(' '));
      }
    }
    return out.join('\n');
  }

  // Inline ChordPro  ->  chords-over-lyrics. Also returns {title, artist, key, capo, tempo}.
  function inlineToOver(text) {
    const meta = {}, out = [];
    const alias = { t: 'title', title: 'title', st: 'artist', subtitle: 'artist', artist: 'artist', key: 'key', capo: 'capo', tempo: 'tempo' };
    for (const raw of norm(text).split('\n')) {
      const d = /^\s*\{\s*(\w+)\s*:?\s*(.*?)\s*\}\s*$/.exec(raw);
      if (d) {
        const k = d[1].toLowerCase();
        if (alias[k]) meta[alias[k]] = d[2];
        else if (k === 'c' || k === 'comment' || k === 'ci') out.push('[' + d[2] + ']');
        else if (k === 'soc' || k === 'start_of_chorus') out.push('[Chorus]');
        else if (k === 'sov' || k === 'start_of_verse') out.push('[Verse]');
        else if (k === 'sob' || k === 'start_of_bridge') out.push('[Bridge]');
        continue;
      }
      if (!/\[[^\]]+\]/.test(raw)) { out.push(raw); continue; }
      let lyric = '', chords = '', any = false;
      for (const part of raw.split(/(\[[^\]]+\])/)) {
        const inner = /^\[(.+)\]$/.exec(part);
        if (inner && parse(inner[1])) {
          const col = Math.max(lyric.length, chords.length ? chords.length + 1 : 0);
          lyric = lyric.padEnd(col);
          chords = chords.padEnd(col) + inner[1];
          any = true;
        } else lyric += part;
      }
      if (!any) { out.push(raw); continue; }
      out.push(chords.trimEnd());
      if (lyric.trim()) out.push(lyric.trimEnd());
    }
    return { text: out.join('\n'), meta };
  }

  return { parse, isChordLine, isSection, classify, transposeText, transposeKey, semitones, useFlats, keyInfo,
    toNumbers, chordsUsed, stripChords, detectKey, overToInline, inlineToOver, KEY_NAMES, norm };
});
