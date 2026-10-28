import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as api from "../api";
import { CLIENT_NAV } from "../navItems";
import type { NavEntry } from "../navItems";

interface Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

/**
 * The displayed heading follows the (possibly renamed) menu label for the current
 * client tab, so renaming a tab in "עריכת תפריט" also renames the page heading.
 * Falls back to the passed `title` when there is no custom label / no matching tab.
 */
function useResolvedTitle(fallback: string): string {
  const loc = useLocation();
  const m = loc.pathname.match(/^\/clients\/(\d+)(\/[^/?#]*)?/);
  const cid = m ? Number(m[1]) : undefined;
  const { data: navCfg } = useQuery({ queryKey: ["nav-config", cid ? String(cid) : null], queryFn: () => api.getNavConfig(cid), staleTime: 60_000, enabled: !!cid });
  if (!m) return fallback;
  const suffix = m[2] || "";
  const def = CLIENT_NAV.find((i) => i.suffix === suffix);
  if (!def) return fallback;
  const entry = (navCfg || []).find((e: NavEntry) => e.t === "i" && (e as { key: string }).key === def.key) as { label?: string } | undefined;
  return (entry?.label && entry.label.trim()) || fallback;
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  const resolved = useResolvedTitle(title);
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{resolved}</h1>
        {subtitle && <p className="text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
