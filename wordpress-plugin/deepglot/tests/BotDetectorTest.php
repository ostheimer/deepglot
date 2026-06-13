<?php

/**
 * Pins the user-agent → bot-code mapping that protects project quota.
 *
 * The SaaS exempts bot traffic from the monthly word quota and serves it from
 * cache only. The plugin used to hardcode bot=0 (human), so crawlers grinding
 * the long-tail archive burned the entire quota (issue #147). These cases lock
 * in that the named crawlers map to their specific codes, generic crawlers map
 * to OTHER, and real browsers stay HUMAN.
 */

require_once __DIR__ . '/../includes/Support/BotDetector.php';

use Deepglot\Support\BotDetector;

function botCheck($condition, string $message): void
{
    if ($condition !== true) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
$safariMobile = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

// Real browsers must stay human (the only code that spends quota).
botCheck(BotDetector::detect($chrome) === BotDetector::HUMAN, 'Desktop Chrome must be HUMAN.');
botCheck(BotDetector::detect($safariMobile) === BotDetector::HUMAN, 'Mobile Safari must be HUMAN.');
botCheck(BotDetector::detect('') === BotDetector::HUMAN, 'Empty UA falls back to HUMAN.');
botCheck(BotDetector::detect(null) === BotDetector::HUMAN, 'Null UA falls back to HUMAN.');

// Named crawlers map to their specific legacy codes.
botCheck(BotDetector::detect('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)') === BotDetector::GOOGLE, 'Googlebot → GOOGLE.');
botCheck(BotDetector::detect('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)') === BotDetector::BING, 'bingbot → BING.');
botCheck(BotDetector::detect('Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)') === BotDetector::YAHOO, 'Slurp → YAHOO.');
botCheck(BotDetector::detect('Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)') === BotDetector::BAIDU, 'Baiduspider → BAIDU.');
botCheck(BotDetector::detect('Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)') === BotDetector::YANDEX, 'YandexBot → YANDEX.');

// Generic crawlers / tools fall into OTHER — still exempt from quota.
botCheck(BotDetector::detect('curl/8.1.2') === BotDetector::OTHER, 'curl → OTHER.');
botCheck(BotDetector::detect('python-requests/2.31.0') === BotDetector::OTHER, 'python-requests → OTHER.');
botCheck(BotDetector::detect('facebookexternalhit/1.1') === BotDetector::OTHER, 'facebookexternalhit → OTHER.');
botCheck(BotDetector::detect('SomeRandomCrawler/1.0 (+http://example.com/bot)') === BotDetector::OTHER, 'Generic crawler → OTHER.');

// Every bot code must be >= OTHER so the SaaS `bot >= OTHER` exemption holds.
foreach ([BotDetector::OTHER, BotDetector::GOOGLE, BotDetector::BING, BotDetector::YAHOO, BotDetector::BAIDU, BotDetector::YANDEX] as $code) {
    botCheck($code >= BotDetector::OTHER, 'Bot codes must be >= OTHER.');
}
botCheck(BotDetector::HUMAN < BotDetector::OTHER, 'HUMAN must sort below every bot code.');

// detectCurrentRequest reads $_SERVER['HTTP_USER_AGENT'].
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (compatible; Googlebot/2.1)';
botCheck(BotDetector::detectCurrentRequest() === BotDetector::GOOGLE, 'detectCurrentRequest reads the request UA.');
unset($_SERVER['HTTP_USER_AGENT']);
botCheck(BotDetector::detectCurrentRequest() === BotDetector::HUMAN, 'Missing request UA → HUMAN.');

fwrite(STDOUT, "BotDetectorTest: OK\n");
