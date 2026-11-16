import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Compass,
  Crown,
  DoorClosed,
  LogOut,
  MessageSquare,
  Moon,
  Phone,
  Search,
  Settings,
  Shield,
  Sun,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { Avatar } from './components/Avatar';
import { CallOverlay, CallSessionState } from './components/CallOverlay';
import { FeedView } from './components/FeedView';
import { InteractiveBackground } from './components/InteractiveBackground';
import { MessagesView } from './components/MessagesView';
import { OwnerDashboard, OwnerPanelTab } from './components/OwnerDashboard';
import { ProfileView } from './components/ProfileView';
import { RoomsView } from './components/RoomsView';
import { apiFetch, formatRelativeTime, getRoleLabel } from './lib/api';
import { signOutFromFirebase } from './lib/firebaseAuth';
import {
  DirectMessageItem,
  NotificationItem,
  PostItem,
  RolePermissions,
  RoomItem,
  RoomMessageItem,
  SiteSettings,
  User,
} from './types';

type ActiveView = 'feed' | 'rooms' | 'messages' | 'notifications' | 'profile' | 'owner';

const DEFAULT_SETTINGS: SiteSettings = {
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
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);

  const [viewHistory, setViewHistory] = useState<ActiveView[]>(['feed']);
  const currentView = viewHistory[viewHistory.length - 1] || 'feed';
  const [ownerTab, setOwnerTab] = useState<OwnerPanelTab>('members');
  const [profileTargetId, setProfileTargetId] = useState<string>('');
  const [selectedDmPeer, setSelectedDmPeer] = useState<User | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'photo' | 'video' | 'music'>('all');
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadDms, setUnreadDms] = useState(0);

  const [incomingDmEvent, setIncomingDmEvent] = useState<{
    message: DirectMessageItem;
    sender: User;
  } | null>(null);
  const [incomingRoomMsg, setIncomingRoomMsg] = useState<{
    roomId: string;
    message: RoomMessageItem;
  } | null>(null);

  const [lightbox, setLightbox] = useState<{ url: string; title?: string } | null>(null);
  const [toast, setToast] = useState<string>('');

  // WebRTC Call State
  const [callState, setCallState] = useState<CallSessionState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [callError, setCallError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const callStateRef = useRef<CallSessionState | null>(null);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4000);
  };

  const navigateTo = useCallback((view: ActiveView) => {
    setViewHistory((prev) => (prev[prev.length - 1] === view ? prev : [...prev.slice(-8), view]));
  }, []);

  const goBack = () => {
    setViewHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : ['feed']));
  };

  // Sync HTML theme class & CSS variables
  useEffect(() => {
    const effectiveMode =
      currentUser?.personalTheme && currentUser.personalTheme !== 'inherit'
        ? currentUser.personalTheme
        : siteSettings.theme_mode;

    const root = document.documentElement;
    if (effectiveMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.style.setProperty('--lh-accent', siteSettings.accent_color || '#b8860b');
    root.style.setProperty('--lh-glass-opacity', siteSettings.glass_opacity || '0.78');
    root.style.setProperty('--lh-radius', `${siteSettings.border_radius || '20'}px`);
    root.style.setProperty('--lh-glow-intensity', siteSettings.glow_intensity || '0.55');
  }, [siteSettings, currentUser?.personalTheme]);

  const loadPosts = useCallback(async (filter: 'all' | 'photo' | 'video' | 'music' = mediaFilter) => {
    setPostsLoading(true);
    try {
      const res = await apiFetch<{ posts: PostItem[] }>(`/api/posts?mediaType=${filter}`);
      setPosts(res.posts);
    } catch {
      // Ignored
    } finally {
      setPostsLoading(false);
    }
  }, [mediaFilter]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await apiFetch<{ users: User[] }>('/api/users');
      setUsers(res.users);
    } catch {
      // Ignored
    }
  }, []);

  const loadRooms = useCallback(async () => {
    try {
      const res = await apiFetch<{ rooms: RoomItem[] }>('/api/rooms');
      setRooms(res.rooms);
    } catch {
      // Ignored
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await apiFetch<{ notifications: NotificationItem[] }>('/api/notifications');
      setNotifications(res.notifications);
      setUnreadNotifications(res.notifications.filter((n) => !n.isRead).length);
    } catch {
      // Ignored
    }
  }, []);

  const refreshUnreadDms = useCallback(async () => {
    try {
      const res = await apiFetch<{ unreadDms: number }>('/api/auth/me');
      setUnreadDms(res.unreadDms || 0);
    } catch {
      // Ignored
    }
  }, []);

  const bootstrapSession = useCallback(async () => {
    try {
      const res = await apiFetch<{
        user: User | null;
        permissions: RolePermissions | null;
        siteSettings: SiteSettings;
        unreadNotifications: number;
        unreadDms: number;
      }>('/api/auth/me');
      if (res.siteSettings) setSiteSettings(res.siteSettings);
      if (res.user) {
        setCurrentUser(res.user);
        setPermissions(res.permissions);
        setProfileTargetId(res.user.id);
        setUnreadNotifications(res.unreadNotifications || 0);
        setUnreadDms(res.unreadDms || 0);
      } else {
        setCurrentUser(null);
        setPermissions(null);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    if (!currentUser) return;
    loadPosts(mediaFilter);
    loadUsers();
    loadRooms();
    loadNotifications();
  }, [currentUser?.id, mediaFilter]);

  // WebRTC Cleanup Helper
  const cleanupCall = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setCallState(null);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsScreenSharing(false);
    setCallError('');
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
  }, []);

  const sendWsSignal = useCallback((payload: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string) => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendWsSignal({
            type: 'call:ice',
            targetUserId: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) {
          setRemoteStream(stream);
        }
      };

      pcRef.current = pc;
      return pc;
    },
    [sendWsSignal]
  );

  const startCall = async (peer: User, callType: 'voice' | 'video' | 'screen') => {
    if (!currentUser) return;
    setCallError('');
    try {
      let stream: MediaStream;
      if (callType === 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        setIsScreenSharing(true);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callType === 'video',
        });
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsMuted(false);
      setIsCameraOff(callType === 'voice');
      setCallState({
        status: 'outgoing',
        callType,
        peer: {
          id: peer.id,
          displayName: peer.displayName,
          username: peer.username,
          avatarUrl: peer.avatarUrl,
          role: peer.role,
        },
        isCaller: true,
      });

      const pc = createPeerConnection(peer.id);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendWsSignal({
        type: 'call:invite',
        targetUserId: peer.id,
        callType,
      });
      sendWsSignal({
        type: 'call:offer',
        targetUserId: peer.id,
        offer,
        callType,
      });
    } catch (err) {
      cleanupCall();
      showToast(
        (err as Error).message || 'Izin mikrofon/kamera/layar diperlukan untuk panggilan.'
      );
    }
  };

  const acceptIncomingCall = async () => {
    const current = callStateRef.current;
    if (!current) return;
    setCallError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: current.callType === 'video',
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsCameraOff(current.callType === 'voice');

      const pc = createPeerConnection(current.peer.id);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      if (pendingOfferRef.current) {
        await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendWsSignal({
          type: 'call:accept',
          targetUserId: current.peer.id,
        });
        sendWsSignal({
          type: 'call:answer',
          targetUserId: current.peer.id,
          answer,
        });
        for (const ice of pendingIceRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(ice));
        }
        pendingIceRef.current = [];
      }

      setCallState((prev) => (prev ? { ...prev, status: 'connected' } : null));
    } catch (err) {
      setCallError((err as Error).message || 'Gagal mengakses perangkat audio/video.');
    }
  };

  const rejectIncomingCall = () => {
    if (callStateRef.current) {
      sendWsSignal({
        type: 'call:reject',
        targetUserId: callStateRef.current.peer.id,
      });
    }
    cleanupCall();
  };

  const hangupCall = () => {
    if (callStateRef.current) {
      sendWsSignal({
        type: 'call:hangup',
        targetUserId: callStateRef.current.peer.id,
      });
    }
    cleanupCall();
  };

  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const next = !isMuted;
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !next));
    setIsMuted(next);
  };

  const toggleCamera = async () => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length > 0) {
      const next = !isCameraOff;
      videoTracks.forEach((t) => (t.enabled = !next));
      setIsCameraOff(next);
    } else if (pcRef.current) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const [videoTrack] = camStream.getVideoTracks();
        if (videoTrack) {
          localStreamRef.current.addTrack(videoTrack);
          pcRef.current.addTrack(videoTrack, localStreamRef.current);
          setIsCameraOff(false);
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        }
      } catch {
        setCallError('Tidak dapat mengaktifkan kamera.');
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!pcRef.current || !callStateRef.current) return;
    if (isScreenSharing) {
      setIsScreenSharing(false);
      return;
    }
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const [screenTrack] = screenStream.getVideoTracks();
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && screenTrack) {
        await sender.replaceTrack(screenTrack);
      } else if (screenTrack) {
        pcRef.current.addTrack(screenTrack, screenStream);
      }
      setIsScreenSharing(true);
      screenTrack.onended = () => setIsScreenSharing(false);
    } catch {
      setCallError('Berbagi layar dibatalkan.');
    }
  };

  // WebSocket Real-time Connection
  useEffect(() => {
    if (!currentUser) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    let closedManually = false;
    let reconnectTimer: number | null = null;

    const connectWs = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'presence:update':
              setUsers((prev) =>
                prev.map((u) =>
                  u.id === msg.userId
                    ? { ...u, online: msg.online, lastActiveAt: msg.lastActiveAt }
                    : u
                )
              );
              setPosts((prev) =>
                prev.map((p) =>
                  p.authorId === msg.userId
                    ? { ...p, author: { ...p.author, online: msg.online } }
                    : p
                )
              );
              break;

            case 'post:created':
              setPosts((prev) =>
                prev.some((p) => p.id === msg.post.id) ? prev : [msg.post, ...prev]
              );
              break;

            case 'post:deleted':
              setPosts((prev) => prev.filter((p) => p.id !== msg.postId));
              break;

            case 'post:pinned':
              setPosts((prev) =>
                prev.map((p) => (p.id === msg.postId ? { ...p, isPinned: msg.isPinned } : p))
              );
              break;

            case 'post:liked':
              setPosts((prev) =>
                prev.map((p) =>
                  p.id === msg.postId
                    ? {
                        ...p,
                        likesCount: msg.likesCount,
                        likedByMe:
                          msg.userId === currentUser.id ? msg.liked : p.likedByMe,
                      }
                    : p
                )
              );
              break;

            case 'comment:created':
              setPosts((prev) =>
                prev.map((p) =>
                  p.id === msg.postId
                    ? {
                        ...p,
                        comments: p.comments.some((c) => c.id === msg.comment.id)
                          ? p.comments
                          : [...p.comments, msg.comment],
                      }
                    : p
                )
              );
              break;

            case 'dm:received':
              setIncomingDmEvent({ message: msg.message, sender: msg.sender });
              if (msg.message.recipientId === currentUser.id) {
                setUnreadDms((c) => c + 1);
              }
              break;

            case 'room:message':
              setIncomingRoomMsg({ roomId: msg.roomId, message: msg.message });
              break;

            case 'room:updated':
              loadRooms();
              break;

            case 'notification:new':
              setNotifications((prev) =>
                prev.some((n) => n.id === msg.notification.id)
                  ? prev
                  : [msg.notification, ...prev]
              );
              setUnreadNotifications((c) => c + 1);
              showToast(msg.notification.title + ': ' + msg.notification.body);
              break;

            case 'settings:updated':
              if (msg.siteSettings) setSiteSettings(msg.siteSettings);
              break;

            case 'permissions:updated':
              if (msg.role === currentUser.role && msg.permissions) {
                setPermissions(msg.permissions);
              }
              loadUsers();
              break;

            case 'user:updated':
              if (msg.user) {
                setUsers((prev) => {
                  const exists = prev.some((u) => u.id === msg.user.id);
                  return exists
                    ? prev.map((u) => (u.id === msg.user.id ? { ...u, ...msg.user } : u))
                    : [...prev, msg.user];
                });
                if (msg.user.id === currentUser.id) {
                  setCurrentUser((prev) => (prev ? { ...prev, ...msg.user } : prev));
                }
              }
              break;

            case 'session:revoked':
              showToast(msg.reason || 'Sesi Anda telah diakhiri.');
              setCurrentUser(null);
              setPermissions(null);
              break;

            // WebRTC Signaling
            case 'call:invite':
              if (!callStateRef.current && msg.fromUser) {
                setCallState({
                  status: 'incoming',
                  callType: msg.callType || 'voice',
                  peer: msg.fromUser,
                  isCaller: false,
                });
              }
              break;

            case 'call:offer':
              pendingOfferRef.current = msg.offer;
              if (
                pcRef.current &&
                callStateRef.current?.status === 'connected' &&
                msg.offer
              ) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.offer));
                const answer = await pcRef.current.createAnswer();
                await pcRef.current.setLocalDescription(answer);
                sendWsSignal({
                  type: 'call:answer',
                  targetUserId: msg.fromUserId,
                  answer,
                });
              }
              break;

            case 'call:accept':
              setCallState((prev) => (prev ? { ...prev, status: 'connected' } : null));
              break;

            case 'call:answer':
              if (pcRef.current && msg.answer) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.answer));
                setCallState((prev) => (prev ? { ...prev, status: 'connected' } : null));
              }
              break;

            case 'call:ice':
              if (msg.candidate) {
                if (pcRef.current && pcRef.current.remoteDescription) {
                  await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
                } else {
                  pendingIceRef.current.push(msg.candidate);
                }
              }
              break;

            case 'call:reject':
              showToast('Panggilan ditolak.');
              cleanupCall();
              break;

            case 'call:hangup':
              showToast('Panggilan diakhiri.');
              cleanupCall();
              break;
          }
        } catch {
          // Ignore malformed ws payload
        }
      };

      ws.onclose = () => {
        if (!closedManually) {
          reconnectTimer = window.setTimeout(connectWs, 3000);
        }
      };
    };

    connectWs();

    return () => {
      closedManually = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [currentUser?.id]);

  const handleLogout = async () => {
    try {
      await Promise.all([apiFetch('/api/auth/logout', { method: 'POST' }), signOutFromFirebase()]);
    } catch {
      // Ignored
    }
    cleanupCall();
    setCurrentUser(null);
    setPermissions(null);
    setViewHistory(['feed']);
  };

  const openProfile = (userId: string) => {
    setProfileTargetId(userId);
    navigateTo('profile');
  };

  const openDmWith = (peer: User) => {
    setSelectedDmPeer(peer);
    navigateTo('messages');
  };

  const openOwnerPanel = (panel: OwnerPanelTab = 'members') => {
    setOwnerTab(panel);
    navigateTo('owner');
  };

  const toggleQuickTheme = async () => {
    if (!currentUser) return;
    const nextMode =
      (currentUser.personalTheme !== 'inherit'
        ? currentUser.personalTheme
        : siteSettings.theme_mode) === 'dark'
        ? 'light'
        : 'dark';

    if (currentUser.role === 'OWNER') {
      try {
        const res = await apiFetch<{ siteSettings: SiteSettings }>('/api/owner/settings', {
          method: 'PATCH',
          body: JSON.stringify({ theme_mode: nextMode }),
        });
        setSiteSettings(res.siteSettings);
      } catch {
        // Ignored
      }
    } else {
      try {
        const res = await apiFetch<{ user: User }>('/api/profile', {
          method: 'PATCH',
          body: JSON.stringify({ personalTheme: nextMode }),
        });
        setCurrentUser(res.user);
      } catch {
        // Ignored
      }
    }
  };

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] dark:bg-[#0D0C10]">
        <div className="text-center space-y-2">
          <h1 className="font-display text-4xl font-semibold text-stone-900 dark:text-stone-100">
            LUXURY HAVE
          </h1>
          <p className="text-xs text-stone-500">Memuat ruang aman Anda...</p>
        </div>
      </div>
    );
  }

  if (!currentUser || !permissions) {
    return (
      <>
        <InteractiveBackground settings={siteSettings} />
        <AuthScreen
          siteSettings={siteSettings}
          onAuthenticated={(payload) => {
            setCurrentUser(payload.user);
            setPermissions(payload.permissions);
            if (payload.siteSettings) setSiteSettings(payload.siteSettings);
            setProfileTargetId(payload.user.id);
            setViewHistory(['feed']);
          }}
        />
      </>
    );
  }

  const filteredUsers = users.filter((u) => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const onlineMembers = filteredUsers.filter((u) => u.online);
  const offlineMembers = filteredUsers.filter((u) => !u.online);
  const effectiveIsDark =
    (currentUser.personalTheme !== 'inherit'
      ? currentUser.personalTheme
      : siteSettings.theme_mode) === 'dark';

  return (
    <div className="min-h-screen text-stone-900 dark:text-stone-100">
      <InteractiveBackground
        settings={siteSettings}
        personalBgUrl={currentUser.personalBgUrl}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 max-w-sm rounded-2xl border border-stone-200/80 dark:border-stone-700/80 luxury-glass px-4 py-3 text-xs font-medium shadow-xl">
          {toast}
        </div>
      )}

      {/* Lightbox Modal for Clickable Photos & Banners */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 p-2.5 rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl max-h-[88vh] space-y-2">
            <img
              src={lightbox.url}
              alt={lightbox.title || 'Pratinjau Media'}
              referrerPolicy="no-referrer"
              className="max-h-[80vh] w-auto mx-auto rounded-2xl object-contain"
            />
            {lightbox.title && (
              <p className="text-center text-xs text-stone-300">{lightbox.title}</p>
            )}
          </div>
        </div>
      )}

      {/* WebRTC Call & Screen Sharing Overlay */}
      <CallOverlay
        callState={callState}
        localStream={localStream}
        remoteStream={remoteStream}
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        isScreenSharing={isScreenSharing}
        errorMessage={callError}
        onAccept={acceptIncomingCall}
        onReject={rejectIncomingCall}
        onHangup={hangupCall}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        onToggleScreenShare={toggleScreenShare}
      />

      {/* Main 3-Column Desktop / Responsive Layout */}
      <div className="mx-auto max-w-[1440px] px-3 sm:px-6 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-12 gap-5 pb-24 lg:pb-8">
        {/* KIRI (Left Sidebar): Profil, Navigasi, Pengaturan, Tema, Kembali */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="lg:sticky lg:top-6 space-y-4">
            {/* Clickable User / OWNER Card */}
            <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass overflow-hidden">
              <div
                onClick={() => openProfile(currentUser.id)}
                className="h-20 w-full bg-gradient-to-r from-stone-800 to-amber-900 cursor-pointer overflow-hidden"
              >
                {currentUser.bannerUrl ? (
                  <img
                    src={currentUser.bannerUrl}
                    alt="Banner profil"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    src={siteSettings.hero_banner_url}
                    alt="Banner"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover opacity-70"
                  />
                )}
              </div>

              <div className="px-5 pb-5">
                <div className="-mt-7 flex items-end justify-between gap-2">
                  <Avatar
                    src={currentUser.avatarUrl}
                    name={currentUser.displayName}
                    size="lg"
                    role={currentUser.role}
                    online
                    showPresence
                    onClick={() => openProfile(currentUser.id)}
                  />
                  {viewHistory.length > 1 && (
                    <button
                      type="button"
                      onClick={goBack}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium border border-stone-200 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 whitespace-nowrap cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Kembali
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => openProfile(currentUser.id)}
                  className="mt-3 text-left block w-full cursor-pointer group"
                >
                  <p className="font-display text-xl font-semibold text-stone-900 dark:text-stone-100 group-hover:underline truncate">
                    {currentUser.displayName}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                    @{currentUser.username} ·{' '}
                    <span className="font-semibold text-amber-700 dark:text-amber-400">
                      {getRoleLabel(currentUser.role, currentUser.isVip)}
                    </span>
                  </p>
                </button>
              </div>
            </div>

            {/* Navigation Panel */}
            <nav className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-3 space-y-1">
              {(
                [
                  { id: 'feed', label: 'Linimasa Utama', icon: Compass },
                  { id: 'rooms', label: 'Ruang Khusus', icon: DoorClosed },
                  {
                    id: 'messages',
                    label: 'Pesan Pribadi',
                    icon: MessageSquare,
                    count: unreadDms,
                  },
                  {
                    id: 'notifications',
                    label: 'Notifikasi',
                    icon: Bell,
                    count: unreadNotifications,
                  },
                  { id: 'profile', label: 'Profil & Pengaturan', icon: UserIcon },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active =
                  currentView === item.id &&
                  (item.id !== 'profile' || profileTargetId === currentUser.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === 'profile') setProfileTargetId(currentUser.id);
                      navigateTo(item.id);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-stone-900 dark:bg-amber-600 text-white'
                        : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      {item.label}
                    </span>
                    {'count' in item && item.count > 0 && (
                      <span className="font-mono-tabular text-xs font-semibold">
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}

              {currentUser.role === 'OWNER' && (
                <button
                  type="button"
                  onClick={() => openOwnerPanel('members')}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    currentView === 'owner'
                      ? 'bg-amber-600 text-white'
                      : 'text-amber-700 dark:text-amber-400 hover:bg-amber-500/10'
                  }`}
                >
                  <Crown className="w-4 h-4 shrink-0" />
                  Dashboard OWNER
                </button>
              )}
            </nav>

            {/* Theme, Background & Session Controls */}
            <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-4 space-y-2">
              <button
                type="button"
                onClick={toggleQuickTheme}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition-colors cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  {effectiveIsDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  {effectiveIsDark ? 'Mode Terang' : 'Mode Gelap'}
                </span>
                <span className="text-stone-400">Ubah</span>
              </button>

              {currentUser.role === 'OWNER' && (
                <button
                  type="button"
                  onClick={() => openOwnerPanel('background')}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition-colors cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    Tema & Background
                  </span>
                  <span className="text-stone-400">Atur</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Keluar (Logout)
              </button>
            </div>
          </div>
        </aside>

        {/* TENGAH (Center Stage): Feed, Ruang Khusus, Pesan, Profil, atau OWNER Dashboard */}
        <main className="lg:col-span-6 min-w-0">
          {currentView === 'feed' && (
            <FeedView
              currentUser={currentUser}
              permissions={permissions}
              siteSettings={siteSettings}
              posts={posts}
              loading={postsLoading}
              mediaFilter={mediaFilter}
              onChangeFilter={(f) => setMediaFilter(f)}
              onPostCreated={(post) =>
                setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]))
              }
              onPostDeleted={(postId) => setPosts((prev) => prev.filter((p) => p.id !== postId))}
              onPostLikeToggled={(postId, liked, likesCount) =>
                setPosts((prev) =>
                  prev.map((p) => (p.id === postId ? { ...p, likedByMe: liked, likesCount } : p))
                )
              }
              onCommentAdded={(postId, comment) =>
                setPosts((prev) =>
                  prev.map((p) =>
                    p.id === postId
                      ? {
                          ...p,
                          comments: p.comments.some((c) => c.id === comment.id)
                            ? p.comments
                            : [...p.comments, comment],
                        }
                      : p
                  )
                )
              }
              onPostPinned={(postId, isPinned) =>
                setPosts((prev) =>
                  prev.map((p) => (p.id === postId ? { ...p, isPinned } : p))
                )
              }
              onOpenProfile={openProfile}
              onOpenLightbox={(url, title) => setLightbox({ url, title })}
              onOpenOwnerSettings={
                currentUser.role === 'OWNER' ? () => openOwnerPanel('background') : undefined
              }
            />
          )}

          {currentView === 'rooms' && (
            <RoomsView
              currentUser={currentUser}
              rooms={rooms}
              onRefreshRooms={loadRooms}
              incomingRoomMessage={incomingRoomMsg}
              onOpenProfile={openProfile}
              onOpenLightbox={(url, title) => setLightbox({ url, title })}
            />
          )}

          {currentView === 'messages' && (
            <MessagesView
              currentUser={currentUser}
              permissions={permissions}
              allUsers={users}
              selectedPeer={selectedDmPeer}
              onSelectPeer={setSelectedDmPeer}
              incomingMessageEvent={incomingDmEvent}
              onStartCall={startCall}
              onOpenProfile={openProfile}
              onOpenLightbox={(url, title) => setLightbox({ url, title })}
              onUnreadChanged={refreshUnreadDms}
            />
          )}

          {currentView === 'notifications' && (
            <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-3xl font-semibold text-stone-900 dark:text-stone-100">
                  Notifikasi Real-Time
                </h2>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/notifications/read-all', { method: 'POST' });
                    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
                    setUnreadNotifications(0);
                  }}
                  className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap cursor-pointer"
                >
                  Tandai Semua Dibaca
                </button>
              </div>

              <div className="divide-y divide-stone-200/60 dark:divide-stone-800/70">
                {notifications.length === 0 ? (
                  <p className="py-10 text-center text-xs text-stone-500">
                    Belum ada notifikasi terbaru.
                  </p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={async () => {
                        if (!n.isRead) {
                          await apiFetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
                          setNotifications((prev) =>
                            prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x))
                          );
                          setUnreadNotifications((c) => Math.max(0, c - 1));
                        }
                        if (n.linkTarget.startsWith('dm:')) {
                          const uid = n.linkTarget.slice(3);
                          const peer = users.find((u) => u.id === uid);
                          if (peer) openDmWith(peer);
                        } else if (n.linkTarget.startsWith('owner:') && currentUser.role === 'OWNER') {
                          openOwnerPanel(
                            (n.linkTarget.slice(6) as OwnerPanelTab) || 'join-requests'
                          );
                        } else if (n.linkTarget.startsWith('room:')) {
                          navigateTo('rooms');
                        } else {
                          navigateTo('feed');
                        }
                      }}
                      className={`w-full text-left py-3.5 px-2 rounded-xl flex items-start justify-between gap-3 transition-colors cursor-pointer ${
                        n.isRead ? 'opacity-75' : 'bg-amber-500/5'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-stone-900 dark:text-stone-100">
                          {n.title}
                        </p>
                        <p className="text-xs text-stone-600 dark:text-stone-300 mt-0.5">
                          {n.body}
                        </p>
                      </div>
                      <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {currentView === 'profile' && (
            <ProfileView
              profileUserId={profileTargetId || currentUser.id}
              currentUser={currentUser}
              onProfileUpdated={(u) => {
                setCurrentUser(u);
                setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)));
              }}
              onStartDm={openDmWith}
              onStartCall={startCall}
              onOpenLightbox={(url, title) => setLightbox({ url, title })}
            />
          )}

          {currentView === 'owner' && currentUser.role === 'OWNER' && (
            <OwnerDashboard
              initialTab={ownerTab}
              siteSettings={siteSettings}
              posts={posts}
              rooms={rooms}
              onSettingsUpdated={(s) => setSiteSettings(s)}
              onRefreshPosts={() => loadPosts(mediaFilter)}
              onRefreshRooms={loadRooms}
              onRefreshUsers={loadUsers}
              onOpenProfile={openProfile}
              onInspectViaDm={openDmWith}
              onInspectViaCall={(peer, type) => startCall(peer, type)}
            />
          )}
        </main>

        {/* KANAN (Right Sidebar): Pencarian Anggota, Anggota Online/Offline, Notifikasi & Aktivitas */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="lg:sticky lg:top-6 space-y-4">
            {/* Search Members */}
            <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-4">
              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="Cari anggota atau jabatan..."
                  className="w-full rounded-xl border border-stone-200/80 dark:border-stone-700/70 bg-white/70 dark:bg-stone-900/70 pl-9 pr-3 py-2 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/35"
                />
              </div>
            </div>

            {/* Online & Offline Members List */}
            <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-semibold text-stone-900 dark:text-stone-100">
                  Anggota Komunitas
                </h3>
                <span className="text-xs text-stone-500 tabular-nums">
                  {onlineMembers.length} online
                </span>
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {onlineMembers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                      Online ({onlineMembers.length})
                    </p>
                    {onlineMembers.map((u) => (
                      <div key={u.id} className="flex items-center justify-between gap-2">
                        <div
                          onClick={() => openProfile(u.id)}
                          className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                        >
                          <Avatar
                            src={u.avatarUrl}
                            name={u.displayName}
                            size="xs"
                            role={u.role}
                            online
                            showPresence
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                              {u.displayName}
                            </p>
                            <p className="text-[11px] text-stone-500 truncate">
                              {getRoleLabel(u.role, u.isVip)}
                            </p>
                          </div>
                        </div>
                        {u.id !== currentUser.id && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openDmWith(u)}
                              title="Kirim Pesan"
                              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/60 dark:hover:bg-stone-800/60 cursor-pointer"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startCall(u, 'voice')}
                              title="Panggilan Suara"
                              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/60 dark:hover:bg-stone-800/60 cursor-pointer"
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {offlineMembers.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-stone-200/50 dark:border-stone-800/60">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                      Offline ({offlineMembers.length})
                    </p>
                    {offlineMembers.map((u) => (
                      <div key={u.id} className="flex items-center justify-between gap-2 opacity-80">
                        <div
                          onClick={() => openProfile(u.id)}
                          className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                        >
                          <Avatar
                            src={u.avatarUrl}
                            name={u.displayName}
                            size="xs"
                            role={u.role}
                            online={false}
                            showPresence
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-stone-800 dark:text-stone-200 truncate">
                              {u.displayName}
                            </p>
                            <p className="text-[11px] text-stone-400 truncate">
                              {formatRelativeTime(u.lastActiveAt)}
                            </p>
                          </div>
                        </div>
                        {u.id !== currentUser.id && (
                          <button
                            type="button"
                            onClick={() => openDmWith(u)}
                            title="Kirim Pesan"
                            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-white cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Latest Notifications & Activity Widget */}
            <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-semibold text-stone-900 dark:text-stone-100">
                  Notifikasi Terbaru
                </h3>
                <button
                  type="button"
                  onClick={() => navigateTo('notifications')}
                  className="text-xs text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                >
                  Lihat Semua
                </button>
              </div>
              <div className="space-y-2.5">
                {notifications.slice(0, 4).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => navigateTo('notifications')}
                    className="w-full text-left p-2.5 rounded-2xl hover:bg-stone-200/50 dark:hover:bg-stone-800/60 transition-colors cursor-pointer"
                  >
                    <p className="text-xs font-semibold text-stone-800 dark:text-stone-200 truncate">
                      {n.title}
                    </p>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400 line-clamp-2 mt-0.5">
                      {n.body}
                    </p>
                  </button>
                ))}
                {notifications.length === 0 && (
                  <p className="text-xs text-stone-500">Belum ada notifikasi baru.</p>
                )}
              </div>
            </div>

            {/* Role Security Summary */}
            <div className="rounded-3xl border border-stone-200/80 dark:border-stone-800/80 luxury-glass p-4 flex items-center gap-3 text-xs text-stone-600 dark:text-stone-300">
              <Shield className="w-4 h-4 text-amber-600 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-stone-800 dark:text-stone-200 truncate">
                  Sesi Terenkripsi ({currentUser.role})
                </p>
                <p className="text-[11px] text-stone-500 truncate">
                  {siteSettings.platform_name} · Perlindungan RBAC Aktif
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Compact Mobile Bottom Bar (under 15% viewport height) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-stone-200/80 dark:border-stone-800/80 luxury-glass px-2 py-1.5 flex items-center justify-around">
        <button
          type="button"
          onClick={() => navigateTo('feed')}
          className={`flex flex-col items-center p-1.5 text-[10px] ${
            currentView === 'feed' ? 'text-amber-600 font-semibold' : 'text-stone-500'
          }`}
        >
          <Compass className="w-4 h-4" />
          Feed
        </button>
        <button
          type="button"
          onClick={() => navigateTo('rooms')}
          className={`flex flex-col items-center p-1.5 text-[10px] ${
            currentView === 'rooms' ? 'text-amber-600 font-semibold' : 'text-stone-500'
          }`}
        >
          <DoorClosed className="w-4 h-4" />
          Ruang
        </button>
        <button
          type="button"
          onClick={() => navigateTo('messages')}
          className={`flex flex-col items-center p-1.5 text-[10px] ${
            currentView === 'messages' ? 'text-amber-600 font-semibold' : 'text-stone-500'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          Pesan
        </button>
        <button
          type="button"
          onClick={() => navigateTo('notifications')}
          className={`flex flex-col items-center p-1.5 text-[10px] ${
            currentView === 'notifications' ? 'text-amber-600 font-semibold' : 'text-stone-500'
          }`}
        >
          <Bell className="w-4 h-4" />
          Info
        </button>
        {currentUser.role === 'OWNER' ? (
          <button
            type="button"
            onClick={() => openOwnerPanel('members')}
            className={`flex flex-col items-center p-1.5 text-[10px] ${
              currentView === 'owner' ? 'text-amber-600 font-semibold' : 'text-stone-500'
            }`}
          >
            <Crown className="w-4 h-4" />
            Owner
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openProfile(currentUser.id)}
            className={`flex flex-col items-center p-1.5 text-[10px] ${
              currentView === 'profile' ? 'text-amber-600 font-semibold' : 'text-stone-500'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            Profil
          </button>
        )}
      </nav>
    </div>
  );
}
