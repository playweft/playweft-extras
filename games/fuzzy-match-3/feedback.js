export const PRAISE_MS = 1000;

const PRAISE_TIERS = [
  { level: "perfect", word: "Perfect!", chain: 5, score: 7000 },
  { level: "excellent", word: "Excellent!", chain: 4, score: 3500 },
  { level: "great", word: "Great!", chain: 3, score: 1500 },
];

/** Choose one visual reward for the whole player turn, independently of game scoring. */
export function praiseForTurn(chain, score) {
  const tier = PRAISE_TIERS.find(tier => chain >= tier.chain || score >= tier.score);
  return tier ? { level: tier.level, word: tier.word } : null;
}
