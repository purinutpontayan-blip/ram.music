// src/spotify.js

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = window.location.origin;

// PKCE Utilities
function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export async function loginWithSpotify() {
    if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
        alert("Please set your Spotify Client ID in the .env file!");
        return;
    }

    const verifier = generateRandomString(128);
    const challenge = await generateCodeChallenge(verifier);

    localStorage.setItem('spotify_verifier', verifier);

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        scope: 'user-read-private user-read-email streaming user-read-playback-state user-modify-playback-state user-library-read'
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function handleRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
        // Clear the code from the URL
        window.history.replaceState({}, document.title, "/");
        
        const verifier = localStorage.getItem('spotify_verifier');
        const body = new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier
        });

        try {
            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body
            });

            if (!response.ok) {
                throw new Error('HTTP status ' + response.status);
            }
            const data = await response.json();
            localStorage.setItem('spotify_access_token', data.access_token);
            localStorage.setItem('spotify_refresh_token', data.refresh_token);
            return data.access_token;
        } catch (error) {
            console.error('Error fetching token:', error);
            return null;
        }
    }
    
    return localStorage.getItem('spotify_access_token');
}

export async function fetchWebApi(endpoint, method = 'GET', body) {
    const token = localStorage.getItem('spotify_access_token');
    const res = await fetch(`https://api.spotify.com/${endpoint}`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        method,
        body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 401) {
        // Token expired (ideally we should use refresh token here, keeping it simple for now)
        localStorage.removeItem('spotify_access_token');
        window.location.reload();
    }

    if (!res.ok) {
        if (res.status === 204) return null; // No content
        throw new Error(`API error: ${res.status}`);
    }

    return await res.json();
}

export async function getUserProfile() {
    return await fetchWebApi('v1/me');
}

export async function searchSpotify(query) {
    return await fetchWebApi(`v1/search?q=${encodeURIComponent(query)}&type=track,artist,album&limit=10`);
}

export async function getFeaturedPlaylists() {
    return await fetchWebApi('v1/browse/featured-playlists?limit=10');
}
