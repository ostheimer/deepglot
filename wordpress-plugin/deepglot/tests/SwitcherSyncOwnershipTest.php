<?php

if (!function_exists('get_option')) {
    $GLOBALS['_switcher_options'] = [];
    function get_option($key, $default = false) { return $GLOBALS['_switcher_options'][$key] ?? $default; }
    function update_option($key, $value) { $GLOBALS['_switcher_options'][$key] = $value; return true; }
    function wp_parse_args($args, $defaults = []) { return array_merge($defaults, is_array($args) ? $args : []); }
    function sanitize_text_field($value) { return trim((string) $value); }
    function sanitize_textarea_field($value) { return trim((string) $value); }
    function esc_url_raw($value) { return (string) $value; }
    function untrailingslashit($value) { return rtrim((string) $value, '/'); }
    function wp_json_encode($value) { return json_encode($value); }
    function maybe_serialize($value) { return serialize($value); }
}

class SwitcherCasDatabase {
    public string $options = 'wp_options';
    public $beforeQuery = null;
    public function prepare($sql, ...$values) { return $values; }
    public function query($values) {
        if ($this->beforeQuery) {
            $callback = $this->beforeQuery;
            $this->beforeQuery = null;
            $callback();
        }
        if (serialize(get_option($values[1], [])) !== $values[2]) return 0;
        update_option($values[1], unserialize($values[0]));
        return 1;
    }
}
$GLOBALS['wpdb'] = new SwitcherCasDatabase();

require_once __DIR__ . '/../includes/Config/Options.php';

use Deepglot\Config\Options;

function ownershipAssert(bool $okay, string $message): void {
    if (!$okay) throw new RuntimeException($message);
}

$options = new Options();
$initial = Options::defaults();
$initial['enabled'] = true;
$initial['api_key'] = 'fixture-key';
update_option(Options::OPTION_KEY, $initial);
$base = $options->exportSwitcherContract();
$edited = $base;
$edited['instances'][0]['style'] = 'dropdown';
$edited['instances'][0]['customNames'] = ['de' => 'Österreichisches Deutsch'];
$edited['instances'][0]['customFlags'] = ['en' => '🇺🇸'];
$edited['instances'][0]['selector'] = '#site-header > nav.primary';
$options->applyRuntimeConfig(['switcher' => [
    'contractVersion' => 1, 'owner' => 'saas', 'revision' => 1,
    'baseRevision' => null, 'baseConfig' => $base, 'config' => $edited,
]]);
$applied = $options->all();
ownershipAssert($applied['switcher_contract_revision'] === 1, 'Revision must be acknowledged');
ownershipAssert($options->switcherConfigHash($options->exportSwitcherContract()) === $options->switcherConfigHash($edited), 'Applied switcher must match dashboard config');

$local = $applied;
$local['switcher_default_style'] = 'list';
$local['switcher_local_conflict'] = true;
update_option(Options::OPTION_KEY, $local);
$next = $edited;
$next['instances'][0]['position'] = 'fixed-top-right';
$options->applyRuntimeConfig(['switcher' => [
    'contractVersion' => 1, 'owner' => 'saas', 'revision' => 2,
    'baseRevision' => null, 'baseConfig' => $base, 'config' => $next,
]]);
$conflict = $options->all();
ownershipAssert($conflict['switcher_default_style'] === 'list', 'Local edit must not be overwritten');
ownershipAssert($conflict['switcher_contract_revision'] === 1, 'Conflicted revision must not be acknowledged');
ownershipAssert($conflict['switcher_local_conflict'] === true, 'Conflict must remain visible');

// A delayed old dashboard payload must not reclaim ownership after return.
update_option(Options::OPTION_KEY, $applied);
$options->applyRuntimeConfig(['switcher' => [
    'contractVersion' => 1, 'owner' => 'wordpress', 'revision' => 2,
]]);
$returned = $options->all();
$returned['switcher_default_style'] = $base['instances'][0]['style'];
update_option(Options::OPTION_KEY, $returned);
$options->applyRuntimeConfig(['switcher' => [
    'contractVersion' => 1, 'owner' => 'saas', 'revision' => 1,
    'baseRevision' => null, 'baseConfig' => $base, 'config' => $edited,
]]);
ownershipAssert($options->all()['switcher_default_style'] === $base['instances'][0]['style'], 'Stale SaaS payload must not overwrite returned WordPress settings');
ownershipAssert($options->all()['switcher_contract_owner'] === 'wordpress', 'Stale SaaS payload must not reclaim ownership');

$freshBase = $options->exportSwitcherContract();
$readopted = $freshBase;
$readopted['instances'][0]['style'] = 'dropdown';
$options->applyRuntimeConfig(['switcher' => [
    'contractVersion' => 1, 'owner' => 'saas', 'revision' => 3,
    'baseRevision' => null, 'baseConfig' => $freshBase, 'config' => $readopted,
]]);
ownershipAssert($options->all()['switcher_contract_owner'] === 'saas', 'Fresh re-adoption must work');
$options->applyRuntimeConfig(['switcher' => [
    'contractVersion' => 1, 'owner' => 'wordpress', 'revision' => 2,
]]);
ownershipAssert($options->all()['switcher_contract_owner'] === 'saas', 'Delayed WordPress return must not undo a newer adoption');

// Simulate wp-admin changing local settings after the runtime read but before persistence.
update_option(Options::OPTION_KEY, $initial);
$racingBase = $options->exportSwitcherContract();
$racingNext = $racingBase;
$racingNext['instances'][0]['style'] = 'dropdown';
$GLOBALS['wpdb']->beforeQuery = static function () use ($initial) {
    $admin = $initial;
    $admin['switcher_default_style'] = 'dropdown';
    $admin['switcher_local_conflict'] = true;
    update_option(Options::OPTION_KEY, $admin);
};
$options->applyRuntimeConfig(['switcher' => [
    'contractVersion' => 1, 'owner' => 'saas', 'revision' => 5,
    'baseRevision' => null, 'baseConfig' => $racingBase, 'config' => $racingNext,
]]);
ownershipAssert($options->all()['switcher_local_conflict'] === true, 'Concurrent wp-admin edit must survive');
ownershipAssert(($options->all()['switcher_contract_last_seen'] ?? 0) < 5, 'Rejected sync must not advance last-seen');

// A newer owner transition may arrive while an older payload is being written.
update_option(Options::OPTION_KEY, $initial);
$GLOBALS['wpdb']->beforeQuery = static function () use ($initial) {
    $newer = $initial;
    $newer['switcher_contract_owner'] = 'wordpress';
    $newer['switcher_contract_last_seen'] = 7;
    update_option(Options::OPTION_KEY, $newer);
};
$options->applyRuntimeConfig(['switcher' => [
    'contractVersion' => 1, 'owner' => 'saas', 'revision' => 6,
    'baseRevision' => null, 'baseConfig' => $racingBase, 'config' => $racingNext,
]]);
ownershipAssert($options->all()['switcher_contract_owner'] === 'wordpress', 'Concurrent newer owner must survive');
ownershipAssert($options->all()['switcher_contract_last_seen'] === 7, 'Last-seen owner version must not regress');

// Adopt both the existing default and a named switcher without losing its target or labels.
update_option(Options::OPTION_KEY, $initial);
$multiBase = $options->exportSwitcherContract();
$named = $multiBase['instances'][0];
$named['id'] = 'header-main';
$named['name'] = 'Kopfzeile';
$named['autoInject'] = true;
$named['selector'] = '#site-header > nav.primary';
$named['customNames'] = ['de' => 'Deutsch für Menü'];
$named['customFlags'] = ['en' => '🇺🇸'];
$multiBase['instances'][] = $named;
$multiSettings = $initial;
$multiSettings['switcher_instances'] = [[
    'id' => 'header-main', 'name' => 'Kopfzeile', 'enabled' => true,
    'auto_inject' => true, 'style' => $named['style'], 'flag_style' => $named['flagStyle'],
    'show_label' => $named['showLabel'], 'label_format' => $named['labelFormat'],
    'language_order' => $named['languageOrder'], 'custom_css' => '', 'position' => 'inline',
    'responsive_hide' => 'none', 'responsive_breakpoint' => 768,
    'custom_flags' => ['en' => '🇺🇸'], 'custom_names' => ['de' => 'Deutsch für Menü'],
    'selector' => '#site-header > nav.primary',
]];
update_option(Options::OPTION_KEY, $multiSettings);
ownershipAssert($options->switcherConfigHash($options->exportSwitcherContract()) === $options->switcherConfigHash($multiBase), 'Named fixture must match the exported base');
$multiNext = $multiBase;
$multiNext['instances'][0]['style'] = 'dropdown';
$options->applyRuntimeConfig(['switcher' => [
    'contractVersion' => 1, 'owner' => 'saas', 'revision' => 8,
    'baseRevision' => null, 'baseConfig' => $multiBase, 'config' => $multiNext,
]]);
ownershipAssert($options->switcherConfigHash($options->exportSwitcherContract()) === $options->switcherConfigHash($multiNext), 'Both switchers must survive adoption');
ownershipAssert(($options->all()['switcher_instances'][1]['selector'] ?? '') === '#site-header > nav.primary', 'Named selector must survive adoption');
ownershipAssert(($options->all()['switcher_instances'][1]['custom_names']['de'] ?? '') === 'Deutsch für Menü', 'Named language override must survive adoption');

// Old plugin payloads without the v1 switcher object must leave WordPress settings untouched.
$beforeLegacy = $options->switcherConfigHash($options->exportSwitcherContract());
$options->applyRuntimeConfig(['project' => ['name' => 'Fixture']]);
ownershipAssert($options->switcherConfigHash($options->exportSwitcherContract()) === $beforeLegacy, 'Legacy runtime config must not change switcher');
echo "SwitcherSyncOwnershipTest: OK\n";
