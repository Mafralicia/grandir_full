import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Parâmetros no patamar recomendado pela OWASP para scrypt (N=2^15, r=8, p=1 ≈ 32 MiB por hash).
const N = 32_768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, options: ScryptOptions, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P, maxmem: 128 * N * R * 2 }, KEY_LENGTH);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  const actual = await derive(
    password,
    Buffer.from(salt, 'base64'),
    { ...cost, maxmem: 128 * cost.N * cost.r * 2 },
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}

export const PASSWORD_RULES =
  'Mínimo de 12 caracteres, com letra maiúscula, minúscula, número e caractere especial.';

export function passwordIssue(password: string): string | null {
  if (password.length < 12) return 'A senha precisa ter pelo menos 12 caracteres.';
  if (password.length > 200) return 'A senha pode ter no máximo 200 caracteres.';
  if (!/[a-z]/.test(password)) return 'Inclua ao menos uma letra minúscula.';
  if (!/[A-Z]/.test(password)) return 'Inclua ao menos uma letra maiúscula.';
  if (!/\d/.test(password)) return 'Inclua ao menos um número.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Inclua ao menos um caractere especial.';
  return null;
}
