import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Replace, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageThumb } from "@/components/archive/ArchiveBits";
import { editPages, findItem } from "@/services/archive/service";
import { reprocess } from "@/services/archive/pipeline";
import { getBlobStore } from "@/services/archive/blobStore";
import { validateFile } from "@/services/archive/workflow";
import type { ArchiveItem } from "@/types";

/** Reorder, rotate or replace pages. Replaced scans are kept (never deleted). */
export function PageEditor({ item, open, onOpenChange }: { item: ArchiveItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const replaceTarget = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pages = [...item.pages].sort((a, b) => a.index - b.index);
  const editable = ["review", "needs_correction", "failed"].includes(item.state);

  function apply(op: Parameters<typeof editPages>[2]) {
    const current = findItem(item.id);
    if (!current) return;
    const r = editPages(item.id, current.version, op);
    if (!r.ok) return toast.error(r.error);
    if (op.type !== "move") {
      reprocess(item.id);
      toast.info("سيُعاد استخراج نص الصفحة المعدّلة");
    }
  }

  async function replace(file: File) {
    const pageId = replaceTarget.current;
    if (!pageId) return;
    const err = validateFile(file);
    if (err || file.type === "application/pdf") return toast.error(err ?? "الاستبدال يقبل الصور فقط.");
    setBusy(pageId);
    try {
      const { rasterize } = await import("@/services/archive/imaging");
      const [raster] = await rasterize(file, file.type);
      const stamp = Date.now().toString(36);
      const key = `orig:${item.id}:replace-${pageId}-${stamp}`;
      const thumbKey = `thumb:${pageId}-${stamp}`;
      await getBlobStore().put(key, file);
      await getBlobStore().put(thumbKey, raster.thumb);
      apply({ type: "replace", pageId, originalKey: key, thumbKey, width: raster.width, height: raster.height, quality: raster.quality });
    } catch {
      toast.error("تعذّر قراءة الصورة البديلة.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>تعديل الصفحات</DialogTitle>
          <DialogDescription>{item.fileName} — إعادة الترتيب أو التدوير أو استبدال صفحة. الصور الأصلية القديمة تبقى محفوظة.</DialogDescription>
        </DialogHeader>
        {!editable && <p className="text-sm text-muted-foreground">تعديل الصفحات متاح بعد انتهاء المعالجة الأولية وقبل الاعتماد.</p>}
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {pages.map((p, i) => (
            <li key={p.id} className="space-y-2 rounded-[var(--radius)] border border-border p-2">
              <PageThumb thumbKey={p.thumbKey} rotation={p.rotation} label={`الصفحة ${i + 1}`} />
              <p className="text-center text-xs">
                الصفحة {i + 1}
                {p.quality.blank && <span className="block text-alert">تبدو فارغة</span>}
                {p.quality.blurry && <span className="block text-alert">قد تكون ضبابية</span>}
                {p.replacedKeys?.length ? <span className="block text-muted-foreground">استُبدلت ({p.replacedKeys.length})</span> : null}
              </p>
              {editable && (
                <div className="grid grid-cols-2 gap-1">
                  <Button size="icon" variant="ghost" aria-label={`نقل الصفحة ${i + 1} إلى الأمام`} disabled={i === 0} onClick={() => apply({ type: "move", pageId: p.id, delta: -1 })}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`نقل الصفحة ${i + 1} إلى الخلف`} disabled={i === pages.length - 1} onClick={() => apply({ type: "move", pageId: p.id, delta: 1 })}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`تدوير الصفحة ${i + 1}`} onClick={() => apply({ type: "rotate", pageId: p.id })}>
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`استبدال الصفحة ${i + 1}`}
                    disabled={busy === p.id}
                    onClick={() => {
                      replaceTarget.current = p.id;
                      input.current?.click();
                    }}
                  >
                    {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Replace className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void replace(f);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
