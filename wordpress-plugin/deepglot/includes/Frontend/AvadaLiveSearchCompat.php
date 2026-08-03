<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;

/**
 * Prevents Avada's source-only AJAX suggestions from leaking onto target pages.
 *
 * The normal search form remains available and is localized by the regular
 * output pipeline. Source-language pages retain Avada's live suggestions.
 */
class AvadaLiveSearchCompat
{
    private Options $options;
    private RequestRouter $router;

    public function __construct(Options $options, RequestRouter $router)
    {
        $this->options = $options;
        $this->router = $router;
    }

    public function register(): void
    {
        add_filter('awb_localize_theme_scripts', [$this, 'filterLocalizedScripts'], 10, 1);
    }

    /**
     * @param mixed $scripts Avada's localized-script tuples.
     * @return mixed
     */
    public function filterLocalizedScripts($scripts)
    {
        if (!is_array($scripts) || !$this->options->isEnabled() || !$this->options->isConfigured()) {
            return $scripts;
        }

        $language = $this->router->getCurrentLanguage();

        if (!is_string($language) || !$this->isTargetLanguage($language)) {
            return $scripts;
        }

        foreach ($scripts as $index => $script) {
            if (
                !is_array($script)
                || ($script[0] ?? null) !== 'avada-live-search'
                || ($script[1] ?? null) !== 'avadaLiveSearchVars'
                || !isset($script[2])
                || !is_array($script[2])
            ) {
                continue;
            }

            $scripts[$index][2]['live_search'] = false;
        }

        return $scripts;
    }

    private function isTargetLanguage(string $language): bool
    {
        $language = strtolower(trim($language));

        if ($language === '') {
            return false;
        }

        foreach ($this->options->getTargetLanguages() as $targetLanguage) {
            if (is_string($targetLanguage) && strtolower(trim($targetLanguage)) === $language) {
                return true;
            }
        }

        return false;
    }
}
