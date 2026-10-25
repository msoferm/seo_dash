-- Category for report items, so "פעולות שבוצעו" can be grouped under headings
-- (קישורים / תוכן באתר / אופטימיזציה טכנית ותיקונים / המרות ו-UX / אחר).
alter table report_items add column if not exists category text;
