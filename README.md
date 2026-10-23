# Playweft Extras

A collection of browser games for [Playweft](https://github.com/longern/playweft), featuring solo logic puzzles and multiplayer games.

## Games

| Game                                         | Players            | Description                                                                       |
| -------------------------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| [Pupdoku](games/pupdoku/README.md)           | 1                  | Place one pup in each row, column, and colored region without letting them touch. |
| [Fuzzy Match 3](games/fuzzy-match-3/README.md)     | 1                  | Match six animal friends and trigger colorful cascades in solo levels and daily challenges. |
| [Light Trails](games/light-trails/README.md) | 2, with spectators | Steer clear of walls and trails to be the last player standing.                   |

| [Bubble Kick](games/bubble-kick/README.md) | 1–4, with spectators | Kick ticking bubbles, dodge cross-shaped blasts, and rescue teammates. |

## Getting started

Requires **Node.js 22.12 or later** and npm.

```sh
git clone https://github.com/playweft/playweft-extras.git
cd playweft-extras
npm ci
npm run dev
```

Open <http://localhost:9140/> to browse the games.

- Play Pupdoku directly at <http://localhost:9140/pupdoku/>.
- Play Fuzzy Match 3 directly at <http://localhost:9140/fuzzy-match-3/>.
- Play Bubble Kick directly at <http://localhost:9140/bubble-kick/> with bots or a second local player; use a Playweft room for 2–4 humans.
- Start a Light Trails match through a Playweft room. For local multiplayer testing, see the [development guide](docs/development.md).

## Development

```sh
npm run check  # Build and run all tests
npm run build # Build the static site
```

Game sources live in `games/`, shared messaging code in `src/`, static assets in `public/`, and tests in `tests/`.

## Deployment

Deploy `dist/` to an HTTPS static host. Playweft can load each game through its page URL or `playweft.json` manifest.

See the [deployment guide](docs/development.md) for Cloudflare Workers and subpath hosting.

## Contributing

Issues and pull requests are welcome. When reporting a bug, include steps to reproduce, browser details, and relevant screenshots or error logs.

Run `npm run check` before submitting changes. See the [development guide](docs/development.md) for the project structure and how to add a game.

## License

[MIT](LICENSE).
