let counter = 0;

/** Short random identifier, unique within a document. */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  counter = (counter + 1) % 1679616;
  return `${prefix}${rand}${counter.toString(36)}`;
}
