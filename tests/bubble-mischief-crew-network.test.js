import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";

test(
  "Bubble Mischief Crew room traverses the real bridge harness, synchronizes seats and stops stale movement",
  { timeout: 15000 },
  async () => {
    const child = spawn(process.execPath, ["scripts/dev.mjs"], {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, PORT: "0", DEV_GAME: "bubble-mischief-crew" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const clients = [];
    let errors = "";
    child.stderr.on("data", (d) => (errors += d));
    try {
      const address = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
          reject(new Error(`server ${code}: ${errors}`)),
        );
        child.stdout.on("data", (d) => {
          const p = String(d).match(/localhost:(\d+)/)?.[1];
          if (p) resolve(`http://127.0.0.1:${p}`);
        });
      });
      for (const path of [
        "/bubble-mischief-crew/",
        "/bubble-mischief-crew/main.js",
        "/bubble-mischief-crew/render.js",
        "/bubble-mischief-crew/game.js",
        "/bubble-mischief-crew/game.lua",
        "/bubble-mischief-crew/icon.svg",
      ])
        assert.equal((await fetch(address + path)).status, 200, path);
      assert.match(
        await (await fetch(address + "/__dev/")).text(),
        /src="\/bubble-mischief-crew\/"/,
      );
      const legacy = await fetch(address + '/bubble-kick/?invite=old', { redirect: 'manual' });
      assert.equal(legacy.status, 308);
      assert.equal(legacy.headers.get('location'), '/bubble-mischief-crew/?invite=old');
      assert.equal((await (await fetch(address + '/bubble-kick/playweft.json')).json()).name, 'Bubble Mischief Crew');
      function connect(seat) {
        const ws = new WebSocket(
            address.replace("http", "ws") + `/__dev/socket?seat=${seat}`,
          ),
          c = { ws, seq: 0, dir: -1, kick: false, snapshot: null, errors: [] };
        clients.push(c);
        ws.on("message", (d) => {
          const m = JSON.parse(String(d));
          if (m.type === "state") c.snapshot = m.params;
          if (m.type === "result" && (m.error || m.result.accepted === false))
            c.errors.push(m);
        });
        c.timer = seat
          ? setInterval(() => {
              if (ws.readyState === 1 && c.snapshot)
                ws.send(
                  JSON.stringify({
                    id: String(++c.seq),
                    action: {
                      type: "input",
                      round: c.snapshot.state.round,
                      seq: c.seq,
                      dir: c.dir,
                      kick: c.kick,
                    },
                  }),
                );
            }, 100)
          : null;
        return c;
      }
      async function until(fn, ms = 7000) {
        const end = Date.now() + ms;
        while (!fn()) {
          if (Date.now() > end) throw new Error("Timed out " + errors);
          await new Promise((r) => setTimeout(r, 25));
        }
      }
      const a = connect(1),
        b = connect(2),
        viewer = connect(0);
      await until(
        () =>
          a.snapshot?.state.phase === "playing" &&
          viewer.snapshot?.state.phase === "playing",
      );
      const original = a.snapshot.state.players[0].x;
      a.dir = 0;
      await until(() => a.snapshot.state.players[0].x > original, 1500);
      a.dir = -1;
      clearInterval(b.timer);
      await until(() => a.snapshot.state.phase === "paused", 3500);
      const frozen = a.snapshot.state.tick;
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(a.snapshot.state.tick, frozen);
      assert.deepEqual(a.errors, []);
      assert.deepEqual(b.errors, []);
      assert.equal(viewer.snapshot.state.phase, "paused");
      assert.equal(viewer.snapshot.state.players.length, 2);
    } finally {
      for (const c of clients) {
        clearInterval(c.timer);
        c.ws.terminate();
      }
      child.kill();
      await once(child, "exit");
    }
  },
);
