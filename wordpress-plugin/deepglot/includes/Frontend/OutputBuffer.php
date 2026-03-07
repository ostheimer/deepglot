<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\UrlLanguageResolver;

class OutputBuffer
{
    private Options $options;

    public function __construct(Options $options)
    {
        $this->options = $options;
    }

    public function register(): void
    {
        add_action('template_redirect', [$this, 'startBuffer'], 0);
    }

    public function startBuffer(): void
    {
        if (!$this->shouldStartBuffer()) {
            return;
        }

        ob_start([$this, 'translatePage']);
    }

    public function translatePage(string $content): string
    {
        if ($content === '') {
            return $content;
        }

        if (stripos($content, '<html') !== false && stripos($content, 'translate="no"') === false) {
            $content = preg_replace('/<html\b(?![^>]*translate=)/i', '<html translate="no"', $content, 1) ?: $content;
        }

        return $content;
    }

    private function shouldStartBuffer(): bool
    {
        if (is_admin() || wp_doing_ajax() || wp_is_json_request()) {
            return false;
        }

        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return false;
        }

        if (headers_sent()) {
            return false;
        }

        $resolver = new UrlLanguageResolver(
            $this->options->getSourceLanguage(),
            $this->options->getTargetLanguages()
        );

        $requestUri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $currentLanguage = $resolver->detectLanguageFromPath($requestUri);

        return $currentLanguage !== null;
    }
}
