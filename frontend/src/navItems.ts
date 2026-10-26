import {
  BarChart3, Search, Target, HelpCircle, MessageSquare, ClipboardList, FileText, Sparkles,
  LayoutList, Activity, ClipboardCheck, Upload, Wand2, Radar, Stethoscope, Newspaper,
} from "lucide-react";

export interface NavItemDef { key: string; label: string; suffix: string; icon: any }

/** Canonical per-client tabs (defaults). The menu layout can be customized on top of this. */
export const CLIENT_NAV: NavItemDef[] = [
  { key: "overview", label: "סקירה", suffix: "", icon: BarChart3 },
  { key: "keywords", label: "מילות מפתח", suffix: "/keywords", icon: Search },
  { key: "rankings", label: "מעקב מיקומים", suffix: "/rankings", icon: Target },
  { key: "faq", label: "FAQ Generator", suffix: "/faq", icon: HelpCircle },
  { key: "chat", label: "צ׳אט עם קלוד", suffix: "/chat", icon: MessageSquare },
  { key: "tasks", label: "לוח משימות", suffix: "/tasks", icon: ClipboardList },
  { key: "reports", label: "דוחות קידום", suffix: "/reports", icon: FileText },
  { key: "engine", label: "מנוע המלצות", suffix: "/engine", icon: Sparkles },
  { key: "pages", label: "עמודים", suffix: "/pages", icon: LayoutList },
  { key: "impact", label: "מעקב השפעה", suffix: "/impact", icon: Activity },
  { key: "activity", label: "תיעוד ביצועים", suffix: "/activity", icon: ClipboardCheck },
  { key: "upload", label: "העלאת נתונים", suffix: "/upload", icon: Upload },
  { key: "recommendations", label: "המלצות קלוד", suffix: "/recommendations", icon: Wand2 },
  { key: "prospects", label: "איתור קישורים", suffix: "/prospects", icon: Radar },
  { key: "seo-tools", label: "כלי SEO", suffix: "/seo-tools", icon: Stethoscope },
  { key: "blog", label: "בלוג אוטומטי", suffix: "/blog", icon: Newspaper },
];

export const CLIENT_NAV_BY_KEY: Record<string, NavItemDef> = Object.fromEntries(CLIENT_NAV.map((i) => [i.key, i]));

export type NavEntry = { t: "h"; id: string; label: string; collapsible?: boolean } | { t: "i"; key: string; label?: string };

/** Merge a saved layout with the canonical list: drop stale keys, append any new tabs. */
export function resolveNav(config: NavEntry[] | null | undefined): NavEntry[] {
  if (!config || config.length === 0) return CLIENT_NAV.map((i) => ({ t: "i", key: i.key }));
  const canon = new Set(CLIENT_NAV.map((i) => i.key));
  const cleaned = config.filter((e) => e.t === "h" || canon.has((e as any).key));
  const present = new Set(cleaned.filter((e) => e.t === "i").map((e) => (e as any).key));
  const missing: NavEntry[] = CLIENT_NAV.filter((i) => !present.has(i.key)).map((i) => ({ t: "i", key: i.key }));
  return [...cleaned, ...missing];
}
