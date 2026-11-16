import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OWNER_EMAIL, normalizeAndCanonicalizeEmail } from './security.ts';

export type UserRole = 'OWNER' | 'MASTER' | 'VIP' | 'MEMBER';

export interface RolePermissionRow {
  role: UserRole;
  can_post: number;
  can_comment: number;
  can_like: number;
  can_upload_photo: number;
  can_upload_video: number;
  can_upload_music: number;
  can_dm: number;
  can_voice_call: number;
  can_video_call: number;
  can_screen_share: number;
  can_request_rooms: number;
  updated_at: string;
}

export const DATA_DIR = path.join(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const DB_PATH = path.join(DATA_DIR, 'luxury_have.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      canonical_email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'MASTER', 'VIP', 'MEMBER')),
      is_vip INTEGER NOT NULL DEFAULT 0,
      vip_tier TEXT NOT NULL DEFAULT '',
      vip_expires_at TEXT,
      bio TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      banner_url TEXT NOT NULL DEFAULT '',
      personal_bg_url TEXT NOT NULL DEFAULT '',
      personal_theme TEXT NOT NULL DEFAULT 'inherit',
      email_verified INTEGER NOT NULL DEFAULT 0,
      is_blocked INTEGER NOT NULL DEFAULT 0,
      block_reason TEXT NOT NULL DEFAULT '',
      password_changed_by_owner INTEGER NOT NULL DEFAULT 0,
      last_active_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      device_info TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT PRIMARY KEY CHECK (role IN ('OWNER', 'MASTER', 'VIP', 'MEMBER')),
      can_post INTEGER NOT NULL DEFAULT 0,
      can_comment INTEGER NOT NULL DEFAULT 1,
      can_like INTEGER NOT NULL DEFAULT 1,
      can_upload_photo INTEGER NOT NULL DEFAULT 0,
      can_upload_video INTEGER NOT NULL DEFAULT 0,
      can_upload_music INTEGER NOT NULL DEFAULT 0,
      can_dm INTEGER NOT NULL DEFAULT 1,
      can_voice_call INTEGER NOT NULL DEFAULT 1,
      can_video_call INTEGER NOT NULL DEFAULT 1,
      can_screen_share INTEGER NOT NULL DEFAULT 0,
      can_request_rooms INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      min_role TEXT NOT NULL DEFAULT 'MEMBER',
      requires_approval INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_memberships (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS join_requests (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'none' CHECK (media_type IN ('none', 'photo', 'video', 'music')),
      media_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'none' CHECK (media_type IN ('none', 'photo', 'video', 'music')),
      media_url TEXT NOT NULL DEFAULT '',
      media_title TEXT NOT NULL DEFAULT '',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'none' CHECK (media_type IN ('none', 'photo', 'video', 'music')),
      media_url TEXT NOT NULL DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link_target TEXT NOT NULL DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      category TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(sender_id, recipient_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  // Non-destructive column migration for Google OAuth support
  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  const colNames = new Set(userCols.map((c) => c.name));
  if (!colNames.has('google_sub')) {
    db.exec(`ALTER TABLE users ADD COLUMN google_sub TEXT DEFAULT ''`);
  }
  if (!colNames.has('auth_provider')) {
    db.exec(`ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'google'`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub
    ON users(google_sub)
    WHERE google_sub != ''
  `);

  const now = new Date().toISOString();
  const { email: ownerEmail, canonical: ownerCanonical } = normalizeAndCanonicalizeEmail(OWNER_EMAIL);

  // Ensure sole OWNER exists and NO duplicate OWNER exists
  db.prepare(
    `UPDATE users SET role = 'MEMBER' WHERE role = 'OWNER' AND lower(email) != ?`
  ).run(ownerEmail);

  const existingOwner = db
    .prepare(`SELECT id FROM users WHERE lower(email) = ?`)
    .get(ownerEmail) as { id: string } | undefined;

  let ownerId: string;
  if (!existingOwner) {
    ownerId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO users (
        id, email, canonical_email, username, display_name, password_hash, role,
        is_vip, vip_tier, bio, avatar_url, banner_url, email_verified, is_blocked,
        password_changed_by_owner, google_sub, auth_provider, last_active_at, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 'OWNER', 1, 'Founder', ?, '', ?, 1, 0, 0, '', 'google', ?, ?)`
    ).run(
      ownerId,
      ownerEmail,
      ownerCanonical,
      'owner_luxury',
      'Founder Luxury Have',
      'Pemilik Tunggal Platform Sosial LUXURY HAVE.',
      '/brand-assets/luxury_hero_banner_1794784329141.jpg',
      now,
      now
    );
  } else {
    ownerId = existingOwner.id;
    db.prepare(
      `UPDATE users SET role = 'OWNER', is_vip = 1, email_verified = 1, is_blocked = 0, auth_provider = 'google' WHERE id = ?`
    ).run(ownerId);
  }

  // Seed default role permissions if missing
  const defaultPerms: Omit<RolePermissionRow, 'updated_at'>[] = [
    {
      role: 'OWNER',
      can_post: 1,
      can_comment: 1,
      can_like: 1,
      can_upload_photo: 1,
      can_upload_video: 1,
      can_upload_music: 1,
      can_dm: 1,
      can_voice_call: 1,
      can_video_call: 1,
      can_screen_share: 1,
      can_request_rooms: 1,
    },
    {
      role: 'MASTER',
      can_post: 1,
      can_comment: 1,
      can_like: 1,
      can_upload_photo: 1,
      can_upload_video: 1,
      can_upload_music: 1,
      can_dm: 1,
      can_voice_call: 1,
      can_video_call: 1,
      can_screen_share: 1,
      can_request_rooms: 1,
    },
    {
      role: 'VIP',
      can_post: 1,
      can_comment: 1,
      can_like: 1,
      can_upload_photo: 1,
      can_upload_video: 1,
      can_upload_music: 1,
      can_dm: 1,
      can_voice_call: 1,
      can_video_call: 1,
      can_screen_share: 1,
      can_request_rooms: 1,
    },
    {
      role: 'MEMBER',
      can_post: 0,
      can_comment: 1,
      can_like: 1,
      can_upload_photo: 0,
      can_upload_video: 0,
      can_upload_music: 0,
      can_dm: 1,
      can_voice_call: 1,
      can_video_call: 1,
      can_screen_share: 0,
      can_request_rooms: 1,
    },
  ];

  const insertPerm = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (
      role, can_post, can_comment, can_like, can_upload_photo, can_upload_video,
      can_upload_music, can_dm, can_voice_call, can_video_call, can_screen_share,
      can_request_rooms, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of defaultPerms) {
    insertPerm.run(
      p.role,
      p.can_post,
      p.can_comment,
      p.can_like,
      p.can_upload_photo,
      p.can_upload_video,
      p.can_upload_music,
      p.can_dm,
      p.can_voice_call,
      p.can_video_call,
      p.can_screen_share,
      p.can_request_rooms,
      now
    );
  }

  // Seed default site settings
  const defaultSettings: Record<string, string> = {
    platform_name: 'LUXURY HAVE',
    platform_tagline: 'Komunitas Sosial Eksklusif & Elegan',
    theme_preset: 'champagne-pearl',
    theme_mode: 'light',
    accent_color: '#b8860b',
    glass_opacity: '0.78',
    border_radius: '20',
    layout_density: 'comfortable',
    background_type: 'aurora',
    background_url: '/brand-assets/luxury_bg_aurora_1794784329133.jpg',
    hero_banner_url: '/brand-assets/luxury_hero_banner_1794784329141.jpg',
    glow_intensity: '0.55',
    allow_registration: '1',
    require_email_verification: '1',
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass_encrypted: '',
    smtp_from: 'LUXURY HAVE <noreply@luxuryhave.local>',
  };

  const insertSetting = db.prepare(
    `INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)`
  );
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, v, now);
  }

  // Seed default exclusive platform rooms (rooms are platform channels, NOT bot/sample accounts)
  const roomCount = (db.prepare(`SELECT COUNT(*) as c FROM rooms`).get() as { c: number }).c;
  if (roomCount === 0) {
    const sanctuaryId = crypto.randomUUID();
    const salonId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO rooms (id, name, description, cover_url, min_role, requires_approval, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      sanctuaryId,
      'VIP Sanctuary Lounge',
      'Ruang diskusi eksklusif dan sesi audio/video privat untuk anggota terverifikasi.',
      '/brand-assets/luxury_room_sanctuary_1794784330937.jpg',
      'MEMBER',
      ownerId,
      now
    );
    db.prepare(
      `INSERT INTO rooms (id, name, description, cover_url, min_role, requires_approval, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      salonId,
      'Inner Circle Atelier',
      'Salon kurasi media, musik, dan diskusi khusus dengan persetujuan langsung dari OWNER.',
      '/brand-assets/luxury_hero_banner_1794784329141.jpg',
      'VIP',
      ownerId,
      now
    );
    db.prepare(
      `INSERT OR IGNORE INTO room_memberships (room_id, user_id, status, granted_by, created_at)
       VALUES (?, ?, 'active', ?, ?)`
    ).run(sanctuaryId, ownerId, ownerId, now);
    db.prepare(
      `INSERT OR IGNORE INTO room_memberships (room_id, user_id, status, granted_by, created_at)
       VALUES (?, ?, 'active', ?, ?)`
    ).run(salonId, ownerId, ownerId, now);
  }
}

export function getSiteSettingsMap(): Record<string, string> {
  const rows = db.prepare(`SELECT key, value FROM site_settings`).all() as {
    key: string;
    value: string;
  }[];
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (r.key === 'smtp_pass_encrypted') continue; // Never expose encrypted SMTP secret
    map[r.key] = r.value;
  }
  return map;
}

export function getRolePermissions(role: UserRole): RolePermissionRow {
  const row = db.prepare(`SELECT * FROM role_permissions WHERE role = ?`).get(role) as
    | RolePermissionRow
    | undefined;
  if (row) return row;
  return {
    role: 'MEMBER',
    can_post: 0,
    can_comment: 1,
    can_like: 1,
    can_upload_photo: 0,
    can_upload_video: 0,
    can_upload_music: 0,
    can_dm: 1,
    can_voice_call: 1,
    can_video_call: 1,
    can_screen_share: 0,
    can_request_rooms: 1,
    updated_at: new Date().toISOString(),
  };
}

export function logActivity(params: {
  userId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
  ipAddress?: string;
}): void {
  try {
    db.prepare(
      `INSERT INTO activity_logs (id, user_id, action, target_type, target_id, details, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      params.userId ?? null,
      params.action,
      params.targetType ?? '',
      params.targetId ?? '',
      params.details ?? '',
      params.ipAddress ?? '',
      new Date().toISOString()
    );
  } catch (err) {
    console.error('[ACTIVITY_LOG_ERROR]', err);
  }
}
