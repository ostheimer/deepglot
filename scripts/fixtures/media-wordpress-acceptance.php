<?php
/** Disposable, page-scoped acceptance guard. Install only on an approved test site. */
if (!defined('ABSPATH')) { exit; }
const DG_MEDIA_ACCEPTANCE_SLUG = 'deepglot-media-acceptance-20260928';
add_filter('pre_http_request', static function ($pre, $args, $url) {
    $request = $_SERVER['REQUEST_URI'] ?? '';
    $body = is_string($args['body'] ?? null) ? json_decode($args['body'], true) : ($args['body'] ?? []);
    $body = is_array($body) ? $body : [];
    $fixture = str_contains($request, DG_MEDIA_ACCEPTANCE_SLUG)
        || str_contains((string) ($body['request_url'] ?? ''), DG_MEDIA_ACCEPTANCE_SLUG)
        || str_contains((string) ($body['url'] ?? ''), DG_MEDIA_ACCEPTANCE_SLUG)
        || str_contains((string) ($body['urlPath'] ?? ''), DG_MEDIA_ACCEPTANCE_SLUG);
    if ($fixture && str_contains($url, 'deepglot.ai/api/') && !str_contains($url, '/plugin/runtime-config')) {
        update_option('deepglot_media_acceptance_blocked_requests', (int) get_option('deepglot_media_acceptance_blocked_requests', 0) + 1, false);
        return new WP_Error('deepglot_fixture_no_paid_calls', 'Disposable acceptance fixture uses preseeded translations only.');
    }
    return $pre;
}, 1, 3);
add_filter('template_include', static function ($template) {
    return is_page(DG_MEDIA_ACCEPTANCE_SLUG) ? __DIR__ . '/deepglot-media-acceptance/template.php' : $template;
}, PHP_INT_MAX);
