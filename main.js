// src/main.js
import './style.css';

import { loginWithSpotify, handleRedirect, getUserProfile, getFeaturedPlaylists, searchSpotify, fetchWebApi } from './spotify.js';
import { initSpotifyPlayer, playTrack, togglePlay, nextTrack, previousTrack, showPremiumRequiredModal } from './player.js';
import * as UI from './ui.js';

let accessToken = null;
let currentTrackData = null;
let currentContextTrack = null;

async function init() {
    // Check for redirect or existing token
    accessToken = await handleRedirect();

    if (accessToken) {
        // Logged in
        UI.showScreen('app-screen');
        document.getElementById('player-screen').classList.remove('hidden');

        // Load Profile
        const profile = await getUserProfile();
        if (profile) {
            UI.renderUserProfile(profile);
            
            // Check for premium account
            if (profile.product !== 'premium') {
                showPremiumRequiredModal();
                // Hide player elements to prevent errors
                document.getElementById('player-screen').classList.add('hidden');
                return; // Stop further initialization for non-premium
            }
        }

        // Load Featured Playlists
        const playlists = await getFeaturedPlaylists();
        if (playlists) UI.renderPlaylists(playlists, (uri) => {
            // Simplified: just alert for playlists as we need context_uri for player which we haven't implemented fully
            alert("Playing playlists not fully implemented in this demo. Try searching for a track!");
        });

        // Initialize Player
        initSpotifyPlayer(accessToken, handlePlayerStateChange, () => {
            console.log("Player is ready!");
        });

    } else {
        // Not logged in
        UI.showScreen('login-screen');
    }

    setupEventListeners();
    setupContextMenu();
}

function setupEventListeners() {
    // Login button
    document.getElementById('login-button').addEventListener('click', loginWithSpotify);

    // Navigation
    document.querySelectorAll('.nav-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            UI.showView(`view-${e.target.dataset.target}`);
        });
    });

    // Search
    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value;
        if (query.length > 2) {
            searchTimeout = setTimeout(async () => {
                const results = await searchSpotify(query);
                UI.renderSearchResults(results, playTrack);
            }, 500);
        } else {
            UI.renderSearchResults(null, null); // clear
        }
    });

    // Player Controls
    document.getElementById('btn-play-pause').addEventListener('click', togglePlay);
    document.getElementById('btn-next').addEventListener('click', nextTrack);
    document.getElementById('btn-prev').addEventListener('click', previousTrack);

    // Lyrics Toggle
    document.getElementById('btn-lyrics-toggle').addEventListener('click', () => {
        UI.toggleLyricsModal();
        updateLyricsComponent(); // Update in case state changed while closed
    });

    document.getElementById('btn-close-lyrics').addEventListener('click', () => {
        UI.toggleLyricsModal();
    });
    // Modal Lyrics Controls
    const btnLyricsPlayPause = document.getElementById('btn-lyrics-play-pause');
    if (btnLyricsPlayPause) btnLyricsPlayPause.addEventListener('click', togglePlay);
    
    const btnLyricsNext = document.getElementById('btn-lyrics-next');
    if (btnLyricsNext) btnLyricsNext.addEventListener('click', nextTrack);
    
    const btnLyricsPrev = document.getElementById('btn-lyrics-prev');
    if (btnLyricsPrev) btnLyricsPrev.addEventListener('click', previousTrack);
}

function setupContextMenu() {
    const menu = document.getElementById('context-menu');
    
    // Hide menu on any click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#context-menu')) {
            menu.classList.add('hidden');
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') menu.classList.add('hidden');
    });

    // Expose for UI to call
    window.showTrackContextMenu = (e, track) => {
        currentContextTrack = track;
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        menu.classList.remove('hidden');
    };

    document.getElementById('menu-play-next').addEventListener('click', async () => {
        if (currentContextTrack) {
            try {
                await fetchWebApi(`v1/me/player/queue?uri=${currentContextTrack.uri}`, 'POST');
                UI.showToast('✅ เพิ่มลงในคิวแล้ว', 'info');
            } catch (e) {
                UI.showToast('❌ ไม่สามารถเพิ่มลงคิวได้', 'error');
            }
        }
        menu.classList.add('hidden');
    });

    document.getElementById('menu-add-playlist').addEventListener('click', async () => {
        if (currentContextTrack) {
            // Open playlist modal
            document.getElementById('playlist-modal').classList.remove('hidden');
            const listContainer = document.getElementById('playlist-list');
            listContainer.innerHTML = 'กำลังโหลด...';
            
            try {
                // Fetch user's own playlists
                const user = await getUserProfile();
                const playlists = await fetchWebApi('v1/me/playlists?limit=50');
                
                const myPlaylists = playlists.items.filter(p => p.owner.id === user.id);
                
                listContainer.innerHTML = '';
                if (myPlaylists.length === 0) {
                    listContainer.innerHTML = 'ไม่พบเพลย์ลิสต์ของคุณ';
                } else {
                    myPlaylists.forEach(p => {
                        const item = document.createElement('div');
                        item.className = 'playlist-list-item';
                        item.textContent = p.name;
                        item.onclick = async () => {
                            try {
                                await fetchWebApi(`v1/playlists/${p.id}/tracks?uris=${currentContextTrack.uri}`, 'POST');
                                UI.showToast(`✅ เพิ่มเพลงลงใน ${p.name} แล้ว`, 'info');
                                document.getElementById('playlist-modal').classList.add('hidden');
                            } catch (err) {
                                UI.showToast('❌ ไม่สามารถเพิ่มเพลงได้', 'error');
                            }
                        };
                        listContainer.appendChild(item);
                    });
                }
            } catch (e) {
                listContainer.innerHTML = 'เกิดข้อผิดพลาดในการโหลดเพลย์ลิสต์';
            }
        }
        menu.classList.add('hidden');
    });
}

function handlePlayerStateChange(state) {
    if (!state) return;
    
    UI.updatePlayerUI(state);

    const track = state.track_window.current_track;
    if (track && (!currentTrackData || currentTrackData.id !== track.id)) {
        currentTrackData = track;
        setupLyricsComponent(track);
    }
    
    // Update current time on lyrics if playing
    updateLyricsComponent(state.position, state.duration, state.paused);
}

let lyricsUpdateInterval;
function updateLyricsComponent(positionMs, durationMs, paused) {
    clearInterval(lyricsUpdateInterval);
    const lyricsEl = document.querySelector('am-lyrics');
    if (!lyricsEl) return;
    
    // Sync position
    if (positionMs !== undefined) {
        lyricsEl.setAttribute('current-time', positionMs);
        lyricsEl.setAttribute('duration', paused ? -1 : durationMs); // -1 stops playback animation
    }

    // Try to simulate real-time update when playing (since Spotify state doesn't update every MS)
    if (!paused && positionMs !== undefined) {
        let currentPos = positionMs;
        let lastTime = performance.now();
        
        lyricsUpdateInterval = setInterval(() => {
            const now = performance.now();
            currentPos += (now - lastTime);
            lastTime = now;
            lyricsEl.setAttribute('current-time', currentPos);
            lyricsEl.currentTime = currentPos;
        }, 100);
    }
}

async function setupLyricsComponent(track) {
    const container = document.getElementById('lyrics-container');
    container.innerHTML = ''; // clear old

    // Clean up the title to improve search accuracy (e.g., remove "- Remastered", "(feat. )")
    let cleanTitle = track.name.split(' - ')[0];
    cleanTitle = cleanTitle.split(' (')[0];
    
    // Use only the primary artist for a more accurate search
    const primaryArtist = track.artists[0].name;
    const album = track.album.name;

    let isrc = '';
    try {
        const fullTrack = await fetchWebApi(`v1/tracks/${track.id}`);
        if (fullTrack && fullTrack.external_ids && fullTrack.external_ids.isrc) {
            isrc = fullTrack.external_ids.isrc;
        }
    } catch (e) {
        console.error("Failed to fetch ISRC", e);
    }

    const lyricsEl = document.createElement('am-lyrics');
    lyricsEl.setAttribute('song-title', cleanTitle);
    lyricsEl.setAttribute('song-artist', primaryArtist);
    lyricsEl.setAttribute('song-album', album);
    
    if (isrc) {
        lyricsEl.setAttribute('isrc', isrc);
    }
    
    // Try passing original raw title too as fallback if cleanTitle fails
    // The library may be struggling with strict queries, so we let it use the song-title
    
    lyricsEl.setAttribute('autoscroll', 'true');
    lyricsEl.setAttribute('font-family', "'Kanit', sans-serif");
    
    container.appendChild(lyricsEl);

    // Fix Thai combining characters isolated into separate spans by am-lyrics
    // Thai combining range: \u0E31, \u0E33-\u0E3A (vowels/sara), \u0E47-\u0E4E (tone marks)
    const THAI_COMBINING = /^[\u0E31\u0E33-\u0E3A\u0E47-\u0E4E]+$/;
    
    function fixThaiSpans(root) {
        const spans = root.querySelectorAll('.char:not(.th-ok)');
        spans.forEach(span => {
            span.classList.add('th-ok');
            if (span.textContent && THAI_COMBINING.test(span.textContent)) {
                // Walk backwards to find previous visible base consonant span
                let prev = span.previousElementSibling;
                while (prev && (!prev.classList.contains('char') || prev.style.display === 'none')) {
                    prev = prev.previousElementSibling;
                }
                if (prev) {
                    prev.textContent += span.textContent;
                    span.textContent = '';
                    span.style.display = 'none';
                }
            }
        });
    }

    // Wait for shadow root to be available, then observe
    const waitForShadow = setInterval(() => {
        if (lyricsEl.shadowRoot) {
            clearInterval(waitForShadow);
            // Run once immediately for any existing spans
            fixThaiSpans(lyricsEl.shadowRoot);
            // Then observe future DOM mutations (new lines rendered)
            const obs = new MutationObserver(() => fixThaiSpans(lyricsEl.shadowRoot));
            obs.observe(lyricsEl.shadowRoot, { childList: true, subtree: true });
        }
    }, 50);
}

// Start app
init();
