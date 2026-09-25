//============================================================
// CONFIG — Spotify Client ID
// ============================================================
const CLIENT_ID = '0c0581fc99704656885f8fbc84d0fcf6'; // Spotify Client ID — แก้ค่านี้ตรงนี้
const REDIRECT_URI = window.location.origin;

// ---------- สัญลักษณ์ E (Explicit = เนื้อหาไม่เหมาะสม) ----------
const EXPLICIT_HTML = '<span class="rank-explicit" title="เนื้อหาไม่เหมาะสม (Explicit)">E</span>';
const explicitMap = new Map(); // trackId -> true/false จำผลไว้ ไม่ต้องถามซ้ำ
const rememberExplicit = t => { if (t?.id && typeof t.explicit === 'boolean') explicitMap.set(t.id, t.explicit); return t?.explicit ? EXPLICIT_HTML : ''; };
// เพลงจาก Web Playback SDK ไม่มีข้อมูล explicit จึงถาม Spotify แล้วอัปเดตป้ายที่ Player และหน้าเนื้อเพลง
function setArtistWithBadge(el, text, explicit) {
  if (!el) return;
  el.textContent = '';
  if (explicit) { const b = document.createElement('span'); b.className = 'rank-explicit'; b.title = 'เนื้อหาไม่เหมาะสม (Explicit)'; b.textContent = 'E'; el.appendChild(b); }
  el.appendChild(document.createTextNode(text));
}
async function updateExplicitBadges(track) {
  const text = track.artists.map(a => a.name).join(', ');
  const apply = ex => { setArtistWithBadge(document.getElementById('player-artist'), text, ex); setArtistWithBadge(document.getElementById('lyrics-modal-artist'), text, ex); };
  if (explicitMap.has(track.id)) { apply(explicitMap.get(track.id)); return; }
  apply(false);
  try {
    const full = await fetchWebApi(`v1/tracks/${track.id}`);
    explicitMap.set(track.id, !!full?.explicit);
    if (full?.explicit && window._currentExplicitTrackId === track.id) apply(true);
  } catch (e) { }
}
let isPremium = true; // false เมื่อรู้ว่าเป็นบัญชี Free (เล่นเพลงบนเว็บไม่ได้ แต่ยังค้นหา/เรียกดูได้)

// ============================================================
// SPOTIFY AUTH (PKCE)
// ============================================================
function generateRandomString(length) {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function loginWithSpotify(forceDialog = false) {
  if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID_HERE') { alert('กรุณาใส่ Spotify Client ID ที่ตัวแปร CLIENT_ID ใน main.js'); return; }
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem('spotify_verifier', verifier);
  const params = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, code_challenge_method: 'S256', code_challenge: challenge, scope: ['user-read-private', 'user-read-email', 'streaming', 'user-read-playback-state', 'user-modify-playback-state', 'user-library-read', 'user-library-modify', 'user-follow-read', 'user-follow-modify', 'playlist-read-private', 'playlist-read-collaborative', 'playlist-modify-private', 'playlist-modify-public', 'user-top-read', 'user-read-recently-played'].join(' ') });
  // show_dialog=true บังคับให้ Spotify แสดงหน้าขออนุญาตใหม่ (ใช้ตอนสลับบัญชี / ขอสิทธิ์เพิ่ม)
  if (forceDialog) params.set('show_dialog', 'true');
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}
async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    window.history.replaceState({}, document.title, '/');
    const verifier = localStorage.getItem('spotify_verifier');
    const body = new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
    try {
      const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!response.ok) throw new Error('HTTP status ' + response.status);
      const data = await response.json();
      localStorage.setItem('spotify_access_token', data.access_token);
      localStorage.setItem('spotify_refresh_token', data.refresh_token);
      console.log('Granted scopes:', data.scope);
      return data.access_token;
    } catch (error) { console.error('Error fetching token:', error); return null; }
  }
  return localStorage.getItem('spotify_access_token');
}

function clearSession() {
  ['spotify_access_token', 'spotify_refresh_token', 'spotify_verifier'].forEach(k => localStorage.removeItem(k));
}
function disconnectPlayer() {
  try { window._spotifyPlayer?.pause(); window._spotifyPlayer?.disconnect(); } catch (e) { }
}
// ออกจากระบบ: ล้าง token แล้วกลับไปหน้า Login
function logout() {
  disconnectPlayer();
  clearSession();
  window.location.replace('/');
}
// สลับบัญชี: ล้าง token แล้วส่งไปหน้า Spotify ใหม่ (มีลิงก์ "ไม่ใช่คุณ?" ให้เปลี่ยนบัญชี)
function switchAccount() {
  disconnectPlayer();
  clearSession();
  loginWithSpotify(true);
}

// ============================================================
// SPOTIFY API
// ============================================================
// เมื่อ Spotify ตอบ 429 (เรียก API ถี่เกินไป) ทุก endpoint ต้องหยุดรอร่วมกันตามเวลาที่ Spotify บอกไว้ (Retry-After)
// ไม่งั้นคำขอที่ยิงพร้อมกันจะโดน 429 ซ้ำวนไปเรื่อยๆ จนเข้าหน้าศิลปิน/อัลบั้มไม่ได้เลยแบบที่เจอ
let rateLimitUntil = 0;
let apiQueue = Promise.resolve();
async function fetchWebApi(endpoint, method = 'GET', body, _retried) {
  const execute = async () => {
    let wait = rateLimitUntil - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const token = localStorage.getItem('spotify_access_token');
    const res = await fetch(`https://api.spotify.com/${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, method, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { localStorage.removeItem('spotify_access_token'); window.location.reload(); }
    if (res.status === 429) {
      const retryAfter = Math.min(15, Math.max(1, Number(res.headers.get('Retry-After')) || 3));
      rateLimitUntil = Math.max(rateLimitUntil, Date.now() + retryAfter * 1000);
      showToast('โอ๊ะ! เกิดข้อผิดพลาดบางอย่าง กรุณาลองอีกครั้ง', 'error');
      const err = new Error('โอ๊ะ! เกิดข้อผิดพลาดบางอย่าง กรุณาลองอีกครั้ง'); err.status = 429; throw err;
    }
    if (!res.ok) { const err = new Error(`API error: ${res.status}`); err.status = res.status; throw err; }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  };
  return new Promise((resolve, reject) => {
    apiQueue = apiQueue.then(async () => {
      try { resolve(await execute()); } catch (e) { reject(e); }
      await new Promise(r => setTimeout(r, 150));
    }).catch(() => {});
  });
}
const getUserProfile = () => fetchWebApi('v1/me');
const getRecentlyPlayed = () => fetchWebApi('v1/me/player/recently-played?limit=20');
const searchSpotify = (q) => fetchWebApi(`v1/search?q=${encodeURIComponent(q)}&type=track,artist,album&limit=10`);
const getArtist = (id) => fetchWebApi(`v1/artists/${id}`);
// Spotify removed GET /artists/{id}/top-tracks in the Feb 2026 API changes (Dev Mode apps).
// Fall back to searching tracks by artist name and keeping only ones credited to this artist ID.
const getArtistTopTracks = async (id, artistName) => {
  const data = await fetchWebApi(`v1/search?q=${encodeURIComponent(`artist:"${artistName}"`)}&type=track&limit=10`);
  const items = data?.tracks?.items || [];
  const filtered = items.filter(t => t.artists?.some(a => a.id === id));
  return { tracks: filtered.length ? filtered : items };
};
// The `market` param/field was also removed in that same update — omit it.
// Spotify's albums endpoint returns 400 if neither `market` nor a user-account country is present,
// and the account country field was also removed from GET /me — so a hardcoded market is required.
const DEFAULT_MARKET = 'TH';
const getArtistAlbums = (id) => fetchWebApi(`v1/artists/${id}/albums?include_groups=album,single&market=${DEFAULT_MARKET}&limit=10`);
const getAlbum = (id) => fetchWebApi(`v1/albums/${id}?market=${DEFAULT_MARKET}`);
const getAlbumTracks = (id) => fetchWebApi(`v1/albums/${id}/tracks?market=${DEFAULT_MARKET}&limit=50`);
// Follow/unfollow artist:
// 1) ลอง endpoint ใหม่ /me/library (uris อยู่ใน query string)
// 2) ถ้าไม่รองรับ artist (400/403/404) ให้ fallback ไป /me/following แบบเดิม
const artistUri = (id) => `spotify:artist:${id}`;
const canFallback = (e) => [400, 403, 404].includes(e?.status);
const checkFollowsArtist = async (artistId) => {
  try {
    const data = await fetchWebApi(`v1/me/library/contains?uris=${encodeURIComponent(artistUri(artistId))}`);
    return Array.isArray(data) ? !!data[0] : false;
  } catch (e) {
    if (!canFallback(e)) throw e;
    try {
      const data = await fetchWebApi(`v1/me/following/contains?type=artist&ids=${artistId}`);
      return Array.isArray(data) ? !!data[0] : false;
    } catch (e2) { throw e; }
  }
};
const followArtist = async (artistId) => {
  try { return await fetchWebApi(`v1/me/library?uris=${encodeURIComponent(artistUri(artistId))}`, 'PUT'); }
  catch (e) {
    if (!canFallback(e)) throw e;
    try { return await fetchWebApi(`v1/me/following?type=artist&ids=${artistId}`, 'PUT'); } catch (e2) { throw e; }
  }
};
const unfollowArtist = async (artistId) => {
  try { return await fetchWebApi(`v1/me/library?uris=${encodeURIComponent(artistUri(artistId))}`, 'DELETE'); }
  catch (e) {
    if (!canFallback(e)) throw e;
    try { return await fetchWebApi(`v1/me/following?type=artist&ids=${artistId}`, 'DELETE'); } catch (e2) { throw e; }
  }
};

// ============================================================
// PLAYER
// ============================================================
let deviceId, _onStateChange, _onReady;
// เล่นเสียงบนอุปกรณ์อื่นผ่าน Spotify Connect (เช่น ทีวี): remote.id ว่าง = เล่นบนเบราว์เซอร์นี้
const remote = { id: '', name: '', timer: null, last: null };
window.sdkIsReady = false;
window.pendingInit = null;
window.onSpotifyWebPlaybackSDKReady = () => {
  window.sdkIsReady = true;
  if (window.pendingInit) { window.pendingInit(); window.pendingInit = null; }
};

// Dynamically load the Spotify Web Playback SDK
const spotifyScript = document.createElement('script');
spotifyScript.src = "https://sdk.scdn.co/spotify-player.js";
document.head.appendChild(spotifyScript);

function initSpotifyPlayer(token, onStateChange, onReady) {
  _onStateChange = onStateChange; _onReady = onReady;
  const setup = () => {
    const player = new Spotify.Player({ name: 'R Music Web Player', getOAuthToken: cb => { cb(token); }, volume: 0.5 });
    player.addListener('initialization_error', ({ message }) => { console.error('Init error:', message); showToast('❌ ไม่สามารถเริ่ม Player ได้', 'error'); });
    player.addListener('authentication_error', ({ message }) => { console.error('Auth error:', message); localStorage.removeItem('spotify_access_token'); setTimeout(() => window.location.reload(), 2000); });
    player.addListener('account_error', () => showPremiumRequiredModal());
    player.addListener('playback_error', ({ message }) => { console.error('Playback error:', message); showToast('❌ เกิดข้อผิดพลาดในการเล่นเพลง', 'error'); });
    player.addListener('player_state_changed', state => { if (remote.id) return; /* กำลังเล่นบนอุปกรณ์อื่น ไม่ให้สถานะของเครื่องนี้มาทับ */ if (_onStateChange) _onStateChange(state); });
    player.addListener('ready', ({ device_id }) => { deviceId = device_id; transferPlaybackHere(device_id); if (_onReady) _onReady(); showToast('✅ Player พร้อมใช้งานแล้ว!', 'info'); });
    player.addListener('not_ready', ({ device_id }) => { console.log('Device offline:', device_id); });
    player.connect();
    window._spotifyPlayer = player;
  };
  if (window.sdkIsReady) setup(); else window.pendingInit = setup;
}
async function transferPlaybackHere(device_id) {
  try { await fetchWebApi('v1/me/player', 'PUT', { device_ids: [device_id], play: false }); } catch (e) { }
}
async function playTrack(uri, contextUri) {
  if (!isPremium) { showToast('⚠️ ต้องใช้ Spotify Premium เพื่อเล่นเพลง', 'warning'); return; }
  if (!deviceId) { showToast('⚠️ Player ยังไม่พร้อม กรุณารอสักครู่', 'warning'); return; }
  setPlayLoading(true); // แสดงอนิเมชันโหลดทันทีที่กดเล่น จนกว่าเพลงจะเริ่มเล่นจริง (state เปลี่ยน)
  try {
    let trackId = null;
    if (uri && uri.startsWith('spotify:track:')) {
      trackId = uri.split(':')[2];
    } else if (contextUri && contextUri.startsWith('spotify:track:')) {
      trackId = contextUri.split(':')[2];
    }
    
    if (trackId && (!currentTrackData || currentTrackData.id !== trackId)) {
        try {
            const track = await fetchWebApi(`v1/tracks/${trackId}`);
            if (track) {
                currentTrackData = track;
                await setupLyricsComponent(track);
            }
        } catch (e) { console.error("Error preloading lyrics", e); }
    }

    const body = contextUri ? { context_uri: contextUri, ...(uri ? { offset: { uri } } : {}) } : { uris: [uri] };
    await fetchWebApi(`v1/me/player/play?device_id=${remote.id || deviceId}`, 'PUT', body);
  } catch (e) { 
      setPlayLoading(false); 
      if (e && e.status !== 429) showToast('❌ ไม่สามารถเล่นเพลงนี้ได้', 'error'); 
  }
}

function setPlayLoading(on) {
  document.querySelectorAll('.btn-play').forEach(b => b.classList.toggle('is-loading', on));
}
async function remoteCmd(kind, arg) {
  const q = `device_id=${encodeURIComponent(remote.id)}`;
  try {
    if (kind === 'play') await fetchWebApi(`v1/me/player/play?${q}`, 'PUT');
    else if (kind === 'pause') await fetchWebApi(`v1/me/player/pause?${q}`, 'PUT');
    else if (kind === 'next') await fetchWebApi(`v1/me/player/next?${q}`, 'POST');
    else if (kind === 'previous') await fetchWebApi(`v1/me/player/previous?${q}`, 'POST');
    else if (kind === 'seek') await fetchWebApi(`v1/me/player/seek?position_ms=${Math.round(arg)}&${q}`, 'PUT');
    setTimeout(pollRemote, 600);
  } catch (e) { console.error('Remote command error:', e); showToast('❌ สั่งอุปกรณ์ปลายทางไม่สำเร็จ', 'error'); }
}
const togglePlay = () => { if (remote.id) return remoteCmd(seekState.paused ? 'play' : 'pause'); if (window._spotifyPlayer) window._spotifyPlayer.togglePlay(); };
const nextTrack = () => { if (remote.id) return remoteCmd('next'); if (window._spotifyPlayer) window._spotifyPlayer.nextTrack(); };
const previousTrack = () => { if (remote.id) return remoteCmd('previous'); if (window._spotifyPlayer) window._spotifyPlayer.previousTrack(); };
const playbackResume = () => remote.id ? remoteCmd('play') : window._spotifyPlayer?.resume();
const playbackPause = () => remote.id ? remoteCmd('pause') : window._spotifyPlayer?.pause();
const playbackSeek = ms => remote.id ? remoteCmd('seek', ms) : window._spotifyPlayer?.seek(ms);

// ---------- เล่นเสียงบนอุปกรณ์อื่น (Spotify Connect) ----------
// แปลงผลจาก GET /v1/me/player ให้อยู่ในรูปเดียวกับสถานะของ Web Playback SDK เพื่อใช้ UI/เนื้อเพลง/แชร์ TV ชุดเดิม
function stateFromApi(d) {
  const item = d?.item; if (!item || item.type !== 'track') return null;
  const age = d.timestamp ? Math.min(3000, Math.max(0, Date.now() - d.timestamp)) : 0; // ข้อมูลจาก API เก่าไปกี่ ms
  const position = Math.min(item.duration_ms, (d.progress_ms || 0) + (d.is_playing ? age : 0));
  return { track_window: { current_track: item }, position, duration: item.duration_ms, paused: !d.is_playing };
}

async function pollRemote() {
  if (!remote.id) return;
  try {
    const d = await fetchWebApi('v1/me/player');
    if (!remote.id || !d || !d.device) return;
    if (d.device.id === deviceId) { leaveRemote(); return; }                       // ผู้ใช้สลับกลับมาเล่นบนเครื่องนี้ (เช่นจากแอป Spotify)
    if (d.device.id !== remote.id) { remote.id = d.device.id; remote.name = d.device.name; remoteUiRefresh(); } // ไปเล่นบนอุปกรณ์อื่นจากแอป Spotify
    const st = stateFromApi(d); if (!st) return;
    const track = st.track_window.current_track, now = performance.now(), prev = remote.last;
    const expected = prev ? (prev.paused ? prev.position : prev.position + (now - prev.at)) : -1;
    const changed = !prev || prev.id !== track.id || prev.paused !== st.paused || Math.abs(expected - st.position) > 1500;
    remote.last = { id: track.id, paused: st.paused, position: st.position, at: now };
    if (changed) handlePlayerStateChange(st); else syncSeekFromState(st);
  } catch (e) { if (e.status !== 429) console.error('Remote poll error:', e); }
}

function enterRemote(dev) {
  remote.id = dev.id; remote.name = dev.name; remote.last = null;
  clearInterval(remote.timer); remote.timer = setInterval(pollRemote, 4000); // ยืดจังหวะเรียก Spotify ลง ลดโอกาสโดน 429
  remoteUiRefresh(); setTimeout(pollRemote, 800);
}
function leaveRemote() {
  clearInterval(remote.timer); remote.id = ''; remote.name = ''; remote.last = null;
  remoteUiRefresh();
  window._spotifyPlayer?.getCurrentState?.().then(st => { if (st) handlePlayerStateChange(st); }).catch(() => { });
}
async function transferToDevice(dev) {
  const wasPlaying = !seekState.paused && seekState.duration > 0;
  try { await fetchWebApi('v1/me/player', 'PUT', { device_ids: [dev.id], play: wasPlaying }); }
  catch (e) {
    console.error('Transfer error:', e);
    showToast(e.status === 404 ? '❌ ไม่พบอุปกรณ์นี้แล้ว ลองกดค้นหาใหม่' : e.status === 403 ? '❌ อุปกรณ์นี้ไม่รับคำสั่งจาก Spotify' : '❌ สลับอุปกรณ์ไม่สำเร็จ', 'error');
    return;
  }
  if (dev.id === deviceId) leaveRemote(); else enterRemote(dev);
  showToast(dev.id === deviceId ? '🔊 เล่นเสียงบนเครื่องนี้' : `🔊 เล่นเสียงบน ${dev.name}`, 'info');
}

// กล่องข้อความกลางจอ พร้อมปุ่ม "สลับบัญชี" / "ออกจากระบบ" เสมอ — กันเคสที่แอปใช้งานไม่ได้แล้วออกจากระบบไม่ได้
function showAccountModal({ id = 'account-modal', icon = 'ℹ️', title, html, closable = false, retry = false }) {
  document.getElementById(id)?.remove();
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(5px);z-index:3000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `<div class="glass-panel" style="padding:2.2rem;border-radius:24px;text-align:center;max-width:440px;width:90%;max-height:90vh;overflow-y:auto;background:rgba(25,25,30,.95);">
    <div style="font-size:2.6rem;margin-bottom:.8rem">${icon}</div>
    <h2 style="font-size:1.4rem;margin-bottom:.9rem;color:#fff">${title}</h2>
    <div style="color:#a0a0a5;line-height:1.7;margin-bottom:1.6rem;font-size:.95rem;text-align:left">${html}</div>
    <div class="account-modal-btns" style="display:flex;flex-direction:column;gap:.6rem"></div>
  </div>`;
  const box = overlay.querySelector('.account-modal-btns');
  const mk = (label, bg, color, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.style.cssText = `background:${bg};color:${color};border:none;padding:.85rem 1.5rem;border-radius:14px;cursor:pointer;font:inherit;font-weight:600;font-size:.95rem;`; b.addEventListener('click', fn); box.appendChild(b); };
  if (retry) mk('🔁 ลองใหม่', '#1db954', '#fff', () => window.location.reload());
  if (closable) mk('ดูเพลงต่อ (ไม่ฟังเพลง)', 'rgba(255,255,255,.12)', '#fff', () => overlay.remove());
  mk('🔄 สลับบัญชี', 'rgba(255,255,255,.12)', '#fff', switchAccount);
  mk('🚪 ออกจากระบบ', 'rgba(255,107,107,.15)', '#ff6b6b', logout);
  document.body.appendChild(overlay);
}
// บัญชี Free: Spotify ไม่อนุญาตให้เล่นเพลงผ่านเว็บ (Web Playback SDK ต้องใช้ Premium)
function showPremiumRequiredModal() {
  isPremium = false;
  document.getElementById('player-screen')?.classList.add('hidden');
  showAccountModal({
    id: 'premium-modal', icon: '🎵', title: 'ต้องใช้ Spotify Premium เพื่อฟังเพลง', closable: true,
    html: 'บัญชีนี้เป็นแบบ <strong style="color:#fff">Free</strong> ซึ่ง Spotify ไม่อนุญาตให้เล่นเพลงผ่านเว็บเพลเยอร์ได้<br><br>คุณยังค้นหาและเรียกดูศิลปิน/อัลบั้มได้ แต่จะกดเล่นเพลงไม่ได้ ถ้าต้องการฟัง ให้สลับไปใช้บัญชี Premium หรืออัปเกรดที่ <a href="https://www.spotify.com/premium/" target="_blank" rel="noopener" style="color:#1ed760">spotify.com/premium</a>'
  });
}
// เข้าถึงข้อมูลบัญชีไม่ได้ (เช่น 403 เพราะยังไม่ได้เพิ่มบัญชีในแอป Development Mode)
function showAccessError(e) {
  if (e?.status === 403) {
    showAccountModal({
      id: 'access-error-modal', icon: '🔒', title: 'บัญชีนี้ยังใช้งานแอปไม่ได้',
      html: 'Spotify ปฏิเสธการเข้าถึง (403) เพราะแอปนี้อยู่ใน <strong style="color:#fff">Development Mode</strong> ซึ่งอนุญาตเฉพาะบัญชีที่เจ้าของแอปเพิ่มไว้ (สูงสุด 5 คน)<br><br><strong style="color:#fff">วิธีแก้:</strong> เจ้าของแอปเข้า <em>developer.spotify.com/dashboard</em> → เลือกแอป → <em>User Management</em> → เพิ่มชื่อและอีเมลของบัญชีนี้ แล้วล็อกอินใหม่ หรือสลับไปใช้บัญชีอื่น'
    });
  } else {
    showAccountModal({
      id: 'access-error-modal', icon: '⚠️', title: 'โหลดข้อมูลไม่สำเร็จ', retry: true,
      html: `เกิดข้อผิดพลาดขณะเชื่อมต่อ Spotify${e?.message ? ` (${String(e.message).replace(/[<>&]/g, '')})` : ''}<br>ลองใหม่อีกครั้ง หรือสลับ/ออกจากระบบแล้วเข้าใหม่`
    });
  }
}

// ============================================================
// UI
// ============================================================
function showScreen(id) { document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); }
function showView(viewId) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.getElementById('search-bar-container').classList.toggle('hidden', viewId !== 'view-search');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.target === viewId.replace('view-', '')));
  if (viewId === 'view-ranking') startRankingView(); else stopRankingView();
  if (viewId === 'view-playlists') loadMyPlaylists();
}
function renderUserProfile(profile) {
  const container = document.getElementById('user-profile');
  const name = profile.display_name || profile.id || 'User';
  const imageUrl = profile.images?.length ? profile.images[0].url : '';
  container.innerHTML = '';

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'user-profile-btn'; btn.title = 'บัญชีของฉัน';
  btn.setAttribute('aria-haspopup', 'menu');

  let avatar;
  if (imageUrl) { avatar = document.createElement('img'); avatar.src = imageUrl; avatar.alt = ''; }
  else { avatar = document.createElement('div'); avatar.className = 'avatar-fallback'; avatar.textContent = name.charAt(0).toUpperCase(); }
  const label = document.createElement('span'); label.className = 'user-name'; label.textContent = name;
  const chevron = document.createElement('span'); chevron.className = 'user-chevron'; chevron.textContent = '▴';
  btn.append(avatar, label, chevron);
  container.appendChild(btn);

  // เมนูบัญชี (สร้างครั้งเดียว)
  let menu = document.getElementById('account-menu');
  if (menu) menu.remove();
  menu = document.createElement('div');
  menu.id = 'account-menu'; menu.className = 'account-menu hidden'; menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="account-menu-header"></div>
    <button type="button" class="account-menu-item" id="menu-switch-account" role="menuitem">🔄 สลับบัญชี</button>
    <button type="button" class="account-menu-item danger" id="menu-logout" role="menuitem">🚪 ออกจากระบบ</button>`;
  menu.querySelector('.account-menu-header').textContent = name;
  document.body.appendChild(menu);

  const closeMenu = () => menu.classList.add('hidden');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu.classList.contains('hidden')) { closeMenu(); return; }
    menu.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.bottom = `${window.innerHeight - r.top + 8}px`;
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  menu.querySelector('#menu-switch-account').addEventListener('click', () => { closeMenu(); switchAccount(); });
  menu.querySelector('#menu-logout').addEventListener('click', () => { closeMenu(); logout(); });
}
// การ์ดใหญ่ 2 ใบด้านบนสุดของหน้าหลัก (คล้าย Apple Music) ใช้เพลงที่ฟังล่าสุด 2 เพลง
function renderHeroBanner(historyData, onPlay) {
  const box = document.getElementById('hero-banner'); if (!box) return;
  box.innerHTML = '';
  const tracks = (historyData?.items || []).map(i => i.track).filter((t, idx, arr) => t && arr.findIndex(x => x.uri === t.uri) === idx).slice(0, 2);
  if (!tracks.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  tracks.forEach((t, i) => {
    const card = document.createElement('div'); card.className = 'hero-card';
    const img = t.album?.images?.[0]?.url || '';
    card.style.backgroundImage = img ? `url("${img}")` : '';
    const tag = document.createElement('div'); tag.className = 'hero-tag'; tag.textContent = i === 0 ? 'ฟังล่าสุด' : 'ฟังต่อ';
    const info = document.createElement('div'); info.className = 'hero-info';
    const title = document.createElement('div'); title.className = 'hero-title'; title.textContent = t.name;
    const sub = document.createElement('div'); sub.className = 'hero-sub'; sub.textContent = t.artists.map(a => a.name).join(', ');
    info.append(title, sub);
    const play = document.createElement('button'); play.type = 'button'; play.className = 'hero-play'; play.setAttribute('aria-label', 'เล่น');
    play.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z"/></svg>';
    play.onclick = e => { e.stopPropagation(); onPlay(t.uri); };
    card.append(tag, info, play);
    card.onclick = () => onPlay(t.uri);
    box.appendChild(card);
  });
}

// เพลย์ลิสต์ของฉันเท่านั้น (ไม่รวมที่ไปติดตามคนอื่น) เรียงคล้ายอัลบัมในหน้าค้นหา
async function loadMyPlaylists() {
  const box = document.getElementById('my-playlists-grid'); if (!box) return;
  box.innerHTML = '<div class="empty-hint">กำลังโหลด...</div>';
  try {
    const user = await getUserProfile();
    const data = await fetchWebApi('v1/me/playlists?limit=50');
    const mine = (data?.items || []).filter(p => p && p.owner?.id === user.id);
    box.innerHTML = '';
    if (!mine.length) { box.innerHTML = '<div class="empty-hint">คุณยังไม่มีเพลย์ลิสต์ของตัวเอง</div>'; return; }
    mine.forEach(p => {
      const div = document.createElement('div'); div.className = 'album-card playlist-card';
      const img = p.images?.[0]?.url || '';
      div.innerHTML = `<img src="${img}" alt="${p.name}"><div class="playlist-title">${p.name}</div><div class="playlist-owner">${p.tracks?.total || 0} เพลง</div>`;
      div.onclick = () => playTrack(undefined, p.uri);
      box.appendChild(div);
    });
  } catch (e) { console.error('My playlists error:', e); box.innerHTML = '<div class="empty-hint">โหลดเพลย์ลิสต์ไม่สำเร็จ</div>'; }
}

function renderHistory(historyData, onPlay) {
  const container = document.getElementById('history-grid'); container.innerHTML = '';
  if (!historyData?.items) return;
  const unique = []; const uris = new Set();
  for (const item of historyData.items) { if (!uris.has(item.track.uri)) { uris.add(item.track.uri); unique.push(item.track); } }
  unique.slice(0, 12).forEach(track => {
    if (!track) return;
    const div = document.createElement('div'); div.className = 'history-card playlist-card';
    div.innerHTML = `<img src="${track.album.images[0]?.url}" alt="${track.name}"><div class="playlist-title">${track.name}</div><div class="playlist-owner">${track.artists.map(a => a.name).join(', ')}</div>`;
    div.onclick = () => onPlay(track.uri);
    div.oncontextmenu = (e) => { e.preventDefault(); if (window.showTrackContextMenu) window.showTrackContextMenu(e, track); };
    container.appendChild(div);
  });
}
function renderSearchResults(results, onPlay, onArtistClick, onAlbumClick) {
  const container = document.getElementById('search-results'), artistsContainer = document.getElementById('search-artists'), albumsContainer = document.getElementById('search-albums');
  container.innerHTML = ''; artistsContainer.innerHTML = ''; if (albumsContainer) albumsContainer.innerHTML = '';
  if (!results) return;
  results.artists?.items?.slice(0, 5).forEach(artist => {
    const div = document.createElement('div'); div.className = 'artist-card playlist-card';
    const imgUrl = artist.images?.[0]?.url || '';
    div.innerHTML = `<img src="${imgUrl}" alt="${artist.name}" style="border-radius:50%"><div class="playlist-title" style="text-align:center;margin-top:10px">${artist.name}</div>`;
    div.onclick = () => onArtistClick(artist.id); artistsContainer.appendChild(div);
  });
  results.albums?.items?.slice(0, 5).forEach(album => {
    const div = document.createElement('div'); div.className = 'album-card playlist-card';
    const imgUrl = album.images?.[0]?.url || '';
    div.innerHTML = `<img src="${imgUrl}" alt="${album.name}"><div class="playlist-title">${album.name}</div><div class="playlist-owner">${album.artists?.map(a => a.name).join(', ') || ''}</div>`;
    div.onclick = () => onAlbumClick(album.id); albumsContainer?.appendChild(div);
  });
  results.tracks?.items?.forEach(track => {
    const div = document.createElement('div'); div.className = 'track-item';
    div.innerHTML = `<img src="${track.album.images[0]?.url}" alt="${track.name}"><div class="track-item-info"><div class="track-item-title">${track.name}</div><div class="track-item-artist">${rememberExplicit(track)}${track.artists.map(a => a.name).join(', ')}</div></div>`;
    div.appendChild(trackRowActions(track));
    div.onclick = () => onPlay(track.uri);
    div.oncontextmenu = (e) => { e.preventDefault(); if (window.showTrackContextMenu) window.showTrackContextMenu(e, track); };
    container.appendChild(div);
  });
}
// ปุ่มถูกใจ + เพิ่มเข้าเพลย์ลิสต์ ต่อท้ายแต่ละแถวเพลง (หน้าค้นหา/ศิลปิน/อัลบั้ม)
function trackRowActions(track) {
  const wrap = document.createElement('div'); wrap.className = 'track-item-actions';
  const queue = document.createElement('button'); queue.type = 'button'; queue.className = 'row-icon-btn row-queue-btn'; queue.title = 'เพิ่มเข้าคิวเล่นถัดไป';
  queue.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M15,6H3V8H15V6M15,10H3V12H15V10M3,16H11V14H3V16Z"/></svg>';
  queue.onclick = e => { e.stopPropagation(); addToQueue(track); };
  wrap.appendChild(queue);
  return wrap;
}

// เพิ่มเพลงเข้าคิวเล่นถัดไป (Spotify Connect) ต้องมีอุปกรณ์กำลังเล่นเพลงอยู่ก่อน
async function addToQueue(track) {
  const uri = track.uri || `spotify:track:${track.id}`;
  try {
    await fetchWebApi(`v1/me/player/queue?uri=${encodeURIComponent(uri)}&device_id=${remote.id || deviceId}`, 'POST');
    showToast('➕ เพิ่มเข้าคิวเล่นถัดไปแล้ว', 'info');
  } catch (e) {
    console.error('Add to queue error:', e);
    showToast(e.status === 404 ? '❌ ต้องเล่นเพลงอยู่ก่อนถึงจะเพิ่มเข้าคิวได้' : '❌ เพิ่มเข้าคิวไม่สำเร็จ', 'error');
  }
}

// ---------- เพลย์ลิสต์แนะนำประจำวัน (จันทร์-ศุกร์) ----------
// ใช้เพลย์ลิสต์ทางการของ Spotify (ID สาธารณะ คงที่ ไม่ผูกกับบัญชีผู้ใช้) สลับตามวัน
// ยืนยันแล้วว่าใช้ได้จริง 2 รายการ (ชาร์ตไทย) หากต้องการเพิ่มวันละเพลย์ลิสต์ต่างกันจริงๆ
// ให้หา Playlist ID จาก Spotify (คลิกขวาเพลย์ลิสต์ > Share > Copy link) แล้วใส่เพิ่มในนี้
const DAILY_CHART_PLAYLISTS = {
  1: { id: '37i9dQZEVXbMnz8KIWsvf9', label: 'จันทร์' }, // Top 50 - Thailand
  2: { id: '37i9dQZEVXbL0GavIqMTeb', label: 'อังคาร' }, // Viral 50 - Thailand
  3: { id: '37i9dQZEVXbMnz8KIWsvf9', label: 'พุธ' },
  4: { id: '37i9dQZEVXbL0GavIqMTeb', label: 'พฤหัสบดี' },
  5: { id: '37i9dQZEVXbMnz8KIWsvf9', label: 'ศุกร์' },
  0: { id: '37i9dQZEVXbMnz8KIWsvf9', label: 'อาทิตย์' }, // เสาร์-อาทิตย์ ใช้ของจันทร์แทน กันหน้าว่าง
  6: { id: '37i9dQZEVXbL0GavIqMTeb', label: 'เสาร์' }
};

async function loadDailyChart() {
  const box = document.getElementById('daily-charts'); if (!box) return;
  const conf = DAILY_CHART_PLAYLISTS[new Date().getDay()];
  try {
    const fields = 'name,uri,external_urls,tracks.items(track(id,name,uri,duration_ms,explicit,artists(name),album(images)))';
    const pl = await fetchWebApi(`v1/playlists/${conf.id}?market=TH&fields=${encodeURIComponent(fields)}`);
    const tracks = (pl?.tracks?.items || []).map(it => it.track).filter(Boolean).slice(0, 10);
    if (!tracks.length) { box.innerHTML = ''; return; }
    box.innerHTML = '';
    
    const heading = document.createElement('div');
    heading.className = 'daily-chart-heading';
    heading.innerHTML = `
      <div class="daily-chart-title">เพลย์ลิสต์ที่คุณอาจถูกใจประจำวัน${conf.label}</div>
      <div class="daily-chart-source">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>
        <span>อ้างอิงจาก <a href="${pl.external_urls?.spotify || '#'}" target="_blank">เพลย์ลิสต์ทางการ Spotify</a></span>
      </div>
    `;
    box.appendChild(heading);

    const list = rkEl('div', 'tracks-list daily-chart-list');
    tracks.forEach((t, i) => {
      const div = document.createElement('div'); div.className = 'track-item';
      div.innerHTML = `<div class="chart-rank">${i + 1}</div><img src="${t.album?.images?.[0]?.url || ''}" alt="${t.name}"><div class="track-item-info"><div class="track-item-title">${t.name}</div><div class="track-item-artist">${t.explicit ? '<span class="rank-explicit" title="เนื้อหาไม่เหมาะสม (Explicit)">E</span>' : ''}${t.artists.map(a => a.name).join(', ')}</div></div>`;
      div.appendChild(trackRowActions(t));
      div.onclick = () => playTrack(t.uri, pl.uri);
      list.appendChild(div);
    });
    box.appendChild(list);
  } catch (e) { console.error('Daily chart error:', e); box.innerHTML = ''; } // โหลดไม่สำเร็จ (เช่นเพลย์ลิสต์ถูกลบ/ย้าย) ให้ข้ามไปเงียบๆ ไม่ทำให้หน้าแรกพัง
}
function renderArtistView(artist, topTracks, albums, onPlay, onAlbumClick, isFollowing, onToggleFollow) {
  const header = document.getElementById('artist-header');
  const imgUrl = artist.images?.[0]?.url || '';
  // Spotify ถอดฟิลด์ followers ออกจาก Artist object ใน Dev Mode (Feb 2026) จึงไม่มีตัวเลขให้แสดง
  // แสดงเฉพาะเมื่อมีค่าจริง (ไม่โชว์ "0 followers" ที่ทำให้เข้าใจผิด) ถ้าไม่มีให้แสดงแนวเพลงแทน
  const followersTotal = artist.followers?.total;
  const genresText = (artist.genres || []).slice(0, 3).join(' • ');
  const subtitle = typeof followersTotal === 'number' ? `${followersTotal.toLocaleString()} followers` : genresText;
  const subtitleHtml = subtitle ? `<p style="color:var(--text-muted);margin-top:10px">${subtitle}</p>` : '';
  header.innerHTML = `<div style="display:flex;align-items:center;gap:20px;margin-bottom:30px"><img src="${imgUrl}" alt="${artist.name}" style="width:150px;height:150px;border-radius:50%;object-fit:cover;box-shadow:0 8px 24px rgba(0,0,0,.5)"><div><h1 style="font-size:3rem;margin:0">${artist.name}</h1>${subtitleHtml}<button id="btn-follow-artist" class="btn-primary" style="margin-top:12px;padding:.6rem 1.5rem;font-size:.95rem;">${isFollowing ? '✓ กำลังติดตาม' : 'ติดตาม'}</button></div></div>`;
  const followBtn = document.getElementById('btn-follow-artist');
  if (followBtn && onToggleFollow) followBtn.onclick = onToggleFollow;
  const tracksContainer = document.getElementById('artist-top-tracks'); tracksContainer.innerHTML = '';
  topTracks?.tracks?.slice(0, 5).forEach(track => {
    const div = document.createElement('div'); div.className = 'track-item';
    div.innerHTML = `<img src="${track.album?.images?.[0]?.url || ''}" alt="${track.name}"><div class="track-item-info"><div class="track-item-title">${track.name}</div><div class="track-item-artist">${rememberExplicit(track)}${track.artists?.map(a => a.name).join(', ')}</div></div>`;
    div.appendChild(trackRowActions(track));
    div.onclick = () => onPlay(track.uri);
    div.oncontextmenu = (e) => { e.preventDefault(); if (window.showTrackContextMenu) window.showTrackContextMenu(e, track); };
    tracksContainer.appendChild(div);
  });
  const albumsContainer = document.getElementById('artist-albums'); albumsContainer.innerHTML = '';
  albums?.items?.forEach(album => {
    const div = document.createElement('div'); div.className = 'album-card playlist-card';
    div.innerHTML = `<img src="${album.images?.[0]?.url || ''}" alt="${album.name}"><div class="playlist-title">${album.name}</div><div class="playlist-owner">${new Date(album.release_date).getFullYear()} • ${album.album_type}</div>`;
    div.onclick = () => onAlbumClick(album.id);
    albumsContainer.appendChild(div);
  });
}
function renderAlbumView(album, tracksData, onPlay) {
  const header = document.getElementById('album-header');
  const imgUrl = album.images?.[0]?.url || '';
  const year = album.release_date ? new Date(album.release_date).getFullYear() : '';
  const artistNames = album.artists?.map(a => a.name).join(', ') || '';
  const totalTracks = album.total_tracks || tracksData?.items?.length || 0;
  header.innerHTML = `<div style="display:flex;align-items:center;gap:20px;margin-bottom:30px"><img src="${imgUrl}" alt="${album.name}" style="width:150px;height:150px;border-radius:12px;object-fit:cover;box-shadow:0 8px 24px rgba(0,0,0,.5)"><div><h1 style="font-size:2.5rem;margin:0">${album.name}</h1><p style="color:var(--text-muted);margin-top:10px">${artistNames}${year ? ' • ' + year : ''} • ${totalTracks} เพลง</p></div></div>`;
  const tracksContainer = document.getElementById('album-tracks'); tracksContainer.innerHTML = '';
  (tracksData?.items || []).forEach((track, idx) => {
    const div = document.createElement('div'); div.className = 'track-item';
    const trackWithAlbum = { ...track, album };
    div.innerHTML = `<img src="${imgUrl}" alt="${track.name}"><div class="track-item-info"><div class="track-item-title">${idx + 1}. ${track.name}</div><div class="track-item-artist">${rememberExplicit(track)}${track.artists?.map(a => a.name).join(', ')}</div></div>`;
    div.appendChild(trackRowActions(trackWithAlbum));
    div.onclick = () => onPlay(track.uri, album.uri);
    div.oncontextmenu = (e) => { e.preventDefault(); if (window.showTrackContextMenu) window.showTrackContextMenu(e, trackWithAlbum); };
    tracksContainer.appendChild(div);
  });
}
function updatePlayerUI(state) {
  if (!state) return;
  const track = state.track_window.current_track; if (!track) return;
  document.getElementById('player-art').src = track.album.images[0]?.url;
  document.getElementById('player-art').classList.remove('hidden');
  document.getElementById('player-title').textContent = track.name;
  window._currentExplicitTrackId = track.id;
  updateExplicitBadges(track);
  const modalArt = document.getElementById('lyrics-modal-art');
  if (modalArt) { modalArt.crossOrigin = 'anonymous'; modalArt.src = track.album.images[0]?.url; modalArt.onload = () => extractAndApplyColor(modalArt); if (modalArt.complete && modalArt.naturalWidth > 0) extractAndApplyColor(modalArt); }
  const modalTitle = document.getElementById('lyrics-modal-title');
  if (modalTitle) {
    const titleText = track.name;
    modalTitle.innerHTML = `<span class="marquee-inner">${titleText}&nbsp;&nbsp;&nbsp;${titleText}</span>`;
    requestAnimationFrame(() => { const inner = modalTitle.querySelector('.marquee-inner'); if (inner && inner.scrollWidth > modalTitle.clientWidth * 2 + 1) { modalTitle.classList.add('is-overflow'); } else { modalTitle.classList.remove('is-overflow'); modalTitle.innerHTML = `<span class="marquee-inner">${titleText}</span>`; } });
  }
  const iconPlay = document.getElementById('icon-play'), iconPause = document.getElementById('icon-pause');
  const modalIconPlay = document.getElementById('lyrics-icon-play'), modalIconPause = document.getElementById('lyrics-icon-pause');
  if (state.paused) { iconPlay.classList.remove('hidden'); iconPause.classList.add('hidden'); modalIconPlay?.classList.remove('hidden'); modalIconPause?.classList.add('hidden'); }
  else { iconPlay.classList.add('hidden'); iconPause.classList.remove('hidden'); modalIconPlay?.classList.add('hidden'); modalIconPause?.classList.remove('hidden'); }
}
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

function applyPalette(palette) {
  tvS.palette = palette.map(c => [c[0], c[1], c[2]]); if (tvS.session) tvSchedulePush(600); // ส่งสีเดียวกันนี้ไปให้หน้าจอ TV
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  document.documentElement.style.setProperty('--accent-glow', rgba(palette[0], 0.4));
  // พื้นหลังหน้าหลัก: ไล่สี 5 สีจากปก
  const mobile = window.matchMedia('(max-width: 768px)').matches;
  const k = mobile ? 1.7 : 1.2; // มือถือปรับให้สีเข้มขึ้น เพราะจอเล็กและแสงแดดทำให้สีจางลง
  const amb = document.getElementById('ambient-bg');
  if (amb) palette.forEach((c, i) => amb.style.setProperty(`--amb${i + 1}`, rgba(c, Math.min(.9, (i === 0 ? .42 : .32) * k))));
  // พื้นหลังหน้าเนื้อเพลง: blob 5 ก้อน ก้อนละสี
  const modal = document.getElementById('lyrics-modal'); if (!modal) return;
  palette.forEach((c, i) => modal.style.setProperty(`--blob${i + 1}`, rgba(c, Math.min(.95, (i < 3 ? .6 : .5) * (mobile ? 1.5 : 1)))));
  let blobLayer = modal.querySelector('.modal-blobs');
  if (!blobLayer) {
    blobLayer = document.createElement('div'); blobLayer.className = 'modal-blobs';
    blobLayer.innerHTML = [1, 2, 3, 4, 5].map(n => `<div class="blob blob-${n}"></div>`).join('');
    modal.insertBefore(blobLayer, modal.firstChild);
  }
}
let _lastPaletteSrc = '';
function extractAndApplyColor(imgEl) {
  const src = imgEl.currentSrc || imgEl.src || '';
  if (src && src === _lastPaletteSrc) return;   // ปกเดิม ไม่ต้องคำนวณซ้ำทุกครั้งที่ state เปลี่ยน
  _lastPaletteSrc = src;
  try {
    applyPalette(normalizePalette(extractPalette(imgEl)));
  } catch (e) {
    // ถ้าอ่านพิกเซลไม่ได้ (CORS) ใช้สีจาก hash ของ URL แทน
    let hash = 0; for (let i = 0; i < src.length; i++) hash = src.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    applyPalette([0, 45, -45, 90, -90].map(d => hslToRgb((hue + d + 360) % 360, 65, 45)));
  }
}
// ============================================================
// ประวัติการนำทาง (ปุ่มย้อนกลับของเบราว์เซอร์/มือถือ)
//  - แต่ละหน้า (Home/Search/Ranking/ศิลปิน/อัลบั้ม) และหน้าต่างซ้อน (เนื้อเพลง/TV/ส่งเพลง/เพลย์ลิสต์) เป็น 1 รายการในประวัติ
//  - กดย้อนกลับ = ปิดหน้าต่างซ้อนก่อน แล้วค่อยย้อนไปหน้าก่อนหน้า ทีละขั้น
//  - ถึงหน้าหลักแล้วกดย้อนกลับ จะไม่ออกจากแอปทันที ต้องกดซ้ำอีกครั้งภายใน 2.5 วินาที
// ============================================================
const NAV = { ready: false, restoring: false, exitArmed: false, exitTimer: null, artistId: '', albumId: '' };
const currentViewId = () => document.querySelector('.view.active')?.id || 'view-home';
const $el = id => document.getElementById(id);

const OVERLAYS = {
  lyrics: {
    isOpen: () => !$el('lyrics-modal').classList.contains('hidden'),
    set: on => {
      const modal = $el('lyrics-modal');
      if (on) { modal.classList.remove('hidden'); modal.requestFullscreen?.().catch(() => { }); closeLyricsMoreMenu(); return; }
      closeLyricsMoreMenu();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { }).finally(() => modal.classList.add('hidden'));
      else modal.classList.add('hidden');
    }
  },
  rank: { isOpen: () => !$el('ranking-modal').classList.contains('hidden'), set: on => { $el('ranking-modal').classList.toggle('hidden', !on); if (!on) rankingPick = null; } },
  tv: { isOpen: () => !$el('tv-modal').classList.contains('hidden'), set: on => { $el('tv-modal').classList.toggle('hidden', !on); if (!on) tvHelloStop(); } },
  playlist: { isOpen: () => !$el('playlist-modal').classList.contains('hidden'), set: on => $el('playlist-modal').classList.toggle('hidden', !on) }
};

function overlayOpen(name) {
  const o = OVERLAYS[name]; if (!o || o.isOpen()) return;
  // ป็อปอัพอื่น (เช่น เพิ่มเข้าเพลย์ลิสต์) เป็นพี่น้องของ lyrics-modal ใน DOM ไม่ใช่ลูก
  // ตอน lyrics-modal อยู่ในโหมดเต็มจอจริงของเบราว์เซอร์ พี่น้องจะไม่ถูกวาดทับขึ้นมาแม้ z-index จะสูงกว่า จึงต้องออกจากเต็มจอก่อน
  if (name !== 'lyrics' && document.fullscreenElement) document.exitFullscreen().catch(() => { });
  o.set(true);
  if (!NAV.ready) return;
  const base = history.state?.app ? history.state : { app: 1, v: currentViewId(), id: '' };
  history.pushState({ ...base, o: name }, '');
}
function overlayClose(name) {
  const o = OVERLAYS[name]; if (!o || !o.isOpen()) return;
  o.set(false);
  // ปิดป็อปอัพที่ซ้อนอยู่แล้ว กลับเข้าเต็มจอเนื้อเพลงต่อ ถ้าหน้าเนื้อเพลงยังเปิดอยู่
  if (name !== 'lyrics' && OVERLAYS.lyrics.isOpen() && !document.fullscreenElement) document.getElementById('lyrics-modal').requestFullscreen?.().catch(() => { });
  if (NAV.ready && history.state?.o === name) history.back(); // เอารายการของหน้าต่างนี้ออกจากประวัติ
}
// ============================================================
// เมนู "เพิ่มเติม" ในหน้าเนื้อเพลง (ปุ่มจุดไข่ปลา 3 จุด)
// ============================================================
let sleepTimer = null, sleepAt = 0, sleepLabelTimer = null;

function closeLyricsMoreMenu() { document.getElementById('lyrics-more-menu')?.classList.add('hidden'); }

function askText(title, defaultValue) {
  return new Promise(resolve => {
    const modal = document.getElementById('text-prompt-modal'), input = document.getElementById('text-prompt-input');
    document.getElementById('text-prompt-title').textContent = title;
    input.value = defaultValue || '';
    // ป็อปอัพนี้เป็นพี่น้องของ lyrics-modal ใน DOM เช่นกัน ต้องออกจากโหมดเต็มจอก่อน ไม่งั้นจะถูกเนื้อเพลงบังเหมือนที่เคยเป็นกับหน้าต่างเพลย์ลิสต์
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    modal.classList.remove('hidden');
    requestAnimationFrame(() => { input.focus(); input.select(); });
    const done = val => {
      modal.classList.add('hidden'); ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); input.removeEventListener('keydown', onKey);
      if (OVERLAYS.lyrics.isOpen() && !document.fullscreenElement) document.getElementById('lyrics-modal').requestFullscreen?.().catch(() => { });
      resolve(val);
    };
    const ok = document.getElementById('text-prompt-ok'), cancel = document.getElementById('text-prompt-cancel');
    const onOk = () => done(input.value.trim());
    const onCancel = () => done(null);
    const onKey = e => { if (e.key === 'Enter') onOk(); else if (e.key === 'Escape') onCancel(); };
    ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel); input.addEventListener('keydown', onKey);
  });
}

async function createPlaylistWithTrack(track) {
  if (!track) return;
  const name = (await askText('ตั้งชื่อเพลย์ลิสต์ใหม่', track.name ? `เพลย์ลิสต์ของ ${track.name}` : '') || '').trim();
  if (!name) return;
  try {
    const user = currentUser || await getUserProfile();
    const pl = await fetchWebApi(`v1/users/${user.id}/playlists`, 'POST', { name, public: false });
    await fetchWebApi(`v1/playlists/${pl.id}/tracks`, 'POST', { uris: [track.uri || `spotify:track:${track.id}`] });
    showToast(`✅ สร้างเพลย์ลิสต์ "${name}" แล้ว`, 'info');
  } catch (e) { console.error('Create playlist error:', e); showToast('❌ สร้างเพลย์ลิสต์ไม่สำเร็จ', 'error'); }
}

async function shareTrack(track) {
  if (!track) return;
  const url = `https://open.spotify.com/track/${track.id}`;
  if (navigator.share) { try { await navigator.share({ title: track.name, text: track.artists?.map(a => a.name).join(', '), url }); return; } catch (e) { return; } }
  try { await navigator.clipboard.writeText(url); showToast('✅ คัดลอกลิงก์เพลงแล้ว', 'info'); } catch (e) { showToast(url, 'info'); }
}

function sleepLabelUpdate() {
  const label = document.getElementById('menu-sleep-label'); if (!label) return;
  if (!sleepTimer) { label.textContent = 'ตั้งเวลาหยุดเล่น'; clearInterval(sleepLabelTimer); return; }
  const left = Math.max(0, Math.round((sleepAt - Date.now()) / 60000));
  label.textContent = `หยุดเล่นใน ${left} นาที (แตะเพื่อยกเลิก)`;
}
function cancelSleepTimer() { clearTimeout(sleepTimer); sleepTimer = null; sleepLabelUpdate(); showToast('ยกเลิกการตั้งเวลาหยุดเล่นแล้ว', 'info'); }
function setSleepTimer(minutes) {
  clearTimeout(sleepTimer);
  sleepAt = Date.now() + minutes * 60000;
  sleepTimer = setTimeout(() => { playbackPause(); sleepTimer = null; sleepLabelUpdate(); showToast('⏸ หยุดเล่นตามเวลาที่ตั้งไว้', 'info'); }, minutes * 60000);
  clearInterval(sleepLabelTimer); sleepLabelTimer = setInterval(sleepLabelUpdate, 30000);
  sleepLabelUpdate();
  showToast(`🌙 ตั้งเวลาหยุดเล่นใน ${minutes} นาทีแล้ว`, 'info');
}

function renderSleepOptions() {
  const box = document.getElementById('lyrics-more-menu'); if (!box) return;
  const opts = [5, 15, 30, 60];
  box.innerHTML = `
    <button type="button" class="lyrics-more-item" id="sleep-back"><span class="lyrics-more-item-icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z"/></svg></span><span>กลับ</span></button>
    <div class="lyrics-more-sep"></div>
    ${opts.map(m => `<button type="button" class="lyrics-more-item sleep-opt" data-min="${m}"><span>${m} นาที</span></button>`).join('')}
    <button type="button" class="lyrics-more-item sleep-opt" data-min="track"><span>จบเพลงนี้</span></button>
    ${sleepTimer ? '<div class="lyrics-more-sep"></div><button type="button" class="lyrics-more-item" id="sleep-cancel"><span>ยกเลิกการตั้งเวลา</span></button>' : ''}
  `;
  box.querySelector('#sleep-back').onclick = renderMainMenu;
  box.querySelectorAll('.sleep-opt').forEach(b => b.onclick = () => {
    const v = b.dataset.min;
    if (v === 'track') { const d = seekState.duration, p = currentSeekPosition(); setSleepTimer(Math.max(0.1, (d - p) / 60000)); }
    else setSleepTimer(Number(v));
    closeLyricsMoreMenu();
  });
  box.querySelector('#sleep-cancel')?.addEventListener('click', () => { cancelSleepTimer(); closeLyricsMoreMenu(); });
}

function renderMainMenu() {
  const box = document.getElementById('lyrics-more-menu'); if (!box) return;
  box.innerHTML = document.getElementById('lyrics-more-menu-template').innerHTML;
  bindMainMenuEvents();
  sleepLabelUpdate(); // ถ้ามีการตั้งเวลาหยุดเล่นค้างอยู่ ให้ป้ายในเมนูขึ้นเวลานับถอยหลังทันทีตอนเปิดเมนูใหม่
}

function bindMainMenuEvents() {
  document.getElementById('menu-add-to-playlist')?.addEventListener('click', () => { closeLyricsMoreMenu(); if (currentTrackData) { currentContextTrack = currentTrackData; document.getElementById('menu-add-playlist').click(); } });
  document.getElementById('menu-new-playlist')?.addEventListener('click', () => { closeLyricsMoreMenu(); createPlaylistWithTrack(currentTrackData); });
  document.getElementById('menu-share-track')?.addEventListener('click', () => { closeLyricsMoreMenu(); shareTrack(currentTrackData); });
  document.getElementById('menu-sleep-timer')?.addEventListener('click', renderSleepOptions);
}

function setupLyricsMoreMenu() {
  const btn = document.getElementById('btn-lyrics-more'), box = document.getElementById('lyrics-more-menu');
  if (!btn || !box) return;
  // เก็บ HTML ตั้งต้นของเมนูไว้ ใช้สร้างกลับหลังออกจากเมนูย่อย (ตั้งเวลาหยุดเล่น)
  const tpl = document.createElement('template'); tpl.id = 'lyrics-more-menu-template'; tpl.innerHTML = box.innerHTML;
  document.body.appendChild(tpl);
  bindMainMenuEvents();
  btn.addEventListener('click', e => { e.stopPropagation(); const willOpen = box.classList.contains('hidden'); closeLyricsMoreMenu(); if (willOpen) { renderMainMenu(); box.classList.remove('hidden'); } });
  document.addEventListener('click', e => { if (!e.target.closest('.lyrics-more-wrap')) closeLyricsMoreMenu(); });
}

function toggleLyricsModal() { if (OVERLAYS.lyrics.isOpen()) overlayClose('lyrics'); else overlayOpen('lyrics'); }
window.closePlaylistModal = () => overlayClose('playlist');

// เรียกก่อนเปลี่ยนหน้าด้วยการกดของผู้ใช้ (ไม่เรียกตอนกู้หน้าจากปุ่มย้อนกลับ)
function navGo(v, id = '') {
  if (!NAV.ready || NAV.restoring) return;
  const cur = history.state;
  if (cur?.app && cur.v === v && (cur.id || '') === id && !cur.o) return;
  history.pushState({ app: 1, v, id }, '');
}

function navInit() {
  if (NAV.ready) return; NAV.ready = true;
  history.replaceState({ guard: true }, '');                 // จุดเริ่มต้น: ย้อนถึงตรงนี้ = ผู้ใช้จะออกจากแอป
  history.pushState({ app: 1, v: 'view-home', id: '' }, '');
  window.addEventListener('popstate', navOnPop);
}

function navOnPop(e) {
  const st = e.state;
  const closeAll = () => Object.keys(OVERLAYS).forEach(n => { if (OVERLAYS[n].isOpen()) OVERLAYS[n].set(false); });
  if (!st || st.guard || !st.app) {
    // ย้อนกลับจากหน้าหลักสุด: กดซ้ำภายใน 2.5 วินาทีถึงจะออกจริง
    if (NAV.exitArmed) { NAV.exitArmed = false; clearTimeout(NAV.exitTimer); history.back(); return; }
    NAV.exitArmed = true;
    showToast('กดย้อนกลับอีกครั้งเพื่อออกจากแอป', 'info');
    NAV.exitTimer = setTimeout(() => { NAV.exitArmed = false; }, 2500);
    closeAll();
    NAV.restoring = true; try { showView('view-home'); } finally { NAV.restoring = false; }
    history.pushState({ app: 1, v: 'view-home', id: '' }, '');
    return;
  }
  NAV.restoring = true;
  try {
    Object.keys(OVERLAYS).forEach(n => { if (n !== st.o && OVERLAYS[n].isOpen()) OVERLAYS[n].set(false); });
    if (st.o && !OVERLAYS[st.o].isOpen()) history.replaceState({ ...st, o: undefined }, ''); // หน้าต่างที่เปิดกลับมาเองไม่ได้ ตัดออกจากสถานะ
    // หน้าศิลปิน/อัลบั้มใช้ตัวแสดงร่วมกัน: ถ้าเนื้อหาที่ค้างอยู่เป็นของ id นี้ก็แค่สลับหน้า ไม่ต้องโหลดใหม่
    if (st.v === 'view-artist' && st.id) { if (NAV.artistId === st.id) showView('view-artist'); else handleArtistClick(st.id); }
    else if (st.v === 'view-album' && st.id) { if (NAV.albumId === st.id) showView('view-album'); else handleAlbumClick(st.id); }
    else if (st.v !== currentViewId()) showView(st.v);
  } finally { NAV.restoring = false; }
}

function showToast(message, type = 'info') {
  // ข้อความแจ้งเตือนต้องอยู่ในหน้าเนื้อเพลงตอนที่มันเต็มจอจริงของเบราว์เซอร์ ไม่งั้นจะถูกบังจนมองไม่เห็น (เหมือนที่เคยเป็นกับป็อปอัพอื่น)
  const host = document.fullscreenElement || document.body;
  let container = document.getElementById('toast-container');
  if (!container) { container = document.createElement('div'); container.id = 'toast-container'; container.className = 'toast-container'; host.appendChild(container); }
  else if (container.parentElement !== host) host.appendChild(container);
  const toast = document.createElement('div'); toast.className = `toast toast-${type}`; toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ============================================================
// LYRICS
// ============================================================
let lyricsUpdateInterval;
function updateLyricsComponent(positionMs, durationMs, paused) {
  clearInterval(lyricsUpdateInterval);
  const lyricsEl = document.querySelector('am-lyrics'); if (!lyricsEl) return;
  if (positionMs !== undefined) { lyricsEl.setAttribute('current-time', positionMs); lyricsEl.setAttribute('duration', paused ? -1 : durationMs); }
  if (!paused && positionMs !== undefined) {
    let currentPos = positionMs, lastTime = performance.now();
    lyricsUpdateInterval = setInterval(() => { const now = performance.now(); currentPos += (now - lastTime); lastTime = now; lyricsEl.setAttribute('current-time', currentPos); lyricsEl.currentTime = currentPos; }, 100);
  }
}
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
/* ซ่อนแถบเครื่องมือของวิดเจ็ตเนื้อเพลง (โรมันจิ/แปล/ดาวน์โหลด) และท้ายเครดิต — เหลือไว้แค่ชื่อผู้แต่งเพลง */
.lyrics-header, .widget-header { display: none !important; }
.lyrics-footer > div:not(.songwriters-info) { display: none !important; }
.songwriters-info { display: block !important; }
`;

// เปลี่ยนป้าย "Songwriters" ของวิดเจ็ตเป็น "ผู้แต่ง:" (ข้อความภายใน shadow DOM ของวิดเจ็ต แก้ผ่าน CSS ไม่ได้ ต้องแก้ที่ตัวอักษรโดยตรง)
function relabelSongwriters(root) {
  const b = root.querySelector('.songwriters-info b');
  if (b && b.textContent !== 'ผู้แต่ง:') b.textContent = 'ผู้แต่ง:';
}

function mountLyricsEl(container, attrs) {
  container.innerHTML = '';
  const el = document.createElement('am-lyrics');
  Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') el.setAttribute(k, String(v)); });
  el.setAttribute('autoscroll', 'true'); el.setAttribute('interpolate', 'true'); el.setAttribute('font-family', "'Kanit', sans-serif");
  container.appendChild(el);
  const waitForShadow = setInterval(() => {
    if (!el.isConnected) { clearInterval(waitForShadow); return; }
    if (el.shadowRoot) {
      clearInterval(waitForShadow);
      const st = document.createElement('style'); st.textContent = LYRICS_SHADOW_CSS; el.shadowRoot.appendChild(st);
      fixThaiSpans(el.shadowRoot); relabelSongwriters(el.shadowRoot);
      new MutationObserver(() => { fixThaiSpans(el.shadowRoot); relabelSongwriters(el.shadowRoot); }).observe(el.shadowRoot, { childList: true, subtree: true });
    }
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

async function setupLyricsComponent(track) {
  const container = document.getElementById('lyrics-container');
  container.innerHTML = '<div class="lyrics-loading-spinner"><div class="lyrics-spinner"></div><div class="lyrics-loading-text">กำลังค้นหาเนื้อเพลง...</div></div>';
  const stale = () => !!currentTrackData && currentTrackData.id !== track.id;
  const cleanTitle = track.name;
  const primaryArtist = track.artists[0].name;
  const album = track.album?.name || '';
  const queryStr = `${cleanTitle} ${primaryArtist} ${album}`.trim();
  let isrc = '';
  try { const fullTrack = await fetchWebApi(`v1/tracks/${track.id}`); if (fullTrack?.external_ids?.isrc) isrc = fullTrack.external_ids.isrc; } catch (e) { }
  if (stale()) return;

  const lyricsEl = mountLyricsEl(container, {
    'song-title': cleanTitle, 'song-artist': primaryArtist, 'song-album': album, 'song-duration': track.duration_ms,
    query: queryStr, isrc, romanize: "true", providers: "lrc.red,lrclib,netease"
  });
  syncLyricsTime();

  const result = await waitLyricsResult(lyricsEl);
  if (result === 'synced' || result === 'gone' || stale()) return;

  // ได้แต่เนื้อเพลงเปล่า ๆ หรือไม่เจอ -> หาเวอร์ชันซิงก์เอง
  const found = await findSyncedLrc(track);
  if (!found || stale() || !container.contains(lyricsEl)) {
     if (container.contains(lyricsEl)) container.innerHTML = '<div class="lyrics-not-found">ไม่มีเนื้อเพลงสำหรับเพลงนี้</div>';
     return;
  }
  const ttml = lrcToTtml(found.syncedLyrics);
  if (!ttml) {
     if (container.contains(lyricsEl)) container.innerHTML = '<div class="lyrics-not-found">ไม่มีเนื้อเพลงสำหรับเพลงนี้</div>';
     return;
  }
  mountLyricsEl(container, { 'song-title': cleanTitle, 'song-artist': primaryArtist, 'song-duration': track.duration_ms, ttml, romanize: "true" });
  syncLyricsTime();
}

async function createPlaylistWithTrack(track) {
  if (!track) return;
  const modal = document.getElementById('text-prompt-modal');
  const input = document.getElementById('text-prompt-input');
  const title = document.getElementById('text-prompt-title');
  if (!modal || !input) return;
  
  title.textContent = 'ตั้งชื่อเพลย์ลิสต์ใหม่';
  input.value = '';
  input.placeholder = 'ชื่อเพลย์ลิสต์';
  overlayOpen('text-prompt');
  input.focus();
  
  const cleanup = () => {
    document.getElementById('text-prompt-ok').onclick = null;
    document.getElementById('text-prompt-cancel').onclick = null;
  };
  document.getElementById('text-prompt-cancel').onclick = () => {
    cleanup();
    overlayClose('text-prompt');
  };
  document.getElementById('text-prompt-ok').onclick = async () => {
    const name = input.value.trim();
    if (!name) return;
    cleanup();
    overlayClose('text-prompt');
    
    try {
      const user = await getUserProfile();
      const pl = await fetchWebApi(`v1/users/${user.id}/playlists`, 'POST', {
        name: name,
        description: 'Created via R Music',
        public: false
      });
      if (pl && pl.id) {
        await fetchWebApi(`v1/playlists/${pl.id}/tracks`, 'POST', {
          uris: [track.uri || `spotify:track:${track.id}`]
        });
        showToast(`✅ สร้างและเพิ่มเพลงลงใน "${name}" แล้ว`, 'info');
        loadMyPlaylists();
      }
    } catch (e) {
      console.error(e);
      showToast('❌ สร้างเพลย์ลิสต์ไม่สำเร็จ', 'error');
    }
  };
}

// ตั้งเวลาปัจจุบันให้ <am-lyrics> ที่เพิ่งสร้างใหม่ทันที ไม่ต้องรอ state ถัดไปจาก Spotify
function syncLyricsTime() {
  if (typeof seekState === 'undefined') return;
  updateLyricsComponent(currentSeekPosition(), seekState.duration, seekState.paused);
}

// ============================================================
// SEEK BAR (แถบเลือกจุดเพลง) — ใช้ร่วมกันทั้ง Player ด้านล่างและหน้าเนื้อเพลง
// ============================================================
const seekState = { position: 0, duration: 0, paused: true, ts: 0, dragging: false };
function fmtTime(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function currentSeekPosition() {
  if (seekState.paused) return seekState.position;
  return Math.min(seekState.duration, seekState.position + (performance.now() - seekState.ts));
}
function renderSeek(posMs) {
  const d = seekState.duration;
  const pos = Math.max(0, Math.min(d || 0, posMs));
  const pct = d ? pos / d : 0;
  document.querySelectorAll('.seek-row').forEach(row => {
    const bar = row.querySelector('.seek-bar');
    bar.disabled = !d;
    bar.value = Math.round(pct * 1000);
    bar.style.setProperty('--pct', `${pct * 100}%`);
    row.querySelector('.seek-current').textContent = fmtTime(pos);
    row.querySelector('.seek-remaining').textContent = '-' + fmtTime(d - pos);
  });
}
function syncSeekFromState(state) {
  if (!state) return;
  seekState.position = state.position; seekState.duration = state.duration;
  seekState.paused = state.paused; seekState.ts = performance.now();
  if (!seekState.dragging) renderSeek(state.position);
}
function setupSeekBars() {
  document.querySelectorAll('.seek-bar').forEach(bar => {
    // ระหว่างลาก: อัปเดตตัวเลขเวลาและแถบทุกอัน แต่ยังไม่สั่งเลื่อนเพลง
    bar.addEventListener('input', () => { seekState.dragging = true; renderSeek(bar.value / 1000 * seekState.duration); });
    // ปล่อยนิ้ว/เมาส์: สั่ง Spotify เลื่อนไปจุดนั้นจริง
    bar.addEventListener('change', async () => {
      const pos = Math.round(bar.value / 1000 * seekState.duration);
      seekState.position = pos; seekState.ts = performance.now(); seekState.dragging = false;
      renderSeek(pos);
      try { await playbackSeek(pos); }
      catch (e) { console.error('Seek error:', e); showToast('❌ ไม่สามารถเลื่อนเพลงได้', 'error'); }
      updateLyricsComponent(pos, seekState.duration, seekState.paused);
    });
  });
  // กันกรณีลากแล้วไม่มี change event (เช่น ปล่อยที่ค่าเดิม) ไม่ให้ค้างสถานะ dragging
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, () => setTimeout(() => { seekState.dragging = false; }, 150)));
  // เดินเวลาต่อเองระหว่างที่ SDK ยังไม่ส่ง state ใหม่
  setInterval(() => { if (!document.hidden && !seekState.dragging && !seekState.paused && seekState.duration) renderSeek(currentSeekPosition()); }, 250);
  // ซิงก์กับ Player จริงทุก 5 วินาที กันเวลาเพี้ยน (เช่น บัฟเฟอร์)
  setInterval(async () => {
    if (!window._spotifyPlayer || remote.id || seekState.dragging || seekState.paused) return;
    try { syncSeekFromState(await window._spotifyPlayer.getCurrentState()); } catch (e) { }
  }, 5000);
}

// ============================================================
// WAKE LOCK — กันหน้าจอล็อก/ดับอัตโนมัติระหว่างเปิดหน้าเนื้อเพลง
// ============================================================
let wakeLock = null, wakeLockWarned = false;
const isLyricsOpen = () => !document.getElementById('lyrics-modal')?.classList.contains('hidden');
async function requestWakeLock() {
  if (wakeLock || document.visibilityState !== 'visible') return;
  if (!navigator.wakeLock) {
    if (!wakeLockWarned) { wakeLockWarned = true; showToast('⚠️ เบราว์เซอร์นี้ไม่รองรับการกันหน้าจอดับ', 'warning'); }
    return;
  }
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!isLyricsOpen()) { lock.release().catch(() => { }); return; } // ปิดหน้าเนื้อเพลงไปแล้วระหว่างรอ
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch (e) { console.warn('Wake lock error:', e.name, e.message); wakeLock = null; }
}
async function releaseWakeLock() {
  const lock = wakeLock; wakeLock = null;
  try { await lock?.release(); } catch (e) { }
}
function setupWakeLock() {
  const modal = document.getElementById('lyrics-modal'); if (!modal) return;
  // ดูการเปิด/ปิดหน้าเนื้อเพลงจาก class "hidden" ครอบคลุมทุกทาง (ปุ่ม Lyrics, ปุ่มปิด, ออกจากเต็มจอ)
  new MutationObserver(() => { if (isLyricsOpen()) requestWakeLock(); else releaseWakeLock(); }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  // เบราว์เซอร์จะปล่อย wake lock เองเมื่อแท็บถูกซ่อน (สลับแอป/ปิดจอ) ต้องขอใหม่เมื่อกลับมา
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isLyricsOpen()) requestWakeLock(); });
}

// ============================================================
// RANKING — จัดอันดับเพลง (Google Sheet + Apps Script)
// ============================================================
// URL ของ Apps Script Web App (ลงท้ายด้วย /exec) — วางตรงนี้ ไม่ต้องใส่ใน index.html
const RANKING_API = 'https://script.google.com/macros/s/AKfycbyxZaws0vfMVlzZijyO8ukeYGKd2IOJ3Y5LAOvok3pgRLU2GdOabnoaA3On2UvFz1i1wg/exec'; // เช่น 'https://script.google.com/macros/s/xxxxxxxx/exec'
const RANKING_REFRESH_MS = 30000;
let rankingTimer = null, rankingPick = null, rankingBusy = false;
let rankingTopics = [], rankingTopic = null; // หัวข้อจัดอันดับทั้งหมด / หัวข้อที่กำลังดูอยู่
const RANKING_TOPIC_KEY = 'ranking_topic_id';

const rkFmt = ms => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const rkSafeUrl = u => (/^https:\/\//i.test(u || '') ? u : '');
const rkEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// สัญลักษณ์ E = เพลงที่มีเนื้อหาไม่เหมาะสม (Explicit) ข้อมูลมาจาก Spotify
const rkExplicitBadge = () => { const b = rkEl('span', 'rank-explicit', 'E'); b.title = 'เนื้อหาไม่เหมาะสม (Explicit)'; return b; };
const RK_ERRORS = {
  unauthorized: 'เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าใหม่',
  invalid_song: 'ข้อมูลเพลงไม่ถูกต้อง',
  invalid_cover: 'รูปปกไม่ถูกต้อง (ต้องเป็น PNG / JPG / GIF)',
  cover_too_large: 'รูปปกใหญ่เกิน 1.5MB',
  cover_type: 'ไฟล์รูปต้องเป็น PNG, JPG หรือ GIF เท่านั้น',
  busy: 'ระบบกำลังยุ่ง ลองใหม่อีกครั้ง',
  topic_not_found: 'ไม่พบหัวข้อนี้ (อาจถูกลบไปแล้ว) กรุณากดรีเฟรช',
  topic_closed: 'หัวข้อนี้ปิดโหวตแล้ว'
};

// GET (ไม่ส่ง payload) = ดึงหัวข้อ/อันดับ (query = { action, topic }), POST = ส่งเพลง/โหวต
// ใช้ Content-Type: text/plain เพื่อไม่ให้เกิด CORS preflight (Apps Script ไม่รองรับ OPTIONS)
async function rankingApi(payload, query) {
  if (!RANKING_API) throw new Error('no_api');
  let res;
  if (payload) {
    res = await fetch(RANKING_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  } else {
    const q = new URLSearchParams({ action: 'list', user: currentUser?.id || '', ...query, _: Date.now() });
    res = await fetch(`${RANKING_API}?${q}`);
  }
  if (!res.ok) throw new Error('http_' + res.status);
  return res.json();
}

function rankingNotice(box, text) { box.innerHTML = ''; box.appendChild(rkEl('div', 'rank-empty', text)); }

function renderRanking(items) {
  const box = document.getElementById('ranking-list'); if (!box) return;
  box.innerHTML = '';
  if (!items?.length) { rankingNotice(box, rankingTopicClosed() ? 'หัวข้อนี้ปิดโหวตแล้วและยังไม่มีเพลงในอันดับ' : 'ยังไม่มีเพลงในหัวข้อนี้ — ค้นหาเพลงด้านบนแล้วเป็นคนแรกที่ส่งเลย! 🎵'); return; }
  const closed = rankingTopicClosed();
  // แสดงเป็นการ์ดปกเพลง เหมือนอัลบัม/ศิลปินในหน้าค้นหา
  items.slice(0, 20).forEach(it => {
    const card = rkEl('div', 'playlist-card rank-card' + (it.rank <= 3 ? ` top-${it.rank}` : ''));
    const cover = rkEl('div', 'rank-card-cover');
    const img = rkEl('img'); img.alt = it.title || ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.src = rkSafeUrl(it.cover); img.onerror = () => img.classList.add('is-broken');
    cover.append(img, rkEl('span', 'rank-badge', String(it.rank)));
    const artistEl = rkEl('div', 'playlist-owner rank-card-artist');
    if (it.explicit) artistEl.appendChild(rkExplicitBadge());
    artistEl.appendChild(document.createTextNode(it.artist || '-'));
    const title = rkEl('div', 'playlist-title', it.title); title.title = it.title || '';
    const meta = rkEl('div', 'rank-card-meta');
    const votes = rkEl('div', 'rank-votes'); votes.append(rkEl('strong', '', String(it.votes)), rkEl('span', '', 'โหวต'));
    meta.append(votes, rkEl('div', 'rank-duration', it.duration || rkFmt(it.durationMs)));
    const btn = rkEl('button', 'rank-vote-btn', it.voted ? '✓ โหวตแล้ว' : (closed ? '🔒 ปิดโหวต' : '👍 โหวต'));
    btn.type = 'button'; btn.disabled = !!it.voted || closed;
    btn.onclick = (e) => {
      e.stopPropagation();
      rankingSubmit({ trackId: it.trackId, title: it.title, artist: it.artist, durationMs: it.durationMs, cover: it.cover, explicit: !!it.explicit });
    };
    card.append(cover, title, artistEl, meta, btn);
    // เพลงที่ผู้ดูแลเพิ่มเอง (manual_) ไม่มีใน Spotify จึงกดเล่นไม่ได้
    if (!String(it.trackId).startsWith('manual_')) card.onclick = () => playTrack(`spotify:track:${it.trackId}`);
    else card.style.cursor = 'default';
    box.appendChild(card);
  });
}

async function loadRanking(silent) {
  const box = document.getElementById('ranking-list'); if (!box) return;
  if (!RANKING_API) { rankingNotice(box, 'ยังไม่ได้ตั้งค่า Ranking API — ใส่ URL ของ Apps Script ที่ตัวแปร RANKING_API ใน main.js'); return; }
  if (!rankingTopic) { rankingNotice(box, rankingTopics.length ? 'เลือกหัวข้อด้านบนเพื่อดูอันดับ' : 'ยังไม่มีหัวข้อจัดอันดับ — รอผู้ดูแลสร้างหัวข้อ'); return; }
  const topicId = rankingTopic.topicId;
  if (!silent && !box.children.length) rankingNotice(box, 'กำลังโหลด...');
  try {
    const data = await rankingApi(null, { action: 'list', topic: topicId });
    if (!data.ok) throw new Error(data.error || 'error');
    if (rankingTopic?.topicId !== topicId) return; // ผู้ใช้สลับหัวข้อระหว่างรอ — ทิ้งผลเก่า
    if (data.topic && data.topic.status !== rankingTopic.status) { rankingTopic = data.topic; renderTopicBar(); }
    renderRanking(data.items);
  } catch (e) {
    console.error('Ranking load error:', e);
    if (e.message === 'topic_not_found') { rankingTopic = null; await loadRankingTopics(); if (rankingTopic) return loadRanking(true); rankingNotice(box, 'ยังไม่มีหัวข้อจัดอันดับ — รอผู้ดูแลสร้างหัวข้อ'); return; }
    if (!box.querySelector('.rank-item')) rankingNotice(box, 'โหลดอันดับไม่สำเร็จ ลองกดรีเฟรช');
  }
}

// ---------- หัวข้อจัดอันดับ ----------
const rankingTopicClosed = () => rankingTopic?.status === 'closed';

async function loadRankingTopics() {
  if (!RANKING_API) return;
  try {
    const data = await rankingApi(null, { action: 'topics' });
    if (!data.ok) throw new Error(data.error || 'error');
    rankingTopics = data.topics || [];
    const saved = localStorage.getItem(RANKING_TOPIC_KEY);
    const byId = id => rankingTopics.find(t => t.topicId === id);
    // ลำดับเลือก: หัวข้อที่ดูอยู่ > หัวข้อที่เคยเลือกไว้ > หัวข้อแรกที่เปิดโหวต > หัวข้อแรก
    rankingTopic = byId(rankingTopic?.topicId) || byId(saved) || rankingTopics.find(t => t.status === 'open') || rankingTopics[0] || null;
    renderTopicBar();
  } catch (e) { console.error('Ranking topics error:', e); }
}

function ensureTopicBar() {
  let bar = document.getElementById('ranking-topics'); if (bar) return bar;
  const view = document.getElementById('view-ranking'); if (!view) return null;
  bar = rkEl('div', 'rank-topics'); bar.id = 'ranking-topics';
  const info = rkEl('div', 'rank-topic-info'), cov = rkEl('img', 'rank-topic-cover'); cov.alt = ''; cov.referrerPolicy = 'no-referrer'; cov.onerror = () => cov.classList.add('hidden');
  info.append(cov, rkEl('div', 'rank-topic-desc'));
  bar.append(rkEl('div', 'rank-topic-chips'), info);
  const head = view.querySelector('.rank-header');
  if (head) head.insertAdjacentElement('afterend', bar); else view.prepend(bar);
  return bar;
}

function renderTopicBar() {
  const bar = ensureTopicBar(); if (!bar) return;
  const chips = bar.querySelector('.rank-topic-chips'), desc = bar.querySelector('.rank-topic-desc'), cov = bar.querySelector('.rank-topic-cover'), info = bar.querySelector('.rank-topic-info');
  chips.innerHTML = '';
  rankingTopics.forEach(t => {
    const active = t.topicId === rankingTopic?.topicId;
    const b = rkEl('button', 'rank-topic-chip' + (active ? ' active' : '') + (t.status === 'closed' ? ' closed' : ''), (t.status === 'closed' ? '🔒 ' : '') + t.title);
    b.type = 'button'; b.onclick = () => selectRankingTopic(t.topicId);
    chips.appendChild(b);
  });
  const note = rankingTopicClosed() ? 'หัวข้อนี้ปิดโหวตแล้ว' : '';
  desc.textContent = !rankingTopics.length ? 'ยังไม่มีหัวข้อจัดอันดับ — รอผู้ดูแลสร้างหัวข้อ'
    : [rankingTopic?.description, note].filter(Boolean).join(' · ');
  desc.classList.toggle('hidden', !desc.textContent);
  const listTitle = document.getElementById('ranking-list-title'); if (listTitle) listTitle.textContent = rankingTopic ? `อันดับ: ${rankingTopic.title}` : 'อันดับปัจจุบัน';
  const covUrl = rkSafeUrl(rankingTopic?.cover);
  cov.classList.remove('hidden'); if (covUrl) cov.src = covUrl; else cov.removeAttribute('src');
  cov.classList.toggle('hidden', !covUrl);
  info.classList.toggle('hidden', !covUrl && !desc.textContent);
  // ค้นหา/ส่งเพลงได้เฉพาะหัวข้อที่เปิดโหวต
  const canSubmit = !!rankingTopic && !rankingTopicClosed();
  document.querySelector('#view-ranking .rank-search')?.classList.toggle('hidden', !canSubmit);
  if (!canSubmit) renderRankingSearch(null);
}

function selectRankingTopic(id) {
  const t = rankingTopics.find(x => x.topicId === id);
  if (!t || t.topicId === rankingTopic?.topicId) return;
  rankingTopic = t;
  try { localStorage.setItem(RANKING_TOPIC_KEY, id); } catch (e) {}
  const input = document.getElementById('ranking-search-input'); if (input) input.value = '';
  renderRankingSearch(null);
  renderTopicBar();
  const box = document.getElementById('ranking-list'); if (box) box.innerHTML = '';
  loadRanking(false);
}

async function refreshRankingView(silent) {
  await loadRankingTopics();
  await loadRanking(silent);
}

async function rankingSubmit(song) {
  if (rankingBusy) return false;
  if (!rankingTopic) { showToast('⚠️ กรุณาเลือกหัวข้อก่อน', 'warning'); return false; }
  if (rankingTopicClosed()) { showToast('⚠️ หัวข้อนี้ปิดโหวตแล้ว', 'warning'); return false; }
  const token = localStorage.getItem('spotify_access_token');
  if (!token) { showToast('❌ กรุณาเข้าสู่ระบบใหม่', 'error'); return false; }
  rankingBusy = true;
  document.getElementById('view-ranking')?.classList.add('is-busy');
  try {
    const data = await rankingApi({ action: 'submit', token, topicId: rankingTopic.topicId, ...song });
    if (!data.ok) { showToast('❌ ' + (RK_ERRORS[data.error] || 'ส่งเพลงไม่สำเร็จ'), 'error'); return false; }
    if (data.already) showToast('ℹ️ คุณโหวตเพลงนี้ไปแล้ว', 'warning');
    else if (data.created) showToast('🎉 ส่งเพลงเข้าหัวข้อแล้ว!', 'info');
    else showToast(`✅ นับโหวตแล้ว (ตอนนี้ ${data.votes} โหวต)`, 'info');
    await loadRanking(true);
    return true;
  } catch (e) {
    console.error('Ranking submit error:', e);
    showToast('❌ เชื่อมต่อระบบจัดอันดับไม่ได้', 'error');
    return false;
  } finally {
    rankingBusy = false;
    document.getElementById('view-ranking')?.classList.remove('is-busy');
  }
}

function renderRankingSearch(results) {
  const box = document.getElementById('ranking-search-results'); if (!box) return;
  box.innerHTML = '';
  if (!results) return;
  const tracks = results.tracks?.items || [];
  if (!tracks.length) { box.appendChild(rkEl('div', 'rank-empty', 'ไม่พบเพลงที่ค้นหา')); return; }
  tracks.forEach(track => {
    const row = rkEl('div', 'track-item');
    const img = rkEl('img'); img.alt = ''; img.src = track.album?.images?.[track.album.images.length > 1 ? 1 : 0]?.url || '';
    const info = rkEl('div', 'track-item-info');
    const trkArtist = rkEl('div', 'track-item-artist'); if (track.explicit) trkArtist.appendChild(rkExplicitBadge()); trkArtist.appendChild(document.createTextNode(track.artists.map(a => a.name).join(', ')));
    info.append(rkEl('div', 'track-item-title', track.name), trkArtist);
    const btn = rkEl('button', 'rank-add-btn', '＋ ส่งเข้าอันดับ'); btn.type = 'button';
    btn.onclick = (e) => { e.stopPropagation(); openRankingModal(track); };
    row.append(img, info, rkEl('div', 'rank-duration', rkFmt(track.duration_ms)), btn);
    row.onclick = () => playTrack(track.uri);
    box.appendChild(row);
  });
}

function openRankingModal(track) {
  if (!rankingTopic || rankingTopicClosed()) { showToast('⚠️ หัวข้อนี้ปิดโหวตแล้ว', 'warning'); return; }
  const imgs = track.album?.images || [];
  rankingPick = {
    trackId: track.id,
    title: track.name,
    artist: track.artists.map(a => a.name).join(', '),
    durationMs: track.duration_ms,
    cover: imgs[1]?.url || imgs[0]?.url || '',
    explicit: !!track.explicit
  };
  document.getElementById('rk-cover-preview').src = rankingPick.cover;
  document.getElementById('rk-title').textContent = rankingPick.title;
  const rkArtist = document.getElementById('rk-artist'); rkArtist.textContent = '';
  if (rankingPick.explicit) rkArtist.appendChild(rkExplicitBadge());
  rkArtist.appendChild(document.createTextNode(rankingPick.artist));
  const rkHead = document.getElementById('rk-modal-heading'); if (rkHead) rkHead.textContent = `ส่งเพลงเข้าหัวข้อ: ${rankingTopic.title}`;
  document.getElementById('rk-duration').textContent = `ระยะเวลา ${rkFmt(rankingPick.durationMs)}`;
  overlayOpen('rank');
}
function closeRankingModal() { overlayClose('rank'); rankingPick = null; }

function setupRanking() {
  const input = document.getElementById('ranking-search-input');
  let timer;
  input?.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { renderRankingSearch(null); return; }
    timer = setTimeout(async () => {
      try {
        const r = await fetchWebApi(`v1/search?q=${encodeURIComponent(q)}&type=track&limit=8`);
        if (input.value.trim() === q) renderRankingSearch(r); // กันผลค้นหาเก่าทับผลใหม่
      } catch (e) { console.error('Ranking search error:', e); showToast('❌ ค้นหาเพลงไม่สำเร็จ', 'error'); }
    }, 400);
  });
  document.getElementById('btn-ranking-refresh')?.addEventListener('click', () => refreshRankingView(false));

  const modal = document.getElementById('ranking-modal');
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeRankingModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRankingModal(); });
  document.getElementById('rk-cancel')?.addEventListener('click', closeRankingModal);

  const submitBtn = document.getElementById('rk-submit');
  submitBtn?.addEventListener('click', async () => {
    if (!rankingPick || rankingBusy) return;
    submitBtn.disabled = true; const old = submitBtn.textContent; submitBtn.textContent = 'กำลังส่ง...';
    const ok = await rankingSubmit(rankingPick);
    submitBtn.disabled = false; submitBtn.textContent = old;
    if (ok) { closeRankingModal(); if (input) input.value = ''; renderRankingSearch(null); }
  });
}
// เข้าหน้า Ranking = โหลดทันที + รีเฟรชอัตโนมัติทุก 30 วินาที / ออกจากหน้า = หยุด
function startRankingView() {
  refreshRankingView(false);
  clearInterval(rankingTimer);
  rankingTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshRankingView(true); }, RANKING_REFRESH_MS);
}
function stopRankingView() { clearInterval(rankingTimer); rankingTimer = null; }

// ============================================================
// MAIN APP
// ============================================================
let accessToken = null, currentTrackData = null, currentContextTrack = null, currentUser = null;

async function init() {
  // ผูกปุ่ม/เมนูทั้งหมดก่อนเสมอ — ถ้าโหลดข้อมูลพลาดหรือเป็นบัญชี Free หน้าเว็บจะยังกดใช้/ออกจากระบบได้
  setupEventListeners();
  setupContextMenu();
  try {
    accessToken = await handleRedirect();
    if (!accessToken) { showScreen('login-screen'); return; }
    showScreen('app-screen');
    navInit();

    let profile;
    try { profile = await getUserProfile(); }
    catch (e) {
      console.error('Profile error:', e);
      renderUserProfile({ display_name: 'บัญชีของฉัน' }); // ให้มีเมนูสลับบัญชี/ออกจากระบบเสมอ
      showAccessError(e);
      return;
    }
    if (profile) { currentUser = profile; renderUserProfile(profile); }
    // Spotify อาจไม่ส่ง `product` มาใน Dev Mode (Feb 2026) จึงถือว่าเป็น Free ก็ต่อเมื่อมีค่าและไม่ใช่ premium
    // ถ้าไม่มีค่า จะลองเริ่ม Player ก่อน แล้วให้ account_error ของ SDK เป็นตัวบอกว่าไม่ใช่ Premium
    const isFree = !!profile?.product && profile.product !== 'premium';

    getRecentlyPlayed().then(d => { if (d) { renderHistory(d, playTrack); renderHeroBanner(d, playTrack); } }).catch(e => console.error('History error:', e));
    loadDailyChart();

    if (isFree) { showPremiumRequiredModal(); return; }
    document.getElementById('player-screen').classList.remove('hidden');
    initSpotifyPlayer(accessToken, handlePlayerStateChange, () => { console.log('Player is ready!'); });
  } catch (e) {
    console.error('Init error:', e);
    showAccessError(e);
  }
}

function setupEventListeners() {
  setupSeekBars();
  setupWakeLock();
  setupRanking();
  document.getElementById('login-button').addEventListener('click', loginWithSpotify);
  document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); const v = `view-${e.currentTarget.dataset.target}`; navGo(v); showView(v); }));
  let searchTimeout;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value;
    if (query.length > 2) searchTimeout = setTimeout(async () => { const results = await searchSpotify(query); renderSearchResults(results, playTrack, handleArtistClick, handleAlbumClick); }, 500);
    else renderSearchResults(null, null, null, null);
  });
  document.getElementById('btn-play-pause').addEventListener('click', togglePlay);
  document.getElementById('btn-next').addEventListener('click', nextTrack);
  document.getElementById('btn-prev').addEventListener('click', previousTrack);
  document.getElementById('btn-lyrics-toggle').addEventListener('click', async () => {
    toggleLyricsModal();
    if (window._spotifyPlayer || remote.id) { const state = remote.id ? window._lastState : await window._spotifyPlayer.getCurrentState(); if (state) { const lyricsContainer = document.getElementById('lyrics-container'); const containerEmpty = !lyricsContainer || lyricsContainer.children.length === 0; const track = state.track_window?.current_track; if (track && containerEmpty) { currentTrackData = null; setupLyricsComponent(track); } updateLyricsComponent(state.position, state.duration, state.paused); } }
  });
  document.getElementById('btn-close-lyrics').addEventListener('click', () => toggleLyricsModal());
  setupTvShare();
  setupLyricsMoreMenu();
  document.getElementById('btn-lyrics-play-pause')?.addEventListener('click', togglePlay);
  document.getElementById('btn-lyrics-next')?.addEventListener('click', nextTrack);
  document.getElementById('btn-lyrics-prev')?.addEventListener('click', previousTrack);
}

async function handleArtistClick(artistId) {
  try {
    NAV.artistId = artistId; navGo('view-artist', artistId);
    showView('view-artist');
    document.getElementById('artist-header').innerHTML = 'กำลังโหลด...';
    document.getElementById('artist-top-tracks').innerHTML = '';
    document.getElementById('artist-albums').innerHTML = '';

    const artist = await getArtist(artistId);

    // Fetch these independently so if one fails, it doesn't break the whole page
    const [topTracks, albums, isFollowing] = await Promise.all([
      getArtistTopTracks(artistId, artist.name).catch(e => { console.error('Top tracks error:', e.message); return { tracks: [] }; }),
      getArtistAlbums(artistId).catch(e => { console.error('Albums error:', e.message); return { items: [] }; }),
      checkFollowsArtist(artistId).catch(e => { console.error('Follow status error:', e.message); return false; })
    ]);

    let isFollowingState = isFollowing;
    const toggleFollow = async () => {
      try {
        if (isFollowingState) { await unfollowArtist(artistId); isFollowingState = false; showToast('เลิกติดตามแล้ว', 'info'); }
        else { await followArtist(artistId); isFollowingState = true; showToast('✅ ติดตามแล้ว', 'info'); }
        renderArtistView(artist, topTracks, albums, playTrack, handleAlbumClick, isFollowingState, toggleFollow);
      } catch (e) {
        console.error('Toggle follow error:', e.message);
        if (e.status === 403 && confirm('Spotify ไม่อนุญาตให้ติดตามศิลปินด้วยสิทธิ์ปัจจุบัน\n\nต้องเข้าสู่ระบบใหม่เพื่ออนุญาตสิทธิ์เพิ่ม ต้องการเข้าสู่ระบบใหม่ตอนนี้ไหม?')) { switchAccount(); return; }
        showToast('❌ ไม่สามารถอัปเดตสถานะติดตามได้', 'error');
      }
    };

    renderArtistView(artist, topTracks, albums, playTrack, handleAlbumClick, isFollowingState, toggleFollow);
  } catch (err) {
    console.error('Error fetching artist:', err);
    showToast('❌ ไม่สามารถโหลดข้อมูลศิลปินหลักได้', 'error');
    document.getElementById('artist-header').innerHTML = '<div style="color:red">เกิดข้อผิดพลาดในการโหลดข้อมูลศิลปิน</div>';
  }
}

async function handleAlbumClick(albumId) {
  try {
    NAV.albumId = albumId; navGo('view-album', albumId);
    showView('view-album');
    document.getElementById('album-header').innerHTML = 'กำลังโหลด...';
    document.getElementById('album-tracks').innerHTML = '';

    const album = await getAlbum(albumId);
    const tracksData = await getAlbumTracks(albumId).catch(e => { console.error('Album tracks error:', e.message); return { items: [] }; });

    renderAlbumView(album, tracksData, playTrack);
  } catch (err) {
    console.error('Error fetching album:', err);
    showToast('❌ ไม่สามารถโหลดข้อมูลอัลบั้มได้', 'error');
    document.getElementById('album-header').innerHTML = '<div style="color:red">เกิดข้อผิดพลาดในการโหลดข้อมูลอัลบั้ม</div>';
  }
}

function setupContextMenu() {
  const menu = document.getElementById('context-menu');
  document.addEventListener('click', (e) => { if (!e.target.closest('#context-menu')) menu.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.classList.add('hidden'); });
  window.showTrackContextMenu = (e, track) => { currentContextTrack = track; menu.style.left = `${e.pageX}px`; menu.style.top = `${e.pageY}px`; menu.classList.remove('hidden'); };
  document.getElementById('menu-play-next').addEventListener('click', async () => {
    if (currentContextTrack) { try { await fetchWebApi(`v1/me/player/queue?uri=${currentContextTrack.uri}`, 'POST'); showToast('✅ เพิ่มลงในคิวแล้ว', 'info'); } catch (e) { showToast('❌ ไม่สามารถเพิ่มลงคิวได้', 'error'); } }
    menu.classList.add('hidden');
  });
  document.getElementById('menu-add-playlist').addEventListener('click', async () => {
    if (currentContextTrack) {
      overlayOpen('playlist');
      const listContainer = document.getElementById('playlist-list'); listContainer.innerHTML = 'กำลังโหลด...';
      try {
        const user = await getUserProfile();
        const playlists = await fetchWebApi('v1/me/playlists?limit=50');
        const myPlaylists = playlists.items.filter(p => p.owner.id === user.id);
        listContainer.innerHTML = '';
        if (myPlaylists.length === 0) { listContainer.innerHTML = 'ไม่พบเพลย์ลิสต์ของคุณ'; }
        else { myPlaylists.forEach(p => { const item = document.createElement('div'); item.className = 'playlist-list-item'; item.textContent = p.name; item.onclick = async () => { try { await fetchWebApi(`v1/playlists/${p.id}/tracks?uris=${currentContextTrack.uri}`, 'POST'); showToast(`✅ เพิ่มเพลงลงใน ${p.name} แล้ว`, 'info'); overlayClose('playlist'); } catch (err) { showToast('❌ ไม่สามารถเพิ่มเพลงได้', 'error'); } }; listContainer.appendChild(item); }); }
      } catch (e) { listContainer.innerHTML = 'เกิดข้อผิดพลาดในการโหลดเพลย์ลิสต์'; }
    }
    menu.classList.add('hidden');
  });
}

// ============================================================
// แชร์ไปหน้าจอ TV (Beta)
// เว็บนี้เป็นผู้ส่ง: สร้างรหัส 6 หลัก แล้วส่งสถานะเพลง (เพลง, ตำแหน่ง, เล่น/หยุด, สีพื้นหลัง) ไปที่ Apps Script
// หน้า tv.html บนทีวีดึงสถานะไปแสดงเนื้อเพลง + สีพื้นหลังเหมือนหน้าเนื้อเพลงของเครื่องนี้
// ============================================================
const TV_SESSION_KEY = 'rm_tv_session';
const tvS = { session: null, last: null, info: new Map(), palette: null, seq: 0, rtt: 400, sent: null, timer: null, beat: null, sending: false };
try { tvS.session = JSON.parse(localStorage.getItem(TV_SESSION_KEY) || 'null'); } catch (e) { }

// ลิงก์สั้น /tv (ต้องตั้ง Rewrite /tv -> /tv.html บน Render) ใส่ ?code= เพื่อให้ทีวีเชื่อมต่ออัตโนมัติ
const tvUrl = () => `${location.origin}/tv?code=${tvS.session.code}`;

function tvRender() {
  const on = !!tvS.session;
  document.querySelectorAll('#btn-tv-share, #btn-tv-share-lyrics').forEach(b => b.classList.toggle('tv-active', on));
  const code = document.getElementById('tv-share-code'); if (!code) return;
  code.textContent = on ? tvS.session.code.replace(/(\d{3})(\d{3})/, '$1 $2') : '------';
  document.getElementById('tv-share-url').textContent = on ? tvUrl() : '';
  code.classList.toggle('hidden', !on);
  document.getElementById('tv-share-start')?.classList.toggle('hidden', on);
  document.getElementById('tv-share-stop').classList.toggle('hidden', !on);
  document.getElementById('tv-share-copy').classList.toggle('hidden', !on);
}

function tvClearLocal() {
  tvS.session = null; tvS.sent = null; clearTimeout(tvS.timer); clearInterval(tvS.beat); tvHelloStop(); tvHello = null;
  localStorage.removeItem(TV_SESSION_KEY); tvRender();
}

async function tvStart() {
  const status = document.getElementById('tv-share-status');
  const token = localStorage.getItem('spotify_access_token');
  if (!token) { status.textContent = 'กรุณาเข้าสู่ระบบใหม่'; return; }
  status.textContent = 'กำลังสร้างรหัส...';
  try {
    const r = await rankingApi({ action: 'tv_create', token });
    if (!r.ok) throw new Error(r.error || 'error');
    tvS.session = { code: r.code, key: r.key };
    localStorage.setItem(TV_SESSION_KEY, JSON.stringify(tvS.session));
    status.textContent = 'พร้อมแล้ว — กรอกรหัสนี้บนหน้าจอ TV';
    tvRender(); tvBeat();
    const cur = remote.id ? window._lastState : await window._spotifyPlayer?.getCurrentState?.();
    if (cur) tvOnPlayerState(cur, true);
  } catch (e) {
    console.error('TV create error:', e);
    status.textContent = 'สร้างรหัสไม่สำเร็จ (ตรวจว่าตั้งค่า RANKING_API และ Deploy Code.gs ใหม่แล้ว)';
  }
}

async function tvStop() {
  const sess = tvS.session; tvClearLocal();
  document.getElementById('tv-share-status').textContent = 'หยุดแชร์แล้ว';
  if (sess) { try { await rankingApi({ action: 'tv_stop', code: sess.code, key: sess.key }); } catch (e) { } }
}

function tvBeat() {
  clearInterval(tvS.beat);
  // ส่งซ้ำทุก 15 วินาทีตอนกำลังเล่น เพื่อให้ทีวีปรับเวลาไม่ให้คลาดเคลื่อนสะสม
  tvS.beat = setInterval(() => { if (tvS.session && tvS.last && !tvS.last.paused) tvPushNow(); }, 15000);
}
function tvSchedulePush(ms = 300) { clearTimeout(tvS.timer); tvS.timer = setTimeout(tvPushNow, ms); }

// เรียกทุกครั้งที่ Spotify แจ้งสถานะเปลี่ยน: ส่งเมื่อ เปลี่ยนเพลง / เล่น-หยุด / กรอเวลา เท่านั้น
function tvOnPlayerState(state, force) {
  if (!tvS.session) return;
  const track = state?.track_window?.current_track; if (!track) return;
  tvS.last = { track, position: state.position, duration: state.duration, paused: state.paused, at: performance.now() };
  const sent = tvS.sent;
  let need = force || !sent || sent.trackId !== track.id || sent.paused !== state.paused;
  if (!need) {
    const expected = sent.paused ? sent.position : sent.position + (performance.now() - sent.at);
    if (Math.abs(expected - state.position) > 1500) need = true;
  }
  if (need) tvSchedulePush(300);
}

async function tvPushNow() {
  const sess = tvS.session, L = tvS.last; if (!sess || !L) return;
  if (tvS.sending) { tvSchedulePush(500); return; }
  tvS.sending = true;
  try {
    const t = L.track;
    let info = tvS.info.get(t.id);
    if (!info) {
      info = { id: t.id, name: t.name, artists: t.artists.map(a => a.name), album: t.album?.name || '', cover: t.album?.images?.[0]?.url || '', durationMs: t.duration_ms || L.duration, explicit: false, isrc: '' };
      // ISRC ช่วยให้ทีวีจับคู่เนื้อเพลงได้ตรงเวอร์ชัน รอสูงสุด 1.5 วินาที
      try {
        const full = await Promise.race([fetchWebApi(`v1/tracks/${t.id}`), new Promise((_, rej) => setTimeout(rej, 1500))]);
        info.explicit = !!full?.explicit; info.isrc = full?.external_ids?.isrc || '';
      } catch (e) { }
      tvS.info.set(t.id, info);
    }
    const pos = L.paused ? L.position : Math.min(L.duration || Infinity, L.position + (performance.now() - L.at));
    const t0 = performance.now();
    const r = await rankingApi({ action: 'tv_push', code: sess.code, key: sess.key, seq: ++tvS.seq, track: info, position: Math.round(pos), paused: L.paused, lagMs: Math.round(tvS.rtt / 2), palette: tvS.palette });
    tvS.rtt = tvS.rtt * .6 + (performance.now() - t0) * .4;
    if (!r.ok) { if (r.error === 'tv_not_found') { tvClearLocal(); showToast('⚠️ หยุดแชร์ TV แล้ว (รหัสหมดอายุ)', 'warning'); } return; }
    if (r.helloPending && !tvHelloTimer) { tvHelloPoll(); if (!tvHelloNotified && !sess.peer) { tvHelloNotified = true; showToast('📺 หน้า /tv ขอเล่นเสียงบนทีวี — เปิดปุ่ม TV เพื่ออนุญาต', 'info'); } }
    tvS.sent = { trackId: t.id, position: pos, paused: L.paused, at: t0 };
  } catch (e) { console.error('TV push error:', e); }
  finally { tvS.sending = false; }
}

// ---------- เลือกอุปกรณ์เล่นเสียง (ทีวี ฯลฯ) ----------
const DEVICE_ICONS = { TV: '📺', CastVideo: '📺', CastAudio: '🔊', Speaker: '🔊', AVR: '🔊', STB: '📺', AudioDongle: '🔊', Computer: '💻', Smartphone: '📱', Tablet: '📱', GameConsole: '🎮', Automobile: '🚗' };
const DEVICE_LABELS = { TV: 'ทีวี', CastVideo: 'Chromecast / Google TV', CastAudio: 'Chromecast Audio', Speaker: 'ลำโพง', AVR: 'ชุดรับสัญญาณเสียง', STB: 'กล่องรับสัญญาณ', AudioDongle: 'อุปกรณ์เสียง', Computer: 'คอมพิวเตอร์', Smartphone: 'โทรศัพท์', Tablet: 'แท็บเล็ต', GameConsole: 'เครื่องเกม', Automobile: 'รถยนต์' };
let devicesCache = [];

function remoteUiRefresh() {
  const label = document.getElementById('tv-now-playing-on');
  if (label) label.textContent = remote.id ? `กำลังเล่นเสียงบน: ${remote.name}` : 'กำลังเล่นเสียงบน: เครื่องนี้';
  renderDevices();
}

function renderDevices() {
  const box = document.getElementById('tv-devices'); if (!box) return;
  const activeId = remote.id || deviceId;
  box.innerHTML = '';
  devicesCache.forEach(d => {
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = 'tv-device' + (d.id === activeId ? ' active' : '');
    const icon = document.createElement('span'); icon.className = 'tv-device-icon'; icon.textContent = DEVICE_ICONS[d.type] || '🎵';
    const info = document.createElement('span'); info.className = 'tv-device-info';
    const name = document.createElement('span'); name.className = 'tv-device-name'; name.textContent = d.id === deviceId ? `${d.name} (เครื่องนี้)` : d.name;
    const type = document.createElement('span'); type.className = 'tv-device-type'; type.textContent = d.id === activeId ? '🔊 กำลังเล่นเสียงที่นี่' : (DEVICE_LABELS[d.type] || d.type);
    info.append(name, type); btn.append(icon, info);
    btn.onclick = () => { if (d.id !== activeId) transferToDevice(d).then(() => setTimeout(loadDevices, 1500)); };
    box.appendChild(btn);
  });
}

async function loadDevices() {
  const box = document.getElementById('tv-devices'), hint = document.getElementById('tv-devices-hint'); if (!box) return;
  box.textContent = 'กำลังค้นหาอุปกรณ์...'; hint.textContent = '';
  try {
    const data = await fetchWebApi('v1/me/player/devices');
    const rank = d => d.id === deviceId ? 3 : /TV|Cast|STB/i.test(d.type) ? 0 : 1;
    devicesCache = (data?.devices || []).filter(d => d.id && !d.is_restricted).sort((a, b) => rank(a) - rank(b));
    if (!devicesCache.length) { box.textContent = 'ไม่พบอุปกรณ์'; }
    else renderDevices();
    const hasOther = devicesCache.some(d => d.id !== deviceId);
    hint.textContent = hasOther ? 'แตะอุปกรณ์เพื่อสลับเสียงไปเล่นที่นั่น (ใช้ Spotify Connect ต้องใช้ Premium)' : 'ยังไม่พบทีวี: เปิดแอป Spotify บนทีวี (หรือกด Cast จากแอป Spotify) โดยใช้บัญชีเดียวกันและเครือข่าย Wi-Fi เดียวกัน แล้วกดค้นหาอีกครั้ง';
  } catch (e) {
    console.error('Devices error:', e);
    box.textContent = 'ค้นหาอุปกรณ์ไม่สำเร็จ';
    hint.textContent = e.status === 403 ? 'ต้องเข้าสู่ระบบใหม่เพื่ออนุญาตสิทธิ์ควบคุมการเล่น (ออกจากระบบแล้วเข้าใหม่)' : 'ลองกดค้นหาอีกครั้ง';
  }
  remoteUiRefresh();
}

// ---------- เสียงออกบนหน้า /tv ----------
// หน้า /tv ขออนุญาต -> ผู้ใช้เทียบรหัสยืนยัน 4 หลักแล้วกดอนุญาต -> เข้ารหัสโทเค็นส่งให้ TV (ECDH P-256 + AES-GCM,
// เซิร์ฟเวอร์เห็นแค่ข้อมูลเข้ารหัส) -> TV เปิดตัวเล่นชื่อ "R Music TV <รหัส>" -> สลับเสียงไปที่นั่น เครื่องนี้จะเงียบ
const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
let tvHello = null, tvHelloTimer = null, tvHelloNotified = false, tvSwitching = false;

async function tvSas(pubB64) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b64d(pubB64)));
  return String((((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) % 10000).padStart(4, '0');
}
function setTvAudioState(text) { const el = document.getElementById('tv-audio-state'); if (el) el.textContent = text || ''; }

async function tvGrant(peerPubB64) {
  const token = localStorage.getItem('spotify_access_token'), sess = tvS.session;
  if (!token || !sess) return false;
  const peer = await crypto.subtle.importKey('raw', b64d(peerPubB64), ECDH_PARAMS, false, []);
  const eph = await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify({ token })));
  const epub = b64e(await crypto.subtle.exportKey('raw', eph.publicKey));
  const r = await rankingApi({ action: 'tv_grant', code: sess.code, key: sess.key, epub, iv: b64e(iv), ct: b64e(ct) });
  return !!r.ok;
}

async function tvHelloPoll() {
  const sess = tvS.session; if (!sess) return;
  try {
    const r = await rankingApi({ action: 'tv_hello_get', code: sess.code, key: sess.key });
    if (!r.ok) { if (r.error === 'tv_not_found') tvClearLocal(); return; }
    tvHello = r.hello || null;
    // TV เครื่องเดิมที่เคยอนุญาตในรหัสนี้แล้ว (กุญแจตรงกัน) ไม่ต้องถามซ้ำ
    if (tvHello && tvHello.pub === sess.peer && !tvSwitching) { tvHello = null; await tvGrant(sess.peer); tvSwitchToTvDevice(); }
    renderAudioRequest();
  } catch (e) { console.error('TV hello error:', e); }
}

async function renderAudioRequest() {
  const box = document.getElementById('tv-audio-request'); if (!box) return;
  if (!tvHello) { box.classList.add('hidden'); return; }
  document.getElementById('tv-audio-sas').textContent = await tvSas(tvHello.pub);
  box.classList.remove('hidden');
}

async function tvAllow() {
  const h = tvHello, sess = tvS.session; if (!h || !sess) return;
  setTvAudioState('กำลังส่งสิทธิ์ให้ TV...');
  try {
    if (!(await tvGrant(h.pub))) throw new Error('grant failed');
    sess.peer = h.pub; localStorage.setItem(TV_SESSION_KEY, JSON.stringify(sess));
    tvHello = null; renderAudioRequest();
    tvSwitchToTvDevice();
  } catch (e) { console.error(e); setTvAudioState('ส่งสิทธิ์ไม่สำเร็จ ลองอีกครั้ง'); }
}
async function tvDeny() {
  const sess = tvS.session; if (!sess) return;
  try { await rankingApi({ action: 'tv_deny', code: sess.code, key: sess.key }); } catch (e) { }
  tvHello = null; renderAudioRequest(); setTvAudioState('ไม่อนุญาตแล้ว');
}

// รอตัวเล่นบน TV โผล่ในรายการอุปกรณ์ของ Spotify แล้วสลับเสียงไปที่นั่นอัตโนมัติ (เสียงเครื่องนี้จะดับ)
async function tvSwitchToTvDevice() {
  if (tvSwitching || !tvS.session) return;
  tvSwitching = true;
  const name = `R Music TV ${tvS.session.code}`;
  setTvAudioState('รอ TV เปิดตัวเล่นเสียง...');
  try {
    for (let i = 0; i < 40 && tvS.session; i++) {
      try {
        const data = await fetchWebApi('v1/me/player/devices');
        const dev = data?.devices?.find(d => d.name === name && d.id);
        if (dev) { await transferToDevice(dev); setTvAudioState('🔊 เสียงออกที่ทีวีแล้ว (เสียงบนเครื่องนี้ดับ)'); loadDevices(); return; }
      } catch (e) { }
      await new Promise(r => setTimeout(r, 1500));
    }
    setTvAudioState('ไม่พบตัวเล่นเสียงบน TV — ตรวจว่าเบราว์เซอร์ทีวีเล่นเสียง Spotify ได้ หรือเลือกอุปกรณ์จากรายการด้านบน');
  } finally { tvSwitching = false; }
}

function tvHelloStart() { clearInterval(tvHelloTimer); if (!tvS.session) return; tvHelloPoll(); tvHelloTimer = setInterval(tvHelloPoll, 2500); }
function tvHelloStop() { clearInterval(tvHelloTimer); tvHelloTimer = null; }

function setupTvShare() {
  const modal = document.getElementById('tv-modal'); if (!modal) return;
  const open = () => { document.getElementById('tv-share-status').textContent = ''; overlayOpen('tv'); tvRender(); loadDevices(); tvHelloStart(); };
  document.getElementById('btn-tv-share')?.addEventListener('click', open);
  document.getElementById('btn-tv-share-lyrics')?.addEventListener('click', open);
  document.getElementById('tv-share-close')?.addEventListener('click', () => overlayClose('tv'));
  modal.addEventListener('click', e => { if (e.target === modal) overlayClose('tv'); });
  document.getElementById('tv-share-start')?.addEventListener('click', async () => { await tvStart(); tvHelloStart(); });
  document.getElementById('tv-audio-allow')?.addEventListener('click', tvAllow);
  document.getElementById('tv-audio-deny')?.addEventListener('click', tvDeny);
  document.getElementById('tv-devices-refresh')?.addEventListener('click', loadDevices);
  document.getElementById('tv-share-stop')?.addEventListener('click', tvStop);
  document.getElementById('tv-share-copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(tvUrl()); showToast('✅ คัดลอกลิงก์แล้ว', 'info'); } catch (e) { showToast('คัดลอกไม่ได้ กรุณาคัดลอกจากข้อความในหน้าต่าง', 'warning'); }
  });
  tvRender();
  if (tvS.session) { tvBeat(); if (tvS.session.peer) tvGrant(tvS.session.peer).catch(() => { }); } // รีโหลดหน้าแล้วยังแชร์ต่อ + ส่งโทเค็นใหม่ให้ TV ที่เคยอนุญาตไว้
}

// ---------- Media Session ----------
// ส่งชื่อเพลง/ศิลปิน/ปก/ปุ่มควบคุมให้ระบบปฏิบัติการ แสดงที่หน้าจอล็อก, Control Center, แจ้งเตือนสื่อของ Android
// และ Dynamic Island ของ iPhone (เว็บวาดใน Dynamic Island เองไม่ได้ ต้องผ่านช่องทางนี้เท่านั้น)
let _mediaSessionReady = false;
function updateMediaSession(state) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const track = state?.track_window?.current_track; if (!track) return;
  const artwork = (track.album?.images || []).map(i => ({ src: i.url, sizes: `${i.width || 300}x${i.height || 300}`, type: 'image/jpeg' }));
  navigator.mediaSession.metadata = new MediaMetadata({ title: track.name, artist: track.artists.map(a => a.name).join(', '), album: track.album?.name || '', artwork });
  navigator.mediaSession.playbackState = state.paused ? 'paused' : 'playing';
  try { if (state.duration > 0) navigator.mediaSession.setPositionState({ duration: state.duration / 1000, playbackRate: 1, position: Math.min(state.position, state.duration) / 1000 }); } catch (e) { }
  if (_mediaSessionReady) return;
  _mediaSessionReady = true;
  const on = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) { } };
  on('play', playbackResume);
  on('pause', playbackPause);
  on('previoustrack', previousTrack);
  on('nexttrack', nextTrack);
  on('seekto', d => { if (d && typeof d.seekTime === 'number') playbackSeek(Math.round(d.seekTime * 1000)); });
}

function handlePlayerStateChange(state) {
  if (!state) return;
  setPlayLoading(false);
  window._lastState = state;
  syncSeekFromState(state);
  updatePlayerUI(state);
  updateMediaSession(state);
  tvOnPlayerState(state);
  const track = state.track_window.current_track;
  const lyricsContainer = document.getElementById('lyrics-container');
  const containerEmpty = !lyricsContainer || lyricsContainer.children.length === 0;
  if (track && (!currentTrackData || currentTrackData.id !== track.id || containerEmpty)) { currentTrackData = track; setupLyricsComponent(track); }
  updateLyricsComponent(state.position, state.duration, state.paused);
}

init().catch(e => { console.error(e); showAccessError(e); });
