import test from "node:test";
import assert from "node:assert/strict";
import { praiseForTurn } from "../games/fuzzy-match-3/feedback.js";

test("praise starts at three cascades or the first score milestone", () => {
  assert.equal(praiseForTurn(1, 0), null);
  assert.equal(praiseForTurn(2, 1490), null);
  assert.equal(praiseForTurn(3, 1080).word, "Great!");
  assert.equal(praiseForTurn(1, 1500).word, "Great!");
});

test("chain and whole-turn score independently qualify for the highest praise tier", () => {
  for (const [chain, score, word] of [
    [4, 1800, "Excellent!"], [2, 3500, "Excellent!"],
    [5, 2700, "Perfect!"], [1, 7000, "Perfect!"],
    [3, 7000, "Perfect!"], [8, 180, "Perfect!"],
    [2, 3490, "Great!"], [2, 6990, "Excellent!"],
  ]) assert.equal(praiseForTurn(chain, score).word, word);
  assert.notEqual(praiseForTurn(3, 180), praiseForTurn(3, 180),
    "each turn owns its label so an older timeout cannot remove a newer reward");
});
