<?php

declare(strict_types=1);

namespace Deepglot\Support {
    final class TranslationCache
    {
        public function setMany(array $translations, string $from, string $to): array
        {
            foreach ($translations as $source => $target) {
                \set_transient('dgv1_' . sha1($from . '|' . $to . '|' . $source), 'fixture:' . $target, 2592000);
            }
            return array_fill_keys(array_keys($translations), true);
        }
    }
}

namespace Deepglot\Config {
    final class Options {
        public function getSourceLanguage(): string { return 'de'; }
        public function getTargetLanguages(): array { return ['en']; }
    }
}
namespace Deepglot\Api { final class Client { public function __construct($options) {} } }
namespace Deepglot\Sync {
    final class SettingsSync {
        public function __construct($options, $client) {}
        public function refreshRuntimeConfig(...$arguments): array { return ['ok' => true, 'skipped' => $GLOBALS['mode'] === 'sync-skipped']; }
    }
}
namespace {
    if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
    define('WP_CLI', true);
    final class WP_Error {
        public function __construct(private string $code, private string $message) {}
        public function get_error_message(): string { return $this->message; }
    }
    function is_wp_error($value): bool { return $value instanceof WP_Error; }
    function add_filter($hook, $callback, ...$args): void { $GLOBALS['filters'][$hook] = $callback; }
    function wp_using_ext_object_cache(): bool { return false; }
    function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
    function add_option($key, $value, ...$args): bool { if (isset($GLOBALS['options'][$key])) return false; $GLOBALS['options'][$key] = $value; return true; }
    function update_option($key, $value, ...$args): bool { $GLOBALS['options'][$key] = $value; return true; }
    function delete_option($key): bool { unset($GLOBALS['options'][$key]); return true; }
    function get_transient($key) { return $GLOBALS['transients'][$key] ?? false; }
    function set_transient($key, $value, $ttl): bool { $GLOBALS['transients'][$key] = $value; return true; }
    function delete_transient($key): bool { unset($GLOBALS['transients'][$key]); return true; }
    function get_page_by_path($slug) { return $GLOBALS['fixturePost']; }
    function get_post_meta($id, $key, $single) { return $GLOBALS['fixtureOwned']; }
    function update_post_meta($id, $key, $value) { if ($GLOBALS['mode'] === 'metadata-error') return false; $GLOBALS['fixtureOwned'] = $value; return true; }
    function wp_insert_post($data, $error) { if ($GLOBALS['mode'] === 'insert-error') return new WP_Error('fixture_insert_error', 'simulated insert failure'); $GLOBALS['fixturePost'] = (object) ['ID' => 42]; return 42; }
    function wp_delete_post($id, $force) { if ($GLOBALS['mode'] === 'cleanup-delete-error') return false; if ($GLOBALS['mode'] === 'cleanup-delete-stale') return true; $GLOBALS['fixturePost'] = null; return true; }
    function get_permalink($id): string { return 'https://stage.example/deepglot-media-acceptance-20260928/'; }
    function verify(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }

    $root = dirname(__DIR__, 3);
    $case = $argv[2] ?? '';
    $GLOBALS['options'] = $GLOBALS['transients'] = $GLOBALS['filters'] = [];
    $GLOBALS['fixturePost'] = null;
    $GLOBALS['fixtureOwned'] = false;
    $GLOBALS['mode'] = $case;

    if ($case === 'page-views') {
        require $root . '/scripts/fixtures/media-wordpress-acceptance.php';
        $_SERVER['REQUEST_URI'] = '/wp-json/deepglot/v1/page-views';
        $guard = $GLOBALS['filters']['pre_http_request'];
        $result = $guard(false, ['body' => json_encode(['urlPath' => '/en/deepglot-media-acceptance-20260928/'])], 'https://deepglot.ai/api/plugin/page-views');
        verify(is_wp_error($result), 'Fixture analytics urlPath must be intercepted at the bridge.');
        verify(get_option('deepglot_media_acceptance_blocked_requests') === 1, 'Analytics guard must count the blocked fixture request.');
        verify($guard(false, ['body' => json_encode(['urlPath' => '/en/existing-page/'])], 'https://deepglot.ai/api/plugin/page-views') === false, 'Ordinary views must remain untouched.');
    } elseif ($case === 'cleanup-unrelated') {
        $GLOBALS['fixturePost'] = (object) ['ID' => 42];
        $GLOBALS['fixtureOwned'] = true;
        $existing = ['en' => ['/uploads/existing.jpg' => '/uploads/existing-en.jpg']];
        $GLOBALS['options']['deepglot_media_replacements'] = $existing;
        $GLOBALS['options']['deepglot_media_acceptance_cache_snapshot'] = ['prior' => ['value' => 'prior-value', 'expires' => time() + 600]];
        ob_start(); require $root . '/scripts/fixtures/media-wordpress/cleanup.php'; ob_end_clean();
        verify($GLOBALS['fixturePost'] === null, 'Cleanup must remove only the owned page beside unrelated mappings.');
        verify(get_option('deepglot_media_replacements') === $existing, 'Unrelated mappings must remain unchanged.');
        verify(get_transient('prior') === 'prior-value', 'Cleanup must restore the transient snapshot.');
    } elseif ($case === 'cleanup-delete-error') {
        foreach (['cleanup-delete-error', 'cleanup-delete-stale'] as $failureMode) {
        $GLOBALS['mode'] = $failureMode;
        $GLOBALS['fixturePost'] = (object) ['ID' => 42];
        $GLOBALS['fixtureOwned'] = true;
        $snapshot = ['prior' => ['value' => 'prior-value', 'expires' => time() + 600]];
        $GLOBALS['options']['deepglot_media_acceptance_cache_snapshot'] = $snapshot;
        $threw = false;
        ob_start();
        try { require $root . '/scripts/fixtures/media-wordpress/cleanup.php'; } catch (RuntimeException $e) { $threw = true; }
        ob_end_clean();
        verify($threw, 'Failed page deletion must fail cleanup.');
        verify($GLOBALS['fixturePost'] !== null, 'Failed page deletion must retain the page.');
        verify(get_option('deepglot_media_acceptance_cache_snapshot') === $snapshot, 'Failed page deletion must retain snapshot for retry.');
        $GLOBALS['mode'] = 'cleanup-retry';
        ob_start(); require $root . '/scripts/fixtures/media-wordpress/cleanup.php'; ob_end_clean();
        verify($GLOBALS['fixturePost'] === null, 'Retry must delete the owned page.');
        verify(get_option('deepglot_media_acceptance_cache_snapshot', null) === null, 'Successful retry must clear snapshot.');
        }
    } elseif ($case === 'cleanup-count') {
        $GLOBALS['fixturePost'] = (object) ['ID' => 42];
        $GLOBALS['fixtureOwned'] = true;
        $media = ['en' => [], 'fr' => []];
        for ($i = 0; $i < 10; $i++) $media['en']['/uploads/file-' . $i . '.png'] = '/uploads/en-' . $i . '.png';
        $media['fr'] = ['/uploads/a.png' => '/uploads/fr-a.png', '/uploads/b.png' => '/uploads/fr-b.png'];
        $GLOBALS['options']['deepglot_media_replacements'] = $media;
        $GLOBALS['options']['deepglot_media_acceptance_cache_snapshot'] = [];
        ob_start(); require $root . '/scripts/fixtures/media-wordpress/cleanup.php'; $output = ob_get_clean();
        // purge.php can print a separate JSON record before cleanup's final record.
        preg_match('/\{"deletedOwnPage".*\}$/s', $output, $match);
        $result = json_decode($match[0] ?? '', true);
        verify(($result['remainingMediaCount'] ?? null) === 12, 'Cleanup must count mappings across language buckets.');
        verify(get_option('deepglot_media_replacements') === $media, 'Counting must leave unrelated mappings unchanged.');
    } elseif ($case === 'sync-skipped') {
        $output = [];
        exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --case sync-skipped-child 2>&1', $output, $status);
        verify($status !== 0, 'Skipped runtime refresh must exit nonzero for operator retry.');
        $output = [];
        exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --case sync-success-child 2>&1', $output, $status);
        verify($status === 0, 'Normal runtime refresh must exit successfully.');
        $result = json_decode(implode('\n', $output), true);
        verify(is_array($result) && isset($result['media']) && $result['source'] === 'de', 'Normal sync must report its runtime state.');
    } elseif (in_array($case, ['sync-skipped-child', 'sync-success-child'], true)) {
        $GLOBALS['mode'] = $case === 'sync-skipped-child' ? 'sync-skipped' : 'sync-success';
        require $root . '/scripts/fixtures/media-wordpress/sync.php';
    } elseif ($case === 'absolute-origin') {
        $html = file_get_contents($root . '/docs/acceptance/media-wordpress-2026-09-28/mapped-en-hit.html');
        foreach (['https://attacker.example', 'http://juvenisstage.wpengine.com'] as $origin) {
            foreach ([
                '/(<img id="responsive" src=")[^"]*("[^>]*>)/' => 'en.png',
                '/("image":")[^"]*(")/' => 'de.png',
            ] as $pattern => $asset) {
            $htmlWithWrongOrigin = preg_replace($pattern, '$1' . $origin . '/wp-content/uploads/deepglot-media-acceptance-20260928/' . $asset . '$2', $html, -1, $changed);
            verify($changed === 1, 'Expected one fixture image URL for ' . $pattern);
            $temporary = tempnam(sys_get_temp_dir(), 'dg-media-origin-');
            try {
                file_put_contents($temporary, $htmlWithWrongOrigin);
                $output = [];
                exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($root . '/scripts/fixtures/media-wordpress-assert.php') . ' ' . escapeshellarg($temporary) . ' en en 2>&1', $output, $status);
                verify($status !== 0, 'Verifier must reject incorrect absolute fixture origin ' . $origin);
            } finally { unlink($temporary); }
            }
        }
        foreach (['https://approved.example.test:8443', 'http://approved.example.test:8080', 'ftp://approved.example.test', 'https://user:password@approved.example.test', 'https://approved.example.test/path', 'https://approved.example.test?query=1', 'https://approved.example.test#fragment'] as $origin) {
            $temporary = tempnam(sys_get_temp_dir(), 'dg-media-approved-origin-');
            try {
                file_put_contents($temporary, str_replace('https://juvenisstage.wpengine.com', $origin, $html));
                $output = [];
                exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($root . '/scripts/fixtures/media-wordpress-assert.php') . ' ' . escapeshellarg($temporary) . ' en en ' . escapeshellarg($origin) . ' 2>&1', $output, $status);
                $approved = in_array($origin, ['https://approved.example.test:8443', 'http://approved.example.test:8080'], true);
                verify($approved ? $status === 0 : $status !== 0, 'Verifier must accept only valid explicitly supplied site origins: ' . $origin);
            } finally { unlink($temporary); }
        }
    } elseif ($case === 'cleanup-owned') {
        foreach ([
            ['/wp-content/uploads/deepglot-media-acceptance-20260928/de.png', '/uploads/replacement.png'],
            ['/uploads/existing.png', 'https://stage.example/wp-content/uploads/deepglot-media-acceptance-20260928/en.png'],
            ['https://www.youtube.com/embed/DgMediaDE01', 'https://www.youtube.com/embed/DgMediaEN01'],
            ['https://player.vimeo.com/video/98765432101', 'https://player.vimeo.com/video/98765432102'],
        ] as [$original, $localized]) {
            $GLOBALS['fixturePost'] = (object) ['ID' => 42];
            $GLOBALS['fixtureOwned'] = true;
            $existing = ['en' => [$original => $localized]];
            $snapshot = ['prior' => ['value' => 'prior-value', 'expires' => time() + 600]];
            $GLOBALS['options']['deepglot_media_replacements'] = $existing;
            $GLOBALS['options']['deepglot_media_acceptance_cache_snapshot'] = $snapshot;
            $threw = false;
            ob_start();
            try { require $root . '/scripts/fixtures/media-wordpress/cleanup.php'; } catch (RuntimeException $e) { $threw = true; }
            ob_end_clean();
            verify($threw, 'Cleanup must reject remaining file or synthetic embed fixture mappings.');
            verify($GLOBALS['fixturePost'] !== null, 'Blocked cleanup must retain the owned page.');
            verify(get_option('deepglot_media_replacements') === $existing, 'Blocked cleanup must retain mappings.');
            verify(get_option('deepglot_media_acceptance_cache_snapshot') === $snapshot, 'Blocked cleanup must retain its snapshot.');
        }
    } elseif (in_array($case, ['insert-error', 'metadata-error'], true)) {
        $priorKey = 'dgv1_' . sha1('de|en|Medienprüfung');
        $GLOBALS['transients'][$priorKey] = 'existing-cache-value';
        $initial = $GLOBALS['transients'];
        $GLOBALS['options']['_transient_timeout_' . $priorKey] = time() + 600;
        $threw = false;
        ob_start();
        try { require $root . '/scripts/fixtures/media-wordpress/setup.php'; } catch (RuntimeException $e) { $threw = true; }
        ob_end_clean();
        verify($threw, 'Failed page or ownership metadata setup must throw.');
        verify($GLOBALS['fixturePost'] === null, 'Failed setup must remove any partial fixture page.');
        verify($GLOBALS['transients'] === $initial, 'Failed setup must restore old transients and remove new seeds.');
        verify(get_option('deepglot_media_acceptance_cache_snapshot', null) === null, 'Failed setup must remove its snapshot option.');
    } elseif ($case === 'visible-copy') {
        foreach (['//body//h1', '//body//h2', '//body//p', '//body//a'] as $selector) {
            $document = new DOMDocument();
            libxml_use_internal_errors(true);
            $document->loadHTML(file_get_contents($root . '/docs/acceptance/media-wordpress-2026-09-28/mapped-en-hit.html'));
            libxml_clear_errors();
            $xpath = new DOMXPath($document);
            foreach ($xpath->query($selector) as $node) $node->nodeValue = 'Unübersetzte Testkopie';
            $temporary = tempnam(sys_get_temp_dir(), 'dg-media-visible-copy-');
            try {
                file_put_contents($temporary, $document->saveHTML());
                $output = [];
                exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($root . '/scripts/fixtures/media-wordpress-assert.php') . ' ' . escapeshellarg($temporary) . ' en en 2>&1', $output, $status);
                verify($status !== 0, 'Verifier must reject untranslated visible copy in ' . $selector . ' despite valid SEO/alt/media.');
            } finally { unlink($temporary); }
        }
    } elseif ($case === 'prefixed-copy') {
        foreach (['de' => 'mapped-de.html', 'en' => 'mapped-en-hit.html'] as $lang => $capture) {
            $html = file_get_contents($root . '/docs/acceptance/media-wordpress-2026-09-28/' . $capture);
            // Preserve raw JSON-LD bytes: DOM reserialization can escape its
            // German Unicode text into HTML entities inside the script.
            $html = preg_replace('/<h2>([^<]*)<\/h2>/', '<h2>Deepglot fixture: $1</h2>', $html, -1, $headingCount);
            verify($headingCount === 4, 'Expected four historical fixture headings.');
            $temporary = tempnam(sys_get_temp_dir(), 'dg-media-prefixed-copy-');
            try {
                file_put_contents($temporary, $html);
                $output = [];
                exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($root . '/scripts/fixtures/media-wordpress-assert.php') . ' ' . escapeshellarg($temporary) . ' ' . $lang . ' ' . $lang . ' 2>&1', $output, $status);
                verify($status === 0, 'Verifier must accept the fully translated prefixed heading format for ' . $lang . ': ' . implode('\n', $output));
            } finally { unlink($temporary); }
        }
    } elseif ($case === '') {
        $failures = 0;
        foreach (['page-views', 'cleanup-unrelated', 'cleanup-owned', 'visible-copy', 'prefixed-copy', 'insert-error', 'metadata-error', 'cleanup-delete-error', 'cleanup-count', 'sync-skipped', 'absolute-origin'] as $scenario) {
            passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --case ' . escapeshellarg($scenario), $status);
            if ($status !== 0) $failures++;
        }
        if ($failures) { fwrite(STDERR, "$failures fixture regressions failed.\n"); exit(1); }
        echo "OK: acceptance fixture isolation, cleanup, visible text, setup rollback.\n";
    } else { throw new RuntimeException('Unknown fixture regression case.'); }
}
