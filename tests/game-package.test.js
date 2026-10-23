import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, createServer, preview } from 'vite';
import { normalizeBasePath } from '../build/vite/base-path.js';

const root = resolve(import.meta.dirname, '..');

test('Vite emits independent game package at /light-trails/ with resolvable assets', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'playweft-extras-build-'));
  try {
    await build({
      root,
      base: '/',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
    const manifest = JSON.parse(
      await readFile(join(outDir, 'light-trails/playweft.json'), 'utf8'),
    );
    assert.equal(manifest.id, '/light-trails/');
    assert.equal(manifest.modes.room.server.persistence, 'live');
    const list = JSON.parse(
      await readFile(join(outDir, 'featured-games.json'), 'utf8'),
    );
    assert.deepEqual(list, [
      { manifestUrl: './light-trails/playweft.json' },
      { manifestUrl: './pupdoku/playweft.json' },
      { manifestUrl: './fuzzy-match-3/playweft.json' },
      { manifestUrl: './bubble-kick/playweft.json' },
    ]);
    const kick = JSON.parse(await readFile(join(outDir, 'bubble-kick/playweft.json'), 'utf8'));
    assert.equal(kick.id, '/bubble-kick/');
    assert.equal(kick.orientation, 'landscape');
    assert.deepEqual(kick.modes.room.players, { min: 2, max: 4 });
    assert.deepEqual(kick.modes.solo, {});
    assert.equal(await readFile(join(outDir, 'bubble-kick/game.lua'), 'utf8'), await readFile(join(root, 'games/bubble-kick/game.lua'), 'utf8'));
    const solo = JSON.parse(
      await readFile(join(outDir, 'pupdoku/playweft.json'), 'utf8'),
    );
    assert.equal(solo.id, '/pupdoku/');
    assert.deepEqual(solo.modes, { solo: {} });
    const piece = JSON.parse(await readFile(join(outDir, 'fuzzy-match-3/playweft.json'), 'utf8'));
    assert.equal(piece.id, '/fuzzy-match-3/');
    assert.equal(piece.name, 'Fuzzy Match 3');
    assert.equal(piece.name_localized['zh-CN'], '绒绒消消乐');
    assert.deepEqual(piece.modes, { solo: {} });
    for (const family of ['Fredoka', 'ZCOOL-KuaiLe']) {
      const font = await readFile(join(outDir, 'fuzzy-match-3/fonts', family + '.woff2'));
      assert.equal(font.subarray(0, 4).toString(), 'wOF2');
      const license = await readFile(join(outDir, 'fuzzy-match-3/fonts', family + '-OFL.txt'), 'utf8');
      assert.match(license, /Copyright/);
      assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
    }
    for (const [game, metadata] of [
      ['light-trails', manifest],
      ['pupdoku', solo],
      ['fuzzy-match-3', piece],
    ]) {
      assert.equal(metadata.icons[0].src, './icon.svg');
      assert.equal(
        await readFile(join(outDir, game, 'icon.svg'), 'utf8'),
        await readFile(join(root, 'public', game, 'icon.svg'), 'utf8'),
      );
      await assert.rejects(access(join(outDir, game + '.svg')));
    }
    for (const entry of [solo.start_url, solo.help_url, solo.icons[0].src]) {
      let path = new URL(entry, 'https://games.example/pupdoku/playweft.json')
        .pathname;
      if (path.endsWith('/')) path += 'index.html';
      await access(join(outDir, path));
    }
    const base = new URL('https://games.example/light-trails/playweft.json');
    for (const entry of [
      manifest.start_url,
      manifest.help_url,
      manifest.icons[0].src,
      manifest.modes.room.server.entry,
    ]) {
      let path = new URL(entry, base).pathname;
      if (path.endsWith('/')) path += 'index.html';
      await access(join(outDir, path));
    }
    for (const page of [
      'index.html',
      'light-trails/index.html',
      'pupdoku/index.html',
      'pupdoku/help.html',
      'fuzzy-match-3/index.html',
      'fuzzy-match-3/help.html',
      'bubble-kick/index.html',
      'bubble-kick/help.html',
    ]) {
      const html = await readFile(join(outDir, page), 'utf8');
      for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        if (url.startsWith('http') || url.startsWith('data:')) continue;
        let path = new URL(url, `https://games.example/${page}`).pathname;
        if (path.endsWith('/')) path += 'index.html';
        await access(join(outDir, path));
      }
    }
    const rules = await readFile(
      join(root, 'games/light-trails/game.lua'),
      'utf8',
    );
    assert.equal(
      await readFile(join(outDir, 'light-trails/game.lua'), 'utf8'),
      rules,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('Vite serves stable game URLs, raw Lua and cross-origin manifests during development', async () => {
  // HTTP probes do not execute the browser import graph, so disable the
  // dependency crawler that otherwise waits for that graph before shutdown.
  const server = await createServer({
    root,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const path of [
      '/light-trails/',
      '/light-trails/main.js',
      '/light-trails/styles.css',
      '/light-trails/help.html',
      '/light-trails/icon.svg',
      '/pupdoku/',
      '/pupdoku/main.js',
      '/pupdoku/app.jsx',
      '/pupdoku/controller.js',
      '/pupdoku/colors.js',
      '/pupdoku/puzzle.js',
      '/pupdoku/generator-worker.js',
      '/pupdoku/styles.css',
      '/pupdoku/help.html',
      '/pupdoku/icon.svg',
      '/fuzzy-match-3/',
      '/fuzzy-match-3/main.js',
      '/fuzzy-match-3/app.jsx',
      '/fuzzy-match-3/game.js',
      '/fuzzy-match-3/art.jsx',
      '/fuzzy-match-3/styles.css',
      '/fuzzy-match-3/help.html',
      '/fuzzy-match-3/icon.svg',
      '/bubble-kick/',
      '/bubble-kick/main.js',
      '/bubble-kick/game.js',
      '/bubble-kick/movement.js',
      '/bubble-kick/bomb-rules.js',
      '/bubble-kick/render.js',
      '/bubble-kick/art.js',
      '/bubble-kick/art/hero-walk.png',
      '/bubble-kick/art/hero-walk.json',
      '/bubble-kick/art/stadium.png',
      '/bubble-kick/touch-controls.js',
      '/bubble-kick/styles.css',
      '/bubble-kick/help.html',
      '/bubble-kick/icon.svg',
    ]) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    for (const game of ['light-trails', 'pupdoku', 'fuzzy-match-3', 'bubble-kick']) {
      const response = await fetch(base + `/${game}/icon.svg?v=1`);
      assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
      assert.equal(
        await response.text(),
        await readFile(join(root, 'public', game, 'icon.svg'), 'utf8'),
      );
    }
    const manifest = await fetch(base + '/light-trails/playweft.json', {
      headers: { Origin: 'https://play.longern.com' },
    });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get('access-control-allow-origin'), '*');
    assert.equal((await manifest.json()).id, '/light-trails/');
    const solo = await fetch(base + '/pupdoku/playweft.json', {
      headers: { Origin: 'https://play.longern.com' },
    });
    assert.equal(solo.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual((await solo.json()).modes, { solo: {} });
    const lua = await fetch(base + '/light-trails/game.lua');
    assert.equal(
      await lua.text(),
      await readFile(join(root, 'games/light-trails/game.lua'), 'utf8'),
    );
  } finally {
    await server.close();
  }
});

test('BASE_PATH builds root or nested static sites and removes output from the previous path', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'playweft-extras-base-'));
  const saved = process.env.BASE_PATH;
  let previous;
  try {
    for (const value of [undefined, '/extras/', '/games/extras/', '']) {
      if (value === undefined) delete process.env.BASE_PATH;
      else process.env.BASE_PATH = value;
      await build({
        root,
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true },
      });
      const base = normalizeBasePath(value),
        dir = join(outDir, base);
      if (previous)
        await assert.rejects(access(join(outDir, previous, 'index.html')));
      previous = base;
      const manifest = JSON.parse(
        await readFile(join(dir, 'light-trails/playweft.json'), 'utf8'),
      );
      assert.equal(manifest.id, base + 'light-trails/');
      const solo = JSON.parse(
        await readFile(join(dir, 'pupdoku/playweft.json'), 'utf8'),
      );
      assert.equal(solo.id, base + 'pupdoku/');
      const piece = JSON.parse(await readFile(join(dir, 'fuzzy-match-3/playweft.json'), 'utf8'));
      assert.equal(piece.id, base + 'fuzzy-match-3/');
      assert.deepEqual(piece.modes, { solo: {} });
      const kick = JSON.parse(await readFile(join(dir, 'bubble-kick/playweft.json'), 'utf8'));
      assert.equal(kick.id, base + 'bubble-kick/');
      await access(join(dir, 'bubble-kick/game.lua'));
      for (const asset of ['hero-walk.png', 'hero-walk.json', 'stadium.png']) {
        await access(join(dir, 'bubble-kick/art', asset));
      }
      for (const [game, metadata] of [
        ['light-trails', manifest],
        ['pupdoku', solo],
        ['fuzzy-match-3', piece],
        ['bubble-kick', kick],
      ]) {
        const iconPath = new URL(
          metadata.icons[0].src,
          'https://games.example' + base + game + '/playweft.json',
        ).pathname;
        assert.equal(iconPath, base + game + '/icon.svg');
        await access(join(outDir, iconPath));
        await assert.rejects(access(join(dir, game + '.svg')));
      }
      const manifestUrl = new URL(
        base + 'light-trails/playweft.json',
        'https://games.example',
      );
      for (const entry of [
        manifest.start_url,
        manifest.help_url,
        manifest.icons[0].src,
        manifest.modes.room.server.entry,
      ]) {
        let path = new URL(entry, manifestUrl).pathname;
        assert.ok(path.startsWith(base));
        if (path.endsWith('/')) path += 'index.html';
        await access(join(outDir, path));
      }
      for (const page of [
        'index.html',
        'light-trails/index.html',
        'light-trails/help.html',
        'pupdoku/index.html',
        'pupdoku/help.html',
        'fuzzy-match-3/index.html',
        'fuzzy-match-3/help.html',
      'bubble-kick/index.html',
      'bubble-kick/help.html',
      ]) {
        const html = await readFile(join(dir, page), 'utf8');
        for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
          if (/^(https?:|data:)/.test(url)) continue;
          let path = new URL(url, 'https://games.example' + base + page)
            .pathname;
          assert.ok(path.startsWith(base), url);
          if (path.endsWith('/')) path += 'index.html';
          await access(join(outDir, path));
        }
      }
      const featured = JSON.parse(
        await readFile(join(dir, 'featured-games.json'), 'utf8'),
      );
      assert.equal(
        new URL(featured[0].manifestUrl, 'https://games.example' + base)
          .pathname,
        manifestUrl.pathname,
      );
      assert.equal(
        new URL(featured[1].manifestUrl, 'https://games.example' + base)
          .pathname,
        base + 'pupdoku/playweft.json',
      );
      const headers = await readFile(join(outDir, '_headers'), 'utf8');
      assert.ok(headers.includes(base + ':game/playweft.json'));
      assert.ok(headers.includes(base + 'featured-games.json'));
      assert.ok(headers.includes(base + ':game/icon.svg'));
      assert.ok(headers.includes('Access-Control-Allow-Origin: *'));
      if (base !== '/') await assert.rejects(access(join(dir, '_headers')));
      const server = await preview({
        root,
        base: '/',
        logLevel: 'silent',
        build: { outDir },
        preview: { host: '127.0.0.1', port: 0 },
      });
      try {
        const response = await fetch(
          `http://127.0.0.1:${server.httpServer.address().port}${base}light-trails/playweft.json`,
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).id, manifest.id);
      } finally {
        await new Promise((resolve) => server.httpServer.close(resolve));
      }
    }
    assert.equal(
      JSON.parse(
        await readFile(join(root, 'games/light-trails/playweft.json'), 'utf8'),
      ).id,
      '/light-trails/',
      'source manifest remains portable',
    );
    assert.equal(
      JSON.parse(
        await readFile(join(root, 'games/pupdoku/playweft.json'), 'utf8'),
      ).id,
      '/pupdoku/',
      'solo source manifest remains portable',
    );
  } finally {
    if (saved === undefined) delete process.env.BASE_PATH;
    else process.env.BASE_PATH = saved;
    await rm(outDir, { recursive: true, force: true });
  }
});

test('BASE_PATH normalizes simple prefixes and rejects unsafe or ambiguous locations', () => {
  for (const value of ['extras', '/extras', '/extras/'])
    assert.equal(normalizeBasePath(value), '/extras/');
  for (const value of [
    '../outside',
    '/a/../b',
    'https://example.com/extras',
    '//example.com',
    '/a//b',
    '/a?b',
    '/a#b',
    '/%2e%2e/',
    '/_headers/',
  ]) {
    assert.throws(() => normalizeBasePath(value), /BASE_PATH/);
  }
});
