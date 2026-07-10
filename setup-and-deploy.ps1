# ============================================================
#  הגדרה ופריסה אוטומטית של ה-Backend (Supabase Edge Functions)
#  מריצים פעם אחת כדי לתקן את הצ'אט/FAQ של קלוד ואת משיכת המיקומים מ-ZEFO.
#
#  הרצה: לחיצה ימנית על הקובץ -> "Run with PowerShell"
#  או ב-PowerShell:  ./setup-and-deploy.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$ProjectRef = "dnweyiopirzwnbrqdhmg"
$FrontendUrl = "https://seo-dash-48312.web.app"
$ClaudeModel = "claude-sonnet-4-6"

# לעבוד מתיקיית הסקריפט
Set-Location -Path $PSScriptRoot

function Step($n, $msg) { Write-Host "`n=== שלב $n — $msg ===" -ForegroundColor Cyan }

Write-Host "מתחילים בהגדרת ה-Backend בפרויקט Supabase: $ProjectRef" -ForegroundColor Green
Write-Host "(לאורך התהליך ייפתח דפדפן להתחברות ותתבקש להזין סיסמת DB — זה תקין)`n"

# ---- 1. התחברות ל-Supabase ----
Step 1 "התחברות ל-Supabase (ייפתח דפדפן)"
npx --yes supabase@latest login

# ---- 2. קישור לפרויקט ----
Step 2 "קישור לפרויקט (יבקש את סיסמת ה-DB)"
npx --yes supabase@latest link --project-ref $ProjectRef

# ---- 3. הגדרת הסודות (Secrets) ----
Step 3 "הגדרת מפתח Claude וסודות נוספים"
Write-Host "הדבק את מפתח ה-API של Anthropic (מתחיל ב-sk-ant-...). הוא לא יוצג על המסך:"
$secure = Read-Host -AsSecureString "ANTHROPIC_API_KEY"
$anthropicKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

if ([string]::IsNullOrWhiteSpace($anthropicKey)) {
  Write-Host "לא הוזן מפתח — מדלגים על הגדרת ANTHROPIC_API_KEY (תוכל להריץ שוב מאוחר יותר)." -ForegroundColor Yellow
} else {
  npx --yes supabase@latest secrets set "ANTHROPIC_API_KEY=$anthropicKey"
  Write-Host "ANTHROPIC_API_KEY הוגדר." -ForegroundColor Green
}

npx --yes supabase@latest secrets set "FRONTEND_URL=$FrontendUrl"
npx --yes supabase@latest secrets set "CLAUDE_MODEL=$ClaudeModel"

# ZEFO — אופציונלי. אם כבר הגדרת, פשוט תלחץ Enter כדי לדלג.
Write-Host "`nאם תרצה (מחדש) להגדיר את מפתח ZEFO — הדבק אותו כאן, אחרת Enter כדי לדלג:"
$secureZefo = Read-Host -AsSecureString "ZEFO_API_KEY (אופציונלי)"
$zefoKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureZefo))
if (-not [string]::IsNullOrWhiteSpace($zefoKey)) {
  npx --yes supabase@latest secrets set "ZEFO_API_KEY=$zefoKey"
  Write-Host "ZEFO_API_KEY הוגדר." -ForegroundColor Green
} else {
  Write-Host "מדלגים על ZEFO_API_KEY (נשאר כפי שהיה)." -ForegroundColor Yellow
}

# ---- 4. פריסת כל ה-Edge Functions ----
Step 4 "פריסת כל ה-Functions (כולל ZEFO, GA4, GSC, Claude)"
npx --yes supabase@latest functions deploy

# gsc-callback חייב להיות ללא verify-jwt כי גוגל קורא אליו ישירות
Step 5 "פריסה מחדש של gsc-callback ללא verify-jwt"
npx --yes supabase@latest functions deploy gsc-callback --no-verify-jwt

Write-Host "`n========================================" -ForegroundColor Green
Write-Host " הסתיים! מה שנפרס:" -ForegroundColor Green
Write-Host " - הצ'אט של קלוד + מחולל ה-FAQ אמורים לעבוד עכשיו (אם הוזן מפתח Anthropic)."
Write-Host " - הפונקציות של ZEFO נפרסו — עכשיו אפשר למשוך מיקומים."
Write-Host "`n כדי למשוך מיקומים מ-ZEFO: בדף הלקוח -> 'מעקב מיקומים' -> ודא שהלקוח מקושר לאתר ZEFO -> לחץ 'סנכרן'."
Write-Host "`n אם הצ'אט עדיין נכשל, הרץ כדי לראות את השגיאה:" -ForegroundColor Yellow
Write-Host "   npx supabase functions logs claude-chat"
Write-Host "========================================" -ForegroundColor Green
