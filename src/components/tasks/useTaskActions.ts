import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/backend/http";
import { useApiMutation } from "@/backend/queries";
import { formatArabicDate } from "@/lib/formatters";
import type { CompleteTaskResultDTO, TaskDTO } from "../../../shared/api";

/** Shared toggle / edit / delete behaviour for task lists (page, dashboard, case detail). */
export function useTaskActions() {
  const [editing, setEditing] = useState<TaskDTO | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<TaskDTO | undefined>();

  const complete = useApiMutation((t: TaskDTO) => api.post<CompleteTaskResultDTO>(`/tasks/${t.id}/complete`, { version: t.version }), ["tasks"]);
  const reopen = useApiMutation((t: TaskDTO) => api.post<TaskDTO>(`/tasks/${t.id}/reopen`, { version: t.version }), ["tasks"]);
  const cancel = useApiMutation((t: TaskDTO) => api.post<TaskDTO>(`/tasks/${t.id}/cancel`, { version: t.version }), ["tasks"]);

  function toggle(task: TaskDTO, completed: boolean) {
    if (completed) {
      complete.mutate(task, {
        onSuccess: (result) =>
          toast.success("تم إنجاز المهمة", result.next?.dueDate ? { description: `أُنشئ الموعد التالي ليوم ${formatArabicDate(result.next.dueDate)}.` } : undefined),
        onError: (err) => toast.error(err.message),
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
