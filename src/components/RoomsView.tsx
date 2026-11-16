import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, Image as ImageIcon, Lock, Send, ShieldAlert } from 'lucide-react';
import { apiFetch, formatRelativeTime, getRoleLabel, uploadMedia } from '../lib/api';
import { RoomItem, RoomMessageItem, User } from '../types';
import { Avatar } from './Avatar';

interface RoomsViewProps {
  currentUser: User;
  rooms: RoomItem[];
  onRefreshRooms: () => void;
  incomingRoomMessage: { roomId: string; message: RoomMessageItem } | null;
  onOpenProfile: (userId: string) => void;
  onOpenLightbox: (url: string, title?: string) => void;
}

export const RoomsView: React.FC<RoomsViewProps> = ({
  currentUser,
  rooms,
  onRefreshRooms,
  incomingRoomMessage,
  onOpenProfile,
  onOpenLightbox,
}) => {
  const [activeRoom, setActiveRoom] = useState<RoomItem | null>(null);
  const [messages, setMessages] = useState<RoomMessageItem[]>([]);
  const [joinNote, setJoinNote] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [mediaType, setMediaType] = useState<'none' | 'photo' | 'video' | 'music'>('none');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadRoomMessages = async (roomId: string) => {
    setError('');
    try {
      const res = await apiFetch<{ messages: RoomMessageItem[] }>(`/api/rooms/${roomId}/messages`);
      setMessages(res.messages);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (activeRoom) {
      loadRoomMessages(activeRoom.id);
    }
  }, [activeRoom?.id]);

  useEffect(() => {
    if (!incomingRoomMessage || !activeRoom) return;
    if (incomingRoomMessage.roomId === activeRoom.id) {
      setMessages((prev) =>
        prev.some((m) => m.id === incomingRoomMessage.message.id)
          ? prev
          : [...prev, incomingRoomMessage.message]
      );
    }
  }, [incomingRoomMessage, activeRoom?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleJoinRequest = async (roomId: string) => {
    setFeedback('');
    setError('');
    try {
      await apiFetch(`/api/rooms/${roomId}/join-request`, {
        method: 'POST',
        body: JSON.stringify({ message: joinNote[roomId] || '' }),
      });
      setFeedback('Permintaan masuk berhasil dikirim ke OWNER untuk ditinjau.');
      onRefreshRooms();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
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

  const handleSendRoomMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom || (!draft.trim() && !mediaUrl)) return;
    setError('');
    try {
      const res = await apiFetch<{ message: RoomMessageItem }>(
        `/api/rooms/${activeRoom.id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content: draft, mediaType, mediaUrl }),
        }
      );
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
      );
      setDraft('');
      setMediaType('none');
      setMediaUrl('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (activeRoom) {
    return (
      <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass overflow-hidden flex flex-col min-h-[580px]">
        <div className="p-4 border-b border-stone-200/70 dark:border-stone-800/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setActiveRoom(null)}
              className="p-2 rounded-xl border border-stone-200 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100 truncate">
                {activeRoom.name}
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                {activeRoom.memberCount} anggota disetujui
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[450px]">
          {messages.length === 0 ? (
            <div className="py-16 text-center text-xs text-stone-500">
              Belum ada percakapan di ruang ini.
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="flex items-start gap-3">
                <Avatar
                  src={m.sender.avatarUrl}
                  name={m.sender.displayName}
                  size="sm"
                  role={m.sender.role}
                  onClick={() => onOpenProfile(m.sender.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => onOpenProfile(m.sender.id)}
                      className="font-semibold text-stone-900 dark:text-stone-100 hover:underline cursor-pointer"
                    >
                      {m.sender.displayName}
                    </button>
                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                      {getRoleLabel(m.sender.role, m.sender.isVip)}
                    </span>
                    <span aria-hidden="true" className="text-stone-400">
                      ·
                    </span>
                    <span className="text-stone-500 tabular-nums">
                      {formatRelativeTime(m.createdAt)}
                    </span>
                  </div>
                  {m.content && (
                    <p className="mt-1 text-sm text-stone-800 dark:text-stone-200 whitespace-pre-wrap break-words">
                      {m.content}
                    </p>
                  )}
                  {m.mediaType === 'photo' && m.mediaUrl && (
                    <img
                      src={m.mediaUrl}
                      alt="Media ruang"
                      referrerPolicy="no-referrer"
                      onClick={() => onOpenLightbox(m.mediaUrl, activeRoom.name)}
                      className="mt-2 max-h-60 rounded-2xl object-cover cursor-pointer"
                    />
                  )}
                  {m.mediaType === 'video' && m.mediaUrl && (
                    <video src={m.mediaUrl} controls className="mt-2 max-h-60 rounded-2xl" />
                  )}
                  {m.mediaType === 'music' && m.mediaUrl && (
                    <audio src={m.mediaUrl} controls className="mt-2 w-64 h-9" />
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="px-4 py-1 text-xs text-rose-600">{error}</p>}

        <form
          onSubmit={handleSendRoomMessage}
          className="p-4 border-t border-stone-200/70 dark:border-stone-800/80 flex items-center gap-2"
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
            className="p-2.5 rounded-xl text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800/70 cursor-pointer"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Kirim pesan ke ${activeRoom.name}...`}
            className="flex-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-sm text-stone-900 dark:text-stone-100"
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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl font-semibold text-stone-900 dark:text-stone-100">
          Ruang Khusus & Join Request
        </h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Akses ke ruang eksklusif memerlukan persetujuan langsung dari OWNER.
        </p>
      </div>

      {feedback && (
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200">
          {feedback}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 px-4 py-3 text-xs text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5">
        {rooms.map((room) => (
          <div
            key={room.id}
            className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass overflow-hidden grid grid-cols-1 sm:grid-cols-12"
          >
            <div
              onClick={() =>
                room.coverUrl ? onOpenLightbox(room.coverUrl, room.name) : undefined
              }
              className="sm:col-span-5 h-48 sm:h-auto min-h-[190px] bg-stone-900 cursor-pointer overflow-hidden"
            >
              {room.coverUrl ? (
                <img
                  src={room.coverUrl}
                  alt={room.name}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-stone-800 to-amber-950" />
              )}
            </div>

            <div className="sm:col-span-7 p-6 flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-2xl font-semibold text-stone-900 dark:text-stone-100">
                    {room.name}
                  </h3>
                  <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums whitespace-nowrap">
                    {room.memberCount} anggota
                  </span>
                </div>
                <p className="mt-2 text-xs sm:text-sm text-stone-600 dark:text-stone-300 leading-relaxed">
                  {room.description}
                </p>
              </div>

              {room.isMember || currentUser.role === 'OWNER' ? (
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-stone-200/60 dark:border-stone-800/70">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Izin Masuk Aktif
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveRoom(room)}
                    className="px-5 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white hover:bg-stone-800 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Masuk ke Ruang
                  </button>
                </div>
              ) : room.requestStatus === 'pending' ? (
                <div className="pt-3 border-t border-stone-200/60 dark:border-stone-800/70 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>Permintaan masuk sedang menunggu persetujuan & pemeriksaan OWNER.</span>
                </div>
              ) : (
                <div className="pt-3 border-t border-stone-200/60 dark:border-stone-800/70 space-y-2.5">
                  {room.requestStatus === 'rejected' || room.requestStatus === 'revoked' ? (
                    <p className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      {room.requestStatus === 'revoked'
                        ? 'Izin masuk sebelumnya telah dicabut oleh OWNER.'
                        : 'Permintaan sebelumnya ditolak.'}
                      {room.reviewNote ? ` Catatan: ${room.reviewNote}` : ''}
                    </p>
                  ) : null}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={joinNote[room.id] || ''}
                      onChange={(e) =>
                        setJoinNote((prev) => ({ ...prev, [room.id]: e.target.value }))
                      }
                      placeholder="Alasan / perkenalan singkat untuk OWNER..."
                      className="flex-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-2 text-xs text-stone-900 dark:text-stone-100"
                    />
                    <button
                      type="button"
                      onClick={() => handleJoinRequest(room.id)}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-amber-600 text-white hover:bg-stone-800 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Ajukan Join Request
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
