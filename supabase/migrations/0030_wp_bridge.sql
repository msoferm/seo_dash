-- SEO Dash Bridge: per-site secret + toggle for the companion WordPress plugin,
-- which exposes deeper edit capabilities (Elementor, meta, CSS, theme files) than core REST.
alter table client_wordpress add column if not exists bridge_secret text;
alter table client_wordpress add column if not exists bridge_enabled boolean default false;
