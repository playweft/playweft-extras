import { generateLevel } from './puzzle.js';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, puzzle: generateLevel(data.seed) });
  } catch {
    self.postMessage({ id: data.id, error: '新题生成失败，请重试。' });
  }
};
