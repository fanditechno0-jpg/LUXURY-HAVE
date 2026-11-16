import React, { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  MonitorUp,
  Music,
  Phone,
  Send,
  Video,
  X,
} from 'lucide-react';
import { apiFetch, formatRelativeTime, getRoleLabel, uploadMedia } from '../lib/api';
import {
  ConversationItem,
  DirectMessageItem,
  RolePermissions,
  User,
} from '../types';
import { Avatar } from './Avatar';

interface MessagesViewProps {
  currentUser: User;
  permissions: RolePermissions;
  allUsers: User[];
  selectedPeer: User | null;
  onSelectPeer: (peer: User | null) => void;
  incomingMessageEvent: { message: DirectMessageItem; sender: User } | null;
  onStartCall: (peer: User, callType: 'voice' | 'video' | 'screen') => void;
  onOpenProfile: (userId: string) => void;
  onOpenLightbox: (url: string, title?: string) => void;
  onUnreadChanged: () => void;
}

export const MessagesView: React.FC<MessagesViewProps> = ({
  currentUser,
  permissions,
  allUsers,
  selectedPeer,
  onSelectPeer,
  incomingMessageEvent,
  onStartCall,
  onOpenProfile,
  onOpenLightbox,
  onUnreadChanged,
}) => {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [messages, setMessages] = useState<DirectMessageItem[]>([]);
  const [draft, setDraft] = useState('');
  const [mediaType, setMediaType] = useState<'none' | 'photo' | 'video' | 'music'>('none');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = async () => {
    try {
      const res = await apiFetch<{ conversations: ConversationItem[] }>('/api/dm/conversations');
      setConversations(res.conversations);
    } catch {
      // Ignored
    }
  };

  const loadThread = async (peerId: string) => {
    setError('');
    try {
      const res = await apiFetch<{ peer: User; messages: DirectMessageItem[] }>(
        `/api/dm/${peerId}`
      );
      setMessages(res.messages);
      onUnreadChanged();
      loadConversations();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (selectedPeer) {
      loadThread(selectedPeer.id);
    }
  }, [selectedPeer?.id]);

  useEffect(() => {
    if (!incomingMessageEvent) return;
    const msg = incomingMessageEvent.message;
    loadConversations();
    if (
      selectedPeer &&
      ((msg.senderId === selectedPeer.id && msg.recipientId === currentUser.id) ||
        (msg.senderId === currentUser.id && msg.recipientId === selectedPeer.id))
    ) {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (msg.senderId === selectedPeer.id) {
        apiFetch(`/api/dm/${selectedPeer.id}`).then(() => onUnreadChanged()).catch(() => {});
      }
    }
  }, [incomingMessageEvent]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const res = await uploadMedia(file, 'post');
      setMediaType(res.mediaType);
      setMediaUrl(res.url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPeer || (!draft.trim() && !mediaUrl)) return;
    setError('');
    try {
      const res = await apiFetch<{ message: DirectMessageItem }>(`/api/dm/${selectedPeer.id}`, {
        method: 'POST',
        body: JSON.stringify({
          content: draft,
          mediaType,
          mediaUrl,
        }),
      });
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
      );
      setDraft('');
      setMediaType('none');
      setMediaUrl('');
      loadConversations();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const canDm = currentUser.role === 'OWNER' || Boolean(permissions.can_dm);
  const canVoice = currentUser.role === 'OWNER' || Boolean(permissions.can_voice_call);
  const canVideo = currentUser.role === 'OWNER' || Boolean(permissions.can_video_call);
  const canScreen = currentUser.role === 'OWNER' || Boolean(permissions.can_screen_share);

  const otherMembers = allUsers.filter((u) => u.id !== currentUser.id);

  return (
    <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[580px]">
      {/* Left Conversations & Member Picker */}
      <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-stone-200/70 dark:border-stone-800/80 flex flex-col">
        <div className="p-4 border-b border-stone-200/60 dark:border-stone-800/70">
          <h2 className="font-display text-xl font-semibold text-stone-900 dark:text-stone-100">
            Pesan Pribadi
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Komunikasi langsung antar anggota
          </p>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-stone-200/50 dark:divide-stone-800/60 max-h-64 md:max-h-[520px]">
          {conversations.map((c) => (
            <button
              key={c.peer.id}
              type="button"
              onClick={() => onSelectPeer(c.peer)}
              className={`w-full p-3.5 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                selectedPeer?.id === c.peer.id
                  ? 'bg-amber-500/10'
                  : 'hover:bg-stone-100/70 dark:hover:bg-stone-800/50'
              }`}
            >
              <Avatar
                src={c.peer.avatarUrl}
                name={c.peer.displayName}
                size="sm"
                role={c.peer.role}
                online={c.peer.online}
                showPresence
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                    {c.peer.displayName}
                  </p>
                  {c.unreadCount > 0 && (
                    <span className="text-[11px] font-mono-tabular font-semibold text-amber-700 dark:text-amber-400">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
                  {c.lastMessage?.content || 'Lampiran media'}
                </p>
              </div>
            </button>
          ))}

          {/* Members without conversation yet */}
          {otherMembers
            .filter((m) => !conversations.some((c) => c.peer.id === m.id))
            .map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectPeer(m)}
                className={`w-full p-3.5 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                  selectedPeer?.id === m.id
                    ? 'bg-amber-500/10'
                    : 'hover:bg-stone-100/70 dark:hover:bg-stone-800/50'
                }`}
              >
                <Avatar
                  src={m.avatarUrl}
                  name={m.displayName}
                  size="sm"
                  role={m.role}
                  online={m.online}
                  showPresence
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                    {m.displayName}
                  </p>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                    {getRoleLabel(m.role, m.isVip)} · Mulai percakapan
                  </p>
                </div>
              </button>
            ))}

          {otherMembers.length === 0 && (
            <div className="p-6 text-center text-xs text-stone-500">
              Belum ada anggota lain yang terdaftar.
            </div>
          )}
        </div>
      </div>

      {/* Right Chat Thread */}
      <div className="md:col-span-8 flex flex-col min-h-[420px]">
        {selectedPeer ? (
          <>
            {/* Thread Header */}
            <div className="p-4 border-b border-stone-200/70 dark:border-stone-800/80 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  src={selectedPeer.avatarUrl}
                  name={selectedPeer.displayName}
                  size="sm"
                  role={selectedPeer.role}
                  online={selectedPeer.online}
                  showPresence
                  onClick={() => onOpenProfile(selectedPeer.id)}
                />
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpenProfile(selectedPeer.id)}
                    className="text-sm font-semibold text-stone-900 dark:text-stone-100 hover:underline truncate block cursor-pointer"
                  >
                    {selectedPeer.displayName}
                  </button>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {selectedPeer.online
                      ? 'Online'
                      : `Terakhir aktif ${formatRelativeTime(selectedPeer.lastActiveAt)}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {canVoice && (
                  <button
                    type="button"
                    onClick={() => onStartCall(selectedPeer, 'voice')}
                    title="Panggilan Suara"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-stone-200 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 text-stone-700 dark:text-stone-200 whitespace-nowrap cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Suara
                  </button>
                )}
                {canVideo && (
                  <button
                    type="button"
                    onClick={() => onStartCall(selectedPeer, 'video')}
                    title="Panggilan Video"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-stone-200 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 text-stone-700 dark:text-stone-200 whitespace-nowrap cursor-pointer"
                  >
                    <Video className="w-3.5 h-3.5" />
                    Video
                  </button>
                )}
                {canScreen && (
                  <button
                    type="button"
                    onClick={() => onStartCall(selectedPeer, 'screen')}
                    title="Berbagi Layar"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-stone-200 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 text-stone-700 dark:text-stone-200 whitespace-nowrap cursor-pointer"
                  >
                    <MonitorUp className="w-3.5 h-3.5" />
                    Layar
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[420px]">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-stone-500 py-16">
                  Mulai percakapan pribadi dengan {selectedPeer.displayName}.
                </div>
              ) : (
                messages.map((m) => {
                  const mine = m.senderId === currentUser.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm space-y-2 ${
                          mine
                            ? 'bg-stone-900 dark:bg-amber-600 text-white'
                            : 'bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100'
                        }`}
                      >
                        {m.mediaType === 'photo' && m.mediaUrl && (
                          <img
                            src={m.mediaUrl}
                            alt="Lampiran foto"
                            referrerPolicy="no-referrer"
                            onClick={() => onOpenLightbox(m.mediaUrl, 'Foto Pesan')}
                            className="max-h-56 rounded-xl object-cover cursor-pointer"
                          />
                        )}
                        {m.mediaType === 'video' && m.mediaUrl && (
                          <video src={m.mediaUrl} controls className="max-h-56 rounded-xl" />
                        )}
                        {m.mediaType === 'music' && m.mediaUrl && (
                          <audio src={m.mediaUrl} controls className="w-56 h-9" />
                        )}
                        {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                        <p
                          className={`text-[10px] tabular-nums ${
                            mine ? 'text-stone-300' : 'text-stone-500 dark:text-stone-400'
                          }`}
                        >
                          {formatRelativeTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            {error && <p className="px-4 py-1 text-xs text-rose-600">{error}</p>}
            {mediaUrl && (
              <div className="mx-4 mb-2 p-2 rounded-xl bg-stone-100 dark:bg-stone-800 flex items-center justify-between gap-2 text-xs">
                <span className="truncate">Media terlampir ({mediaType})</span>
                <button
                  type="button"
                  onClick={() => {
                    setMediaType('none');
                    setMediaUrl('');
                  }}
                  className="p-1 hover:text-rose-500 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {canDm ? (
              <form
                onSubmit={handleSend}
                className="p-3.5 border-t border-stone-200/70 dark:border-stone-800/80 flex items-center gap-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*"
                  onChange={handleUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  title="Lampirkan Foto, Video, atau Musik"
                  className="p-2.5 rounded-xl text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 transition-colors cursor-pointer"
                >
                  {uploading ? (
                    <Music className="w-4 h-4 animate-spin" />
                  ) : (
                    <ImageIcon className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Kirim pesan ke ${selectedPeer.displayName}...`}
                  className="flex-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() && !mediaUrl}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white hover:bg-stone-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Kirim
                </button>
              </form>
            ) : (
              <div className="p-3.5 border-t border-stone-200/70 text-xs text-stone-500 text-center">
                Jabatan Anda saat ini tidak memiliki izin mengirim pesan pribadi.
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
            <p className="font-display text-2xl text-stone-800 dark:text-stone-200">
              Pilih Anggota untuk Memulai Pesan
            </p>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400 max-w-sm">
              Anda dapat mengirim teks, foto, video, musik, serta memulai panggilan suara, panggilan video, dan berbagi layar secara real-time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
