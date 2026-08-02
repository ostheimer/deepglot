<?php

/**
 * Guard the concrete ERROR findings reported by WordPress Plugin Check 2.0.0
 * for the distributable plugin. Run standalone before packaging.
 */

function wporgComplianceAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$pluginRoot = realpath(__DIR__ . '/..');
wporgComplianceAssert(is_string($pluginRoot), 'Plugin root must be readable');

$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($pluginRoot, FilesystemIterator::SKIP_DOTS)
);

foreach ($iterator as $file) {
    if (!$file->isFile() || $file->getExtension() !== 'php') {
        continue;
    }

    $path = $file->getPathname();
    if (str_starts_with($path, __DIR__ . DIRECTORY_SEPARATOR)) {
        continue;
    }

    $source = file_get_contents($path);
    wporgComplianceAssert(is_string($source), 'PHP source must be readable: ' . $path);
    wporgComplianceAssert(
        preg_match('/(?<!wp_)parse_url\s*\(/', $source) !== 1,
        'Production PHP must use wp_parse_url(): ' . $path
    );

    if ($file->getFilename() !== 'RequestInput.php') {
        $requestVariables = array_values(array_filter(
            token_get_all($source),
            static fn ($token): bool => is_array($token)
                && $token[0] === T_VARIABLE
                && in_array($token[1], ['$_SERVER', '$_GET'], true)
        ));
        $allowedRequestVariables = str_ends_with($path, '/Frontend/RequestRouter.php') ? 1 : 0;
        wporgComplianceAssert(
            count($requestVariables) === $allowedRequestVariables,
            'Production request reads must use RequestInput: ' . $path
        );
    }
}

$requestInput = file_get_contents($pluginRoot . '/includes/Support/RequestInput.php');
wporgComplianceAssert(is_string($requestInput), 'RequestInput.php must be readable');
wporgComplianceAssert(
    substr_count($requestInput, 'sanitize_text_field(wp_unslash(') === 2,
    'Server and query values must be unslashed and sanitized centrally'
);
wporgComplianceAssert(
    str_contains($requestInput, "\$key === 'REQUEST_URI'")
        && str_contains($requestInput, 'esc_url_raw(wp_unslash('),
    'REQUEST_URI must use URL-aware sanitization that preserves encoded bytes'
);

$options = file_get_contents($pluginRoot . '/includes/Config/Options.php');
$siteRouting = file_get_contents($pluginRoot . '/includes/Support/SiteRouting.php');
$switcherTemplates = file_get_contents($pluginRoot . '/includes/Config/SwitcherTemplates.php');
$settingsPage = file_get_contents($pluginRoot . '/includes/Admin/SettingsPage.php');
$container = file_get_contents($pluginRoot . '/includes/Container.php');
$sitemap = file_get_contents($pluginRoot . '/includes/Frontend/MultilingualSitemap.php');
$languageSwitcher = file_get_contents($pluginRoot . '/includes/Frontend/LanguageSwitcher.php');
$settingsSync = file_get_contents($pluginRoot . '/includes/Sync/SettingsSync.php');
$plugin = file_get_contents($pluginRoot . '/includes/Plugin.php');

foreach (
    [
        'Options.php' => $options,
        'SiteRouting.php' => $siteRouting,
        'SwitcherTemplates.php' => $switcherTemplates,
        'SettingsPage.php' => $settingsPage,
        'Container.php' => $container,
        'MultilingualSitemap.php' => $sitemap,
        'LanguageSwitcher.php' => $languageSwitcher,
        'SettingsSync.php' => $settingsSync,
        'Plugin.php' => $plugin,
    ] as $name => $source
) {
    wporgComplianceAssert(is_string($source), $name . ' must be readable');
}

foreach (['Options.php' => $options, 'SiteRouting.php' => $siteRouting] as $name => $source) {
    wporgComplianceAssert(
        preg_match("/defined\(\s*'ABSPATH'\s*\)\s*\|\|\s*exit\s*;/", $source) === 1,
        $name . ' must prevent direct access'
    );
}

wporgComplianceAssert(
    str_contains($switcherTemplates, 'trim(wp_strip_all_tags($value))')
        && !str_contains($switcherTemplates, 'trim(strip_tags($value))'),
    'Switcher template fallback must use wp_strip_all_tags()'
);
wporgComplianceAssert(
    str_contains($settingsPage, 'echo esc_url($dashboardUrl);'),
    'Quota dashboard URL must be escaped at output'
);
wporgComplianceAssert(
    substr_count($container, 'esc_html($id)') === 2,
    'Container exception identifiers must be escaped'
);
wporgComplianceAssert(
    preg_match(
        '/phpcs:ignore WordPress\.Security\.EscapeOutput\.OutputNotEscaped[^\r\n]*\R\s*echo \$this->buildXml/',
        $sitemap
    ) === 1,
    'Sitemap XML output must carry the narrow Plugin Check justification'
);
wporgComplianceAssert(
    preg_match(
        "/translators:[^\r\n]*language name[^\r\n]*\R\s*esc_attr\(sprintf\(__\('Switch language to %s'/",
        $languageSwitcher
    ) === 1,
    'Language-switch link placeholder must have a translators comment'
);
wporgComplianceAssert(
    preg_match(
        "/translators:[^\r\n]*active language[^\r\n]*\R\s*\\x24ariaLabel\s*=\s*sprintf\(__\('Sprache: %s'/",
        $languageSwitcher
    ) === 1,
    'Active-language placeholder must have a translators comment'
);
wporgComplianceAssert(
    substr_count($settingsSync, 'phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log') === 2,
    'Operational sync logs must carry narrow Plugin Check justifications'
);
wporgComplianceAssert(
    str_contains($settingsSync, 'phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery'),
    'Atomic runtime lock deletion must carry a narrow Plugin Check justification'
);
wporgComplianceAssert(
    str_contains($plugin, 'phpcs:ignore PluginCheck.CodeAnalysis.DiscouragedFunctions.load_plugin_textdomainFound'),
    'Bundled-translation loading must carry a narrow Plugin Check justification'
);

fwrite(STDOUT, "WordPressOrgComplianceTest: OK\n");
