import { useAuth } from "../AuthContext";

export default function NotMemberPage() {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="card max-w-md text-center">
        <div className="text-amber-600 text-5xl mb-3">⚠</div>
        <h2 className="text-xl font-bold mb-2">החשבון לא משויך לצוות</h2>
        <p className="text-slate-600 mb-4">
          האימייל <strong>{user?.email}</strong> רשום במערכת אבל לא הוסף לטבלת <code>team_members</code> ב-Supabase.
        </p>
        <p className="text-sm text-slate-500 mb-6">
          בקש מהאדמין להריץ את הפקודה הזו ב-SQL Editor של Supabase:
        </p>
        <pre className="bg-slate-100 rounded p-3 text-xs text-right overflow-x-auto whitespace-pre-wrap break-all">
{`insert into team_members (user_id, email, role)
select id, email, 'member' from auth.users
where email = '${user?.email}';`}
        </pre>
        <button className="btn-secondary mt-4 w-full" onClick={signOut}>התנתק</button>
      </div>
    </div>
  );
}
