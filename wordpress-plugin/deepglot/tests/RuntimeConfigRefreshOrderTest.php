<?php

/**
 * Regression guard for translated slug runtime sync order.
 *
 * SiteRouting snapshots Options::getUrlSlugMappings() while RequestRouter is
 * registered. If the runtime config refresh happens later during output
 * buffering, the current request still routes with the stale reverse map.
 */

$pluginSource = file_get_contents(__DIR__ . '/../includes/Plugin.php');

function refreshOrderAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$settingsSyncRegisterPos = strpos($pluginSource, '$this->container->get(SettingsSync::class)->register();');
$settingsSyncRefreshPos = strpos($pluginSource, '$this->container->get(SettingsSync::class)->maybeRefreshRuntimeConfig();');
$requestRouterRegisterPos = strpos($pluginSource, '$this->container->get(RequestRouter::class)->register();');

refreshOrderAssert($settingsSyncRegisterPos !== false, 'Plugin::register() must register SettingsSync.');
refreshOrderAssert($settingsSyncRefreshPos !== false, 'Plugin::register() must refresh runtime config before routing services are built.');
refreshOrderAssert($requestRouterRegisterPos !== false, 'Plugin::register() must register RequestRouter.');
refreshOrderAssert(
    $settingsSyncRegisterPos < $settingsSyncRefreshPos && $settingsSyncRefreshPos < $requestRouterRegisterPos,
    'Runtime config refresh must run after SettingsSync registration and before RequestRouter registration.'
);

fwrite(STDOUT, "RuntimeConfigRefreshOrderTest: OK\n");
