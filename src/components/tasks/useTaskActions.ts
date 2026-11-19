import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/backend/http";
import { useApiMutation } from "@/backend/queries";
import { formatArabicDate } from "@/lib/formatters";
import type { CompleteTaskResultDTO, TaskDTO } from "../../../shared/api";

/** How long a ticked task stays visible (green) before the lists refresh and it leaves. */
export const DONE_LINGER_MS = 1200;
const linger = () => new Promise((resolve) => setTimeout(resolve, DONE_LINGER_MS));

/** Shared toggle / edit / delete behaviour for task lists (page, dashboard, case detail). */
export function useTaskActions() {
  const [editing, setEditing] = useState<TaskDTO | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<TaskDTO | undefined>();
  /** Tasks ticked just now: shown green until the lists refresh. */
  const [finishing, setFinishing] = useState<ReadonlySet<string>>(new Set());

  // Saved on the server at once; the lists refresh only after a short pause so the tick is seen.
  const complete = useApiMutation(async (t: TaskDTO) => {
    const result = await api.post<CompleteTaskResultDTO>(`/tasks/${t.id}/complete`, { version: t.version });
    await linger();
    return result;
  }, ["tasks"]);
  const reopen = useApiMutation((t: TaskDTO) => api.post<TaskDTO>(`/tasks/${t.id}/reopen`, { version: t.version }), ["tasks"]);
  const cancel = useApiMutation((t: TaskDTO) => api.post<TaskDTO>(`/tasks/${t.id}/cancel`, { version: t.version }), ["tasks"]);

  const markFinishing = (id: string, on: boolean) =>
    setFinishing((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  function toggle(task: TaskDTO, completed: boolean) {
    if (completed) {
      markFinishing(task.id, true);
      complete.mutate(task, {
        onSuccess: (result) =>
          toast.success("تم إنجاز المهمة", result.next?.dueDate ? { description: `أُنشئ الموعد التالي ليوم ${formatArabicDate(result.next.dueDate)}.` } : undefined),
        onError: (err) => toast.error(err.message),
        onSettled: () => markFinishing(task.id, false),
      });
    } else {
      reopen.mutate(task, { onSuccess: () => toast.success("أُعيد فتح المهمة"), onError: (err) => toast.error(err.message) });
    }
  }

  function confirmDelete() {
    if (!deleting) return;
    cancel.mutate(deleting, {
      onSuccess: () => toast.success("تم حذف المهمة", { description: "أُلغيت تذكيراتها وبقي أثرها في سجل العمليات." }),
      onError: (err) => toast.error(err.message),
    });
    setDeleting(undefined);
  }

  return {
    editing,
    dialogOpen,
    setDialogOpen,
    deleting,
    setDeleting,
    toggle,
    isFinishing: (id: string) => finishing.has(id),
    confirmDelete,
    openNew() {
      setEditing(undefined);
      setDialogOpen(true);
    },
    openEdit(task: TaskDTO) {
      setEditing(task);
      setDialogOpen(true);
    },
  };
}
