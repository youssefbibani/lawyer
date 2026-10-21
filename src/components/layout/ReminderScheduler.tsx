import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/backend/http";
import { useInbox } from "@/backend/queries";

const SHOWN_KEY = "qasr-al-adala:reminders-shown";

function shownIds(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(SHOWN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Shows in-app reminders delivered by the server (the server decides when a reminder is due,
 * even while no browser is open). E-mail delivery is handled — or honestly reported as not
 * configured — on the server.
 */
export function ReminderScheduler() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useInbox();
  const shown = useRef(shownIds());

  useEffect(() => {
    if (!data) return;
    for (const r of data.items) {
      if (shown.current.has(r.id)) continue;
      shown.current.add(r.id);
      toast(r.taskId ? "تذكير" : "تذكير بجلسة", {
        description: r.title,
        duration: 12_000,
        action: {
          label: "عرض",
          onClick: () => {
            void api.post(`/reminders/${r.id}/read`).then(() => queryClient.invalidateQueries({ queryKey: ["inbox"] }));
            navigate(r.taskId ? `/app/tasks?focus=${r.taskId}` : "/app/agenda");
          },
        },
      });
    }
    try {
      window.sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...shown.current].slice(-200)));
    } catch {
      // Storage unavailable: reminders may be shown again after a reload.
    }
  }, [data, navigate, queryClient]);

  return null;
}
