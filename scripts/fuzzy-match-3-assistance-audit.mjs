/** Offline experiment. Production gameplay and save data are never modified. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(self), "..");
export const PROBABILITIES = [1 / 6, 0.15, 0.135, 0.12, 0.11, 0.1];
export const LEVELS = [297, 298, 299, 296, 305, 290, 295, 300];
export const SOURCE_FILES = [
  "games/fuzzy-match-3/constants.js",
  "games/fuzzy-match-3/assistance.js",
  "games/fuzzy-match-3/objectives.js",
  "games/fuzzy-match-3/game.js",
  "scripts/fuzzy-match-3-ai.mjs",
  "scripts/fuzzy-match-3-balance.mjs",
];

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error(`Audit hook no longer matches exactly once: ${before}`);
  return source.replace(before, after);
}

export function prepareRuntime(root, from = sourceRoot) {
  for (const file of SOURCE_FILES) {
    if (file.endsWith("/assistance.js") && !fs.existsSync(path.join(from, file))) continue;
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(from, file), destination);
  }
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  const enginePath = path.join(root, "games/fuzzy-match-3/game.js");
  let engine = fs.readFileSync(enginePath, "utf8");
  const hook = `
// Isolated audit only: one fixed reduced type per game; openings remain unchanged.
let trialType = 0;
const trialProbability = JSON.parse(process.env.FUZZY_CHALLENGE_TRIAL || '{}').probability ?? (1 / TYPE_COUNT);
export function setTrialType(type) { trialType = type; }
function trialIncoming(random) {
  const value = random();
  if (trialProbability === 1 / TYPE_COUNT) return Math.floor(value * TYPE_COUNT);
  let cumulative = 0;
  for (let type = 0; type < TYPE_COUNT; type++) {
    cumulative += type === trialType ? trialProbability : (1 - trialProbability) / (TYPE_COUNT - 1);
    if (value < cumulative || type === TYPE_COUNT - 1) return type;
  }
}
`;
  engine = replaceOnce(engine, "let nextId = 0;", hook + "\nlet nextId = 0;");
  engine = replaceOnce(engine, "return tile(Math.floor(random() * TYPE_COUNT));", "return tile(trialIncoming(random));");
  fs.writeFileSync(enginePath, engine);
  const auditPath = path.join(root, "scripts/fuzzy-match-3-balance.mjs");
  let audit = fs.readFileSync(auditPath, "utf8");
  audit = replaceOnce(audit, "  createGame,", "  createGame,\n  setTrialType,");
  audit = replaceOnce(audit, "  const game = createGame(", `  const eligible = Array.from({ length: 6 }, (_, type) => type).filter(type => config.goalKind !== 'collect' || type !== config.targetType);
  const reducedType = eligible[Math.floor(seededRandom(seed ^ 0x71a55c)() * eligible.length)];
  setTrialType(reducedType);
  const game = createGame(`);
  audit = replaceOnce(audit, "    won: game.status", "    seed,\n    reducedType,\n    won: game.status");
  audit = replaceOnce(audit, "    level,\n    daily,\n    strategy,\n    games,", "    results,\n    level,\n    daily,\n    strategy,\n    games,");
  fs.writeFileSync(auditPath, audit);
}

export function sourceHashes(root = sourceRoot) {
  return Object.fromEntries(SOURCE_FILES.filter(file => fs.existsSync(path.join(root, file))).map(file => [file,
    createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"),
  ]));
}

async function worker(job) {
  process.env.FUZZY_CHALLENGE_TRIAL = JSON.stringify(job.trial);
  const { audit } = await import(pathToFileURL(path.join(job.root, "scripts/fuzzy-match-3-balance.mjs")));
  return { ...job, ...audit({ level: job.level, games: job.games, seed: job.seed, strategy: "strong" }) };
}

async function main() {
  if (process.argv[2] === "worker") {
    process.stdout.write(JSON.stringify(await worker(JSON.parse(process.argv[3]))));
    return;
  }
  const { values } = parseArgs({ options: {
    games: { type: "string", default: "1000" },
    seed: { type: "string", default: "910001" },
    workers: { type: "string", default: "8" },
    output: { type: "string", default: "/tmp/fuzzy-assistance-audit.json" },
    source: { type: "string", default: sourceRoot },
  } });
  const games = Number(values.games), seed = Number(values.seed), workers = Number(values.workers);
  if (![games, seed, workers].every(Number.isSafeInteger) || games < 1 || workers < 1 || workers > 16)
    throw new Error("Expected positive integer games, integer seed, and 1–16 workers");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fuzzy-assistance-"));
  const startedAt = new Date().toISOString();
  const from = path.resolve(values.source);
  prepareRuntime(root, from);
  // Baseline and strongest assistance finish first, followed by intermediate tiers.
  const probabilities = [PROBABILITIES[0], PROBABILITIES.at(-1), ...PROBABILITIES.slice(1, -1)];
  const choices = probabilities.flatMap(probability => LEVELS.map((level, index) => ({
    name: (index < 4 ? "normal" : "challenge") + "-" + ["collect", "spread", "reveal", "deliver"][index % 4],
    level, probability,
  })));
  const settings = { root, source: from, games, seed, choices, output: values.output, workers };
  const batchSize = 125;
  const jobs = choices.flatMap((trial, variant) => Array.from({ length: Math.ceil(games / batchSize) }, (_, i) => ({
    variant, trial, root, level: trial.level, games: Math.min(batchSize, games - i * batchSize), seed: seed + i * batchSize,
  })));
  const provenance = { startedAt, sourceSha256: sourceHashes(from), isolatedSha256: sourceHashes(root) };
  const reports = [];
  let next = 0;
  try {
    await Promise.all(Array.from({ length: workers }, async () => {
      for (;;) {
        const job = jobs[next++];
        if (!job) return;
        const result = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [self, "worker", JSON.stringify(job)], { stdio: ["ignore", "pipe", "pipe"] });
          let stdout = "", stderr = "";
          child.stdout.on("data", chunk => stdout += chunk);
          child.stderr.on("data", chunk => stderr += chunk);
          child.on("error", reject);
          child.on("close", code => {
            if (code) reject(new Error(stderr));
            else { try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); } }
          });
        });
        reports.push(result);
        fs.writeFileSync(values.output, JSON.stringify({ provenance, settings, reports }));
        console.log(`${reports.reduce((sum, r) => sum + r.games, 0)} / ${choices.length * games}`);
      }
    }));
    provenance.completedAt = new Date().toISOString();
    fs.writeFileSync(values.output, JSON.stringify({ provenance, settings, reports }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
