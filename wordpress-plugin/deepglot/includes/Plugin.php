<?php

namespace Deepglot;

use Deepglot\Admin\SettingsPage;
use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\OutputBuffer;

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

        $this->container->get(SettingsPage::class)->register();
        $this->container->get(OutputBuffer::class)->register();
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
    }

    public function client(): Client
    {
        return $this->container->get(Client::class);
    }

    private function registerServices(): void
    {
        $this->container->singleton(Options::class, static function () {
            return new Options();
        });

        $this->container->singleton(Client::class, function (Container $container) {
            return new Client($container->get(Options::class));
        });

        $this->container->singleton(SettingsPage::class, function (Container $container) {
            return new SettingsPage($container->get(Options::class));
        });

        $this->container->singleton(OutputBuffer::class, function (Container $container) {
            return new OutputBuffer($container->get(Options::class));
        });
    }
}
