<?php
/**
 * Plugin Name: SEO Dash Bridge
 * Description: Secure endpoints + fixes that let the SEO dashboard make deeper changes than the default WordPress REST API (single H1, Elementor text edits, Yoast/RankMath meta, Additional CSS, and optional theme-file edits). Configure under Settings → SEO Dash Bridge.
 * Version: 1.2.0
 * Author: SEO Dash
 */

if (!defined('ABSPATH')) exit;

/* ===== Settings resolution (constants override options, for power users) ===== */
function seodash_key() {
    if (defined('SEODASH_KEY') && SEODASH_KEY && SEODASH_KEY !== 'CHANGE-ME-TO-A-LONG-RANDOM-STRING') return SEODASH_KEY;
    return (string) get_option('seodash_key', '');
}
function seodash_fix_h1_enabled() {
    if (defined('SEODASH_FIX_H1')) return (bool) SEODASH_FIX_H1;
    return get_option('seodash_fix_h1', '0') === '1'; // OFF by default — nothing automatic
}
function seodash_theme_files_enabled() {
    if (defined('SEODASH_ALLOW_THEME_FILES')) return (bool) SEODASH_ALLOW_THEME_FILES;
    return get_option('seodash_allow_theme_files', '0') === '1';
}

/* ===== On activation: auto-generate a secret so it's ready immediately ===== */
register_activation_hook(__FILE__, function () {
    if (!get_option('seodash_key')) {
        try { $k = bin2hex(random_bytes(24)); } catch (\Throwable $e) { $k = wp_generate_password(48, false, false); }
        add_option('seodash_key', $k);
    }
    if (get_option('seodash_fix_h1') === false) add_option('seodash_fix_h1', '0');          // OFF — nothing automatic
    if (get_option('seodash_allow_theme_files') === false) add_option('seodash_allow_theme_files', '0');
});

/* ============================ AUTH ============================= */
function seodash_authed($request) {
    $expected = seodash_key();
    $key = (string) $request->get_header('x-seodash-key');
    if ($expected === '' || $key === '' || !hash_equals($expected, $key)) return false;
    return current_user_can('edit_posts');
}

/* ========================= Admin settings ===================== */
add_action('admin_menu', function () {
    add_options_page('SEO Dash Bridge', 'SEO Dash Bridge', 'manage_options', 'seo-dash-bridge', 'seodash_settings_page');
});
add_action('admin_init', function () {
    register_setting('seodash_group', 'seodash_key');
    register_setting('seodash_group', 'seodash_fix_h1');
    register_setting('seodash_group', 'seodash_allow_theme_files');
});
function seodash_settings_page() {
    if (!current_user_can('manage_options')) return;
    $key  = esc_attr(get_option('seodash_key', ''));
    $h1   = get_option('seodash_fix_h1', '0') === '1';
    $tf   = get_option('seodash_allow_theme_files', '0') === '1';
    $ping = esc_url(rest_url('seodash/v1/ping'));
    ?>
    <div class="wrap">
      <h1>SEO Dash Bridge</h1>
      <p>מחבר את האתר לדאשבורד ה-SEO. העתק את המפתח הסודי לדאשבורד עבור אתר זה.</p>
      <p style="background:#f0f6fc;border-right:4px solid #2271b1;padding:10px 12px;max-width:40rem">
        <strong>הפלאגין אינו משנה דבר באתר מעצמו.</strong> הוא רק מאפשר פעולות, וכל שינוי מתבצע אך ורק כשאתה מאשר אותו ידנית בדאשבורד — שלב אחרי שלב. אין שום פעולה אוטומטית או מתוזמנת.
      </p>
      <form method="post" action="options.php">
        <?php settings_fields('seodash_group'); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th scope="row"><label for="seodash_key">מפתח סודי (X-SEODASH-KEY)</label></th>
            <td>
              <input name="seodash_key" id="seodash_key" type="text" class="regular-text code" style="width:28rem" value="<?php echo $key; ?>" />
              <button type="button" class="button" onclick="(function(){var a='0123456789abcdef',s='';for(var i=0;i<48;i++)s+=a[Math.floor(Math.random()*16)];document.getElementById('seodash_key').value=s;})()">צור חדש</button>
              <p class="description">מחרוזת אקראית ארוכה. הדבק את אותו ערך בדאשבורד עבור אתר זה.</p>
            </td>
          </tr>
          <tr>
            <th scope="row">תיקון H1 אוטומטי (כבוי)</th>
            <td><label><input type="checkbox" name="seodash_fix_h1" value="1" <?php checked($h1); ?> /> אם תסמן — האתר יוסיף H1 תקין בכל עמוד שחסר בו. כבוי כברירת מחדל; השאר כבוי אם אתה מעדיף לתקן ידנית.</label></td>
          </tr>
          <tr>
            <th scope="row">עריכת קבצי תבנית/CSS</th>
            <td>
              <label><input type="checkbox" name="seodash_allow_theme_files" value="1" <?php checked($tf); ?> /> אפשר עריכת קבצי התבנית הפעילה דרך הדאשבורד.</label>
              <p class="description" style="color:#b32d2e">זהירות: מאפשר כתיבת קבצי php/css/js/html בתבנית — יכולת חזקה. הפעל רק אם צריך.</p>
            </td>
          </tr>
          <tr>
            <th scope="row">כתובת בדיקה</th>
            <td><code><?php echo $ping; ?></code> <span class="description">(דורש כותרת X-SEODASH-KEY + Application Password)</span></td>
          </tr>
        </table>
        <?php submit_button('שמור'); ?>
      </form>
    </div>
    <?php
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    $links[] = '<a href="' . admin_url('options-general.php?page=seo-dash-bridge') . '">הגדרות</a>';
    return $links;
});

/* ============================ ROUTES =========================== */
add_action('rest_api_init', function () {
    $perm = 'seodash_authed';

    register_rest_route('seodash/v1', '/ping', [
        'methods' => 'GET', 'permission_callback' => $perm,
        'callback' => function () {
            return [
                'ok' => true,
                'version' => '1.2.0',
                'elementor' => defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null,
                'h1_fix_enabled' => seodash_fix_h1_enabled(),
                'theme_files_enabled' => seodash_theme_files_enabled(),
                'active_theme' => wp_get_theme()->get('Name'),
            ];
        },
    ]);

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

    register_rest_route('seodash/v1', '/elementor/(?P<id>\d+)/replace', [
        'methods' => 'POST', 'permission_callback' => $perm, 'callback' => 'seodash_elementor_replace',
    ]);

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
add_action('template_redirect', function () {
    if (!seodash_fix_h1_enabled()) return;
    if (is_admin() || is_feed() || is_robots()) return;
    if (defined('REST_REQUEST') && REST_REQUEST) return;
    if (defined('DOING_AJAX') && DOING_AJAX) return;
    ob_start('seodash_h1_filter');
});
function seodash_h1_filter($html) {
    if (!is_string($html) || stripos($html, '</body>') === false) return $html;
    if (preg_match('/<h1[\s>]/i', $html)) return $html;

    $promote_first = function ($segment) {
        return preg_replace_callback('/<(h[2-4])(\s[^>]*)?>(.*?)<\/\1>/is', function ($m) {
            return '<h1' . (isset($m[2]) ? $m[2] : '') . '>' . $m[3] . '</h1>';
        }, $segment, 1);
    };
    foreach (['/(<main\b[^>]*>)(.*?)(<\/main>)/is', '/(<article\b[^>]*>)(.*?)(<\/article>)/is'] as $wrap) {
        if (preg_match($wrap, $html, $mm)) {
            $inner = $promote_first($mm[2]);
            if ($inner !== $mm[2]) return str_replace($mm[0], $mm[1] . $inner . $mm[3], $html);
        }
    }
    $new = preg_replace('/<h2(\s[^>]*)?>(.*?)<\/h2>/is', '<h1$1>$2</h1>', $html, 1, $c);
    return $c ? $new : $html;
}

/* ========================= Theme files ========================= */
function seodash_theme_path($rel) {
    $root = get_stylesheet_directory();
    $full = $root . '/' . ltrim((string) $rel, '/');
    $resolved = realpath($full);
    $base = realpath($root);
    if ($resolved !== false) { if (strpos($resolved, $base) !== 0) return null; }
    else { $parent = realpath(dirname($full)); if ($parent === false || strpos($parent, $base) !== 0) return null; }
    $ext = strtolower(pathinfo($full, PATHINFO_EXTENSION));
    if (!in_array($ext, ['php', 'css', 'js', 'html'], true)) return null;
    return $full;
}
function seodash_theme_file_get($r) {
    if (!seodash_theme_files_enabled()) return new WP_Error('disabled', 'theme-file editing is disabled (enable under Settings → SEO Dash Bridge)', ['status' => 403]);
    $p = seodash_theme_path($r->get_param('path'));
    if (!$p || !file_exists($p)) return new WP_Error('not_found', 'file not found / not allowed', ['status' => 404]);
    return ['path' => $r->get_param('path'), 'content' => file_get_contents($p)];
}
function seodash_theme_file_put($r) {
    if (!seodash_theme_files_enabled()) return new WP_Error('disabled', 'theme-file editing is disabled', ['status' => 403]);
    $p = seodash_theme_path($r->get_param('path'));
    if (!$p) return new WP_Error('bad_request', 'invalid path or extension (allowed: php/css/js/html, active theme only)', ['status' => 400]);
    $content = (string) $r->get_param('content');
    if (file_exists($p)) @copy($p, $p . '.seodash-bak');
    $bytes = file_put_contents($p, $content);
    if ($bytes === false) return new WP_Error('io_error', 'write failed (file permissions?)', ['status' => 500]);
    return ['ok' => true, 'bytes' => $bytes, 'backup' => file_exists($p . '.seodash-bak')];
}
