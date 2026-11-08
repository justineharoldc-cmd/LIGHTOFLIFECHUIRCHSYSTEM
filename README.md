# Light of Life Church – Attendance & Songbook

Attendance tracking and a chord songbook for your church. No build step and **no npm packages**.

## Run
Requires [Node.js](https://nodejs.org) **22.5 or newer**.

```
node server.js
```
Open http://localhost:3000. Your data lives in `church.db` (your existing database is included and upgrades itself on first run).
A copy is saved to `backups/` once a day and the last 14 are kept.

| Setting (environment variable) | What it does |
|---|---|
| `PORT=8080` | Use another port |
| `APP_PASSWORD=secret` | Ask for a password (any username) before showing anything. Use this before exposing the app beyond your church network |
| `LYRICS_PROVIDER=off` | Turn off online lyrics lookup completely |
| `MUSIXMATCH_API_KEY=…` | Add Musixmatch as a second lyrics source (optional) |
| `DB_FILE=/path/church.db` | Keep the database somewhere else |

Windows PowerShell: `$env:APP_PASSWORD="secret"; node server.js`

## Using it
- **Dashboard** – last service, visitors, average, member attendance rate, an 8-service trend chart, members who missed 3+ services in a row (tap a number to call), and recent visitors.
- **Check-in** – pick a service, search or filter (All / Present / Absent), tap to check in. Press Enter when a search has one match. Add first-time visitors by name.
- **Members** – search, filter by ministry, see how often each person attended, import a list (`name, phone, ministry` per line).
- **Services** – add services, take attendance, download one service or everything as CSV (opens cleanly in Excel).
- **Songbook** – see below.

## Songbook
Charts are plain text and can be written two ways, mixed freely:
```
[Verse 1]                      [Verse 1]
G        D                     [G]Amazing [D]grace
Amazing grace          or
```
- **Transpose** by ±1, or **Move to key** in one click. Flats and sharps are chosen correctly for the new key (Bb, not A#), slash chords (`D/F#`) and extensions (`Em7`, `Cadd9`, `Dsus4`) are handled, and chords stay lined up over the right words. Lyrics are never changed.
- **Detect key** from the chords. **Convert ChordPro** turns `[G]word` text (and `{title:}`, `{key:}` lines) into chords above lyrics.
- **Play view** (click a song): big readable chart, transpose on the fly without changing the saved song, show **Nashville numbers** or **lyrics only**, a **capo helper** that shows the shapes to play, text size, auto-scroll, screen stays awake, and Print.
- **Export** to Word (.docx), ChordPro (.cho) or plain text, in whatever key you are viewing.
- **Find lyrics online** uses LRCLIB (no key needed). Online lyrics have no chords, so add them in the editor. Lyrics are usually copyrighted: only save and print what your licence (for example CCLI) covers.
- Tags, tempo and CCLI number per song; searching also looks inside the chart. Saving a duplicate title and artist asks first.

## API (JSON)
`GET /api/songs?q=&tag=` · `GET /api/songs/tags` · `POST /api/songs` · `GET|PUT|DELETE /api/songs/:id`
`GET /api/songs/:id?key=Bb` or `?steps=3` (`&flats=1`, `&notation=numbers|lyrics`) returns the song already transposed
`GET /api/songs/:id.docx|.cho|.txt` (same options) · `GET /api/songs/search?q=` · `GET /api/songs/lyrics?source=&id=`
`/api/members`, `/api/members/import`, `/api/services`, `/api/services/:id/checkin`, `/api/services/:id/export.csv`, `/api/stats`, `/api/export.csv`

## Files
- `server.js` – server, API, database, Word export
- `public/` – `index.html`, `style.css`, `app.js`, and `chords.js` (the chord engine, shared by the browser and server)
- `test/chords.test.js` – run `npm test` to check the chord engine

No login by default: run it on a church computer or local network, or set `APP_PASSWORD`.
