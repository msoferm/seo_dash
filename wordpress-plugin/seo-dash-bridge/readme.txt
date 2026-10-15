=== SEO Dash Bridge ===

Secure endpoints that let the SEO dashboard make deeper changes than the default
WordPress REST API: Elementor text edits, Yoast/RankMath meta, site-wide Additional
CSS, optional theme-file edits, and an optional (off by default) H1 fix.

IMPORTANT: The plugin changes NOTHING on its own. It only exposes capabilities; every
change happens only when you explicitly approve it from the dashboard, step by step.
There is no automatic or scheduled action.

== Install ==
1. WordPress admin → Plugins → Add New → Upload Plugin → choose seo-dash-bridge.zip → Install → Activate.
   (Or copy the seo-dash-bridge folder to wp-content/plugins/ and activate.)
2. Settings → SEO Dash Bridge. A secret key is generated automatically on activation.
   Copy that key into the dashboard for this site. (You can regenerate it there too.)
3. Optional: tick "theme/CSS file editing" only if you want the dashboard to edit template files.

== Verify ==
GET  https://YOUR-SITE/wp-json/seodash/v1/ping
Headers:  X-SEODASH-KEY: <your key>   + an Application Password (Basic auth)
Expected: {"ok":true, ...}

== Security ==
Every endpoint requires BOTH the secret key header AND an authenticated user who can
edit content. Theme-file editing is off by default and limited to the active theme
(php/css/js/html only) and keeps a .bak backup.
