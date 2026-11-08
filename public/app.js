'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const fmt = d => new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const short = d => new Date(d + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const view = html => { $('#view').innerHTML = html; };
const head = (title, sub = '', actions = '') => `<div class="head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;

async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Something went wrong.'), { status: r.status, data: d });
  return d;
}
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 2800);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

const state = { service: null, editing: null, memberQ: '', ministry: '' };
let onLeave = null;

/* ---------- Router ---------- */
const routes = [
  [/^\/dashboard$/, dashboard], [/^\/checkin(?:\/(\d+))?$/, checkin], [/^\/members$/, members], [/^\/services$/, services],
  [/^\/songs$/, songs], [/^\/songs\/new$/, songEditor], [/^\/songs\/(\d+)\/edit$/, songEditor], [/^\/songs\/(\d+)$/, songPlay]
];
async function route() {
  if (onLeave) { onLeave(); onLeave = null; }
  const path = location.hash.slice(1) || '/dashboard';
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === path.split('/')[1]));
  for (const [re, fn] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    try { await fn(...m.slice(1)); window.scrollTo(0, 0); }
    catch (e) { view(head('Something went wrong') + `<p class="empty">${esc(e.message)}</p>`); }
    return;
  }
  location.hash = '#/dashboard';
}
window.addEventListener('hashchange', route);

/* ---------- Dashboard ---------- */
function trendChart(t) {
  const W = 640, H = 230, pt = 26, pb = 40, step = W / t.length, bw = Math.min(56, step - 16), max = Math.max(4, ...t.map(x => x.total));
  const y = v => H - pb - (H - pb - pt) * v / max;
  const grid = [0, .5, 1].map(f => `<line x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/>`).join('');
  const bars = t.map((x, i) => {
    const cx = step * i + step / 2, mem = x.total - x.visitors;
    return `<rect x="${cx - bw / 2}" y="${y(mem)}" width="${bw}" height="${Math.max(0, H - pb - y(mem))}" rx="5" fill="#f2b134"/>
      ${x.visitors ? `<rect x="${cx - bw / 2}" y="${y(x.total)}" width="${bw}" height="${y(mem) - y(x.total)}" rx="5" fill="#5fd3c4"/>` : ''}
      <text class="val" x="${cx}" y="${y(x.total) - 7}" text-anchor="middle">${x.total}</text>
      <text x="${cx}" y="${H - 20}" text-anchor="middle">${esc(short(x.date))}</text>`;
  }).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Attendance for the last ${t.length} services">${grid}${bars}</svg>
    <div class="legend"><span><i class="m"></i>Members</span><span><i class="v"></i>Visitors</span></div>`;
}
async function dashboard() {
  const s = await api('/stats'), last = s.last;
  const mem = last ? last.total - last.visitors : 0, rate = s.members && last ? Math.round(mem / s.members * 100) : 0;
  view(head('Dashboard', new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    '<a class="btn primary" href="#/checkin">Take attendance</a>') + `
  <div class="glass hero">
    <div class="big"><b>${last ? last.total : 0}</b><span>${last ? 'Present at ' + esc(last.name) : 'No services yet'}</span>${last ? `<small>${esc(fmt(last.date))}</small>` : ''}</div>
    <div class="stats">
      <div><b>${last ? last.visitors : 0}</b><span>Visitors last service</span></div>
      <div><b>${s.avg}</b><span>Average, last ${plural(s.services, 'service')}</span></div>
      <div><b>${rate}%</b><span>Of ${s.members} active members present</span></div>
    </div>
  </div>
  <div class="panel"><h3>Attendance trend</h3>${s.trend.length ? trendChart(s.trend) : '<p class="empty">Add a service to start tracking attendance.</p>'}</div>
  <div class="two">
    <div class="panel"><h3>Members to follow up</h3>
      <p class="hint" style="margin:-6px 0 12px">Active members who missed their last 3 or more services.</p>
      ${s.services < 3 ? '<p class="empty">Follow-up appears once three services have been recorded.</p>'
        : s.followup.length ? `<div class="tablewrap"><table><tr><th>Member</th><th>Missed</th><th>Phone</th></tr>${s.followup.map(m => `<tr>
          <td>${esc(m.name)}${m.ministry ? `<small>${esc(m.ministry)}</small>` : ''}</td>
          <td><span class="flag">${m.missed}${m.missed >= 8 ? '+' : ''}</span>${m.last_seen ? `<small>Last seen ${esc(short(m.last_seen))}</small>` : '<small>Never</small>'}</td>
          <td>${m.phone ? `<a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : '—'}</td></tr>`).join('')}</table></div>`
          : '<p class="empty">Everyone has attended recently. Praise God!</p>'}
    </div>
    <div class="panel"><h3>Recent visitors</h3>
      ${s.visitors.length ? s.visitors.map(v => `<div class="row" style="margin-bottom:8px;justify-content:space-between"><span>${esc(v.name)}</span><small>${esc(short(v.date))}</small></div>`).join('')
        : '<p class="empty">No visitors in the last three services.</p>'}
    </div>
  </div>`);
}

/* ---------- Check-in ---------- */
async function checkin(sid) {
  const sv = await api('/services');
  if (!sv.length) { view(head('Check-in') + '<p class="empty">Add a service first, then come back to take attendance.</p><a class="btn primary" href="#/services">Add a service</a>'); return; }
  if (sid) state.service = +sid;
  if (!sv.some(x => x.id === state.service)) state.service = (sv.find(x => x.date === today()) || sv[0]).id;
  const members = (await api('/members')).filter(m => m.active);
  let att = [], filter = 'all';
  view(head('Check-in', 'Tap a name to mark someone present. Press Enter to check in a single search match.') + `
    <div class="row"><select id="sv" aria-label="Service">${sv.map(x => `<option value="${x.id}" ${x.id === state.service ? 'selected' : ''}>${esc(x.name)} · ${esc(short(x.date))}</option>`).join('')}</select>
      <input id="q" type="search" placeholder="Search members" aria-label="Search members" autocomplete="off">
      <div class="seg" id="seg"><button data-f="all" class="on">All</button><button data-f="in">Present</button><button data-f="out">Absent</button></div>
      <span id="cnt" class="pill"></span></div>
    <div id="list" class="list"></div>
    <form id="vf" class="panel"><h3>First-time visitors</h3><div class="row"><input id="vn" class="grow" placeholder="Visitor name" required><button class="primary">Add visitor</button></div><div id="vis"></div></form>`);
  const here = () => new Map(att.filter(a => a.member_id).map(a => [a.member_id, a.id]));
  const matches = () => { const q = $('#q').value.trim().toLowerCase(), h = here();
    return members.filter(m => m.name.toLowerCase().includes(q) && (filter === 'all' || (filter === 'in') === h.has(m.id))); };
  const draw = () => {
    const h = here();
    $('#cnt').textContent = `${att.length} present · ${members.filter(m => h.has(m.id)).length}/${members.length} members`;
    $('#list').innerHTML = matches().map(m => `<div class="row-item ${h.has(m.id) ? 'in' : ''}"><div><b>${esc(m.name)}</b><small>${esc(m.ministry)}</small></div>
      <button data-m="${m.id}" data-a="${h.get(m.id) || ''}">${h.has(m.id) ? '✓ Present' : 'Check in'}</button></div>`).join('') || '<p class="empty">No members match.</p>';
    $('#vis').innerHTML = att.filter(a => !a.member_id).map(a => `<span class="chip">${esc(a.visitor_name)}<button type="button" data-a="${a.id}" aria-label="Remove ${esc(a.visitor_name)}">×</button></span>`).join('');
  };
  const load = guard(async () => { att = await api(`/services/${state.service}/attendance`); draw(); });
  const toggle = async (mid, aid) => { if (aid) await api('/attendance/' + aid, 'DELETE'); else await api(`/services/${state.service}/checkin`, 'POST', { member_id: mid }); await load(); };
  $('#sv').onchange = e => { state.service = +e.target.value; load(); };
  $('#q').oninput = draw;
  $('#q').onkeydown = guard(async e => {
    if (e.key !== 'Enter') return;
    const m = matches(); if (m.length !== 1 || here().has(m[0].id)) return;
    await toggle(m[0].id, ''); $('#q').value = ''; draw(); toast(m[0].name + ' checked in');
  });
  $('#seg').onclick = e => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; $$('#seg button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  $('#list').onclick = guard(async e => { const b = e.target.closest('button'); if (b) await toggle(+b.dataset.m, b.dataset.a); });
  $('#vis').onclick = guard(async e => { const b = e.target.closest('button'); if (b) { await api('/attendance/' + b.dataset.a, 'DELETE'); await load(); } });
  $('#vf').onsubmit = guard(async e => {
    e.preventDefault(); await api(`/services/${state.service}/checkin`, 'POST', { visitor_name: $('#vn').value });
    $('#vn').value = ''; toast('Visitor added'); await load();
  });
  await load(); $('#q').focus();
}

/* ---------- Members ---------- */
async function members() {
  const list = await api('/members'), e = list.find(m => m.id === state.editing) || {};
  const ministries = [...new Set(list.map(m => m.ministry).filter(Boolean))].sort();
  view(head('Members', `${list.filter(m => m.active).length} active of ${list.length}`) + `
  <form id="mf" class="panel"><h3>${e.id ? 'Edit member' : 'Add a member'}</h3>
    <div class="fields">
      <label>Full name<input id="n" value="${esc(e.name)}" required></label>
      <label>Phone<input id="p" type="tel" value="${esc(e.phone)}"></label>
      <label>Ministry<input id="mi" list="mins" value="${esc(e.ministry)}" placeholder="e.g. Choir"></label>
      <datalist id="mins">${ministries.map(m => `<option>${esc(m)}</option>`).join('')}</datalist>
      ${e.id ? `<label>Status<select id="ac"><option value="1" ${e.active ? 'selected' : ''}>Active</option><option value="0" ${e.active ? '' : 'selected'}>Inactive</option></select></label>` : ''}
    </div>
    <div class="row"><button class="primary">${e.id ? 'Save changes' : 'Add member'}</button>${e.id ? '<button type="button" id="cx">Cancel</button>' : ''}</div>
    ${e.id ? '' : `<details><summary>Import a list</summary><label>One person per line: name, phone, ministry<textarea id="imp" rows="5" placeholder="Maria Santos, 0917 123 4567, Choir"></textarea></label>
      <div class="row" style="margin-top:10px"><button type="button" id="impb">Import</button></div></details>`}
  </form>
  <div class="row"><input id="mq" type="search" placeholder="Search members" value="${esc(state.memberQ)}" aria-label="Search members">
    <select id="mm" aria-label="Ministry"><option value="">All ministries</option>${ministries.map(m => `<option ${m === state.ministry ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Ministry</th><th>Attended</th><th></th></tr></thead><tbody id="mt"></tbody></table></div>`);
  const draw = () => {
    const q = state.memberQ.toLowerCase(), rows = list.filter(m => m.name.toLowerCase().includes(q) && (!state.ministry || m.ministry === state.ministry));
    $('#mt').innerHTML = rows.map(m => `<tr class="${m.active ? '' : 'off'}"><td>${esc(m.name)}${m.active ? '' : ' <small>Inactive</small>'}</td>
      <td>${m.phone ? `<a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : '—'}</td><td>${esc(m.ministry) || '—'}</td>
      <td>${m.attended}${m.last_seen ? `<small>Last ${esc(short(m.last_seen))}</small>` : ''}</td>
      <td class="act"><button class="sm" data-e="${m.id}">Edit</button><button class="sm danger" data-d="${m.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="5" class="empty">${list.length ? 'No members match.' : 'No members yet. Add your first member above.'}</td></tr>`;
  };
  draw();
  $('#mq').oninput = ev => { state.memberQ = ev.target.value; draw(); };
  $('#mm').onchange = ev => { state.ministry = ev.target.value; draw(); };
  $('#mf').onsubmit = guard(async ev => {
    ev.preventDefault();
    const b = { name: $('#n').value, phone: $('#p').value, ministry: $('#mi').value, joined: e.joined || '' };
    if (e.id) { b.active = +$('#ac').value; await api('/members/' + e.id, 'PUT', b); toast('Member updated'); }
    else { await api('/members', 'POST', b); toast('Member added'); }
    state.editing = null; await members();
  });
  if ($('#cx')) $('#cx').onclick = () => { state.editing = null; members(); };
  if ($('#impb')) $('#impb').onclick = guard(async () => { const r = await api('/members/import', 'POST', { text: $('#imp').value }); toast(`Imported ${r.added}${r.skipped ? `, skipped ${r.skipped} already listed` : ''}`); await members(); });
  $('#mt').onclick = guard(async ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.e) { state.editing = +b.dataset.e; await members(); scrollTo(0, 0); }
    if (b.dataset.d && confirm('Delete this member and all of their attendance records?')) { await api('/members/' + b.dataset.d, 'DELETE'); toast('Member deleted'); await members(); }
  });
}

/* ---------- Services ---------- */
async function services() {
  const list = await api('/services');
  view(head('Services', `${plural(list.length, 'service')} recorded`, '<a class="btn" href="/api/export.csv">Download all (CSV)</a>') + `
  <form id="sf" class="panel"><h3>Add a service</h3><div class="row">
    <input id="sn" class="grow" list="names" value="Sunday Worship" required aria-label="Service name">
    <datalist id="names"><option>Sunday Worship</option><option>Midweek Prayer</option><option>Youth Service</option><option>Special Event</option></datalist>
    <input id="sd" type="date" value="${today()}" required aria-label="Service date"><button class="primary">Add service</button></div></form>
  <div class="tablewrap"><table><tr><th>Date</th><th>Service</th><th>Present</th><th></th></tr>
  ${list.map(s => `<tr><td>${esc(fmt(s.date))}</td><td>${esc(s.name)}</td><td>${s.total}${s.visitors ? `<small>${plural(s.visitors, 'visitor')}</small>` : ''}</td>
    <td class="act"><a class="btn sm primary" href="#/checkin/${s.id}">Take attendance</a><a class="btn sm" href="/api/services/${s.id}/export.csv">CSV</a><button class="sm danger" data-d="${s.id}">Delete</button></td></tr>`).join('')
    || '<tr><td colspan="4" class="empty">No services yet. Add one above.</td></tr>'}</table></div>`);
  $('#sf').onsubmit = guard(async ev => { ev.preventDefault(); await api('/services', 'POST', { name: $('#sn').value, date: $('#sd').value }); toast('Service added'); await services(); });
  $('#view').querySelector('table').onclick = guard(async ev => {
    const b = ev.target.closest('button'); if (!b || !b.dataset.d) return;
    if (confirm('Delete this service and its attendance records?')) { await api('/services/' + b.dataset.d, 'DELETE'); toast('Service deleted'); await services(); }
  });
}

/* ---------- Songbook: shared helpers ---------- */
function chartHtml(text) {
  const lines = Chords.classify(text).map(l => {
    if (l.k === 'b') return '<span class="b"></span>';
    if (l.k === 'c') return `<span class="c">${esc(l.t)}</span>`;
    if (l.k === 's') return `<span class="s">${esc(l.t.replace(/[\[\]]/g, '').trim())}</span>`;
    const t = esc(l.t).replace(/\[([^\]\n]+)\]/g, (a, c) => (Chords.parse(c.replace(/&#39;/g, "'")) ? `<span class="c">[${c}]</span>` : a));
    return `<span class="l">${t}</span>`;
  });
  return lines.join('') || '<span class="muted">Nothing here yet.</span>';
}
const KEYS = Chords.KEY_NAMES;
const keyOptions = (sel, minor) => KEYS.map(k => `<option value="${k}${minor ? 'm' : ''}" ${sel === k + (minor ? 'm' : '') ? 'selected' : ''}>${k}${minor ? 'm' : ''}</option>`).join('');

/* ---------- Songbook: list ---------- */
async function songs() {
  const tags = await api('/songs/tags');
  view(head('Songbook', 'Charts with chords you can transpose, play from and export.', '<a class="btn primary" href="#/songs/new">New song</a>') + `
  <div class="row"><input id="sq" type="search" placeholder="Search title, artist, tag or lyrics" aria-label="Search songs">
    <select id="st" aria-label="Tag"><option value="">All tags</option>${tags.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
  <div class="tablewrap"><table><thead><tr><th>Song</th><th>Key</th><th>Tags</th><th></th></tr></thead><tbody id="sr"></tbody></table></div>`);
  const load = guard(async () => {
    const list = await api(`/songs?q=${encodeURIComponent($('#sq').value)}&tag=${encodeURIComponent($('#st').value)}`);
    $('#sr').innerHTML = list.map(s => `<tr><td><a href="#/songs/${s.id}"><b>${esc(s.title)}</b></a><small>${esc(s.artist) || 'Unknown artist'}${s.has_chords ? '' : ' · no chords yet'}</small></td>
      <td>${esc(s.song_key) || '—'}${s.capo && s.capo !== 'None' ? `<small>Capo ${esc(s.capo)}</small>` : ''}</td>
      <td>${s.tags ? s.tags.split(',').map(t => `<span class="tag">${esc(t)}</span>`).join('') : ''}</td>
      <td class="act"><a class="btn sm primary" href="#/songs/${s.id}">Play</a><a class="btn sm" href="#/songs/${s.id}/edit">Edit</a><a class="btn sm" href="/api/songs/${s.id}.docx">Word</a><button class="sm danger" data-d="${s.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="4" class="empty">${$('#sq').value || $('#st').value ? 'No songs match.' : 'No songs saved yet. Add your first one with New song.'}</td></tr>`;
  });
  $('#sq').oninput = debounce(load); $('#st').onchange = load;
  $('#sr').onclick = guard(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (confirm('Delete this song?')) { await api('/songs/' + b.dataset.d, 'DELETE'); toast('Song deleted'); await load(); }
  });
  await load();
}

/* ---------- Songbook: editor ---------- */
async function songEditor(id) {
  const s = id ? await api('/songs/' + id) : { title: '', artist: '', song_key: '', capo: '', tempo: '', tags: '', ccli: '', notes: '', source_url: '', chart: '' };
  const flatPref = () => $('#acc').value;
  view(head(id ? 'Edit song' : 'New song', '', `<a class="btn" href="#/songs">Cancel</a><button class="primary" form="sf">Save song</button>`) + `
  <form id="sf">
  <details class="panel" ${id ? '' : 'open'}><summary>Find lyrics online</summary>
    <div class="row"><input id="sq" class="grow" type="search" placeholder="Song title or artist" aria-label="Search for a song"><button type="button" id="sgo" class="primary">Search</button><a id="sg" class="btn" target="_blank" rel="noopener" hidden>Search Google</a></div>
    <div id="hits" class="hits"></div>
    <p class="hint">Online lyrics have no chords; add them in the chart. Lyrics are usually copyrighted, so only save and print what your church licence (for example CCLI) covers.</p>
  </details>
  <div class="panel"><h3>Song details</h3><div class="fields">
    <label>Title<input id="f-title" required value="${esc(s.title)}"></label>
    <label>Artist<input id="f-artist" value="${esc(s.artist)}"></label>
    <label>Key<input id="f-key" list="keys" value="${esc(s.song_key)}" placeholder="e.g. G or Am"></label>
    <datalist id="keys">${KEYS.map(k => `<option>${k}</option><option>${k}m</option>`).join('')}</datalist>
    <label>Capo<input id="f-capo" value="${esc(s.capo)}" placeholder="e.g. 2"></label>
    <label>Tempo<input id="f-tempo" value="${esc(s.tempo)}" placeholder="e.g. 72 bpm"></label>
    <label>Tags<input id="f-tags" value="${esc(s.tags)}" placeholder="slow, communion"></label>
    <label>CCLI #<input id="f-ccli" value="${esc(s.ccli)}"></label>
  </div></div>
  <div class="editor">
    <div class="panel"><h3>Chart</h3>
      <textarea id="f-chart" class="chartbox" spellcheck="false" placeholder="[Verse 1]&#10;G        D&#10;Amazing grace how sweet&#10;&#10;Chords above lyrics, or inline like [G]Amazing [D]grace.">${esc(s.chart)}</textarea>
      <div class="toolbar">
        <button type="button" class="sm" id="down" title="Down one semitone">−1</button><button type="button" class="sm" id="up" title="Up one semitone">+1</button>
        <label>Move to key <select id="tokey"><option value="">Choose…</option>${keyOptions('', false)}</select></label>
        <label>Notes <select id="acc"><option value="auto">Auto ♯/♭</option><option value="flats">Use ♭</option><option value="sharps">Use ♯</option></select></label>
      </div>
      <div class="toolbar"><button type="button" class="sm" id="detect">Detect key</button><button type="button" class="sm" id="cpro" title="Turn [G]word ChordPro text into chords above lyrics">Convert ChordPro</button></div>
      <p class="hint">Chords above lyrics or inline [G]chords both work. Section labels such as [Verse 1] or [Chorus] are styled automatically.</p>
    </div>
    <div class="panel"><h3>Preview</h3><div class="chordbar" id="used"></div><pre class="chart preview" id="pv"></pre></div>
  </div>
  <div class="panel"><div class="fields">
    <label>Notes<textarea id="f-notes" rows="3" placeholder="Arrangement, intro, ending, reminders…">${esc(s.notes)}</textarea></label>
    <label>Source link<input id="f-src" type="url" value="${esc(s.source_url)}" placeholder="https://…"></label></div></div>
  </form>`);

  const chart = $('#f-chart'), key = $('#f-key');
  const drawPreview = () => { $('#pv').innerHTML = chartHtml(chart.value); const u = Chords.chordsUsed(chart.value); $('#used').innerHTML = u.map(c => `<span>${esc(c)}</span>`).join('') || '<small>Chords you use will be listed here.</small>'; };
  chart.oninput = debounce(drawPreview, 120); drawPreview();
  const flatsFor = name => (flatPref() === 'auto' ? Chords.useFlats(name) : flatPref() === 'flats');
  const shift = n => {
    const newKey = Chords.transposeKey(key.value, n, false), fl = flatsFor(newKey);
    chart.value = Chords.transposeText(chart.value, n, { flats: fl });
    if (key.value) key.value = Chords.transposeKey(key.value, n, fl);
    drawPreview(); toast(key.value ? `Moved to ${key.value}` : 'Chords moved');
  };
  $('#down').onclick = () => shift(-1); $('#up').onclick = () => shift(1);
  $('#tokey').onchange = e => {
    const to = e.target.value; if (!to) return;
    const from = key.value || Chords.detectKey(chart.value);
    const n = Chords.semitones(from, to);
    if (n == null) { toast('Add chords or set the current key first.', true); e.target.value = ''; return; }
    const fl = flatPref() === 'auto' ? Chords.useFlats(to) : flatPref() === 'flats';
    chart.value = Chords.transposeText(chart.value, n, { flats: fl }); key.value = to; e.target.value = ''; drawPreview(); toast('Moved to ' + to);
  };
  $('#detect').onclick = () => { const k = Chords.detectKey(chart.value); if (k) { key.value = k; toast('Key looks like ' + k); } else toast('No chords found to detect a key from.', true); };
  $('#cpro').onclick = () => {
    const r = Chords.inlineToOver(chart.value); chart.value = r.text;
    for (const [k, el] of [['title', '#f-title'], ['artist', '#f-artist'], ['key', '#f-key'], ['capo', '#f-capo'], ['tempo', '#f-tempo']]) if (r.meta[k] && !$(el).value) $(el).value = r.meta[k];
    drawPreview(); toast('Converted to chords above lyrics');
  };

  const showSg = q => { const g = $('#sg'); g.href = 'https://www.google.com/search?q=' + encodeURIComponent(q + ' lyrics chords'); g.hidden = false; };
  const search = guard(async () => {
    const q = $('#sq').value.trim(); if (!q) return;
    $('#hits').innerHTML = '<span class="muted">Searching…</span>'; showSg(q);
    const r = await api('/songs/search?q=' + encodeURIComponent(q));
    if (r.disabled) { $('#hits').innerHTML = '<p class="empty">Online lyrics lookup is switched off. Use Search Google or type the song in below.</p>'; return; }
    const down = Object.values(r.providers).every(v => v !== 'ok');
    $('#hits').innerHTML = down ? '<p class="empty">Could not reach the lyrics service. Check the internet connection, or use Search Google.</p>'
      : r.results.map(t => `<div class="hit"><div><b>${esc(t.title)}</b><small>${esc(t.artist)}${t.album ? ' · ' + esc(t.album) : ''}</small></div>
        <button type="button" class="sm" data-src="${t.source}" data-id="${esc(t.id)}" data-t="${esc(t.title)}" data-a="${esc(t.artist)}" ${t.has_lyrics ? '' : 'disabled'}>${t.has_lyrics ? 'Use lyrics' : 'No lyrics'}</button></div>`).join('')
        || '<p class="empty">No matches. Try fewer words, or use Search Google.</p>';
  });
  $('#sgo').onclick = search; $('#sq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
  $('#hits').onclick = guard(async e => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    const d = await api(`/songs/lyrics?source=${b.dataset.src}&id=${encodeURIComponent(b.dataset.id)}`);
    if (!d.lyrics) { toast('That service does not share lyrics for this song. Paste lyrics you are licensed to use.', true); return; }
    if (chart.value.trim() && !confirm('Replace the current chart with these lyrics?')) return;
    chart.value = d.lyrics.replace(/\r\n?/g, '\n'); $('#f-title').value = b.dataset.t; $('#f-artist').value = b.dataset.a;
    if (d.notice && !$('#f-notes').value) $('#f-notes').value = d.notice;
    drawPreview(); toast('Lyrics added. Now add the chords.');
  });

  $('#sf').onsubmit = guard(async e => {
    e.preventDefault();
    const body = { title: $('#f-title').value, artist: $('#f-artist').value, song_key: key.value, capo: $('#f-capo').value, tempo: $('#f-tempo').value,
      tags: $('#f-tags').value, ccli: $('#f-ccli').value, chart: chart.value, notes: $('#f-notes').value, source_url: $('#f-src').value };
    try { if (id) await api('/songs/' + id, 'PUT', body); else await api('/songs', 'POST', body); }
    catch (err) {
      if (err.status !== 409 || !confirm(`"${body.title}" is already in the songbook. Save another copy anyway?`)) throw err;
      await api('/songs?force=1', 'POST', body);
    }
    toast('Song saved'); location.hash = '#/songs';
  });
}

/* ---------- Songbook: play / performance view ---------- */
async function songPlay(id) {
  const s = await api('/songs/' + id);
  const p = { steps: 0, acc: 'auto', notation: 'chords', capo: 0, speed: 0, size: +store.get('lol-fs') || 19 };
  view(head('', '', `<a class="btn" href="#/songs">All songs</a><a class="btn" href="#/songs/${id}/edit">Edit</a><button id="print">Print</button>
      <a class="btn" id="dl-docx">Word</a><a class="btn" id="dl-cho">ChordPro</a><a class="btn" id="dl-txt">Text</a>`).replace('<h1></h1>', '') + `
  <div class="glass stage"><div class="toolbar">
    <button class="sm" id="down">−</button><b id="curkey" style="min-width:3.2em;text-align:center"></b><button class="sm" id="up">+</button>
    <label>Key <select id="tokey" ${s.song_key ? '' : 'disabled'}><option value="">Jump…</option>${keyOptions('', false)}</select></label>
    <label>Notes <select id="acc"><option value="auto">Auto ♯/♭</option><option value="flats">♭</option><option value="sharps">♯</option></select></label>
    <span class="sep"></span>
    <label>Show <select id="not"><option value="chords">Chords</option><option value="numbers">Numbers</option><option value="lyrics">Lyrics only</option></select></label>
    <label>Capo shapes <select id="capo">${[0, 1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}">${n ? 'Capo ' + n : 'Off'}</option>`).join('')}</select></label>
    <span class="sep"></span>
    <button class="sm" id="fsd" aria-label="Smaller text">A−</button><button class="sm" id="fsu" aria-label="Larger text">A+</button>
    <label>Scroll <input id="spd" type="range" min="0" max="5" value="0"></label>
  </div></div>
  <article class="glass sheet"><h1>${esc(s.title)}</h1><p class="meta" id="meta"></p><div id="capon"></div><pre class="chart" id="sheet"></pre>
    ${s.notes ? `<p class="meta" style="margin-top:24px"><b>Notes</b><br>${esc(s.notes).replace(/\n/g, '<br>')}</p>` : ''}</article>`);
  document.title = s.title + ' · Light of Life';

  const flatsFor = name => (p.acc === 'auto' ? Chords.useFlats(name) : p.acc === 'flats');
  const draw = () => {
    let key = s.song_key, text = s.chart;
    const k1 = Chords.transposeKey(s.song_key, p.steps, false), fl = flatsFor(k1);
    if (p.steps) { text = Chords.transposeText(text, p.steps, { flats: fl }); key = Chords.transposeKey(s.song_key, p.steps, fl); }
    let shapes = '';
    if (p.capo && p.notation === 'chords') {
      const fc = flatsFor(Chords.transposeKey(key, -p.capo, false));
      text = Chords.transposeText(text, -p.capo, { flats: fc }); shapes = Chords.transposeKey(key, -p.capo, fc);
    }
    if (p.notation === 'numbers') text = Chords.toNumbers(text, key);
    if (p.notation === 'lyrics') text = Chords.stripChords(text);
    $('#sheet').innerHTML = chartHtml(text);
    $('#sheet').style.setProperty('--fs', p.size + 'px');
    $('#curkey').textContent = key || '—';
    $('#meta').textContent = [s.artist, key && 'Key ' + key + (p.steps ? ` (written in ${s.song_key})` : ''), s.capo && s.capo !== 'None' && 'Capo ' + s.capo, s.tempo, s.ccli && 'CCLI #' + s.ccli].filter(Boolean).join('  ·  ');
    $('#capon').innerHTML = shapes ? `<span class="capo-note">Capo ${p.capo}: play these shapes in ${esc(shapes)}</span>` : p.notation === 'numbers' && !key ? '<span class="capo-note">Set the song key to show numbers</span>' : '';
    const q = `?steps=${p.steps}&flats=${fl ? 1 : 0}`;
    $('#dl-docx').href = `/api/songs/${id}.docx${q}`; $('#dl-cho').href = `/api/songs/${id}.cho${q}`; $('#dl-txt').href = `/api/songs/${id}.txt${q}`;
  };
  $('#down').onclick = () => { p.steps = (p.steps + 11) % 12; draw(); };
  $('#up').onclick = () => { p.steps = (p.steps + 1) % 12; draw(); };
  $('#tokey').onchange = e => { if (!e.target.value) return; p.steps = Chords.semitones(s.song_key, e.target.value) ?? p.steps; e.target.value = ''; draw(); };
  $('#acc').onchange = e => { p.acc = e.target.value; draw(); };
  $('#not').onchange = e => { p.notation = e.target.value; draw(); };
  $('#capo').onchange = e => { p.capo = +e.target.value; draw(); };
  $('#fsd').onclick = () => { p.size = Math.max(13, p.size - 2); store.set('lol-fs', p.size); draw(); };
  $('#fsu').onclick = () => { p.size = Math.min(40, p.size + 2); store.set('lol-fs', p.size); draw(); };
  $('#print').onclick = () => window.print();
  let timer = null, lock = null;
  $('#spd').oninput = e => { clearInterval(timer); timer = +e.target.value ? setInterval(() => scrollBy(0, 1), Math.round(120 / +e.target.value)) : null; };
  try { navigator.wakeLock?.request('screen').then(l => { lock = l; }).catch(() => {}); } catch { /* optional */ }
  onLeave = () => { clearInterval(timer); lock?.release?.().catch(() => {}); document.title = 'Light of Life Church'; };
  draw();
}

route();
