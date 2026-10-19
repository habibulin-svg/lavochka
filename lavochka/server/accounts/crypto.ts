/* Пароли, одноразовые ссылки и второй фактор (TOTP) — на встроенном crypto, без сторонних модулей.
 * Пароль — scrypt (память ~32 МБ на проверку), соль своя у каждого; формат «scrypt$N$r$p$соль$хеш». */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number, o: ScryptOptions) =>
  new Promise<Buffer>((ok, bad) => scryptCb(pw, salt, len, o, (e, key) => (e ? bad(e) : ok(key))));

const N = 1 << 15;
const R = 8;
const P = 1;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, 32, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM });
  return timingSafeEqual(key, want);
}

/** Случайный токен (в cookie, в ссылку письма) и его хеш — в базе лежит только хеш. */
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

// ------------------------------------------------------------------ TOTP (RFC 6238): 6 цифр, шаг 30 с

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0;
  let v = 0;
  let out = '';
  for (const b of buf) {
    v = (v << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(v >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += B32[(v << (5 - bits)) & 31];
  return out;
}

export function unbase32(s: string): Buffer {
  const out: number[] = [];
  let bits = 0;
  let v = 0;
  for (const ch of s.toUpperCase().replace(/[\s=]/g, '')) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    v = (v << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32(randomBytes(20));

export function totp(secret: string, at = Date.now()): string {
  const step = Math.floor(at / 30_000);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Код верен в текущем окне ±30 с (часы телефона могут чуть спешить или отставать). */
export function checkTotp(secret: string | null, code: string, at = Date.now()): boolean {
  if (!secret || !/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((d) => totp(secret, at + d * 30_000) === code);
}

export const otpauthUrl = (secret: string, account: string) =>
  `otpauth://totp/${encodeURIComponent('Вечером на лавочке:' + account)}?secret=${secret}&issuer=${encodeURIComponent('Вечером на лавочке')}&digits=6&period=30`;
