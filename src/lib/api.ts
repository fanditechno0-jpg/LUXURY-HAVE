export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    const plainTextError =
      !data.error && text && !text.trim().startsWith('<') ? text.trim().slice(0, 220) : '';
    const err = new Error(
      (data.error as string) || plainTextError || `Permintaan gagal (${res.status})`
    ) as Error & {
      status?: number;
      code?: string;
      email?: string;
    };
    err.status = res.status;
    err.code = data.code as string | undefined;
    err.email = data.email as string | undefined;
    throw err;
  }

  return data as T;
}

export async function uploadMedia(
  file: File,
  category: 'post' | 'avatar' | 'banner' | 'personal_bg' | 'site_bg' | 'site_banner' | 'room_cover'
): Promise<{ url: string; mediaType: 'photo' | 'video' | 'music'; originalName: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('category', category);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Gagal mengunggah media.');
  }
  return data;
}

export function formatRelativeTime(iso: string): string {
  if (!iso) return '-';
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  if (sec < 60) return 'Baru saja';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m lalu`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}h lalu`;
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function getRoleLabel(role: string, isVip?: boolean): string {
  if (role === 'OWNER') return 'OWNER';
  if (role === 'MASTER') return 'MASTER';
  if (role === 'VIP' || isVip) return 'VIP';
  return 'MEMBER';
}
