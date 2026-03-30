export interface ScoreEntry {
  score: number;
  date: string;
}

const STORAGE_KEY = '256arcade_scores';

function loadAll(): Record<string, ScoreEntry[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch { return {}; }
}

function saveAll(data: Record<string, ScoreEntry[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getHighScores(gameId: string, limit = 10): ScoreEntry[] {
  const all = loadAll();
  return (all[gameId] || []).slice(0, limit);
}

export function addScore(gameId: string, score: number): ScoreEntry[] {
  const all = loadAll();
  if (!all[gameId]) all[gameId] = [];
  all[gameId].push({ score, date: new Date().toISOString().split('T')[0] });
  all[gameId].sort((a, b) => b.score - a.score);
  all[gameId] = all[gameId].slice(0, 20);
  saveAll(all);
  return all[gameId];
}

export function getTopScore(gameId: string): number {
  const scores = getHighScores(gameId, 1);
  return scores.length > 0 ? scores[0].score : 0;
}
