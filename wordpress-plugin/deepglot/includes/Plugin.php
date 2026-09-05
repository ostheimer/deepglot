<?php

namespace Deepglot;

use Deepglot\Admin\NavMenuMetaBox;
use Deepglot\Admin\SettingsPage;
use Deepglot\Api\Client;
use Deepglot\Api\RestApi;
use Deepglot\Config\Options;
use Deepglot\Frontend\AvadaLiveSearchCompat;
use Deepglot\Frontend\BrowserRedirector;
use Deepglot\Frontend\DynamicAssets;
use Deepglot\Frontend\DynamicTranslationController;
use Deepglot\Frontend\DynamicUrlLocalizer;
use Deepglot\Frontend\HreflangInjector;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Frontend\JsonLdTranslator;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Frontend\LinkRewriter;
use Deepglot\Frontend\MultilingualSitemap;
use Deepglot\Frontend\NavMenuSwitcher;
use Deepglot\Frontend\OutputBuffer;
use Deepglot\Frontend\PageViewAssets;
use Deepglot\Frontend\PageViewController;
use Deepglot\Frontend\SwitcherBlock;
use Deepglot\Frontend\SwitcherWidget;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Frontend\WooCommerceEmailTranslator;
use Deepglot\Frontend\WpRocketCompat;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\RequestInput;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\TranslationWarmer;
use Deepglot\Support\UrlLanguageResolver;
use Deepglot\Support\UrlTranslationSync;
use Deepglot\Support\WordPressInfrastructure;
use Deepglot\Sync\SettingsSync;

class Plugin
{
    private Container $container;

    public function __construct()
    {
        $this->container = new Container();
        $this->registerServices();
    }

    public function register(): void
    {
        add_action('init', [$this, 'loadTextDomain']);

        // Redirect to settings page on first activation.
        add_action('admin_init', [$this, 'maybeRedirectAfterActivation']);

        // Flush rewrite rules once after activation.
        add_action('deepglot_flush_rewrite_rules', 'flush_rewrite_rules');

        $this->container->get(SettingsPage::class)->register();
        $this->container->get(NavMenuMetaBox::class)->register();
        $this->container->get(RestApi::class)->register();
        $this->container->get(SettingsSync::class)->register();
        $this->container->get(TranslationWarmer::class)->register();
        $this->container->get(UrlTranslationSync::class)->register();
        add_action('plugins_loaded', [$this, 'refreshRuntimeRouting'], 0);
        $this->container->get(RequestRouter::class)->register();
        $this->container->get(AvadaLiveSearchCompat::class)->register();
        $this->container->get(BrowserRedirector::class)->register();
        $this->container->get(MultilingualSitemap::class)->register();
        $this->container->get(OutputBuffer::class)->register();
        $this->container->get(DynamicTranslationController::class)->register();
        $this->container->get(DynamicAssets::class)->register();
        $this->container->get(PageViewController::class)->register();
        $this->container->get(PageViewAssets::class)->register();
        $this->container->get(WpRocketCompat::class)->register();
        $this->container->get(LanguageSwitcher::class)->register();
        $this->container->get(NavMenuSwitcher::class)->register();
        $this->container->get(SwitcherBlock::class)->register();

        // Classic Widget: bind the LanguageSwitcher before WP calls our
        // register_widget() callback so the widget's render path has
        // the dependency it needs (WP instantiates WP_Widget subclasses
        // itself, with no constructor args).
        SwitcherWidget::bind($this->container->get(LanguageSwitcher::class));
        SwitcherWidget::register();
        $this->container->get(WooCommerceEmailTranslator::class)->register();
    }

    /**
     * Refresh frontend routing before RequestRouter inspects REQUEST_URI.
     *
     * Runtime configuration is irrelevant to admin, AJAX, cron, REST, CLI and
     * core infrastructure bootstraps. Avoiding those request types also
     * prevents an unavailable SaaS endpoint from delaying unrelated WordPress
     * operations.
     */
    public function refreshRuntimeRouting(): void
    {
        if (
            is_admin()
            || wp_doing_ajax()
            || wp_doing_cron()
            || $this->isWordPressInfrastructureRequest()
        ) {
            return;
        }

        $options = $this->container->get(Options::class);
        if (!$options->isEnabled() || !$options->isConfigured()) {
            return;
        }

        $this->container->get(SettingsSync::class)->maybeRefreshRuntimeConfig();
        $this->container->get(UrlLanguageResolver::class)->replaceLanguages(
            $options->getSourceLanguage(),
            $options->getTargetLanguages()
        );
        $this->container->get(SiteRouting::class)->replaceUrlSlugMappings(
            $options->getUrlSlugMappings()
        );
    }

    /**
     * Redirects the user to the Deepglot settings page the first time the
     * plugin is activated (one-shot via a transient set in ::activate()).
     */
    public function maybeRedirectAfterActivation(): void
    {
        if (!get_transient('deepglot_just_activated')) {
            return;
        }

        delete_transient('deepglot_just_activated');

        // Skip redirect during bulk plugin activations.
        if (RequestInput::hasQuery('activate-multi')) {
            return;
        }

        wp_safe_redirect(admin_url('options-general.php?page=deepglot'));
        exit;
    }

    public function loadTextDomain(): void
    {
        // phpcs:ignore PluginCheck.CodeAnalysis.DiscouragedFunctions.load_plugin_textdomainFound -- GitHub release installs ship bundled translations outside the WordPress.org language-pack path.
        load_plugin_textdomain('deepglot', false, dirname(plugin_basename(DEEPGLOT_PLUGIN_FILE)) . '/languages');
    }

    public static function activate(): void
    {
        if (!get_option(Options::OPTION_KEY)) {
            add_option(Options::OPTION_KEY, Options::defaults());
        }

        // Mark that the plugin was just activated so we can redirect on next admin load.
        set_transient('deepglot_just_activated', true, 30);

        // Schedule a one-time flush of rewrite rules.
        add_action('shutdown', 'flush_rewrite_rules');
    }

    public function client(): Client
    {
        return $this->container->get(Client::class);
    }

    private function isWordPressInfrastructureRequest(): bool
    {
        if (
            (defined('WP_CLI') && WP_CLI)
            || (defined('REST_REQUEST') && REST_REQUEST)
            || (function_exists('wp_is_json_request') && wp_is_json_request())
            || RequestInput::hasQuery('rest_route')
        ) {
            return true;
        }

        $requestPath = (string) wp_parse_url(
            RequestInput::server('REQUEST_URI'),
            PHP_URL_PATH
        );
        $restPrefix = function_exists('rest_get_url_prefix')
            ? trim((string) rest_get_url_prefix(), '/')
            : 'wp-json';

        if (
            $restPrefix !== ''
            && preg_match('#(?:^|/)' . preg_quote($restPrefix, '#') . '(?:/|$)#i', $requestPath) === 1
        ) {
            return true;
        }

        $segments = array_values(array_filter(
            explode('/', trim($requestPath, '/')),
            static fn (string $segment): bool => $segment !== ''
        ));

        foreach ($segments as $index => $segment) {
            if (
                WordPressInfrastructure::isFrontControllerSegment($segment)
                && isset($segments[$index + 1])
            ) {
                continue;
            }

            if (WordPressInfrastructure::isReservedSlugSegment($segment)) {
                return true;
            }
        }

        return false;
    }

    // -------------------------------------------------------------------------
    // Service registration
    // -------------------------------------------------------------------------

    private function registerServices(): void
    {
        $this->container->singleton(Options::class, static function () {
            return new Options();
        });

        $this->container->singleton(UrlLanguageResolver::class, function (Container $c) {
            $opts = $c->get(Options::class);
            return new UrlLanguageResolver($opts->getSourceLanguage(), $opts->getTargetLanguages());
        });

        $this->container->singleton(Client::class, function (Container $c) {
            return new Client($c->get(Options::class));
        });

        $this->container->singleton(SettingsSync::class, function (Container $c) {
            return new SettingsSync(
                $c->get(Options::class),
                $c->get(Client::class),
                $c->get(TranslationWarmer::class)
            );
        });

        $this->container->singleton(SiteRouting::class, function (Container $c) {
            $options = $c->get(Options::class);

            return new SiteRouting(
                $c->get(UrlLanguageResolver::class),
                get_site_url(),
                $options->getRoutingMode(),
                $options->getDomainMappings(),
                $options->getUrlSlugMappings()
            );
        });

        $this->container->singleton(TranslationCache::class, static function () {
            return new TranslationCache();
        });

        $this->container->singleton(TranslationWarmer::class, function (Container $c) {
            return new TranslationWarmer(
                $c->get(Client::class),
                $c->get(Options::class),
                $c->get(TranslationCache::class)
            );
        });

        $this->container->singleton(UrlTranslationSync::class, function (Container $c) {
            return new UrlTranslationSync(
                $c->get(Options::class),
                $c->get(SiteRouting::class),
                $c->get(MultilingualSitemap::class),
                $c->get(TranslationWarmer::class)
            );
        });

        $this->container->singleton(HtmlTranslator::class, function (Container $c) {
            return new HtmlTranslator(
                $c->get(Client::class),
                $c->get(Options::class),
                $c->get(TranslationCache::class),
                new JsonLdTranslator($c->get(SiteRouting::class)),
                $c->get(TranslationWarmer::class)
            );
        });

        $this->container->singleton(RequestRouter::class, function (Container $c) {
            return new RequestRouter($c->get(Options::class), $c->get(SiteRouting::class));
        });

        $this->container->singleton(AvadaLiveSearchCompat::class, function (Container $c) {
            return new AvadaLiveSearchCompat(
                $c->get(Options::class),
                $c->get(RequestRouter::class)
            );
        });

        $this->container->singleton(LinkRewriter::class, function (Container $c) {
            return new LinkRewriter($c->get(SiteRouting::class));
        });

        $this->container->singleton(HreflangInjector::class, function (Container $c) {
            return new HreflangInjector($c->get(Options::class), $c->get(SiteRouting::class));
        });

        $this->container->singleton(MultilingualSitemap::class, function (Container $c) {
            return new MultilingualSitemap(
                $c->get(Options::class),
                $c->get(SiteRouting::class)
            );
        });

        $this->container->singleton(OutputBuffer::class, function (Container $c) {
            return new OutputBuffer(
                $c->get(Options::class),
                $c->get(UrlLanguageResolver::class),
                $c->get(HtmlTranslator::class),
                $c->get(LinkRewriter::class),
                $c->get(HreflangInjector::class),
                $c->get(RequestRouter::class),
                $c->get(SiteRouting::class),
                $c->get(UrlTranslationSync::class)
            );
        });

        $this->container->singleton(DynamicTranslationController::class, function (Container $c) {
            return new DynamicTranslationController(
                $c->get(Options::class),
                $c->get(Client::class),
                $c->get(TranslationCache::class),
                $c->get(DynamicUrlLocalizer::class)
            );
        });

        $this->container->singleton(DynamicUrlLocalizer::class, function (Container $c) {
            return new DynamicUrlLocalizer($c->get(SiteRouting::class));
        });

        $this->container->singleton(DynamicAssets::class, function (Container $c) {
            return new DynamicAssets(
                $c->get(Options::class),
                $c->get(SiteRouting::class),
                $c->get(RequestRouter::class)
            );
        });

        $this->container->singleton(PageViewController::class, function (Container $c) {
            return new PageViewController(
                $c->get(Options::class),
                $c->get(Client::class)
            );
        });

        $this->container->singleton(PageViewAssets::class, function (Container $c) {
            return new PageViewAssets(
                $c->get(Options::class),
                $c->get(SiteRouting::class),
                $c->get(PageViewController::class),
                $c->get(RequestRouter::class)
            );
        });

        $this->container->singleton(LanguageSwitcher::class, function (Container $c) {
            return new LanguageSwitcher(
                $c->get(Options::class),
                $c->get(SiteRouting::class),
                $c->get(RequestRouter::class)
            );
        });

        $this->container->singleton(WpRocketCompat::class, static function () {
            return new WpRocketCompat();
        });

        $this->container->singleton(NavMenuSwitcher::class, function (Container $c) {
            return new NavMenuSwitcher(
                $c->get(Options::class),
                $c->get(SiteRouting::class),
                $c->get(RequestRouter::class)
            );
        });

        $this->container->singleton(NavMenuMetaBox::class, static function () {
            return new NavMenuMetaBox();
        });

        $this->container->singleton(SwitcherBlock::class, function (Container $c) {
            return new SwitcherBlock($c->get(LanguageSwitcher::class));
        });

        $this->container->singleton(BrowserRedirector::class, function (Container $c) {
            return new BrowserRedirector(
                $c->get(SiteRouting::class),
                'deepglot_preferred_language',
                $c->get(Options::class)
            );
        });

        $this->container->singleton(WooCommerceEmailTranslator::class, function (Container $c) {
            return new WooCommerceEmailTranslator(
                $c->get(Options::class),
                $c->get(SiteRouting::class),
                $c->get(Client::class),
                $c->get(HtmlTranslator::class)
            );
        });

        $this->container->singleton(SettingsPage::class, function (Container $c) {
            return new SettingsPage(
                $c->get(Options::class),
                $c->get(UrlTranslationSync::class)
            );
        });

        $this->container->singleton(RestApi::class, function (Container $c) {
            return new RestApi(
                $c->get(Options::class),
                $c->get(SettingsSync::class),
                $c->get(UrlTranslationSync::class)
            );
        });
    }
}
