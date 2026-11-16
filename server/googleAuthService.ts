import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { UserRole, getRolePermissions, getSiteSettingsMap, logActivity } from './db.ts';
import type { VerifiedGoogleIdentity } from './googleAuth.ts';
import {
  OWNER_EMAIL,
  generateSessionToken,
  hashToken,
  normalizeAndCanonicalizeEmail,
} from './security.ts';

export type GoogleAuthMode = 'login' | 'register' | 'recover';

export interface DbUserRow {
  id: string;
  email: string;
  canonical_email: string;
  username: string;
  display_name: string;
  password_hash: string | null;
  role: UserRole;
  is_vip: number;
  vip_tier: string;
  vip_expires_at: string | null;
  bio: string;
  avatar_url: string;
  banner_url: string;
  personal_bg_url: string;
  personal_theme: string;
  email_verified: number;
  is_blocked: number;
  block_reason: string;
  password_changed_by_owner: number;
  google_sub: string;
  auth_provider: string;
  last_active_at: string;
  created_at: string;
}

export class GoogleAuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface GoogleAuthResult {
  userRow: DbUserRow;
  sessionId: string;
  sessionToken: string;
  isNewUser: boolean;
  recovered: boolean;
  revokedOtherSessions: boolean;
  permissions: ReturnType<typeof getRolePermissions>;
  siteSettings: Record<string, string>;
}

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function generateUniqueUsername(database: Database.Database, email: string): string {
  let base = email
    .split('@')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 22);

  if (base.length < 3) {
    base = `member_${crypto.randomBytes(2).toString('hex')}`;
  }

  let candidate = base;
  let attempts = 0;
  while (database.prepare(`SELECT id FROM users WHERE username = ?`).get(candidate)) {
    attempts += 1;
    const suffix = crypto.randomBytes(2).toString('hex');
    candidate = `${base.slice(0, 18)}_${suffix}`;
    if (attempts > 10) {
      candidate = `member_${crypto.randomBytes(4).toString('hex')}`;
      break;
    }
  }
  return candidate;
}

export function authenticateVerifiedGoogleUser(params: {
  database: Database.Database;
  identity: VerifiedGoogleIdentity;
  mode?: GoogleAuthMode;
  revokeOtherSessions?: boolean;
  userAgent?: string;
  ipAddress?: string;
  sessionTtlMs?: number;
  useActivityLogger?: boolean;
}): GoogleAuthResult {
  const {
    database,
    identity,
    mode = 'login',
    revokeOtherSessions = false,
    userAgent = '',
    ipAddress = '',
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    useActivityLogger = true,
  } = params;

  const verifiedEmail = identity.email.trim().toLowerCase();
  const parsedEmail = normalizeAndCanonicalizeEmail(verifiedEmail);
  if (!parsedEmail.isValid || !identity.emailVerified) {
    throw new GoogleAuthError(
      400,
      'GOOGLE_EMAIL_UNVERIFIED',
      'Alamat Gmail harus terverifikasi oleh Google sebelum dapat masuk.'
    );
  }

  const exactOwnerEmail = OWNER_EMAIL.trim().toLowerCase();
  const isExactOwner = verifiedEmail === exactOwnerEmail;
  const now = new Date().toISOString();

  // Enforce single OWNER invariant: no account other than exact OWNER_EMAIL can hold OWNER role
  database
    .prepare(`UPDATE users SET role = 'MEMBER' WHERE role = 'OWNER' AND lower(email) != ?`)
    .run(exactOwnerEmail);

  // Locate existing user safely
  let existing: DbUserRow | undefined;
  if (isExactOwner) {
    existing = database
      .prepare(`SELECT * FROM users WHERE lower(email) = ?`)
      .get(exactOwnerEmail) as DbUserRow | undefined;
    if (!existing && identity.googleSub) {
      existing = database
        .prepare(`SELECT * FROM users WHERE google_sub = ?`)
        .get(identity.googleSub) as DbUserRow | undefined;
    }
  } else {
    if (identity.googleSub) {
      existing = database
        .prepare(`SELECT * FROM users WHERE google_sub = ?`)
        .get(identity.googleSub) as DbUserRow | undefined;
    }
    if (!existing) {
      existing = database
        .prepare(`SELECT * FROM users WHERE canonical_email = ? OR lower(email) = ?`)
        .get(parsedEmail.canonical, verifiedEmail) as DbUserRow | undefined;
    }
  }

  if (mode === 'recover' && !existing) {
    throw new GoogleAuthError(
      404,
      'ACCOUNT_NOT_FOUND',
      'Akun dengan Gmail tersebut belum terdaftar di LUXURY HAVE. Silakan gunakan tombol Daftar atau Lanjutkan dengan Google.'
    );
  }

  // Prevent duplicate registration for already-linked normal accounts
  if (mode === 'register' && existing && !isExactOwner && existing.google_sub) {
    throw new GoogleAuthError(
      409,
      'ALREADY_REGISTERED',
      'Gmail ini sudah terdaftar. Satu Gmail hanya boleh memiliki satu akun — silakan masuk menggunakan tombol "Lanjutkan dengan Google".'
    );
  }

  let isNewUser = false;
  let userRow: DbUserRow;

  if (!existing) {
    const regSettingRow = database
      .prepare(`SELECT value FROM site_settings WHERE key = 'allow_registration'`)
      .get() as { value: string } | undefined;

    if (!isExactOwner && regSettingRow?.value === '0') {
      throw new GoogleAuthError(
        403,
        'REGISTRATION_CLOSED',
        'Pendaftaran anggota baru sedang ditutup sementara oleh OWNER.'
      );
    }

    isNewUser = true;
    const userId = crypto.randomUUID();
    const initialRole: UserRole = isExactOwner ? 'OWNER' : 'MEMBER';
    const username = isExactOwner
      ? 'owner_luxury'
      : generateUniqueUsername(database, verifiedEmail);
    const displayName = (
      identity.displayName ||
      (isExactOwner ? 'Founder Luxury Have' : verifiedEmail.split('@')[0])
    )
      .trim()
      .slice(0, 48);
    const bio = isExactOwner ? 'Pemilik Tunggal Platform Sosial LUXURY HAVE.' : '';
    const bannerUrl = isExactOwner ? '/brand-assets/luxury_hero_banner_1794784329141.jpg' : '';
    const avatarUrl = (identity.avatarUrl || '').trim();

    database
      .prepare(
        `INSERT INTO users (
          id, email, canonical_email, username, display_name, password_hash, role,
          is_vip, vip_tier, bio, avatar_url, banner_url, email_verified, is_blocked,
          password_changed_by_owner, google_sub, auth_provider, last_active_at, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, 'google', ?, ?)`
      )
      .run(
        userId,
        verifiedEmail,
        parsedEmail.canonical,
        username,
        displayName,
        initialRole,
        isExactOwner ? 1 : 0,
        isExactOwner ? 'Founder' : '',
        bio,
        avatarUrl,
        bannerUrl,
        identity.googleSub,
        now,
        now
      );

    userRow = database.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as DbUserRow;
  } else {
    if (!isExactOwner && existing.is_blocked) {
      throw new GoogleAuthError(
        403,
        'ACCOUNT_BLOCKED',
        existing.block_reason
          ? `Akun Anda diblokir oleh OWNER: ${existing.block_reason}`
          : 'Akun Anda sedang diblokir oleh OWNER.'
      );
    }

    const nextRole: UserRole = isExactOwner
      ? 'OWNER'
      : existing.role === 'OWNER'
        ? 'MEMBER'
        : existing.role;
    const nextVip = isExactOwner ? 1 : existing.is_vip;
    const nextVipTier = isExactOwner && !existing.vip_tier ? 'Founder' : existing.vip_tier;
    const nextAvatar =
      !existing.avatar_url && identity.avatarUrl ? identity.avatarUrl.trim() : existing.avatar_url;
    const nextBlocked = isExactOwner ? 0 : existing.is_blocked;

    database
      .prepare(
        `UPDATE users SET
          role = ?, is_vip = ?, vip_tier = ?, email_verified = 1, is_blocked = ?,
          google_sub = ?, auth_provider = 'google', avatar_url = ?, last_active_at = ?
         WHERE id = ?`
      )
      .run(
        nextRole,
        nextVip,
        nextVipTier,
        nextBlocked,
        identity.googleSub || existing.google_sub,
        nextAvatar,
        now,
        existing.id
      );

    userRow = database.prepare(`SELECT * FROM users WHERE id = ?`).get(existing.id) as DbUserRow;
  }

  const shouldRevokeOthers = mode === 'recover' || Boolean(revokeOtherSessions);
  if (shouldRevokeOthers) {
    database.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userRow.id);
  }

  const sessionToken = generateSessionToken();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();

  database
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, device_info, ip_address, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(sessionId, userRow.id, hashToken(sessionToken), userAgent, ipAddress, expiresAt, now);

  if (useActivityLogger) {
    const action =
      mode === 'recover'
        ? 'GOOGLE_ACCOUNT_RECOVERED'
        : isNewUser
          ? 'GOOGLE_REGISTERED'
          : 'GOOGLE_LOGIN';
    const details =
      mode === 'recover'
        ? `Pemulihan akses akun via Google OAuth (${userRow.role})`
        : isNewUser
          ? `Pendaftaran baru via Google OAuth (${userRow.role})`
          : `Login via Google OAuth (${userRow.role})`;

    logActivity({
      userId: userRow.id,
      action,
      targetType: 'user',
      targetId: userRow.id,
      details,
      ipAddress,
    });
  }

  const permRow =
    (database
      .prepare(`SELECT * FROM role_permissions WHERE role = ?`)
      .get(userRow.role) as ReturnType<typeof getRolePermissions> | undefined) ||
    getRolePermissions(userRow.role);

  const settingsRows = database
    .prepare(`SELECT key, value FROM site_settings`)
    .all() as { key: string; value: string }[];
  const siteSettings: Record<string, string> = {};
  for (const r of settingsRows) {
    if (r.key === 'smtp_pass_encrypted') continue;
    siteSettings[r.key] = r.value;
  }

  return {
    userRow,
    sessionId,
    sessionToken,
    isNewUser,
    recovered: mode === 'recover',
    revokedOtherSessions: shouldRevokeOthers,
    permissions: permRow,
    siteSettings: Object.keys(siteSettings).length > 0 ? siteSettings : getSiteSettingsMap(),
  };
}
