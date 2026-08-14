<?php

if (!empty($GLOBALS['_deepglot_legacy_template_should_throw'])) {
    throw new RuntimeException('Legacy template fixture failure');
}

if (!empty($GLOBALS['_deepglot_legacy_template_leaves_nested_buffer'])) {
    echo 'before-nested:';
    ob_start();
    echo (string) ($GLOBALS['_deepglot_legacy_template_output'] ?? '');
    return;
}

echo (string) ($GLOBALS['_deepglot_legacy_template_output'] ?? '');
