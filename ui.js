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
        div.oncontextmenu = (e) => {
            e.preventDefault();
            if (window.showTrackContextMenu) {
                window.showTrackContextMenu(e, track);
            }
        };
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
    if (modalArt) {
        modalArt.crossOrigin = 'anonymous';
        modalArt.src = track.album.images[0]?.url;
        // Extract real dominant color from album art
        modalArt.onload = () => extractAndApplyColor(modalArt);
        if (modalArt.complete && modalArt.naturalWidth > 0) extractAndApplyColor(modalArt);
    }
    
    const modalTitle = document.getElementById('lyrics-modal-title');
    if (modalTitle) {
        const titleText = track.name;
        // Duplicate text for seamless looping marquee
        modalTitle.innerHTML = `<span class="marquee-inner">${titleText}&nbsp;&nbsp;&nbsp;${titleText}</span>`;
        // Check overflow after paint
        requestAnimationFrame(() => {
            const inner = modalTitle.querySelector('.marquee-inner');
            if (inner && inner.scrollWidth > modalTitle.clientWidth * 2 + 1) {
                modalTitle.classList.add('is-overflow');
            } else {
                modalTitle.classList.remove('is-overflow');
                // If it fits, just show the title once cleanly
                modalTitle.innerHTML = `<span class="marquee-inner">${titleText}</span>`;
            }
        });
    }
    
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

function extractAndApplyColor(imgEl) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 50;
        canvas.height = 50;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, 0, 0, 50, 50);
        const data = ctx.getImageData(0, 0, 50, 50).data;

        // Sample pixels and find the most vibrant/saturated color
        let bestR = 30, bestG = 30, bestB = 30, bestSat = 0;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            const lum = (max + min) / 510;
            // Prefer vibrant (not too dark, not too bright, high saturation)
            if (sat > bestSat && lum > 0.1 && lum < 0.9) {
                bestSat = sat;
                bestR = r; bestG = g; bestB = b;
            }
        }

        const hex = '#' + [bestR, bestG, bestB].map(v => v.toString(16).padStart(2,'0')).join('');
        document.documentElement.style.setProperty('--accent-glow', `rgba(${bestR},${bestG},${bestB},0.4)`);
        document.documentElement.style.setProperty('--modal-bg-r', bestR);
        document.documentElement.style.setProperty('--modal-bg-g', bestG);
        document.documentElement.style.setProperty('--modal-bg-b', bestB);

        // Apply animated layered gradient to lyrics modal
        const modal = document.getElementById('lyrics-modal');
        if (modal) {
            modal.style.background = `
                radial-gradient(ellipse at 20% 20%, rgba(${bestR},${bestG},${bestB},0.55) 0%, transparent 60%),
                radial-gradient(ellipse at 80% 80%, rgba(${Math.round(bestR*0.6)},${Math.round(bestG*0.6)},${Math.round(bestB*1.4 > 255 ? 255 : bestB*1.4)},0.4) 0%, transparent 60%),
                var(--bg-dark)
            `;
        }
    } catch(e) {
        // Cross-origin fallback - keep existing gradient
        console.warn('Color extraction failed (CORS):', e);
    }
}

export function toggleLyricsModal() {
    const modal = document.getElementById('lyrics-modal');
    modal.classList.toggle('hidden');
}
