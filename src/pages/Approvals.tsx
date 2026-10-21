import { useMemo, useState } from "react";
import { ClipboardCheck, History, ShieldAlert, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApprovalRequestCard } from "@/components/approvals/ApprovalRequestCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useDB, useCurrentUser } from "@/hooks/use-db";
import { canDecide } from "@/services/approvals";
import { verifyAuditChain } from "@/services/audit";
import { getMember } from "@/services/api";
import { can } from "@/services/permissions";
import { formatArabicDate, formatTime } from "@/lib/formatters";
import type { ApprovalRequest } from "@/types";

const TABS: { key: string; label: string; statuses: ApprovalRequest["status"][] }[] = [
  { key: "pending", label: "في الانتظار", statuses: ["pending"] },
  { key: "approved", label: "موافق عليها", statuses: ["approved", "failed"] },
  { key: "rejected", label: "مرفوضة", statuses: ["rejected", "stale"] },
  { key: "executed", label: "منفّذة", statuses: ["executed"] },
];

export default function Approvals() {
  const db = useDB();
  const user = useCurrentUser();
  const [mineOnly, setMineOnly] = useState(false);
  const requests = useMemo(
    () => db.approvals.filter((a) => a.tenantId === db.tenantId && (!mineOnly || canDecide(a, db) || a.proposedBy === user.id)),
    [db, mineOnly, user.id],
  );
  const pendingMine = db.approvals.filter((a) => a.status === "pending" && canDecide(a, db)).length;
  const chain = useMemo(() => verifyAuditChain(db.audit), [db.audit]);

  return (
    <AppShell title="طلبات الموافقة" subtitle="كل عملية مقترحة تتطلب موافقة بشرية صريحة قبل التنفيذ">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-gold-deep" aria-hidden="true" />
            {pendingMine ? `${pendingMine} طلبات بانتظار قرارك` : "لا توجد طلبات بانتظار قرارك"}
          </p>
          <div className="flex min-h-11 items-center gap-2">
            <Switch id="mine-only" checked={mineOnly} onCheckedChange={setMineOnly} />
            <Label htmlFor="mine-only" className="font-normal">
              الطلبات التي تخصّني فقط
            </Label>
          </div>
        </div>

        <Tabs defaultValue="pending">
          <TabsList>
            {TABS.map((t) => {
              const count = requests.filter((r) => t.statuses.includes(r.status)).length;
              return (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                  <span className={t.key === "pending" && count ? "rounded-sm bg-gold/15 px-1.5 text-xs text-gold-deep" : "rounded-sm bg-muted px-1.5 text-xs text-muted-foreground"}>
                    {count}
                  </span>
                </TabsTrigger>
              );
            })}
            {can(user, "audit:read") && (
              <TabsTrigger value="audit">
                <History className="h-4 w-4" aria-hidden="true" />
                سجل التدقيق
              </TabsTrigger>
            )}
          </TabsList>

          {TABS.map((t) => {
            const list = requests
              .filter((r) => t.statuses.includes(r.status))
              .sort((a, b) => Number(canDecide(b, db)) - Number(canDecide(a, db)) || b.updatedAt.localeCompare(a.updatedAt));
            return (
              <TabsContent key={t.key} value={t.key}>
                {list.length === 0 ? (
                  <EmptyState icon={ClipboardCheck} title="لا توجد طلبات" description={t.key === "pending" ? "تظهر هنا مقترحات المساعد والكتبة التي تتطلب موافقة." : undefined} />
                ) : (
                  <ul className="mx-auto max-w-3xl space-y-4">
                    {list.map((r) => (
                      <li key={r.id}>
                        <ApprovalRequestCard request={r} />
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            );
          })}

          {can(user, "audit:read") && (
            <TabsContent value="audit" className="space-y-4">
              {chain.ok ? (
                <p className="flex items-center gap-2 rounded-[var(--radius)] border border-success/30 bg-success/10 p-3 text-sm text-success" role="status">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  سلسلة السجل سليمة: {chain.length} عمليات موقّعة ببصمات متسلسلة، دون أي تعديل أو حذف.
                </p>
              ) : (
                <p className="flex items-center gap-2 rounded-[var(--radius)] border border-alert/30 bg-alert/10 p-3 text-sm text-alert" role="alert">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  تحذير: سلسلة السجل مكسورة عند العملية رقم {chain.brokenAt + 1}. قد يكون السجل قد عُدّل خارج التطبيق.
                </p>
              )}
              <ol className="space-y-2">
                {db.audit.slice(0, 200).map((a) => (
                  <li key={a.id} className="card-elevated space-y-1 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{a.summary}</span>
                      <span className="text-xs text-muted-foreground">
                        {getMember(a.actorId)?.name} • {formatArabicDate(a.at.slice(0, 10))} <span className="font-mono">{formatTime(a.at)}</span>
                      </span>
                    </div>
                    {a.details?.changes && a.details.changes.length > 0 && (
                      <ul className="text-xs text-muted-foreground">
                        {a.details.changes.map((c, i) => (
                          <li key={i}>
                            {c.label}: {c.before ? `${c.before} ← ` : ""}
                            {c.after}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                      {a.details?.decision && <span>القرار: {a.details.decision === "approved" ? "موافقة" : "رفض"}</span>}
                      {a.details?.result && <span>النتيجة: {a.details.result.slice(0, 80)}</span>}
                      {a.via === "assistant" && <span className="text-gold-deep">اقتراح من المساعد</span>}
                      <span className="font-mono" dir="ltr">
                        #{a.hash?.slice(0, 12)}
                      </span>
                    </p>
                  </li>
                ))}
              </ol>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
