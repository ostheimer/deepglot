<?php

/** Regression contract for the administrator preview/confirm/retry workflow. */

function urlSyncAdminAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

$settings = file_get_contents(__DIR__ . '/../includes/Admin/SettingsPage.php');
urlSyncAdminAssert(is_string($settings), 'SettingsPage source must be readable.');

urlSyncAdminAssert(
    str_contains($settings, "admin_post_deepglot_url_sync_preview"),
    'Admin must register a separate preview action before URL sync start.'
);
urlSyncAdminAssert(
    str_contains($settings, "\$this->urlSync->preview("),
    'Admin preview action must call the side-effect-free preview service.'
);
urlSyncAdminAssert(
    str_contains($settings, 'name="preview_token"'),
    'The confirmation form must carry the server-side preview token.'
);
urlSyncAdminAssert(
    str_contains($settings, 'name="source_offset"')
        && str_contains($settings, 'Nächsten URL-Batch als Vorschau laden'),
    'Admin must carry the confirmed offset and expose the next bounded batch.'
);
urlSyncAdminAssert(
    str_contains($settings, "in_array(\$state, ['completed', 'completed_with_errors'], true)"),
    'A completed job must preserve next-batch pagination even when some URLs failed.'
);
urlSyncAdminAssert(
    str_contains($settings, 'name="sync_action" value="retry_failed"'),
    'Completed jobs with failures must expose an explicit retry action.'
);
urlSyncAdminAssert(
    str_contains($settings, '$failedUrls as $failedUrl'),
    'The status card must render individual failed URLs for diagnosis.'
);

fwrite(STDOUT, "UrlSyncAdminWorkflowTest: OK\n");
