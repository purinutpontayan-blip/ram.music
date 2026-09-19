// src/ui.js

export function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

export function showView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    if (viewId === 'view-search') {
        document.getElementById('search-bar-container').classList.remove('hidden');
    } else {
        document.getElementById('search-bar-container').classList.add('hidden');
    }

    // Update sidebar active state
    document.querySelectorAll('.nav-item').forEach(el => {
        if (el.dataset.target === viewId.replace('view-', '')) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

export function renderUserProfile(profile) {
    const container = document.getElementById('user-profile');
    const imageUrl = profile.images && profile.images.length > 0 ? profile.images[0].url : 'https://i.scdn.co/image/ab6761610000e5eb55d39ab9c21d506aa52f7021'; // placeholder
    
    container.innerHTML = `
        <img src="${imageUrl}" alt="${profile.display_name}">
        <span>${profile.display_name}</span>
    `;
}

export function renderPlaylists(playlistsData, onPlay) {
    const container = document.getElementById('playlists-grid');
    container.innerHTML = '';

    if (!playlistsData || !playlistsData.playlists || !playlistsData.playlists.items) return;

    playlistsData.playlists.items.forEach(playlist => {
        if (!playlist) return;
        const div = document.createElement('div');
        div.className = 'playlist-card';
        div.innerHTML = `
            <img src="${playlist.images[0]?.url}" alt="${playlist.name}">
            <div class="playlist-title">${playlist.name}</div>
            <div class="playlist-owner">${playlist.owner.display_name}</div>
        `;
        div.onclick = () => onPlay(playlist.uri); // Simplification: playing playlist directly might need different API call depending on device, but uris: [uri] works for context_uri usually, let's keep it simple for now. Wait, context_uri is for playlists, uris is for tracks. Let's just alert for now or implement playContext later.
        container.appendChild(div);
    });
}

export function renderSearchResults(results, onPlayTrack) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';

    if (!results || !results.tracks || !results.tracks.items) return;

    results.tracks.items.forEach(track => {
        const div = document.createElement('div');
        div.className = 'track-item';
        div.innerHTML = `
            <img src="${track.album.images[0]?.url}" alt="${track.name}">
            <div class="track-item-info">
                <div class="track-item-title">${track.name}</div>
                <div class="track-item-artist">${track.artists.map(a => a.name).join(', ')}</div>
            </div>
        `;
        div.onclick = () => onPlayTrack(track.uri);
        container.appendChild(div);
    });
}

export function updatePlayerUI(state) {
    if (!state) return;

    const track = state.track_window.current_track;
    if (!track) return;

    // Bottom Player UI
    document.getElementById('player-art').src = track.album.images[0]?.url;
    document.getElementById('player-art').classList.remove('hidden');
    document.getElementById('player-title').textContent = track.name;
    document.getElementById('player-artist').textContent = track.artists.map(a => a.name).join(', ');

    // Modal UI
    const modalArt = document.getElementById('lyrics-modal-art');
    if (modalArt) modalArt.src = track.album.images[0]?.url;
    
    const modalTitle = document.getElementById('lyrics-modal-title');
    if (modalTitle) modalTitle.textContent = track.name;
    
    const modalArtist = document.getElementById('lyrics-modal-artist');
    if (modalArtist) modalArtist.textContent = track.artists.map(a => a.name).join(', ');

    // Play/Pause icon (Bottom Player)
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    
    // Play/Pause icon (Modal)
    const modalIconPlay = document.getElementById('lyrics-icon-play');
    const modalIconPause = document.getElementById('lyrics-icon-pause');
    
    if (state.paused) {
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
        if (modalIconPlay) modalIconPlay.classList.remove('hidden');
        if (modalIconPause) modalIconPause.classList.add('hidden');
    } else {
        iconPlay.classList.add('hidden');
        iconPause.classList.remove('hidden');
        if (modalIconPlay) modalIconPlay.classList.add('hidden');
        if (modalIconPause) modalIconPause.classList.remove('hidden');
    }

    // Extract dominant color for ambient bg (Simulated for now, a real implementation would use color-thief or similar)
    // We'll just change the gradient randomly or based on track ID hash for effect
    updateAmbientColor(track.id);
}

function updateAmbientColor(seedString) {
    // Simple hash to color
    let hash = 0;
    for (let i = 0; i < seedString.length; i++) {
        hash = seedString.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    const color = '#' + ('00000'.substring(0, 6 - c.length) + c);
    
    document.documentElement.style.setProperty('--accent-glow', `${color}66`); // 66 is alpha
    
    // Also update lyrics background if open
    const lyricsModal = document.getElementById('lyrics-modal');
    if (!lyricsModal.classList.contains('hidden')) {
        lyricsModal.style.background = `linear-gradient(to bottom, ${color}33, var(--bg-dark))`;
    }
}

export function toggleLyricsModal() {
    const modal = document.getElementById('lyrics-modal');
    modal.classList.toggle('hidden');
}
