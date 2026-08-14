<?php

use Deepglot\Support\RequestInput;

function requestInputAssertSame(string $expected, string $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

function requestInputAssertArraySame(array $expected, array $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

if (!function_exists('sanitize_text_field')) {
    function sanitize_text_field($value): string
    {
        $value = preg_replace('/%[a-f0-9]{2}/i', '', (string) $value) ?? '';

        return str_replace(["\r", "\n"], '', $value);
    }
}

if (!function_exists('esc_url_raw')) {
    function esc_url_raw($value): string
    {
        return (string) $value;
    }
}

$_SERVER['REQUEST_URI'] = '/de/caf%C3%A9/?s=%C3%A4';
requestInputAssertSame(
    '/de/caf%C3%A9/?s=%C3%A4',
    RequestInput::server('REQUEST_URI', '/'),
    'REQUEST_URI sanitization must preserve percent-encoded path and query bytes'
);

$_SERVER['HTTP_USER_AGENT'] = "Browser%41\r\nInjected";
requestInputAssertSame(
    'BrowserInjected',
    RequestInput::server('HTTP_USER_AGENT'),
    'Non-URL server values must continue through text-field sanitization'
);

$_POST['sync_action'] = "resume\r\nIgnored";
requestInputAssertSame(
    'resumeIgnored',
    RequestInput::post('sync_action'),
    'POST scalar values must be unslashed and sanitized centrally'
);

$_POST['target_languages'] = ['en', "fr\r\n", ['invalid']];
requestInputAssertArraySame(
    ['en', 'fr'],
    RequestInput::postArray('target_languages'),
    'POST arrays must sanitize scalar values and discard nested input'
);

fwrite(STDOUT, "RequestInputTest: OK\n");
