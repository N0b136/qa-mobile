const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function shortCode(len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)]
  }
  return out
}
