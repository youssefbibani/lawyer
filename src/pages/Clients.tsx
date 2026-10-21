import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search as SearchIcon, Users } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CaseReference } from "@/components/shared/CaseReference";
import { SkeletonCards } from "@/components/shared/LoadingSkeleton";
import { NewCaseDialog } from "@/components/cases/NewCaseDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api, isApiError } from "@/backend/http";
import { useApiMutation, useCan, useClient, useClients } from "@/backend/queries";
import { CASE_STATUS_LABELS, CLIENT_TYPE_LABELS, caseStatusToneOf } from "@/backend/labels";
import { CLIENT_TYPES, type ClientDTO, type ClientType } from "../../shared/api";

const PAGE_SIZE = 20;

interface Form {
  type: ClientType;
  fullName: string;
  phone: string;
  email: string;
  address: string;
  nationalId: string;
  notes: string;
}

const EMPTY: Form = { type: "INDIVIDUAL", fullName: "", phone: "", email: "", address: "", nationalId: "", notes: "" };

export default function Clients() {
  const can = useCan();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ClientDTO | "new" | null>(null);
  const [openId, setOpenId] = useState<string>();
  const [newCaseFor, setNewCaseFor] = useState<string>();

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [q, archived]);

  const clients = useClients({ q, archived: archived ? "true" : undefined, page, pageSize: PAGE_SIZE });
  const list = clients.data?.items ?? [];
  const pages = Math.max(1, Math.ceil((clients.data?.total ?? 0) / PAGE_SIZE));

  return (
    <AppShell title="الحرفاء" subtitle="بطاقات الحرفاء والملفات المرتبطة بهم">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم، الهاتف، البريد أو المعرّف..." aria-label="بحث في الحرفاء" className="pr-9" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" aria-pressed={archived} onClick={() => setArchived((a) => !a)}>
              <Archive className="h-4 w-4" />
              {archived ? "الحرفاء النشطون" : "المؤرشفون"}
            </Button>
            {can("client:write") && (
              <Button onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" />
                حريف جديد
              </Button>
            )}
          </div>
        </div>

        {clients.isPending ? (
          <SkeletonCards count={3} />
        ) : clients.error ? (
          <div role="alert" className="card-elevated space-y-3 p-6 text-center">
            <p className="text-sm text-alert">{clients.error.message}</p>
            <Button variant="outline" onClick={() => void clients.refetch()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={Users} title="لا توجد نتائج" description={q ? "لم يتم العثور على أي حريف مطابق." : archived ? "لا يوجد حرفاء مؤرشفون." : "لم يُسجَّل أي حريف بعد."} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="قائمة الحرفاء">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className={cn("card-elevated flex w-full items-start gap-3 p-4 text-right transition-colors hover:border-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", c.archivedAt && "opacity-70")}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">{c.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {CLIENT_TYPE_LABELS[c.type]} • {c.caseCount} ملفات
                    </p>
                    {(c.phone || c.email) && (
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {[c.phone, c.email].filter(Boolean).join(" • ")}
                      </p>
                    )}
                  </div>
                  <ChevronLeft className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav className="flex items-center justify-center gap-3" aria-label="صفحات النتائج">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronRight className="h-4 w-4" />
              السابق
            </Button>
            <span className="text-xs text-muted-foreground">
              صفحة {page} من {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </nav>
        )}
      </div>

      <ClientFormDialog client={editing} onClose={() => setEditing(null)} />
      <ClientDetailDialog
        id={openId}
        onClose={() => setOpenId(undefined)}
        onEdit={(c) => (setOpenId(undefined), setEditing(c))}
        onNewCase={(id) => (setOpenId(undefined), setNewCaseFor(id))}
        onOpenCase={(id) => navigate(`/app/cases/${id}`)}
      />
      <NewCaseDialog open={!!newCaseFor} onOpenChange={(o) => !o && setNewCaseFor(undefined)} defaultClientId={newCaseFor} />
    </AppShell>
  );
}

function ClientFormDialog({ client, onClose }: { client: ClientDTO | "new" | null; onClose: () => void }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string>();
  const existing = client && client !== "new" ? client : null;

  useEffect(() => {
    if (!client) return;
    setError(undefined);
    setForm(
      existing
        ? { type: existing.type, fullName: existing.fullName, phone: existing.phone ?? "", email: existing.email ?? "", address: existing.address ?? "", nationalId: existing.nationalId ?? "", notes: existing.notes ?? "" }
        : EMPTY,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const save = useApiMutation(
    (body: Record<string, unknown>) => (existing ? api.patch<ClientDTO>(`/clients/${existing.id}`, { ...body, version: existing.version }) : api.post<ClientDTO>("/clients", body)),
    ["clients"],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return setError("يرجى إدخال اسم الحريف");
    save.mutate(
      { type: form.type, fullName: form.fullName.trim(), phone: form.phone, email: form.email, address: form.address, nationalId: form.nationalId, notes: form.notes },
      {
        onSuccess: () => (toast.success(existing ? "تم تحديث بطاقة الحريف" : "تم تسجيل الحريف"), onClose()),
        onError: (err) => setError(isApiError(err) && err.details[0] ? err.details.map((d) => d.message).join(" — ") : err.message),
      },
    );
  }

  const field = (key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`client-${key}`}>{label}</Label>
      <Input id={`client-${key}`} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...props} />
    </div>
  );

  return (
    <Dialog open={!!client} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "تعديل بطاقة الحريف" : "حريف جديد"}</DialogTitle>
          <DialogDescription>البيانات الشخصية للحريف سرّية ولا يطّلع عليها إلا المخوّلون في المكتب.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">{field("fullName", "الاسم الكامل")}</div>
            <div className="space-y-1.5">
              <Label>الصفة</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as ClientType }))}>
                <SelectTrigger aria-label="صفة الحريف">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CLIENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("phone", "الهاتف", { dir: "ltr", className: "text-left", inputMode: "tel" })}
            {field("email", "البريد الإلكتروني", { dir: "ltr", className: "text-left", type: "email" })}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("nationalId", "المعرّف (ب.ت.و / جواز / معرف جبائي)", { dir: "ltr", className: "text-left" })}
            {field("address", "العنوان")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-notes">ملاحظات</Label>
            <Textarea id="client-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              حفظ
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClientDetailDialog({
  id,
  onClose,
  onEdit,
  onNewCase,
  onOpenCase,
}: {
  id?: string;
  onClose: () => void;
  onEdit: (c: ClientDTO) => void;
  onNewCase: (clientId: string) => void;
  onOpenCase: (caseId: string) => void;
}) {
  const can = useCan();
  const detail = useClient(id);
  const c = detail.data;
  const archive = useApiMutation(() => api.post<ClientDTO>(`/clients/${c!.id}/${c!.archivedAt ? "unarchive" : "archive"}`, { version: c!.version }), ["clients"]);

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{c?.fullName ?? "بطاقة حريف"}</DialogTitle>
          <DialogDescription>{c ? CLIENT_TYPE_LABELS[c.type] : "جارٍ التحميل..."}</DialogDescription>
        </DialogHeader>
        {detail.isPending ? (
          <SkeletonCards count={1} />
        ) : detail.error ? (
          <p className="text-sm text-alert">{detail.error.message}</p>
        ) : c ? (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ["الهاتف", c.phone],
                ["البريد", c.email],
                ["المعرّف", c.nationalId],
                ["العنوان", c.address],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd dir={label === "العنوان" ? undefined : "ltr"} className="text-right">
                    {value || "—"}
                  </dd>
                </div>
              ))}
            </dl>
            {c.notes && <p className="whitespace-pre-line rounded-sm bg-muted/50 p-2 text-xs">{c.notes}</p>}
            <div>
              <p className="mb-2 font-medium">الملفات</p>
              {c.cases.length === 0 ? (
                <p className="text-xs text-muted-foreground">لا توجد ملفات متاحة لك لهذا الحريف.</p>
              ) : (
                <ul className="space-y-2">
                  {c.cases.map((x) => (
                    <li key={x.id}>
                      <button type="button" onClick={() => onOpenCase(x.id)} className="flex w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-border p-2 text-right hover:border-gold/50">
                        <CaseReference value={x.reference} />
                        <StatusBadge label={CASE_STATUS_LABELS[x.status]} tone={caseStatusToneOf(x.status)} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <DialogFooter className="flex-wrap gap-2">
              {can("case:create") && !c.archivedAt && (
                <Button onClick={() => onNewCase(c.id)}>
                  <Plus className="h-4 w-4" />
                  ملف جديد لهذا الحريف
                </Button>
              )}
              {can("client:write") && (
                <>
                  <Button variant="outline" onClick={() => onEdit(c)}>
                    <Pencil className="h-4 w-4" />
                    تعديل
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate(undefined, { onSuccess: () => (toast.success(c.archivedAt ? "أُعيد تفعيل الحريف" : "تمت أرشفة الحريف"), onClose()), onError: (err) => toast.error(err.message) })}
                  >
                    {c.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    {c.archivedAt ? "إلغاء الأرشفة" : "أرشفة"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
