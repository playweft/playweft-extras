# Pupdoku

A logic puzzle about finding a home for every pup on a colorful grid. Play with a mouse, touch, or keyboard, directly in your browser or through Playweft's solo mode.

## How to play

- Place exactly one pup in each row.
- Place exactly one pup in each column.
- Place exactly one pup in each colored region.
- Pups must not touch, including diagonally.

Each puzzle has a randomly generated board from 8 × 8 to 12 × 12, with a unique solution that can be found through logical deductions. Completing a puzzle automatically starts the next one. Progress is saved in your current browser. In Playweft, saves use the platform’s persistent-storage bridge; standalone play uses IndexedDB. Existing localStorage saves migrate automatically when still available.

## Controls

| Action                            | Result                                            |
| --------------------------------- | ------------------------------------------------- |
| Click or tap a cell               | Toggle an × mark                                  |
| Drag from an empty cell           | Mark cells with ×                                 |
| Drag from an × mark               | Erase marks                                       |
| Double-click or double-tap a cell | Place a pup; use Undo to remove it                |
| Undo                              | Undo the last action; a drag counts as one action |
| Hint                              | Apply the next logical step                       |

Each puzzle starts with three lives. An incorrect pup placement costs one life; × marks do not. Undo does not restore lives. If you run out of lives, restart the same puzzle to try again.

Use the arrow keys to move focus, Enter or Space to toggle a mark, X to toggle a mark, D to place a pup, and Delete or Backspace to clear a mark. Hold X while moving with the arrow keys to paint a continuous stroke: start on an empty cell to mark, or on an existing × to erase. Release X to finish; the whole stroke counts as one Undo action. Pups are skipped, and painting marks preserves red crosses.

## Running locally

Requires Node.js 22.12+. Run these commands from the repository root:

```sh
npm ci
npm run dev
```

Open <http://localhost:9140/pupdoku/>.

## Development

The interface uses Preact and the project builds with Vite. From the repository root:

```sh
npm run check
npm run build
```

- [Project README](../../README.md): overview and contribution guidelines.
- [Development and deployment](../../docs/development.md): local testing and hosting configuration.
- [Technical notes](../../docs/pupdoku.md): generator, solver, and maintenance tools.

## License

[MIT](../../LICENSE).
