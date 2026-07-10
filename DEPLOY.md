# DEPLOY - הוראות פריסה מותאמות לפרויקט שלך

הפרויקטים שלך:
- **GitHub**: https://github.com/msoferm/seo_dash
- **Supabase project ref**: `dnweyiopirzwnbrqdhmg`
- **Supabase URL**: `https://dnweyiopirzwnbrqdhmg.supabase.co`
- **Firebase project**: `seo-dash-48312`
- **Firebase URL** (אחרי deploy): `https://seo-dash-48312.web.app`

⚠️ **לפני שמתחילים — תחליף את סיסמת ה-DB!** שיתפת אותה בצ׳אט. ב-Supabase → Project Settings → Database → "Reset database password".

---

## שלב 1 — להפעיל את ה-Schema ב-Supabase (~2 דקות)

1. כנס ל-https://supabase.com/dashboard/project/dnweyiopirzwnbrqdhmg/sql/new
2. פתח את הקובץ `supabase/migrations/0001_initial_schema.sql` בעורך טקסט.
3. העתק את **כל התוכן** והדבק ב-SQL Editor ב-Supabase.
4. לחץ **Run**.

צריך לראות "Success. No rows returned" ולקבל את כל הטבלאות.

## שלב 2 — קבל את ה-API Keys מ-Supabase (~30 שניות)

1. https://supabase.com/dashboard/project/dnweyiopirzwnbrqdhmg/settings/api
2. שמור לעצמך:
   - `Project URL`: `https://dnweyiopirzwnbrqdhmg.supabase.co`
   - `anon` key (long string starting with `eyJ...`) — זה ל-frontend
   - `service_role` key — סודי, רק לסודות

## שלב 3 — צור OAuth credentials ב-Google Cloud (~5 דקות, אופציונלי)

לחיבור GSC ו-GA4. אם לא צריך את זה עכשיו - דלג.

1. https://console.cloud.google.com/ → New Project (או בחר קיים)
2. **APIs & Services → Library** → הפעל:
   - "Google Search Console API"
   - "Google Analytics Data API"
3. **OAuth consent screen** → External, מלא שם וסיוויי email, לחץ Save and continue. ב-Scopes הוסף ידנית:
   - `https://www.googleapis.com/auth/webmasters.readonly`
   - `https://www.googleapis.com/auth/analytics.readonly`
4. **Test users**: הוסף את האימיילים של הצוות (כולל שלך).
5. **Credentials → Create OAuth client ID** → Web application:
   - Authorized redirect URIs: `https://dnweyiopirzwnbrqdhmg.supabase.co/functions/v1/gsc-callback`
6. שמור: `Client ID` ו-`Client secret`.

## שלב 4 — מפתח Anthropic (~30 שניות)

1. https://console.anthropic.com/ → API Keys → Create
2. שמור לעצמך - יתחיל ב-`sk-ant-...`

## שלב 5 — Login + Link Supabase CLI ב-PowerShell (~2 דקות)

```powershell
cd "C:\Users\moshe\OneDrive\Desktop\פרויקטים בבינה\dashboard - seo"
npx supabase login
# ייפתח הדפדפן - אשר את ההתחברות
npx supabase link --project-ref dnweyiopirzwnbrqdhmg
# יבקש את ה-DB password (הסיסמה שתחליף אחרי השלב הזה)
```

## שלב 6 — להגדיר את הסודות ב-Supabase (~1 דקה)

```powershell
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
npx supabase secrets set FRONTEND_URL=https://seo-dash-48312.web.app
npx supabase secrets set CLAUDE_MODEL=claude-sonnet-4-6
# למעקב מיקומים ב-ZEFO (חובה כדי שמשיכת המיקומים תעבוד):
npx supabase secrets set ZEFO_API_KEY=YOUR_ZEFO_API_KEY
# אם יש Google OAuth:
npx supabase secrets set GOOGLE_CLIENT_ID=YOUR_CLIENT_ID
npx supabase secrets set GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
npx supabase secrets set GOOGLE_OAUTH_REDIRECT_URI=https://dnweyiopirzwnbrqdhmg.supabase.co/functions/v1/gsc-callback
```

> ⚠️ **חשוב:** את מפתח Anthropic *לא* מזינים בתוך האפליקציה — אין שם שדה כזה. הוא חייב להיות מוגדר כאן כסוד (secret) ב-Supabase, אחרת הצ'אט ומחולל ה-FAQ לא יעבדו.

## שלב 7 — לפרוס את ה-Edge Functions (~3 דקות)

**הדרך הפשוטה — פורסים את הכל בפקודה אחת, ואז שוב את gsc-callback:**

```powershell
npx supabase functions deploy
npx supabase functions deploy gsc-callback --no-verify-jwt
```

`npx supabase functions deploy` פורס את **כל** הפונקציות בתיקייה `supabase/functions`, כולל אלה של ZEFO ו-GA4. חשוב — אם פורסים ידנית פונקציה-פונקציה, אסור לשכוח אף אחת, אחרת אותה תכונה פשוט לא תעבוד. הרשימה המלאה כיום:

`claude-chat`, `faq-generate`, `faq-refine`, `faq-suggest`, `crawl-site`, `fetch-page`, `upload-keywords`, `gsc-authorize`, `gsc-callback` (עם `--no-verify-jwt`), `gsc-sync`, `gsc-list-sites`, `ga4-traffic`, `ga4-sync`, `ga4-list-properties`, `clients-bulk-import-gsc`, `zefo-list-sites`, `zefo-link-site`, `zefo-sync`.

> 💡 **קיצור:** אפשר פשוט להריץ את הסקריפט `setup-and-deploy.ps1` שבשורש הפרויקט — הוא עושה את שלבים 5–7 (login, link, secrets, deploy) אוטומטית.

## שלב 8 — בנייה ופריסה של ה-Frontend ל-Firebase (~3 דקות)

קודם, ה-frontend צריך לדעת איך לדבר עם Supabase:

```powershell
cd frontend
Copy-Item .env.example .env.local
notepad .env.local
```

מלא ב-`.env.local`:
```
VITE_SUPABASE_URL=https://dnweyiopirzwnbrqdhmg.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ... (מה-API keys שקיבלת בשלב 2)
```

עכשיו בנייה ופריסה:

```powershell
npm install
npm run build
cd ..
firebase login
firebase deploy --only hosting
```

האתר זמין ב: **https://seo-dash-48312.web.app**

## שלב 9 — להוסיף את עצמך כ-Admin (~30 שניות)

1. פתח https://seo-dash-48312.web.app
2. לחץ "הירשם" → אימייל+סיסמה → אישור.
3. עכשיו אתה במסך "החשבון לא משויך לצוות".
4. כנס ל-Supabase SQL Editor (https://supabase.com/dashboard/project/dnweyiopirzwnbrqdhmg/sql/new) והרץ:

```sql
insert into team_members (user_id, email, role)
select id, email, 'admin' from auth.users where email = 'YOUR_EMAIL@example.com';
```

(החלף את `YOUR_EMAIL@example.com` באימייל שאיתו נרשמת.)

5. רענן את הדף ב-Firebase — אתה בפנים.

## שלב 10 — להוסיף חברי צוות נוספים

כשמישהו מהצוות יירשם דרך ה-UI, הרץ:
```sql
insert into team_members (user_id, email, role)
select id, email, 'member' from auth.users where email = 'TEAMMATE@example.com';
```

---

# בדיקה שהכל עובד

1. ✅ פותח את https://seo-dash-48312.web.app — נכנס.
2. ✅ "לקוח חדש" → ממלא שם ודומיין → שומר.
3. ✅ עובר ל"מילות מפתח" → מעלה קובץ CSV מ-Google Keyword Planner → רואה את הטבלה.
4. ✅ "צ׳אט עם קלוד" → שואל "מה המילים המובילות שלי?" — קלוד עונה עם הנתונים האמיתיים.

אם משהו לא עובד — הצג את ה-error logs:
```powershell
npx supabase functions logs claude-chat --tail
```

---

# עדכונים עתידיים

כדי לעדכן את הקוד:
```powershell
git add .
git commit -m "תיאור השינוי"
git push
```

כדי לעדכן function ספציפית:
```powershell
npx supabase functions deploy claude-chat
```

כדי לעדכן את ה-frontend:
```powershell
cd frontend; npm run build; cd ..; firebase deploy --only hosting
```
