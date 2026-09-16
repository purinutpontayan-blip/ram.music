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
        player.addListener('initialization_error', ({ message }) => { console.error(message); });
        player.addListener('authentication_error', ({ message }) => { console.error(message); });
        player.addListener('account_error', ({ message }) => { console.error(message); });
        player.addListener('playback_error', ({ message }) => { console.error(message); });

        // Playback status updates
        player.addListener('player_state_changed', state => {
            if (onStateChange) onStateChange(state);
        });

        // Ready
        player.addListener('ready', ({ device_id }) => {
            console.log('Ready with Device ID', device_id);
            deviceId = device_id;
            // Transfer playback to this device automatically
            transferPlaybackHere(device_id);
            if (onReady) onReady();
        });

        // Not Ready
        player.addListener('not_ready', ({ device_id }) => {
            console.log('Device ID has gone offline', device_id);
        });

        // Connect to the player!
        player.connect();
    };
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
    if (!deviceId) return;
    try {
        await fetchWebApi(`v1/me/player/play?device_id=${deviceId}`, 'PUT', {
            uris: [uri]
        });
    } catch (e) {
        console.error("Error playing track", e);
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
