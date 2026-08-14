<?php

/** Public Client signatures remain compatible with existing plugin subclasses. */

if (!function_exists('__')) {
    function __($text, $domain = null) { return $text; }
}

if (!function_exists('add_action')) {
    $GLOBALS['_deepglot_signature_actions'] = [];

    function add_action($hook, $callback, $priority = 10, $acceptedArgs = 1) {
        $GLOBALS['_deepglot_signature_actions'][$hook][] = [$callback, $acceptedArgs];
        return true;
    }

    function do_action($hook, ...$args): void {
        foreach ($GLOBALS['_deepglot_signature_actions'][$hook] ?? [] as [$callback, $acceptedArgs]) {
            $callback(...array_slice($args, 0, $acceptedArgs));
        }
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/TranslationWarmer.php';

use Deepglot\Api\Client;
use Deepglot\Support\TranslationWarmer;

class DeepglotLegacySignatureClient extends Client
{
    public function __construct() {}

    public static function rateLimitRetryAt(): int
    {
        return 123;
    }

    public function translate(
        array $texts,
        string $langFrom,
        string $langTo,
        string $requestUrl = '',
        int $bot = 0,
        ?int $timeout = null
    ) {
        return ['from_words' => $texts, 'to_words' => $texts];
    }

    public function translateBatches(
        array $batches,
        string $langFrom,
        string $langTo,
        string $requestUrl = '',
        int $bot = 0,
        ?int $timeout = null
    ): array {
        return $batches;
    }
}

class DeepglotLegacySignatureWarmer extends TranslationWarmer
{
    public int $runs = 0;

    public function __construct() {}

    public function run(): void
    {
        $this->runs++;
    }
}

$legacy = new DeepglotLegacySignatureClient();
if ($legacy->translate(['Legacy'], 'de', 'en')['to_words'] !== ['Legacy']) {
    fwrite(STDERR, "FAIL: Legacy translate override must remain callable.\n");
    exit(1);
}
if ($legacy->translateBatches([['Legacy']], 'de', 'en') !== [['Legacy']]) {
    fwrite(STDERR, "FAIL: Legacy translateBatches override must remain callable.\n");
    exit(1);
}
if (DeepglotLegacySignatureClient::rateLimitRetryAt() !== 123) {
    fwrite(STDERR, "FAIL: Legacy static rateLimitRetryAt override must remain callable.\n");
    exit(1);
}
$legacyWarmer = new DeepglotLegacySignatureWarmer();
$legacyWarmer->run();
if ($legacyWarmer->runs !== 1) {
    fwrite(STDERR, "FAIL: Legacy no-argument TranslationWarmer::run override must remain callable.\n");
    exit(1);
}
$legacyWarmer->register();
do_action(TranslationWarmer::HOOK, hash('sha256', 'identity-scoped event'));
if ($legacyWarmer->runs !== 2) {
    fwrite(STDERR, "FAIL: Cron registration must dispatch through the legacy run override.\n");
    exit(1);
}

fwrite(STDOUT, "ClientSignatureCompatibilityTest: OK\n");
