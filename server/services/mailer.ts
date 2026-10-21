import nodemailer from "nodemailer";

import { env } from "../env.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailResult = { ok: true } | { ok: false; reason: "not_configured" | "failed"; error?: string };

export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<MailResult>;
}

/** SMTP mailer when SMTP_URL is set; otherwise every send reports "not_configured" (never a fake success). */
class SmtpMailer implements Mailer {
  readonly configured: boolean;
  private readonly transport?: nodemailer.Transporter;

  constructor(url: string | undefined, private readonly from: string) {
    this.configured = !!url;
    if (url) this.transport = nodemailer.createTransport(url);
  }

  async send(message: MailMessage): Promise<MailResult> {
    if (!this.transport) return { ok: false, reason: "not_configured" };
    try {
      await this.transport.sendMail({ from: this.from, ...message });
      return { ok: true };
    } catch (err) {
      // Never include message bodies in logs or stored errors.
      return { ok: false, reason: "failed", error: err instanceof Error ? err.message.slice(0, 200) : "send failed" };
    }
  }
}

let mailer: Mailer | undefined;

export function getMailer(): Mailer {
  mailer ??= new SmtpMailer(env().SMTP_URL, env().MAIL_FROM);
  return mailer;
}

/** Tests inject a recording mailer. */
export function setMailer(next: Mailer) {
  mailer = next;
}
