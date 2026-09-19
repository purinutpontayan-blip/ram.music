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

export function renderHistory(historyData, onPlayTrack) {
    const container = document.getElementById('history-grid');
    container.innerHTML = '';

    if (!historyData || !historyData.items) return;

    // Remove duplicates from history
    const uniqueTracks = [];
    const uris = new Set();
    for (const item of historyData.items) {
        if (!uris.has(item.track.uri)) {
            uris.add(item.track.uri);
            uniqueTracks.push(item.track);
        }
    }

    uniqueTracks.slice(0, 12).forEach(track => {
        if (!track) return;
        const div = document.createElement('div');
        div.className = 'history-card playlist-card';
        div.innerHTML = `
            <img src="${track.album.images[0]?.url}" alt="${track.name}">
            <div class="playlist-title">${track.name}</div>
            <div class="playlist-owner">${track.artists.map(a => a.name).join(', ')}</div>
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

export function renderSearchResults(results, onPlayTrack, onArtistClick) {
    const container = document.getElementById('search-results');
    const artistsContainer = document.getElementById('search-artists');
    container.innerHTML = '';
    artistsContainer.innerHTML = '';

    if (!results) return;

    if (results.artists && results.artists.items) {
        results.artists.items.slice(0, 5).forEach(artist => {
            const div = document.createElement('div');
            div.className = 'artist-card playlist-card';
            const imgUrl = artist.images && artist.images[0] ? artist.images[0].url : 'https://i.scdn.co/image/ab6761610000e5eb55d39ab9c21d506aa52f7021';
            div.innerHTML = `
                <img src="${imgUrl}" alt="${artist.name}" style="border-radius: 50%;">
                <div class="playlist-title" style="text-align: center; margin-top: 10px;">${artist.name}</div>
            `;
            div.onclick = () => onArtistClick(artist.id);
            artistsContainer.appendChild(div);
        });
    }

    if (results.tracks && results.tracks.items) {
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
}

export function renderArtistView(artist, topTracks, albums, onPlayTrack) {
    const header = document.getElementById('artist-header');
    const imgUrl = artist.images && artist.images[0] ? artist.images[0].url : 'https://i.scdn.co/image/ab6761610000e5eb55d39ab9c21d506aa52f7021';
    header.innerHTML = `
        <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 30px;">
            <img src="${imgUrl}" alt="${artist.name}" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
            <div>
                <h1 style="font-size: 3rem; margin: 0;">${artist.name}</h1>
                <p style="color: var(--text-secondary); margin-top: 10px;">${artist.followers.total.toLocaleString()} followers</p>
            </div>
        </div>
    `;

    const tracksContainer = document.getElementById('artist-top-tracks');
    tracksContainer.innerHTML = '';
    if (topTracks && topTracks.tracks) {
        topTracks.tracks.slice(0, 5).forEach(track => {
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
            tracksContainer.appendChild(div);
        });
    }

    const albumsContainer = document.getElementById('artist-albums');
    albumsContainer.innerHTML = '';
    if (albums && albums.items) {
        albums.items.forEach(album => {
            const div = document.createElement('div');
            div.className = 'album-card playlist-card';
            div.innerHTML = `
                <img src="${album.images[0]?.url}" alt="${album.name}">
                <div class="playlist-title">${album.name}</div>
                <div class="playlist-owner">${new Date(album.release_date).getFullYear()} • ${album.album_type}</div>
            `;
            // Simplified album play (can trigger play context if implemented)
            div.onclick = () => {
                // If we want to play album, we can call playTrack(album.uri) but context uri is needed.
                // We'll just alert for now or implement play context.
                if (window.playContext) {
                    window.playContext(album.uri);
                } else {
                    alert("Playing albums not fully implemented yet.");
                }
            };
            albumsContainer.appendChild(div);
        });
    }
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

    // Color applied via modalArt.onload -> extractAndApplyColor
}

function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0)*255), Math.round(f(8)*255), Math.round(f(4)*255)];
}

function rgbToHue(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    if (max !== min) {
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return Math.round(h * 360);
}

function applyColorToModal(r, g, b) {
    document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.4)`);
    const modal = document.getElementById('lyrics-modal');
    if (!modal) return;

    // Derive a second contrasting hue
    const [r2, g2, b2] = hslToRgb(((rgbToHue(r,g,b) + 150) % 360), 65, 40);

    // Set CSS vars for animations
    modal.style.setProperty('--blob1', `rgba(${r},${g},${b},0.6)`);
    modal.style.setProperty('--blob2', `rgba(${r2},${g2},${b2},0.5)`);
    modal.style.setProperty('--blob3', `rgba(${Math.round(r*0.5)},${Math.round(g*0.7)},${Math.round(b*0.5)},0.35)`);
    modal.style.backgroundColor = 'var(--bg-dark)';
    modal.style.backgroundImage = '';

    // Ensure blob layer exists
    let blobLayer = modal.querySelector('.modal-blobs');
    if (!blobLayer) {
        blobLayer = document.createElement('div');
        blobLayer.className = 'modal-blobs';
        blobLayer.innerHTML = `
            <div class="blob blob-1"></div>
            <div class="blob blob-2"></div>
            <div class="blob blob-3"></div>
        `;
        modal.insertBefore(blobLayer, modal.firstChild);
    }
}

function extractAndApplyColor(imgEl) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 50;
        canvas.height = 50;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, 0, 0, 50, 50);
        const data = ctx.getImageData(0, 0, 50, 50).data;

        let bestR = 30, bestG = 30, bestB = 30, bestSat = 0;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            const lum = (max + min) / 510;
            if (sat > bestSat && lum > 0.1 && lum < 0.9) {
                bestSat = sat;
                bestR = r; bestG = g; bestB = b;
            }
        }
        applyColorToModal(bestR, bestG, bestB);
    } catch(e) {
        console.warn('Color extraction failed (CORS), using fallback palette');
        // Fallback: derive a pleasant color from the image src URL hash
        const src = imgEl.src || '';
        let hash = 0;
        for (let i = 0; i < src.length; i++) hash = src.charCodeAt(i) + ((hash << 5) - hash);
        const hue = Math.abs(hash) % 360;
        const [r, g, b] = hslToRgb(hue, 65, 45);
        applyColorToModal(r, g, b);
    }
}

export function toggleLyricsModal() {
    const modal = document.getElementById('lyrics-modal');
    const isHidden = modal.classList.contains('hidden');
    
    // If closing while in fullscreen, exit fullscreen first
    if (!isHidden && document.fullscreenElement) {
        document.exitFullscreen().then(() => {
            modal.classList.add('hidden');
        }).catch(() => {
            modal.classList.add('hidden');
        });
        return;
    }
    modal.classList.toggle('hidden');
}

export function showToast(message, type = 'info') {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    toastContainer.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
