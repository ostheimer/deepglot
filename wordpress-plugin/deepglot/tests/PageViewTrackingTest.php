<?php

namespace Deepglot\Api {
    class RestApi
    {
        public const NAMESPACE = 'deepglot/v1';
    }
}

namespace {
    if (!defined('ABSPATH')) {
        define('ABSPATH', __DIR__ . '/');
    }
    if (!defined('DEEPGLOT_PLUGIN_URL')) {
        define('DEEPGLOT_PLUGIN_URL', 'https://example.test/wp-content/plugins/deepglot/');
    }
    if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
        define('DEEPGLOT_PLUGIN_VERSION', 'test');
    }

    $GLOBALS['_deepglot_page_view_options'] = [];
    $GLOBALS['_deepglot_page_view_transients'] = [];
    $GLOBALS['_deepglot_page_view_scripts'] = [];
    $GLOBALS['_deepglot_page_view_localized'] = [];
    $GLOBALS['_deepglot_page_view_http'] = [];
    $GLOBALS['_deepglot_page_view_routes'] = [];

    function __($text, $domain = null): string { return (string) $text; }
    function get_option($key, $default = false) { return $GLOBALS['_deepglot_page_view_options'][$key] ?? $default; }
    function update_option($key, $value): bool { $GLOBALS['_deepglot_page_view_options'][$key] = $value; return true; }
    function get_transient($key) { return $GLOBALS['_deepglot_page_view_transients'][$key] ?? false; }
    function set_transient($key, $value, $ttl = 0): bool { $GLOBALS['_deepglot_page_view_transients'][$key] = $value; return true; }
    function wp_parse_args($args, $defaults = []): array { return array_merge($defaults, is_array($args) ? $args : []); }
    function sanitize_text_field($value): string { return trim((string) $value); }
    function sanitize_textarea_field($value): string { return trim((string) $value); }
    function esc_url_raw($value): string { return (string) $value; }
    function untrailingslashit($value): string { return rtrim((string) $value, '/'); }
    function home_url($path = '/'): string { return 'https://example.test' . ($path === '/' ? '' : $path); }
    function get_site_url(): string { return 'https://example.test'; }
    function rest_url($path = ''): string { return 'https://example.test/wp-json/' . ltrim((string) $path, '/'); }
    function wp_make_link_relative($url): string { return (string) parse_url((string) $url, PHP_URL_PATH); }
    function wp_salt($scheme = 'auth'): string { return 'page-view-test-secret-' . $scheme; }
    function wp_json_encode($value): string { return (string) json_encode($value); }
    function add_action(...$args): bool { return true; }
    function is_wp_error($value): bool { return $value instanceof \WP_Error; }

    function register_rest_route($namespace, $route, $args): bool
    {
        $GLOBALS['_deepglot_page_view_routes'][] = [$namespace, $route, $args];
        return true;
    }

    function wp_register_script(...$args): bool
    {
        $GLOBALS['_deepglot_page_view_scripts'][] = $args;
        return true;
    }

    function wp_enqueue_script(...$args): bool { return true; }

    function wp_localize_script($handle, $name, $data): bool
    {
        $GLOBALS['_deepglot_page_view_localized'][] = [$handle, $name, $data];
        return true;
    }

    function wp_remote_request($url, $args): array
    {
        $GLOBALS['_deepglot_page_view_http'][] = ['url' => $url, 'args' => $args];
        return ['response' => ['code' => 201], 'body' => '{"tracked":true}'];
    }

    function wp_remote_retrieve_response_code($response): int { return (int) ($response['response']['code'] ?? 0); }
    function wp_remote_retrieve_body($response): string { return (string) ($response['body'] ?? ''); }

    class WP_Error
    {
        public function __construct(public string $code = '', public string $message = '', public array $data = []) {}
        public function get_error_data(): array { return $this->data; }
    }

    class WP_REST_Request
    {
        public function __construct(private array $params = [], private array $headers = [], private ?string $body = null) {}

        public function get_param($key) { return $this->params[$key] ?? null; }

        public function get_header($key): string
        {
            foreach ($this->headers as $name => $value) {
                if (strtolower((string) $name) === strtolower((string) $key)) {
                    return (string) $value;
                }
            }

            return '';
        }

        public function get_body(): string
        {
            return $this->body ?? (string) json_encode($this->params);
        }
    }

    class WP_REST_Response
    {
        public function __construct(private mixed $data = null, private int $status = 200) {}
        public function get_data(): mixed { return $this->data; }
        public function get_status(): int { return $this->status; }
    }

    require_once __DIR__ . '/../includes/Config/Options.php';
    require_once __DIR__ . '/../includes/Api/Client.php';
    require_once __DIR__ . '/../includes/Support/BotDetector.php';
    require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
    require_once __DIR__ . '/../includes/Support/SiteRouting.php';
    require_once __DIR__ . '/../includes/Frontend/PageViewController.php';
    require_once __DIR__ . '/../includes/Frontend/PageViewAssets.php';

    use Deepglot\Api\Client;
    use Deepglot\Config\Options;
    use Deepglot\Frontend\PageViewAssets;
    use Deepglot\Frontend\PageViewController;
    use Deepglot\Support\SiteRouting;
    use Deepglot\Support\UrlLanguageResolver;

    function pageViewAssert(bool $condition, string $message): void
    {
        if (!$condition) {
            fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
            exit(1);
        }
    }

    function configurePageViewOptions(array $overrides = []): void
    {
        update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
            'enabled' => true,
            'api_key' => 'dg_live_page_view_secret',
            'source_language' => 'de',
            'target_languages' => ['en', 'fr'],
            'enable_dynamic_translation' => false,
        ], $overrides));
    }

    class PageViewFakeClient extends Client
    {
        public array $events = [];
        public $nextResult = ['tracked' => true];

        public function __construct() {}

        public function recordPageView(string $eventId, string $urlPath, string $langTo)
        {
            $this->events[] = compact('eventId', 'urlPath', 'langTo');
            return $this->nextResult;
        }
    }

    $_SERVER['REQUEST_URI'] = '/en/article/?utm_source=private';
    $_SERVER['HTTP_HOST'] = 'example.test';
    $_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 ExampleBrowser';
    $_SERVER['REMOTE_ADDR'] = '198.51.100.42';

    pageViewAssert(Options::defaults()['page_views_enabled'] === false, 'Page-view tracking must default to disabled.');

    configurePageViewOptions();
    $options = new Options();
    pageViewAssert(!$options->shouldTrackPageViews(), 'Existing installations must stay opted out.');

    $options->applyRuntimeConfig(['pageViewsEnabled' => true]);
    pageViewAssert($options->shouldTrackPageViews(), 'The dashboard runtime opt-in must reach WordPress.');

    $options->applyRuntimeConfig(['exclusions' => ['urls' => [], 'regexes' => [], 'selectors' => []]]);
    pageViewAssert($options->shouldTrackPageViews(), 'Partial runtime payloads must not erase the existing opt-in.');

    $settingsWithoutRuntimeFlag = $options->all();
    unset($settingsWithoutRuntimeFlag['page_views_enabled']);
    $preserved = $options->sanitize($settingsWithoutRuntimeFlag);
    pageViewAssert($preserved['page_views_enabled'] === true, 'Ordinary wp-admin saves must preserve dashboard-controlled opt-in.');

    $settingsWithoutRuntimeFlag['api_key'] = 'dg_live_other_project';
    $changedProject = $options->sanitize($settingsWithoutRuntimeFlag);
    pageViewAssert($changedProject['page_views_enabled'] === false, 'Changing project credentials must immediately clear stale tracking consent.');

    $eventId = 'b15e2761-7879-461e-a23c-1c5ab1abc032';
    $client = new Client($options);
    $recorded = $client->recordPageView($eventId, '/en/article/', 'en');
    pageViewAssert(!is_wp_error($recorded), 'An enabled page-view client request must succeed.');
    $request = $GLOBALS['_deepglot_page_view_http'][0] ?? [];
    pageViewAssert(($request['url'] ?? '') === 'https://deepglot.ai/api/plugin/page-views', 'Page views must use their independent SaaS collector.');
    pageViewAssert(($request['args']['headers']['Authorization'] ?? '') === 'Bearer dg_live_page_view_secret', 'The API key must be sent only in an Authorization header.');
    pageViewAssert(!str_contains((string) ($request['args']['body'] ?? ''), 'dg_live_page_view_secret'), 'The API key must never enter the analytics payload.');
    pageViewAssert(json_decode((string) ($request['args']['body'] ?? ''), true) === [
        'eventId' => $eventId,
        'urlPath' => '/en/article/',
        'langTo' => 'en',
    ], 'Only an event UUID, query-free path and target language may be forwarded.');

    $fakeClient = new PageViewFakeClient();
    $controller = new PageViewController($options, $fakeClient);
    $controller->registerRoutes();
    $route = $GLOBALS['_deepglot_page_view_routes'][0] ?? [];
    pageViewAssert(($route[0] ?? '') === 'deepglot/v1' && ($route[1] ?? '') === '/page-views', 'The dedicated WordPress page-view REST route must be registered.');

    $routing = new SiteRouting(new UrlLanguageResolver('de', ['en', 'fr']), 'https://example.test', 'PATH_PREFIX', []);
    $assets = new PageViewAssets($options, $routing, $controller);
    $assets->enqueue();
    $localized = $GLOBALS['_deepglot_page_view_localized'][0] ?? [];
    $config = $localized[2] ?? [];
    pageViewAssert(($localized[1] ?? '') === 'deepglotPageViews', 'The tracker must receive a dedicated configuration object.');
    pageViewAssert(($config['endpoint'] ?? '') === '/wp-json/deepglot/v1/page-views', 'The browser collector must remain same-origin on mapped domains.');
    pageViewAssert(($config['langTo'] ?? '') === 'en', 'Only translated target-language pages may load tracking.');
    pageViewAssert(($config['urlPath'] ?? '') === '/en/article/', 'A rendered tracking capability must exclude visitor query strings.');
    pageViewAssert(!str_contains((string) json_encode($config), 'dg_live_page_view_secret'), 'Browser configuration must never reveal the project API key.');
    pageViewAssert(!empty($config['ticket']), 'A cache-compatible, signed page capability is required.');

    // RequestRouter strips the language prefix and reverses translated slugs
    // before wp_enqueue_scripts. The signed path must still match the PUBLIC
    // browser pathname, not WordPress's rewritten source-language route.
    $_SERVER['REQUEST_URI'] = '/ueber-uns/?utm_source=private';
    $rewrittenRouter = new class {
        public function getCurrentLanguage(): string { return 'en'; }
        public function getOriginalRequestUri(): string { return '/en/about-us/?email=private@example.test'; }
    };
    (new PageViewAssets($options, $routing, $controller, $rewrittenRouter))->enqueue();
    $rewrittenConfig = $GLOBALS['_deepglot_page_view_localized'][1][2] ?? [];
    pageViewAssert(
        ($rewrittenConfig['urlPath'] ?? '') === '/en/about-us/',
        'The signed analytics path must use RequestRouter::getOriginalRequestUri(), not rewritten REQUEST_URI.'
    );
    $_SERVER['REQUEST_URI'] = '/en/article/?utm_source=private';

    $validParams = ['eventId' => $eventId, 'urlPath' => '/en/article/', 'langTo' => 'en'];
    $validHeaders = [
        'Origin' => 'https://example.test',
        'Referer' => 'https://example.test/',
        PageViewController::TICKET_HEADER => $config['ticket'],
    ];
    $validRequest = new WP_REST_Request($validParams, $validHeaders);
    pageViewAssert($controller->permissionCheck($validRequest) === true, 'A same-origin human request with active consent must be allowed.');
    $response = $controller->handle($validRequest);
    pageViewAssert($response->get_status() === 201, 'A genuine tracked page view must be accepted.');
    pageViewAssert($fakeClient->events === [$validParams], 'An accepted event must be forwarded independently of dynamic translation.');
    $rateLimitKeys = array_keys($GLOBALS['_deepglot_page_view_transients']);
    pageViewAssert(count($rateLimitKeys) === 1, 'A site/project-wide safety bucket should be transient and bounded.');
    pageViewAssert(
        !str_contains($rateLimitKeys[0], hash('sha256', '198.51.100.42')),
        'Analytics rate limiting must never persist a reversible hash of the visitor IP address.'
    );
    pageViewAssert(
        !str_contains((string) json_encode($GLOBALS['_deepglot_page_view_transients']), '198.51.100.42'),
        'Raw visitor IP addresses must never enter transient analytics state.'
    );
    $controllerSource = file_get_contents(__DIR__ . '/../includes/Frontend/PageViewController.php');
    pageViewAssert(
        is_string($controllerSource) && !str_contains($controllerSource, "RequestInput::server('REMOTE_ADDR'"),
        'Anonymous page-view collection must not inspect or derive identifiers from visitor IP addresses.'
    );

    $crossOrigin = new WP_REST_Request($validParams, ['Origin' => 'https://evil.test'] + $validHeaders);
    pageViewAssert(is_wp_error($controller->permissionCheck($crossOrigin)), 'Cross-origin analytics injection must be rejected.');

    $_SERVER['HTTP_HOST'] = 'evil.test';
    $spoofedTicket = $controller->issueTrackingTicket('/en/article/', 'en');
    pageViewAssert(
        $spoofedTicket === '',
        'An unconfigured attacker-controlled Host header must never receive a signed page-view ticket.'
    );
    $spoofedHostRequest = new WP_REST_Request($validParams, [
        'Origin' => 'https://evil.test',
        'Referer' => 'https://evil.test/',
        PageViewController::TICKET_HEADER => $spoofedTicket,
    ]);
    pageViewAssert(
        is_wp_error($controller->permissionCheck($spoofedHostRequest)),
        'An attacker-controlled Host header must never authorize its own Origin or tracking ticket.'
    );
    $_SERVER['HTTP_HOST'] = 'example.test';

    $mappedSettings = $options->all();
    $mappedSettings['domain_mappings'] = ['en' => 'en.example.test'];
    update_option(Options::OPTION_KEY, $mappedSettings);

    $_SERVER['HTTP_HOST'] = 'en.example.test';
    $mappedTicket = $controller->issueTrackingTicket('/about-us/', 'en');
    pageViewAssert($mappedTicket !== '', 'An explicitly configured translated-domain host must receive a valid ticket.');
    $mappedRequest = new WP_REST_Request([
        'eventId' => '2fd4f45a-b9bb-45ef-8dd4-655c1cf439a5',
        'urlPath' => '/about-us/',
        'langTo' => 'en',
    ], [
        'Origin' => 'https://en.example.test',
        'Referer' => 'https://en.example.test/',
        PageViewController::TICKET_HEADER => $mappedTicket,
    ]);
    pageViewAssert($controller->permissionCheck($mappedRequest) === true, 'An explicitly configured translated domain must remain a trusted same-origin host.');
    pageViewAssert($controller->handle($mappedRequest)->get_status() === 201, 'A valid translated-domain ticket must support genuine page-view forwarding.');

    $crossTrustedHostRequest = new WP_REST_Request($validParams, [
        'Origin' => 'https://example.test',
        'Referer' => 'https://example.test/',
        PageViewController::TICKET_HEADER => $mappedTicket,
    ]);
    pageViewAssert(
        is_wp_error($controller->permissionCheck($crossTrustedHostRequest)),
        'A different configured project host is not same-origin with the current translated-domain request.'
    );
    $_SERVER['HTTP_HOST'] = 'example.test';

    $missingOrigin = new WP_REST_Request($validParams, [PageViewController::TICKET_HEADER => $config['ticket']]);
    pageViewAssert(is_wp_error($controller->permissionCheck($missingOrigin)), 'Requests without same-origin provenance must fail closed.');

    $_SERVER['HTTP_USER_AGENT'] = 'Googlebot/2.1';
    pageViewAssert(is_wp_error($controller->permissionCheck($validRequest)), 'Known crawlers must never become real visitor page views.');
    $_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 ExampleBrowser';

    foreach ([
        ['eventId' => 'not-a-uuid'],
        ['eventId' => 'b15e2761-7879-161e-a23c-1c5ab1abc032'],
        ['urlPath' => '/en/article/?email=private@example.test'],
        ['urlPath' => '/en/other/'],
        ['urlPath' => str_repeat('/x', 1025)],
        ['langTo' => 'de'],
        ['langTo' => 'es'],
    ] as $overrides) {
        $invalid = new WP_REST_Request(array_merge($validParams, $overrides), $validHeaders);
        $rejected = $controller->handle($invalid);
        pageViewAssert($rejected->get_status() === 400 || $rejected->get_status() === 403, 'Invalid UUID, URL, language or signed scope must be rejected.');
    }
    pageViewAssert(count($fakeClient->events) === 2, 'Rejected events must never reach the SaaS collector.');

    $tamperedTicket = new WP_REST_Request($validParams, array_merge($validHeaders, [PageViewController::TICKET_HEADER => '0.' . str_repeat('a', 64)]));
    pageViewAssert($controller->handle($tamperedTicket)->get_status() === 403, 'Forged or expired page capabilities must fail closed.');

    $oversizedBody = new WP_REST_Request($validParams, $validHeaders, str_repeat('x', 4097));
    pageViewAssert($controller->handle($oversizedBody)->get_status() === 413, 'Oversized analytics requests must be rejected before forwarding.');

    $fakeClient->nextResult = ['tracked' => false, 'reason' => 'duplicate'];
    $duplicate = new WP_REST_Request([
        'eventId' => '5f89fca6-3b5e-4a8a-9a84-8ea31ad0837f',
        'urlPath' => '/en/article/',
        'langTo' => 'en',
    ], $validHeaders);
    pageViewAssert($controller->handle($duplicate)->get_status() === 200, 'Backend-deduplicated event identifiers must not count as new views.');

    $fakeClient->nextResult = ['tracked' => false, 'reason' => 'disabled'];
    $ignored = $controller->handle($duplicate);
    pageViewAssert(
        $ignored->get_status() === 200 && ($ignored->get_data()['tracked'] ?? true) === false,
        'A newly opted-out SaaS project must never be reported as a tracked page view during stale runtime sync.'
    );

    $options->applyRuntimeConfig(['pageViewsEnabled' => false]);
    pageViewAssert(!$options->shouldTrackPageViews(), 'Dashboard deactivation must stop tracking immediately after runtime refresh.');
    pageViewAssert(is_wp_error($controller->permissionCheck($validRequest)), 'Opted-out projects must reject old cached page trackers.');
    $beforeScripts = count($GLOBALS['_deepglot_page_view_scripts']);
    $assets->enqueue();
    pageViewAssert(count($GLOBALS['_deepglot_page_view_scripts']) === $beforeScripts, 'Disabled projects must not emit a tracker asset.');

    $disabledResult = $client->recordPageView($eventId, '/en/article/', 'en');
    pageViewAssert(is_wp_error($disabledResult), 'The SaaS client must fail closed after consent is withdrawn.');
    pageViewAssert(count($GLOBALS['_deepglot_page_view_http']) === 1, 'Disabled tracking must not initiate external requests.');

    fwrite(STDOUT, "PageViewTrackingTest: OK\n");
}
