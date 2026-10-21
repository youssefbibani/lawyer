import { useState } from "react";
import { Mic, History, Users, RotateCcw, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { applyFontSize, applyTheme } from "@/lib/theme";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { NotificationsCard, OfficeCard, ProfileCard } from "@/components/settings/AccountCards";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { MembersCard, ServerAuditCard } from "@/components/settings/AdminCards";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { clearConversations, getMember, getTeam, switchDemoUser, updatePolicy, updatePrefs } from "@/services/api";
import { resetDB } from "@/services/db";
import { can, ROLE_LABELS } from "@/services/permissions";
import { getRecognitionCtor } from "@/services/speech/stt";
import { speechSynthesisSupported } from "@/services/speech/use-speech-playback";
import { config } from "@/config";
import type { AssistantPrefs, UserSettings, VoiceProviderId } from "@/types";

/** Appearance preferences are per device (local); everything else on this page is stored on the server. */
const DEFAULT_SETTINGS: Pick<UserSettings, "fontSize" | "density" | "theme"> = { fontSize: "medium", density: "comfortable", theme: "light" };

export default function Settings() {
  const [settings, setSettings] = useLocalStorage<Pick<UserSettings, "fontSize" | "density" | "theme">>("qasr-al-adala:settings", DEFAULT_SETTINGS);
  const db = useDB();
  const user = useCurrentUser();
  const prefs = db.prefs;
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClearChats, setConfirmClearChats] = useState(false);
  const browserSpeech = !!getRecognitionCtor();

  function setPrefs(patch: Partial<AssistantPrefs>) {
    const result = updatePrefs(patch);
    if (!result.ok) toast.error(result.error);
  }

  function onThemeChange(theme: "light" | "dark") {
    setSettings((prev) => ({ ...prev, theme }));
    applyTheme(theme);
  }

  return (
    <AppShell title="الإعدادات" subtitle="إدارة الحساب والتفضيلات">
      <div className="space-y-6">
        <ProfileCard />
        <OfficeCard />

        <Card>
          <CardHeader>
            <CardTitle>المظهر والتفضيلات</CardTitle>
            <CardDescription>تُحفظ على هذا الجهاز فقط.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>اللغة</Label>
              <Select value="ar" disabled>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>حجم الخط</Label>
              <Select
                value={settings.fontSize}
                onValueChange={(v: UserSettings["fontSize"]) => {
                  setSettings((prev) => ({ ...prev, fontSize: v }));
                  applyFontSize(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">صغير</SelectItem>
                  <SelectItem value="medium">متوسط</SelectItem>
                  <SelectItem value="large">كبير</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>كثافة الواجهة</Label>
              <Select value={settings.density} onValueChange={(v: UserSettings["density"]) => setSettings((prev) => ({ ...prev, density: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comfortable">مريحة</SelectItem>
                  <SelectItem value="compact">مضغوطة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>المظهر</Label>
              <div className="flex gap-2">
                <Button type="button" variant={settings.theme === "light" ? "gold" : "outline"} className="flex-1" onClick={() => onThemeChange("light")}>
                  الوضع الفاتح
                </Button>
                <Button type="button" variant={settings.theme === "dark" ? "gold" : "outline"} className="flex-1" onClick={() => onThemeChange("dark")}>
                  الوضع الداكن
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <NotificationsCard />
        <SecurityCard />
        <MembersCard />
        <ServerAuditCard />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5 text-gold-deep" aria-hidden="true" />
              المساعد الذكي والصوت
            </CardTitle>
            <CardDescription>مزوّد الإملاء الصوتي، القراءة الصوتية، والاحتفاظ بالمحادثات</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label>مزوّد الإملاء الصوتي</Label>
              <Select value={prefs.voiceProvider} onValueChange={(v) => setPrefs({ voiceProvider: v as VoiceProviderId })}>
                <SelectTrigger aria-label="مزوّد الإملاء الصوتي">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">معطّل</SelectItem>
                  <SelectItem value="browser" disabled={!browserSpeech}>
                    التعرّف عبر المتصفح{browserSpeech ? "" : " (غير مدعوم في هذا المتصفح)"}
                  </SelectItem>
                  <SelectItem value="server" disabled={!config.speechApiUrl}>
                    خادم المكتب{config.speechApiUrl ? "" : " (غير مهيأ)"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {prefs.voiceProvider === "browser" && (
              <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-gold/30 bg-gold/10 p-3 text-sm">
                <Checkbox
                  checked={prefs.browserVoiceConsent}
                  onCheckedChange={(v) => setPrefs({ browserVoiceConsent: v === true })}
                  className="mt-1"
                  aria-label="الموافقة على المعالجة عبر خدمة المتصفح"
                />
                <span className="leading-6">
                  أوافق على أن يُرسل المتصفح الصوت إلى خدمة التعرّف على الكلام التابعة لمطوّره لتحويله إلى نص.
                  <span className="block text-xs text-muted-foreground">لا تُملِ معطيات سرّية للموكّلين عبر هذه الخدمة. لا يحتفظ التطبيق بأي تسجيل صوتي.</span>
                </span>
              </label>
            )}
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
              <Label htmlFor="tts" className="font-normal">
                القراءة الصوتية لردود المساعد
                {!speechSynthesisSupported() && <span className="block text-xs text-muted-foreground">غير مدعومة في هذا المتصفح</span>}
              </Label>
              <Switch id="tts" checked={prefs.speechPlayback} disabled={!speechSynthesisSupported()} onCheckedChange={(v) => setPrefs({ speechPlayback: v })} />
            </div>
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
              <span className="text-sm">الاحتفاظ بالمحادثات</span>
              <Select value={String(prefs.retentionDays)} onValueChange={(v) => setPrefs({ retentionDays: Number(v) as AssistantPrefs["retentionDays"] })}>
                <SelectTrigger className="w-full sm:w-56" aria-label="مدة الاحتفاظ بالمحادثات">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">لا تُحفظ بعد إغلاق النافذة</SelectItem>
                  <SelectItem value="7">7 أيام</SelectItem>
                  <SelectItem value="30">30 يوماً</SelectItem>
                  <SelectItem value="90">90 يوماً</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={() => setConfirmClearChats(true)} disabled={db.conversations.length === 0}>
              <Trash2 className="h-4 w-4" />
              حذف كل المحادثات ({db.conversations.length})
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-gold-deep" aria-hidden="true" />
              الدور والصلاحيات (الوحدات التجريبية)
            </CardTitle>
            <CardDescription>
              وضع تجريبي: تقمّص دور أحد أعضاء الفريق لاختبار قواعد الصلاحيات في المساعد والأرشفة وطلبات الموافقة، وهي وحدات ما زالت تعمل محلياً في هذا المتصفح. لا يغيّر ذلك صلاحياتك الفعلية على الخادم.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select
              value={user.id}
              onValueChange={(id) => {
                const r = switchDemoUser(id);
                if (r.ok) toast.success(`أنت الآن: ${r.data.name}`, { description: ROLE_LABELS[r.data.role] });
                else toast.error(r.error);
              }}
            >
              <SelectTrigger aria-label="المستخدم الحالي">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getTeam().map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} — {ROLE_LABELS[m.role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">يرى كل عضو الملفات المكلّف بها فقط. الصلاحيات المالية مقصورة على المحامي صاحب المكتب والمسؤول المالي.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-gold-deep" aria-hidden="true" />
              سياسة الموافقات
            </CardTitle>
            <CardDescription>كل عملية يقترحها المساعد أو يُعدّها موظف تمرّ بطلب موافقة بشرية قبل التنفيذ.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
              <Label htmlFor="clerk-policy" className="font-normal">
                مقترحات الكتبة تتطلب موافقة محامٍ
                <span className="block text-xs text-muted-foreground">عند التعطيل يمكن للكاتبة الموافقة على الجلسات والمهام والروابط فقط؛ العمليات المالية والأرشفة النهائية تبقى للمخوّلين.</span>
              </Label>
              <Switch
                id="clerk-policy"
                checked={db.policy.clerkRequiresLawyerApproval}
                disabled={!can(user, "policy:manage")}
                onCheckedChange={(v) => {
                  const r = updatePolicy({ clerkRequiresLawyerApproval: v });
                  if (!r.ok) toast.error(r.error);
                }}
              />
            </div>
          </CardContent>
        </Card>

        {can(user, "audit:read") && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-gold-deep" aria-hidden="true" />
                سجل عمليات الوحدات التجريبية
              </CardTitle>
              <CardDescription>عمليات المساعد والأرشفة وطلبات الموافقة المحفوظة محلياً، دون نسخ مضمون الملفات.</CardDescription>
            </CardHeader>
            <CardContent>
              {db.audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد عمليات مسجّلة بعد.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {db.audit.slice(0, 25).map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span className="min-w-0">
                        {a.summary}
                        {a.via === "assistant" && <span className="mr-2 rounded-sm bg-gold/15 px-1.5 text-[11px] text-gold-deep">عبر المساعد</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {getMember(a.actorId)?.shortName} • <span className="font-mono">{new Date(a.at).toLocaleString("en-GB")}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>البيانات التجريبية</CardTitle>
            <CardDescription>تخص الوحدات التجريبية المحلية فقط (المساعد، الأرشفة، طلبات الموافقة). لا تمسّ بيانات المكتب على الخادم.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => setConfirmReset(true)}>
              <RotateCcw className="h-4 w-4" />
              إعادة البيانات التجريبية
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="إعادة البيانات التجريبية"
        description="سيتم حذف ما أضيف محلياً في الوحدات التجريبية (المحادثات، الأرشفة، طلبات الموافقة) واستعادة البيانات الأصلية. لا تتأثر بيانات الخادم."
        confirmLabel="إعادة"
        tone="destructive"
        onConfirm={() => {
          resetDB();
          toast.success("تمت إعادة البيانات التجريبية");
        }}
      />
      <ConfirmDialog
        open={confirmClearChats}
        onOpenChange={setConfirmClearChats}
        title="حذف كل المحادثات"
        description="سيتم حذف كل محادثات المساعد نهائياً من هذا المتصفح."
        confirmLabel="حذف"
        tone="destructive"
        onConfirm={() => {
          const r = clearConversations();
          if (r.ok) toast.success("تم حذف المحادثات");
          else toast.error(r.error);
        }}
      />
    </AppShell>
  );
}
