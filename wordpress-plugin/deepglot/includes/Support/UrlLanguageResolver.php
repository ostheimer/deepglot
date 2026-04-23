<?php

namespace Deepglot\Support;

class UrlLanguageResolver
{
    private string $sourceLanguage;

    /** @var string[] */
    private array $targetLanguages;

    public function __construct(string $sourceLanguage, array $targetLanguages)
    {
        $this->sourceLanguage = strtolower($sourceLanguage);
        $this->targetLanguages = array_values(array_unique(array_map('strtolower', $targetLanguages)));
    }

    public function getSourceLanguage(): string
    {
        return $this->sourceLanguage;
    }

    /**
     * @return string[]
     */
    public function getTargetLanguages(): array
    {
        return $this->targetLanguages;
    }

    public function detectLanguageFromPath(string $path): ?string
    {
        $segments = $this->segments($path);

        if ($segments === []) {
            return null;
        }

        $firstSegment = $segments[0];

        if (in_array($firstSegment, $this->targetLanguages, true)) {
            return $firstSegment;
        }

        return null;
    }

    public function stripLanguageFromPath(string $path): string
    {
        $segments = $this->segments($path);

        if ($segments === []) {
            return '/';
        }

        if (in_array($segments[0], $this->targetLanguages, true)) {
            array_shift($segments);
        }

        return $this->toPath($segments);
    }

    public function withLanguage(string $path, string $language): string
    {
        $normalizedLanguage = strtolower(trim($language));
        $basePath = $this->stripLanguageFromPath($path);

        if ($normalizedLanguage === $this->sourceLanguage || $normalizedLanguage === '') {
            return $basePath;
        }

        $segments = $this->segments($basePath);
        array_unshift($segments, $normalizedLanguage);

        return $this->toPath($segments);
    }

    /**
     * @return string[]
     */
    private function segments(string $path): array
    {
        $path = (string) parse_url($path, PHP_URL_PATH);
        $path = trim($path, '/');

        if ($path === '') {
            return [];
        }

        return array_values(array_filter(explode('/', strtolower($path))));
    }

    /**
     * @param string[] $segments
     */
    private function toPath(array $segments): string
    {
        if ($segments === []) {
            return '/';
        }

        return '/' . implode('/', $segments) . '/';
    }
}
