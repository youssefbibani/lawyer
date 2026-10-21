/**
 * Arabic (RTL) PDF receipts rendered with headless Chromium (playwright-core).
 *
 * The receipt is built only from the snapshot frozen at issuance. Rendering is offline: every
 * network request from the page is blocked, and fonts come from the host (Noto Naskh Arabic in
 * the Docker image, Arabic system fonts on Windows/macOS). A PDF is reported as generated only
 * after Chromium returned bytes that start with the PDF signature.
 */
import { createHash } from "node:crypto";

import type { Browser } from "playwright-core";

import { env } from "../env.js";

export interface ReceiptSnapshot {
  number: string;
  issuedOn: string;
  office: { legalName: string; address: string | null; city: string | null; phone: string | null; email: string | null; taxId: string | null; barRegistration: string | null };
  client: { fullName: string; nationalId: string | null } | null;
  case: { reference: string; court: string };
  payment: { amount: string; currency: string; paidOn: string; method: string; reference: string | null; notes: string | null };
  agreement: { title: string | null; amount: string; paidAfter: string; remainingAfter: string };
  issuedBy: { name: string };
}

export interface RenderOptions {
  cancelled?: { at: string; reason: string };
}

export type PdfRenderer = (snapshot: ReceiptSnapshot, options?: RenderOptions) => Promise<Buffer>;

const METHOD_LABELS: Record<string, string> = {
  CASH: "نقداً",
  CHECK: "صك بنكي",
  BANK_TRANSFER: "تحويل بنكي",
  CARD: "بطاقة بنكية",
  MOBILE: "دفع عبر الهاتف",
  OTHER: "أخرى",
};

const esc = (value: string | null | undefined) =>
  (value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function formatAmount(amount: string, currency: string): string {
  const [int, dec = "000"] = amount.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${dec.padEnd(3, "0")} ${currency === "TND" ? "د.ت" : currency}`;
}

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function receiptHtml(s: ReceiptSnapshot, options: RenderOptions = {}): string {
  const row = (label: string, value: string, ltr = false) =>
    `<tr><th>${esc(label)}</th><td${ltr ? ' dir="ltr" class="ltr"' : ""}>${value}</td></tr>`;
  const officeLines = [s.office.address, s.office.city].filter(Boolean).map(esc).join(" — ");
  const ids = [s.office.taxId ? `المعرف الجبائي: <bdi dir="ltr">${esc(s.office.taxId)}</bdi>` : "", s.office.barRegistration ? `الترسيم بالهيئة: <bdi dir="ltr">${esc(s.office.barRegistration)}</bdi>` : ""]
    .filter(Boolean)
    .join(" • ");
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(s.number)}</title>
<style>
  @page { size: A5 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #0D0D0D; font-family: "Noto Naskh Arabic", "Amiri", "Traditional Arabic", "Arial", "Tahoma", sans-serif; font-size: 12pt; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #C9A84C; padding-bottom: 6mm; margin-bottom: 6mm; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  .muted { color: #555; font-size: 9.5pt; line-height: 1.6; }
  .number { text-align: left; }
  .number strong { display: block; font-size: 14pt; font-family: "DejaVu Sans Mono", "Consolas", monospace; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: right; width: 32%; font-weight: 600; color: #333; padding: 2.2mm 0; vertical-align: top; }
  td { padding: 2.2mm 0; border-bottom: 1px dotted #ccc; }
  .ltr { text-align: right; unicode-bidi: plaintext; }
  .amount { font-size: 15pt; font-weight: 700; }
  footer { display: flex; justify-content: space-between; margin-top: 10mm; font-size: 10pt; color: #444; }
  .sign { width: 45%; border-top: 1px solid #999; padding-top: 2mm; text-align: center; }
  .stamp { position: fixed; top: 38%; left: 15%; right: 15%; text-align: center; font-size: 46pt; font-weight: 700; color: rgba(181,64,42,.28); border: 6px solid rgba(181,64,42,.28); transform: rotate(-14deg); padding: 4mm; }
  .cancel-note { margin-top: 4mm; padding: 3mm; border: 1px solid #B5402A; color: #B5402A; font-size: 10pt; }
</style></head>
<body>
${options.cancelled ? '<div class="stamp">وصل ملغى</div>' : ""}
<header>
  <div>
    <h1>${esc(s.office.legalName)}</h1>
    <div class="muted">${officeLines}${s.office.phone ? ` • الهاتف: <bdi dir="ltr">${esc(s.office.phone)}</bdi>` : ""}</div>
    ${ids ? `<div class="muted">${ids}</div>` : ""}
  </div>
  <div class="number"><span class="muted">وصل خلاص أتعاب عدد</span><strong dir="ltr">${esc(s.number)}</strong><span class="muted">بتاريخ ${formatDate(s.issuedOn)}</span></div>
</header>
<table>
  ${row("الحريف", esc(s.client?.fullName ?? "—"))}
  ${s.client?.nationalId ? row("المعرّف", esc(s.client.nationalId), true) : ""}
  ${row("مرجع الملف", esc(s.case.reference), true)}
  ${row("المحكمة", esc(s.case.court))}
  ${s.agreement.title ? row("موضوع الأتعاب", esc(s.agreement.title)) : ""}
  ${row("المبلغ المقبوض", `<span class="amount">${esc(formatAmount(s.payment.amount, s.payment.currency))}</span>`)}
  ${row("تاريخ الدفع", formatDate(s.payment.paidOn))}
  ${row("طريقة الدفع", `${esc(METHOD_LABELS[s.payment.method] ?? s.payment.method)}${s.payment.reference ? ` — <bdi dir="ltr">${esc(s.payment.reference)}</bdi>` : ""}`)}
  ${row("جملة الأتعاب المتفق عليها", esc(formatAmount(s.agreement.amount, s.payment.currency)))}
  ${row("المتبقي بعد هذه الدفعة", esc(formatAmount(s.agreement.remainingAfter, s.payment.currency)))}
  ${s.payment.notes ? row("ملاحظات", esc(s.payment.notes)) : ""}
</table>
${options.cancelled ? `<div class="cancel-note">ألغي هذا الوصل بتاريخ <bdi dir="ltr">${formatDate(options.cancelled.at.slice(0, 10))}</bdi> — السبب: ${esc(options.cancelled.reason)}. هذه نسخة للاطلاع ولا قيمة إبرائية لها.</div>` : ""}
<footer>
  <div class="sign">حرّره: ${esc(s.issuedBy.name)}</div>
  <div class="sign">الإمضاء والختم</div>
</footer>
</body></html>`;
}

let browserPromise: Promise<Browser> | undefined;

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const setting = env().PDF_BROWSER;
  if (setting === "bundled") return chromium.launch({ headless: true });
  if (setting === "chrome" || setting === "msedge") return chromium.launch({ headless: true, channel: setting });
  return chromium.launch({ headless: true, executablePath: setting });
}

async function browser(): Promise<Browser> {
  browserPromise ??= launch().catch((err) => {
    browserPromise = undefined;
    throw err;
  });
  const b = await browserPromise;
  if (!b.isConnected()) {
    browserPromise = undefined;
    return browser();
  }
  return b;
}

export const chromiumRenderer: PdfRenderer = async (snapshot, options) => {
  const b = await browser();
  const context = await b.newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(receiptHtml(snapshot, options), { waitUntil: "load", timeout: 15_000 });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await context.close();
  }
};

let renderer: PdfRenderer = chromiumRenderer;

/** Tests inject a renderer (e.g. one that fails) to exercise failure paths. */
export function setPdfRenderer(next: PdfRenderer | null) {
  renderer = next ?? chromiumRenderer;
}

export async function renderReceipt(snapshot: ReceiptSnapshot, options?: RenderOptions): Promise<{ pdf: Buffer; sha256: string }> {
  const pdf = await renderer(snapshot, options);
  if (!Buffer.isBuffer(pdf) || pdf.length < 100 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("renderer returned invalid PDF data");
  }
  return { pdf, sha256: createHash("sha256").update(pdf).digest("hex") };
}

export async function closePdfBrowser() {
  const pending = browserPromise;
  browserPromise = undefined;
  if (pending) await (await pending.catch(() => null))?.close().catch(() => undefined);
}
