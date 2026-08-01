<?php

/**
 * Regression guard for translated slug runtime sync order.
 *
 * SiteRouting snapshots Options::getUrlSlugMappings() while RequestRouter is
 * registered. The refresh therefore has to run on the early frontend hook and
 * update the shared routing object before RequestRouter rewrites REQUEST_URI.
 * It must not run synchronously during every plugin bootstrap or retry again
 * later in OutputBuffer after a failed early refresh.
 */

$pluginSource = file_get_contents(__DIR__ . '/../includes/Plugin.php');
$outputBufferSource = file_get_contents(__DIR__ . '/../includes/Frontend/OutputBuffer.php');
$siteRoutingSource = file_get_contents(__DIR__ . '/../includes/Support/SiteRouting.php');

function refreshOrderAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

refreshOrderAssert(
    strpos($pluginSource, "add_action('plugins_loaded', [\$this, 'refreshRuntimeRouting'], 0);") !== false,
    'Plugin::register() must schedule a frontend-scoped refresh before RequestRouter priority 1.'
);
refreshOrderAssert(
    strpos($pluginSource, 'public function refreshRuntimeRouting(): void') !== false,
    'Plugin must expose the early refresh callback used by the plugins_loaded hook.'
);
refreshOrderAssert(
    strpos($pluginSource, '!$options->isEnabled() || !$options->isConfigured()') !== false,
    'The frontend refresh must not contact the SaaS for disabled or incomplete plugin configurations.'
);
refreshOrderAssert(
    strpos($pluginSource, "\$this->container->get(SettingsSync::class)->maybeRefreshRuntimeConfig();") !== false
        && strpos($pluginSource, "\$this->container->get(SiteRouting::class)->replaceUrlSlugMappings(") !== false,
    'The early callback must refresh the cache and then update the shared SiteRouting snapshot.'
);
refreshOrderAssert(
    strpos($siteRoutingSource, 'public function replaceUrlSlugMappings(array $urlSlugMappings): void') !== false,
    'SiteRouting must support replacing its slug maps after an early runtime refresh.'
);
refreshOrderAssert(
    strpos($outputBufferSource, '$this->maybeRefreshRuntimeConfig();') === false,
    'OutputBuffer must not retry a failed runtime refresh later in the same request.'
);

fwrite(STDOUT, "RuntimeConfigRefreshOrderTest: OK\n");
