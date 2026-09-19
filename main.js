// src/main.js
import './style.css';

import { loginWithSpotify, handleRedirect, getUserProfile, getFeaturedPlaylists, searchSpotify, fetchWebApi } from './spotify.js';
import { initSpotifyPlayer, playTrack, togglePlay, nextTrack, previousTrack, showPremiumRequiredModal } from './player.js';
import * as UI from './ui.js';

let accessToken = null;
let currentTrackData = null;

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
    lyricsEl.setAttribute('interpolate', 'false'); // Fix Thai character splitting
    lyricsEl.setAttribute('font-family', "'Kanit', sans-serif");
    
    container.appendChild(lyricsEl);
}

// Start app
init();
