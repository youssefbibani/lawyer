import {
  LayoutDashboard,
  Briefcase,
  Archive,
  Search,
  Calendar,
  Wallet,
  Settings,
  Sparkles,
  ListTodo,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  path: string;
  badge?: string;
  /** Live counter rendered next to the label. */
  counter?: "approvals";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "لوحة التحكم", shortLabel: "الرئيسية", icon: LayoutDashboard, path: "/app" },
  { label: "المساعد القانوني الذكي", shortLabel: "المساعد", icon: Sparkles, path: "/app/assistant", badge: "جديد" },
  { label: "القضايا", shortLabel: "القضايا", icon: Briefcase, path: "/app/cases" },
  { label: "الحرفاء", shortLabel: "الحرفاء", icon: Users, path: "/app/clients" },
  { label: "الجلسات", shortLabel: "الجلسات", icon: Calendar, path: "/app/agenda" },
  { label: "المهام والتذكيرات", shortLabel: "المهام", icon: ListTodo, path: "/app/tasks" },
  { label: "طلبات الموافقة", shortLabel: "الموافقات", icon: ShieldCheck, path: "/app/approvals", counter: "approvals" },
  { label: "الأرشفة الذكية", shortLabel: "الأرشفة", icon: Archive, path: "/app/archive" },
  { label: "البحث الذكي", shortLabel: "البحث", icon: Search, path: "/app/search" },
  { label: "الأتعاب", shortLabel: "الأتعاب", icon: Wallet, path: "/app/payments" },
  { label: "الإعدادات", shortLabel: "الإعدادات", icon: Settings, path: "/app/settings" },
];

/** Key destinations shown in the mobile bottom bar; the rest live in the "More" sheet. */
export const BOTTOM_NAV_PATHS = ["/app", "/app/cases", "/app/assistant", "/app/agenda"];

export const SECONDARY_NAV_ITEMS = NAV_ITEMS.filter((i) => !BOTTOM_NAV_PATHS.includes(i.path));

export function isActivePath(itemPath: string, pathname: string): boolean {
  if (itemPath === "/app") return pathname === "/app" || pathname === "/app/";
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}
