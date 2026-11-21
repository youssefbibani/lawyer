import { useEffect, useState } from "react";
import { Building2, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, isApiError } from "@/backend/http";
import { useApiMutation, useCan, useMe, useSettings } from "@/backend/queries";
import type { NotificationPreferenceDTO, OfficeSettingsDTO, ProfileDTO } from "../../../shared/api";

/** Save / undo bar: active only when the form differs from what is saved. */
function SaveBar({ dirty, pending, label, onUndo }: { dirty: boolean; pending: boolean; label: string; onUndo: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="gold" disabled={!dirty || pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </Button>
      {dirty && !pending && (
        <>
          <Button type="button" variant="ghost" onClick={onUndo}>
            <Undo2 className="h-4 w-4" />
            تراجع
          </Button>
          <span role="status" className="flex items-center gap-1.5 text-xs text-gold-deep">
            <span className="h-1.5 w-1.5 rounded-full bg-gold-deep" aria-hidden="true" />
            تغييرات غير محفوظة
          </span>
        </>
      )}
    </div>
  );
}

const errorText = (err: unknown) => (isApiError(err) && err.details.length ? err.details.map((d) => d.message).join(" — ") : (err as Error).message);

export function ProfileCard() {
  const settings = useSettings();
  const [form, setForm] = useState({ name: "", phone: "", barNumber: "" });
  const profile = settings.data?.profile;
  const saved = profile ? { name: profile.name, phone: profile.phone ?? "", barNumber: profile.barNumber ?? "" } : form;
  const dirty = !!profile && (form.name !== saved.name || form.phone !== saved.phone || form.barNumber !== saved.barNumber);
  useEffect(() => {
    if (profile) setForm({ name: profile.name, phone: profile.phone ?? "", barNumber: profile.barNumber ?? "" });
  }, [profile]);
  const save = useApiMutation((body: typeof form) => api.patch<ProfileDTO>("/settings/profile", body), ["settings"]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>الملف الشخصي</CardTitle>
        <CardDescription>بياناتك داخل المكتب</CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isPending ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        ) : settings.error ? (
          <p className="text-sm text-alert">{settings.error.message}</p>
        ) : (
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.name.trim()) return toast.error("يرجى إدخال الاسم الكامل");
              save.mutate(form, { onSuccess: () => toast.success("تم حفظ الملف الشخصي"), onError: (err) => toast.error(errorText(err)) });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="fullName">الاسم الكامل</Label>
              <Input id="fullName" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="barNumber">رقم الانخراط بالهيئة</Label>
              <Input id="barNumber" dir="ltr" value={form.barNumber} onChange={(e) => setForm((f) => ({ ...f, barNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input id="email" dir="ltr" className="text-left" value={profile?.email ?? ""} readOnly aria-describedby="email-hint" />
              <p id="email-hint" className="text-[11px] text-muted-foreground">
                يغيّره مدير المكتب فقط.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">رقم الهاتف</Label>
              <Input id="phone" dir="ltr" className="text-left" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <SaveBar dirty={dirty} pending={save.isPending} label="حفظ الملف الشخصي" onUndo={() => setForm(saved)} />
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

type OfficeForm = Omit<OfficeSettingsDTO, "lawyersSeeAllCases" | "clerksSeeAllCases" | "clerksCanRecordPayments"> & {
  lawyersSeeAllCases: boolean;
  clerksSeeAllCases: boolean;
  clerksCanRecordPayments: boolean;
};

export function OfficeCard() {
  const can = useCan();
  const settings = useSettings();
  const editable = can("settings:office");
  const [form, setForm] = useState<OfficeForm | null>(null);
  useEffect(() => {
    if (settings.data) setForm({ ...settings.data.office });
  }, [settings.data]);
  const save = useApiMutation((body: OfficeForm) => api.patch<OfficeSettingsDTO>("/settings/office", body), ["settings"]);

  if (!form || !settings.data) return null;
  const savedOffice = settings.data.office as OfficeForm;
  const dirty = (Object.keys(form) as (keyof OfficeForm)[]).some((k) => (form[k] ?? "") !== (savedOffice[k] ?? ""));
  const text = (key: keyof OfficeForm, label: string, ltr = false) => (
    <div className="space-y-1.5">
      <Label htmlFor={`office-${key}`}>{label}</Label>
      <Input
        id={`office-${key}`}
        dir={ltr ? "ltr" : undefined}
        className={ltr ? "text-left" : undefined}
        value={(form[key] as string | null) ?? ""}
        readOnly={!editable}
        onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
      />
    </div>
  );
  const policy = (key: "lawyersSeeAllCases" | "clerksSeeAllCases" | "clerksCanRecordPayments", label: string, hint: string) => (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <Label htmlFor={`office-${key}`} className="font-normal">
        {label}
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </Label>
      <Switch id={`office-${key}`} checked={form[key]} disabled={!editable} onCheckedChange={(v) => setForm((f) => (f ? { ...f, [key]: v } : f))} />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-gold-deep" aria-hidden="true" />
          بيانات المكتب
        </CardTitle>
        <CardDescription>{editable ? "تظهر هذه البيانات على وصولات الأتعاب." : "يعدّلها مدير المكتب فقط."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form, { onSuccess: () => toast.success("تم حفظ إعدادات المكتب"), onError: (err) => toast.error(errorText(err)) });
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {text("legalName", "اسم المكتب")}
            {text("address", "العنوان")}
            {text("city", "المدينة")}
            {text("phone", "الهاتف", true)}
            {text("email", "البريد الإلكتروني", true)}
            {text("taxId", "المعرف الجبائي", true)}
            {text("barRegistration", "الترسيم بالهيئة", true)}
            {text("defaultCurrency", "العملة الافتراضية", true)}
            {text("timeZone", "المنطقة الزمنية", true)}
          </div>
          <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
            <p className="text-sm font-medium">سياسة الاطلاع على الملفات</p>
            {!editable && <p className="text-xs text-muted-foreground">يغيّرها مدير المكتب فقط.</p>}
            {policy("lawyersSeeAllCases", "المحامون يرون كل ملفات المكتب", "عند التعطيل يرى المحامي الملفات المكلّف بها أو المضاف إلى فريقها فقط.")}
            {policy("clerksSeeAllCases", "الكتبة يرون كل ملفات المكتب", "عند التعطيل ترى الكاتبة الملفات المضافة إلى فريقها فقط.")}
          </div>
          {editable && <SaveBar dirty={dirty} pending={save.isPending} label="حفظ إعدادات المكتب" onUndo={() => setForm({ ...savedOffice })} />}
        </form>
      </CardContent>
    </Card>
  );
}

export function NotificationsCard() {
  const settings = useSettings();
  const { data: me } = useMe();
  const save = useApiMutation((patch: Partial<NotificationPreferenceDTO>) => api.patch<NotificationPreferenceDTO>("/settings/preferences", patch), ["settings"]);
  const prefs = settings.data?.preferences;
  const mailConfigured = !!me?.mail.configured;

  const toggle = (key: keyof NotificationPreferenceDTO, value: boolean) =>
    save.mutate({ [key]: value }, { onSuccess: () => toast.success("تم حفظ تفضيلات الإشعارات"), onError: (err) => toast.error(errorText(err)) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>الإشعارات</CardTitle>
        <CardDescription>تُطبّق على التذكيرات التي يرسلها الخادم إليك.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!prefs ? (
          <p className="text-sm text-muted-foreground">{settings.error ? settings.error.message : "جارٍ التحميل..."}</p>
        ) : (
          <>
            {(
              [
                ["hearingReminders", "تذكيرات الجلسات", undefined],
                ["taskReminders", "تذكيرات المهام", undefined],
                ["emailEnabled", "إشعارات البريد الإلكتروني", mailConfigured ? undefined : "غير متاح: خدمة البريد غير مهيأة على الخادم"],
              ] as [keyof NotificationPreferenceDTO, string, string | undefined][]
            ).map(([key, label, hint]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <Label htmlFor={key} className="font-normal">
                  {label}
                  {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
                </Label>
                <Switch id={key} checked={Boolean(prefs[key]) && (key !== "emailEnabled" || mailConfigured)} disabled={save.isPending || (key === "emailEnabled" && !mailConfigured)} onCheckedChange={(v) => toggle(key, v)} />
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
