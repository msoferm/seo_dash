-- #1a: the previously hardcoded link-type names (COMMON_TYPES in ReportLinksManager.tsx)
-- are seeded into link_type_presets so EVERY link type becomes a deletable DB row.
-- The frontend now lists only DB presets, so after this seed the user can delete any of them
-- (and whatever they add persists until they remove it). Idempotent via the name unique constraint.
insert into link_type_presets (name) values
  ('אינדקס עסקים'),
  ('אינדקס עסקים באנגלית'),
  ('פוסט בבלוג'),
  ('מאמר ממומן'),
  ('קישור סימניה'),
  ('קישור חברתי'),
  ('כרטיס עסק'),
  ('קישור מצגת מעוצבת'),
  ('קישור פנימי'),
  ('החלפת קישורים'),
  ('פורום')
on conflict (name) do nothing;
