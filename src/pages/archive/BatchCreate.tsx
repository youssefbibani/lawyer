import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { accessibleCases, getTeam } from "@/services/api";
import { createBatch, nextBatchReference } from "@/services/archive/service";

const NO_CASE = "__none__";

export default function BatchCreate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const db = useDB();
  const user = useCurrentUser();
  const [values, setValues] = useState({
    name: "",
    reference: nextBatchReference(db),
    location: "",
    responsibleId: user.id,
    notes: "",
    expectedCount: "",
    defaultCaseId: params.get("case") ?? "",
  });
  const [error, setError] = useState<string>();
  const set = (k: keyof typeof values, v: string) => setValues((s) => ({ ...s, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = createBatch({
      name: values.name,
      reference: values.reference,
      location: values.location,
      responsibleId: values.responsibleId,
      notes: values.notes || undefined,
      expectedCount: values.expectedCount ? Number(values.expectedCount) : undefined,
      defaultCaseId: values.defaultCaseId || undefined,
    });
    if (!r.ok) return setError(r.error);
    toast.success("حُفظت الدفعة كمسودة", { description: `${r.data.reference} — يمكنك متابعتها لاحقاً دون فقدان التقدم.` });
    navigate(`/app/archive/batches/${r.data.id}?step=upload`);
  }

  return (
    <AppShell title="إنشاء دفعة أرشفة" subtitle="الخطوة 1 من 7" backTo="/app/archive" actionBar>
      <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>بيانات الدفعة</CardTitle>
            <CardDescription>الدفعة تجمع وثائق علبة أو ملف ورقي واحد، وتسمح بمتابعة العمل على مراحل.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="b-name">اسم الدفعة</Label>
              <Input id="b-name" value={values.name} onChange={(e) => set("name", e.target.value)} placeholder="مثال: أرشيف قضايا الميراث 2018 — العلبة 7" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="b-ref">المرجع الفريد</Label>
                <Input id="b-ref" dir="ltr" className="text-left font-mono" value={values.reference} onChange={(e) => set("reference", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-count">عدد الوثائق المتوقع (اختياري)</Label>
                <Input id="b-count" type="number" inputMode="numeric" min={1} value={values.expectedCount} onChange={(e) => set("expectedCount", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-loc">مكان الحفظ المادي (العلبة / الملف / الرف)</Label>
              <Input id="b-loc" value={values.location} onChange={(e) => set("location", e.target.value)} placeholder="الخزانة ب — الرف 3 — العلبة 12" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>الموظف المسؤول</Label>
                <Select value={values.responsibleId} onValueChange={(v) => set("responsibleId", v)}>
                  <SelectTrigger aria-label="الموظف المسؤول">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getTeam().map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>قضية افتراضية للاقتراح (اختياري)</Label>
                <Select value={values.defaultCaseId || NO_CASE} onValueChange={(v) => set("defaultCaseId", v === NO_CASE ? "" : v)}>
                  <SelectTrigger aria-label="القضية الافتراضية">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CASE}>بدون</SelectItem>
                    {accessibleCases(db, user).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.client} — {c.ref}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-notes">ملاحظات (اختياري)</Label>
              <Textarea id="b-notes" rows={3} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
          <div className="mx-auto grid max-w-2xl grid-cols-1 gap-2 sm:flex">
            <Button type="submit" size="lg">
              <FolderPlus className="h-4 w-4" />
              حفظ الدفعة ومتابعة الرفع
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={() => navigate("/app/archive")}>
              إلغاء
            </Button>
          </div>
        </div>
      </form>
    </AppShell>
  );
}
