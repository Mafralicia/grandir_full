import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP conforme RFC 6238 (HMAC-SHA1, 6 dígitos, passo de 30 s) — compatível com apps autenticadores.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Segredo base32 inválido.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const generateSecret = (): string => base32Encode(randomBytes(20));

export const currentStep = (nowMs = Date.now()): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

export function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Valida o código aceitando um passo de tolerância para relógios desalinhados.
 * Devolve o passo aceito (para bloquear reuso do mesmo código) ou `null`.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep = 0, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(nowMs);
  for (const candidate of [step - 1, step, step + 1]) {
    if (candidate <= lastUsedStep) continue;
    const expected = Buffer.from(codeForStep(secret, candidate));
    if (timingSafeEqual(expected, Buffer.from(code))) return candidate;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string, issuer = 'Grandir'): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
  `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
