//============================================================
// CONFIG — อ่าน Client ID จาก <meta> tag
// ============================================================
const CLIENT_ID = document.querySelector('meta[name="spotify-client-id"]')?.content || '';
const REDIRECT_URI = window.location.origin;

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
  return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)])).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function loginWithSpotify() {
  if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID_HERE') { alert('กรุณาใส่ Spotify Client ID ใน <meta name="spotify-client-id"> ใน index.html'); return; }
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem('spotify_verifier', verifier);
  const params = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, code_challenge_method: 'S256', code_challenge: challenge, scope: ['user-read-private','user-read-email','streaming','user-read-playback-state','user-modify-playback-state','user-library-read','playlist-read-private','playlist-read-collaborative','user-top-read','user-read-recently-played'].join(' ') });
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
      return data.access_token;
    } catch (error) { console.error('Error fetching token:', error); return null; }
  }
  return localStorage.getItem('spotify_access_token');
}

// ============================================================
// SPOTIFY API
// ============================================================
async function fetchWebApi(endpoint, method = 'GET', body) {
  const token = localStorage.getItem('spotify_access_token');
  const res = await fetch(`https://api.spotify.com/${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, method, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { localStorage.removeItem('spotify_access_token'); window.location.reload(); }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  if (res.status === 204) return null;
  return await res.json();
}
const getUserProfile = () => fetchWebApi('v1/me');
const getRecentlyPlayed = () => fetchWebApi('v1/me/player/recently-played?limit=20');
const searchSpotify = (q) => fetchWebApi(`v1/search?q=${encodeURIComponent(q)}&type=track,artist,album&limit=10`);
const getArtist = (id) => fetchWebApi(`v1/artists/${id}`);
const getArtistTopTracks = (id) => fetchWebApi(`v1/artists/${id}/top-tracks`);
const getArtistAlbums = (id) => fetchWebApi(`v1/artists/${id}/albums?include_groups=album,single&limit=20`);

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
  try { await fetchWebApi('v1/me/player', 'PUT', { device_ids: [device_id], play: false }); } catch(e) {}
}
async function playTrack(uri) {
  if (!deviceId) { showToast('⚠️ Player ยังไม่พร้อม กรุณารอสักครู่', 'warning'); return; }
  try { await fetchWebApi(`v1/me/player/play?device_id=${deviceId}`, 'PUT', { uris: [uri] }); } catch(e) { showToast('❌ ไม่สามารถเล่นเพลงนี้ได้', 'error'); }
}
const togglePlay = () => { if (window._spotifyPlayer) window._spotifyPlayer.togglePlay(); };
const nextTrack = () => { if (window._spotifyPlayer) window._spotifyPlayer.nextTrack(); };
const previousTrack = () => { if (window._spotifyPlayer) window._spotifyPlayer.previousTrack(); };

function showPremiumRequiredModal() {
  const existing = document.getElementById('premium-modal'); if (existing) existing.remove();
  const modal = document.createElement('div'); modal.id = 'premium-modal';
  modal.innerHTML = `<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);backdrop-filter:blur(5px);z-index:999;display:flex;align-items:center;justify-content:center;"><div class="glass-panel" style="padding:3rem;border-radius:24px;text-align:center;max-width:420px;width:90%;"><div style="font-size:3rem;margin-bottom:1rem">🎵</div><h2 style="font-size:1.6rem;margin-bottom:1rem;background:linear-gradient(135deg,#1db954,#1ed760);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">ต้องใช้ Spotify Premium</h2><p style="color:#a0a0a5;line-height:1.6;margin-bottom:2rem;">R Music ต้องการบัญชี <strong style="color:#fff">Spotify Premium</strong> เพื่อเล่นเพลงบนเว็บบราวเซอร์ครับ</p><a href="https://www.spotify.com/premium/" target="_blank" style="display:block;background:#1db954;color:white;padding:1rem 2rem;border-radius:30px;text-decoration:none;font-weight:700;margin-bottom:1rem;">อัปเกรดเป็น Premium</a><button onclick="document.getElementById('premium-modal').remove()" style="background:rgba(255,255,255,.1);color:#a0a0a5;border:none;padding:.75rem 2rem;border-radius:12px;cursor:pointer;font-size:.9rem;">ปิด</button></div></div>`;
  document.body.appendChild(modal);
}

// ============================================================
// UI
// ============================================================
function showScreen(id) { document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); }
function showView(viewId) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.getElementById('search-bar-container').classList.toggle('hidden', viewId !== 'view-search');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.target === viewId.replace('view-','')));
}
function renderUserProfile(profile) {
  const container = document.getElementById('user-profile');
  const imageUrl = profile.images?.length ? profile.images[0].url : '';
  container.innerHTML = `<img src="${imageUrl}" alt="${profile.display_name}"><span>${profile.display_name}</span>`;
}
function renderHistory(historyData, onPlay) {
  const container = document.getElementById('history-grid'); container.innerHTML = '';
  if (!historyData?.items) return;
  const unique = []; const uris = new Set();
  for (const item of historyData.items) { if (!uris.has(item.track.uri)) { uris.add(item.track.uri); unique.push(item.track); } }
  unique.slice(0,12).forEach(track => {
    if (!track) return;
    const div = document.createElement('div'); div.className = 'history-card playlist-card';
    div.innerHTML = `<img src="${track.album.images[0]?.url}" alt="${track.name}"><div class="playlist-title">${track.name}</div><div class="playlist-owner">${track.artists.map(a=>a.name).join(', ')}</div>`;
    div.onclick = () => onPlay(track.uri);
    div.oncontextmenu = (e) => { e.preventDefault(); if (window.showTrackContextMenu) window.showTrackContextMenu(e, track); };
    container.appendChild(div);
  });
}
function renderSearchResults(results, onPlay, onArtistClick) {
  const container = document.getElementById('search-results'), artistsContainer = document.getElementById('search-artists');
  container.innerHTML = ''; artistsContainer.innerHTML = '';
  if (!results) return;
  results.artists?.items?.slice(0,5).forEach(artist => {
    const div = document.createElement('div'); div.className = 'artist-card playlist-card';
    const imgUrl = artist.images?.[0]?.url || '';
    div.innerHTML = `<img src="${imgUrl}" alt="${artist.name}" style="border-radius:50%"><div class="playlist-title" style="text-align:center;margin-top:10px">${artist.name}</div>`;
    div.onclick = () => onArtistClick(artist.id); artistsContainer.appendChild(div);
  });
  results.tracks?.items?.forEach(track => {
    const div = document.createElement('div'); div.className = 'track-item';
    div.innerHTML = `<img src="${track.album.images[0]?.url}" alt="${track.name}"><div class="track-item-info"><div class="track-item-title">${track.name}</div><div class="track-item-artist">${track.artists.map(a=>a.name).join(', ')}</div></div>`;
    div.onclick = () => onPlay(track.uri);
    div.oncontextmenu = (e) => { e.preventDefault(); if (window.showTrackContextMenu) window.showTrackContextMenu(e, track); };
    container.appendChild(div);
  });
}
function renderArtistView(artist, topTracks, albums, onPlay) {
  const header = document.getElementById('artist-header');
  const imgUrl = artist.images?.[0]?.url || '';
  const followersCount = artist.followers?.total ? artist.followers.total.toLocaleString() : '0';
  header.innerHTML = `<div style="display:flex;align-items:center;gap:20px;margin-bottom:30px"><img src="${imgUrl}" alt="${artist.name}" style="width:150px;height:150px;border-radius:50%;object-fit:cover;box-shadow:0 8px 24px rgba(0,0,0,.5)"><div><h1 style="font-size:3rem;margin:0">${artist.name}</h1><p style="color:var(--text-muted);margin-top:10px">${followersCount} followers</p></div></div>`;
  const tracksContainer = document.getElementById('artist-top-tracks'); tracksContainer.innerHTML = '';
  topTracks?.tracks?.slice(0,5).forEach(track => {
    const div = document.createElement('div'); div.className = 'track-item';
    div.innerHTML = `<img src="${track.album?.images?.[0]?.url || ''}" alt="${track.name}"><div class="track-item-info"><div class="track-item-title">${track.name}</div><div class="track-item-artist">${track.artists?.map(a=>a.name).join(', ')}</div></div>`;
    div.onclick = () => onPlay(track.uri);
    div.oncontextmenu = (e) => { e.preventDefault(); if (window.showTrackContextMenu) window.showTrackContextMenu(e, track); };
    tracksContainer.appendChild(div);
  });
  const albumsContainer = document.getElementById('artist-albums'); albumsContainer.innerHTML = '';
  albums?.items?.forEach(album => {
    const div = document.createElement('div'); div.className = 'album-card playlist-card';
    div.innerHTML = `<img src="${album.images?.[0]?.url || ''}" alt="${album.name}"><div class="playlist-title">${album.name}</div><div class="playlist-owner">${new Date(album.release_date).getFullYear()} • ${album.album_type}</div>`;
    albumsContainer.appendChild(div);
  });
}
function updatePlayerUI(state) {
  if (!state) return;
  const track = state.track_window.current_track; if (!track) return;
  document.getElementById('player-art').src = track.album.images[0]?.url;
  document.getElementById('player-art').classList.remove('hidden');
  document.getElementById('player-title').textContent = track.name;
  document.getElementById('player-artist').textContent = track.artists.map(a=>a.name).join(', ');
  const modalArt = document.getElementById('lyrics-modal-art');
  if (modalArt) { modalArt.crossOrigin = 'anonymous'; modalArt.src = track.album.images[0]?.url; modalArt.onload = () => extractAndApplyColor(modalArt); if (modalArt.complete && modalArt.naturalWidth > 0) extractAndApplyColor(modalArt); }
  const modalTitle = document.getElementById('lyrics-modal-title');
  if (modalTitle) {
    const titleText = track.name;
    modalTitle.innerHTML = `<span class="marquee-inner">${titleText}&nbsp;&nbsp;&nbsp;${titleText}</span>`;
    requestAnimationFrame(() => { const inner = modalTitle.querySelector('.marquee-inner'); if (inner && inner.scrollWidth > modalTitle.clientWidth * 2 + 1) { modalTitle.classList.add('is-overflow'); } else { modalTitle.classList.remove('is-overflow'); modalTitle.innerHTML = `<span class="marquee-inner">${titleText}</span>`; } });
  }
  const modalArtist = document.getElementById('lyrics-modal-artist');
  if (modalArtist) modalArtist.textContent = track.artists.map(a=>a.name).join(', ');
  const iconPlay = document.getElementById('icon-play'), iconPause = document.getElementById('icon-pause');
  const modalIconPlay = document.getElementById('lyrics-icon-play'), modalIconPause = document.getElementById('lyrics-icon-pause');
  if (state.paused) { iconPlay.classList.remove('hidden'); iconPause.classList.add('hidden'); modalIconPlay?.classList.remove('hidden'); modalIconPause?.classList.add('hidden'); }
  else { iconPlay.classList.add('hidden'); iconPause.classList.remove('hidden'); modalIconPlay?.classList.add('hidden'); modalIconPause?.classList.remove('hidden'); }
}
function hslToRgb(h,s,l) { s/=100;l/=100; const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1))); return [Math.round(f(0)*255),Math.round(f(8)*255),Math.round(f(4)*255)]; }
function rgbToHue(r,g,b) { r/=255;g/=255;b/=255; const max=Math.max(r,g,b),min=Math.min(r,g,b);let h=0; if(max!==min){const d=max-min; if(max===r) h=((g-b)/d+(g<b?6:0))/6; else if(max===g) h=((b-r)/d+2)/6; else h=((r-g)/d+4)/6;} return Math.round(h*360); }
function applyColorToModal(r,g,b) {
  document.documentElement.style.setProperty('--accent-glow',`rgba(${r},${g},${b},0.4)`);
  const modal = document.getElementById('lyrics-modal'); if (!modal) return;
  const [r2,g2,b2] = hslToRgb(((rgbToHue(r,g,b)+150)%360),65,40);
  modal.style.setProperty('--blob1',`rgba(${r},${g},${b},0.6)`);
  modal.style.setProperty('--blob2',`rgba(${r2},${g2},${b2},0.5)`);
  modal.style.setProperty('--blob3',`rgba(${Math.round(r*.5)},${Math.round(g*.7)},${Math.round(b*.5)},0.35)`);
  let blobLayer = modal.querySelector('.modal-blobs');
  if (!blobLayer) { blobLayer = document.createElement('div'); blobLayer.className = 'modal-blobs'; blobLayer.innerHTML = '<div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div>'; modal.insertBefore(blobLayer, modal.firstChild); }
}
function extractAndApplyColor(imgEl) {
  try {
    const canvas = document.createElement('canvas'); canvas.width = 50; canvas.height = 50;
    const ctx = canvas.getContext('2d'); ctx.drawImage(imgEl,0,0,50,50);
    const data = ctx.getImageData(0,0,50,50).data;
    let bestR=30,bestG=30,bestB=30,bestSat=0;
    for (let i=0;i<data.length;i+=4) { const r=data[i],g=data[i+1],b=data[i+2],max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max===0?0:(max-min)/max,lum=(max+min)/510; if (sat>bestSat&&lum>.1&&lum<.9) { bestSat=sat;bestR=r;bestG=g;bestB=b; } }
    applyColorToModal(bestR,bestG,bestB);
  } catch(e) { const src=imgEl.src||''; let hash=0; for(let i=0;i<src.length;i++) hash=src.charCodeAt(i)+((hash<<5)-hash); const hue=Math.abs(hash)%360; const [r,g,b]=hslToRgb(hue,65,45); applyColorToModal(r,g,b); }
}
function toggleLyricsModal() {
  const modal = document.getElementById('lyrics-modal');
  if (!modal.classList.contains('hidden') && document.fullscreenElement) { document.exitFullscreen().then(()=>modal.classList.add('hidden')).catch(()=>modal.classList.add('hidden')); return; }
  modal.classList.toggle('hidden');
}
function showToast(message, type='info') {
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
    lyricsUpdateInterval = setInterval(() => { const now = performance.now(); currentPos += (now-lastTime); lastTime = now; lyricsEl.setAttribute('current-time', currentPos); lyricsEl.currentTime = currentPos; }, 100);
  }
}
async function setupLyricsComponent(track) {
  const container = document.getElementById('lyrics-container');
  container.innerHTML = '<div class="lyrics-loading"></div>';
  let cleanTitle = track.name.split(' - ')[0].split(' (')[0];
  const primaryArtist = track.artists[0].name;
  const album = track.album.name;
  let isrc = '';
  try { const fullTrack = await fetchWebApi(`v1/tracks/${track.id}`); if (fullTrack?.external_ids?.isrc) isrc = fullTrack.external_ids.isrc; } catch(e) {}
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
      if (span.textContent && THAI_COMBINING.test(span.textContent)) { let prev = span.previousElementSibling; while (prev && (!prev.classList.contains('char') || prev.style.display==='none')) prev = prev.previousElementSibling; if (prev) { prev.textContent += span.textContent; span.textContent = ''; span.style.display = 'none'; } }
    });
  }
  const waitForShadow = setInterval(() => { if (lyricsEl.shadowRoot) { clearInterval(waitForShadow); fixThaiSpans(lyricsEl.shadowRoot); new MutationObserver(()=>fixThaiSpans(lyricsEl.shadowRoot)).observe(lyricsEl.shadowRoot,{childList:true,subtree:true}); } }, 50);
}

// ============================================================
// MAIN APP
// ============================================================
let accessToken = null, currentTrackData = null, currentContextTrack = null;

async function init() {
  accessToken = await handleRedirect();
  if (accessToken) {
    showScreen('app-screen');
    document.getElementById('player-screen').classList.remove('hidden');
    const profile = await getUserProfile();
    if (profile) {
      renderUserProfile(profile);
      if (profile.product !== 'premium') { showPremiumRequiredModal(); document.getElementById('player-screen').classList.add('hidden'); return; }
    }
    const historyData = await getRecentlyPlayed();
    if (historyData) renderHistory(historyData, playTrack);
    initSpotifyPlayer(accessToken, handlePlayerStateChange, () => { console.log('Player is ready!'); });
  } else {
    showScreen('login-screen');
  }
  setupEventListeners();
  setupContextMenu();
}

function setupEventListeners() {
  document.getElementById('login-button').addEventListener('click', loginWithSpotify);
  document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); showView(`view-${e.target.dataset.target}`); }));
  let searchTimeout;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value;
    if (query.length > 2) searchTimeout = setTimeout(async () => { const results = await searchSpotify(query); renderSearchResults(results, playTrack, handleArtistClick); }, 500);
    else renderSearchResults(null, null, null);
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
    const [artist, topTracks, albums] = await Promise.all([getArtist(artistId), getArtistTopTracks(artistId), getArtistAlbums(artistId)]);
    renderArtistView(artist, topTracks, albums, playTrack);
  } catch (err) {
    console.error('Error fetching artist:', err);
    showToast('❌ ไม่สามารถโหลดข้อมูลศิลปินได้ (อาจเป็นเพราะไม่มีข้อมูลในภูมิภาคนี้)', 'error');
    document.getElementById('artist-header').innerHTML = '<div style="color:red">เกิดข้อผิดพลาดในการโหลดข้อมูลศิลปิน</div>';
  }
}

function setupContextMenu() {
  const menu = document.getElementById('context-menu');
  document.addEventListener('click', (e) => { if (!e.target.closest('#context-menu')) menu.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.classList.add('hidden'); });
  window.showTrackContextMenu = (e, track) => { currentContextTrack = track; menu.style.left = `${e.pageX}px`; menu.style.top = `${e.pageY}px`; menu.classList.remove('hidden'); };
  document.getElementById('menu-play-next').addEventListener('click', async () => {
    if (currentContextTrack) { try { await fetchWebApi(`v1/me/player/queue?uri=${currentContextTrack.uri}`, 'POST'); showToast('✅ เพิ่มลงในคิวแล้ว', 'info'); } catch(e) { showToast('❌ ไม่สามารถเพิ่มลงคิวได้', 'error'); } }
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
        else { myPlaylists.forEach(p => { const item = document.createElement('div'); item.className = 'playlist-list-item'; item.textContent = p.name; item.onclick = async () => { try { await fetchWebApi(`v1/playlists/${p.id}/tracks?uris=${currentContextTrack.uri}`, 'POST'); showToast(`✅ เพิ่มเพลงลงใน ${p.name} แล้ว`, 'info'); document.getElementById('playlist-modal').classList.add('hidden'); } catch(err) { showToast('❌ ไม่สามารถเพิ่มเพลงได้', 'error'); } }; listContainer.appendChild(item); }); }
      } catch(e) { listContainer.innerHTML = 'เกิดข้อผิดพลาดในการโหลดเพลย์ลิสต์'; }
    }
    menu.classList.add('hidden');
  });
}

function handlePlayerStateChange(state) {
  if (!state) return;
  updatePlayerUI(state);
  const track = state.track_window.current_track;
  const lyricsContainer = document.getElementById('lyrics-container');
  const containerEmpty = !lyricsContainer || lyricsContainer.children.length === 0;
  if (track && (!currentTrackData || currentTrackData.id !== track.id || containerEmpty)) { currentTrackData = track; setupLyricsComponent(track); }
  updateLyricsComponent(state.position, state.duration, state.paused);
}

init();
