import React, { useState } from 'react';
import { UserRole } from '../types';

interface AvatarProps {
  src?: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  showPresence?: boolean;
  role?: UserRole;
  onClick?: () => void;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-24 h-24 text-2xl',
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 'md',
  online = false,
  showPresence = false,
  role,
  onClick,
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  const initials = (name || 'LH')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const ringTone =
    role === 'OWNER'
      ? 'ring-2 ring-amber-500/70'
      : role === 'MASTER'
        ? 'ring-2 ring-stone-500/60 dark:ring-stone-300/60'
        : role === 'VIP'
          ? 'ring-2 ring-amber-400/50'
          : 'ring-1 ring-stone-300/70 dark:ring-stone-700/80';

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full select-none ${SIZE_CLASSES[size]} ${ringTone} ${
        onClick ? 'cursor-pointer transition-transform duration-150 hover:scale-[1.03]' : ''
      } ${className}`}
      title={name}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-amber-100 via-stone-100 to-rose-100 dark:from-stone-800 dark:via-stone-900 dark:to-amber-950 font-semibold text-stone-800 dark:text-amber-100">
          {initials}
        </span>
      )}

      {showPresence && (
        <span
          aria-label={online ? 'Online' : 'Offline'}
          className={`absolute bottom-0 right-0 block rounded-full border-2 border-white dark:border-stone-950 ${
            size === 'xs' || size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'
          } ${online ? 'bg-emerald-500' : 'bg-stone-400 dark:bg-stone-600'}`}
        />
      )}
    </Wrapper>
  );
};
