export type UserRole = 'OWNER' | 'MASTER' | 'VIP' | 'MEMBER';

export interface User {
  id: string;
  email?: string;
  username: string;
  displayName: string;
  role: UserRole;
  isVip: boolean;
  vipTier: string;
  vipExpiresAt: string | null;
  bio: string;
  avatarUrl: string;
  bannerUrl: string;
  personalBgUrl: string;
  personalTheme: string;
  emailVerified: boolean;
  isBlocked: boolean;
  blockReason: string;
  online: boolean;
  lastActiveAt: string;
  createdAt: string;
  activeSessions?: number;
}

export interface RolePermissions {
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

export interface GoogleAuthConfigStatus {
  configured: boolean;
  projectId: string;
  authDomain: string;
  oAuthClientId: string;
  appUrl: string;
  redirectHandlers: string[];
}

export interface SiteSettings {
  platform_name: string;
  platform_tagline: string;
  theme_preset: string;
  theme_mode: 'light' | 'dark' | string;
  accent_color: string;
  glass_opacity: string;
  border_radius: string;
  layout_density: string;
  background_type: string;
  background_url: string;
  hero_banner_url: string;
  glow_intensity: string;
  allow_registration: string;
  require_email_verification: string;
}

export interface CommentItem {
  id: string;
  postId: string;
  authorId: string;
  content: string;
  createdAt: string;
  author: {
    id: string;
    displayName: string;
    username: string;
    avatarUrl: string;
    role: UserRole;
    isVip: boolean;
  };
}

export interface PostItem {
  id: string;
  authorId: string;
  roomId: string | null;
  content: string;
  mediaType: 'none' | 'photo' | 'video' | 'music';
  mediaUrl: string;
  mediaTitle: string;
  isPinned: boolean;
  createdAt: string;
  author: User;
  likesCount: number;
  likedByMe: boolean;
  comments: CommentItem[];
}

export interface DirectMessageItem {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  mediaType: 'none' | 'photo' | 'video' | 'music';
  mediaUrl: string;
  isRead: boolean;
  createdAt: string;
}

export interface ConversationItem {
  peer: User;
  lastMessage: {
    id: string;
    content: string;
    mediaType: string;
    senderId: string;
    createdAt: string;
  } | null;
  unreadCount: number;
}

export interface RoomItem {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  minRole: UserRole;
  requiresApproval: boolean;
  memberCount: number;
  isMember: boolean;
  requestStatus: 'none' | 'pending' | 'approved' | 'rejected' | 'revoked';
  reviewNote: string;
  createdAt: string;
}

export interface RoomMessageItem {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  mediaType: 'none' | 'photo' | 'video' | 'music';
  mediaUrl: string;
  createdAt: string;
  sender: {
    id: string;
    displayName: string;
    username: string;
    avatarUrl: string;
    role: UserRole;
    isVip: boolean;
  };
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  linkTarget: string;
  isRead: boolean;
  createdAt: string;
  actorName: string | null;
  actorAvatar: string | null;
}

export interface JoinRequestItem {
  id: string;
  roomId: string;
  roomName: string;
  roomCover: string;
  userId: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  reviewNote: string;
  createdAt: string;
  updatedAt: string;
  applicant: {
    id: string;
    displayName: string;
    username: string;
    email: string;
    avatarUrl: string;
    role: UserRole;
    isVip: boolean;
    online: boolean;
    lastActiveAt: string;
  };
}

export interface ActivityLogItem {
  id: string;
  user_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  details: string;
  ip_address: string;
  created_at: string;
  display_name?: string;
  username?: string;
  role?: UserRole;
}
