import crypto from 'node:crypto';

export const OWNER_EMAIL = 'veloracute552@gmail.com';

const FALLBACK_SECRET = crypto
  .createHash('sha256')
  .update(process.cwd() + ':luxury-have-local-session-key')
  .digest('hex');

function getServerSecret(): string {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : FALLBACK_SECRET;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    if (keyBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(keyBuf, derived);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHmac('sha256', getServerSecret()).update(token).digest('hex');
}

export function generateOtpCode(): string {
  const num = crypto.randomInt(100000, 999999);
  return String(num);
}

export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const key = crypto.createHash('sha256').update(getServerSecret()).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherText: string): string {
  if (!cipherText || !cipherText.includes(':')) return '';
  try {
    const [ivHex, tagHex, encHex] = cipherText.split(':');
    const key = crypto.createHash('sha256').update(getServerSecret()).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

export function normalizeAndCanonicalizeEmail(rawEmail: string): {
  email: string;
  canonical: string;
  isValid: boolean;
  isGmail: boolean;
} {
  const email = rawEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(email)) {
    return { email, canonical: email, isValid: false, isGmail: false };
  }

  const [localPart, domainPart] = email.split('@');
  const isGmail = domainPart === 'gmail.com' || domainPart === 'googlemail.com';
  if (isGmail) {
    const withoutPlus = localPart.split('+')[0];
    const withoutDots = withoutPlus.replace(/\./g, '');
    return {
      email,
      canonical: `${withoutDots}@gmail.com`,
      isValid: true,
      isGmail: true,
    };
  }

  return {
    email,
    canonical: email,
    isValid: true,
    isGmail: false,
  };
}

export function isStrongPassword(password: string): { valid: boolean; reason?: string } {
  if (!password || password.length < 8) {
    return { valid: false, reason: 'Password minimal harus 8 karakter.' };
  }
  if (password.length > 128) {
    return { valid: false, reason: 'Password maksimal 128 karakter.' };
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  if (!hasLetter || !hasNumber) {
    return { valid: false, reason: 'Password harus mengandung huruf dan angka.' };
  }
  return { valid: true };
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function checkRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= maxAttempts) {
    return false;
  }
  existing.count += 1;
  return true;
}
