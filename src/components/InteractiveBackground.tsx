import React, { useEffect, useState } from 'react';
import { SiteSettings } from '../types';

interface InteractiveBackgroundProps {
  settings: SiteSettings;
  personalBgUrl?: string;
}

export const InteractiveBackground: React.FC<InteractiveBackgroundProps> = ({
  settings,
  personalBgUrl,
}) => {
  const [pointer, setPointer] = useState({ x: 50, y: 30 });
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [personalBgUrl, settings.background_url]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        const x = Math.round((e.clientX / window.innerWidth) * 100);
        const y = Math.round((e.clientY / window.innerHeight) * 100);
        setPointer({ x, y });
        raf = 0;
      });
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  const activeBgUrl = personalBgUrl || settings.background_url;
  const glowIntensity = Math.min(1, Math.max(0.1, Number(settings.glow_intensity) || 0.55));
  const isDark = settings.theme_mode === 'dark';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden transition-colors duration-500 bg-[#F9F6F1] dark:bg-[#0D0C10]"
    >
      {activeBgUrl && !imgFailed && settings.background_type !== 'minimal' && (
        <img
          src={activeBgUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`h-full w-full object-cover transition-opacity duration-700 ${
            isDark ? 'opacity-35' : 'opacity-45'
          }`}
        />
      )}

      {/* Soft interactive ambient glow */}
      <div
        className="absolute inset-0 transition-transform duration-300 ease-out"
        style={{
          background: isDark
            ? `radial-gradient(680px circle at ${pointer.x}% ${pointer.y}%, rgba(212, 175, 55, ${
                0.16 * glowIntensity
              }), transparent 62%), radial-gradient(820px circle at ${100 - pointer.x}% ${
                100 - pointer.y
              }%, rgba(180, 130, 140, ${0.1 * glowIntensity}), transparent 68%)`
            : `radial-gradient(680px circle at ${pointer.x}% ${pointer.y}%, rgba(218, 178, 110, ${
                0.24 * glowIntensity
              }), transparent 62%), radial-gradient(820px circle at ${100 - pointer.x}% ${
                100 - pointer.y
              }%, rgba(226, 185, 190, ${0.22 * glowIntensity}), transparent 68%)`,
        }}
      />

      {/* Subtle scrim for crisp readability */}
      <div
        className={`absolute inset-0 ${
          isDark
            ? 'bg-gradient-to-b from-[#0D0C10]/65 via-[#0D0C10]/55 to-[#0D0C10]/85'
            : 'bg-gradient-to-b from-[#FAF7F2]/55 via-[#FAF7F2]/45 to-[#F4EFE7]/75'
        }`}
      />
    </div>
  );
};
