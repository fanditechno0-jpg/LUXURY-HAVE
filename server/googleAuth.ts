import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface FirebaseConfig {
  projectId: string;
  authDomain?: string;
  oAuthClientId?: string;
}

export interface GoogleAuthConfigStatus {
  configured: boolean;
  projectId: string;
  authDomain: string;
  oAuthClientId: string;
  appUrl: string;
  redirectHandlers: string[];
}

export interface VerifiedGoogleIdentity {
  uid: string;
  googleSub: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string;
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

function getFirebaseProjectConfig(): FirebaseConfig {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'Konfigurasi Google OAuth (firebase-applet-config.json) tidak ditemukan di server.'
    );
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as FirebaseConfig;
  if (!parsed.projectId) {
    throw new Error('Project ID Firebase/Google OAuth belum tersedia di konfigurasi.');
  }
  return parsed;
}

export function getGoogleAuthConfigStatus(): GoogleAuthConfigStatus {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  const appUrl = (process.env.APP_URL || '').trim();
  if (!fs.existsSync(configPath)) {
    return {
      configured: false,
      projectId: '',
      authDomain: '',
      oAuthClientId: '',
      appUrl,
      redirectHandlers: [],
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as FirebaseConfig;
    const authDomain = raw.authDomain || `${raw.projectId}.firebaseapp.com`;
    const oAuthClientId = raw.oAuthClientId || '';
    const redirectHandlers = [
      `https://${authDomain}/__/auth/handler`,
      ...(appUrl ? [appUrl] : []),
    ];
    return {
      configured: Boolean(raw.projectId && oAuthClientId),
      projectId: raw.projectId || '',
      authDomain,
      oAuthClientId,
      appUrl,
      redirectHandlers,
    };
  } catch {
    return {
      configured: false,
      projectId: '',
      authDomain: '',
      oAuthClientId: '',
      appUrl,
      redirectHandlers: [],
    };
  }
}

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  if (Date.now() < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error('Gagal mengambil sertifikat publik Google untuk verifikasi token.');
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const match = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = match ? Number(match[1]) : 3600;

  cachedCerts = (await res.json()) as Record<string, string>;
  certsExpiresAt = Date.now() + Math.max(60, maxAgeSec) * 1000;
  return cachedCerts;
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64');
}

export async function verifyGoogleFirebaseIdToken(
  idToken: string,
  googleAccessToken?: string
): Promise<VerifiedGoogleIdentity> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Token autentikasi Google tidak ditemukan.');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Format token Google tidak valid.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: {
    iss?: string;
    aud?: string;
    sub?: string;
    user_id?: string;
    auth_time?: number;
    iat?: number;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    firebase?: {
      sign_in_provider?: string;
      identities?: Record<string, string[]>;
    };
  };

  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new Error('Token Google gagal didekode.');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Algoritma tanda tangan token Google tidak valid.');
  }

  const fbConfig = getFirebaseProjectConfig();
  const certs = await getGooglePublicCerts();
  let certPem = certs[header.kid];
  if (!certPem) {
    // Force refresh certs once in case Google rotated keys
    certsExpiresAt = 0;
    const freshCerts = await getGooglePublicCerts();
    certPem = freshCerts[header.kid];
  }
  if (!certPem) {
    throw new Error('Kunci verifikasi Google tidak cocok atau sudah kedaluwarsa.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const sigValid = verifier.verify(certPem, base64UrlDecode(signatureB64));
  if (!sigValid) {
    throw new Error('Tanda tangan kriptografi token Google tidak valid.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Sesi Google OAuth telah kedaluwarsa. Silakan ulangi login.');
  }
  if (!payload.iat || payload.iat > nowSec + 300) {
    throw new Error('Waktu penerbitan token Google tidak valid.');
  }
  if (payload.aud !== fbConfig.projectId) {
    throw new Error('Audiens token Google tidak cocok dengan aplikasi ini.');
  }
  if (payload.iss !== `https://securetoken.google.com/${fbConfig.projectId}`) {
    throw new Error('Penerbit token Google tidak valid.');
  }
  if (!payload.sub) {
    throw new Error('Subjek pengguna Google tidak ditemukan.');
  }
  if (payload.firebase?.sign_in_provider !== 'google.com') {
    throw new Error('Autentikasi harus menggunakan penyedia Google OAuth.');
  }
  if (!payload.email || !payload.email_verified) {
    throw new Error('Alamat Gmail Anda harus terverifikasi oleh Google.');
  }

  const googleIds = payload.firebase?.identities?.['google.com'];
  const googleSub = (googleIds && googleIds[0]) || payload.sub;
  let verifiedEmail = payload.email.trim().toLowerCase();
  let displayName = (payload.name || verifiedEmail.split('@')[0]).trim();
  let avatarUrl = (payload.picture || '').trim();

  // Optional secondary cross-check against Google UserInfo endpoint when OAuth access token is present
  if (googleAccessToken) {
    try {
      const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${googleAccessToken}` },
      });
      if (uiRes.ok) {
        const ui = (await uiRes.json()) as {
          sub?: string;
          email?: string;
          email_verified?: boolean;
          name?: string;
          picture?: string;
        };
        if (ui.email && ui.email_verified) {
          if (ui.email.trim().toLowerCase() !== verifiedEmail) {
            throw new Error('Identitas email Google tidak konsisten.');
          }
          if (ui.name) displayName = ui.name.trim();
          if (ui.picture) avatarUrl = ui.picture.trim();
        }
      }
    } catch (err) {
      if ((err as Error).message === 'Identitas email Google tidak konsisten.') {
        throw err;
      }
      // Continue with verified RS256 Firebase ID token if access token expired
    }
  }

  return {
    uid: payload.sub,
    googleSub,
    email: verifiedEmail,
    emailVerified: true,
    displayName,
    avatarUrl,
  };
}
