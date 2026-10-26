import { normalizeBasePath, nestStaticSite } from '../base-path.js';
import { statSync } from 'node:fs';
import { access, cp, readFile, readdir, rename, rmdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export function preserveGameUrls({ games, aliases = {} }) {
  const gamePattern = new RegExp(`^/(${games.join('|')})(?=/|$)`);
  let outDir, base;

  return {
    name: 'preserve-game-urls',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = normalizeBasePath(config.base);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        try {
          const segment = request.url?.match(/^\/([^/?]+)(?=\/|\?|$)/)?.[1];
          if (Object.hasOwn(aliases, segment)) {
            response.setHeader('Access-Control-Allow-Origin', '*');
            response.writeHead(308, { Location: request.url.replace(`/${segment}`, `/${aliases[segment]}`) });
            response.end();
            return;
          }
          if (request.url && gamePattern.test(request.url)) {
            const pathname = decodeURIComponent(request.url.split('?')[0]);
            const publicDir = server.config.publicDir;
            const publicFile = publicDir && resolve(publicDir, '.' + pathname);
            // Public game assets already have their production URLs. Rewrite
            // only source routes, leaving Vite to serve icons from public/.
            const isPublicFile =
              publicFile &&
              publicFile.startsWith(publicDir + sep) &&
              statSync(publicFile, { throwIfNoEntry: false })?.isFile();
            if (!isPublicFile)
              request.url = request.url.replace(gamePattern, '/games/$1');
          }
          next();
        } catch (error) {
          next(error);
        }
      });
    },
    async closeBundle() {
      const builtGamesDir = resolve(outDir, 'games');
      for (const game of games) {
        const sourceDir = resolve(builtGamesDir, game);
        const targetDir = resolve(outDir, game);

        try {
          await access(sourceDir);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          // Vite 8 writes HTML entries directly to dist/<game>; there is
          // nothing to move when this directory only contains emitted assets.
          continue;
        }

        let targetExists = true;
        try {
          await access(targetDir);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          targetExists = false;
        }

        if (!targetExists) {
          await rename(sourceDir, targetDir);
          continue;
        }

        for (const entry of await readdir(sourceDir)) {
          const sourceEntry = resolve(sourceDir, entry);
          const targetEntry = resolve(targetDir, entry);
          try {
            await access(targetEntry);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await rename(sourceEntry, targetEntry);
          }
        }
        await rmdir(sourceDir);
      }
      try {
        await rmdir(builtGamesDir);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        // The directory may not exist when Vite emitted all entries directly.
      }
      // Old manifests, Lua rules and relative art URLs remain loadable by
      // installed games; HTML entry points guide browsers to the new name.
      for (const [oldName, name] of Object.entries(aliases)) {
        const target = resolve(outDir, oldName);
        await cp(resolve(outDir, name), target, { recursive: true });
        const manifest = JSON.parse(await readFile(resolve(target, 'playweft.json'), 'utf8'));
        const title = (manifest.name_localized?.['zh-CN'] || manifest.name).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
        for (const page of ['index.html', 'help.html']) {
          const url = `../${name}/${page === 'index.html' ? '' : page}`;
          const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><link rel="canonical" href="${url}"><meta http-equiv="refresh" content="0;url=${url}"><script>location.replace(${JSON.stringify(url)}+location.search+location.hash)</script><a href="${url}">打开${title}</a></html>`;
          await writeFile(resolve(target, page), html);
        }
      }
      await nestStaticSite(outDir, base);
    },
  };
}
