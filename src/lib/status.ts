import type { CaseStatus, HearingUrgency, PaymentStatus, SearchRelevance, TaskPriority, TaskRecurrence } from "@/types";

export type StatusTone = "success" | "gold" | "alert" | "neutral";

export function caseStatusTone(status: CaseStatus): StatusTone {
  switch (status) {
    case "نشطة":
      return "success";
    case "مؤجلة":
      return "gold";
    case "منتهية":
      return "neutral";
  }
}

export function paymentStatusTone(status: PaymentStatus): StatusTone {
  switch (status) {
    case "مسدّد":
      return "success";
    case "جزئي":
      return "gold";
    case "غير مدفوع":
      return "alert";
  }
}

export function urgencyTone(urgency: HearingUrgency): StatusTone {
  switch (urgency) {
    case "urgent":
      return "alert";
    case "week":
      return "gold";
    case "later":
      return "neutral";
  }
}

export function urgencyLabel(urgency: HearingUrgency): string {
  switch (urgency) {
    case "urgent":
      return "عاجل";
    case "week":
      return "هذا الأسبوع";
    case "later":
      return "مبرمج";
  }
}

export function relevanceTone(relevance: SearchRelevance): StatusTone {
  switch (relevance) {
    case "قوي":
      return "success";
    case "متوسط":
      return "gold";
    case "جزئي":
      return "neutral";
  }
}

export function urgencyToneOf(urgency: HearingUrgency | "past"): StatusTone {
  return urgency === "past" ? "neutral" : urgencyTone(urgency);
}

export function urgencyLabelOf(urgency: HearingUrgency | "past"): string {
  return urgency === "past" ? "منقضية" : urgencyLabel(urgency);
}

export function priorityTone(priority: TaskPriority): StatusTone {
  switch (priority) {
    case "high":
      return "alert";
    case "medium":
      return "gold";
    case "low":
      return "neutral";
  }
}

export function priorityLabel(priority: TaskPriority): string {
  switch (priority) {
    case "high":
      return "أولوية عالية";
    case "medium":
      return "أولوية متوسطة";
    case "low":
      return "أولوية عادية";
  }
}

export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  none: "بدون تكرار",
  daily: "يومياً",
  weekly: "أسبوعياً",
  monthly: "شهرياً",
};
