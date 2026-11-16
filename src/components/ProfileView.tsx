import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  MessageSquare,
  Phone,
  Save,
  ShieldCheck,
  Video,
} from 'lucide-react';
import { apiFetch, formatRelativeTime, getRoleLabel, uploadMedia } from '../lib/api';
import { User } from '../types';
import { Avatar } from './Avatar';

interface ProfileViewProps {
  profileUserId: string;
  currentUser: User;
  onProfileUpdated: (user: User) => void;
  onStartDm: (peer: User) => void;
  onStartCall: (peer: User, callType: 'voice' | 'video' | 'screen') => void;
  onOpenLightbox: (url: string, title?: string) => void;
}

interface ProfileDetailsResponse {
  user: User;
  stats: { postCount: number; commentCount: number; likeReceived: number };
  activities: { id: string; action: string; details: string; created_at: string }[];
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  profileUserId,
  currentUser,
  onProfileUpdated,
  onStartDm,
  onStartCall,
  onOpenLightbox,
}) => {
  const [data, setData] = useState<ProfileDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [personalTheme, setPersonalTheme] = useState('inherit');
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  const isSelf = profileUserId === currentUser.id;

  const loadProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<ProfileDetailsResponse>(`/api/users/${profileUserId}`);
      setData(res);
      setDisplayName(res.user.displayName);
      setUsername(res.user.username);
      setBio(res.user.bio);
      setPersonalTheme(res.user.personalTheme || 'inherit');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
    setEditing(false);
    setMessage('');
  }, [profileUserId]);

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'avatarUrl' | 'bannerUrl' | 'personalBgUrl',
    category: 'avatar' | 'banner' | 'personal_bg'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingField(field);
    setError('');
    try {
      const uploaded = await uploadMedia(file, category);
      const res = await apiFetch<{ user: User }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ [field]: uploaded.url }),
      });
      setData((prev) => (prev ? { ...prev, user: res.user } : prev));
      onProfileUpdated(res.user);
      setMessage('Media profil berhasil disimpan permanen.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingField(null);
      e.target.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await apiFetch<{ user: User }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName, username, bio, personalTheme }),
      });
      setData((prev) => (prev ? { ...prev, user: res.user } : prev));
      onProfileUpdated(res.user);
      setEditing(false);
      setMessage('Perubahan profil tersimpan permanen.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-96 rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass animate-pulse" />
    );
  }

  if (!data) {
    return (
      <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-8 text-center text-sm text-stone-500">
        {error || 'Profil tidak ditemukan.'}
      </div>
    );
  }

  const profile = data.user;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass overflow-hidden">
        {/* Clickable Banner */}
        <div
          onClick={() =>
            profile.bannerUrl
              ? onOpenLightbox(profile.bannerUrl, `Banner ${profile.displayName}`)
              : undefined
          }
          className="relative h-44 sm:h-56 w-full bg-gradient-to-r from-stone-800 via-stone-700 to-amber-900 cursor-pointer"
        >
          {profile.bannerUrl && (
            <img
              src={profile.bannerUrl}
              alt={`Banner ${profile.displayName}`}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />

          {isSelf && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                bannerInputRef.current?.click();
              }}
              disabled={uploadingField === 'bannerUrl'}
              className="absolute top-4 right-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-black/55 hover:bg-black/75 text-white text-xs font-medium backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              {uploadingField === 'bannerUrl' ? 'Mengunggah...' : 'Ganti Banner'}
            </button>
          )}
        </div>

        {/* Hidden file inputs */}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleImageUpload(e, 'avatarUrl', 'avatar')}
        />
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleImageUpload(e, 'bannerUrl', 'banner')}
        />
        <input
          ref={bgInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleImageUpload(e, 'personalBgUrl', 'personal_bg')}
        />

        {/* Profile Identity Row */}
        <div className="px-6 pb-6">
          <div className="-mt-12 relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="relative">
                <Avatar
                  src={profile.avatarUrl}
                  name={profile.displayName}
                  size="xl"
                  role={profile.role}
                  online={profile.online}
                  showPresence
                  onClick={() =>
                    profile.avatarUrl
                      ? onOpenLightbox(profile.avatarUrl, profile.displayName)
                      : undefined
                  }
                />
                {isSelf && (
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    title="Ganti Foto Profil"
                    className="absolute bottom-1 right-1 p-2 rounded-full bg-stone-900 text-white hover:bg-amber-600 shadow-md transition-colors cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="pb-1">
                <h2 className="font-display text-2xl sm:text-3xl font-semibold text-stone-900 dark:text-stone-100">
                  {profile.displayName}
                </h2>
                <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 flex-wrap">
                  <span>@{profile.username}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {getRoleLabel(profile.role, profile.isVip)}
                    {profile.vipTier ? ` (${profile.vipTier})` : ''}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {profile.online ? 'Sedang Online' : `Aktif ${formatRelativeTime(profile.lastActiveAt)}`}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {isSelf ? (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing((v) => !v)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white hover:bg-stone-800 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {editing ? 'Tutup Editor' : 'Edit Profil & Tampilan'}
                  </button>
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-emerald-300/70 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Terhubung Google OAuth
                  </span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onStartDm(profile)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white hover:bg-stone-800 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Kirim Pesan
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCall(profile, 'voice')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-200/50 dark:hover:bg-stone-800/60 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Suara
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCall(profile, 'video')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-200/50 dark:hover:bg-stone-800/60 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Video className="w-3.5 h-3.5" />
                    Video
                  </button>
                </>
              )}
            </div>
          </div>

          {message && (
            <div className="mt-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              {message}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 px-4 py-2.5 text-xs text-rose-800 dark:text-rose-200">
              {error}
            </div>
          )}

          {/* Bio & Metadata */}
          <div className="mt-5 space-y-3">
            <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
              {profile.bio || 'Belum ada bio profil.'}
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs text-stone-500 dark:text-stone-400 pt-2 border-t border-stone-200/60 dark:border-stone-800/70">
              {profile.email && (
                <>
                  <span>Email: {profile.email}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="tabular-nums">
                Bergabung {new Date(profile.createdAt).toLocaleDateString('id-ID')}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{data.stats.postCount} Postingan</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{data.stats.commentCount} Komentar</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{data.stats.likeReceived} Suka Diterima</span>
            </div>
          </div>

          {/* Self Edit Profile Form */}
          {isSelf && editing && (
            <form
              onSubmit={handleSaveProfile}
              className="mt-6 pt-6 border-t border-stone-200/70 dark:border-stone-800/70 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                    Nama Tampilan
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm text-stone-900 dark:text-stone-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm text-stone-900 dark:text-stone-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                  Bio Profil
                </label>
                <textarea
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm text-stone-900 dark:text-stone-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1.5">
                    Preferensi Tema Pribadi
                  </label>
                  <select
                    value={personalTheme}
                    onChange={(e) => setPersonalTheme(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm text-stone-900 dark:text-stone-100"
                  >
                    <option value="inherit">Ikuti Tema Platform (OWNER)</option>
                    <option value="light">Champagne Pearl (Terang)</option>
                    <option value="dark">Obsidian Velvet (Gelap)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => bgInputRef.current?.click()}
                    className="px-4 py-2 rounded-xl text-xs font-medium border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-200/50 dark:hover:bg-stone-800/60 whitespace-nowrap cursor-pointer"
                  >
                    {uploadingField === 'personalBgUrl' ? 'Mengunggah...' : 'Unggah Background Pribadi'}
                  </button>
                  {profile.personalBgUrl && (
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await apiFetch<{ user: User }>('/api/profile', {
                          method: 'PATCH',
                          body: JSON.stringify({ personalBgUrl: '' }),
                        });
                        setData((prev) => (prev ? { ...prev, user: res.user } : prev));
                        onProfileUpdated(res.user);
                      }}
                      className="px-3 py-2 rounded-xl text-xs text-rose-600 hover:bg-rose-500/10 whitespace-nowrap cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white hover:bg-stone-800 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? 'Menyimpan...' : 'Simpan Profil'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Activity History */}
      <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6">
        <h3 className="font-display text-xl font-semibold text-stone-900 dark:text-stone-100 mb-4">
          Riwayat Aktivitas Akun
        </h3>
        {data.activities.length === 0 ? (
          <p className="text-xs text-stone-500">Belum ada riwayat aktivitas tercatat.</p>
        ) : (
          <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70">
            {data.activities.map((act) => (
              <div key={act.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                <div className="min-w-0">
                  <p className="font-medium text-stone-800 dark:text-stone-200 truncate">
                    {act.details || act.action}
                  </p>
                  <p className="text-stone-400 font-mono-tabular mt-0.5">{act.action}</p>
                </div>
                <span className="text-stone-500 dark:text-stone-400 tabular-nums shrink-0">
                  {formatRelativeTime(act.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
