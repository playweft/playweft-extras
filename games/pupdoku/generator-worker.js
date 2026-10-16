import { generateLevel } from './puzzle.js';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ puzzle: generateLevel(data.seed) });
  } catch {
    self.postMessage({ error: '新题生成失败，请重试。' });
  }
};
