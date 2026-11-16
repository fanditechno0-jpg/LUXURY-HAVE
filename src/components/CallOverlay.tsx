import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { UserRole } from '../types';

export interface CallPeerInfo {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  role: UserRole;
}

export interface CallSessionState {
  status: 'outgoing' | 'incoming' | 'connected';
  callType: 'voice' | 'video' | 'screen';
  peer: CallPeerInfo;
  isCaller: boolean;
}

interface CallOverlayProps {
  callState: CallSessionState | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  errorMessage?: string;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({
  callState,
  localStream,
  remoteStream,
  isMuted,
  isCameraOff,
  isScreenSharing,
  errorMessage,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!callState || callState.status !== 'connected') {
      setElapsedSec(0);
      return;
    }
    const timer = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [callState?.status]);

  if (!callState) return null;

  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  const hasRemoteVideo = Boolean(remoteStream && remoteStream.getVideoTracks().length > 0);
  const hasLocalVideo = Boolean(localStream && localStream.getVideoTracks().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <audio ref={remoteAudioRef} autoPlay playsInline />
      <div className="w-full max-w-2xl rounded-3xl border border-stone-200/30 dark:border-stone-700/60 bg-stone-950/95 text-white overflow-hidden shadow-2xl">
        {/* Call Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar
              src={callState.peer.avatarUrl}
              name={callState.peer.displayName}
              size="sm"
              role={callState.peer.role}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{callState.peer.displayName}</p>
              <p className="text-xs text-stone-400">
                {callState.status === 'incoming' &&
                  `Panggilan ${
                    callState.callType === 'voice'
                      ? 'Suara'
                      : callState.callType === 'screen'
                        ? 'Berbagi Layar'
                        : 'Video'
                  } Masuk`}
                {callState.status === 'outgoing' && 'Memanggil...'}
                {callState.status === 'connected' && (
                  <span className="font-mono-tabular text-emerald-400">
                    Terhubung · {mins}:{secs}
                  </span>
                )}
              </p>
            </div>
          </div>
          <span className="text-xs text-stone-400 whitespace-nowrap">
            Persetujuan Perangkat Aktif
          </span>
        </div>

        {errorMessage && (
          <div className="mx-6 mt-4 rounded-xl bg-rose-950/70 border border-rose-700/50 px-4 py-2.5 text-xs text-rose-200">
            {errorMessage}
          </div>
        )}

        {/* Video / Avatar Stage */}
        <div className="relative h-72 sm:h-96 bg-stone-900 flex items-center justify-center">
          {hasRemoteVideo ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="h-full w-full object-contain bg-black"
            />
          ) : (
            <div className="flex flex-col items-center gap-4 text-center px-6">
              <Avatar
                src={callState.peer.avatarUrl}
                name={callState.peer.displayName}
                size="xl"
                role={callState.peer.role}
              />
              <div>
                <p className="text-lg font-display font-semibold">{callState.peer.displayName}</p>
                <p className="text-xs text-stone-400 mt-1">
                  {callState.status === 'incoming'
                    ? 'Membutuhkan izin Anda sebelum mengaktifkan mikrofon atau kamera'
                    : callState.status === 'outgoing'
                      ? 'Menunggu jawaban anggota...'
                      : 'Sesi audio aktif'}
                </p>
              </div>
            </div>
          )}

          {hasLocalVideo && (
            <div className="absolute bottom-4 right-4 w-32 sm:w-44 aspect-video rounded-2xl overflow-hidden border border-white/20 bg-black shadow-lg">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            </div>
          )}
        </div>

        {/* Call Controls */}
        <div className="px-6 py-5 border-t border-white/10 flex items-center justify-center gap-3 flex-wrap">
          {callState.status === 'incoming' ? (
            <>
              <button
                type="button"
                onClick={onAccept}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Phone className="w-4 h-4" />
                Terima Panggilan
              </button>
              <button
                type="button"
                onClick={onReject}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                Tolak
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onToggleMute}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isMuted ? 'bg-rose-600/80 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {isMuted ? 'Mic Mati' : 'Mic Aktif'}
              </button>

              <button
                type="button"
                onClick={onToggleCamera}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isCameraOff
                    ? 'bg-stone-700 text-stone-200'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                {isCameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                {isCameraOff ? 'Kamera Mati' : 'Kamera Aktif'}
              </button>

              <button
                type="button"
                onClick={onToggleScreenShare}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isScreenSharing
                    ? 'bg-amber-600 text-white'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                <MonitorUp className="w-4 h-4" />
                {isScreenSharing ? 'Hentikan Layar' : 'Bagikan Layar'}
              </button>

              <button
                type="button"
                onClick={onHangup}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                Akhiri
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
