import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bell, Building2, FlaskConical, History, Mic, Moon, Palette, RotateCcw, ShieldCheck, Sparkles, Sun, Trash2, UserRound, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { applyAccent, applyFontSize, applyTheme, type Accent } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { NotificationsCard, OfficeCard, ProfileCard } from "@/components/settings/AccountCards";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { MembersCard, ServerAuditCard } from "@/components/settings/AdminCards";
import { useCan } from "@/backend/queries";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { clearConversations, getMember, getTeam, switchDemoUser, updatePolicy, updatePrefs } from "@/services/api";
import { resetDB } from "@/services/db";
import { can as canLocal, ROLE_LABELS } from "@/services/permissions";
import { getRecognitionCtor } from "@/services/speech/stt";
import { speechSynthesisSupported } from "@/services/speech/use-speech-playback";
import { config } from "@/config";
import type { AssistantPrefs, UserSettings, VoiceProviderId } from "@/types";

type SectionId = "account" | "appearance" | "notifications" | "office" | "team" | "audit" | "assistant" | "demo";

interface Section {
  id: SectionId;
  label: string;
  description: string;
  icon: LucideIcon;
}

const SECTIONS: Section[] = [
  { id: "account", label: "حسابي والأمان", description: "بياناتك داخل المكتب، كلمة المرور والمصادقة الثنائية والأجهزة المتصلة.", icon: UserRound },
  { id: "appearance", label: "المظهر", description: "الوضع الفاتح أو الداكن، لون التمييز وحجم الخط. تُحفظ على هذا الجهاز فقط.", icon: Palette },
  { id: "notifications", label: "الإشعارات", description: "التذكيرات التي يرسلها الخادم إليك.", icon: Bell },
  { id: "office", label: "المكتب", description: "بيانات المكتب التي تظهر على الوصولات، وسياسة الاطلاع على الملفات.", icon: Building2 },
  { id: "team", label: "الفريق", description: "أعضاء المكتب وأدوارهم.", icon: Users },
  { id: "audit", label: "سجل العمليات", description: "كل عملية على بيانات المكتب، دون إمكانية تعديل أو حذف.", icon: History },
  { id: "assistant", label: "المساعد الذكي", description: "الإملاء والقراءة الصوتية والاحتفاظ بالمحادثات.", icon: Sparkles },
  { id: "demo", label: "الوضع التجريبي", description: "أدوات الوحدات التي ما زالت تعمل محلياً في هذا المتصفح (المساعد، الأرشفة، الموافقات).", icon: FlaskConical },
];

export default function Settings() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const visible = SECTIONS.filter((s) => (s.id === "team" ? can("members:manage") : s.id === "audit" ? can("audit:read") : true));
  const requested = params.get("tab") as SectionId | null;
  const active = visible.find((s) => s.id === requested) ?? visible[0];

  function open(id: SectionId) {
    setParams(id === visible[0].id ? {} : { tab: id }, { replace: true });
    window.scrollTo({ top: 0 });
  }

  return (
    <AppShell title="الإعدادات" subtitle="إدارة الحساب والمكتب والتفضيلات">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Section menu: a column on the start side (right) on desktop, scrollable chips on phones. */}
        <nav aria-label="أقسام الإعدادات" className="-mx-4 overflow-x-auto px-4 scrollbar-none lg:sticky lg:top-20 lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="flex w-max gap-1.5 lg:w-auto lg:flex-col">
            {visible.map((s) => {
              const selected = s.id === active.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => open(s.id)}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-[var(--radius)] border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11 lg:border-transparent",
                      selected ? "border-gold bg-gold/15 font-semibold text-foreground lg:border-gold/40" : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <s.icon className={cn("h-4 w-4 shrink-0", selected ? "text-gold-deep" : "")} aria-hidden="true" />
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-labelledby="settings-section-title" className="min-w-0 space-y-5">
          <header className="space-y-1">
            <h2 id="settings-section-title" className="flex items-center gap-2 font-heading text-2xl">
              <active.icon className="h-5 w-5 text-gold-deep" aria-hidden="true" />
              {active.label}
            </h2>
            <p className="text-sm text-muted-foreground">{active.description}</p>
          </header>

          {active.id === "account" && (
            <>
              <ProfileCard />
              <SecurityCard />
            </>
          )}
          {active.id === "appearance" && <AppearanceSection />}
          {active.id === "notifications" && <NotificationsCard />}
          {active.id === "office" && <OfficeCard />}
          {active.id === "team" && <MembersCard />}
          {active.id === "audit" && <ServerAuditCard />}
          {active.id === "assistant" && <AssistantSection />}
          {active.id === "demo" && <DemoSection />}
        </section>
      </div>
    </AppShell>
  );
}

// ——— المظهر ———

type Appearance = Pick<UserSettings, "fontSize" | "theme"> & { accent?: Accent };
const DEFAULT_APPEARANCE: Appearance = { fontSize: "medium", theme: "light", accent: "gold" };

const ACCENTS: { value: Accent; label: string; hint: string; swatch: string }[] = [
  { value: "gold", label: "ذهبي", hint: "اللون الأصلي للمنصة", swatch: "hsl(43 53% 54%)" },
  { value: "red", label: "أحمر", hint: "لون المحاماة في تونس", swatch: "hsl(355 65% 58%)" },
];

const FONT_SIZES: { value: UserSettings["fontSize"]; label: string; sample: string }[] = [
  { value: "small", label: "صغير", sample: "text-sm" },
  { value: "medium", label: "متوسط", sample: "text-base" },
  { value: "large", label: "كبير", sample: "text-lg" },
];

function AppearanceSection() {
  const [settings, setSettings] = useLocalStorage<Appearance>("qasr-al-adala:settings", DEFAULT_APPEARANCE);
  const theme = settings.theme === "dark" ? "dark" : "light";
  const accent = settings.accent ?? "gold";
  const fontSize = settings.fontSize ?? "medium";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>الوضع</CardTitle>
          <CardDescription>اختر ما يريح عينيك: الوضع الداكن مناسب للعمل ليلاً.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label="الوضع" className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            {(
              [
                { value: "light", label: "فاتح", icon: Sun, bg: "#FAFAF7", panel: "#FFFFFF", bar: "#1E1E36", line: "#E3DDD2" },
                { value: "dark", label: "داكن", icon: Moon, bg: "#121220", panel: "#1A1A2C", bar: "#0B0B16", line: "#2C2C44" },
              ] as const
            ).map((o) => {
              const selected = theme === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setSettings((prev) => ({ ...prev, theme: o.value }));
                    applyTheme(o.value);
                  }}
                  className={cn(
                    "space-y-2 rounded-[var(--radius)] border-2 p-2 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-gold" : "border-border hover:border-gold/50",
                  )}
                >
                  {/* Miniature of the app in this mode (sidebar on the right). */}
                  <div className="flex h-24 overflow-hidden rounded-sm border" style={{ backgroundColor: o.bg, borderColor: o.line }} aria-hidden="true">
                    <div className="w-1/4" style={{ backgroundColor: o.bar }} />
                    <div className="flex-1 space-y-1.5 p-2">
                      <div className="h-2 w-1/2 rounded-full" style={{ backgroundColor: o.line }} />
                      <div className="flex gap-1.5">
                        <div className="h-9 flex-1 rounded-sm border" style={{ backgroundColor: o.panel, borderColor: o.line }} />
                        <div className="h-9 flex-1 rounded-sm border" style={{ backgroundColor: o.panel, borderColor: o.line }} />
                      </div>
                      <div className="h-2 w-1/3 rounded-full bg-gold" />
                    </div>
                  </div>
                  <span className="flex items-center gap-2 px-1 text-sm font-medium">
                    <o.icon className="h-4 w-4" aria-hidden="true" />
                    {o.label}
                    {selected && <span className="mr-auto text-xs text-gold-deep">مُفعّل</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>لون التمييز</CardTitle>
          <CardDescription>لون الأزرار الرئيسية والعناصر المختارة.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label="لون التمييز" className="flex flex-wrap gap-3">
            {ACCENTS.map((o) => {
              const selected = accent === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setSettings((prev) => ({ ...prev, accent: o.value }));
                    applyAccent(o.value);
                  }}
                  className={cn(
                    "flex min-w-[10rem] flex-1 items-center gap-3 rounded-[var(--radius)] border-2 p-3 text-right sm:max-w-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-gold bg-gold/10" : "border-border hover:border-gold/50",
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-card" style={{ backgroundColor: o.swatch, ["--tw-ring-color" as string]: selected ? o.swatch : "transparent" }} aria-hidden="true" />
                  <span>
                    <span className="block text-sm font-medium">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>حجم الخط</CardTitle>
          <CardDescription>يكبّر أو يصغّر كل نصوص الواجهة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div role="radiogroup" aria-label="حجم الخط" className="flex h-11 w-full max-w-md rounded-[var(--radius)] border border-border bg-secondary/60 p-0.5">
            {FONT_SIZES.map((o) => {
              const selected = fontSize === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setSettings((prev) => ({ ...prev, fontSize: o.value }));
                    applyFontSize(o.value);
                  }}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-2px)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className={o.sample} aria-hidden="true">
                    أ
                  </span>
                  <span className="text-sm">{o.label}</span>
                </button>
              );
            })}
          </div>
          <div className="rounded-[var(--radius)] border border-dashed border-border bg-secondary/30 p-4" aria-label="معاينة">
            <p className="text-xs text-muted-foreground">معاينة</p>
            <p className="font-heading text-lg">جلسة مرافعة — الإثنين</p>
            <p className="text-sm text-muted-foreground">المنوب: عائلة بن صالح • المحكمة الابتدائية بتونس</p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ——— المساعد الذكي ———

function AssistantSection() {
  const db = useDB();
  const prefs = db.prefs;
  const [confirmClearChats, setConfirmClearChats] = useState(false);
  const browserSpeech = !!getRecognitionCtor();

  function setPrefs(patch: Partial<AssistantPrefs>) {
    const result = updatePrefs(patch);
    if (!result.ok) toast.error(result.error);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-gold-deep" aria-hidden="true" />
            الصوت
          </CardTitle>
          <CardDescription>الإملاء الصوتي لأسئلتك، والقراءة الصوتية للردود.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>مزوّد الإملاء الصوتي</Label>
            <Select value={prefs.voiceProvider} onValueChange={(v) => setPrefs({ voiceProvider: v as VoiceProviderId })}>
              <SelectTrigger aria-label="مزوّد الإملاء الصوتي" className="sm:max-w-sm">
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
          <SettingRow id="tts" label="القراءة الصوتية لردود المساعد" hint={speechSynthesisSupported() ? undefined : "غير مدعومة في هذا المتصفح"}>
            <Switch id="tts" checked={prefs.speechPlayback} disabled={!speechSynthesisSupported()} onCheckedChange={(v) => setPrefs({ speechPlayback: v })} />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>المحادثات</CardTitle>
          <CardDescription>تُحفظ محادثات المساعد في هذا المتصفح فقط.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow label="مدة الاحتفاظ بالمحادثات">
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
          </SettingRow>
          <DangerRow
            label="حذف كل المحادثات"
            hint={db.conversations.length ? `${db.conversations.length} محادثة محفوظة حالياً.` : "لا توجد محادثات محفوظة."}
            action={
              <Button type="button" variant="outline" className="text-alert hover:text-alert" onClick={() => setConfirmClearChats(true)} disabled={db.conversations.length === 0}>
                <Trash2 className="h-4 w-4" />
                حذف
              </Button>
            }
          />
        </CardContent>
      </Card>

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
    </>
  );
}

// ——— الوضع التجريبي ———

function DemoSection() {
  const db = useDB();
  const user = useCurrentUser();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      <p className="flex items-start gap-2 rounded-[var(--radius)] border border-gold/40 bg-gold/10 p-3 text-sm leading-6">
        <FlaskConical className="mt-1 h-4 w-4 shrink-0 text-gold-deep" aria-hidden="true" />
        ما في هذا القسم يخص الوحدات التجريبية فقط ولا يمسّ بيانات المكتب أو صلاحياتك الفعلية على الخادم.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-gold-deep" aria-hidden="true" />
            تقمّص دور عضو
          </CardTitle>
          <CardDescription>لاختبار قواعد الصلاحيات في المساعد والأرشفة والموافقات.</CardDescription>
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
            <SelectTrigger aria-label="المستخدم الحالي" className="sm:max-w-sm">
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
          <CardDescription>كل عملية يقترحها المساعد أو يُعدّها موظف تمرّ بموافقة بشرية قبل التنفيذ.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            id="clerk-policy"
            label="مقترحات الكتبة تتطلب موافقة محامٍ"
            hint="عند التعطيل يمكن للكاتبة الموافقة على الجلسات والمهام والروابط فقط؛ العمليات المالية والأرشفة النهائية تبقى للمخوّلين."
          >
            <Switch
              id="clerk-policy"
              checked={db.policy.clerkRequiresLawyerApproval}
              disabled={!canLocal(user, "policy:manage")}
              onCheckedChange={(v) => {
                const r = updatePolicy({ clerkRequiresLawyerApproval: v });
                if (!r.ok) toast.error(r.error);
              }}
            />
          </SettingRow>
        </CardContent>
      </Card>

      {canLocal(user, "audit:read") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-gold-deep" aria-hidden="true" />
              سجل عمليات الوحدات التجريبية
            </CardTitle>
            <CardDescription>آخر 25 عملية محفوظة محلياً، دون نسخ مضمون الملفات.</CardDescription>
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

      <Card className="border-alert/30">
        <CardHeader>
          <CardTitle className="text-alert">منطقة الحذر</CardTitle>
        </CardHeader>
        <CardContent>
          <DangerRow
            label="إعادة البيانات التجريبية"
            hint="يحذف ما أضيف محلياً (المحادثات، الأرشفة، طلبات الموافقة) ويستعيد البيانات الأصلية."
            action={
              <Button type="button" variant="outline" className="text-alert hover:text-alert" onClick={() => setConfirmReset(true)}>
                <RotateCcw className="h-4 w-4" />
                إعادة
              </Button>
            }
          />
        </CardContent>
      </Card>

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
    </>
  );
}

// ——— Shared rows ———

function SettingRow({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
      <Label htmlFor={id} className="min-w-0 flex-1 font-normal leading-6">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

function DangerRow({ label, hint, action }: { label: string; hint: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}
