import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "Williamson Scheduling <notifications@williamson-scheduling.com>";
const APP_URL = process.env.NEXTAUTH_URL ?? "https://williamson-scheduling.vercel.app";

function buildEmailHtml({
  emoji,
  heading,
  subheading,
  messageContent,
  ctaUrl,
  ctaLabel,
  footerNote,
}: {
  emoji: string;
  heading: string;
  subheading: string;
  messageContent: string;
  ctaUrl: string;
  ctaLabel: string;
  footerNote: string;
}) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; background: #f8fafc; padding: 32px 16px;">
      <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="font-size: 28px; margin-bottom: 8px;">${emoji}</div>
        <h2 style="margin: 0 0 4px; font-size: 18px; color: #111827;">${heading}</h2>
        <p style="margin: 0 0 20px; font-size: 14px; color: #6b7280;">${subheading}</p>
        <div style="background: #f1f5f9; border-left: 3px solid #3b82f6; border-radius: 6px; padding: 14px 16px; margin-bottom: 24px;">
          <p style="margin: 0; font-size: 15px; color: #1e293b; line-height: 1.5;">${messageContent}</p>
        </div>
        <a href="${ctaUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;">
          ${ctaLabel} →
        </a>
        <p style="margin: 20px 0 0; font-size: 12px; color: #9ca3af;">${footerNote}</p>
      </div>
    </div>
  `;
}

export async function sendMentionEmail({
  toEmail,
  toName,
  fromName,
  messageContent,
  jobName,
  phaseName,
}: {
  toEmail: string;
  toName: string;
  fromName: string;
  messageContent: string;
  jobName: string;
  phaseName?: string | null;
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping email notification");
    return;
  }
  if (toEmail.endsWith("@nologin.local")) return;

  const context = phaseName ? `${jobName} → ${phaseName}` : jobName;

  const html = buildEmailHtml({
    emoji: "💬",
    heading: `${fromName} mentioned you`,
    subheading: context,
    messageContent,
    ctaUrl: `${APP_URL}/messages`,
    ctaLabel: "View Message",
    footerNote: `You received this because you were @mentioned. You can turn these off in <a href="${APP_URL}/settings" style="color: #3b82f6;">Settings → Notifications</a>.`,
  });

  try {
    await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: `${fromName} mentioned you in ${jobName}`,
      html,
    });
  } catch (err) {
    console.error("Failed to send mention email:", err);
  }
}

export async function sendNewMessageEmail({
  toEmail,
  toName,
  fromName,
  messageContent,
  jobName,
  phaseName,
}: {
  toEmail: string;
  toName: string;
  fromName: string;
  messageContent: string;
  jobName: string;
  phaseName?: string | null;
}) {
  if (!resend) return;
  if (toEmail.endsWith("@nologin.local")) return;

  const context = phaseName ? `${jobName} → ${phaseName}` : jobName;

  const html = buildEmailHtml({
    emoji: "📬",
    heading: `New message from ${fromName}`,
    subheading: context,
    messageContent,
    ctaUrl: `${APP_URL}/messages`,
    ctaLabel: "View Message",
    footerNote: `You received this because you are an admin. You can turn these off in <a href="${APP_URL}/settings" style="color: #3b82f6;">Settings → Notifications</a>.`,
  });

  try {
    await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: `New message in ${jobName} from ${fromName}`,
      html,
    });
  } catch (err) {
    console.error("Failed to send new message email:", err);
  }
}
