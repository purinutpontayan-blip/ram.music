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



// ---- อัลกอริทึมดึงสีจากปก: คัดลอกจาก main.js ตรง ๆ ----
function hslToRgb(h, s, l) { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]; }
function rgbToHue(r, g, b) { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0; if (max !== min) { const d = max - min; if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6; else if (max === g) h = ((b - r) / d + 2) / 6; else h = ((r - g) / d + 4) / 6; } return Math.round(h * 360); }
// ------------------------------------------------------------
// Palette จากปกอัลบั้ม: ดึงหลายสีจริงๆ ของภาพ แล้วเอาไปใช้เป็นพื้นหลัง
// ------------------------------------------------------------
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
const colorDist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

// ดึงสีเด่นหลายสีที่ "ต่างกันจริง" จากภาพ (histogram + เลือกสีที่ห่างกัน)
function extractPalette(imgEl, count = 5) {
  const size = 64;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data; // ถ้าภาพโดน CORS บล็อก จะ throw ตรงนี้
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let e = bins.get(key); if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, e); }
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  const cands = [...bins.values()].filter(e => e.n >= 6).map(e => {
    const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max ? (max - min) / max : 0;
    return { r, g, b, n: e.n, sat, score: e.n * (0.5 + sat) };
  }).sort((x, y) => y.score - x.score);
  const picked = [];
  for (const minDist of [60, 40, 24]) {           // ผ่อนเกณฑ์ความต่างสีลงถ้าภาพมีสีน้อย
    for (const c of cands) {
      if (picked.length >= count) break;
      if (picked.every(p => colorDist(p, c) > minDist)) picked.push(c);
    }
    if (picked.length >= count) break;
  }
  // สีสดขึ้นก่อน (จะได้ blob ใหญ่ๆ เป็นสีเด่น) สีเทา/ดำไว้ท้าย
  picked.sort((x, y) => ((y.sat > .2) - (x.sat > .2)) || (y.score - x.score));
  return picked;
}

// ปรับสีให้ไม่มืด/ไม่จางเกินไปเมื่อใช้เป็นพื้นหลัง แล้วเติมให้ครบ count สี
function normalizePalette(picked, count = 5) {
  const out = picked.map(c => {
    let [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    if (s > 15) s = Math.min(90, Math.max(40, s * 1.15));
    l = Math.min(62, Math.max(30, l));
    return hslToRgb(h, s, l);
  });
  if (!out.length) out.push(hslToRgb(220, 55, 42));
  const [bh, bs, bl] = rgbToHsl(...out[0]);
  const shifts = [40, -40, 80, -80, 120, -120];
  for (let i = 0; out.length < count; i++) out.push(hslToRgb((bh + shifts[i % shifts.length] + 360) % 360, Math.max(bs, 35), bl));
  return out.slice(0, count);
}


// ============================================================
// ส่วนของ TV
// ============================================================
const S = {
  code: '', cur: null, trackId: '', paletteKey: '', serverPalette: null, paletteFromImage: false, lastPaletteSrc: '',
  offset: null, bestRtt: Infinity,            // offset = เวลาเซิร์ฟเวอร์ - performance.now()
  syncMs: Number(localStorage.getItem('tv_sync_ms')) || 0,
  timer: null, lastEl: null, lastSeekAt: 0, durKey: null,
  // เสียงบน TV (Web Playback SDK)
  audioOk: null, priv: null, pub: '', sas: '', helloAt: 0, grantTs: 0, token: '', player: null, deviceId: '',
  local: null, gesture: false, meta: new Map(), loadingId: ''
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

// ดึงสีจากปกบน TV เองด้วยอัลกอริทึมเดียวกับเครื่องส่ง (ได้สีเหมือนกัน และเปลี่ยนสีทันทีที่เพลงเปลี่ยน)
function tvExtract(img) {
  const src = img.currentSrc || img.src || '';
  if (!src || src === S.lastPaletteSrc) return;
  S.lastPaletteSrc = src;
  try { applyPalette(normalizePalette(extractPalette(img))); }
  catch (e) {
    if (S.serverPalette) applyPalette(S.serverPalette);
    else { let hash = 0; for (let i = 0; i < src.length; i++) hash = src.charCodeAt(i) + ((hash << 5) - hash); const hue = Math.abs(hash) % 360; applyPalette([0, 45, -45, 90, -90].map(d => hslToRgb((hue + d + 360) % 360, 65, 45))); }
  }
  S.paletteFromImage = true;
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
  S.trackId = track.id; S.paletteFromImage = false; S.lastPaletteSrc = '';
  const art = $('lyrics-modal-art');
  art.crossOrigin = 'anonymous';
  art.onload = () => tvExtract(art);
  if (track.cover) art.src = track.cover;
  if (art.complete && art.naturalWidth > 0) tvExtract(art);
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

// สถานะจากผู้ส่ง (ผ่านเซิร์ฟเวอร์) — ใช้เมื่อเสียงยังไม่ได้เล่นบน TV เครื่องนี้
function applyState(st) {
  if (!st || !st.track || !st.track.id) { S.cur = null; return; }
  S.cur = st; S.serverPalette = st.palette && st.palette.length ? st.palette : null;
  if (S.local) return;                                   // กำลังเล่นบน TV เอง: ใช้สถานะจาก SDK แทน
  if (st.track.id !== S.trackId) loadTrack(st.track);
  const pk = JSON.stringify(st.palette || []);
  if (!S.paletteFromImage && pk !== S.paletteKey) { S.paletteKey = pk; applyPalette(st.palette); }
}

// ข้อมูลการเล่นปัจจุบัน: ถ้าเสียงเล่นบน TV เครื่องนี้ใช้เวลาจาก SDK (แม่นที่สุด) ไม่ก็คำนวณจากที่ผู้ส่งบอก
function getPlayback() {
  const l = S.local;
  if (l) {
    const p = l.position + (l.paused ? 0 : performance.now() - l.ts) + S.syncMs;
    return { durationMs: l.duration, paused: l.paused, pos: Math.max(0, Math.min(l.duration || Infinity, p)) };
  }
  const st = S.cur; if (!st) return null;
  let p = st.position + st.lagMs + S.syncMs;
  // ตำแหน่งเพลง = ที่ผู้ส่งบอก + ค่าหน่วงขาส่ง + เวลาที่ผ่านไปตามนาฬิกาเซิร์ฟเวอร์ + ค่าปรับเวลาด้วยมือ (ปุ่มซ้าย/ขวา)
  if (!st.paused && S.offset != null) p += (performance.now() + S.offset) - st.serverTs;
  return { durationMs: st.track.durationMs, paused: st.paused, pos: Math.max(0, Math.min(st.track.durationMs || Infinity, p)) };
}

function updateSeek(pb) {
  const bar = document.querySelector('.seek-bar'); if (!bar) return;
  const d = pb.durationMs || 0, pct = d ? Math.min(1, pb.pos / d) : 0;
  bar.value = Math.round(pct * 1000); bar.style.setProperty('--pct', `${pct * 100}%`);
  document.querySelector('.seek-current').textContent = fmtTime(pb.pos);
  document.querySelector('.seek-remaining').textContent = '-' + fmtTime(d - pb.pos);
}

function frame(now) {
  const pb = getPlayback();
  if (pb) {
    const el = document.querySelector('#lyrics-container am-lyrics');
    if (el) {
      const durKey = pb.paused ? -1 : pb.durationMs;
      if (el !== S.lastEl || S.durKey !== durKey) { S.lastEl = el; S.durKey = durKey; el.setAttribute('duration', durKey); }
      el.currentTime = pb.pos;
    }
    if (now - S.lastSeekAt > 200) { S.lastSeekAt = now; updateSeek(pb); }
  }
  requestAnimationFrame(frame);
}

// ============================================================
// เสียงบน TV เครื่องนี้ (Spotify Web Playback SDK)
//  1) TV ส่งกุญแจสาธารณะ (ECDH) ไปขออนุญาต แล้วโชว์รหัสยืนยัน 4 หลักให้เทียบกับหน้าจอเครื่องส่ง
//  2) เครื่องส่งกดอนุญาต -> เข้ารหัสโทเค็น Spotify ด้วยกุญแจที่ตกลงกัน (เซิร์ฟเวอร์อ่านไม่ได้) ส่งมาที่ TV
//  3) TV เปิดตัวเล่นชื่อ "R Music TV <รหัส>" เครื่องส่งสลับเสียงมาที่นี่ เสียงเครื่องส่งจะดับ
// ============================================================
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function setAudio(text, isError) {
  const el = $('tv-audio'); if (!el) return;
  el.textContent = text || ''; el.classList.toggle('hidden', !text); el.classList.toggle('err', !!isError);
}

async function detectAudio() {
  try {
    if (!window.crypto?.subtle || !navigator.requestMediaKeySystemAccess) return false;
    const cfg = [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }] }];
    for (const ks of ['com.widevine.alpha', 'com.apple.fps.1_0']) { try { await navigator.requestMediaKeySystemAccess(ks, cfg); return true; } catch (e) { } }
  } catch (e) { }
  return false;
}

async function loadKeyPair() {
  try {
    const saved = JSON.parse(localStorage.getItem('tv_ecdh') || 'null');
    if (saved) return { priv: await crypto.subtle.importKey('jwk', saved.priv, ECDH, true, ['deriveKey']), pub: saved.pub };
  } catch (e) { }
  const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const pub = b64e(await crypto.subtle.exportKey('raw', kp.publicKey));
  localStorage.setItem('tv_ecdh', JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub }));
  return { priv: kp.privateKey, pub };
}

async function sasOf(pubB64) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b64d(pubB64)));
  return String((((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) % 10000).padStart(4, '0');
}

async function tvPost(payload) {
  const r = await fetch(TV_API, { method: 'POST', body: JSON.stringify(payload) });
  return r.json();
}

// เรียกครั้งแรกหลังเชื่อมต่อสำเร็จ
async function startAudioHandshake() {
  if (S.audioOk === null) S.audioOk = await detectAudio();
  if (!S.audioOk) { setAudio('เบราว์เซอร์ของ TV เครื่องนี้เล่นเสียงจาก Spotify ไม่ได้ จึงแสดงเฉพาะเนื้อเพลง (ถ้าอยากได้เสียงจากทีวี ให้เลือกทีวีในรายการอุปกรณ์บนเครื่องส่ง)', false); setTimeout(() => setAudio(''), 12000); return; }
  if (!S.priv) { const kp = await loadKeyPair(); S.priv = kp.priv; S.pub = kp.pub; S.sas = await sasOf(kp.pub); }
  await sendHello();
}

async function sendHello() {
  if (!S.code || S.token) return;
  S.helloAt = Date.now();
  try { await tvPost({ action: 'tv_hello', code: S.code, pub: S.pub, name: 'R Music TV' }); } catch (e) { }
  if (!S.player) setAudio(`ต้องการให้เสียงออกทางทีวีเครื่องนี้ไหม?  เปิดเว็บเพลเยอร์บนเครื่องส่ง > ปุ่ม TV > กด “อนุญาต”  •  รหัสยืนยัน  ${S.sas}  (ต้องตรงกับที่ขึ้นบนเครื่องส่ง)`);
}

async function handleGrant(g) {
  try {
    const epub = await crypto.subtle.importKey('raw', b64d(g.epub), ECDH, false, []);
    const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: epub }, S.priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(g.iv) }, aes, b64d(g.ct));
    const { token } = JSON.parse(new TextDecoder().decode(pt));
    if (!token) return;
    S.token = token;
    if (!S.player) initPlayer();
  } catch (e) { console.error('Grant error:', e); }
}

function initPlayer() {
  setAudio('กำลังเปิดตัวเล่นเสียงบนทีวี...');
  const start = () => {
    const p = new Spotify.Player({ name: `R Music TV ${S.code}`, getOAuthToken: cb => cb(S.token), volume: 1 });
    p.addListener('ready', ({ device_id }) => { S.deviceId = device_id; setAudio(S.gesture ? 'พร้อมเล่นเสียงบนทีวีเครื่องนี้แล้ว — รอเครื่องส่งสลับเสียงมาที่นี่' : 'พร้อมแล้ว — กดปุ่มใดก็ได้บนรีโมตเพื่อเปิดเสียง'); setTimeout(() => { if (!S.local) setAudio(''); }, 15000); });
    p.addListener('not_ready', () => setAudio('ตัวเล่นเสียงบนทีวีออฟไลน์', true));
    p.addListener('player_state_changed', onSdkState);
    p.addListener('autoplay_failed', () => setAudio('เบราว์เซอร์ปิดกั้นการเล่นอัตโนมัติ — กดปุ่มใดก็ได้บนรีโมตเพื่อเปิดเสียง', true));
    p.addListener('authentication_error', () => setAudio('โทเค็น Spotify หมดอายุ — ให้เครื่องส่งเข้าสู่ระบบใหม่ แล้วหน้านี้จะต่ออายุให้เอง', true));
    p.addListener('account_error', () => setAudio('ต้องใช้บัญชี Spotify Premium เพื่อเล่นเสียงบนทีวี', true));
    p.addListener('initialization_error', () => setAudio('เบราว์เซอร์ของ TV เครื่องนี้เล่นเสียงจาก Spotify ไม่ได้ (ยังแสดงเนื้อเพลงได้)', true));
    p.connect(); S.player = p;
  };
  if (window.Spotify) { start(); return; }
  window.onSpotifyWebPlaybackSDKReady = start;
  const sc = document.createElement('script'); sc.src = 'https://sdk.scdn.co/spotify-player.js'; document.head.appendChild(sc);
}

async function fetchMeta(id) {
  if (S.meta.has(id)) return S.meta.get(id);
  try {
    const r = await Promise.race([fetch(`https://api.spotify.com/v1/tracks/${id}`, { headers: { Authorization: `Bearer ${S.token}` } }), new Promise((_, rej) => setTimeout(rej, 1500))]);
    const j = await r.json();
    const m = { explicit: !!j.explicit, isrc: j.external_ids?.isrc || '' }; S.meta.set(id, m); return m;
  } catch (e) { return { explicit: false, isrc: '' }; }
}

// สถานะจากตัวเล่นบน TV เอง: เวลา/เพลง/เล่น-หยุด แม่นยำ ไม่มีความหน่วงจากเซิร์ฟเวอร์
async function onSdkState(state) {
  const t = state?.track_window?.current_track;
  if (!t) { S.local = null; return; }
  S.local = { id: t.id, position: state.position, duration: state.duration || t.duration_ms, paused: state.paused, ts: performance.now() };
  if (S.trackId !== t.id && S.loadingId !== t.id) {
    S.loadingId = t.id;
    const m = await fetchMeta(t.id);
    if (S.local && S.local.id === t.id && S.trackId !== t.id) {
      loadTrack({ id: t.id, name: t.name, artists: t.artists.map(a => a.name), album: t.album?.name || '', cover: t.album?.images?.[0]?.url || '', durationMs: t.duration_ms || state.duration, explicit: m.explicit, isrc: m.isrc });
    }
    S.loadingId = '';
  }
  setAudio('');
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

  const first = $('tv-connect').classList.contains('hidden') === false;
  $('tv-connect').classList.add('hidden');
  $('lyrics-modal').classList.remove('hidden');
  applyState(data.state);
  if (!data.state && !S.local) showStatus('เชื่อมต่อแล้ว — รอผู้ส่งเล่นเพลง...', 0);
  else if ($('tv-status').textContent.startsWith('เชื่อมต่อแล้ว') || $('tv-status').textContent.startsWith('เชื่อมต่อไม่ได้')) $('tv-status').classList.remove('show');

  // เสียงบน TV
  if (first) startAudioHandshake();
  else if (S.audioOk && S.priv && !S.token && !data.grant && Date.now() - S.helloAt > 240000) sendHello();
  if (data.grant && data.grant.ts !== S.grantTs && S.priv) { S.grantTs = data.grant.ts; handleGrant(data.grant); }
  schedulePoll();
}

function connect(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) { $('tv-connect-msg').textContent = 'กรุณากรอกรหัส 6 หลัก'; return; }
  S.code = code; S.offset = null; S.bestRtt = Infinity; S.trackId = ''; S.paletteKey = ''; S.cur = null; S.local = null; S.token = ''; S.grantTs = 0; S.helloAt = 0;
  try { S.player?.disconnect(); } catch (e) { } S.player = null;
  localStorage.setItem('tv_code', code);
  $('tv-connect-msg').textContent = 'กำลังเชื่อมต่อ...';
  clearTimeout(S.timer); poll();
  requestWakeLock();
}

function disconnect(msg) {
  clearTimeout(S.timer); S.code = ''; S.cur = null; S.local = null; S.trackId = '';
  try { S.player?.disconnect(); } catch (e) { } S.player = null; S.token = '';
  setAudio('');
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
// การกด/แตะครั้งแรกทำให้เบราว์เซอร์อนุญาตให้เล่นเสียง (นโยบาย autoplay)
const onGesture = () => { S.gesture = true; try { S.player?.activateElement?.(); } catch (e) { } };
document.addEventListener('keydown', onGesture, { capture: true });
document.addEventListener('click', onGesture, { capture: true });
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
