# Power Island

A browser strategy game for **1v1** and **2v2**, built with TypeScript, React, Canvas and an authoritative Node.js + Socket.IO server. The player interface is English.

## Run locally

Requires Node.js 22 or a newer compatible version.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173` in separate tabs for each player. The backend uses port 3001. Home also offers **Play tutorial**, a solo practice match on a fixed island with a stationary opponent and optional map guidance.

```sh
npm run check
npm test
npm run build
npm start
```

The production server serves the built frontend and Socket.IO. Configure `HOST`, `PORT`, `MAX_ROOMS` and `ALLOWED_ORIGINS` through the environment. For a separately hosted frontend, set `VITE_SERVER_URL` when building. Rooms and anonymous sessions are in memory; restarting the server ends matches.

## Browser verification

```sh
PLAYWRIGHT_BROWSERS_PATH=./work/browsers npx playwright install chromium
npm run dev
# In another terminal:
npm run test:browser
```

Stop development services after testing. External deployment validation is manual and requires `TEST_SERVER_URL`; optionally set `TEST_ALLOWED_ORIGIN`. See [verification status](outputs/development_status.md).

## Project guide

- [Game rules](core_game_spec.md): the single current specification, v0.8.
- [Collaboration guide](AGENTS.md): implementation and verification conventions.
- [Documentation index](outputs/README.md): current status and evidence.

Source lives in `src/shared`, `src/server` and `src/client`; tests are under `tests`. Generated builds, dependencies, private operations records and publishing checkouts are excluded from Git.
