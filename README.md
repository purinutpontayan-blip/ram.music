# R Music

A beautiful, dynamic music web application utilizing the Spotify API and Apple Music-styled lyrics.

## Local Development

1. Run `npm install` to install dependencies.
2. Create a `.env` file in the root directory and add your Spotify Client ID:
   ```env
   VITE_SPOTIFY_CLIENT_ID=your_client_id_here
   ```
3. Run `npm run dev` to start the local development server.

## Deploying to Render (onrender.com)

Since this is a Vite-based single-page application (SPA), the best way to deploy to Render is as a **Static Site**.

Follow these steps:

1. **Push to GitHub**:
   Push this entire repository (excluding `node_modules` and `.env`) to your GitHub account.

2. **Connect to Render**:
   - Go to [onrender.com](https://onrender.com/) and log in.
   - Click on **New +** and select **Static Site**.
   - Connect your GitHub account and select the `r-music` repository.

3. **Configure the Render Service**:
   - **Name**: `r-music` (or whatever you prefer)
   - **Branch**: `main` (or `master`)
   - **Build Command**: `npm install && npm run build`
   - **Publish directory**: `dist`

4. **Environment Variables**:
   - Scroll down to the **Advanced** section.
   - Click **Add Environment Variable**.
   - Key: `VITE_SPOTIFY_CLIENT_ID`
   - Value: *(Paste your Spotify Client ID here)*

5. **Redirects (Important for SPA)**:
   - Go to the **Redirects/Rewrites** tab in Render after creating the site.
   - Add a rule:
     - Source: `/*`
     - Destination: `/index.html`
     - Action: `Rewrite`
   - This ensures that if you refresh the page, it routes correctly instead of showing a 404 error.

6. **Deploy**:
   - Click **Create Static Site**.
   - Render will build and deploy your site!

### Spotify Dashboard Configuration Update
Once Render gives you your live URL (e.g., `https://r-music.onrender.com`), you **must** go back to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):
1. Open your App settings.
2. Add your new live URL to the **Redirect URIs** list (e.g., `https://r-music.onrender.com`).
3. Save the changes. If you don't do this, login will fail on the live site!
