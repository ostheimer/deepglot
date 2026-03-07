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

    public function translate(array $payload)
    {
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
