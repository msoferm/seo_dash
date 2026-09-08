import { Routes, Route, NavLink, useParams, Link } from "react-router-dom";
import { Users, BarChart3, Search, MessageSquare, HelpCircle, Home, LogOut, Target, ClipboardList, Lightbulb, FileText, Wand2, Radar, Stethoscope, Newspaper, Sparkles, LayoutList, Activity } from "lucide-react";
import { useAuth } from "./AuthContext";
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
  return (
    <aside className="w-64 bg-white border-l border-slate-200 p-4 flex flex-col gap-1 shrink-0">
      <Link to="/" className="text-xl font-bold text-brand-700 mb-4 px-3">דאשבורד SEO</Link>
      <NavLink to="/" end className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
        <Home size={18} /> כל הלקוחות
      </NavLink>
      <NavLink to="/suggestions" className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
        <Lightbulb size={18} /> הצעות ייעול
      </NavLink>
      {cid && (
        <>
          <div className="text-xs text-slate-400 uppercase mt-4 px-3">הלקוח הנוכחי</div>
          <NavLink to={`/clients/${cid}`} end className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <BarChart3 size={18} /> סקירה
          </NavLink>
          <NavLink to={`/clients/${cid}/keywords`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <Search size={18} /> מילות מפתח
          </NavLink>
          <NavLink to={`/clients/${cid}/rankings`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <Target size={18} /> מעקב מיקומים
          </NavLink>
          <NavLink to={`/clients/${cid}/faq`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <HelpCircle size={18} /> FAQ Generator
          </NavLink>
          <NavLink to={`/clients/${cid}/chat`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <MessageSquare size={18} /> צ׳אט עם קלוד
          </NavLink>
          <NavLink to={`/clients/${cid}/tasks`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <ClipboardList size={18} /> לוח משימות
          </NavLink>
          <NavLink to={`/clients/${cid}/reports`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <FileText size={18} /> דוחות קידום
          </NavLink>
          <NavLink to={`/clients/${cid}/engine`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <Sparkles size={18} /> מנוע המלצות
          </NavLink>
          <NavLink to={`/clients/${cid}/pages`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <LayoutList size={18} /> עמודים
          </NavLink>
          <NavLink to={`/clients/${cid}/impact`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <Activity size={18} /> מעקב השפעה
          </NavLink>
          <NavLink to={`/clients/${cid}/recommendations`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <Wand2 size={18} /> המלצות קלוד
          </NavLink>
          <NavLink to={`/clients/${cid}/prospects`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <Radar size={18} /> איתור קישורים
          </NavLink>
          <NavLink to={`/clients/${cid}/seo-tools`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <Stethoscope size={18} /> כלי SEO
          </NavLink>
          <NavLink to={`/clients/${cid}/blog`} className={({ isActive }) => `${navItem} ${isActive ? active : inactive}`}>
            <Newspaper size={18} /> בלוג אוטומטי
          </NavLink>
        </>
      )}
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
    <div className="h-full flex">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
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
      <Route path="/clients/:clientId/recommendations" element={<Layout><RecommendationsPage /></Layout>} />
      <Route path="/clients/:clientId/prospects" element={<Layout><ProspectsPage /></Layout>} />
      <Route path="/clients/:clientId/seo-tools" element={<Layout><SeoToolsPage /></Layout>} />
      <Route path="/clients/:clientId/blog" element={<Layout><BlogPage /></Layout>} />
    </Routes>
  );
}
