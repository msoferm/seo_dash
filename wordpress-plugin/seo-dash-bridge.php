<?php
/**
 * Plugin Name: SEO Dash Bridge
 * Description: Secure endpoints + fixes that let the SEO dashboard make deeper changes than the default WordPress REST API (single H1, Elementor text edits, Yoast/RankMath meta, Additional CSS, and optional theme-file edits).
 * Version: 1.0.0
 * Author: SEO Dash
 *
 * INSTALL (self-hosted sites you control):
 *   1. Copy this file to:  wp-content/mu-plugins/seo-dash-bridge.php
 *      (create the "mu-plugins" folder if it doesn't exist — files there auto-activate,
 *       no admin install, so the site's WAF/plugin-blocker won't interfere.)
 *   2. Change SEODASH_KEY below to a long random string and give the SAME value to the
 *      dashboard for this site.
 *   3. (Optional) To allow template/theme-file edits, set SEODASH_ALLOW_THEME_FILES to true.
 *   4. Verify:  GET  https://SITE/wp-json/seodash/v1/ping   with header  X-SEODASH-KEY: <key>
 *              and a valid Application Password — should return {"ok":true,...}.
 */

if (!defined('ABSPATH')) exit;

/* ============================ CONFIG ============================ */
// REQUIRED: set to a long random secret, identical to the one stored in the dashboard.
if (!defined('SEODASH_KEY'))               define('SEODASH_KEY', 'CHANGE-ME-TO-A-LONG-RANDOM-STRING');
// H1 auto-fix: ensure every front-end page renders exactly one real <h1>.
if (!defined('SEODASH_FIX_H1'))            define('SEODASH_FIX_H1', true);
// Theme/template file editing can execute code — powerful and risky. Off by default.
if (!defined('SEODASH_ALLOW_THEME_FILES')) define('SEODASH_ALLOW_THEME_FILES', false);

/* ============================ AUTH ============================= */
/**
 * Every endpoint requires BOTH a matching shared secret header AND an authenticated user
 * (via Application Password) who can edit content. Two independent gates.
 */
function seodash_authed($request) {
    $key = $request->get_header('x-seodash-key');
    if (!$key || !hash_equals(SEODASH_KEY, (string) $key)) return false;
    return current_user_can('edit_posts');
}

/* ============================ ROUTES =========================== */
add_action('rest_api_init', function () {
    $perm = 'seodash_authed';

    register_rest_route('seodash/v1', '/ping', [
        'methods' => 'GET', 'permission_callback' => $perm,
        'callback' => function () {
            return [
                'ok' => true,
                'version' => '1.0.0',
                'elementor' => defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null,
                'theme_files_enabled' => (bool) SEODASH_ALLOW_THEME_FILES,
                'active_theme' => wp_get_theme()->get('Name'),
            ];
        },
    ]);

    // ---- SEO meta (Yoast + RankMath) ----
    register_rest_route('seodash/v1', '/meta/(?P<id>\d+)', [
        'methods' => 'POST', 'permission_callback' => $perm,
        'callback' => function ($r) {
            $id = (int) $r['id'];
            if (!get_post($id)) return new WP_Error('not_found', 'post not found', ['status' => 404]);
            $title = $r->get_param('title');
            $desc  = $r->get_param('description');
            if ($title !== null) { update_post_meta($id, '_yoast_wpseo_title', $title);   update_post_meta($id, 'rank_math_title', $title); }
            if ($desc  !== null) { update_post_meta($id, '_yoast_wpseo_metadesc', $desc); update_post_meta($id, 'rank_math_description', $desc); }
            return ['ok' => true, 'id' => $id];
        },
    ]);

    // ---- Elementor: read ----
    register_rest_route('seodash/v1', '/elementor/(?P<id>\d+)', [
        'methods' => 'GET', 'permission_callback' => $perm,
        'callback' => function ($r) {
            $id = (int) $r['id'];
            if (!get_post($id)) return new WP_Error('not_found', 'post not found', ['status' => 404]);
            return [
                'id' => $id,
                'uses_elementor' => get_post_meta($id, '_elementor_edit_mode', true) === 'builder',
                'data' => get_post_meta($id, '_elementor_data', true),
            ];
        },
    ]);

    // ---- Elementor: targeted text replace (safe: only touches string values) ----
    register_rest_route('seodash/v1', '/elementor/(?P<id>\d+)/replace', [
        'methods' => 'POST', 'permission_callback' => $perm,
        'callback' => 'seodash_elementor_replace',
    ]);

    // ---- Additional CSS (safe, via the Customizer's custom CSS — no file writes) ----
    register_rest_route('seodash/v1', '/custom-css', [
        'methods' => 'POST', 'permission_callback' => $perm,
        'callback' => function ($r) {
            $css  = (string) $r->get_param('css');
            $mode = $r->get_param('mode'); // 'append' (default) | 'replace'
            $current = wp_get_custom_css();
            $next = ($mode === 'replace') ? $css : trim($current . "\n" . $css);
            $res = wp_update_custom_css_post($next);
            if (is_wp_error($res)) return $res;
            return ['ok' => true, 'length' => strlen($next)];
        },
    ]);

    // ---- Theme files (GUARDED: off unless SEODASH_ALLOW_THEME_FILES, active theme only) ----
    register_rest_route('seodash/v1', '/theme-file', [
        'methods' => 'GET',  'permission_callback' => $perm, 'callback' => 'seodash_theme_file_get',
    ]);
    register_rest_route('seodash/v1', '/theme-file', [
        'methods' => 'POST', 'permission_callback' => $perm, 'callback' => 'seodash_theme_file_put',
    ]);
});

/* ======================= Elementor replace ===================== */
function seodash_elementor_replace($r) {
    $id = (int) $r['id'];
    $raw = get_post_meta($id, '_elementor_data', true);
    if (!$raw) return new WP_Error('no_elementor', 'page has no Elementor data', ['status' => 400]);
    $reps = $r->get_param('replacements');
    if (!is_array($reps)) return new WP_Error('bad_request', 'replacements[] required', ['status' => 400]);

    $data = json_decode(is_string($raw) ? $raw : wp_json_encode($raw), true);
    if (!is_array($data)) return new WP_Error('parse', 'could not parse Elementor data', ['status' => 500]);

    $count = 0;
    foreach ($reps as $rep) {
        $find    = isset($rep['find']) ? (string) $rep['find'] : '';
        $replace = isset($rep['replace']) ? (string) $rep['replace'] : '';
        if ($find === '') continue;
        seodash_walk_replace($data, $find, $replace, $count);
    }

    if ($count > 0) {
        $json = wp_json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        update_post_meta($id, '_elementor_data', wp_slash($json));
        if (class_exists('\Elementor\Plugin')) {
            try { \Elementor\Plugin::$instance->files_manager->clear_cache(); } catch (\Throwable $e) {}
        }
        clean_post_cache($id);
    }
    return ['ok' => true, 'replacements' => $count];
}
function seodash_walk_replace(&$node, $find, $replace, &$count) {
    if (is_array($node)) {
        foreach ($node as &$v) seodash_walk_replace($v, $find, $replace, $count);
    } elseif (is_string($node) && strpos($node, $find) !== false) {
        $node = str_replace($find, $replace, $node);
        $count++;
    }
}

/* ========================= H1 auto-fix ========================= */
if (SEODASH_FIX_H1) {
    add_action('template_redirect', function () {
        if (is_admin() || is_feed() || is_robots()) return;
        if (defined('REST_REQUEST') && REST_REQUEST) return;
        if (defined('DOING_AJAX') && DOING_AJAX) return;
        ob_start('seodash_h1_filter');
    });
}
function seodash_h1_filter($html) {
    if (!is_string($html) || stripos($html, '</body>') === false) return $html; // only full HTML docs
    if (preg_match('/<h1[\s>]/i', $html)) return $html;                          // already has an H1

    $promote_first = function ($segment) {
        return preg_replace_callback('/<(h[2-4])(\s[^>]*)?>(.*?)<\/\1>/is', function ($m) {
            return '<h1' . (isset($m[2]) ? $m[2] : '') . '>' . $m[3] . '</h1>';
        }, $segment, 1);
    };
    // Prefer the first heading inside the main content container.
    foreach (['/(<main\b[^>]*>)(.*?)(<\/main>)/is', '/(<article\b[^>]*>)(.*?)(<\/article>)/is'] as $wrap) {
        if (preg_match($wrap, $html, $mm)) {
            $inner = $promote_first($mm[2]);
            if ($inner !== $mm[2]) return str_replace($mm[0], $mm[1] . $inner . $mm[3], $html);
        }
    }
    // Fallback: promote the first H2 on the page.
    $new = preg_replace('/<h2(\s[^>]*)?>(.*?)<\/h2>/is', '<h1$1>$2</h1>', $html, 1, $c);
    return $c ? $new : $html;
}

/* ========================= Theme files ========================= */
function seodash_theme_path($rel) {
    $root = get_stylesheet_directory(); // active (child) theme only
    $full = $root . '/' . ltrim((string) $rel, '/');
    $resolved = realpath($full);
    $base = realpath($root);
    // For an existing file it must resolve inside the theme; for a new file, its parent must.
    if ($resolved !== false) { if (strpos($resolved, $base) !== 0) return null; }
    else { $parent = realpath(dirname($full)); if ($parent === false || strpos($parent, $base) !== 0) return null; }
    $ext = strtolower(pathinfo($full, PATHINFO_EXTENSION));
    if (!in_array($ext, ['php', 'css', 'js', 'html'], true)) return null;
    return $full;
}
function seodash_theme_file_get($r) {
    if (!SEODASH_ALLOW_THEME_FILES) return new WP_Error('disabled', 'theme-file editing is disabled (set SEODASH_ALLOW_THEME_FILES true)', ['status' => 403]);
    $p = seodash_theme_path($r->get_param('path'));
    if (!$p || !file_exists($p)) return new WP_Error('not_found', 'file not found / not allowed', ['status' => 404]);
    return ['path' => $r->get_param('path'), 'content' => file_get_contents($p)];
}
function seodash_theme_file_put($r) {
    if (!SEODASH_ALLOW_THEME_FILES) return new WP_Error('disabled', 'theme-file editing is disabled', ['status' => 403]);
    $p = seodash_theme_path($r->get_param('path'));
    if (!$p) return new WP_Error('bad_request', 'invalid path or extension (allowed: php/css/js/html, active theme only)', ['status' => 400]);
    $content = (string) $r->get_param('content');
    if (file_exists($p)) @copy($p, $p . '.seodash-bak'); // keep one backup for rollback
    $bytes = file_put_contents($p, $content);
    if ($bytes === false) return new WP_Error('io_error', 'write failed (file permissions?)', ['status' => 500]);
    return ['ok' => true, 'bytes' => $bytes, 'backup' => file_exists($p . '.seodash-bak')];
}
