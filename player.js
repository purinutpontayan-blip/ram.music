// src/player.js

import { fetchWebApi } from './spotify.js';

let player;
let deviceId;

export function initSpotifyPlayer(token, onStateChange, onReady) {
    window.onSpotifyWebPlaybackSDKReady = () => {
        player = new Spotify.Player({
            name: 'R Music Web Player',
            getOAuthToken: cb => { cb(token); },
            volume: 0.5
        });

        // Error handling
        player.addListener('initialization_error', ({ message }) => {
            console.error('Init error:', message);
            showToast('❌ ไม่สามารถเริ่ม Player ได้: ' + message, 'error');
        });
        player.addListener('authentication_error', ({ message }) => {
            console.error('Auth error:', message);
            showToast('❌ Authentication ล้มเหลว กรุณาล็อกอินใหม่', 'error');
        });
        player.addListener('account_error', ({ message }) => {
            console.error('Account error:', message);
            showPremiumRequiredModal();
        });
        player.addListener('playback_error', ({ message }) => {
            console.error('Playback error:', message);
            showToast('❌ เกิดข้อผิดพลาดในการเล่นเพลง', 'error');
        });

        // Playback status updates
        player.addListener('player_state_changed', state => {
            if (onStateChange) onStateChange(state);
        });

        // Ready
        player.addListener('ready', ({ device_id }) => {
            console.log('Ready with Device ID', device_id);
            deviceId = device_id;
            transferPlaybackHere(device_id);
            if (onReady) onReady();
        });

        // Not Ready
        player.addListener('not_ready', ({ device_id }) => {
            console.log('Device ID has gone offline', device_id);
            showToast('⚠️ Player ออฟไลน์ กรุณารีเฟรชหน้าเว็บ', 'warning');
        });

        player.connect();
    };
}

function showPremiumRequiredModal() {
    // Remove existing modal if any
    const existing = document.getElementById('premium-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'premium-modal';
    modal.innerHTML = `
        <div class="premium-modal-backdrop"></div>
        <div class="premium-modal-card glass-panel">
            <div class="premium-icon">🎵</div>
            <h2>ต้องใช้ Spotify Premium</h2>
            <p>R Music ใช้ Spotify Web Playback SDK ซึ่ง<strong>ต้องการบัญชี Spotify Premium</strong> เพื่อเล่นเพลงบนเว็บบราวเซอร์ครับ</p>
            <div class="premium-features">
                <div class="premium-feature">✅ ฟังเพลงแบบไม่มีโฆษณา</div>
                <div class="premium-feature">✅ เล่นเพลงผ่านเว็บบราวเซอร์</div>
                <div class="premium-feature">✅ ดูเนื้อเพลงแบบ Sync</div>
            </div>
            <div class="premium-actions">
                <a href="https://www.spotify.com/premium/" target="_blank" class="btn-premium">
                    อัปเกรดเป็น Premium
                </a>
                <button class="btn-dismiss" onclick="document.getElementById('premium-modal').remove()">
                    ปิด
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Add styles dynamically
    if (!document.getElementById('premium-modal-styles')) {
        const style = document.createElement('style');
        style.id = 'premium-modal-styles';
        style.textContent = `
            #premium-modal {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                z-index: 1000; display: flex; align-items: center; justify-content: center;
                animation: fadeIn 0.3s ease;
            }
            .premium-modal-backdrop {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.7); backdrop-filter: blur(5px);
            }
            .premium-modal-card {
                position: relative; z-index: 1; padding: 3rem; border-radius: 24px;
                text-align: center; max-width: 420px; width: 90%;
                box-shadow: 0 30px 60px rgba(0,0,0,0.5);
                animation: slideUp 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
            }
            @keyframes slideUp {
                from { transform: translateY(30px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            .premium-icon { font-size: 3rem; margin-bottom: 1rem; }
            .premium-modal-card h2 {
                font-size: 1.6rem; margin-bottom: 1rem;
                background: linear-gradient(135deg, #1db954, #1ed760);
                -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            }
            .premium-modal-card p { color: #a0a0a5; line-height: 1.6; margin-bottom: 1.5rem; }
            .premium-modal-card p strong { color: #fff; }
            .premium-features { margin-bottom: 2rem; display: flex; flex-direction: column; gap: 0.5rem; }
            .premium-feature { color: #ccc; font-size: 0.95rem; }
            .premium-actions { display: flex; flex-direction: column; gap: 1rem; }
            .btn-premium {
                background: #1db954; color: white; border: none; padding: 1rem 2rem;
                border-radius: 30px; font-size: 1rem; font-weight: 700; cursor: pointer;
                text-decoration: none; display: block;
                transition: background 0.2s, transform 0.2s;
                box-shadow: 0 4px 15px rgba(29,185,84,0.4);
            }
            .btn-premium:hover { background: #1ed760; transform: translateY(-2px); }
            .btn-dismiss {
                background: rgba(255,255,255,0.1); color: #a0a0a5; border: none;
                padding: 0.75rem; border-radius: 12px; font-size: 0.9rem; cursor: pointer;
                font-family: inherit; transition: background 0.2s;
            }
            .btn-dismiss:hover { background: rgba(255,255,255,0.2); }
        `;
        document.head.appendChild(style);
    }
}

export function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            .toast {
                position: fixed; bottom: 110px; left: 50%; transform: translateX(-50%);
                padding: 1rem 2rem; border-radius: 12px; font-weight: 600;
                backdrop-filter: blur(10px); z-index: 500;
                animation: toastIn 0.3s ease, toastOut 0.3s ease 2.7s forwards;
                white-space: nowrap; font-family: 'Outfit', sans-serif;
            }
            .toast-error { background: rgba(220, 50, 50, 0.85); color: white; }
            .toast-warning { background: rgba(220, 150, 30, 0.85); color: white; }
            .toast-info { background: rgba(29, 185, 84, 0.85); color: white; }
            @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
            @keyframes toastOut { from { opacity: 1; } to { opacity: 0; } }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

async function transferPlaybackHere(device_id) {
    try {
        await fetchWebApi('v1/me/player', 'PUT', {
            device_ids: [device_id],
            play: false,
        });
    } catch (e) {
        console.error("Failed to transfer playback", e);
    }
}

export async function playTrack(uri) {
    if (!deviceId) {
        showToast('⚠️ Player ยังไม่พร้อม กรุณารอสักครู่', 'warning');
        return;
    }
    try {
        await fetchWebApi(`v1/me/player/play?device_id=${deviceId}`, 'PUT', {
            uris: [uri]
        });
    } catch (e) {
        console.error("Error playing track", e);
        showToast('❌ ไม่สามารถเล่นเพลงนี้ได้', 'error');
    }
}

export function togglePlay() {
    if (player) player.togglePlay();
}

export function nextTrack() {
    if (player) player.nextTrack();
}

export function previousTrack() {
    if (player) player.previousTrack();
}

export async function getCurrentState() {
    if (player) return await player.getCurrentState();
    return null;
}
