import { AlertTriangle, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { api } from "@/backend/http";
import { useApiMutation, useCan } from "@/backend/queries";
import { formatMoney } from "@/backend/format";
import { formatArabicDate } from "@/lib/formatters";
import type { ReceiptDTO } from "../../../shared/api";

/** An issued receipt and the true state of its PDF (generated, failed, or cancelled copy). */
export function ReceiptPanel({ receipt, onChange }: { receipt: ReceiptDTO; onChange?: (r: ReceiptDTO) => void }) {
  const can = useCan();
  const retry = useApiMutation(() => api.post<ReceiptDTO>(`/receipts/${receipt.id}/pdf`), ["finance"]);
  const href = `/api/v1/receipts/${receipt.id}/pdf`;
  const cancelled = receipt.status === "CANCELLED";

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius)] border border-border bg-white p-5 font-legal text-ink">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            وصل عدد:{" "}
            <span className="font-mono" dir="ltr">
              {receipt.number}
            </span>
          </span>
          <span className="font-mono">{formatArabicDate(receipt.issuedOn)}</span>
        </div>
        <Separator className="mb-3" />
        <div className="space-y-1.5 text-sm">
          <p>
            الحريف: <span className="font-medium">{receipt.clientName ?? "—"}</span>
          </p>
          <p>
            القضية:{" "}
            <span className="font-mono" dir="ltr">
              {receipt.caseReference}
            </span>
          </p>
          <p>
            المبلغ المستلم: <span className="font-mono font-semibold">{formatMoney(receipt.amount, receipt.currency)}</span>
          </p>
        </div>
        {cancelled && (
          <div className="mt-3">
            <StatusBadge label="وصل ملغى" tone="alert" />
            {receipt.cancelReason && <p className="mt-1 text-xs text-alert">{receipt.cancelReason}</p>}
          </div>
        )}
      </div>

      {receipt.pdf.available || cancelled ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={href} target="_blank" rel="noopener">
              <ExternalLink className="h-4 w-4" />
              {cancelled ? "عرض نسخة الوصل الملغى (PDF)" : "عرض الوصل (PDF)"}
            </a>
          </Button>
          {!cancelled && (
            <Button variant="outline" asChild>
              <a href={`${href}?download=1`} download={`${receipt.number}.pdf`}>
                <Download className="h-4 w-4" />
                تنزيل
              </a>
            </Button>
          )}
        </div>
      ) : (
        <div role="alert" className="space-y-2 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-3 text-sm text-alert">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            الوصل مسجّل برقمه، لكن ملف PDF لم يُولَّد.
          </p>
          {receipt.pdf.error && <p className="text-xs">السبب التقني: {receipt.pdf.error}</p>}
          {can("payment:record") && (
            <Button
              size="sm"
              variant="outline"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(undefined, {
                  onSuccess: (r) => {
                    onChange?.(r);
                    if (r.pdf.available) toast.success("تم توليد ملف PDF للوصل");
                    else toast.error("ما زال توليد ملف PDF متعذراً", { description: r.pdf.error ?? undefined });
                  },
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              {retry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              إعادة محاولة التوليد
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
