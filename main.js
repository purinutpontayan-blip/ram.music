//============================================================
// CONFIG — อ่าน Client ID จาก <meta> tag
// ============================================================
const CLIENT_ID = document.querySelector('meta[name="spotify-client-id"]')?.content || '';
const REDIRECT_URI = window.location.origin;
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
  if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID_HERE') { alert('กรุณาใส่ Spotify Client ID ใน <meta name="spotify-client-id"> ใน index.html'); return; }
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem('spotify_verifier', verifier);
  const params = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, code_challenge_method: 'S256', code_challenge: challenge, scope: ['user-read-private', 'user-read-email', 'streaming', 'user-read-playback-state', 'user-modify-playback-state', 'user-library-read', 'user-library-modify', 'user-follow-read', 'user-follow-modify', 'playlist-read-private', 'playlist-read-collaborative', 'user-top-read', 'user-read-recently-played'].join(' ') });
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
async function fetchWebApi(endpoint, method = 'GET', body) {
  const token = localStorage.getItem('spotify_access_token');
  const res = await fetch(`https://api.spotify.com/${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, method, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { localStorage.removeItem('spotify_access_token'); window.location.reload(); }
  if (!res.ok) { const err = new Error(`API error: ${res.status}`); err.status = res.status; throw err; }
  if (res.status === 204) return null;
  // บาง endpoint (เช่น PUT /me/library) ตอบ 200 แต่ body ว่าง — ห้าม res.json() ตรงๆ ไม่งั้นจะ throw ทั้งที่สำเร็จแล้ว
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
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
    player.addListener('player_state_changed', state => { if (_onStateChange) _onStateChange(state); });
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
  try {
    const body = contextUri ? { context_uri: contextUri, offset: { uri } } : { uris: [uri] };
    await fetchWebApi(`v1/me/player/play?device_id=${deviceId}`, 'PUT', body);
  } catch (e) { showToast('❌ ไม่สามารถเล่นเพลงนี้ได้', 'error'); }
}
const togglePlay = () => { if (window._spotifyPlayer) window._spotifyPlayer.togglePlay(); };
const nextTrack = () => { if (window._spotifyPlayer) window._spotifyPlayer.nextTrack(); };
const previousTrack = () => { if (window._spotifyPlayer) window._spotifyPlayer.previousTrack(); };

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
    div.innerHTML = `<img src="${track.album.images[0]?.url}" alt="${track.name}"><div class="track-item-info"><div class="track-item-title">${track.name}</div><div class="track-item-artist">${track.artists.map(a => a.name).join(', ')}</div></div>`;
    div.onclick = () => onPlay(track.uri);
    div.oncontextmenu = (e) => { e.preventDefault(); if (window.showTrackContextMenu) window.showTrackContextMenu(e, track); };
    container.appendChild(div);
  });
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
    div.innerHTML = `<img src="${track.album?.images?.[0]?.url || ''}" alt="${track.name}"><div class="track-item-info"><div class="track-item-title">${track.name}</div><div class="track-item-artist">${track.artists?.map(a => a.name).join(', ')}</div></div>`;
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
    div.innerHTML = `<img src="${imgUrl}" alt="${track.name}"><div class="track-item-info"><div class="track-item-title">${idx + 1}. ${track.name}</div><div class="track-item-artist">${track.artists?.map(a => a.name).join(', ')}</div></div>`;
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
  document.getElementById('player-artist').textContent = track.artists.map(a => a.name).join(', ');
  const modalArt = document.getElementById('lyrics-modal-art');
  if (modalArt) { modalArt.crossOrigin = 'anonymous'; modalArt.src = track.album.images[0]?.url; modalArt.onload = () => extractAndApplyColor(modalArt); if (modalArt.complete && modalArt.naturalWidth > 0) extractAndApplyColor(modalArt); }
  const modalTitle = document.getElementById('lyrics-modal-title');
  if (modalTitle) {
    const titleText = track.name;
    modalTitle.innerHTML = `<span class="marquee-inner">${titleText}&nbsp;&nbsp;&nbsp;${titleText}</span>`;
    requestAnimationFrame(() => { const inner = modalTitle.querySelector('.marquee-inner'); if (inner && inner.scrollWidth > modalTitle.clientWidth * 2 + 1) { modalTitle.classList.add('is-overflow'); } else { modalTitle.classList.remove('is-overflow'); modalTitle.innerHTML = `<span class="marquee-inner">${titleText}</span>`; } });
  }
  const modalArtist = document.getElementById('lyrics-modal-artist');
  if (modalArtist) modalArtist.textContent = track.artists.map(a => a.name).join(', ');
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
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  document.documentElement.style.setProperty('--accent-glow', rgba(palette[0], 0.4));
  // พื้นหลังหน้าหลัก: ไล่สี 5 สีจากปก
  const amb = document.getElementById('ambient-bg');
  if (amb) palette.forEach((c, i) => amb.style.setProperty(`--amb${i + 1}`, rgba(c, i === 0 ? .42 : .32)));
  // พื้นหลังหน้าเนื้อเพลง: blob 5 ก้อน ก้อนละสี
  const modal = document.getElementById('lyrics-modal'); if (!modal) return;
  palette.forEach((c, i) => modal.style.setProperty(`--blob${i + 1}`, rgba(c, i < 3 ? .6 : .5)));
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
function toggleLyricsModal() {
  const modal = document.getElementById('lyrics-modal');
  if (!modal.classList.contains('hidden') && document.fullscreenElement) { document.exitFullscreen().then(() => modal.classList.add('hidden')).catch(() => modal.classList.add('hidden')); return; }
  modal.classList.toggle('hidden');
}
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) { container = document.createElement('div'); container.id = 'toast-container'; container.className = 'toast-container'; document.body.appendChild(container); }
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
async function setupLyricsComponent(track) {
  const container = document.getElementById('lyrics-container');
  container.innerHTML = '<div class="lyrics-loading"></div>';
  let cleanTitle = track.name.split(' - ')[0].split(' (')[0];
  const primaryArtist = track.artists[0].name;
  const album = track.album.name;
  let isrc = '';
  try { const fullTrack = await fetchWebApi(`v1/tracks/${track.id}`); if (fullTrack?.external_ids?.isrc) isrc = fullTrack.external_ids.isrc; } catch (e) { }
  if (currentTrackData && currentTrackData.id !== track.id) return;
  container.innerHTML = '';
  const lyricsEl = document.createElement('am-lyrics');
  lyricsEl.setAttribute('song-title', cleanTitle); lyricsEl.setAttribute('song-artist', primaryArtist); lyricsEl.setAttribute('song-album', album);
  if (isrc) lyricsEl.setAttribute('isrc', isrc);
  lyricsEl.setAttribute('autoscroll', 'true'); lyricsEl.setAttribute('font-family', "'Kanit', sans-serif");
  container.appendChild(lyricsEl);
  const THAI_COMBINING = /^[\u0E31\u0E33-\u0E3A\u0E47-\u0E4E]+$/;
  function fixThaiSpans(root) {
    root.querySelectorAll('.char:not(.th-ok)').forEach(span => {
      span.classList.add('th-ok');
      if (span.textContent && THAI_COMBINING.test(span.textContent)) { let prev = span.previousElementSibling; while (prev && (!prev.classList.contains('char') || prev.style.display === 'none')) prev = prev.previousElementSibling; if (prev) { prev.textContent += span.textContent; span.textContent = ''; span.style.display = 'none'; prev.style.setProperty('width', 'auto', 'important'); prev.style.setProperty('min-width', 'auto', 'important'); prev.style.setProperty('max-width', 'none', 'important'); prev.style.setProperty('overflow', 'visible', 'important'); prev.style.setProperty('white-space', 'pre', 'important'); } }
    });
  }
  const waitForShadow = setInterval(() => { if (lyricsEl.shadowRoot) { clearInterval(waitForShadow); fixThaiSpans(lyricsEl.shadowRoot); new MutationObserver(() => fixThaiSpans(lyricsEl.shadowRoot)).observe(lyricsEl.shadowRoot, { childList: true, subtree: true }); } }, 50);
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
      try { await window._spotifyPlayer?.seek(pos); }
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
    if (!window._spotifyPlayer || seekState.dragging || seekState.paused) return;
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
// URL ของ Apps Script Web App อ่านจาก <meta name="ranking-api-url"> ใน index.html
const RANKING_API = (document.querySelector('meta[name="ranking-api-url"]')?.content || '').trim();
const RANKING_MAX_COVER = 1.5 * 1024 * 1024; // ต้องตรงกับ MAX_COVER_BYTES ใน Code.gs
const RANKING_REFRESH_MS = 30000;
let rankingTimer = null, rankingPick = null, rankingCustomCover = null, rankingBusy = false;

const rkFmt = ms => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const rkSafeUrl = u => (/^https:\/\//i.test(u || '') ? u : '');
const rkEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const RK_ERRORS = {
  unauthorized: 'เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าใหม่',
  invalid_song: 'ข้อมูลเพลงไม่ถูกต้อง',
  invalid_cover: 'รูปปกไม่ถูกต้อง (ต้องเป็น PNG / JPG / GIF)',
  cover_too_large: 'รูปปกใหญ่เกิน 1.5MB',
  cover_type: 'ไฟล์รูปต้องเป็น PNG, JPG หรือ GIF เท่านั้น',
  busy: 'ระบบกำลังยุ่ง ลองใหม่อีกครั้ง'
};

// GET (ไม่ส่ง payload) = ดึงอันดับ, POST = ส่งเพลง/โหวต
// ใช้ Content-Type: text/plain เพื่อไม่ให้เกิด CORS preflight (Apps Script ไม่รองรับ OPTIONS)
async function rankingApi(payload) {
  if (!RANKING_API) throw new Error('no_api');
  let res;
  if (payload) {
    res = await fetch(RANKING_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  } else {
    const q = new URLSearchParams({ action: 'list', user: currentUser?.id || '', _: Date.now() });
    res = await fetch(`${RANKING_API}?${q}`);
  }
  if (!res.ok) throw new Error('http_' + res.status);
  return res.json();
}

function rankingNotice(box, text) { box.innerHTML = ''; box.appendChild(rkEl('div', 'rank-empty', text)); }

function renderRanking(items) {
  const box = document.getElementById('ranking-list'); if (!box) return;
  box.innerHTML = '';
  if (!items?.length) { rankingNotice(box, 'ยังไม่มีเพลงในอันดับ — ค้นหาเพลงด้านบนแล้วเป็นคนแรกที่ส่งเลย! 🎵'); return; }
  items.slice(0, 20).forEach(it => {
    const row = rkEl('div', 'rank-item' + (it.rank <= 3 ? ` top-${it.rank}` : ''));
    const img = rkEl('img', 'rank-cover'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.src = rkSafeUrl(it.cover); img.onerror = () => img.classList.add('is-broken');
    const info = rkEl('div', 'rank-info');
    info.append(rkEl('div', 'rank-title', it.title), rkEl('div', 'rank-artist', it.artist));
    const votes = rkEl('div', 'rank-votes'); votes.append(rkEl('strong', '', String(it.votes)), rkEl('span', '', 'โหวต'));
    const btn = rkEl('button', 'rank-vote-btn', it.voted ? '✓ โหวตแล้ว' : '👍 โหวต');
    btn.type = 'button'; btn.disabled = !!it.voted;
    btn.onclick = (e) => {
      e.stopPropagation();
      rankingSubmit({ trackId: it.trackId, title: it.title, artist: it.artist, durationMs: it.durationMs, cover: it.cover }, null);
    };
    row.append(rkEl('div', 'rank-num', String(it.rank)), img, info, rkEl('div', 'rank-duration', it.duration || rkFmt(it.durationMs)), votes, btn);
    // เพลงที่ผู้ดูแลเพิ่มเอง (manual_) ไม่มีใน Spotify จึงกดเล่นไม่ได้
    if (!String(it.trackId).startsWith('manual_')) row.onclick = () => playTrack(`spotify:track:${it.trackId}`);
    else row.style.cursor = 'default';
    box.appendChild(row);
  });
}

async function loadRanking(silent) {
  const box = document.getElementById('ranking-list'); if (!box) return;
  if (!RANKING_API) { rankingNotice(box, 'ยังไม่ได้ตั้งค่า Ranking API — ใส่ URL ของ Apps Script ที่ meta "ranking-api-url" ใน index.html'); return; }
  if (!silent && !box.children.length) rankingNotice(box, 'กำลังโหลด...');
  try {
    const data = await rankingApi();
    if (!data.ok) throw new Error(data.error || 'error');
    renderRanking(data.items);
  } catch (e) {
    console.error('Ranking load error:', e);
    if (!box.querySelector('.rank-item')) rankingNotice(box, 'โหลดอันดับไม่สำเร็จ ลองกดรีเฟรช');
  }
}

async function rankingSubmit(song, customCover) {
  if (rankingBusy) return false;
  const token = localStorage.getItem('spotify_access_token');
  if (!token) { showToast('❌ กรุณาเข้าสู่ระบบใหม่', 'error'); return false; }
  rankingBusy = true;
  document.getElementById('view-ranking')?.classList.add('is-busy');
  try {
    const data = await rankingApi({ action: 'submit', token, ...song, customCover: customCover || undefined });
    if (!data.ok) { showToast('❌ ' + (RK_ERRORS[data.error] || 'ส่งเพลงไม่สำเร็จ'), 'error'); return false; }
    if (data.already) showToast('ℹ️ คุณโหวตเพลงนี้ไปแล้ว', 'warning');
    else if (data.created) showToast('🎉 ส่งเพลงเข้าอันดับแล้ว!', 'info');
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
    info.append(rkEl('div', 'track-item-title', track.name), rkEl('div', 'track-item-artist', track.artists.map(a => a.name).join(', ')));
    const btn = rkEl('button', 'rank-add-btn', '＋ ส่งเข้าอันดับ'); btn.type = 'button';
    btn.onclick = (e) => { e.stopPropagation(); openRankingModal(track); };
    row.append(img, info, rkEl('div', 'rank-duration', rkFmt(track.duration_ms)), btn);
    row.onclick = () => playTrack(track.uri);
    box.appendChild(row);
  });
}

function openRankingModal(track) {
  const imgs = track.album?.images || [];
  rankingPick = {
    trackId: track.id,
    title: track.name,
    artist: track.artists.map(a => a.name).join(', '),
    durationMs: track.duration_ms,
    cover: imgs[1]?.url || imgs[0]?.url || ''
  };
  rankingCustomCover = null;
  document.getElementById('rk-cover-file').value = '';
  document.getElementById('rk-cover-reset').classList.add('hidden');
  document.getElementById('rk-cover-preview').src = rankingPick.cover;
  document.getElementById('rk-title').textContent = rankingPick.title;
  document.getElementById('rk-artist').textContent = rankingPick.artist;
  document.getElementById('rk-duration').textContent = `ระยะเวลา ${rkFmt(rankingPick.durationMs)}`;
  document.getElementById('ranking-modal').classList.remove('hidden');
}
function closeRankingModal() { document.getElementById('ranking-modal')?.classList.add('hidden'); rankingPick = null; rankingCustomCover = null; }

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
  document.getElementById('btn-ranking-refresh')?.addEventListener('click', () => loadRanking(false));

  const modal = document.getElementById('ranking-modal');
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeRankingModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRankingModal(); });
  document.getElementById('rk-cancel')?.addEventListener('click', closeRankingModal);

  const fileInput = document.getElementById('rk-cover-file'), preview = document.getElementById('rk-cover-preview'), resetBtn = document.getElementById('rk-cover-reset');
  fileInput?.addEventListener('change', () => {
    const f = fileInput.files?.[0]; if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/gif'].includes(f.type)) { showToast('⚠️ รองรับเฉพาะ PNG / JPG / GIF', 'warning'); fileInput.value = ''; return; }
    if (f.size > RANKING_MAX_COVER) { showToast('⚠️ ไฟล์ใหญ่เกิน 1.5MB', 'warning'); fileInput.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      rankingCustomCover = { mime: f.type, name: f.name, data: dataUrl.split(',')[1] };
      preview.src = dataUrl; resetBtn.classList.remove('hidden');
    };
    reader.readAsDataURL(f);
  });
  resetBtn?.addEventListener('click', () => {
    rankingCustomCover = null; fileInput.value = '';
    if (rankingPick) preview.src = rankingPick.cover;
    resetBtn.classList.add('hidden');
  });

  const submitBtn = document.getElementById('rk-submit');
  submitBtn?.addEventListener('click', async () => {
    if (!rankingPick || rankingBusy) return;
    submitBtn.disabled = true; const old = submitBtn.textContent; submitBtn.textContent = 'กำลังส่ง...';
    const ok = await rankingSubmit(rankingPick, rankingCustomCover);
    submitBtn.disabled = false; submitBtn.textContent = old;
    if (ok) { closeRankingModal(); if (input) input.value = ''; renderRankingSearch(null); }
  });
}
// เข้าหน้า Ranking = โหลดทันที + รีเฟรชอัตโนมัติทุก 30 วินาที / ออกจากหน้า = หยุด
function startRankingView() {
  loadRanking(false);
  clearInterval(rankingTimer);
  rankingTimer = setInterval(() => { if (document.visibilityState === 'visible') loadRanking(true); }, RANKING_REFRESH_MS);
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

    getRecentlyPlayed().then(d => { if (d) renderHistory(d, playTrack); }).catch(e => console.error('History error:', e));

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
  document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); showView(`view-${e.target.dataset.target}`); }));
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
    if (window._spotifyPlayer) { const state = await window._spotifyPlayer.getCurrentState(); if (state) { const lyricsContainer = document.getElementById('lyrics-container'); const containerEmpty = !lyricsContainer || lyricsContainer.children.length === 0; const track = state.track_window?.current_track; if (track && containerEmpty) { currentTrackData = null; setupLyricsComponent(track); } updateLyricsComponent(state.position, state.duration, state.paused); } }
  });
  document.getElementById('btn-close-lyrics').addEventListener('click', () => toggleLyricsModal());
  const btnFs = document.getElementById('btn-fullscreen-lyrics');
  if (btnFs) {
    btnFs.addEventListener('click', () => { const modal = document.getElementById('lyrics-modal'); if (!document.fullscreenElement) modal.requestFullscreen().catch(err => console.warn('Fullscreen error:', err)); else document.exitFullscreen(); });
    document.addEventListener('fullscreenchange', () => { const enter = document.getElementById('icon-fullscreen-enter'), exit = document.getElementById('icon-fullscreen-exit'); if (document.fullscreenElement) { enter?.classList.add('hidden'); exit?.classList.remove('hidden'); } else { enter?.classList.remove('hidden'); exit?.classList.add('hidden'); } });
  }
  document.getElementById('btn-lyrics-play-pause')?.addEventListener('click', togglePlay);
  document.getElementById('btn-lyrics-next')?.addEventListener('click', nextTrack);
  document.getElementById('btn-lyrics-prev')?.addEventListener('click', previousTrack);
}

async function handleArtistClick(artistId) {
  try {
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
      document.getElementById('playlist-modal').classList.remove('hidden');
      const listContainer = document.getElementById('playlist-list'); listContainer.innerHTML = 'กำลังโหลด...';
      try {
        const user = await getUserProfile();
        const playlists = await fetchWebApi('v1/me/playlists?limit=50');
        const myPlaylists = playlists.items.filter(p => p.owner.id === user.id);
        listContainer.innerHTML = '';
        if (myPlaylists.length === 0) { listContainer.innerHTML = 'ไม่พบเพลย์ลิสต์ของคุณ'; }
        else { myPlaylists.forEach(p => { const item = document.createElement('div'); item.className = 'playlist-list-item'; item.textContent = p.name; item.onclick = async () => { try { await fetchWebApi(`v1/playlists/${p.id}/tracks?uris=${currentContextTrack.uri}`, 'POST'); showToast(`✅ เพิ่มเพลงลงใน ${p.name} แล้ว`, 'info'); document.getElementById('playlist-modal').classList.add('hidden'); } catch (err) { showToast('❌ ไม่สามารถเพิ่มเพลงได้', 'error'); } }; listContainer.appendChild(item); }); }
      } catch (e) { listContainer.innerHTML = 'เกิดข้อผิดพลาดในการโหลดเพลย์ลิสต์'; }
    }
    menu.classList.add('hidden');
  });
}

function handlePlayerStateChange(state) {
  if (!state) return;
  syncSeekFromState(state);
  updatePlayerUI(state);
  const track = state.track_window.current_track;
  const lyricsContainer = document.getElementById('lyrics-container');
  const containerEmpty = !lyricsContainer || lyricsContainer.children.length === 0;
  if (track && (!currentTrackData || currentTrackData.id !== track.id || containerEmpty)) { currentTrackData = track; setupLyricsComponent(track); }
  updateLyricsComponent(state.position, state.duration, state.paused);
}

init().catch(e => { console.error(e); showAccessError(e); });
