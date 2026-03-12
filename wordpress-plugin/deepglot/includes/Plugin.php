<?php

namespace Deepglot;

use Deepglot\Admin\SettingsPage;
use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HreflangInjector;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Frontend\LanguageSwitcher;
use Deepglot\Frontend\LinkRewriter;
use Deepglot\Frontend\OutputBuffer;
use Deepglot\Frontend\RequestRouter;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\UrlLanguageResolver;

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
        $this->container->get(RequestRouter::class)->register();
        $this->container->get(OutputBuffer::class)->register();
        $this->container->get(LanguageSwitcher::class)->register();
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
        if (isset($_GET['activate-multi'])) {
            return;
        }

        wp_safe_redirect(admin_url('options-general.php?page=deepglot'));
        exit;
    }

    public function loadTextDomain(): void
    {
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

        $this->container->singleton(TranslationCache::class, static function () {
            return new TranslationCache();
        });

        $this->container->singleton(HtmlTranslator::class, function (Container $c) {
            return new HtmlTranslator(
                $c->get(Client::class),
                $c->get(Options::class),
                $c->get(TranslationCache::class)
            );
        });

        $this->container->singleton(RequestRouter::class, function (Container $c) {
            return new RequestRouter($c->get(Options::class), $c->get(UrlLanguageResolver::class));
        });

        $this->container->singleton(LinkRewriter::class, function (Container $c) {
            return new LinkRewriter($c->get(UrlLanguageResolver::class), get_site_url());
        });

        $this->container->singleton(HreflangInjector::class, function (Container $c) {
            return new HreflangInjector(
                $c->get(Options::class),
                $c->get(UrlLanguageResolver::class),
                get_site_url()
            );
        });

        $this->container->singleton(OutputBuffer::class, function (Container $c) {
            return new OutputBuffer(
                $c->get(Options::class),
                $c->get(UrlLanguageResolver::class),
                $c->get(HtmlTranslator::class),
                $c->get(LinkRewriter::class),
                $c->get(HreflangInjector::class),
                $c->get(RequestRouter::class)
            );
        });

        $this->container->singleton(LanguageSwitcher::class, function (Container $c) {
            return new LanguageSwitcher($c->get(Options::class), $c->get(UrlLanguageResolver::class));
        });

        $this->container->singleton(SettingsPage::class, function (Container $c) {
            return new SettingsPage($c->get(Options::class));
        });
    }
}
