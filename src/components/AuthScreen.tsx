import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Crown,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserPlus,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { signInWithGooglePopup } from '../lib/firebaseAuth';
import { RolePermissions, SiteSettings, User } from '../types';

interface AuthScreenProps {
  siteSettings: SiteSettings;
  onAuthenticated: (payload: {
    user: User;
    permissions: RolePermissions;
    siteSettings?: SiteSettings;
  }) => void;
}

type AuthMode = 'login' | 'register' | 'recover';

const GoogleMark: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3.01h3.87c2.26-2.08 3.56-5.15 3.56-8.66Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.87-3.01c-1.07.72-2.44 1.15-4.08 1.15-3.14 0-5.8-2.12-6.75-4.97H1.25v3.1A12 12 0 0 0 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.25 14.26A7.2 7.2 0 0 1 4.87 12c0-.78.13-1.54.38-2.26v-3.1H1.25A12 12 0 0 0 0 12c0 1.94.46 3.77 1.25 5.36l4-3.1Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.25 6.64l4 3.1C6.2 6.89 8.86 4.77 12 4.77Z"
    />
  </svg>
);

export const AuthScreen: React.FC<AuthScreenProps> = ({ siteSettings, onAuthenticated }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bannerFailed, setBannerFailed] = useState(false);

  const handleGoogleAuth = async (requestedMode: AuthMode) => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const popupResult = await signInWithGooglePopup();
      const data = await apiFetch<{
        user: User;
        permissions: RolePermissions;
        siteSettings: SiteSettings;
        isNewUser?: boolean;
        recovered?: boolean;
      }>('/api/auth/google', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${popupResult.idToken}`,
        },
        body: JSON.stringify({
          googleAccessToken: popupResult.accessToken,
          mode: requestedMode,
          revokeOtherSessions: requestedMode === 'recover' ? revokeOtherSessions : false,
        }),
      });

      onAuthenticated(data);
    } catch (err) {
      setError(
        (err as Error).message ||
          'Gagal masuk menggunakan Google OAuth. Pastikan popup diizinkan dan akun Google Anda aktif.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 overflow-hidden rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass shadow-[0_24px_80px_-24px_rgba(30,22,12,0.18)]">
        {/* Left Editorial Visual Panel */}
        <div className="lg:col-span-6 relative flex flex-col justify-between min-h-[280px] lg:min-h-[600px] overflow-hidden bg-stone-900">
          {siteSettings.hero_banner_url && !bannerFailed ? (
            <img
              src={siteSettings.hero_banner_url}
              alt={siteSettings.platform_name}
              referrerPolicy="no-referrer"
              onError={() => setBannerFailed(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-stone-800 via-stone-900 to-amber-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/25" />

          <div className="relative z-10 p-8">
            <p className="text-xs font-medium tracking-[0.22em] text-amber-200/90 uppercase">
              Private Social Sanctuary
            </p>
            <h1 className="mt-2 font-display text-4xl md:text-5xl font-semibold tracking-tight text-white text-balance">
              {siteSettings.platform_name || 'LUXURY HAVE'}
            </h1>
          </div>

          <div className="relative z-10 p-8 space-y-4">
            <p className="text-sm md:text-base leading-relaxed text-stone-200/95 max-w-md">
              {siteSettings.platform_tagline ||
                'Komunitas sosial eksklusif yang memadukan kurasi feed elegan, pesan privat, panggilan suara dan video, serta ruang khusus dengan persetujuan OWNER.'}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-300">
              <span>Google OAuth Terverifikasi</span>
              <span aria-hidden="true">·</span>
              <span>Satu Gmail Satu Akun</span>
              <span aria-hidden="true">·</span>
              <span>Akses HP &amp; PC</span>
            </div>
          </div>
        </div>

        {/* Right Interactive Google OAuth Panel */}
        <div className="lg:col-span-6 p-6 sm:p-10 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="font-display text-3xl font-semibold text-stone-900 dark:text-stone-100">
              {mode === 'login' && 'Masuk ke Ruang Anda'}
              {mode === 'register' && 'Daftar Anggota Baru'}
              {mode === 'recover' && 'Pulihkan Akses Akun'}
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {mode === 'login' &&
                'Masuk menggunakan akun Google Anda. Profil, foto, dan data tersimpan permanen di semua perangkat.'}
              {mode === 'register' &&
                'Verifikasi identitas Gmail langsung melalui Google OAuth tanpa password tambahan atau kode OTP.'}
              {mode === 'recover' &&
                'Verifikasi ulang kepemilikan Gmail Anda lewat Google OAuth untuk memulihkan akses dan mengamankan sesi.'}
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="mb-6 grid grid-cols-3 gap-1 p-1 rounded-xl bg-stone-100/80 dark:bg-stone-800/70 border border-stone-200/60 dark:border-stone-700/60">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setNotice('');
              }}
              className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'login'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              Masuk
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
                setNotice('');
              }}
              className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'register'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              Daftar
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('recover');
                setError('');
                setNotice('');
              }}
              className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'recover'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              Pulihkan
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/90 dark:bg-rose-950/40 px-4 py-3 text-xs sm:text-sm text-rose-800 dark:text-rose-200 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/90 dark:bg-amber-950/30 px-4 py-3 text-xs sm:text-sm text-amber-900 dark:text-amber-200">
              {notice}
            </div>
          )}

          {mode === 'login' && (
            <div className="space-y-4">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleGoogleAuth('login')}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl text-sm font-semibold text-stone-900 bg-white hover:bg-stone-50 border border-stone-300/90 dark:border-stone-600 shadow-sm transition-all disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <GoogleMark className="w-5 h-5 shrink-0" />
                {loading ? 'Menghubungkan ke Google...' : 'LANJUTKAN DENGAN GOOGLE'}
              </button>

              <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/55 dark:bg-stone-900/50 p-4 space-y-2.5 text-xs text-stone-600 dark:text-stone-300">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Identitas Gmail diverifikasi langsung secara kriptografis oleh Google OAuth — tanpa password dan tanpa OTP email.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Crown className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Akun OWNER utama dikenali otomatis oleh server berdasarkan alamat Gmail terverifikasi; anggota lain otomatis mendapat akses akun masing-masing.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Smartphone className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" />
                  <span>
                    Akun Anda tetap tersimpan permanen meski logout, dan dapat diakses dari HP maupun PC.
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 text-xs text-stone-500 dark:text-stone-400">
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                  className="hover:text-stone-900 dark:hover:text-stone-200 hover:underline whitespace-nowrap cursor-pointer"
                >
                  Belum punya akun? Daftar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('recover');
                    setError('');
                  }}
                  className="text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap cursor-pointer"
                >
                  Pemulihan Akun Google
                </button>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div className="space-y-4">
              {siteSettings.allow_registration === '0' && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/90 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
                  Pendaftaran anggota baru sedang dibatasi oleh OWNER. Akun OWNER utama tetap dapat masuk seperti biasa.
                </div>
              )}

              <button
                type="button"
                disabled={loading}
                onClick={() => handleGoogleAuth('register')}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 px-5 rounded-xl text-sm font-semibold text-white bg-stone-900 dark:bg-amber-600 hover:bg-stone-800 dark:hover:bg-amber-500 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <UserPlus className="w-4 h-4 shrink-0" />
                {loading ? 'Memverifikasi Google...' : 'DAFTAR'}
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleGoogleAuth('login')}
                className="w-full flex items-center justify-center gap-3 py-3 px-5 rounded-xl text-sm font-semibold text-stone-900 bg-white hover:bg-stone-50 border border-stone-300/90 dark:border-stone-600 shadow-sm transition-all disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <GoogleMark className="w-5 h-5 shrink-0" />
                LANJUTKAN DENGAN GOOGLE
              </button>

              <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/55 dark:bg-stone-900/50 p-4 space-y-2 text-xs text-stone-600 dark:text-stone-300">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Satu Gmail hanya boleh memiliki satu akun permanen di LUXURY HAVE.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Role ditetapkan otomatis di backend: Gmail OWNER menjadi OWNER, Gmail lain menjadi MEMBER.
                  </span>
                </div>
              </div>
            </div>
          )}

          {mode === 'recover' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/55 dark:bg-stone-900/50 p-4 space-y-3 text-xs text-stone-600 dark:text-stone-300">
                <div className="flex items-start gap-2.5">
                  <KeyRound className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Pemulihan akses dilakukan dengan memverifikasi kembali akun Google asli yang terhubung dengan profil LUXURY HAVE Anda.
                  </span>
                </div>
                <label className="flex items-center gap-2.5 pt-2 border-t border-stone-200/70 dark:border-stone-800/70 cursor-pointer text-stone-800 dark:text-stone-200 font-medium">
                  <input
                    type="checkbox"
                    checked={revokeOtherSessions}
                    onChange={(e) => setRevokeOtherSessions(e.target.checked)}
                    className="h-4 w-4 accent-amber-600"
                  />
                  Putus sesi aktif di semua perangkat lain (HP &amp; PC)
                </label>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleGoogleAuth('recover')}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl text-sm font-semibold text-stone-900 bg-white hover:bg-stone-50 border border-stone-300/90 dark:border-stone-600 shadow-sm transition-all disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 shrink-0 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Memulihkan Akses...' : 'PULIHKAN AKSES DENGAN GOOGLE'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
