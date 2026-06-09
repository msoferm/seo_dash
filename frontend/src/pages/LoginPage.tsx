import { useState } from "react";
import { useAuth } from "../AuthContext";
import { LogIn, UserPlus } from "lucide-react";

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else { await signUp(email, password); setSignupSuccess(true); }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4">
      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-bold text-brand-700 mb-1">דאשבורד SEO</h1>
        <p className="text-slate-500 mb-6">
          {mode === "signin" ? "התחבר כדי להמשיך" : "צור חשבון חדש"}
        </p>

        {signupSuccess ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800">
            ✓ נרשמת בהצלחה. כעת בקש מהאדמין של הצוות להוסיף אותך לטבלת team_members ב-Supabase.
            <button className="btn-secondary mt-3 w-full" onClick={() => { setMode("signin"); setSignupSuccess(false); }}>
              חזור להתחברות
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-sm text-slate-600">אימייל</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm text-slate-600">סיסמה</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            {err && <div className="text-rose-600 text-sm">{err}</div>}
            <button className="btn-primary w-full" disabled={loading}>
              {mode === "signin" ? <><LogIn size={18} /> התחבר</> : <><UserPlus size={18} /> הירשם</>}
            </button>
            <button
              type="button"
              className="text-sm text-brand-700 hover:underline w-full text-center"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(null); }}
            >
              {mode === "signin" ? "אין לך חשבון? הירשם" : "כבר רשום? התחבר"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
