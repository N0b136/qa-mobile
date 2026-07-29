const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

// 256 % 31 = 8, so a plain byte % 31 would make the first eight letters of the
// alphabet fractionally likelier than the rest. Draw again on anything at or
// above this instead of folding that bias into every code we mint.
const CODE_CEILING = 256 - (256 % SHORT_CODE_ALPHABET.length)

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Mints party invite codes and booking confirmation codes — both are the whole
 * proof a guest presents, so they come from the CSPRNG rather than Math.random,
 * which is seeded predictably and short enough to enumerate a park's worth of
 * six-character codes from.
 */
export function shortCode(len: number): string {
  const n = SHORT_CODE_ALPHABET.length
  let out = ''

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(len)
    while (out.length < len) {
      crypto.getRandomValues(bytes)
      for (let i = 0; i < bytes.length && out.length < len; i++) {
        if (bytes[i] < CODE_CEILING) out += SHORT_CODE_ALPHABET[bytes[i] % n]
      }
    }
    return out
  }

  // Every browser this app runs in has WebCrypto; this only keeps a bare test
  // runner or an exotic embedded view from making code minting throw.
  for (let i = 0; i < len; i++) {
    out += SHORT_CODE_ALPHABET[Math.floor(Math.random() * n)]
  }
  return out
}
