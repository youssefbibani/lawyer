import { cn } from "@/lib/utils";

export function CaseReference({ value, className }: { value: string; className?: string }) {
  return <span className={cn("ref-tag", className)}>{value}</span>;
}
