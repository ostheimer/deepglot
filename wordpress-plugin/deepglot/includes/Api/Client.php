<?php

namespace Deepglot\Api;

use Deepglot\Config\Options;

class Client
{
    private Options $options;

    public function __construct(Options $options)
    {
        $this->options = $options;
    }

    public function isConfigured(): bool
    {
        return $this->options->isConfigured();
    }

    public function listLanguages()
    {
        return $this->request('GET', '/public/languages');
    }

    /**
     * Translates an array of plain text strings.
     *
     * @param  string[] $texts      Plain text strings to translate.
     * @param  string   $langFrom   ISO 639-1 source language code (e.g. "de").
     * @param  string   $langTo     ISO 639-1 target language code (e.g. "en").
     * @param  string   $requestUrl Optional page URL for analytics.
     * @return array|\WP_Error      On success: ['from_words' => [...], 'to_words' => [...]].
     */
    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '')
    {
        // Build the words array in the API contract format.
        $words = array_map(static fn(string $w) => ['w' => $w, 't' => 1], $texts);

        $payload = [
            'l_from'      => $langFrom,
            'l_to'        => $langTo,
            'words'       => $words,
            'request_url' => $requestUrl,
            'bot'         => 0,
        ];

        return $this->request('POST', '/translate?api_key=' . rawurlencode($this->options->getApiKey()), $payload);
    }

    private function request(string $method, string $path, ?array $payload = null)
    {
        $url = $this->options->getApiBaseUrl() . $path;

        $args = [
            'method' => $method,
            'timeout' => 15,
            'headers' => [
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ],
        ];

        if ($payload !== null) {
            $args['body'] = wp_json_encode($payload);
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            return $response;
        }

        $statusCode = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $decoded = json_decode($body, true);

        if ($statusCode >= 400) {
            return new \WP_Error(
                'deepglot_api_error',
                is_array($decoded) && !empty($decoded['error']) ? $decoded['error'] : __('Deepglot API Fehler.', 'deepglot'),
                ['status' => $statusCode, 'body' => $decoded]
            );
        }

        return is_array($decoded) ? $decoded : [];
    }
}
