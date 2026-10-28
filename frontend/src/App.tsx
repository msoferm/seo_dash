import { useState } from "react";
import { Routes, Route, NavLink, useParams, useLocation, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, Home, LogOut, Lightbulb, Settings2, ChevronDown } from "lucide-react";
import { useAuth } from "./AuthContext";
import * as api from "./api";
import { resolveNav, CLIENT_NAV_BY_KEY } from "./navItems";
import NavEditor from "./NavEditor";
import ClientsPage from "./pages/ClientsPage";
import ClientDashboard from "./pages/ClientDashboard";
import KeywordsPage from "./pages/KeywordsPage";
import FaqGeneratorPage from "./pages/FaqGeneratorPage";
import ClaudeChatPage from "./pages/ClaudeChatPage";
import RankingsPage from "./pages/RankingsPage";
import ReportsPage from "./pages/ReportsPage";
import ReportView from "./pages/ReportView";
import RecommendationsPage from "./pages/RecommendationsPage";
import RecEnginePage from "./pages/RecEnginePage";
import PagesMasterPage from "./pages/PagesMasterPage";
import ImpactPage from "./pages/ImpactPage";
import ActivityPage from "./pages/ActivityPage";
import DataUploadPage from "./pages/DataUploadPage";
import ProspectsPage from "./pages/ProspectsPage";
import SeoToolsPage from "./pages/SeoToolsPage";
import BlogPage from "./pages/BlogPage";
import TasksPage from "./pages/TasksPage";
import SuggestionsPage from "./pages/SuggestionsPage";
import LoginPage from "./pages/LoginPage";
import NotMemberPage from "./pages/NotMemberPage";
import Spinner from "./components/Spinner";

function Sidebar() {
  const { clientId } = useParams();
  const { user, signOut } = useAuth();
  const cid = clientId;
  const navItem = "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors";
  const active = "bg-brand-50 text-brand-700";
  const inactive = "text-slate-600 hover:bg-slate-100";
  const { data: navCfg } = useQuery({ queryKey: ["nav-config", cid], queryFn: () => api.getNavConfig(cid ? Number(cid) : undefined) });
  const entries = resolveNav(navCfg);
  const [editOpen, setEditOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const location = useLocation();
  const base = `/clients/${cid}`;
  const isActivePath = (suffix: string) => suffix === "" ? location.pathname === base : location.pathname === base + suffix || location.pathname.startsWith(base + suffix + "/");
  // The collapsible group that contains the active tab (so it opens automatically).
  let activeGroup: string | null = null;
  { let g: string | null = null;
    for (const e of entries) {
      if (e.t === "h") { g = e.collapsible ? e.id : null; continue; }
      const d = CLIENT_NAV_BY_KEY[e.key];
      if (g && d && isActivePath(d.suffix)) { activeGroup = g; break; }
    }
  }
  const isGroupOpen = (id: string) => openGroups[id] ?? (id === activeGroup);
  return (
    <aside className="w-64 bg-white border-l border-slate-200 p-4 flex flex-col gap-1 shrink-0 sticky top-0 h-screen overflow-y-auto">
      <Link to="/" className="text-xl font-bold text-brand-700 mb-4 px-3">דאשבורד SEO</Link>
      <NavLink to="/" end className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
        <Home size={18} /> כל הלקוחות
      </NavLink>
      <NavLink to="/suggestions" className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
        <Lightbulb size={18} /> הצעות ייעול
      </NavLink>
      {cid && (
        <>
          <div className="flex items-center justify-between mt-4 px-3">
            <span className="text-xs text-slate-400 uppercase">הלקוח הנוכחי</span>
            <button className="text-slate-400 hover:text-brand-600" title="ערוך תפריט" onClick={() => setEditOpen(true)}><Settings2 size={14} /></button>
          </div>
          {(() => {
            const out: React.ReactNode[] = [];
            let group: string | null = null;
            entries.forEach((e, i) => {
              if (e.t === "h") {
                if (e.collapsible) {
                  group = e.id;
                  const open = isGroupOpen(e.id);
                  const gid = e.id;
                  out.push(
                    <button key={`h${i}`} onClick={() => setOpenGroups((s) => ({ ...s, [gid]: !isGroupOpen(gid) }))}
                      className="flex items-center justify-between w-full text-xs text-slate-400 uppercase mt-3 px-3 py-1 hover:text-slate-600">
                      <span>{e.label}</span>
                      <ChevronDown size={14} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
                    </button>
                  );
                } else {
                  group = null;
                  out.push(<div key={`h${i}`} className="text-xs text-slate-400 uppercase mt-3 px-3">{e.label}</div>);
                }
                return;
              }
              if (group && !isGroupOpen(group)) return;
              const def = CLIENT_NAV_BY_KEY[e.key]; if (!def) return;
              const Icon = def.icon;
              out.push(
                <NavLink key={e.key} to={`/clients/${cid}${def.suffix}`} end={def.suffix === ""}
                  className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
                  <Icon size={18} /> {e.label ?? def.label}
                </NavLink>
              );
            });
            return out;
          })()}
        </>
      )}
      {editOpen && cid && <NavEditor clientId={Number(cid)} onClose={() => setEditOpen(false)} />}
      <div className="mt-auto pt-4 border-t border-slate-100 text-xs text-slate-500">
        <div className="px-3 truncate flex items-center gap-1 mb-2">
          <Users size={14} /> {user?.email}
        </div>
        <button className="w-full text-right px-3 py-1 hover:bg-slate-50 rounded text-rose-600 flex items-center gap-1" onClick={signOut}>
          <LogOut size={14} /> התנתק
        </button>
      </div>
    </aside>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-start">
      <Sidebar />
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}

export default function App() {
  const { session, isTeamMember, loading } = useAuth();

  if (loading) {
    return <div className="h-screen flex items-center justify-center"><Spinner /></div>;
  }
  if (!session) return <LoginPage />;
  if (isTeamMember === false) return <NotMemberPage />;

  return (
    <Routes>
      <Route path="/" element={<Layout><ClientsPage /></Layout>} />
      <Route path="/suggestions" element={<Layout><SuggestionsPage /></Layout>} />
      <Route path="/clients/:clientId" element={<Layout><ClientDashboard /></Layout>} />
      <Route path="/clients/:clientId/keywords" element={<Layout><KeywordsPage /></Layout>} />
      <Route path="/clients/:clientId/rankings" element={<Layout><RankingsPage /></Layout>} />
      <Route path="/clients/:clientId/faq" element={<Layout><FaqGeneratorPage /></Layout>} />
      <Route path="/clients/:clientId/chat" element={<Layout><ClaudeChatPage /></Layout>} />
      <Route path="/clients/:clientId/tasks" element={<Layout><TasksPage /></Layout>} />
      <Route path="/clients/:clientId/reports" element={<Layout><ReportsPage /></Layout>} />
      <Route path="/clients/:clientId/reports/:reportId" element={<Layout><ReportView /></Layout>} />
      <Route path="/clients/:clientId/engine" element={<Layout><RecEnginePage /></Layout>} />
      <Route path="/clients/:clientId/pages" element={<Layout><PagesMasterPage /></Layout>} />
      <Route path="/clients/:clientId/impact" element={<Layout><ImpactPage /></Layout>} />
      <Route path="/clients/:clientId/activity" element={<Layout><ActivityPage /></Layout>} />
      <Route path="/clients/:clientId/upload" element={<Layout><DataUploadPage /></Layout>} />
      <Route path="/clients/:clientId/recommendations" element={<Layout><RecommendationsPage /></Layout>} />
      <Route path="/clients/:clientId/prospects" element={<Layout><ProspectsPage /></Layout>} />
      <Route path="/clients/:clientId/seo-tools" element={<Layout><SeoToolsPage /></Layout>} />
      <Route path="/clients/:clientId/blog" element={<Layout><BlogPage /></Layout>} />
    </Routes>
  );
}
