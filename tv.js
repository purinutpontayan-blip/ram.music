// ============================================================
// R Music TV (Beta) — หน้าจอรับสำหรับแชร์ไปยัง TV
// แสดงเนื้อเพลงซิงก์ + สีพื้นหลังแบบเดียวกับหน้าเนื้อเพลงของเว็บเพลเยอร์
// รับสถานะจากผู้ส่งผ่าน Apps Script (รหัส 6 หลัก) แล้วคำนวณเวลาเพลงเองบนหน้านี้
// ============================================================
const TV_API = 'https://script.google.com/macros/s/AKfycbyxZaws0vfMVlzZijyO8ukeYGKd2IOJ3Y5LAOvok3pgRLU2GdOabnoaA3On2UvFz1i1wg/exec'; // ต้องเป็น URL เดียวกับ RANKING_API ใน main.js
const POLL_MS = 1500;
const $ = id => document.getElementById(id);

// ---- โค้ดหาเนื้อเพลงซิงก์: คัดลอกจาก main.js ตรง ๆ เพื่อให้ผลลัพธ์เหมือนกันทุกประการ ----
// ---------- หาเนื้อเพลงที่ "ซิงก์ตามเวลา" ----------
// 1) ให้ <am-lyrics> ค้นหาก่อน (ส่งชื่อเพลง/ศิลปิน/อัลบั้ม/ISRC/ความยาว เพื่อให้จับคู่ถูกเวอร์ชัน)
// 2) ถ้าได้แต่เนื้อเพลงเปล่า ๆ (ไม่มีเวลา) หรือไม่เจอเลย -> ค้นหาเวอร์ชันซิงก์จาก LRCLIB เอง
//    แล้วแปลงเป็น TTML ส่งให้ <am-lyrics> แสดงผล
const THAI_COMBINING = /^[\u0E31\u0E33-\u0E3A\u0E47-\u0E4E]+$/;
function fixThaiSpans(root) {
  root.querySelectorAll('.char:not(.th-ok)').forEach(span => {
    span.classList.add('th-ok');
    if (span.textContent && THAI_COMBINING.test(span.textContent)) { let prev = span.previousElementSibling; while (prev && (!prev.classList.contains('char') || prev.style.display === 'none')) prev = prev.previousElementSibling; if (prev) { prev.textContent += span.textContent; span.textContent = ''; span.style.display = 'none'; prev.style.setProperty('width', 'auto', 'important'); prev.style.setProperty('min-width', 'auto', 'important'); prev.style.setProperty('max-width', 'none', 'important'); prev.style.setProperty('overflow', 'visible', 'important'); prev.style.setProperty('white-space', 'pre', 'important'); } }
  });
}

// CSS ที่ฉีดเข้า shadow DOM ของ <am-lyrics> เพื่อแก้บรรทัดถัดไปเลื่อนหลุดขึ้นไปบนสุด
//  1) ตำแหน่งบรรทัดที่กำลังร้อง เดิมอยู่ 8-12% จากขอบบน ซึ่งตรงกับโซนที่ถูกมาสก์ให้จางหาย (ดู .lyrics-right) จึงมองไม่เห็น
//  2) บรรทัดที่มีท่อนร้องประสาน เช่น "(สวัสดี)" จะกางความสูงออกทีหลัง ทำให้ระยะเลื่อนที่คำนวณไว้คลาดเคลื่อน จึงล็อกความสูงให้คงที่
const LYRICS_SHADOW_CSS = `
.lyrics-container { --lyrics-scroll-padding-top: 26% !important; }
.background-vocal-container { height: auto !important; transition: none !important; }
.background-vocal-wrap { opacity: .55 !important; transform: none !important; }
.lyrics-line.bg-expanded .background-vocal-wrap { opacity: 1 !important; }
.lyrics-line.bg-expanded.bg-after .main-vocal-container,
.lyrics-line.bg-expanded.bg-before .main-vocal-container { transform: none !important; }
`;

function mountLyricsEl(container, attrs) {
  container.innerHTML = '';
  const el = document.createElement('am-lyrics');
  Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') el.setAttribute(k, String(v)); });
  el.setAttribute('autoscroll', 'true'); el.setAttribute('interpolate', 'true'); el.setAttribute('font-family', "'Kanit', sans-serif");
  container.appendChild(el);
  const waitForShadow = setInterval(() => {
    if (!el.isConnected) { clearInterval(waitForShadow); return; }
    if (el.shadowRoot) { clearInterval(waitForShadow); const st = document.createElement('style'); st.textContent = LYRICS_SHADOW_CSS; el.shadowRoot.appendChild(st); fixThaiSpans(el.shadowRoot); new MutationObserver(() => fixThaiSpans(el.shadowRoot)).observe(el.shadowRoot, { childList: true, subtree: true }); }
  }, 50);
  return el;
}

// รอให้ <am-lyrics> โหลดเสร็จ แล้วบอกว่าได้เนื้อเพลงแบบไหน: 'synced' | 'unsynced' | 'none'
function waitLyricsResult(el, timeoutMs = 12000) {
  return new Promise(resolve => {
    const start = Date.now(); let seenLoading = false;
    const tick = () => {
      if (!el.isConnected) return resolve('gone');
      const loading = !!el.isLoading; if (loading) seenLoading = true;
      const elapsed = Date.now() - start;
      if ((seenLoading && !loading) || (!loading && elapsed > 3000) || elapsed > timeoutMs) {
        const ls = el.lyrics;
        if (!ls || !ls.length) return resolve('none');
        return resolve(ls.every(l => l.timestamp === 0 && l.endtime === 0) ? 'unsynced' : 'synced');
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function lrclibJson(path) {
  try { const r = await fetch(`https://lrclib.net/api/${path}`); return r.ok ? await r.json() : null; } catch (e) { return null; }
}

// หาเนื้อเพลงซิงก์จาก LRCLIB ลองหลายรูปแบบชื่อ และเลือกเวอร์ชันที่ความยาวใกล้เคียงกับเพลงที่เล่นอยู่ (กันเวลาเพี้ยน)
async function findSyncedLrc(track) {
  const durSec = Math.round((track.duration_ms || 0) / 1000);
  const artist = track.artists?.[0]?.name || '';
  const album = track.album?.name || '';
  const raw = track.name || '';
  const titles = [...new Set([raw, raw.split(' - ')[0], raw.replace(/\s*[\(\[].*?[\)\]]/g, ''), raw.split(' - ')[0].split(' (')[0]].map(t => t.trim()).filter(Boolean))];
  const seen = new Map();
  const add = list => (Array.isArray(list) ? list : [list]).forEach(r => { if (r && r.syncedLyrics && !seen.has(r.id)) seen.set(r.id, r); });

  for (const t of titles.slice(0, 2)) {
    const p = new URLSearchParams({ track_name: t, artist_name: artist, album_name: album }); if (durSec) p.set('duration', durSec);
    add(await lrclibJson(`get?${p}`));
    if (seen.size) break;
  }
  if (!seen.size) {
    for (const t of titles) {
      add(await lrclibJson(`search?${new URLSearchParams({ track_name: t, artist_name: artist })}`));
      if (seen.size) break;
      add(await lrclibJson(`search?${new URLSearchParams({ q: `${artist} ${t}` })}`));
      if (seen.size) break;
    }
  }
  const cands = [...seen.values()];
  if (!cands.length) return null;
  if (!durSec) return cands[0];
  const scored = cands.map(r => ({ r, diff: Math.abs((Number(r.duration) || 0) - durSec) })).sort((a, b) => a.diff - b.diff);
  return scored[0].diff <= 5 ? scored[0].r : null; // ห่างเกิน 5 วินาที = คนละเวอร์ชัน เวลาจะเพี้ยน จึงไม่ใช้
}

// แปลง LRC ("[mm:ss.xx] ข้อความ") เป็น TTML ระดับบรรทัดที่ <am-lyrics> อ่านได้
function lrcToTtml(lrc) {
  const rows = [];
  String(lrc).split(/\r?\n/).forEach(line => {
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) rows.push({ t: Number(m[1]) * 60 + parseFloat(m[2]), text });
  });
  rows.sort((a, b) => a.t - b.t);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ps = [];
  rows.forEach((r, i) => {
    if (!r.text) return;
    const end = rows[i + 1] ? rows[i + 1].t : r.t + 5;
    ps.push(`<p begin="${r.t.toFixed(2)}s" end="${Math.max(end, r.t + 0.5).toFixed(2)}s">${esc(r.text)}</p>`);
  });
  return ps.length ? `<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div>${ps.join('')}</div></body></tt>` : '';
}


// ============================================================
// ส่วนของ TV
// ============================================================
const S = {
  code: '', cur: null, trackId: '', paletteKey: '',
  offset: null, bestRtt: Infinity,            // offset = เวลาเซิร์ฟเวอร์ - performance.now()
  syncMs: Number(localStorage.getItem('tv_sync_ms')) || 0,
  timer: null, lastEl: null, lastSeekAt: 0
};

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const fmtTime = ms => { const t = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(t / 60), s = t % 60; return `${m}:${String(s).padStart(2, '0')}`; };

let statusTimer;
function showStatus(text, ms = 3500) {
  const el = $('tv-status'); el.textContent = text; el.classList.add('show');
  clearTimeout(statusTimer); if (ms) statusTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// สีพื้นหลัง: ใช้ค่าและวิธีเดียวกับ applyPalette ในหน้าเนื้อเพลงของเว็บเพลเยอร์ (บนจอกว้าง)
function applyPalette(palette) {
  if (!Array.isArray(palette) || !palette.length) return;
  const modal = $('lyrics-modal');
  palette.forEach((c, i) => modal.style.setProperty(`--blob${i + 1}`, rgba(c, i < 3 ? .6 : .5)));
  if (!modal.querySelector('.modal-blobs')) {
    const layer = document.createElement('div'); layer.className = 'modal-blobs';
    layer.innerHTML = [1, 2, 3, 4, 5].map(n => `<div class="blob blob-${n}"></div>`).join('');
    modal.insertBefore(layer, modal.firstChild);
  }
}

async function setupLyrics(track) {
  const container = $('lyrics-container');
  container.innerHTML = '<div class="lyrics-loading"></div>';
  const id = track.id;
  const stale = () => S.trackId !== id;
  const cleanTitle = track.name.split(' - ')[0].split(' (')[0];
  const primaryArtist = track.artists[0] || '';

  const lyricsEl = mountLyricsEl(container, {
    'song-title': cleanTitle, 'song-artist': primaryArtist, 'song-album': track.album, 'song-duration': track.durationMs,
    query: `${cleanTitle} ${primaryArtist}`, isrc: track.isrc
  });
  const result = await waitLyricsResult(lyricsEl);
  if (result === 'synced' || result === 'gone' || stale()) return;

  const found = await findSyncedLrc({ name: track.name, duration_ms: track.durationMs, artists: track.artists.map(name => ({ name })), album: { name: track.album } });
  if (!found || stale() || !container.contains(lyricsEl)) return;
  const ttml = lrcToTtml(found.syncedLyrics);
  if (!ttml) return;
  mountLyricsEl(container, { 'song-title': cleanTitle, 'song-artist': primaryArtist, 'song-duration': track.durationMs, ttml });
}

function loadTrack(track) {
  S.trackId = track.id;
  const art = $('lyrics-modal-art'); if (track.cover) art.src = track.cover;
  const title = $('lyrics-modal-title');
  const inner = document.createElement('span'); inner.className = 'marquee-inner'; inner.textContent = `${track.name}\u00a0\u00a0\u00a0${track.name}`;
  title.replaceChildren(inner); title.classList.remove('is-overflow');
  requestAnimationFrame(() => { if (inner.scrollWidth > title.clientWidth * 2 + 1) title.classList.add('is-overflow'); else inner.textContent = track.name; });
  const artist = $('lyrics-modal-artist'); artist.textContent = '';
  if (track.explicit) { const b = document.createElement('span'); b.className = 'rank-explicit'; b.title = 'เนื้อหาไม่เหมาะสม (Explicit)'; b.textContent = 'E'; artist.appendChild(b); }
  artist.appendChild(document.createTextNode(track.artists.join(', ')));
  document.title = `${track.name} · R Music TV`;
  setupLyrics(track);
}

function applyState(st) {
  if (!st || !st.track || !st.track.id) { S.cur = null; return; }
  S.cur = st;
  if (st.track.id !== S.trackId) loadTrack(st.track);
  const pk = JSON.stringify(st.palette || []);
  if (pk !== S.paletteKey) { S.paletteKey = pk; applyPalette(st.palette); }
}

// ตำแหน่งเพลง ณ ตอนนี้ = ตำแหน่งที่ผู้ส่งบอก + ค่าหน่วงขาส่ง + เวลาที่ผ่านไปตามนาฬิกาเซิร์ฟเวอร์ + ค่าปรับเวลาด้วยมือ (ปุ่มซ้าย/ขวา)
function currentPos() {
  const st = S.cur; if (!st) return 0;
  let p = st.position + st.lagMs + S.syncMs;
  if (!st.paused && S.offset != null) p += (performance.now() + S.offset) - st.serverTs;
  return Math.max(0, Math.min(st.track.durationMs || Infinity, p));
}

function updateSeek(pos) {
  const d = S.cur?.track.durationMs || 0;
  const bar = document.querySelector('.seek-bar'); if (!bar) return;
  const pct = d ? Math.min(1, pos / d) : 0;
  bar.value = Math.round(pct * 1000); bar.style.setProperty('--pct', `${pct * 100}%`);
  document.querySelector('.seek-current').textContent = fmtTime(pos);
  document.querySelector('.seek-remaining').textContent = '-' + fmtTime(d - pos);
}

function frame(now) {
  const st = S.cur;
  if (st) {
    const pos = currentPos();
    const el = document.querySelector('#lyrics-container am-lyrics');
    if (el) {
      const durKey = st.paused ? -1 : st.track.durationMs;
      if (el !== S.lastEl || S.durKey !== durKey) { S.lastEl = el; S.durKey = durKey; el.setAttribute('duration', durKey); }
      el.currentTime = pos;
    }
    if (now - S.lastSeekAt > 200) { S.lastSeekAt = now; updateSeek(pos); }
  }
  requestAnimationFrame(frame);
}

// ---------- เชื่อมต่อ / ดึงสถานะ ----------
function schedulePoll() { clearTimeout(S.timer); S.timer = setTimeout(poll, document.hidden ? 4000 : POLL_MS); }

async function poll() {
  if (!S.code) return;
  const t0 = performance.now();
  let data;
  try {
    const r = await fetch(`${TV_API}?${new URLSearchParams({ action: 'tv_get', code: S.code, _: Date.now() })}`);
    data = await r.json();
  } catch (e) { showStatus('เชื่อมต่อไม่ได้ กำลังลองใหม่...', 0); schedulePoll(); return; }
  const t1 = performance.now();
  if (!data.ok) { disconnect('ไม่พบรหัสนี้ หรือผู้ส่งหยุดแชร์แล้ว'); return; }

  // ซิงก์นาฬิกากับเซิร์ฟเวอร์: ให้น้ำหนักตัวอย่างที่ตอบเร็ว (RTT ต่ำ) มากกว่า เพื่อลดอาการเวลากระตุก
  const rtt = t1 - t0, o = data.serverNow - (t0 + t1) / 2;
  if (S.offset == null) { S.offset = o; S.bestRtt = rtt; }
  else { S.offset += (o - S.offset) * (rtt <= S.bestRtt * 1.3 ? .5 : .08); S.bestRtt = Math.min(rtt, S.bestRtt * 1.02); }

  $('tv-connect').classList.add('hidden');
  $('lyrics-modal').classList.remove('hidden');
  applyState(data.state);
  if (!data.state) showStatus('เชื่อมต่อแล้ว — รอผู้ส่งเล่นเพลง...', 0);
  else if ($('tv-status').textContent.startsWith('เชื่อมต่อแล้ว') || $('tv-status').textContent.startsWith('เชื่อมต่อไม่ได้')) $('tv-status').classList.remove('show');
  schedulePoll();
}

function connect(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) { $('tv-connect-msg').textContent = 'กรุณากรอกรหัส 6 หลัก'; return; }
  S.code = code; S.offset = null; S.bestRtt = Infinity; S.trackId = ''; S.paletteKey = ''; S.cur = null;
  localStorage.setItem('tv_code', code);
  $('tv-connect-msg').textContent = 'กำลังเชื่อมต่อ...';
  clearTimeout(S.timer); poll();
  requestWakeLock();
}

function disconnect(msg) {
  clearTimeout(S.timer); S.code = ''; S.cur = null; S.trackId = '';
  $('lyrics-modal').classList.add('hidden');
  $('lyrics-container').innerHTML = '';
  $('tv-status').classList.remove('show');
  $('tv-connect').classList.remove('hidden');
  $('tv-connect-msg').textContent = msg || '';
  $('tv-code-input').focus();
}

let wakeLock = null;
async function requestWakeLock() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.code) { requestWakeLock(); schedulePoll(); } });

// ---------- ปุ่มบนหน้าจอ / รีโมต ----------
$('tv-connect-btn').addEventListener('click', () => connect($('tv-code-input').value));
$('tv-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') connect($('tv-code-input').value); });
document.addEventListener('keydown', e => {
  if ($('tv-connect').classList.contains('hidden')) {
    // ปรับเวลาเนื้อเพลงด้วยปุ่มลูกศรซ้าย/ขวา (ครั้งละ 100ms) กรณีเนื้อเพลงเร็ว/ช้ากว่าเสียง
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      S.syncMs += (e.key === 'ArrowRight' ? 100 : -100);
      localStorage.setItem('tv_sync_ms', String(S.syncMs));
      showStatus(`ปรับเวลาเนื้อเพลง ${S.syncMs > 0 ? '+' : ''}${S.syncMs} ms  (ซ้าย = ช้าลง / ขวา = เร็วขึ้น)`);
    } else if (e.key === 'Escape') disconnect('');
  }
});

// เปิดด้วย ?code=123456 (หรือรหัสที่จำไว้) แล้วเชื่อมต่ออัตโนมัติ
const initCode = new URLSearchParams(location.search).get('code') || '';
$('tv-code-input').value = initCode || localStorage.getItem('tv_code') || '';
requestAnimationFrame(frame);
if (initCode) connect(initCode); else $('tv-code-input').focus();
