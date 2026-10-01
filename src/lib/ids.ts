const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 20-char random id — same shape as Firestore auto ids. */
export function randomId(length = 20): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

/** Deterministic id of the batch document holding lot `lotId` at `locationId`. */
export function batchIdFor(lotId: string, locationId: string): string {
  return `${lotId}__${locationId}`
}

/** `PO`, 2026, 7 → `PO-2026-0007` */
export function formatDocNumber(prefix: string, year: string, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`
}
