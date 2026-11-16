import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Ban,
  Check,
  CheckCircle2,
  Crown,
  Database,
  Download,
  FileText,
  Lock,
  MessageSquare,
  Palette,
  Phone,
  Pin,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { apiFetch, formatRelativeTime, getRoleLabel, uploadMedia } from '../lib/api';
import {
  ActivityLogItem,
  GoogleAuthConfigStatus,
  JoinRequestItem,
  PostItem,
  RolePermissions,
  RoomItem,
  SiteSettings,
  User,
  UserRole,
} from '../types';
import { Avatar } from './Avatar';

export type OwnerPanelTab =
  | 'members'
  | 'roles'
  | 'vip'
  | 'theme'
  | 'background'
  | 'posts'
  | 'security'
  | 'activity'
  | 'join-requests'
  | 'system';

interface OwnerDashboardProps {
  initialTab?: OwnerPanelTab;
  siteSettings: SiteSettings;
  posts: PostItem[];
  rooms: RoomItem[];
  onSettingsUpdated: (settings: SiteSettings) => void;
  onRefreshPosts: () => void;
  onRefreshRooms: () => void;
  onRefreshUsers: () => void;
  onOpenProfile: (userId: string) => void;
  onInspectViaDm: (user: User) => void;
  onInspectViaCall: (user: User, type: 'voice' | 'video') => void;
}

const TABS: { id: OwnerPanelTab; label: string; icon: React.ComponentType<{ className?: string }> }[] =
  [
    { id: 'members', label: 'Member Management', icon: Users },
    { id: 'roles', label: 'Role Management', icon: Shield },
    { id: 'vip', label: 'VIP Management', icon: Crown },
    { id: 'theme', label: 'Theme Management', icon: Palette },
    { id: 'background', label: 'Background Management', icon: Sparkles },
    { id: 'posts', label: 'Post Management', icon: FileText },
    { id: 'security', label: 'Security Management', icon: Lock },
    { id: 'activity', label: 'Activity Monitoring', icon: Activity },
    { id: 'join-requests', label: 'Join Requests', icon: UserCheck },
    { id: 'system', label: 'System Settings', icon: Database },
  ];

const PERMISSION_LABELS: { key: keyof Omit<RolePermissions, 'role' | 'updated_at'>; label: string }[] =
  [
    { key: 'can_post', label: 'Buat Postingan' },
    { key: 'can_comment', label: 'Komentar' },
    { key: 'can_like', label: 'Suka' },
    { key: 'can_upload_photo', label: 'Upload Foto' },
    { key: 'can_upload_video', label: 'Upload Video' },
    { key: 'can_upload_music', label: 'Upload Musik' },
    { key: 'can_dm', label: 'Pesan Pribadi' },
    { key: 'can_voice_call', label: 'Panggilan Suara' },
    { key: 'can_video_call', label: 'Panggilan Video' },
    { key: 'can_screen_share', label: 'Berbagi Layar' },
    { key: 'can_request_rooms', label: 'Ajukan Ruang Khusus' },
  ];

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  initialTab = 'members',
  siteSettings,
  posts,
  rooms,
  onSettingsUpdated,
  onRefreshPosts,
  onRefreshRooms,
  onRefreshUsers,
  onOpenProfile,
  onInspectViaDm,
  onInspectViaCall,
}) => {
  const [tab, setTab] = useState<OwnerPanelTab>(initialTab);
  const [members, setMembers] = useState<User[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [permissions, setPermissions] = useState<RolePermissions[]>([]);
  const [activities, setActivities] = useState<ActivityLogItem[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequestItem[]>([]);
  const [sessions, setSessions] = useState<
    {
      id: string;
      user_id: string;
      device_info: string;
      ip_address: string;
      created_at: string;
      display_name: string;
      username: string;
      email: string;
      role: UserRole;
    }[]
  >([]);
  const [backups, setBackups] = useState<{ filename: string; sizeBytes: number; createdAt: string }[]>(
    []
  );
  const [overview, setOverview] = useState<{
    totalMembers: number;
    onlineMembers: number;
    totalPosts: number;
    pendingJoinRequests: number;
    activeSessions: number;
    googleOAuthConfigured?: boolean;
  } | null>(null);
  const [googleAuthInfo, setGoogleAuthInfo] = useState<GoogleAuthConfigStatus | null>(null);

  const [draftSettings, setDraftSettings] = useState<SiteSettings>(siteSettings);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [vipTiers, setVipTiers] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const bgUploadRef = useRef<HTMLInputElement | null>(null);
  const bannerUploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setDraftSettings(siteSettings);
  }, [siteSettings]);

  const loadAllOwnerData = async () => {
    try {
      const [ov, mem, perm, act, jr, sess, bk] = await Promise.all([
        apiFetch<{ stats: typeof overview; googleAuth?: GoogleAuthConfigStatus }>('/api/owner/overview'),
        apiFetch<{ members: User[] }>('/api/owner/members'),
        apiFetch<{ permissions: RolePermissions[] }>('/api/owner/permissions'),
        apiFetch<{ activities: ActivityLogItem[] }>('/api/owner/activity'),
        apiFetch<{ requests: JoinRequestItem[] }>('/api/owner/join-requests'),
        apiFetch<{ sessions: typeof sessions }>('/api/owner/sessions'),
        apiFetch<{ backups: typeof backups }>('/api/owner/backup/list'),
      ]);
      setOverview(ov.stats);
      if (ov.googleAuth) setGoogleAuthInfo(ov.googleAuth);
      setMembers(mem.members);
      setPermissions(perm.permissions);
      setActivities(act.activities);
      setJoinRequests(jr.requests);
      setSessions(sess.sessions);
      setBackups(bk.backups);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadAllOwnerData();
  }, []);

  const flashNotice = (msg: string) => {
    setError('');
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const handleRoleChange = async (userId: string, role: 'MASTER' | 'VIP' | 'MEMBER') => {
    setError('');
    try {
      await apiFetch(`/api/owner/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await loadAllOwnerData();
      onRefreshUsers();
      flashNotice(`Jabatan berhasil diperbarui ke ${role}.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleToggleBlock = async (m: User) => {
    setError('');
    try {
      await apiFetch(`/api/owner/members/${m.id}/block`, {
        method: 'PATCH',
        body: JSON.stringify({
          isBlocked: !m.isBlocked,
          reason: !m.isBlocked ? 'Dibatasi oleh OWNER' : '',
        }),
      });
      await loadAllOwnerData();
      onRefreshUsers();
      flashNotice(m.isBlocked ? 'Blokir akun dibuka.' : 'Akun berhasil diblokir.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleVerifyMember = async (userId: string) => {
    try {
      await apiFetch(`/api/owner/members/${userId}/verify`, { method: 'PATCH' });
      await loadAllOwnerData();
      flashNotice('Email anggota berhasil diverifikasi.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRevokeUserSessions = async (userId: string) => {
    try {
      await apiFetch(`/api/owner/members/${userId}/revoke-sessions`, { method: 'POST' });
      await loadAllOwnerData();
      flashNotice('Semua sesi perangkat anggota dihentikan.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleToggleVip = async (m: User, enable: boolean) => {
    try {
      await apiFetch(`/api/owner/members/${m.id}/vip`, {
        method: 'PATCH',
        body: JSON.stringify({
          isVip: enable,
          vipTier: vipTiers[m.id] ?? m.vipTier ?? 'Royal VIP',
        }),
      });
      await loadAllOwnerData();
      onRefreshUsers();
      flashNotice(enable ? 'Status VIP diaktifkan.' : 'Status VIP dicabut.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleTogglePerm = async (
    role: UserRole,
    key: keyof Omit<RolePermissions, 'role' | 'updated_at'>,
    val: boolean
  ) => {
    try {
      await apiFetch(`/api/owner/permissions/${role}`, {
        method: 'PATCH',
        body: JSON.stringify({ [key]: val }),
      });
      await loadAllOwnerData();
      flashNotice(`Izin ${role} diperbarui.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveSettings = async (patch: Partial<SiteSettings>) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch<{ siteSettings: SiteSettings }>('/api/owner/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onSettingsUpdated(res.siteSettings);
      flashNotice('Pengaturan platform disimpan dan diterapkan secara langsung.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUploadAsset = async (
    e: React.ChangeEvent<HTMLInputElement>,
    category: 'site_bg' | 'site_banner',
    settingKey: 'background_url' | 'hero_banner_url'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await uploadMedia(file, category);
      await handleSaveSettings({
        [settingKey]: uploaded.url,
        ...(settingKey === 'background_url' ? { background_type: 'custom' } : {}),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const handleDecideJoinRequest = async (
    reqId: string,
    decision: 'approved' | 'rejected' | 'revoked'
  ) => {
    try {
      await apiFetch(`/api/owner/join-requests/${reqId}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          reviewNote: reviewNotes[reqId] || '',
        }),
      });
      await loadAllOwnerData();
      onRefreshRooms();
      flashNotice(`Keputusan join request (${decision}) tersimpan.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    try {
      await apiFetch('/api/owner/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: newRoomName, description: newRoomDesc }),
      });
      setNewRoomName('');
      setNewRoomDesc('');
      onRefreshRooms();
      flashNotice('Ruang khusus baru berhasil dibuat.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    try {
      await apiFetch(`/api/owner/rooms/${roomId}`, { method: 'DELETE' });
      onRefreshRooms();
      flashNotice('Ruang khusus dihapus.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateSnapshot = async () => {
    setBusy(true);
    try {
      await apiFetch('/api/owner/backup/snapshot', { method: 'POST' });
      await loadAllOwnerData();
      flashNotice('Snapshot database SQLite berhasil dibuat.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const filteredMembers = members.filter((m) => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      m.displayName.toLowerCase().includes(q) ||
      m.username.toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q) ||
      m.role.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header & KPI Strip */}
      <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] uppercase text-amber-700 dark:text-amber-400">
              Otoritas Tertinggi
            </p>
            <h2 className="font-display text-3xl font-semibold text-stone-900 dark:text-stone-100">
              Pusat Kendali OWNER
            </h2>
          </div>
          <button
            type="button"
            onClick={loadAllOwnerData}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border border-stone-200 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Segarkan Data
          </button>
        </div>

        {overview && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-stone-200/60 dark:border-stone-800/70">
            <div>
              <p className="text-xs text-stone-500">Total Anggota</p>
              <p className="text-xl font-semibold font-mono-tabular text-stone-900 dark:text-stone-100">
                {overview.totalMembers}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Sedang Online</p>
              <p className="text-xl font-semibold font-mono-tabular text-emerald-600 dark:text-emerald-400">
                {overview.onlineMembers}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Postingan</p>
              <p className="text-xl font-semibold font-mono-tabular text-stone-900 dark:text-stone-100">
                {overview.totalPosts}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Join Pending</p>
              <p className="text-xl font-semibold font-mono-tabular text-amber-600 dark:text-amber-400">
                {overview.pendingJoinRequests}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Sesi Aktif</p>
              <p className="text-xl font-semibold font-mono-tabular text-stone-900 dark:text-stone-100">
                {overview.activeSessions}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 10-Panel Tab Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-stone-900 dark:bg-amber-600 text-white'
                  : 'luxury-glass border border-stone-200/80 dark:border-stone-800/80 text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {notice && (
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 px-4 py-3 text-xs text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {/* 1. MEMBER MANAGEMENT */}
      {tab === 'members' && (
        <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
              Member Management
            </h3>
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Cari nama, email, atau jabatan..."
              className="w-full sm:w-72 rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-xs text-stone-900 dark:text-stone-100"
            />
          </div>

          <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70">
            {filteredMembers.map((m) => (
              <div
                key={m.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    src={m.avatarUrl}
                    name={m.displayName}
                    size="sm"
                    role={m.role}
                    online={m.online}
                    showPresence
                    onClick={() => onOpenProfile(m.id)}
                  />
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenProfile(m.id)}
                      className="text-sm font-semibold text-stone-900 dark:text-stone-100 hover:underline truncate block cursor-pointer"
                    >
                      {m.displayName}
                    </button>
                    <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                      {m.email} · {getRoleLabel(m.role, m.isVip)} ·{' '}
                      {m.emailVerified ? 'Terverifikasi' : 'Belum Verifikasi'} ·{' '}
                      {m.isBlocked ? 'DIBLOKIR' : m.online ? 'Online' : formatRelativeTime(m.lastActiveAt)}
                    </p>
                  </div>
                </div>

                {m.role !== 'OWNER' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {!m.emailVerified && (
                      <button
                        type="button"
                        onClick={() => handleVerifyMember(m.id)}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 whitespace-nowrap cursor-pointer"
                      >
                        Verifikasi Email
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleBlock(m)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap cursor-pointer ${
                        m.isBlocked
                          ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-rose-600/15 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      <Ban className="w-3.5 h-3.5" />
                      {m.isBlocked ? 'Buka Blokir' : 'Blokir'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevokeUserSessions(m.id)}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium border border-stone-200 dark:border-stone-700 hover:bg-stone-200/50 dark:hover:bg-stone-800/60 whitespace-nowrap cursor-pointer"
                    >
                      Putus Sesi
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. ROLE MANAGEMENT */}
      {tab === 'roles' && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
            <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
              Tetapkan Jabatan Anggota
            </h3>
            <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <Avatar src={m.avatarUrl} name={m.displayName} size="sm" role={m.role} />
                    <div>
                      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {m.displayName}
                      </p>
                      <p className="text-xs text-stone-500">
                        @{m.username} · {m.email}
                      </p>
                    </div>
                  </div>
                  {m.role === 'OWNER' ? (
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      OWNER UTAMA (Mutlak)
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {(['MASTER', 'VIP', 'MEMBER'] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => handleRoleChange(m.id, r)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                            m.role === r
                              ? 'bg-stone-900 dark:bg-amber-600 text-white'
                              : 'border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-200/50 dark:hover:bg-stone-800/60'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4 overflow-x-auto">
            <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
              Matriks Izin Setiap Jabatan
            </h3>
            <table className="w-full text-left text-xs border-collapse min-w-[560px]">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800 text-stone-500">
                  <th className="py-2.5 pr-4 font-medium">Fitur / Izin</th>
                  <th className="py-2.5 px-3 font-semibold text-center">MASTER</th>
                  <th className="py-2.5 px-3 font-semibold text-center">VIP</th>
                  <th className="py-2.5 px-3 font-semibold text-center">MEMBER</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200/60 dark:divide-stone-800/60">
                {PERMISSION_LABELS.map((item) => (
                  <tr key={item.key}>
                    <td className="py-2.5 pr-4 font-medium text-stone-800 dark:text-stone-200">
                      {item.label}
                    </td>
                    {(['MASTER', 'VIP', 'MEMBER'] as const).map((r) => {
                      const row = permissions.find((p) => p.role === r);
                      const checked = Boolean(row?.[item.key]);
                      return (
                        <td key={r} className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => handleTogglePerm(r, item.key, e.target.checked)}
                            className="h-4 w-4 accent-amber-600 cursor-pointer"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. VIP MANAGEMENT */}
      {tab === 'vip' && (
        <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
          <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
            VIP Management
          </h3>
          <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70">
            {members
              .filter((m) => m.role !== 'OWNER')
              .map((m) => (
                <div
                  key={m.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <Avatar src={m.avatarUrl} name={m.displayName} size="sm" role={m.role} />
                    <div>
                      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {m.displayName}
                      </p>
                      <p className="text-xs text-stone-500">
                        Status: {m.isVip ? `VIP Aktif (${m.vipTier || 'Eksklusif'})` : 'Non-VIP'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={vipTiers[m.id] ?? m.vipTier ?? 'Royal VIP'}
                      onChange={(e) => setVipTiers((p) => ({ ...p, [m.id]: e.target.value }))}
                      placeholder="Label Tier VIP"
                      className="w-36 rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleToggleVip(m, !m.isVip)}
                      className={`px-4 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer ${
                        m.isVip
                          ? 'bg-rose-600/15 text-rose-700 dark:text-rose-300'
                          : 'bg-amber-600 text-white hover:bg-amber-500'
                      }`}
                    >
                      {m.isVip ? 'Cabut VIP' : 'Berikan VIP'}
                    </button>
                  </div>
                </div>
              ))}
            {members.filter((m) => m.role !== 'OWNER').length === 0 && (
              <p className="py-6 text-xs text-stone-500">Belum ada anggota terdaftar selain OWNER.</p>
            )}
          </div>
        </div>
      )}

      {/* 4. THEME MANAGEMENT */}
      {tab === 'theme' && (
        <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-5">
          <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Theme Management
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                Mode Tampilan Global
              </label>
              <select
                value={draftSettings.theme_mode}
                onChange={(e) =>
                  setDraftSettings((s) => ({ ...s, theme_mode: e.target.value as 'light' | 'dark' }))
                }
                className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm"
              >
                <option value="light">Champagne Pearl (Terang)</option>
                <option value="dark">Midnight Velvet (Gelap)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                Preset Identitas Tema
              </label>
              <select
                value={draftSettings.theme_preset}
                onChange={(e) => setDraftSettings((s) => ({ ...s, theme_preset: e.target.value }))}
                className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm"
              >
                <option value="champagne-pearl">Champagne Pearl</option>
                <option value="rose-quartz">Rose Quartz Luxury</option>
                <option value="midnight-velvet">Midnight Velvet</option>
                <option value="obsidian-gold">Obsidian Gold</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                Warna Aksen Utama
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draftSettings.accent_color || '#b8860b'}
                  onChange={(e) => setDraftSettings((s) => ({ ...s, accent_color: e.target.value }))}
                  className="h-10 w-14 rounded-xl border border-stone-200 cursor-pointer"
                />
                <input
                  type="text"
                  value={draftSettings.accent_color || '#b8860b'}
                  onChange={(e) => setDraftSettings((s) => ({ ...s, accent_color: e.target.value }))}
                  className="flex-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm font-mono-tabular"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                Kepadatan Tata Letak
              </label>
              <select
                value={draftSettings.layout_density}
                onChange={(e) => setDraftSettings((s) => ({ ...s, layout_density: e.target.value }))}
                className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm"
              >
                <option value="comfortable">Nyaman & Lega</option>
                <option value="compact">Padat & Efisien</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                Transparansi Kaca ({Math.round(Number(draftSettings.glass_opacity || 0.78) * 100)}%)
              </label>
              <input
                type="range"
                min="0.45"
                max="0.95"
                step="0.05"
                value={draftSettings.glass_opacity || '0.78'}
                onChange={(e) => setDraftSettings((s) => ({ ...s, glass_opacity: e.target.value }))}
                className="w-full accent-amber-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                Radius Sudut ({draftSettings.border_radius || 20}px)
              </label>
              <input
                type="range"
                min="12"
                max="28"
                step="2"
                value={draftSettings.border_radius || '20'}
                onChange={(e) => setDraftSettings((s) => ({ ...s, border_radius: e.target.value }))}
                className="w-full accent-amber-600"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              handleSaveSettings({
                theme_mode: draftSettings.theme_mode,
                theme_preset: draftSettings.theme_preset,
                accent_color: draftSettings.accent_color,
                layout_density: draftSettings.layout_density,
                glass_opacity: draftSettings.glass_opacity,
                border_radius: draftSettings.border_radius,
              })
            }
            className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white hover:bg-stone-800 whitespace-nowrap cursor-pointer"
          >
            Terapkan Tema Secara Langsung
          </button>
        </div>
      )}

      {/* 5. BACKGROUND MANAGEMENT */}
      {tab === 'background' && (
        <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-5">
          <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Background & Banner Management
          </h3>

          <input
            ref={bgUploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleUploadAsset(e, 'site_bg', 'background_url')}
          />
          <input
            ref={bannerUploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleUploadAsset(e, 'site_banner', 'hero_banner_url')}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-stone-200/80 dark:border-stone-800/80 space-y-3">
              <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                Preset Background Interaktif
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleSaveSettings({
                      background_type: 'aurora',
                      background_url: '/brand-assets/luxury_bg_aurora_1794784329133.jpg',
                    })
                  }
                  className="px-3 py-1.5 rounded-xl text-xs border border-stone-300 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 whitespace-nowrap cursor-pointer"
                >
                  Pearl Silk
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSaveSettings({
                      background_type: 'velvet',
                      background_url: '/brand-assets/luxury_bg_velvet_1794784330019.jpg',
                    })
                  }
                  className="px-3 py-1.5 rounded-xl text-xs border border-stone-300 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 whitespace-nowrap cursor-pointer"
                >
                  Obsidian Velvet
                </button>
                <button
                  type="button"
                  onClick={() => bgUploadRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white whitespace-nowrap cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Unggah Background
                </button>
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-stone-200/80 dark:border-stone-800/80 space-y-3">
              <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                Banner Utama Platform
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => bannerUploadRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white whitespace-nowrap cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Ganti Banner Utama
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSaveSettings({
                      hero_banner_url: '/brand-assets/luxury_hero_banner_1794784329141.jpg',
                    })
                  }
                  className="px-3 py-2 rounded-xl text-xs border border-stone-300 dark:border-stone-700 whitespace-nowrap cursor-pointer"
                >
                  Reset Default
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
              Intensitas Efek Cahaya Interaktif ({Math.round(Number(draftSettings.glow_intensity || 0.55) * 100)}%)
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={draftSettings.glow_intensity || '0.55'}
                onChange={(e) => setDraftSettings((s) => ({ ...s, glow_intensity: e.target.value }))}
                className="flex-1 accent-amber-600"
              />
              <button
                type="button"
                onClick={() => handleSaveSettings({ glow_intensity: draftSettings.glow_intensity })}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white whitespace-nowrap cursor-pointer"
              >
                Simpan Cahaya
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. POST MANAGEMENT */}
      {tab === 'posts' && (
        <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
          <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Post Management
          </h3>
          <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70">
            {posts.map((p) => (
              <div key={p.id} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                    {p.author.displayName} · {p.mediaType.toUpperCase()} ·{' '}
                    <span className="text-stone-400 font-normal">
                      {formatRelativeTime(p.createdAt)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-stone-600 dark:text-stone-300 line-clamp-2">
                    {p.content || p.mediaTitle || '(Lampiran Media)'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/posts/${p.id}/pin`, { method: 'PATCH' });
                      onRefreshPosts();
                    }}
                    className={`p-2 rounded-xl text-xs cursor-pointer ${
                      p.isPinned ? 'bg-amber-500/20 text-amber-700' : 'hover:bg-stone-200/60'
                    }`}
                    title="Pin/Unpin"
                  >
                    <Pin className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/posts/${p.id}`, { method: 'DELETE' });
                      onRefreshPosts();
                      flashNotice('Postingan dihapus oleh OWNER.');
                    }}
                    className="p-2 rounded-xl text-rose-600 hover:bg-rose-500/10 cursor-pointer"
                    title="Hapus"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {posts.length === 0 && (
              <p className="py-6 text-xs text-stone-500">Belum ada postingan di platform.</p>
            )}
          </div>
        </div>
      )}

      {/* 7. SECURITY MANAGEMENT */}
      {tab === 'security' && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
                Keamanan Autentikasi Google OAuth
              </h3>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
                {googleAuthInfo?.configured ? 'Google OAuth Aktif' : 'Menunggu Konfigurasi'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/55 dark:bg-stone-900/50 p-3.5 space-y-1">
                <p className="text-stone-500">OWNER Resmi (Otomatis)</p>
                <p className="font-mono-tabular font-semibold text-stone-900 dark:text-stone-100 break-all">
                  veloracute552@gmail.com
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/55 dark:bg-stone-900/50 p-3.5 space-y-1">
                <p className="text-stone-500">Auth Domain OAuth</p>
                <p className="font-mono-tabular font-semibold text-stone-900 dark:text-stone-100 break-all">
                  {googleAuthInfo?.authDomain || '-'}
                </p>
              </div>
              <div className="sm:col-span-2 rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/55 dark:bg-stone-900/50 p-3.5 space-y-1">
                <p className="text-stone-500">Google OAuth Client ID</p>
                <p className="font-mono-tabular font-semibold text-stone-900 dark:text-stone-100 break-all">
                  {googleAuthInfo?.oAuthClientId || '-'}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-stone-200/60 dark:border-stone-800/70">
              <label className="flex items-center gap-2.5 text-xs font-medium text-stone-800 dark:text-stone-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftSettings.allow_registration !== '0'}
                  onChange={(e) =>
                    handleSaveSettings({ allow_registration: e.target.checked ? '1' : '0' })
                  }
                  className="h-4 w-4 accent-amber-600"
                />
                Izinkan Pendaftaran Anggota Baru via Google OAuth (Gmail lain otomatis menjadi MEMBER)
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-3">
            <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
              Sesi Login Aktif ({sessions.length})
            </h3>
            <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70 max-h-64 overflow-y-auto">
              {sessions.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-900 dark:text-stone-100 truncate">
                      {s.display_name} ({s.role})
                    </p>
                    <p className="text-stone-500 truncate">{s.device_info || s.ip_address}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await apiFetch(`/api/owner/sessions/${s.id}`, { method: 'DELETE' });
                        loadAllOwnerData();
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}
                    className="px-3 py-1 rounded-lg text-rose-600 hover:bg-rose-500/10 whitespace-nowrap cursor-pointer"
                  >
                    Cabut
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 8. ACTIVITY MONITORING */}
      {tab === 'activity' && (
        <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
          <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Activity Monitoring
          </h3>
          <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70 max-h-[500px] overflow-y-auto">
            {activities.map((a) => (
              <div key={a.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-stone-900 dark:text-stone-100 truncate">
                    {a.display_name || 'Sistem'} · <span className="font-mono-tabular">{a.action}</span>
                  </p>
                  <p className="text-stone-500 dark:text-stone-400 truncate mt-0.5">{a.details}</p>
                </div>
                <span className="text-stone-400 tabular-nums shrink-0">
                  {formatRelativeTime(a.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 9. JOIN REQUESTS & EXCLUSIVE ROOMS */}
      {tab === 'join-requests' && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
            <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
              Kelola Ruang Khusus
            </h3>
            <form onSubmit={handleCreateRoom} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="Nama ruang khusus baru"
                className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-xs"
              />
              <input
                type="text"
                value={newRoomDesc}
                onChange={(e) => setNewRoomDesc(e.target.value)}
                placeholder="Deskripsi singkat ruang"
                className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-xs"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Buat Ruang
              </button>
            </form>

            <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70">
              {rooms.map((r) => (
                <div key={r.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-semibold text-stone-900 dark:text-stone-100">{r.name}</p>
                    <p className="text-stone-500">{r.memberCount} anggota disetujui</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteRoom(r.id)}
                    className="p-2 rounded-xl text-rose-600 hover:bg-rose-500/10 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
            <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
              Permintaan Masuk Anggota (Join Requests)
            </h3>
            <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70">
              {joinRequests.map((jr) => {
                const applicantUser: User = {
                  id: jr.applicant.id,
                  displayName: jr.applicant.displayName,
                  username: jr.applicant.username,
                  email: jr.applicant.email,
                  avatarUrl: jr.applicant.avatarUrl,
                  role: jr.applicant.role,
                  isVip: jr.applicant.isVip,
                  vipTier: '',
                  vipExpiresAt: null,
                  bio: '',
                  bannerUrl: '',
                  personalBgUrl: '',
                  personalTheme: 'inherit',
                  emailVerified: true,
                  isBlocked: false,
                  blockReason: '',
                  online: jr.applicant.online,
                  lastActiveAt: jr.applicant.lastActiveAt,
                  createdAt: jr.createdAt,
                };

                return (
                  <div key={jr.id} className="py-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={jr.applicant.avatarUrl}
                          name={jr.applicant.displayName}
                          size="sm"
                          role={jr.applicant.role}
                          online={jr.applicant.online}
                          showPresence
                          onClick={() => onOpenProfile(jr.applicant.id)}
                        />
                        <div>
                          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                            {jr.applicant.displayName} → {jr.roomName}
                          </p>
                          <p className="text-xs text-stone-500">
                            Status: <span className="font-semibold uppercase">{jr.status}</span> ·{' '}
                            {formatRelativeTime(jr.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onInspectViaDm(applicantUser)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs border border-stone-300 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 whitespace-nowrap cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Periksa via Pesan
                        </button>
                        <button
                          type="button"
                          onClick={() => onInspectViaCall(applicantUser, 'voice')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs border border-stone-300 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 whitespace-nowrap cursor-pointer"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          Panggil
                        </button>
                      </div>
                    </div>

                    {jr.message && (
                      <p className="text-xs text-stone-700 dark:text-stone-300 bg-stone-100/70 dark:bg-stone-800/60 rounded-xl px-3.5 py-2">
                        "{jr.message}"
                      </p>
                    )}

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        type="text"
                        value={reviewNotes[jr.id] || ''}
                        onChange={(e) =>
                          setReviewNotes((p) => ({ ...p, [jr.id]: e.target.value }))
                        }
                        placeholder="Catatan keputusan OWNER (opsional)"
                        className="flex-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3 py-1.5 text-xs"
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDecideJoinRequest(jr.id, 'approved')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 whitespace-nowrap cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Terima
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecideJoinRequest(jr.id, 'rejected')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500 whitespace-nowrap cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Tolak
                        </button>
                        {jr.status === 'approved' && (
                          <button
                            type="button"
                            onClick={() => handleDecideJoinRequest(jr.id, 'revoked')}
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-rose-300 text-rose-600 hover:bg-rose-500/10 whitespace-nowrap cursor-pointer"
                          >
                            Cabut Izin
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {joinRequests.length === 0 && (
                <p className="py-6 text-xs text-stone-500">Belum ada permintaan join ruang khusus.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 10. SYSTEM SETTINGS & BACKUP */}
      {tab === 'system' && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
            <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
              System Settings
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                  Nama Platform
                </label>
                <input
                  type="text"
                  value={draftSettings.platform_name}
                  onChange={(e) =>
                    setDraftSettings((s) => ({ ...s, platform_name: e.target.value }))
                  }
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                  Tagline Platform
                </label>
                <input
                  type="text"
                  value={draftSettings.platform_tagline}
                  onChange={(e) =>
                    setDraftSettings((s) => ({ ...s, platform_tagline: e.target.value }))
                  }
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                handleSaveSettings({
                  platform_name: draftSettings.platform_name,
                  platform_tagline: draftSettings.platform_tagline,
                })
              }
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white whitespace-nowrap cursor-pointer"
            >
              Simpan Identitas Platform
            </button>
          </div>

          <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
                  Backup Data Permanen
                </h3>
                <p className="text-xs text-stone-500">
                  Buat snapshot database SQLite di server atau unduh arsip JSON terstruktur.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleCreateSnapshot}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white whitespace-nowrap cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5" />
                  Buat Snapshot SQLite
                </button>
                <a
                  href="/api/owner/backup/json"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-stone-300 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Unduh JSON
                </a>
              </div>
            </div>

            <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70">
              {backups.map((b) => (
                <div key={b.filename} className="py-2.5 flex items-center justify-between text-xs">
                  <span className="font-mono-tabular text-stone-800 dark:text-stone-200">
                    {b.filename}
                  </span>
                  <span className="text-stone-500 tabular-nums">
                    {Math.round(b.sizeBytes / 1024)} KB · {formatRelativeTime(b.createdAt)}
                  </span>
                </div>
              ))}
              {backups.length === 0 && (
                <p className="py-4 text-xs text-stone-500">Belum ada snapshot server tersimpan.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
