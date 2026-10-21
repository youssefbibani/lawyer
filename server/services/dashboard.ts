import type { CaseType, DashboardDTO } from "../../shared/api.js";
import { prisma } from "../db.js";
import type { Ctx } from "../http/context.js";
import { dateOnly, todayIn } from "../lib/time.js";
import { can, caseScope, taskScope } from "./authorization.js";
import { caseSummaryDTO, caseSummaryInclude, taskDTO, taskInclude } from "./dto.js";
import { financeTotals } from "./finance.js";
import { conflictGroups, upcomingHearings } from "./hearings.js";

export async function dashboard(ctx: Ctx): Promise<DashboardDTO> {
  const tz = ctx.actor.office.timeZone;
  const today = todayIn(tz);
  const day = dateOnly(today);
  const cases = { AND: [caseScope(ctx.actor), { archivedAt: null }] };

  const [activeCases, distribution, recent, todayTasks, overdueTaskCount, hearings, groups, totals] = await Promise.all([
    prisma.case.count({ where: { AND: [cases, { status: "ACTIVE" }] } }),
    prisma.case.groupBy({ by: ["type"], where: cases, _count: { _all: true } }),
    prisma.case.findMany({ where: { AND: [cases, { status: "ACTIVE" }] }, include: caseSummaryInclude(new Date()), orderBy: { updatedAt: "desc" }, take: 6 }),
    prisma.task.findMany({
      where: { AND: [taskScope(ctx.actor), { status: "OPEN", dueDate: day }] },
      include: taskInclude,
      orderBy: [{ dueTime: { sort: "asc", nulls: "last" } }, { priority: "asc" }],
      take: 10,
    }),
    prisma.task.count({ where: { AND: [taskScope(ctx.actor), { status: "OPEN", dueDate: { lt: day } }] } }),
    upcomingHearings(ctx, 7),
    conflictGroups(ctx),
    can(ctx.actor, "finance:read") ? financeTotals(ctx) : Promise.resolve(null),
  ]);

  return {
    today,
    activeCases,
    hearingsNext7Days: hearings,
    todayTasks: todayTasks.map(taskDTO),
    overdueTaskCount,
    conflictGroups: groups,
    caseTypeDistribution: distribution.map((d) => ({ type: d.type as CaseType, count: d._count._all })).sort((a, b) => b.count - a.count),
    recentCases: recent.map(caseSummaryDTO),
    outstanding: totals ? totals.map((t) => ({ currency: t.currency, amount: t.remaining })) : null,
  };
}
