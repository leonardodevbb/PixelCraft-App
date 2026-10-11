function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Scores a fuzzy match: all query characters in order; contiguous and word-start hits score higher. */
export function fuzzyScore(text: string, query: string): number {
  const t = normalize(text);
  const q = normalize(query.trim());
  if (!q) return 1;
  if (t.includes(q)) return 1000 - t.indexOf(q);
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    score += found === prev + 1 ? 5 : 1;
    if (found === 0 || t[found - 1] === ' ') score += 3;
    prev = found;
    ti = found + 1;
  }
  return score;
}
