# Tile Surge

## Run locally

Install Node.js, then from the project folder run:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`). The local preview uses the included fake Playground SDK, so it does not need access to the Playground host.

## PWA and GitHub Pages

The production build is configured for GitHub Pages at
`https://fschirrm.github.io/arcade/`. Publish the contents of `dist/` to that
location; the repository must have GitHub Pages configured separately.

To build and test the PWA locally:

```sh
npm run build
npm run preview
```

Open `http://localhost:4173/arcade/`. The service worker is enabled in the
production build, not the development server. Once the first online visit has
completed and the service worker has installed, the game, images, and music
are available offline. Use the browser's install option to add it as an app.
Installation requires HTTPS or localhost and a browser that supports PWAs.

Updates are downloaded in the background without interrupting a game. Close
all tabs and app windows for Tile Surge before reopening it to activate an
update. The local fake Playground SDK remains in use; actual Playground
services are not provided by the PWA.
