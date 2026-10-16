import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';

test(
  'the generator worker returns request ids for consecutive tasks on one instance',
  { timeout: 10000 },
  async () => {
    const source = new URL(
      '../games/pupdoku/generator-worker.js',
      import.meta.url,
    );
    // Adapt the browser messaging surface while executing the real worker module.
    const worker = new Worker(
      `
    const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: (data) => parentPort.postMessage(data) };
    import(${JSON.stringify(source.href)}).then(() => {
      parentPort.on('message', (data) => self.onmessage({ data }));
    });
  `,
      { eval: true },
    );
    try {
      for (const [id, seed, size] of [
        [23, 7, 8],
        [24, 0, 9],
      ]) {
        const reply = once(worker, 'message');
        worker.postMessage({ id, seed });
        const [data] = await reply;
        assert.equal(data.id, id);
        assert.equal(data.error, undefined);
        assert.equal(data.puzzle.seed, seed);
        assert.equal(data.puzzle.size, size);
        assert.equal(data.puzzle.regions.length, size ** 2);
      }
    } finally {
      await worker.terminate();
    }
  },
);
