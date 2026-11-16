import React, { useRef, useState } from 'react';
import {
  Heart,
  Image as ImageIcon,
  Lock,
  MessageCircle,
  Music,
  Pin,
  Send,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { apiFetch, formatRelativeTime, getRoleLabel, uploadMedia } from '../lib/api';
import { PostItem, RolePermissions, SiteSettings, User } from '../types';
import { Avatar } from './Avatar';

interface FeedViewProps {
  currentUser: User;
  permissions: RolePermissions;
  siteSettings: SiteSettings;
  posts: PostItem[];
  loading: boolean;
  mediaFilter: 'all' | 'photo' | 'video' | 'music';
  onChangeFilter: (filter: 'all' | 'photo' | 'video' | 'music') => void;
  onPostCreated: (post: PostItem) => void;
  onPostDeleted: (postId: string) => void;
  onPostLikeToggled: (postId: string, liked: boolean, likesCount: number) => void;
  onCommentAdded: (postId: string, comment: PostItem['comments'][number]) => void;
  onPostPinned: (postId: string, isPinned: boolean) => void;
  onOpenProfile: (userId: string) => void;
  onOpenLightbox: (url: string, title?: string) => void;
  onOpenOwnerSettings?: () => void;
}

export const FeedView: React.FC<FeedViewProps> = ({
  currentUser,
  permissions,
  siteSettings,
  posts,
  loading,
  mediaFilter,
  onChangeFilter,
  onPostCreated,
  onPostDeleted,
  onPostLikeToggled,
  onCommentAdded,
  onPostPinned,
  onOpenProfile,
  onOpenLightbox,
  onOpenOwnerSettings,
}) => {
  const [content, setContent] = useState('');
  const [mediaType, setMediaType] = useState<'none' | 'photo' | 'video' | 'music'>('none');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaTitle, setMediaTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState('');
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [bannerError, setBannerError] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const acceptTypeRef = useRef<string>('image/*');

  const canPost = currentUser.role === 'OWNER' || Boolean(permissions.can_post);
  const canPhoto = currentUser.role === 'OWNER' || Boolean(permissions.can_upload_photo);
  const canVideo = currentUser.role === 'OWNER' || Boolean(permissions.can_upload_video);
  const canMusic = currentUser.role === 'OWNER' || Boolean(permissions.can_upload_music);

  const triggerUpload = (accept: string) => {
    acceptTypeRef.current = accept;
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setComposerError('');
    setUploading(true);
    try {
      const res = await uploadMedia(file, 'post');
      setMediaType(res.mediaType);
      setMediaUrl(res.url);
      setMediaTitle(res.originalName);
    } catch (err) {
      setComposerError((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && !mediaUrl) return;
    setComposerError('');
    setSubmitting(true);
    try {
      const data = await apiFetch<{ post: PostItem }>('/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          content,
          mediaType,
          mediaUrl,
          mediaTitle,
        }),
      });
      onPostCreated(data.post);
      setContent('');
      setMediaType('none');
      setMediaUrl('');
      setMediaTitle('');
    } catch (err) {
      setComposerError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = async (postId: string) => {
    try {
      const res = await apiFetch<{ liked: boolean; likesCount: number }>(
        `/api/posts/${postId}/like`,
        { method: 'POST' }
      );
      onPostLikeToggled(postId, res.liked, res.likesCount);
    } catch {
      // Ignored cleanly
    }
  };

  const handleCommentSubmit = async (postId: string, e: React.FormEvent) => {
    e.preventDefault();
    const draft = (commentDrafts[postId] || '').trim();
    if (!draft) return;
    try {
      const res = await apiFetch<{ comment: PostItem['comments'][number] }>(
        `/api/posts/${postId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ content: draft }),
        }
      );
      onCommentAdded(postId, res.comment);
      setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
    } catch {
      // Ignored cleanly
    }
  };

  const handleDeletePost = async (postId: string) => {
    try {
      await apiFetch(`/api/posts/${postId}`, { method: 'DELETE' });
      onPostDeleted(postId);
    } catch {
      // Ignored
    }
  };

  const handlePinPost = async (postId: string) => {
    try {
      const res = await apiFetch<{ isPinned: boolean }>(`/api/posts/${postId}/pin`, {
        method: 'PATCH',
      });
      onPostPinned(postId, res.isPinned);
    } catch {
      // Ignored
    }
  };

  return (
    <div className="space-y-6">
      {/* Clickable Editorial Platform Hero Banner */}
      <div
        onClick={() =>
          siteSettings.hero_banner_url && !bannerError
            ? onOpenLightbox(siteSettings.hero_banner_url, siteSettings.platform_name)
            : undefined
        }
        className="group relative h-44 sm:h-52 w-full overflow-hidden rounded-3xl border border-stone-200/80 dark:border-stone-800/80 cursor-pointer"
      >
        {siteSettings.hero_banner_url && !bannerError ? (
          <img
            src={siteSettings.hero_banner_url}
            alt={siteSettings.platform_name}
            referrerPolicy="no-referrer"
            onError={() => setBannerError(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-stone-800 via-stone-900 to-amber-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 p-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-white tracking-tight">
              {siteSettings.platform_name || 'LUXURY HAVE'}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-stone-200/90">
              {siteSettings.platform_tagline}
            </p>
          </div>
          {currentUser.role === 'OWNER' && onOpenOwnerSettings && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenOwnerSettings();
              }}
              className="px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur-md text-xs font-medium text-white border border-white/20 transition-colors whitespace-nowrap cursor-pointer"
            >
              Atur Banner
            </button>
          )}
        </div>
      </div>

      {/* Post Composer or Permission Notice */}
      {canPost ? (
        <form
          onSubmit={handleCreatePost}
          className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-5 space-y-4"
        >
          <div className="flex items-start gap-3.5">
            <Avatar
              src={currentUser.avatarUrl}
              name={currentUser.displayName}
              size="md"
              role={currentUser.role}
              onClick={() => onOpenProfile(currentUser.id)}
            />
            <div className="flex-1 min-w-0">
              <textarea
                rows={3}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={`Bagikan momen, kurasi media, atau pembaruan untuk komunitas, ${currentUser.displayName}...`}
                className="w-full resize-none rounded-2xl border border-stone-200/80 dark:border-stone-700/70 bg-white/60 dark:bg-stone-900/60 px-4 py-3 text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/35"
              />
            </div>
          </div>

          {composerError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 px-1">{composerError}</p>
          )}

          {mediaUrl && (
            <div className="relative rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50/70 dark:bg-stone-900/70 p-3">
              <button
                type="button"
                onClick={() => {
                  setMediaType('none');
                  setMediaUrl('');
                  setMediaTitle('');
                }}
                aria-label="Hapus lampiran"
                className="absolute top-2.5 right-2.5 z-10 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              {mediaType === 'photo' && (
                <img
                  src={mediaUrl}
                  alt={mediaTitle || 'Pratinjau foto'}
                  referrerPolicy="no-referrer"
                  className="max-h-72 w-full rounded-xl object-cover"
                />
              )}
              {mediaType === 'video' && (
                <video src={mediaUrl} controls className="max-h-72 w-full rounded-xl bg-black" />
              )}
              {mediaType === 'music' && (
                <div className="flex flex-col gap-2 pr-8">
                  <div className="flex items-center gap-2 text-xs font-medium text-stone-700 dark:text-stone-200">
                    <Music className="w-4 h-4 text-amber-600" />
                    <span className="truncate">{mediaTitle || 'Audio Terlampir'}</span>
                  </div>
                  <audio src={mediaUrl} controls className="w-full h-9" />
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelected}
            className="hidden"
          />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-stone-200/60 dark:border-stone-800/70">
            <div className="flex items-center gap-2 flex-wrap">
              {canPhoto && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => triggerUpload('image/*')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-amber-600" />
                  Foto
                </button>
              )}
              {canVideo && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => triggerUpload('video/*')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Video className="w-4 h-4 text-amber-600" />
                  Video
                </button>
              )}
              {canMusic && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => triggerUpload('audio/*')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Music className="w-4 h-4 text-amber-600" />
                  Musik
                </button>
              )}
              {uploading && <span className="text-xs text-stone-500">Mengunggah media...</span>}
            </div>

            <button
              type="submit"
              disabled={submitting || uploading || (!content.trim() && !mediaUrl)}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-stone-900 dark:bg-amber-600 hover:bg-stone-800 dark:hover:bg-amber-500 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {submitting ? 'Menerbitkan...' : 'Publikasikan'}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-4 flex items-center gap-3 text-xs text-stone-600 dark:text-stone-300">
          <Lock className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Pembuatan postingan utama saat ini hanya tersedia untuk OWNER, MASTER, VIP, atau jabatan yang diizinkan OWNER. Anda tetap dapat menyukai, berkomentar, mengirim pesan pribadi, dan mengajukan masuk ke ruang khusus.
          </span>
        </div>
      )}

      {/* Feed Filter Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Linimasa Komunitas
        </h2>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-stone-200/60 dark:bg-stone-800/70 border border-stone-200/60 dark:border-stone-700/60">
          {(
            [
              { id: 'all', label: 'Semua' },
              { id: 'photo', label: 'Foto' },
              { id: 'video', label: 'Video' },
              { id: 'music', label: 'Musik' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                mediaFilter === tab.id
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="h-48 rounded-3xl border border-stone-200/60 dark:border-stone-800/60 luxury-glass animate-pulse"
            />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-10 text-center">
          <p className="font-display text-xl text-stone-800 dark:text-stone-200">
            Belum ada postingan pada kategori ini
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Unggahan foto, video, musik, dan pemikiran kurasi akan tampil di sini secara real-time.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {posts.map((post) => {
            const isAuthor = post.authorId === currentUser.id;
            const canDelete = isAuthor || currentUser.role === 'OWNER';
            const commentsVisible = Boolean(openComments[post.id]);

            return (
              <article
                key={post.id}
                className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-5 sm:p-6 space-y-4"
              >
                {/* Post Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={post.author.avatarUrl}
                      name={post.author.displayName}
                      size="md"
                      role={post.author.role}
                      online={post.author.online}
                      showPresence
                      onClick={() => onOpenProfile(post.author.id)}
                    />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenProfile(post.author.id)}
                        className="text-sm font-semibold text-stone-900 dark:text-stone-100 hover:underline truncate block text-left cursor-pointer"
                      >
                        {post.author.displayName}
                      </button>
                      <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 flex-wrap">
                        <span>@{post.author.username}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-amber-700 dark:text-amber-400">
                          {getRoleLabel(post.author.role, post.author.isVip)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{formatRelativeTime(post.createdAt)}</span>
                        {post.isPinned && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 dark:text-amber-400 font-medium">
                              Disematkan
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {currentUser.role === 'OWNER' && (
                      <button
                        type="button"
                        onClick={() => handlePinPost(post.id)}
                        title={post.isPinned ? 'Lepas sematan' : 'Sematkan postingan'}
                        className={`p-2 rounded-xl transition-colors cursor-pointer ${
                          post.isPinned
                            ? 'text-amber-600 bg-amber-500/10'
                            : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200/50 dark:hover:bg-stone-800/60'
                        }`}
                      >
                        <Pin className="w-4 h-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDeletePost(post.id)}
                        title="Hapus postingan"
                        className="p-2 rounded-xl text-stone-400 hover:text-rose-600 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Text Content */}
                {post.content && (
                  <p className="text-sm sm:text-[15px] leading-relaxed text-stone-800 dark:text-stone-200 whitespace-pre-wrap break-words">
                    {post.content}
                  </p>
                )}

                {/* Media Attachment */}
                {post.mediaType === 'photo' && post.mediaUrl && (
                  <button
                    type="button"
                    onClick={() => onOpenLightbox(post.mediaUrl, post.mediaTitle || post.author.displayName)}
                    className="block w-full overflow-hidden rounded-2xl border border-stone-200/70 dark:border-stone-800/80 cursor-pointer"
                  >
                    <img
                      src={post.mediaUrl}
                      alt={post.mediaTitle || 'Foto postingan'}
                      referrerPolicy="no-referrer"
                      className="max-h-[460px] w-full object-cover transition-transform duration-300 hover:scale-[1.01]"
                    />
                  </button>
                )}

                {post.mediaType === 'video' && post.mediaUrl && (
                  <div className="overflow-hidden rounded-2xl border border-stone-200/70 dark:border-stone-800/80 bg-black">
                    <video src={post.mediaUrl} controls className="max-h-[460px] w-full" />
                  </div>
                )}

                {post.mediaType === 'music' && post.mediaUrl && (
                  <div className="rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-stone-100/70 dark:bg-stone-900/70 p-4 space-y-2.5">
                    <div className="flex items-center gap-2.5 text-xs font-medium text-stone-700 dark:text-stone-200">
                      <Music className="w-4 h-4 text-amber-600 shrink-0" />
                      <span className="truncate">{post.mediaTitle || 'Audio Luxury Have'}</span>
                    </div>
                    <audio src={post.mediaUrl} controls className="w-full h-9" />
                  </div>
                )}

                {/* Actions Footer */}
                <div className="pt-2 border-t border-stone-200/60 dark:border-stone-800/70 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => handleLike(post.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      post.likedByMe
                        ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10'
                        : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/50 dark:hover:bg-stone-800/60'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${post.likedByMe ? 'fill-current' : ''}`} />
                    <span className="tabular-nums">{post.likesCount}</span>
                    <span>Suka</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setOpenComments((prev) => ({ ...prev, [post.id]: !prev[post.id] }))
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-200/50 dark:hover:bg-stone-800/60 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span className="tabular-nums">{post.comments.length}</span>
                    <span>Komentar</span>
                  </button>
                </div>

                {/* Comments Drawer */}
                {commentsVisible && (
                  <div className="pt-3 border-t border-stone-200/50 dark:border-stone-800/60 space-y-3">
                    {post.comments.length > 0 && (
                      <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                        {post.comments.map((c) => (
                          <div key={c.id} className="flex items-start gap-2.5">
                            <Avatar
                              src={c.author.avatarUrl}
                              name={c.author.displayName}
                              size="xs"
                              role={c.author.role}
                              onClick={() => onOpenProfile(c.author.id)}
                            />
                            <div className="flex-1 min-w-0 rounded-2xl bg-stone-100/80 dark:bg-stone-800/60 px-3.5 py-2">
                              <div className="flex items-center gap-1.5 text-xs">
                                <button
                                  type="button"
                                  onClick={() => onOpenProfile(c.author.id)}
                                  className="font-semibold text-stone-900 dark:text-stone-100 hover:underline cursor-pointer"
                                >
                                  {c.author.displayName}
                                </button>
                                <span aria-hidden="true" className="text-stone-400">
                                  ·
                                </span>
                                <span className="text-stone-500 dark:text-stone-400 tabular-nums">
                                  {formatRelativeTime(c.createdAt)}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs sm:text-sm text-stone-700 dark:text-stone-200 break-words">
                                {c.content}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(currentUser.role === 'OWNER' || Boolean(permissions.can_comment)) && (
                      <form
                        onSubmit={(e) => handleCommentSubmit(post.id, e)}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={commentDrafts[post.id] || ''}
                          onChange={(e) =>
                            setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))
                          }
                          placeholder="Tulis komentar..."
                          className="flex-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-xs sm:text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-stone-900 dark:bg-amber-600 hover:bg-stone-800 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Kirim
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
