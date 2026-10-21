/** React Query bindings for the office API. Mutations invalidate the views they affect. */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";

import type {
  AuditEntryDTO,
  CaseDetailDTO,
  CaseNoteDTO,
  CaseSummaryDTO,
  ClientDetailDTO,
  ClientDTO,
  DashboardDTO,
  FeeAgreementDetailDTO,
  FeeAgreementDTO,
  FinanceTotalsDTO,
  HearingConflictsDTO,
  HearingDTO,
  HearingEventDTO,
  MeDTO,
  MemberDTO,
  Paginated,
  Permission,
  ReceiptDTO,
  ReminderDTO,
  SessionDTO,
  SettingsDTO,
  TaskBucket,
  TaskConflictsDTO,
  TaskDTO,
  TimelineEntryDTO,
} from "../../shared/api";
import { api, qs } from "./http";

type Params = Record<string, string | number | boolean | undefined | null>;

export const keys = {
  me: ["me"] as const,
  members: ["members"] as const,
  dashboard: ["dashboard"] as const,
  cases: (p: Params = {}) => ["cases", p] as const,
  case: (id: string) => ["case", id] as const,
  clients: (p: Params = {}) => ["clients", p] as const,
  client: (id: string) => ["client", id] as const,
  hearings: (p: Params = {}) => ["hearings", p] as const,
  fees: (p: Params = {}) => ["fees", p] as const,
  tasks: (p: Params = {}) => ["tasks", p] as const,
};

// ——— Identity ———

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: ({ signal }) => api.get<MeDTO>("/me", signal), staleTime: 5 * 60_000, retry: false });
}

/** Permission check from the server-computed permission list. */
export function useCan() {
  const { data } = useMe();
  return (permission: Permission) => !!data?.permissions.includes(permission);
}

export function useMembers(includeInactive = false) {
  return useQuery({
    queryKey: [...keys.members, includeInactive],
    queryFn: ({ signal }) => api.get<MemberDTO[]>(`/members${qs({ includeInactive })}`, signal),
    staleTime: 5 * 60_000,
  });
}

export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: ({ signal }) => api.get<DashboardDTO>("/dashboard", signal), staleTime: 30_000 });

// ——— Clients & cases ———

export const useClients = (p: Params = {}, enabled = true) =>
  useQuery({ queryKey: keys.clients(p), queryFn: ({ signal }) => api.get<Paginated<ClientDTO>>(`/clients${qs(p)}`, signal), placeholderData: keepPreviousData, enabled });
export const useClient = (id: string | undefined) =>
  useQuery({ queryKey: keys.client(id ?? ""), queryFn: ({ signal }) => api.get<ClientDetailDTO>(`/clients/${id}`, signal), enabled: !!id });

export const useCases = (p: Params = {}, enabled = true) =>
  useQuery({ queryKey: keys.cases(p), queryFn: ({ signal }) => api.get<Paginated<CaseSummaryDTO>>(`/cases${qs(p)}`, signal), placeholderData: keepPreviousData, enabled });
export const useCase = (id: string | undefined) =>
  useQuery({ queryKey: keys.case(id ?? ""), queryFn: ({ signal }) => api.get<CaseDetailDTO>(`/cases/${id}`, signal), enabled: !!id, retry: false });
export const useCaseNotes = (id: string | undefined) =>
  useQuery({ queryKey: ["case", id, "notes"], queryFn: ({ signal }) => api.get<CaseNoteDTO[]>(`/cases/${id}/notes`, signal), enabled: !!id });
export const useCaseTimeline = (id: string | undefined) =>
  useQuery({ queryKey: ["case", id, "timeline"], queryFn: ({ signal }) => api.get<TimelineEntryDTO[]>(`/cases/${id}/timeline`, signal), enabled: !!id });

// ——— Hearings ———

export const useHearings = (p: Params = {}, enabled = true) =>
  useQuery({ queryKey: keys.hearings(p), queryFn: ({ signal }) => api.get<Paginated<HearingDTO>>(`/hearings${qs({ pageSize: 200, ...p })}`, signal), placeholderData: keepPreviousData, enabled });
export const useConflictGroups = () => useQuery({ queryKey: ["conflict-groups"], queryFn: ({ signal }) => api.get<HearingDTO[][]>("/hearings/conflict-groups", signal) });
export const useHearingHistory = (id: string | undefined) =>
  useQuery({ queryKey: ["hearing", id, "history"], queryFn: ({ signal }) => api.get<HearingEventDTO[]>(`/hearings/${id}/history`, signal), enabled: !!id });
export function useHearingConflicts(p: { caseId?: string; date?: string; time?: string; durationMinutes?: number; excludeId?: string }) {
  const enabled = !!(p.caseId && p.date && p.time);
  return useQuery({
    queryKey: ["hearing-conflicts", p],
    queryFn: ({ signal }) => api.get<HearingConflictsDTO>(`/hearings/conflicts${qs(p)}`, signal),
    enabled,
    staleTime: 10_000,
  });
}

// ——— Finance ———

export const useFees = (p: Params = {}, enabled = true) =>
  useQuery({ queryKey: keys.fees(p), queryFn: ({ signal }) => api.get<Paginated<FeeAgreementDTO>>(`/fees${qs({ pageSize: 100, ...p })}`, signal), placeholderData: keepPreviousData, enabled });
export const useFee = (id: string | undefined) =>
  useQuery({ queryKey: ["fee", id], queryFn: ({ signal }) => api.get<FeeAgreementDetailDTO>(`/fees/${id}`, signal), enabled: !!id });
export const useFinanceTotals = (enabled = true) => useQuery({ queryKey: ["fees-totals"], queryFn: ({ signal }) => api.get<FinanceTotalsDTO[]>("/fees/totals", signal), enabled });
export const useReceipt = (id: string | undefined) =>
  useQuery({ queryKey: ["receipt", id], queryFn: ({ signal }) => api.get<ReceiptDTO>(`/receipts/${id}`, signal), enabled: !!id });

// ——— Tasks & reminders ———

export const useTasks = (p: Params & { bucket?: TaskBucket } = {}, enabled = true) =>
  useQuery({ queryKey: keys.tasks(p), queryFn: ({ signal }) => api.get<Paginated<TaskDTO>>(`/tasks${qs({ pageSize: 200, ...p })}`, signal), placeholderData: keepPreviousData, enabled });
export const useTaskSummary = (p: Params = {}) =>
  useQuery({ queryKey: ["task-summary", p], queryFn: ({ signal }) => api.get<Record<TaskBucket, number>>(`/tasks/summary${qs(p)}`, signal) });
export function useTaskConflicts(p: { assigneeId?: string; dueDate?: string; dueTime?: string; excludeId?: string }) {
  return useQuery({
    queryKey: ["task-conflicts", p],
    queryFn: ({ signal }) => api.get<TaskConflictsDTO>(`/tasks/conflicts${qs(p)}`, signal),
    enabled: !!(p.assigneeId && p.dueDate && p.dueTime),
    staleTime: 10_000,
  });
}
export const useInbox = (enabled = true) =>
  useQuery({ queryKey: ["inbox"], queryFn: ({ signal }) => api.get<{ items: ReminderDTO[]; unread: number }>("/reminders/inbox", signal), refetchInterval: 30_000, enabled });

// ——— Settings ———

export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: ({ signal }) => api.get<SettingsDTO>("/settings", signal) });
export const useSessions = () => useQuery({ queryKey: ["sessions"], queryFn: ({ signal }) => api.get<SessionDTO[]>("/me/sessions", signal) });
export const useOfficeMembers = (enabled: boolean) =>
  useQuery({ queryKey: ["settings-members"], queryFn: ({ signal }) => api.get<MemberDTO[]>("/settings/members", signal), enabled });
export const useAudit = (p: Params, enabled: boolean) =>
  useQuery({ queryKey: ["audit", p], queryFn: ({ signal }) => api.get<Paginated<AuditEntryDTO>>(`/settings/audit${qs(p)}`, signal), enabled, placeholderData: keepPreviousData });

// ——— Mutations ———

const AFFECTS = {
  cases: [["cases"], ["case"], ["dashboard"], ["clients"], ["client"], ["hearings"], ["tasks"]],
  hearings: [["hearings"], ["case"], ["cases"], ["dashboard"], ["conflict-groups"], ["hearing"], ["hearing-conflicts"], ["inbox"]],
  finance: [["fees"], ["fee"], ["fees-totals"], ["receipt"], ["dashboard"], ["case"]],
  tasks: [["tasks"], ["task-summary"], ["task-conflicts"], ["dashboard"], ["inbox"], ["case"]],
  clients: [["clients"], ["client"], ["cases"], ["case"]],
  settings: [["settings"], ["me"], ["members"], ["settings-members"], ["audit"], ["sessions"]],
} satisfies Record<string, QueryKey[]>;

export function useApiMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, affects: (keyof typeof AFFECTS)[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(affects.flatMap((group) => AFFECTS[group].map((queryKey) => qc.invalidateQueries({ queryKey }))));
    },
  });
}
