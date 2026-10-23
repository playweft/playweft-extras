# Development and deployment

This guide covers local integration, static deployment, and adding games. Run all commands from the repository root.

## Development

Requires Node.js 22.12+:

```sh
npm ci
npm run dev
```

Open `http://localhost:9140/` to browse the games. In Playweft, enter `http://localhost:9140/light-trails/` or its `playweft.json` URL, then invite friends through the platform lobby. Port 9140 avoids a conflict with the `playweft-games` server on 9139.

Play Pupdoku directly at `http://localhost:9140/pupdoku/` or through Playweft's solo mode. Each level randomly generates an 8 × 8 to 12 × 12 board with connected colored regions and a unique solution, then advances automatically when completed. Click or drag to mark ×, double-click to place a pup, and lose a life for an incorrect placement. The game supports whole-stroke Undo, logical hints, and locally saved progress. See the [Pupdoku README](../games/pupdoku/README.md) for rules and the [technical notes](pupdoku.md) for implementation and maintenance.

Play Fuzzy Match 3 directly at `http://localhost:9140/fuzzy-match-3/` or through Playweft's solo mode. Desktop, tablet, and phone use their respective app-style layouts. Features include level progression, daily challenges, special pieces, hints, and local saves, without PWA installation or a Service Worker. See the [game README](../games/fuzzy-match-3/README.md) for rules and implementation.

To test Light Trails without starting the platform:

```sh
npm run dev:light-trails
```

Open `http://localhost:9139/__dev/?seat=1` and `?seat=2` in two visible windows; use `?seat=0` to spectate. Set another port with `PORT=9141 npm run dev:light-trails`. This tool executes the same Lua game script but is development-only: it does not provide platform authentication or room security boundaries and is excluded from production builds.

## Bubble Kick

Open `http://localhost:9140/bubble-kick/` for practice with bots or same-keyboard play. Room mode uses the packaged `game.lua` for 2–4 humans with spectators, alternating teams. Both solo and room modes are declared in its manifest. See the [game README](../games/bubble-kick/README.md) for controls, timing and synchronization.

## Local saves

Pupdoku and Fuzzy Match 3 use `src/game-storage.js`. Embedded games wait for
Playweft's `localStorage.*` bridge capabilities before loading progress; standalone
games use first-party IndexedDB. Both paths are asynchronous and serialize writes.
Deploy the platform storage API before deploying updated game clients. An older
platform reports an explicit unsupported-storage error instead of silently saving
to an iframe's temporary localStorage.

Existing localStorage data is imported once when the target key is absent. The
source is removed only after the copies and migration marker have committed.
Interrupted migrations resume, and existing destination saves take precedence.
Saves already removed by the browser cannot be recovered. Standalone and platform
saves belong to separate browser storage contexts and are not automatically synced.

Read failures preserve the original data and offer retry. Pupdoku coalesces queued
snapshots and Fuzzy Match 3 saves settled boards; write failures retain in-memory
progress and offer retry. Saving runs during play, rather than relying on unload.
Browser shutdown before an in-flight operation commits can still lose that latest
operation; successful commits persist independently of the game frame.

## Validation and build

```sh
npm run check
npm run build
```

`dist/` is a static site containing the homepage, `featured-games.json`, shared assets, and each game's `index.html`, `help.html`, `playweft.json`, and, where applicable, `game.lua`. Vite bundles client assets through one shared build pipeline.

Deploy `dist/` to a dedicated HTTPS static host. `public/_headers` configures CORS for featured-game listings and manifests; the platform server fetches Lua rules. Do not add an `X-Frame-Options` policy that blocks platform iframe embedding. Deployment accounts and credentials are not stored in this repository.

For Cloudflare Workers Builds, use the repository root and the deployment command `npx wrangler deploy`. The repository's `wrangler.jsonc` explicitly sets the static assets directory to `dist/` and runs `npm run build` before deployment, so the platform build-command field may be left empty. No Cloudflare Vite plugin or automatic rewrite of `vite.config.js` is required.

## Subpath deployment

With `BASE_PATH` unset, empty, or `/`, deployment uses the root path as before.

To deploy under `/extras/`, set this **build environment variable** in Cloudflare Workers Builds:

```text
BASE_PATH=/extras/
```

Rebuild and deploy with the same `npx wrangler deploy` command. This is a build parameter, not a Worker runtime variable, and requires no additional Worker code. Configure the `your-domain/extras/*` Route yourself. Open the homepage at `/extras/` with its trailing slash; that Route does not include the bare `/extras` path.

For local builds, run `BASE_PATH=/extras/ npm run build` or set the value in an uncommitted `.env.local`. Values `extras`, `/extras`, and `/extras/` normalize to `/extras/`. Nested paths such as `/games/extras/` also work. Only paths are accepted, not domains, query parameters, or `..`. This setting affects production builds only; `npm run dev` continues to use root paths.

The build updates asset URLs and manifest IDs and places the complete site in `dist/extras/`. Cloudflare's `_headers` remains at `dist/_headers`, with its internal matching rules prefixed automatically. Wrangler's `assets.directory` stays `./dist`; do not change it to `./dist/extras`. Each normal build clears the previous output, so switching prefixes or returning to the root leaves no stale directories.

| Entry          | Example path                         |
| -------------- | ------------------------------------ |
| Homepage       | `/extras/`                           |
| Featured games | `/extras/featured-games.json`        |
| Light Trails   | `/extras/light-trails/`              |
| Pupdoku        | `/extras/pupdoku/`                   |
| Fuzzy Match 3  | `/extras/fuzzy-match-3/`             |
| Game manifest  | `/extras/light-trails/playweft.json` |

## Project structure

```text
games/light-trails/       Game page, rendering, Lua rules, manifest, help
games/pupdoku/            Solo logic puzzle, unique-solution generation, Worker, manifest, help
games/bubble-kick/        Canvas stadium, local/bot rules, authoritative Lua room rules, manifest, help
games/fuzzy-match-3/      Responsive match-three, special pieces, levels, daily challenges, local progress
src/playweft-client.js    Shared MessageChannel / JSON-RPC client
public/                  Icons, featured-games.json, static response headers
build/vite/plugins/      Game package output and stable URL mapping
scripts/                 Development-only integration tools and Lua test adapters
tests/                   Rules, messaging, network integration, and package validation
vite.config.js           Shared multi-page build
```

To add a game, create `games/<name>/`, add its name to the `games` list in `vite.config.js`, and update the featured list and homepage. Each game maintains its own manifest version. After changing rules or parameters, bump the version and create a new room rather than changing a running match.

See the [Light Trails README](../games/light-trails/README.md) for its rules, synchronization model, and known limitations.
