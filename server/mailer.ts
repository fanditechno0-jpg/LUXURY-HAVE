import nodemailer from 'nodemailer';
import { db } from './db.ts';
import { decryptSecret } from './security.ts';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function getSmtpConfig(): SmtpConfig | null {
  const settingsRows = db
    .prepare(`SELECT key, value FROM site_settings WHERE key LIKE 'smtp_%'`)
    .all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const r of settingsRows) map[r.key] = r.value;

  const host = (map.smtp_host || process.env.SMTP_HOST || '').trim();
  const portRaw = map.smtp_port || process.env.SMTP_PORT || '587';
  const user = (map.smtp_user || process.env.SMTP_USER || '').trim();
  const pass = map.smtp_pass_encrypted
    ? decryptSecret(map.smtp_pass_encrypted)
    : (process.env.SMTP_PASS || '').trim();
  const from = (map.smtp_from || process.env.SMTP_FROM || 'LUXURY HAVE <noreply@luxuryhave.local>').trim();

  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port: Number(portRaw) || 587,
    user,
    pass,
    from,
  };
}

export async function sendVerificationEmail(params: {
  to: string;
  purpose: 'verify_email' | 'reset_password';
  code: string;
  displayName: string;
}): Promise<{ deliveredViaSmtp: boolean }> {
  const smtp = getSmtpConfig();
  const subject =
    params.purpose === 'verify_email'
      ? 'Kode Verifikasi Email — LUXURY HAVE'
      : 'Kode Reset Password — LUXURY HAVE';

  const html = `
    <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #faf7f2; border: 1px solid #e6dccf; border-radius: 16px; color: #1f1b18;">
      <h1 style="margin: 0 0 12px; font-size: 24px; letter-spacing: 0.04em;">LUXURY HAVE</h1>
      <p style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #4a423b;">
        Halo ${params.displayName},<br/>
        Berikut adalah kode ${
          params.purpose === 'verify_email' ? 'verifikasi email' : 'reset password'
        } akun Anda. Kode ini berlaku selama 15 menit.
      </p>
      <div style="margin: 24px 0; padding: 18px; background: #ffffff; border: 1px solid #d9c8b4; border-radius: 12px; text-align: center; font-family: monospace; font-size: 28px; font-weight: 700; letter-spacing: 0.25em; color: #8c6508;">
        ${params.code}
      </div>
      <p style="font-family: sans-serif; font-size: 12px; color: #786c61;">
        Jika Anda tidak merasa melakukan permintaan ini, abaikan pesan ini. Jangan bagikan kode kepada siapa pun.
      </p>
    </div>
  `;

  if (!smtp) {
    console.info(
      `[MAILER] SMTP belum dikonfigurasi. Tujuan=${params.to} | Purpose=${params.purpose} | Kode OTP=${params.code}`
    );
    return { deliveredViaSmtp: false };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  await transporter.sendMail({
    from: smtp.from,
    to: params.to,
    subject,
    html,
  });

  return { deliveredViaSmtp: true };
}
