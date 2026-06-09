-- After you sign up the first user via the frontend, run this manually in the SQL editor
-- to promote yourself to admin. Replace YOUR_EMAIL with your actual email.
--
-- insert into team_members (user_id, email, role)
-- select id, email, 'admin' from auth.users where email = 'YOUR_EMAIL';
--
-- To add more team members later:
-- insert into team_members (user_id, email, role)
-- select id, email, 'member' from auth.users where email = 'TEAMMATE_EMAIL';

-- This file is documentation only — no SQL is executed on apply.
select 1;
