// Light of Life Church - Attendance & Songbook
// Zero dependencies: Node's built-in HTTP server + built-in SQLite (Node 22.5+).
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const Chords = require('./public/chords.js');

const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'church.db');
const PASSWORD = process.env.APP_PASSWORD || '';
const LYRICS_ON = process.env.LYRICS_PROVIDER !== 'off';

/* ---------- Daily backup (keeps the last 14) ---------- */
(function backup() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const dir = path.join(path.dirname(DB_FILE), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `church-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(f)) fs.copyFileSync(DB_FILE, f);
    fs.readdirSync(dir).filter(n => /^church-.*\.db$/.test(n)).sort().slice(0, -14)
      .forEach(n => fs.unlinkSync(path.join(dir, n)));
  } catch (e) { console.warn('Backup skipped:', e.message); }
})();

/* ---------- Database + migrations (safe on existing church.db files) ---------- */
const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS members(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '',
  ministry TEXT DEFAULT '', joined TEXT DEFAULT '', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS services(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attendance(
  id INTEGER PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  visitor_name TEXT, checkin_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(service_id, member_id));
CREATE INDEX IF NOT EXISTS idx_att_service ON attendance(service_id);
CREATE INDEX IF NOT EXISTS idx_att_member ON attendance(member_id);
CREATE TABLE IF NOT EXISTS songs(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, artist TEXT DEFAULT '', song_key TEXT DEFAULT '', capo TEXT DEFAULT '',
  lyrics TEXT DEFAULT '', chords TEXT DEFAULT '', notes TEXT DEFAULT '', source_url TEXT DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title COLLATE NOCASE);`);
const hasCol = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
for (const [c, def] of [['chart', "TEXT DEFAULT ''"], ['tags', "TEXT DEFAULT ''"], ['tempo', "TEXT DEFAULT ''"], ['ccli', "TEXT DEFAULT ''"]])
  if (!hasCol('songs', c)) db.exec(`ALTER TABLE songs ADD COLUMN ${c} ${def}`);
// Older versions kept chords and lyrics in two boxes; merge them into one chart.
db.exec(`UPDATE songs SET chart = TRIM(COALESCE(chords,'') || CHAR(10) || CHAR(10) || COALESCE(lyrics,''))
  WHERE COALESCE(chart,'') = '' AND (COALESCE(chords,'') <> '' OR COALESCE(lyrics,'') <> '')`);

const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => { const r = db.prepare(sql).run(...p); return { id: Number(r.lastInsertRowid), changes: Number(r.changes) }; };
const fail = (msg, status = 400, extra = {}) => { throw Object.assign(new Error(msg), { status, extra }); };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const send = (res, code, data, type = 'application/json', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
};
const readBody = req => new Promise((ok, no) => {
  let s = '', n = 0;
  req.on('data', c => { n += c.length; if (n > 2e6) { no(Object.assign(new Error('Request too large.'), { status: 413 })); req.destroy(); } else s += c; });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { no(Object.assign(new Error('Invalid request body.'), { status: 400 })); } });
  req.on('error', no);
});
// CSV: quote cells, and neutralise spreadsheet formulas (=, +, -, @).
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
const csv = (head, rows) => '\uFEFF' + [head.join(',')].concat(rows.map(r => r.map(csvCell).join(','))).join('\r\n');

/* ---------- Word (.docx) writer, no dependencies ---------- */
const xml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipStore(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nb = Buffer.from(name), data = Buffer.from(content), crc = crc32(data), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    locals.push(h, nb, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(offset, 42);
    centrals.push(c, nb); offset += h.length + nb.length + data.length;
  }
  const cd = Buffer.concat(centrals), n = Object.keys(files).length, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
function docxForSong(song) {
  const run_ = (t, o = {}) => `<w:r><w:rPr>${o.font ? `<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}" w:cs="${o.font}"/>` : ''}${o.b ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}<w:sz w:val="${o.sz || 22}"/></w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;
  const para = (r, o = {}) => `<w:p><w:pPr><w:keepNext w:val="${o.keep ? 1 : 0}"/><w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}" w:line="${o.line || 252}" w:lineRule="auto"/></w:pPr>${r}</w:p>`;
  const body = [para(run_(song.title, { font: 'Georgia', b: 1, sz: 40 }), { after: 40 })];
  const meta = [song.artist, song.song_key && 'Key: ' + song.song_key, song.capo && 'Capo: ' + song.capo, song.tempo && 'Tempo: ' + song.tempo, song.ccli && 'CCLI #' + song.ccli].filter(Boolean).join('   |   ');
  if (meta) body.push(para(run_(meta, { color: '5B6B7B', sz: 20 }), { after: 240 }));
  for (const l of Chords.classify(song.chart || '')) {
    if (l.k === 'c') body.push(para(run_(l.t, { font: 'Courier New', b: 1, color: 'B06A00', sz: 21 }), { keep: 1 }));
    else if (l.k === 's') body.push(para(run_(l.t.replace(/[\[\]]/g, '').trim(), { font: 'Courier New', b: 1, color: '1B3A57', sz: 21 }), { before: 200, keep: 1 }));
    else body.push(para(run_(l.t, { font: 'Courier New', sz: 21 })));
  }
  if (!song.chart) body.push(para(run_('No chords or lyrics entered yet.', { color: '5B6B7B' })));
  if (song.notes) { body.push(para(run_('Notes', { b: 1, sz: 24 }), { before: 320, after: 60 })); for (const l of song.notes.split('\n')) body.push(para(run_(l))); }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"', H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipStore({
    '[Content_Types].xml': H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': H + `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
    'word/document.xml': H + `<w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
  });
}

/* ---------- Songs ---------- */
const normTags = v => [...new Set(String(v ?? '').split(',').map(t => t.trim().slice(0, 24)).filter(Boolean))].slice(0, 8).join(',');
const songFields = b => ({
  title: str(b.title), artist: str(b.artist), song_key: str(b.song_key, 12), capo: str(b.capo, 12), tempo: str(b.tempo, 20),
  tags: normTags(b.tags), ccli: str(b.ccli, 16), notes: String(b.notes ?? '').slice(0, 4000),
  chart: Chords.norm(b.chart).slice(0, 60000), source_url: /^https?:\/\//i.test(str(b.source_url, 500)) ? str(b.source_url, 500) : ''
});
const SONG_COLS = 'id,title,artist,song_key,capo,tempo,tags,ccli,notes,source_url,updated_at,chart';
function renderSong(row, q) {
  let steps = parseInt(q.get('steps') || '0', 10) || 0, key = row.song_key;
  const toKey = q.get('key');
  if (toKey) { steps = Chords.semitones(row.song_key, toKey); if (steps == null) fail('Set the song key first, then choose a new key.'); }
  const newKey = steps ? Chords.transposeKey(key, steps, false) : key;
  const flats = q.has('flats') ? q.get('flats') === '1' : Chords.useFlats(toKey || newKey);
  let chart = steps ? Chords.transposeText(row.chart, steps, { flats }) : row.chart;
  if (steps) key = Chords.transposeKey(row.song_key, steps, flats);
  const notation = q.get('notation');
  if (notation === 'numbers') chart = Chords.toNumbers(chart, key);
  if (notation === 'lyrics') chart = Chords.stripChords(chart);
  return { ...row, chart, song_key: key, steps: ((steps % 12) + 12) % 12, chords_used: Chords.chordsUsed(chart) };
}
const slug = s => (String(s || 'song').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'song');

// Lyrics providers. LRCLIB needs no key. Musixmatch is optional (MUSIXMATCH_API_KEY).
const UA = { 'User-Agent': 'LightOfLifeSongbook/2.0', Accept: 'application/json' };
const getJSON = async url => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const providers = {
  lrclib: {
    label: 'LRCLIB', enabled: () => true,
    async search(q) {
      const d = await getJSON('https://lrclib.net/api/search?q=' + encodeURIComponent(q));
      return d.slice(0, 8).map(t => ({ source: 'lrclib', id: String(t.id), title: t.trackName, artist: t.artistName, album: t.albumName || '', has_lyrics: !!t.plainLyrics && !t.instrumental }));
    },
    async lyrics(id) { const t = await getJSON('https://lrclib.net/api/get/' + encodeURIComponent(id)); return { lyrics: t.plainLyrics || '', notice: '' }; }
  },
  musixmatch: {
    label: 'Musixmatch', enabled: () => !!process.env.MUSIXMATCH_API_KEY,
    async search(q) {
      const u = new URL('https://api.musixmatch.com/ws/1.1/track.search');
      u.search = new URLSearchParams({ apikey: process.env.MUSIXMATCH_API_KEY, q, page_size: '8', s_track_rating: 'desc' });
      const d = await getJSON(u);
      return (d.message?.body?.track_list || []).map(v => ({ source: 'musixmatch', id: String(v.track.track_id), title: v.track.track_name, artist: v.track.artist_name, album: v.track.album_name || '', has_lyrics: !!v.track.has_lyrics }));
    },
    async lyrics(id) {
      const u = new URL('https://api.musixmatch.com/ws/1.1/track.lyrics.get');
      u.search = new URLSearchParams({ apikey: process.env.MUSIXMATCH_API_KEY, track_id: id });
      const l = (await getJSON(u)).message?.body?.lyrics;
      return { lyrics: (l?.lyrics_body || '').replace(/\n?\*{5,}[\s\S]*$/, '').trim(), notice: l?.lyrics_copyright || '' };
    }
  }
};
const searchCache = new Map();
async function searchSongs(q) {
  const google_url = 'https://www.google.com/search?q=' + encodeURIComponent(q + ' lyrics chords');
  if (!LYRICS_ON) return { results: [], providers: {}, disabled: true, google_url };
  const hit = searchCache.get(q.toLowerCase());
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  const names = Object.keys(providers).filter(n => providers[n].enabled());
  const settled = await Promise.allSettled(names.map(n => providers[n].search(q)));
  const status = {}, seen = new Set(), results = [];
  settled.forEach((s, i) => {
    status[names[i]] = s.status === 'fulfilled' ? 'ok' : 'unavailable';
    if (s.status === 'fulfilled') for (const r of s.value) {
      const k = (r.title + '|' + r.artist).toLowerCase();
      if (!seen.has(k)) { seen.add(k); results.push(r); }
    }
  });
  const v = { results, providers: status, google_url };
  if (Object.values(status).some(x => x === 'ok')) searchCache.set(q.toLowerCase(), { t: Date.now(), v });
  return v;
}

/* ---------- API ---------- */
async function handleApi(req, res, p, q) {
  const m = req.method; let x;

  // Members
  if (p === '/members' && m === 'GET') return send(res, 200, all(`
    SELECT mb.*, (SELECT COUNT(*) FROM attendance a WHERE a.member_id=mb.id) AS attended,
      (SELECT MAX(s.date) FROM attendance a JOIN services s ON s.id=a.service_id WHERE a.member_id=mb.id) AS last_seen
    FROM members mb ORDER BY mb.name COLLATE NOCASE`));
  if (p === '/members' && m === 'POST') {
    const b = await readBody(req); if (!str(b.name)) fail('Name is required.');
    return send(res, 201, run('INSERT INTO members(name,phone,ministry,joined) VALUES(?,?,?,?)', str(b.name), str(b.phone, 40), str(b.ministry, 80), str(b.joined, 10)));
  }
  if (p === '/members/import' && m === 'POST') {
    const b = await readBody(req); let added = 0, skipped = 0;
    const have = new Set(all('SELECT name FROM members').map(r => r.name.toLowerCase()));
    for (const line of String(b.text || '').split(/\r?\n/)) {
      const [name, phone, ministry] = line.split(/\t|,/).map(s => s.trim());
      if (!name) continue;
      if (have.has(name.toLowerCase())) { skipped++; continue; }
      run('INSERT INTO members(name,phone,ministry) VALUES(?,?,?)', name.slice(0, 200), (phone || '').slice(0, 40), (ministry || '').slice(0, 80));
      have.add(name.toLowerCase()); added++;
    }
    return send(res, 200, { added, skipped });
  }
  if ((x = p.match(/^\/members\/(\d+)$/))) {
    const id = +x[1];
    if (m === 'PUT') {
      const b = await readBody(req); if (!str(b.name)) fail('Name is required.');
      run('UPDATE members SET name=?,phone=?,ministry=?,joined=?,active=? WHERE id=?', str(b.name), str(b.phone, 40), str(b.ministry, 80), str(b.joined, 10), b.active === 0 ? 0 : 1, id);
      return send(res, 200, { ok: true });
    }
    if (m === 'DELETE') { run('DELETE FROM members WHERE id=?', id); return send(res, 200, { ok: true }); }
  }

  // Services & attendance
  if (p === '/services' && m === 'GET') return send(res, 200, all(`
    SELECT s.*, (SELECT COUNT(*) FROM attendance a WHERE a.service_id=s.id) AS total,
      (SELECT COUNT(*) FROM attendance a WHERE a.service_id=s.id AND a.member_id IS NULL) AS visitors
    FROM services s ORDER BY date DESC, id DESC`));
  if (p === '/services' && m === 'POST') {
    const b = await readBody(req);
    if (!str(b.name) || !/^\d{4}-\d{2}-\d{2}$/.test(str(b.date, 10))) fail('Service name and date are required.');
    return send(res, 201, run('INSERT INTO services(name,date) VALUES(?,?)', str(b.name), b.date));
  }
  if ((x = p.match(/^\/services\/(\d+)$/)) && m === 'DELETE') { run('DELETE FROM services WHERE id=?', +x[1]); return send(res, 200, { ok: true }); }
  if ((x = p.match(/^\/services\/(\d+)\/attendance$/)) && m === 'GET')
    return send(res, 200, all(`SELECT a.id, a.member_id, a.visitor_name, a.checkin_at, mb.name
      FROM attendance a LEFT JOIN members mb ON mb.id=a.member_id WHERE a.service_id=? ORDER BY a.id DESC`, +x[1]));
  if ((x = p.match(/^\/services\/(\d+)\/checkin$/)) && m === 'POST') {
    const b = await readBody(req), sid = +x[1];
    if (!one('SELECT id FROM services WHERE id=?', sid)) fail('Service not found.', 404);
    if (b.member_id) run('INSERT OR IGNORE INTO attendance(service_id,member_id) VALUES(?,?)', sid, +b.member_id);
    else if (str(b.visitor_name)) {
      const name = str(b.visitor_name);
      if (!one('SELECT id FROM attendance WHERE service_id=? AND member_id IS NULL AND visitor_name=? COLLATE NOCASE', sid, name))
        run('INSERT INTO attendance(service_id,visitor_name) VALUES(?,?)', sid, name);
    } else fail('Choose a member or enter a visitor name.');
    return send(res, 201, { ok: true });
  }
  if ((x = p.match(/^\/attendance\/(\d+)$/)) && m === 'DELETE') { run('DELETE FROM attendance WHERE id=?', +x[1]); return send(res, 200, { ok: true }); }
  if ((x = p.match(/^\/services\/(\d+)\/export\.csv$/)) && m === 'GET') {
    const s = one('SELECT * FROM services WHERE id=?', +x[1]); if (!s) fail('Service not found.', 404);
    const rows = all(`SELECT CASE WHEN a.member_id IS NULL THEN 'Visitor' ELSE 'Member' END t, COALESCE(mb.name,a.visitor_name) n, COALESCE(mb.phone,'') ph, COALESCE(mb.ministry,'') mi, a.checkin_at
      FROM attendance a LEFT JOIN members mb ON mb.id=a.member_id WHERE a.service_id=? ORDER BY t DESC, n COLLATE NOCASE`, s.id);
    return send(res, 200, csv(['Type', 'Name', 'Phone', 'Ministry', 'Checked in at'], rows.map(r => [r.t, r.n, r.ph, r.mi, r.checkin_at])), 'text/csv; charset=utf-8',
      { 'Content-Disposition': `attachment; filename="${slug(s.name)}-${s.date}.csv"` });
  }

  // Dashboard
  if (p === '/stats' && m === 'GET') {
    const recent = all(`SELECT s.id, s.name, s.date,
      (SELECT COUNT(*) FROM attendance a WHERE a.service_id=s.id) AS total,
      (SELECT COUNT(*) FROM attendance a WHERE a.service_id=s.id AND a.member_id IS NULL) AS visitors
      FROM services s ORDER BY date DESC, id DESC LIMIT 8`);
    const ids = recent.map(r => r.id), ph = n => ids.slice(0, n).map(() => '?').join(',');
    const active = all('SELECT id,name,phone,ministry FROM members WHERE active=1 ORDER BY name COLLATE NOCASE');
    const present = new Map();
    if (ids.length) for (const r of all(`SELECT service_id, member_id FROM attendance WHERE member_id IS NOT NULL AND service_id IN (${ph(ids.length)})`, ...ids)) {
      if (!present.has(r.service_id)) present.set(r.service_id, new Set());
      present.get(r.service_id).add(r.member_id);
    }
    const followup = [];
    if (recent.length >= 3) for (const mb of active) {
      let missed = 0;
      for (const s of recent) { if (present.get(s.id)?.has(mb.id)) break; missed++; }
      if (missed >= 3) followup.push({ ...mb, missed, last_seen: one('SELECT MAX(s.date) d FROM attendance a JOIN services s ON s.id=a.service_id WHERE a.member_id=?', mb.id)?.d || null });
    }
    followup.sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name));
    const visitors = ids.length ? all(`SELECT a.visitor_name AS name, s.date, s.name AS service FROM attendance a JOIN services s ON s.id=a.service_id
      WHERE a.member_id IS NULL AND a.service_id IN (${ph(3)}) ORDER BY s.date DESC, a.id DESC LIMIT 12`, ...ids.slice(0, 3)) : [];
    const trend = [...recent].reverse();
    return send(res, 200, { members: active.length, trend, last: recent[0] || null, services: recent.length,
      avg: trend.length ? Math.round(trend.reduce((a, b) => a + b.total, 0) / trend.length) : 0, followup, visitors });
  }
  if (p === '/export.csv' && m === 'GET') {
    const rows = all(`SELECT s.date, s.name AS service, CASE WHEN a.member_id IS NULL THEN 'Visitor' ELSE 'Member' END AS type,
      COALESCE(mb.name, a.visitor_name) AS person, COALESCE(mb.phone,'') AS phone, COALESCE(mb.ministry,'') AS ministry, a.checkin_at
      FROM attendance a JOIN services s ON s.id=a.service_id LEFT JOIN members mb ON mb.id=a.member_id ORDER BY s.date DESC, a.id`);
    return send(res, 200, csv(['Date', 'Service', 'Type', 'Name', 'Phone', 'Ministry', 'Checked in at'], rows.map(r => [r.date, r.service, r.type, r.person, r.phone, r.ministry, r.checkin_at])),
      'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="light-of-life-attendance.csv"' });
  }

  // Songbook
  if (p === '/songs' && m === 'GET') {
    const term = '%' + (q.get('q') || '').trim().replace(/[%_]/g, '') + '%', tag = (q.get('tag') || '').trim();
    const rows = all(`SELECT ${SONG_COLS} FROM songs WHERE (title LIKE ?1 OR artist LIKE ?1 OR tags LIKE ?1 OR chart LIKE ?1)
      AND (?2 = '' OR (',' || tags || ',') LIKE '%,' || ?2 || ',%') ORDER BY title COLLATE NOCASE`, term, tag);
    return send(res, 200, rows.map(({ chart, ...r }) => ({ ...r, has_chords: Chords.chordsUsed(chart).length > 0, has_lyrics: !!Chords.stripChords(chart) })));
  }
  if (p === '/songs/tags' && m === 'GET')
    return send(res, 200, [...new Set(all("SELECT tags FROM songs WHERE tags<>''").flatMap(r => r.tags.split(',')))].sort((a, b) => a.localeCompare(b)));
  if (p === '/songs' && m === 'POST') {
    const f = songFields(await readBody(req)); if (!f.title) fail('Song title is required.');
    const dup = one('SELECT id FROM songs WHERE title=? COLLATE NOCASE AND artist=? COLLATE NOCASE', f.title, f.artist);
    if (dup && !q.has('force')) fail('A song with this title and artist is already saved.', 409, { existing_id: dup.id });
    return send(res, 201, run(`INSERT INTO songs(title,artist,song_key,capo,tempo,tags,ccli,notes,source_url,chart) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      f.title, f.artist, f.song_key, f.capo, f.tempo, f.tags, f.ccli, f.notes, f.source_url, f.chart));
  }
  if (p === '/songs/search' && m === 'GET') {
    const term = (q.get('q') || '').trim(); if (!term) fail('Enter a song title or artist.');
    return send(res, 200, await searchSongs(term.slice(0, 120)));
  }
  if (p === '/songs/lyrics' && m === 'GET') {
    const prov = providers[q.get('source')], id = q.get('id');
    if (!LYRICS_ON || !prov || !prov.enabled()) fail('That lyrics source is not available.', 503);
    if (!id) fail('Track ID is required.');
    try { const r = await prov.lyrics(id); return send(res, 200, { ...r, restricted: !r.lyrics }); }
    catch { fail('Could not retrieve lyrics right now. Check the internet connection, or enter them manually.', 502); }
  }
  if ((x = p.match(/^\/songs\/(\d+)(?:\.(docx|txt|cho))?$/))) {
    const id = +x[1], ext = x[2];
    if (m === 'GET') {
      const row = one(`SELECT ${SONG_COLS} FROM songs WHERE id=?`, id); if (!row) fail('Song not found.', 404);
      const s = renderSong(row, q);
      if (!ext) return send(res, 200, s);
      if (ext === 'docx') { const f = docxForSong(s); res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="${slug(s.title)}.docx"`, 'Content-Length': f.length }); return res.end(f); }
      if (ext === 'txt') {
        const head = [s.title, s.artist, s.song_key && 'Key: ' + s.song_key, s.capo && 'Capo: ' + s.capo].filter(Boolean);
        return send(res, 200, [...head, '', s.chart, ...(s.notes ? ['', 'Notes:', s.notes] : [])].join('\n'), 'text/plain; charset=utf-8', { 'Content-Disposition': `attachment; filename="${slug(s.title)}.txt"` });
      }
      const meta = [['title', s.title], ['artist', s.artist], ['key', s.song_key], ['capo', s.capo], ['tempo', s.tempo], ['ccli', s.ccli]].filter(([, v]) => v).map(([k, v]) => `{${k}: ${v}}`).join('\n');
      return send(res, 200, meta + '\n\n' + Chords.overToInline(s.chart), 'text/plain; charset=utf-8', { 'Content-Disposition': `attachment; filename="${slug(s.title)}.cho"` });
    }
    if (m === 'PUT' && !ext) {
      const f = songFields(await readBody(req)); if (!f.title) fail('Song title is required.');
      if (!run(`UPDATE songs SET title=?,artist=?,song_key=?,capo=?,tempo=?,tags=?,ccli=?,notes=?,source_url=?,chart=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        f.title, f.artist, f.song_key, f.capo, f.tempo, f.tags, f.ccli, f.notes, f.source_url, f.chart, id).changes) fail('Song not found.', 404);
      return send(res, 200, { ok: true });
    }
    if (m === 'DELETE' && !ext) { run('DELETE FROM songs WHERE id=?', id); return send(res, 200, { ok: true }); }
  }
  fail('Not found', 404);
}

/* ---------- HTTP server ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
};
function authorised(req) {
  if (!PASSWORD) return true;
  const given = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':').slice(1).join(':');
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
  try {
    if (!authorised(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Light of Life", charset="UTF-8"' }); return res.end('Password required.'); }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname.slice(4), url.searchParams);
    const f = path.resolve(PUB, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!f.startsWith(PUB + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(f));
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : 'Server error. Please try again.', ...(e.extra || {}) }, 'application/json');
  }
}).listen(PORT, () => {
  console.log(`Light of Life Church is running at http://localhost:${PORT}`);
  if (PASSWORD) console.log('Password protection is ON (APP_PASSWORD).');
});
