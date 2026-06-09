# דאשבורד SEO - מערכת ענן לניהול לקוחות

מערכת מקצועית בענן לניהול לקוחות SEO אורגני. כולל ניהול לקוחות, מעקב מילות מפתח, חיבור Google Search Console + Analytics, יצירת FAQ אוטומטית עם קלוד, וצ׳אט עם קלוד שמנתח את הנתונים שלך.

**טכנולוגיה:** React (Vite + TypeScript) על Firebase Hosting · Supabase (Postgres + Auth + Edge Functions) · Claude Sonnet 4.6.

אין שום דבר להתקין למחשב של המשתמש - אתם פותחים URL ועובדים.

## תוכן עניינים

1. [מה כלול](#מה-כלול)
2. [התקנה ראשונית (~30 דקות, חד פעמי)](#התקנה-ראשונית)
3. [פריסה (deploy)](#פריסה)
4. [הוספת חברי צוות](#הוספת-חברי-צוות)
5. [שימוש יומיומי](#שימוש-יומיומי)
6. [פתרון בעיות](#פתרון-בעיות)

## מה כלול

- 🧑‍💼 **ניהול לקוחות** — הוספה/עריכה/מחיקה.
- 📊 **דאשבורד לכל לקוח** — קליקים אורגניים, חשיפות, מיקום ממוצע, top keywords + top pages.
- 🔍 **מילות מפתח** — העלאת CSV מ-Google Keyword Planner (כולל היסטוריה חודשית), טבלת חיפוש, גרף 12-חודשי לכל מילה.
- 🔗 **חיבור Google** — Search Console + GA4 דרך OAuth.
- ✨ **FAQ Generator** — בוחר עמודים, קלוד יוצר עמודי FAQ מובנים (כללי על העסק + ספציפי לעמוד + CTA), מציין מידע חסר, ומציע שאלות נוספות מ-GSC.
- 💬 **צ׳אט עם קלוד** — קלוד עונה על שאלות עם 5 כלים שמתחברים ל-DB: `get_keyword_stats`, `get_organic_traffic`, `get_top_keywords`, `get_page_performance`, `list_pages`.
- 🔒 **הרשאות צוות** — RLS על כל הטבלאות; רק חברי `team_members` יכולים לראות.

## התקנה ראשונית

### 1. פרויקט Supabase

1. ב-[supabase.com](https://supabase.com/dashboard) → **New project**. שמור: project ref (e.g. `abcdefgh`), database password.
2. **SQL Editor** → הדבק את התוכן של `supabase/migrations/0001_initial_schema.sql` → Run.
3. **Project Settings → API** — שמור:
   - `Project URL` (לדוגמה `https://abcdefgh.supabase.co`)
   - `anon` key (לפרונט)
   - `service_role` key (סודי - רק ל-secrets של Edge Functions)
4. **Authentication → Providers → Email** → ודא שמופעל. אופציונלי: כבה "Confirm email" כדי לדלג על אימייל אישור.

### 2. סודות (Secrets) של Edge Functions

בטרמינל (נדרש [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
npm install -g supabase
cd "dashboard - seo"
supabase login
supabase link --project-ref YOUR-PROJECT-REF
```

עכשיו הגדר את הסודות:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set GOOGLE_CLIENT_ID=...
supabase secrets set GOOGLE_CLIENT_SECRET=...
supabase secrets set GOOGLE_OAUTH_REDIRECT_URI=https://YOUR-PROJECT-REF.supabase.co/functions/v1/gsc-callback
supabase secrets set FRONTEND_URL=https://YOUR-FIREBASE-APP.web.app
supabase secrets set CLAUDE_MODEL=claude-sonnet-4-6
```

### 3. Google Cloud (לחיבור GSC/GA4)

1. [console.cloud.google.com](https://console.cloud.google.com/) → New Project.
2. **APIs & Services → Library** → הפעל:
   - Google Search Console API
   - Google Analytics Data API
3. **OAuth consent screen**: External, מלא שם+אימייל, scopes: `webmasters.readonly` + `analytics.readonly`, הוסף את האימיילים של הצוות כ-Test users.
4. **Credentials → Create OAuth client ID** → Web application:
   - Authorized redirect URI: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/gsc-callback`
5. העתק את `Client ID` ו-`Client secret` ל-Supabase secrets (שלב 2).

### 4. פרויקט Firebase

1. [console.firebase.google.com](https://console.firebase.google.com/) → Add project.
2. שמור את ה-Project ID. ערוך את `.firebaserc` והחלף `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID`.
3. בטרמינל:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```

### 5. מפתח Anthropic

[console.anthropic.com](https://console.anthropic.com/) → צור API key → הוסף ל-Supabase secrets (שלב 2).

### 6. הגדרות מקומיות לפיתוח

```bash
cd frontend
cp .env.example .env.local
```

ערוך `.env.local` והכנס:
```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=ey...
```

```bash
npm install
```

## פריסה

### לפרוס Edge Functions ל-Supabase:

```bash
cd "dashboard - seo"
supabase functions deploy claude-chat
supabase functions deploy faq-generate
supabase functions deploy faq-refine
supabase functions deploy faq-suggest
supabase functions deploy crawl-site
supabase functions deploy fetch-page
supabase functions deploy upload-keywords
supabase functions deploy gsc-authorize
supabase functions deploy gsc-callback --no-verify-jwt
supabase functions deploy gsc-sync
supabase functions deploy ga4-traffic
```

או פקודה אחת לכל:
```bash
supabase functions deploy
```

(הערה: `gsc-callback` חייב `--no-verify-jwt` כי Google הוא שמתקשר אליו)

### לבנות ולפרוס את ה-Frontend ל-Firebase Hosting:

```bash
cd frontend
npm run build
cd ..
firebase deploy --only hosting
```

מקבל URL כמו `https://YOUR-PROJECT.web.app` או `https://YOUR-PROJECT.firebaseapp.com`. **חזור** ל-Supabase secrets ועדכן את `FRONTEND_URL` ל-URL הזה.

### לעדכן את ה-Authorized redirect URI ב-Google:

חזור ל-Google Cloud Console → Credentials → ה-OAuth client → Authorized redirect URIs, ודא שיש: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/gsc-callback`.

## הוספת חברי צוות

ב-Supabase **SQL Editor** הרץ:

```sql
-- אתה עצמך (אדמין) - להריץ אחרי שנרשמת ראשון דרך ה-UI:
insert into team_members (user_id, email, role)
select id, email, 'admin' from auth.users where email = 'YOUR_EMAIL@example.com';

-- חברי צוות נוספים (אחרי שהם נרשמו דרך ה-UI):
insert into team_members (user_id, email, role)
select id, email, 'member' from auth.users where email = 'TEAMMATE@example.com';
```

חברי צוות שלא ב-`team_members` יראו מסך "החשבון לא משויך לצוות" עם הוראות.

## שימוש יומיומי

1. פותחים את ה-URL של Firebase (לדוגמה `https://seo-dash.web.app`).
2. נכנסים עם אימייל+סיסמה (פעם ראשונה — Sign up).
3. מוסיפים לקוח → ממלאים שם + דומיין + (אופציונלי) GSC property + GA4 property ID.
4. בדף הלקוח: "חבר Google" → OAuth flow.
5. עוברים ל"מילות מפתח" → מעלים את ה-CSV מ-Google Keyword Planner (UTF-16 LE).
6. עוברים ל"FAQ Generator" → סורקים אתר → בוחרים עמודים → קלוד יוצר.
7. בצ׳אט עם קלוד — שואלים שאלות כמו "כמה כניסות אורגניות היה למילה X?".

## פתרון בעיות

**"חסרים VITE_SUPABASE_URL"**
ערוך את `frontend/.env.local` והכנס את הערכים מ-Supabase.

**"החשבון לא משויך לצוות"**
האדמין צריך להריץ את ה-SQL בסעיף "הוספת חברי צוות".

**"GOOGLE_CLIENT_ID/SECRET לא הוגדרו"**
הרץ את `supabase secrets set GOOGLE_CLIENT_ID=...` (וכן ל-secret).

**שגיאת CORS**
ודא ש-`FRONTEND_URL` ב-Supabase secrets תואם בדיוק ל-URL הציבורי של Firebase.

**העלאת CSV נכשלת**
ודא שהקובץ הוא הקובץ המקורי מ-Google Keyword Planner (UTF-16 LE, tab-separated). אל תפתח ב-Excel ושמור מחדש.

**Edge Function נכשלת עם 401**
לוודא שאתה מחובר (`signIn`). ה-Edge Functions דורשות JWT תקין.

**לראות logs של Edge Functions**
```bash
supabase functions logs claude-chat --tail
```

## מבנה הפרויקט

```
dashboard - seo/
├── frontend/                    # React + Vite + TypeScript
│   ├── src/
│   │   ├── supabase.ts          # Supabase client
│   │   ├── AuthContext.tsx      # Auth state
│   │   ├── api.ts               # DB queries + Edge Function calls
│   │   ├── pages/               # 5 דפים + Login + NotMember
│   │   └── components/          # KpiCard, Spinner, PageHeader
│   ├── package.json
│   └── .env.example
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 0001_initial_schema.sql   # טבלאות + RLS
│   └── functions/               # 11 Edge Functions
│       ├── _shared/             # anthropic, google, supabase, cors
│       ├── claude-chat/
│       ├── faq-generate/
│       ├── faq-refine/
│       ├── faq-suggest/
│       ├── crawl-site/
│       ├── fetch-page/
│       ├── upload-keywords/
│       ├── gsc-authorize/
│       ├── gsc-callback/
│       ├── gsc-sync/
│       └── ga4-traffic/
├── firebase.json                # Firebase Hosting config
├── .firebaserc                  # ← הכנס project ID
└── README.md
```

## עלויות מוערכות (חודש)

- **Supabase Free** — 500MB DB, 50K MAU, 2M Edge Function invocations. **0$** לרוב המקרים.
- **Firebase Hosting Spark** — 10GB storage, 360MB/day transfer. **0$**.
- **Anthropic API** — Claude Sonnet 4.6 + prompt caching. **~5-20$** תלוי בשימוש.
- **Google APIs** — חינם בהיקפים שלנו.

**סה"כ צפוי:** $5-20/חודש למפתח Anthropic בלבד.
