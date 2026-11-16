import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  BACKUPS_DIR,
  RolePermissionRow,
  UPLOADS_DIR,
  UserRole,
  db,
  getRolePermissions,
  getSiteSettingsMap,
  initDatabase,
  logActivity,
} from './server/db.ts';
import { getGoogleAuthConfigStatus, verifyGoogleFirebaseIdToken } from './server/googleAuth.ts';
import {
  GoogleAuthError,
  GoogleAuthMode,
  authenticateVerifiedGoogleUser,
} from './server/googleAuthService.ts';
import {
  OWNER_EMAIL,
  checkRateLimit,
  hashToken,
} from './server/security.ts';

initDatabase();

interface AuthUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
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
  last_active_at: string;
  created_at: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      sessionId?: string;
    }
  }
}

const COOKIE_NAME = 'lh_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Presence & WebSocket registry: userId -> Set<WebSocket>
const onlineSockets = new Map<string, Set<WebSocket>>();

function isUserOnline(userId: string): boolean {
  const set = onlineSockets.get(userId);
  return Boolean(set && set.size > 0);
}

function sendToUser(userId: string, payload: unknown): void {
  const set = onlineSockets.get(userId);
  if (!set) return;
  const serialized = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

function broadcastAll(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  for (const set of onlineSockets.values()) {
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
      }
    }
  }
}

function sanitizeUser(row: AuthUser, viewer?: AuthUser | null) {
  const includeEmail = Boolean(viewer && (viewer.id === row.id || viewer.role === 'OWNER'));
  return {
    id: row.id,
    email: includeEmail ? row.email : undefined,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isVip: Boolean(row.is_vip),
    vipTier: row.vip_tier,
    vipExpiresAt: row.vip_expires_at,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url,
    personalBgUrl: row.personal_bg_url,
    personalTheme: row.personal_theme,
    emailVerified: Boolean(row.email_verified),
    isBlocked: Boolean(row.is_blocked),
    blockReason: row.block_reason,
    online: isUserOnline(row.id),
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
  };
}

function getSessionCookieOptions(req: Request) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const isHttps = req.secure || forwardedProto === 'https';
  return {
    httpOnly: true,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    secure: Boolean(isHttps),
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

function getUserBySessionToken(rawToken: string | undefined): { user: AuthUser; sessionId: string } | null {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT s.id as session_id, s.expires_at, u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, now) as (AuthUser & { session_id: string; expires_at: string }) | undefined;

  if (!row) return null;
  if (row.is_blocked) return null;

  // Enforce OWNER authority based on exact OWNER email on server side
  const isExactOwner = row.email.trim().toLowerCase() === OWNER_EMAIL.trim().toLowerCase();
  if (isExactOwner && row.role !== 'OWNER') {
    db.prepare(`UPDATE users SET role = 'OWNER', is_vip = 1, email_verified = 1 WHERE id = ?`).run(
      row.id
    );
    row.role = 'OWNER';
  } else if (!isExactOwner && row.role === 'OWNER') {
    db.prepare(`UPDATE users SET role = 'MEMBER' WHERE id = ?`).run(row.id);
    row.role = 'MEMBER';
  }

  return { user: row, sessionId: row.session_id };
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

function createNotification(params: {
  userId: string;
  actorId?: string | null;
  type: string;
  title: string;
  body: string;
  linkTarget?: string;
}): void {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO notifications (id, user_id, actor_id, type, title, body, link_target, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    params.userId,
    params.actorId ?? null,
    params.type,
    params.title,
    params.body,
    params.linkTarget ?? '',
    createdAt
  );

  sendToUser(params.userId, {
    type: 'notification:new',
    notification: {
      id,
      userId: params.userId,
      actorId: params.actorId ?? null,
      type: params.type,
      title: params.title,
      body: params.body,
      linkTarget: params.linkTarget ?? '',
      isRead: false,
      createdAt,
    },
  });
}

function getOwnerUserId(): string | null {
  const row = db
    .prepare(`SELECT id FROM users WHERE lower(email) = ?`)
    .get(OWNER_EMAIL.trim().toLowerCase()) as { id: string } | undefined;
  return row?.id ?? null;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const rawToken = req.cookies?.[COOKIE_NAME];
  const found = getUserBySessionToken(rawToken);
  if (!found) {
    res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.' });
    return;
  }
  req.authUser = found.user;
  req.sessionId = found.sessionId;
  db.prepare(`UPDATE users SET last_active_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    found.user.id
  );
  next();
}

function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Autentikasi diperlukan.' });
    return;
  }
  const isExactOwner =
    req.authUser.email.trim().toLowerCase() === OWNER_EMAIL.trim().toLowerCase();
  if (req.authUser.role !== 'OWNER' || !isExactOwner) {
    res.status(403).json({ error: 'Akses ditolak. Hanya OWNER utama yang memiliki otoritas ini.' });
    return;
  }
  next();
}

function requirePerm(permKey: keyof Omit<RolePermissionRow, 'role' | 'updated_at'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Autentikasi diperlukan.' });
      return;
    }
    if (req.authUser.role === 'OWNER') {
      next();
      return;
    }
    const perms = getRolePermissions(req.authUser.role);
    if (!perms[permKey]) {
      res.status(403).json({ error: 'Jabatan Anda tidak memiliki izin untuk fitur ini.' });
      return;
    }
    next();
  };
}

// Multer setup for safe media uploads
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 45 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_MIME_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix));
    if (!ok) {
      cb(new Error('Format file tidak didukung. Hanya foto, video, dan musik yang diizinkan.'));
      return;
    }
    cb(null, true);
  },
});

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  // Serve uploaded media and static brand assets
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/brand-assets', express.static(path.join(process.cwd(), 'src/assets/images')));

  // =========================
  // AUTH & SESSION ENDPOINTS
  // =========================

  app.get('/api/auth/me', (req, res) => {
    const settings = getSiteSettingsMap();
    const googleAuth = getGoogleAuthConfigStatus();
    const rawToken = req.cookies?.[COOKIE_NAME];
    const found = getUserBySessionToken(rawToken);
    if (!found) {
      res.json({
        user: null,
        permissions: null,
        siteSettings: settings,
        googleAuth,
        unreadNotifications: 0,
        unreadDms: 0,
      });
      return;
    }

    const perms = getRolePermissions(found.user.role);
    const unreadNotifications = (
      db
        .prepare(`SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0`)
        .get(found.user.id) as { c: number }
    ).c;
    const unreadDms = (
      db
        .prepare(`SELECT COUNT(*) as c FROM direct_messages WHERE recipient_id = ? AND is_read = 0`)
        .get(found.user.id) as { c: number }
    ).c;

    res.json({
      user: sanitizeUser(found.user, found.user),
      permissions: perms,
      siteSettings: settings,
      googleAuth,
      unreadNotifications,
      unreadDms,
    });
  });

  app.get('/api/auth/google/status', (_req, res) => {
    const settings = getSiteSettingsMap();
    res.json({
      ...getGoogleAuthConfigStatus(),
      allowRegistration: settings.allow_registration !== '0',
    });
  });

  app.post('/api/auth/google', async (req, res) => {
    const ip = req.ip || '';
    if (!checkRateLimit(`google-auth:${ip}`, 35, 10 * 60 * 1000)) {
      res.status(429).json({
        error: 'Terlalu banyak percobaan autentikasi Google. Silakan tunggu beberapa menit.',
      });
      return;
    }

    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const body = (req.body || {}) as {
      idToken?: string;
      googleAccessToken?: string;
      mode?: GoogleAuthMode;
      revokeOtherSessions?: boolean;
    };

    const idToken = bearerToken || (typeof body.idToken === 'string' ? body.idToken.trim() : '');
    if (!idToken) {
      res.status(400).json({
        code: 'MISSING_GOOGLE_TOKEN',
        error: 'Token identitas Google tidak ditemukan. Silakan lanjutkan login dengan Google.',
      });
      return;
    }

    const mode: GoogleAuthMode =
      body.mode === 'register' || body.mode === 'recover' ? body.mode : 'login';

    try {
      const identity = await verifyGoogleFirebaseIdToken(
        idToken,
        typeof body.googleAccessToken === 'string' ? body.googleAccessToken : undefined
      );

      const result = authenticateVerifiedGoogleUser({
        database: db,
        identity,
        mode,
        revokeOtherSessions: Boolean(body.revokeOtherSessions),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
        ipAddress: ip,
        sessionTtlMs: SESSION_TTL_MS,
      });

      if (result.revokedOtherSessions) {
        sendToUser(result.userRow.id, {
          type: 'session:revoked',
          reason: 'Sesi perangkat lain diakhiri melalui pemulihan akses akun Google.',
        });
      }

      if (result.isNewUser && result.userRow.role !== 'OWNER') {
        const ownerId = getOwnerUserId();
        if (ownerId) {
          createNotification({
            userId: ownerId,
            actorId: result.userRow.id,
            type: 'system',
            title: 'Anggota Baru Terdaftar via Google',
            body: `${result.userRow.display_name} (@${result.userRow.username}) bergabung menggunakan Google OAuth.`,
            linkTarget: 'owner:members',
          });
        }
      }

      res.cookie(COOKIE_NAME, result.sessionToken, getSessionCookieOptions(req));
      const userObj = sanitizeUser(result.userRow as unknown as AuthUser, result.userRow as unknown as AuthUser);

      res.status(result.isNewUser ? 201 : 200).json({
        user: userObj,
        permissions: result.permissions,
        siteSettings: result.siteSettings,
        isNewUser: result.isNewUser,
        recovered: result.recovered,
      });
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        res.status(err.status).json({
          code: err.code,
          error: err.message,
        });
        return;
      }

      const msg = (err as Error).message || 'Verifikasi Google OAuth gagal.';
      logActivity({
        action: 'GOOGLE_AUTH_FAILED',
        details: msg,
        ipAddress: ip,
      });
      res.status(401).json({
        code: 'GOOGLE_VERIFICATION_FAILED',
        error: msg,
      });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const rawToken = req.cookies?.[COOKIE_NAME];
    if (rawToken) {
      const found = getUserBySessionToken(rawToken);
      db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(rawToken));
      if (found) {
        logActivity({
          userId: found.user.id,
          action: 'LOGOUT',
          targetType: 'user',
          targetId: found.user.id,
          details: 'Logout dari sesi perangkat',
          ipAddress: req.ip || '',
        });
      }
    }
    res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: 0 });
    res.json({ ok: true });
  });

  // Legacy password/OTP routes replaced by Google OAuth
  const legacyAuthPaths = [
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/verify-email',
    '/api/auth/resend-verification',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/change-password',
  ];
  for (const legacyPath of legacyAuthPaths) {
    app.post(legacyPath, (_req, res) => {
      res.status(410).json({
        code: 'USE_GOOGLE_OAUTH',
        error:
          'Autentikasi LUXURY HAVE kini menggunakan Google OAuth. Silakan gunakan tombol "Lanjutkan dengan Google".',
      });
    });
  }

  // =========================
  // UPLOAD MEDIA ENDPOINT
  // =========================

  app.post('/api/upload', requireAuth, (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message || 'Gagal mengunggah file.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'Tidak ada file yang dipilih.' });
        return;
      }

      const category = String(req.body.category || 'post');
      const mime = req.file.mimetype;
      const user = req.authUser!;
      const perms = getRolePermissions(user.role);

      if (['site_bg', 'site_banner', 'room_cover'].includes(category) && user.role !== 'OWNER') {
        fs.unlinkSync(req.file.path);
        res.status(403).json({ error: 'Hanya OWNER yang dapat mengunggah aset platform.' });
        return;
      }

      if (category === 'post' && user.role !== 'OWNER') {
        const isPhoto = mime.startsWith('image/');
        const isVideo = mime.startsWith('video/');
        const isAudio = mime.startsWith('audio/');
        if (
          (isPhoto && !perms.can_upload_photo) ||
          (isVideo && !perms.can_upload_video) ||
          (isAudio && !perms.can_upload_music)
        ) {
          fs.unlinkSync(req.file.path);
          res.status(403).json({ error: 'Jabatan Anda tidak diizinkan mengunggah tipe media ini.' });
          return;
        }
      }

      const url = `/uploads/${req.file.filename}`;
      const mediaType = mime.startsWith('image/')
        ? 'photo'
        : mime.startsWith('video/')
          ? 'video'
          : 'music';

      db.prepare(
        `INSERT INTO media_files (id, uploader_id, filename, original_name, mime_type, size_bytes, category, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        user.id,
        req.file.filename,
        req.file.originalname,
        mime,
        req.file.size,
        category,
        url,
        new Date().toISOString()
      );

      res.status(201).json({
        url,
        mediaType,
        originalName: req.file.originalname,
        sizeBytes: req.file.size,
      });
    });
  });

  // =========================
  // USERS & PROFILES
  // =========================

  app.get('/api/users', requireAuth, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    let rows = db
      .prepare(
        `SELECT * FROM users
         WHERE is_blocked = 0 OR ? = 'OWNER'
         ORDER BY CASE role WHEN 'OWNER' THEN 0 WHEN 'MASTER' THEN 1 WHEN 'VIP' THEN 2 ELSE 3 END, last_active_at DESC`
      )
      .all(req.authUser!.role) as AuthUser[];

    if (q) {
      rows = rows.filter(
        (u) =>
          u.display_name.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          u.role.toLowerCase().includes(q) ||
          (req.authUser!.role === 'OWNER' && u.email.toLowerCase().includes(q))
      );
    }

    res.json({
      users: rows.map((u) => sanitizeUser(u, req.authUser!)),
    });
  });

  app.get('/api/users/:id', requireAuth, (req, res) => {
    const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as
      | AuthUser
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Anggota tidak ditemukan.' });
      return;
    }

    const postCount = (
      db.prepare(`SELECT COUNT(*) as c FROM posts WHERE author_id = ? AND room_id IS NULL`).get(target.id) as {
        c: number;
      }
    ).c;
    const commentCount = (
      db.prepare(`SELECT COUNT(*) as c FROM comments WHERE author_id = ?`).get(target.id) as {
        c: number;
      }
    ).c;
    const likeReceived = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.author_id = ?`
        )
        .get(target.id) as { c: number }
    ).c;

    const showFullActivity = req.authUser!.role === 'OWNER' || req.authUser!.id === target.id;
    const activities = showFullActivity
      ? db
          .prepare(
            `SELECT id, action, target_type, details, created_at FROM activity_logs
             WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
          )
          .all(target.id)
      : db
          .prepare(
            `SELECT id, action, target_type, details, created_at FROM activity_logs
             WHERE user_id = ? AND action IN ('POST_CREATED', 'COMMENT_CREATED', 'JOIN_APPROVED')
             ORDER BY created_at DESC LIMIT 10`
          )
          .all(target.id);

    res.json({
      user: sanitizeUser(target, req.authUser!),
      stats: { postCount, commentCount, likeReceived },
      activities,
    });
  });

  app.patch('/api/profile', requireAuth, (req, res) => {
    const { displayName, username, bio, avatarUrl, bannerUrl, personalBgUrl, personalTheme } =
      req.body as {
        displayName?: string;
        username?: string;
        bio?: string;
        avatarUrl?: string;
        bannerUrl?: string;
        personalBgUrl?: string;
        personalTheme?: string;
      };

    const user = req.authUser!;
    const nextDisplayName =
      typeof displayName === 'string' && displayName.trim().length >= 2
        ? displayName.trim().slice(0, 48)
        : user.display_name;

    let nextUsername = user.username;
    if (typeof username === 'string' && username.trim()) {
      const cleaned = username
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 24);
      if (cleaned.length < 3) {
        res.status(400).json({ error: 'Username minimal 3 karakter alfanumerik.' });
        return;
      }
      const conflict = db
        .prepare(`SELECT id FROM users WHERE username = ? AND id != ?`)
        .get(cleaned, user.id);
      if (conflict) {
        res.status(409).json({ error: 'Username sudah digunakan anggota lain.' });
        return;
      }
      nextUsername = cleaned;
    }

    const nextBio = typeof bio === 'string' ? bio.trim().slice(0, 280) : user.bio;
    const nextAvatar = typeof avatarUrl === 'string' ? avatarUrl : user.avatar_url;
    const nextBanner = typeof bannerUrl === 'string' ? bannerUrl : user.banner_url;
    const nextBg = typeof personalBgUrl === 'string' ? personalBgUrl : user.personal_bg_url;
    const allowedThemes = ['inherit', 'light', 'dark'];
    const nextTheme =
      typeof personalTheme === 'string' && allowedThemes.includes(personalTheme)
        ? personalTheme
        : user.personal_theme;

    db.prepare(
      `UPDATE users SET
        display_name = ?, username = ?, bio = ?, avatar_url = ?, banner_url = ?,
        personal_bg_url = ?, personal_theme = ?
       WHERE id = ?`
    ).run(nextDisplayName, nextUsername, nextBio, nextAvatar, nextBanner, nextBg, nextTheme, user.id);

    const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as AuthUser;
    logActivity({
      userId: user.id,
      action: 'PROFILE_UPDATED',
      targetType: 'user',
      targetId: user.id,
      details: 'Memperbarui profil & tampilan akun',
      ipAddress: req.ip || '',
    });

    broadcastAll({ type: 'user:updated', user: sanitizeUser(updated, null) });
    res.json({ user: sanitizeUser(updated, updated) });
  });

  // =========================
  // POSTS, LIKES & COMMENTS
  // =========================

  function hydratePost(postRow: {
    id: string;
    author_id: string;
    room_id: string | null;
    content: string;
    media_type: string;
    media_url: string;
    media_title: string;
    is_pinned: number;
    created_at: string;
  }, viewer: AuthUser) {
    const author = db.prepare(`SELECT * FROM users WHERE id = ?`).get(postRow.author_id) as AuthUser;
    const likesCount = (
      db.prepare(`SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?`).get(postRow.id) as {
        c: number;
      }
    ).c;
    const likedByMe = Boolean(
      db
        .prepare(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`)
        .get(postRow.id, viewer.id)
    );
    const commentRows = db
      .prepare(
        `SELECT c.*, u.display_name, u.username, u.avatar_url, u.role, u.is_vip
         FROM comments c
         JOIN users u ON u.id = c.author_id
         WHERE c.post_id = ?
         ORDER BY c.created_at ASC`
      )
      .all(postRow.id) as {
      id: string;
      post_id: string;
      author_id: string;
      content: string;
      created_at: string;
      display_name: string;
      username: string;
      avatar_url: string;
      role: UserRole;
      is_vip: number;
    }[];

    return {
      id: postRow.id,
      authorId: postRow.author_id,
      roomId: postRow.room_id,
      content: postRow.content,
      mediaType: postRow.media_type,
      mediaUrl: postRow.media_url,
      mediaTitle: postRow.media_title,
      isPinned: Boolean(postRow.is_pinned),
      createdAt: postRow.created_at,
      author: sanitizeUser(author, viewer),
      likesCount,
      likedByMe,
      comments: commentRows.map((c) => ({
        id: c.id,
        postId: c.post_id,
        authorId: c.author_id,
        content: c.content,
        createdAt: c.created_at,
        author: {
          id: c.author_id,
          displayName: c.display_name,
          username: c.username,
          avatarUrl: c.avatar_url,
          role: c.role,
          isVip: Boolean(c.is_vip),
        },
      })),
    };
  }

  app.get('/api/posts', requireAuth, (req, res) => {
    const mediaType = String(req.query.mediaType || 'all');
    const authorId = String(req.query.authorId || '');
    const roomId = String(req.query.roomId || '');

    if (roomId && req.authUser!.role !== 'OWNER') {
      const member = db
        .prepare(`SELECT 1 FROM room_memberships WHERE room_id = ? AND user_id = ? AND status = 'active'`)
        .get(roomId, req.authUser!.id);
      if (!member) {
        res.status(403).json({ error: 'Anda belum memiliki izin masuk ke ruang khusus ini.' });
        return;
      }
    }

    let sql = `SELECT * FROM posts WHERE ${roomId ? 'room_id = ?' : 'room_id IS NULL'}`;
    const args: string[] = [];
    if (roomId) args.push(roomId);
    if (mediaType !== 'all' && ['photo', 'video', 'music'].includes(mediaType)) {
      sql += ` AND media_type = ?`;
      args.push(mediaType);
    }
    if (authorId) {
      sql += ` AND author_id = ?`;
      args.push(authorId);
    }
    sql += ` ORDER BY is_pinned DESC, created_at DESC LIMIT 60`;

    const rows = db.prepare(sql).all(...args) as {
      id: string;
      author_id: string;
      room_id: string | null;
      content: string;
      media_type: string;
      media_url: string;
      media_title: string;
      is_pinned: number;
      created_at: string;
    }[];

    res.json({
      posts: rows.map((r) => hydratePost(r, req.authUser!)),
    });
  });

  app.post('/api/posts', requireAuth, requirePerm('can_post'), (req, res) => {
    const { content, mediaType, mediaUrl, mediaTitle, roomId } = req.body as {
      content?: string;
      mediaType?: 'none' | 'photo' | 'video' | 'music';
      mediaUrl?: string;
      mediaTitle?: string;
      roomId?: string | null;
    };

    const cleanContent = (content || '').trim();
    const mType = mediaType || 'none';
    const mUrl = (mediaUrl || '').trim();

    if (!cleanContent && !mUrl) {
      res.status(400).json({ error: 'Postingan harus berisi teks atau media.' });
      return;
    }

    const perms = getRolePermissions(req.authUser!.role);
    if (req.authUser!.role !== 'OWNER') {
      if (mType === 'photo' && !perms.can_upload_photo) {
        res.status(403).json({ error: 'Jabatan Anda tidak memiliki izin upload foto.' });
        return;
      }
      if (mType === 'video' && !perms.can_upload_video) {
        res.status(403).json({ error: 'Jabatan Anda tidak memiliki izin upload video.' });
        return;
      }
      if (mType === 'music' && !perms.can_upload_music) {
        res.status(403).json({ error: 'Jabatan Anda tidak memiliki izin upload musik.' });
        return;
      }
    }

    if (roomId && req.authUser!.role !== 'OWNER') {
      const member = db
        .prepare(`SELECT 1 FROM room_memberships WHERE room_id = ? AND user_id = ? AND status = 'active'`)
        .get(roomId, req.authUser!.id);
      if (!member) {
        res.status(403).json({ error: 'Anda belum disetujui masuk ke ruang ini.' });
        return;
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO posts (id, author_id, room_id, content, media_type, media_url, media_title, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(id, req.authUser!.id, roomId || null, cleanContent, mType, mUrl, (mediaTitle || '').trim(), now, now);

    logActivity({
      userId: req.authUser!.id,
      action: 'POST_CREATED',
      targetType: 'post',
      targetId: id,
      details: `Membuat postingan (${mType})`,
      ipAddress: req.ip || '',
    });

    const row = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id) as {
      id: string;
      author_id: string;
      room_id: string | null;
      content: string;
      media_type: string;
      media_url: string;
      media_title: string;
      is_pinned: number;
      created_at: string;
    };
    const hydrated = hydratePost(row, req.authUser!);
    broadcastAll({ type: 'post:created', post: hydrated });
    res.status(201).json({ post: hydrated });
  });

  app.post('/api/posts/:id/like', requireAuth, requirePerm('can_like'), (req, res) => {
    const post = db.prepare(`SELECT id, author_id FROM posts WHERE id = ?`).get(req.params.id) as
      | { id: string; author_id: string }
      | undefined;
    if (!post) {
      res.status(404).json({ error: 'Postingan tidak ditemukan.' });
      return;
    }

    const existing = db
      .prepare(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`)
      .get(post.id, req.authUser!.id);

    let liked: boolean;
    if (existing) {
      db.prepare(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`).run(
        post.id,
        req.authUser!.id
      );
      liked = false;
    } else {
      db.prepare(`INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)`).run(
        post.id,
        req.authUser!.id,
        new Date().toISOString()
      );
      liked = true;
      if (post.author_id !== req.authUser!.id) {
        createNotification({
          userId: post.author_id,
          actorId: req.authUser!.id,
          type: 'like',
          title: 'Suka Baru',
          body: `${req.authUser!.display_name} menyukai postingan Anda.`,
          linkTarget: `post:${post.id}`,
        });
      }
    }

    const likesCount = (
      db.prepare(`SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?`).get(post.id) as {
        c: number;
      }
    ).c;

    broadcastAll({
      type: 'post:liked',
      postId: post.id,
      userId: req.authUser!.id,
      liked,
      likesCount,
    });
    res.json({ liked, likesCount });
  });

  app.post('/api/posts/:id/comments', requireAuth, requirePerm('can_comment'), (req, res) => {
    const post = db.prepare(`SELECT id, author_id FROM posts WHERE id = ?`).get(req.params.id) as
      | { id: string; author_id: string }
      | undefined;
    if (!post) {
      res.status(404).json({ error: 'Postingan tidak ditemukan.' });
      return;
    }

    const content = String(req.body.content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Komentar tidak boleh kosong.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO comments (id, post_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(id, post.id, req.authUser!.id, content.slice(0, 1000), now);

    if (post.author_id !== req.authUser!.id) {
      createNotification({
        userId: post.author_id,
        actorId: req.authUser!.id,
        type: 'comment',
        title: 'Komentar Baru',
        body: `${req.authUser!.display_name} mengomentari postingan Anda.`,
        linkTarget: `post:${post.id}`,
      });
    }

    logActivity({
      userId: req.authUser!.id,
      action: 'COMMENT_CREATED',
      targetType: 'post',
      targetId: post.id,
      details: 'Menambahkan komentar pada postingan',
      ipAddress: req.ip || '',
    });

    const comment = {
      id,
      postId: post.id,
      authorId: req.authUser!.id,
      content: content.slice(0, 1000),
      createdAt: now,
      author: {
        id: req.authUser!.id,
        displayName: req.authUser!.display_name,
        username: req.authUser!.username,
        avatarUrl: req.authUser!.avatar_url,
        role: req.authUser!.role,
        isVip: Boolean(req.authUser!.is_vip),
      },
    };

    broadcastAll({ type: 'comment:created', postId: post.id, comment });
    res.status(201).json({ comment });
  });

  app.delete('/api/posts/:id', requireAuth, (req, res) => {
    const post = db.prepare(`SELECT id, author_id FROM posts WHERE id = ?`).get(req.params.id) as
      | { id: string; author_id: string }
      | undefined;
    if (!post) {
      res.status(404).json({ error: 'Postingan tidak ditemukan.' });
      return;
    }
    if (req.authUser!.role !== 'OWNER' && post.author_id !== req.authUser!.id) {
      res.status(403).json({ error: 'Anda tidak memiliki izin menghapus postingan ini.' });
      return;
    }

    db.prepare(`DELETE FROM posts WHERE id = ?`).run(post.id);
    logActivity({
      userId: req.authUser!.id,
      action: 'POST_DELETED',
      targetType: 'post',
      targetId: post.id,
      details: 'Menghapus postingan',
      ipAddress: req.ip || '',
    });
    broadcastAll({ type: 'post:deleted', postId: post.id });
    res.json({ ok: true });
  });

  app.patch('/api/posts/:id/pin', requireAuth, requireOwner, (req, res) => {
    const post = db.prepare(`SELECT id, is_pinned FROM posts WHERE id = ?`).get(req.params.id) as
      | { id: string; is_pinned: number }
      | undefined;
    if (!post) {
      res.status(404).json({ error: 'Postingan tidak ditemukan.' });
      return;
    }
    const nextPinned = post.is_pinned ? 0 : 1;
    db.prepare(`UPDATE posts SET is_pinned = ? WHERE id = ?`).run(nextPinned, post.id);
    broadcastAll({ type: 'post:pinned', postId: post.id, isPinned: Boolean(nextPinned) });
    res.json({ isPinned: Boolean(nextPinned) });
  });

  // =========================
  // PRIVATE MESSAGING (DM)
  // =========================

  app.get('/api/dm/conversations', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const peerRows = db
      .prepare(
        `SELECT DISTINCT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END as peer_id
         FROM direct_messages
         WHERE sender_id = ? OR recipient_id = ?`
      )
      .all(uid, uid, uid) as { peer_id: string }[];

    const conversations = peerRows
      .map(({ peer_id }) => {
        const peer = db.prepare(`SELECT * FROM users WHERE id = ?`).get(peer_id) as AuthUser | undefined;
        if (!peer) return null;
        const lastMsg = db
          .prepare(
            `SELECT * FROM direct_messages
             WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(uid, peer_id, peer_id, uid) as
          | { id: string; content: string; media_type: string; sender_id: string; created_at: string }
          | undefined;
        const unreadCount = (
          db
            .prepare(
              `SELECT COUNT(*) as c FROM direct_messages
               WHERE sender_id = ? AND recipient_id = ? AND is_read = 0`
            )
            .get(peer_id, uid) as { c: number }
        ).c;

        return {
          peer: sanitizeUser(peer, req.authUser!),
          lastMessage: lastMsg
            ? {
                id: lastMsg.id,
                content: lastMsg.content,
                mediaType: lastMsg.media_type,
                senderId: lastMsg.sender_id,
                createdAt: lastMsg.created_at,
              }
            : null,
          unreadCount,
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        (b!.lastMessage?.createdAt || '').localeCompare(a!.lastMessage?.createdAt || '')
      );

    res.json({ conversations });
  });

  app.get('/api/dm/:peerId', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const peerId = req.params.peerId;
    const peer = db.prepare(`SELECT * FROM users WHERE id = ?`).get(peerId) as AuthUser | undefined;
    if (!peer) {
      res.status(404).json({ error: 'Pengguna tujuan tidak ditemukan.' });
      return;
    }

    db.prepare(
      `UPDATE direct_messages SET is_read = 1 WHERE sender_id = ? AND recipient_id = ? AND is_read = 0`
    ).run(peerId, uid);

    const messages = db
      .prepare(
        `SELECT * FROM direct_messages
         WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
         ORDER BY created_at ASC LIMIT 200`
      )
      .all(uid, peerId, peerId, uid) as {
      id: string;
      sender_id: string;
      recipient_id: string;
      content: string;
      media_type: string;
      media_url: string;
      is_read: number;
      created_at: string;
    }[];

    sendToUser(peerId, { type: 'dm:read', byUserId: uid });

    res.json({
      peer: sanitizeUser(peer, req.authUser!),
      messages: messages.map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        recipientId: m.recipient_id,
        content: m.content,
        mediaType: m.media_type,
        mediaUrl: m.media_url,
        isRead: Boolean(m.is_read),
        createdAt: m.created_at,
      })),
    });
  });

  app.post('/api/dm/:peerId', requireAuth, requirePerm('can_dm'), (req, res) => {
    const uid = req.authUser!.id;
    const peerId = req.params.peerId;
    const peer = db.prepare(`SELECT * FROM users WHERE id = ?`).get(peerId) as AuthUser | undefined;
    if (!peer) {
      res.status(404).json({ error: 'Pengguna tujuan tidak ditemukan.' });
      return;
    }

    const { content, mediaType, mediaUrl } = req.body as {
      content?: string;
      mediaType?: 'none' | 'photo' | 'video' | 'music';
      mediaUrl?: string;
    };
    const cleanContent = (content || '').trim();
    const mType = mediaType || 'none';
    const mUrl = (mediaUrl || '').trim();
    if (!cleanContent && !mUrl) {
      res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO direct_messages (id, sender_id, recipient_id, content, media_type, media_url, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(id, uid, peerId, cleanContent, mType, mUrl, now);

    const payload = {
      id,
      senderId: uid,
      recipientId: peerId,
      content: cleanContent,
      mediaType: mType,
      mediaUrl: mUrl,
      isRead: false,
      createdAt: now,
    };

    sendToUser(peerId, {
      type: 'dm:received',
      message: payload,
      sender: sanitizeUser(req.authUser!, peer),
    });
    sendToUser(uid, {
      type: 'dm:received',
      message: payload,
      sender: sanitizeUser(req.authUser!, req.authUser!),
    });

    createNotification({
      userId: peerId,
      actorId: uid,
      type: 'dm',
      title: 'Pesan Pribadi Baru',
      body: `${req.authUser!.display_name}: ${cleanContent || 'Mengirim lampiran media'}`,
      linkTarget: `dm:${uid}`,
    });

    res.status(201).json({ message: payload });
  });

  // =========================
  // EXCLUSIVE ROOMS & JOIN REQUESTS
  // =========================

  app.get('/api/rooms', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const rooms = db.prepare(`SELECT * FROM rooms ORDER BY created_at ASC`).all() as {
      id: string;
      name: string;
      description: string;
      cover_url: string;
      min_role: string;
      requires_approval: number;
      created_at: string;
    }[];

    const out = rooms.map((r) => {
      const membership = db
        .prepare(`SELECT status FROM room_memberships WHERE room_id = ? AND user_id = ?`)
        .get(r.id, uid) as { status: string } | undefined;
      const latestReq = db
        .prepare(
          `SELECT id, status, message, review_note, created_at FROM join_requests
           WHERE room_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(r.id, uid) as
        | { id: string; status: string; message: string; review_note: string; created_at: string }
        | undefined;
      const memberCount = (
        db
          .prepare(`SELECT COUNT(*) as c FROM room_memberships WHERE room_id = ? AND status = 'active'`)
          .get(r.id) as { c: number }
      ).c;

      const isMember = req.authUser!.role === 'OWNER' || membership?.status === 'active';
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        coverUrl: r.cover_url,
        minRole: r.min_role,
        requiresApproval: Boolean(r.requires_approval),
        memberCount,
        isMember,
        requestStatus: latestReq?.status || 'none',
        reviewNote: latestReq?.review_note || '',
        createdAt: r.created_at,
      };
    });

    res.json({ rooms: out });
  });

  app.post('/api/rooms/:id/join-request', requireAuth, requirePerm('can_request_rooms'), (req, res) => {
    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(req.params.id) as
      | { id: string; name: string }
      | undefined;
    if (!room) {
      res.status(404).json({ error: 'Ruang khusus tidak ditemukan.' });
      return;
    }

    const existingMembership = db
      .prepare(`SELECT status FROM room_memberships WHERE room_id = ? AND user_id = ?`)
      .get(room.id, req.authUser!.id) as { status: string } | undefined;
    if (existingMembership?.status === 'active' || req.authUser!.role === 'OWNER') {
      res.status(400).json({ error: 'Anda sudah memiliki akses masuk ke ruang ini.' });
      return;
    }

    const existingPending = db
      .prepare(`SELECT id FROM join_requests WHERE room_id = ? AND user_id = ? AND status = 'pending'`)
      .get(room.id, req.authUser!.id);
    if (existingPending) {
      res.status(400).json({ error: 'Permintaan masuk Anda masih menunggu persetujuan OWNER.' });
      return;
    }

    const message = String(req.body.message || '').trim().slice(0, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO join_requests (id, room_id, user_id, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).run(id, room.id, req.authUser!.id, message, now, now);

    const ownerId = getOwnerUserId();
    if (ownerId) {
      createNotification({
        userId: ownerId,
        actorId: req.authUser!.id,
        type: 'join_request',
        title: 'Permintaan Join Ruang Khusus',
        body: `${req.authUser!.display_name} mengajukan izin masuk ke "${room.name}".`,
        linkTarget: 'owner:join-requests',
      });
      sendToUser(ownerId, { type: 'join_request:updated' });
    }

    logActivity({
      userId: req.authUser!.id,
      action: 'JOIN_REQUEST_SENT',
      targetType: 'room',
      targetId: room.id,
      details: `Mengajukan permintaan masuk ke ${room.name}`,
      ipAddress: req.ip || '',
    });

    res.status(201).json({ ok: true, id, status: 'pending' });
  });

  app.get('/api/rooms/:id/messages', requireAuth, (req, res) => {
    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(req.params.id);
    if (!room) {
      res.status(404).json({ error: 'Ruang tidak ditemukan.' });
      return;
    }

    if (req.authUser!.role !== 'OWNER') {
      const m = db
        .prepare(`SELECT status FROM room_memberships WHERE room_id = ? AND user_id = ?`)
        .get(req.params.id, req.authUser!.id) as { status: string } | undefined;
      if (m?.status !== 'active') {
        res.status(403).json({ error: 'Akses ruang membutuhkan persetujuan OWNER.' });
        return;
      }
    }

    const rows = db
      .prepare(
        `SELECT rm.*, u.display_name, u.username, u.avatar_url, u.role, u.is_vip
         FROM room_messages rm
         JOIN users u ON u.id = rm.sender_id
         WHERE rm.room_id = ?
         ORDER BY rm.created_at ASC LIMIT 150`
      )
      .all(req.params.id) as {
      id: string;
      room_id: string;
      sender_id: string;
      content: string;
      media_type: string;
      media_url: string;
      created_at: string;
      display_name: string;
      username: string;
      avatar_url: string;
      role: UserRole;
      is_vip: number;
    }[];

    res.json({
      messages: rows.map((m) => ({
        id: m.id,
        roomId: m.room_id,
        senderId: m.sender_id,
        content: m.content,
        mediaType: m.media_type,
        mediaUrl: m.media_url,
        createdAt: m.created_at,
        sender: {
          id: m.sender_id,
          displayName: m.display_name,
          username: m.username,
          avatarUrl: m.avatar_url,
          role: m.role,
          isVip: Boolean(m.is_vip),
        },
      })),
    });
  });

  app.post('/api/rooms/:id/messages', requireAuth, (req, res) => {
    const roomId = req.params.id;
    const room = db.prepare(`SELECT id FROM rooms WHERE id = ?`).get(roomId);
    if (!room) {
      res.status(404).json({ error: 'Ruang tidak ditemukan.' });
      return;
    }

    if (req.authUser!.role !== 'OWNER') {
      const m = db
        .prepare(`SELECT status FROM room_memberships WHERE room_id = ? AND user_id = ?`)
        .get(roomId, req.authUser!.id) as { status: string } | undefined;
      if (m?.status !== 'active') {
        res.status(403).json({ error: 'Anda belum disetujui masuk ke ruang ini.' });
        return;
      }
    }

    const { content, mediaType, mediaUrl } = req.body as {
      content?: string;
      mediaType?: 'none' | 'photo' | 'video' | 'music';
      mediaUrl?: string;
    };
    const cleanContent = (content || '').trim();
    const mType = mediaType || 'none';
    const mUrl = (mediaUrl || '').trim();
    if (!cleanContent && !mUrl) {
      res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO room_messages (id, room_id, sender_id, content, media_type, media_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, roomId, req.authUser!.id, cleanContent, mType, mUrl, now);

    const payload = {
      id,
      roomId,
      senderId: req.authUser!.id,
      content: cleanContent,
      mediaType: mType,
      mediaUrl: mUrl,
      createdAt: now,
      sender: {
        id: req.authUser!.id,
        displayName: req.authUser!.display_name,
        username: req.authUser!.username,
        avatarUrl: req.authUser!.avatar_url,
        role: req.authUser!.role,
        isVip: Boolean(req.authUser!.is_vip),
      },
    };

    // Deliver only to active room members and OWNER
    const memberIds = db
      .prepare(`SELECT user_id FROM room_memberships WHERE room_id = ? AND status = 'active'`)
      .all(roomId) as { user_id: string }[];
    const ownerId = getOwnerUserId();
    const targetIds = new Set(memberIds.map((m) => m.user_id));
    if (ownerId) targetIds.add(ownerId);
    for (const uid of targetIds) {
      sendToUser(uid, { type: 'room:message', roomId, message: payload });
    }

    res.status(201).json({ message: payload });
  });

  // =========================
  // NOTIFICATIONS & ACTIVITY
  // =========================

  app.get('/api/notifications', requireAuth, (req, res) => {
    const rows = db
      .prepare(
        `SELECT n.*, u.display_name as actor_name, u.avatar_url as actor_avatar
         FROM notifications n
         LEFT JOIN users u ON u.id = n.actor_id
         WHERE n.user_id = ?
         ORDER BY n.created_at DESC LIMIT 60`
      )
      .all(req.authUser!.id) as {
      id: string;
      user_id: string;
      actor_id: string | null;
      type: string;
      title: string;
      body: string;
      link_target: string;
      is_read: number;
      created_at: string;
      actor_name: string | null;
      actor_avatar: string | null;
    }[];

    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        linkTarget: n.link_target,
        isRead: Boolean(n.is_read),
        createdAt: n.created_at,
        actorName: n.actor_name,
        actorAvatar: n.actor_avatar,
      })),
    });
  });

  app.post('/api/notifications/read-all', requireAuth, (req, res) => {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.authUser!.id);
    res.json({ ok: true });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(
      req.params.id,
      req.authUser!.id
    );
    res.json({ ok: true });
  });

  // =========================
  // OWNER DASHBOARD ENDPOINTS
  // =========================

  app.get('/api/owner/overview', requireAuth, requireOwner, (_req, res) => {
    const totalMembers = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
    const totalPosts = (db.prepare(`SELECT COUNT(*) as c FROM posts`).get() as { c: number }).c;
    const pendingJoinRequests = (
      db.prepare(`SELECT COUNT(*) as c FROM join_requests WHERE status = 'pending'`).get() as {
        c: number;
      }
    ).c;
    const activeSessions = (
      db
        .prepare(`SELECT COUNT(*) as c FROM sessions WHERE expires_at > ?`)
        .get(new Date().toISOString()) as { c: number }
    ).c;

    res.json({
      stats: {
        totalMembers,
        onlineMembers: onlineSockets.size,
        totalPosts,
        pendingJoinRequests,
        activeSessions,
        googleOAuthConfigured: getGoogleAuthConfigStatus().configured,
      },
      googleAuth: getGoogleAuthConfigStatus(),
    });
  });

  app.get('/api/owner/members', requireAuth, requireOwner, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT u.*,
          (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) as active_sessions
         FROM users u
         ORDER BY CASE u.role WHEN 'OWNER' THEN 0 WHEN 'MASTER' THEN 1 WHEN 'VIP' THEN 2 ELSE 3 END, u.created_at DESC`
      )
      .all(new Date().toISOString()) as (AuthUser & { active_sessions: number })[];

    res.json({
      members: rows.map((r) => ({
        ...sanitizeUser(r, _req.authUser!),
        activeSessions: r.active_sessions,
      })),
    });
  });

  app.patch('/api/owner/members/:id/role', requireAuth, requireOwner, (req, res) => {
    const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as
      | AuthUser
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Anggota tidak ditemukan.' });
      return;
    }

    const isTargetOwner =
      target.email.trim().toLowerCase() === OWNER_EMAIL.trim().toLowerCase();
    if (isTargetOwner || target.role === 'OWNER') {
      res.status(403).json({ error: 'Jabatan OWNER utama bersifat mutlak dan tidak dapat diubah.' });
      return;
    }

    const { role } = req.body as { role?: string };
    if (!role || !['MASTER', 'VIP', 'MEMBER'].includes(role)) {
      res.status(400).json({ error: 'Jabatan tidak valid. Pilih MASTER, VIP, atau MEMBER.' });
      return;
    }

    const isVip = role === 'VIP' || role === 'MASTER' ? 1 : target.is_vip;
    db.prepare(`UPDATE users SET role = ?, is_vip = ? WHERE id = ?`).run(role, isVip, target.id);

    const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(target.id) as AuthUser;
    createNotification({
      userId: target.id,
      actorId: req.authUser!.id,
      type: 'role',
      title: 'Perubahan Jabatan',
      body: `OWNER menetapkan jabatan Anda menjadi ${role}.`,
      linkTarget: `profile:${target.id}`,
    });

    logActivity({
      userId: req.authUser!.id,
      action: 'ROLE_UPDATED',
      targetType: 'user',
      targetId: target.id,
      details: `Mengubah jabatan ${target.username} menjadi ${role}`,
      ipAddress: req.ip || '',
    });

    sendToUser(target.id, {
      type: 'permissions:updated',
      role,
      permissions: getRolePermissions(role as UserRole),
    });
    broadcastAll({ type: 'user:updated', user: sanitizeUser(updated, null) });
    res.json({ member: sanitizeUser(updated, req.authUser!) });
  });

  app.patch('/api/owner/members/:id/vip', requireAuth, requireOwner, (req, res) => {
    const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as
      | AuthUser
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Anggota tidak ditemukan.' });
      return;
    }

    const { isVip, vipTier, vipExpiresAt } = req.body as {
      isVip?: boolean;
      vipTier?: string;
      vipExpiresAt?: string | null;
    };

    const nextVip = isVip ? 1 : 0;
    const nextRole =
      target.role === 'OWNER'
        ? 'OWNER'
        : nextVip && target.role === 'MEMBER'
          ? 'VIP'
          : !nextVip && target.role === 'VIP'
            ? 'MEMBER'
            : target.role;

    db.prepare(`UPDATE users SET is_vip = ?, vip_tier = ?, vip_expires_at = ?, role = ? WHERE id = ?`).run(
      nextVip,
      (vipTier || '').trim().slice(0, 32),
      vipExpiresAt || null,
      nextRole,
      target.id
    );

    const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(target.id) as AuthUser;
    createNotification({
      userId: target.id,
      actorId: req.authUser!.id,
      type: 'role',
      title: nextVip ? 'Status VIP Diaktifkan' : 'Status VIP Dicabut',
      body: nextVip
        ? `OWNER memberikan status VIP ${vipTier || 'Eksklusif'} kepada Anda.`
        : 'Status VIP Anda telah dicabut oleh OWNER.',
    });

    logActivity({
      userId: req.authUser!.id,
      action: nextVip ? 'VIP_GRANTED' : 'VIP_REVOKED',
      targetType: 'user',
      targetId: target.id,
      details: `${nextVip ? 'Memberikan' : 'Mencabut'} VIP pada ${target.username}`,
      ipAddress: req.ip || '',
    });

    sendToUser(target.id, {
      type: 'permissions:updated',
      role: nextRole,
      permissions: getRolePermissions(nextRole as UserRole),
    });
    broadcastAll({ type: 'user:updated', user: sanitizeUser(updated, null) });
    res.json({ member: sanitizeUser(updated, req.authUser!) });
  });

  app.patch('/api/owner/members/:id/block', requireAuth, requireOwner, (req, res) => {
    const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as
      | AuthUser
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Anggota tidak ditemukan.' });
      return;
    }
    if (target.role === 'OWNER') {
      res.status(403).json({ error: 'Akun OWNER utama tidak dapat diblokir.' });
      return;
    }

    const { isBlocked, reason } = req.body as { isBlocked?: boolean; reason?: string };
    const nextBlocked = isBlocked ? 1 : 0;
    db.prepare(`UPDATE users SET is_blocked = ?, block_reason = ? WHERE id = ?`).run(
      nextBlocked,
      (reason || '').trim().slice(0, 200),
      target.id
    );

    if (nextBlocked) {
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(target.id);
      sendToUser(target.id, {
        type: 'session:revoked',
        reason: reason || 'Akun Anda telah diblokir oleh OWNER.',
      });
    }

    logActivity({
      userId: req.authUser!.id,
      action: nextBlocked ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
      targetType: 'user',
      targetId: target.id,
      details: `${nextBlocked ? 'Memblokir' : 'Membuka blokir'} ${target.username}`,
      ipAddress: req.ip || '',
    });

    const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(target.id) as AuthUser;
    broadcastAll({ type: 'user:updated', user: sanitizeUser(updated, null) });
    res.json({ member: sanitizeUser(updated, req.authUser!) });
  });

  app.patch('/api/owner/members/:id/verify', requireAuth, requireOwner, (req, res) => {
    const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as
      | AuthUser
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Anggota tidak ditemukan.' });
      return;
    }
    db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(target.id);
    logActivity({
      userId: req.authUser!.id,
      action: 'USER_EMAIL_VERIFIED_BY_OWNER',
      targetType: 'user',
      targetId: target.id,
      details: `Memverifikasi email ${target.username} secara manual`,
      ipAddress: req.ip || '',
    });
    const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(target.id) as AuthUser;
    res.json({ member: sanitizeUser(updated, req.authUser!) });
  });

  app.post('/api/owner/members/:id/revoke-sessions', requireAuth, requireOwner, (req, res) => {
    if (req.params.id === req.authUser!.id) {
      res.status(400).json({ error: 'Gunakan logout untuk keluar dari sesi sendiri.' });
      return;
    }
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(req.params.id);
    sendToUser(req.params.id, {
      type: 'session:revoked',
      reason: 'Sesi Anda dihentikan oleh OWNER.',
    });
    res.json({ ok: true });
  });

  app.get('/api/owner/permissions', requireAuth, requireOwner, (_req, res) => {
    const rows = db.prepare(`SELECT * FROM role_permissions`).all() as RolePermissionRow[];
    res.json({ permissions: rows });
  });

  app.patch('/api/owner/permissions/:role', requireAuth, requireOwner, (req, res) => {
    const role = req.params.role as UserRole;
    if (!['MASTER', 'VIP', 'MEMBER'].includes(role)) {
      res.status(400).json({ error: 'Hanya izin MASTER, VIP, dan MEMBER yang dapat diubah.' });
      return;
    }

    const current = getRolePermissions(role);
    const body = req.body as Partial<Record<keyof RolePermissionRow, boolean | number>>;
    const toInt = (val: boolean | number | undefined, fallback: number) =>
      val === undefined ? fallback : val ? 1 : 0;

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE role_permissions SET
        can_post = ?, can_comment = ?, can_like = ?,
        can_upload_photo = ?, can_upload_video = ?, can_upload_music = ?,
        can_dm = ?, can_voice_call = ?, can_video_call = ?,
        can_screen_share = ?, can_request_rooms = ?, updated_at = ?
       WHERE role = ?`
    ).run(
      toInt(body.can_post, current.can_post),
      toInt(body.can_comment, current.can_comment),
      toInt(body.can_like, current.can_like),
      toInt(body.can_upload_photo, current.can_upload_photo),
      toInt(body.can_upload_video, current.can_upload_video),
      toInt(body.can_upload_music, current.can_upload_music),
      toInt(body.can_dm, current.can_dm),
      toInt(body.can_voice_call, current.can_voice_call),
      toInt(body.can_video_call, current.can_video_call),
      toInt(body.can_screen_share, current.can_screen_share),
      toInt(body.can_request_rooms, current.can_request_rooms),
      now,
      role
    );

    const updated = getRolePermissions(role);
    logActivity({
      userId: req.authUser!.id,
      action: 'ROLE_PERMISSIONS_UPDATED',
      targetType: 'role',
      targetId: role,
      details: `Memperbarui matriks izin untuk jabatan ${role}`,
      ipAddress: req.ip || '',
    });

    broadcastAll({ type: 'permissions:updated', role, permissions: updated });
    res.json({ permission: updated });
  });

  app.patch('/api/owner/settings', requireAuth, requireOwner, (req, res) => {
    const allowedKeys = [
      'platform_name',
      'platform_tagline',
      'theme_preset',
      'theme_mode',
      'accent_color',
      'glass_opacity',
      'border_radius',
      'layout_density',
      'background_type',
      'background_url',
      'hero_banner_url',
      'glow_intensity',
      'allow_registration',
    ];

    const updates = req.body as Record<string, unknown>;
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );

    for (const key of allowedKeys) {
      if (updates[key] !== undefined && updates[key] !== null) {
        upsert.run(key, String(updates[key]).slice(0, 500), now);
      }
    }

    logActivity({
      userId: req.authUser!.id,
      action: 'SITE_SETTINGS_UPDATED',
      targetType: 'settings',
      details: 'Memperbarui konfigurasi tema, background, atau sistem platform',
      ipAddress: req.ip || '',
    });

    const settings = getSiteSettingsMap();
    broadcastAll({ type: 'settings:updated', siteSettings: settings });
    res.json({ siteSettings: settings });
  });

  app.get('/api/owner/activity', requireAuth, requireOwner, (req, res) => {
    const actionFilter = String(req.query.action || '').trim();
    const rows = actionFilter
      ? db
          .prepare(
            `SELECT a.*, u.display_name, u.username, u.role
             FROM activity_logs a
             LEFT JOIN users u ON u.id = a.user_id
             WHERE a.action = ?
             ORDER BY a.created_at DESC LIMIT 150`
          )
          .all(actionFilter)
      : db
          .prepare(
            `SELECT a.*, u.display_name, u.username, u.role
             FROM activity_logs a
             LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.created_at DESC LIMIT 150`
          )
          .all();

    res.json({ activities: rows });
  });

  app.get('/api/owner/join-requests', requireAuth, requireOwner, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT jr.*, r.name as room_name, r.cover_url as room_cover,
                u.display_name, u.username, u.email, u.avatar_url, u.role, u.is_vip, u.last_active_at
         FROM join_requests jr
         JOIN rooms r ON r.id = jr.room_id
         JOIN users u ON u.id = jr.user_id
         ORDER BY CASE jr.status WHEN 'pending' THEN 0 ELSE 1 END, jr.created_at DESC`
      )
      .all() as {
      id: string;
      room_id: string;
      user_id: string;
      message: string;
      status: string;
      review_note: string;
      created_at: string;
      updated_at: string;
      room_name: string;
      room_cover: string;
      display_name: string;
      username: string;
      email: string;
      avatar_url: string;
      role: UserRole;
      is_vip: number;
      last_active_at: string;
    }[];

    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        roomId: r.room_id,
        roomName: r.room_name,
        roomCover: r.room_cover,
        userId: r.user_id,
        message: r.message,
        status: r.status,
        reviewNote: r.review_note,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        applicant: {
          id: r.user_id,
          displayName: r.display_name,
          username: r.username,
          email: r.email,
          avatarUrl: r.avatar_url,
          role: r.role,
          isVip: Boolean(r.is_vip),
          online: isUserOnline(r.user_id),
          lastActiveAt: r.last_active_at,
        },
      })),
    });
  });

  app.post('/api/owner/join-requests/:id/decide', requireAuth, requireOwner, (req, res) => {
    const reqRow = db
      .prepare(
        `SELECT jr.*, r.name as room_name FROM join_requests jr
         JOIN rooms r ON r.id = jr.room_id
         WHERE jr.id = ?`
      )
      .get(req.params.id) as
      | { id: string; room_id: string; user_id: string; room_name: string; status: string }
      | undefined;

    if (!reqRow) {
      res.status(404).json({ error: 'Permintaan join tidak ditemukan.' });
      return;
    }

    const { decision, reviewNote } = req.body as {
      decision?: 'approved' | 'rejected' | 'revoked';
      reviewNote?: string;
    };
    if (!decision || !['approved', 'rejected', 'revoked'].includes(decision)) {
      res.status(400).json({ error: 'Keputusan tidak valid.' });
      return;
    }

    const now = new Date().toISOString();
    const note = (reviewNote || '').trim().slice(0, 300);
    db.prepare(
      `UPDATE join_requests SET status = ?, reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?`
    ).run(decision, req.authUser!.id, note, now, reqRow.id);

    if (decision === 'approved') {
      db.prepare(
        `INSERT INTO room_memberships (room_id, user_id, status, granted_by, created_at)
         VALUES (?, ?, 'active', ?, ?)
         ON CONFLICT(room_id, user_id) DO UPDATE SET status = 'active', granted_by = excluded.granted_by`
      ).run(reqRow.room_id, reqRow.user_id, req.authUser!.id, now);
    } else {
      db.prepare(
        `INSERT INTO room_memberships (room_id, user_id, status, granted_by, created_at)
         VALUES (?, ?, 'revoked', ?, ?)
         ON CONFLICT(room_id, user_id) DO UPDATE SET status = 'revoked', granted_by = excluded.granted_by`
      ).run(reqRow.room_id, reqRow.user_id, req.authUser!.id, now);
    }

    const titleMap = {
      approved: 'Permintaan Ruang Disetujui',
      rejected: 'Permintaan Ruang Ditolak',
      revoked: 'Izin Ruang Dicabut',
    };
    const bodyMap = {
      approved: `OWNER menyetujui Anda masuk ke ruang "${reqRow.room_name}".`,
      rejected: `Permintaan Anda masuk ke "${reqRow.room_name}" ditolak.${note ? ` Catatan: ${note}` : ''}`,
      revoked: `Izin masuk Anda ke "${reqRow.room_name}" telah dicabut oleh OWNER.`,
    };

    createNotification({
      userId: reqRow.user_id,
      actorId: req.authUser!.id,
      type: decision === 'approved' ? 'join_approved' : 'join_rejected',
      title: titleMap[decision],
      body: bodyMap[decision],
      linkTarget: `room:${reqRow.room_id}`,
    });

    sendToUser(reqRow.user_id, { type: 'room:updated', roomId: reqRow.room_id });

    logActivity({
      userId: req.authUser!.id,
      action: `JOIN_${decision.toUpperCase()}`,
      targetType: 'room',
      targetId: reqRow.room_id,
      details: `${titleMap[decision]} untuk user ${reqRow.user_id}`,
      ipAddress: req.ip || '',
    });

    res.json({ ok: true, status: decision });
  });

  app.post('/api/owner/rooms', requireAuth, requireOwner, (req, res) => {
    const { name, description, coverUrl, minRole } = req.body as {
      name?: string;
      description?: string;
      coverUrl?: string;
      minRole?: UserRole;
    };
    if (!name || name.trim().length < 2) {
      res.status(400).json({ error: 'Nama ruang minimal 2 karakter.' });
      return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO rooms (id, name, description, cover_url, min_role, requires_approval, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      id,
      name.trim().slice(0, 60),
      (description || '').trim().slice(0, 240),
      coverUrl || '/brand-assets/luxury_room_sanctuary_1794784330937.jpg',
      minRole || 'MEMBER',
      req.authUser!.id,
      now
    );
    db.prepare(
      `INSERT OR IGNORE INTO room_memberships (room_id, user_id, status, granted_by, created_at)
       VALUES (?, ?, 'active', ?, ?)`
    ).run(id, req.authUser!.id, req.authUser!.id, now);

    broadcastAll({ type: 'room:updated', roomId: id });
    res.status(201).json({ id });
  });

  app.delete('/api/owner/rooms/:id', requireAuth, requireOwner, (req, res) => {
    db.prepare(`DELETE FROM rooms WHERE id = ?`).run(req.params.id);
    broadcastAll({ type: 'room:updated', roomId: req.params.id });
    res.json({ ok: true });
  });

  app.get('/api/owner/sessions', requireAuth, requireOwner, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT s.id, s.user_id, s.device_info, s.ip_address, s.expires_at, s.created_at,
                u.display_name, u.username, u.email, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.expires_at > ?
         ORDER BY s.created_at DESC`
      )
      .all(new Date().toISOString());
    res.json({ sessions: rows });
  });

  app.delete('/api/owner/sessions/:id', requireAuth, requireOwner, (req, res) => {
    if (req.params.id === req.sessionId) {
      res.status(400).json({ error: 'Tidak dapat mencabut sesi aktif saat ini dari daftar.' });
      return;
    }
    const s = db.prepare(`SELECT user_id FROM sessions WHERE id = ?`).get(req.params.id) as
      | { user_id: string }
      | undefined;
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(req.params.id);
    if (s) {
      sendToUser(s.user_id, {
        type: 'session:revoked',
        reason: 'Sesi perangkat dicabut oleh OWNER.',
      });
    }
    res.json({ ok: true });
  });

  app.get('/api/owner/backup/json', requireAuth, requireOwner, (_req, res) => {
    // Sanitized JSON backup (never includes password hashes or encrypted SMTP secrets)
    const users = db
      .prepare(
        `SELECT id, email, username, display_name, role, is_vip, vip_tier, vip_expires_at,
                bio, avatar_url, banner_url, personal_bg_url, personal_theme, email_verified,
                is_blocked, block_reason, last_active_at, created_at
         FROM users`
      )
      .all();
    const posts = db.prepare(`SELECT * FROM posts`).all();
    const comments = db.prepare(`SELECT * FROM comments`).all();
    const rooms = db.prepare(`SELECT * FROM rooms`).all();
    const roomMemberships = db.prepare(`SELECT * FROM room_memberships`).all();
    const joinRequests = db.prepare(`SELECT * FROM join_requests`).all();
    const rolePermissions = db.prepare(`SELECT * FROM role_permissions`).all();
    const siteSettings = getSiteSettingsMap();
    const activityLogs = db.prepare(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 1000`).all();

    const payload = {
      exportedAt: new Date().toISOString(),
      platform: 'LUXURY HAVE',
      users,
      posts,
      comments,
      rooms,
      roomMemberships,
      joinRequests,
      rolePermissions,
      siteSettings,
      activityLogs,
    };

    logActivity({
      userId: _req.authUser!.id,
      action: 'BACKUP_EXPORTED',
      details: 'Mengunduh backup data JSON platform',
      ipAddress: _req.ip || '',
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="luxury-have-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  });

  app.post('/api/owner/backup/snapshot', requireAuth, requireOwner, async (req, res) => {
    const filename = `luxury_have_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const destPath = path.join(BACKUPS_DIR, filename);
    await db.backup(destPath);
    const stat = fs.statSync(destPath);

    logActivity({
      userId: req.authUser!.id,
      action: 'DB_SNAPSHOT_CREATED',
      details: `Membuat snapshot SQLite (${filename})`,
      ipAddress: req.ip || '',
    });

    res.status(201).json({
      filename,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    });
  });

  app.get('/api/owner/backup/list', requireAuth, requireOwner, (_req, res) => {
    const files = fs
      .readdirSync(BACKUPS_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUPS_DIR, f));
        return {
          filename: f,
          sizeBytes: st.size,
          createdAt: st.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({ backups: files });
  });

  // =========================
  // HTTP + WEBSOCKET SERVER
  // =========================

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const found = getUserBySessionToken(cookies[COOKIE_NAME]);
    if (!found) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const user = found.user;
    let set = onlineSockets.get(user.id);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      onlineSockets.set(user.id, set);
    }
    set.add(ws);

    const now = new Date().toISOString();
    db.prepare(`UPDATE users SET last_active_at = ? WHERE id = ?`).run(now, user.id);

    if (wasOffline) {
      broadcastAll({
        type: 'presence:update',
        userId: user.id,
        online: true,
        lastActiveAt: now,
      });
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          type: string;
          targetUserId?: string;
          callType?: 'voice' | 'video' | 'screen';
          offer?: unknown;
          answer?: unknown;
          candidate?: unknown;
          reason?: string;
        };

        // WebRTC Call & Screen Share Signaling
        if (
          msg.type &&
          msg.type.startsWith('call:') &&
          msg.targetUserId &&
          msg.targetUserId !== user.id
        ) {
          if (msg.type === 'call:invite') {
            const perms = getRolePermissions(user.role);
            if (user.role !== 'OWNER') {
              if (msg.callType === 'voice' && !perms.can_voice_call) return;
              if (msg.callType === 'video' && !perms.can_video_call) return;
              if (msg.callType === 'screen' && !perms.can_screen_share) return;
            }
          }

          sendToUser(msg.targetUserId, {
            ...msg,
            fromUserId: user.id,
            fromUser: {
              id: user.id,
              displayName: user.display_name,
              username: user.username,
              avatarUrl: user.avatar_url,
              role: user.role,
            },
          });
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      const currentSet = onlineSockets.get(user.id);
      if (currentSet) {
        currentSet.delete(ws);
        if (currentSet.size === 0) {
          onlineSockets.delete(user.id);
          const leftAt = new Date().toISOString();
          db.prepare(`UPDATE users SET last_active_at = ? WHERE id = ?`).run(leftAt, user.id);
          broadcastAll({
            type: 'presence:update',
            userId: user.id,
            online: false,
            lastActiveAt: leftAt,
          });
        }
      }
    });
  });

  // Vite dev middleware or production static build
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.info(`[LUXURY HAVE] Server berjalan di http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[FATAL_SERVER_ERROR]', err);
  process.exit(1);
});
