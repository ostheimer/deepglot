<?php

require_once __DIR__ . '/../includes/Config/Options.php';

use Deepglot\Config\Options;

$fixtures = json_decode(file_get_contents(__DIR__ . '/../../../tests/fixtures/switcher-contract.json'), true);
$options = new Options();
foreach (['#123', 'script', 'head > nav'] as $selector) {
    if ($options->sanitizeSwitcherSelector($selector) !== '') {
        throw new RuntimeException('Unsafe selector survived: ' . $selector);
    }
}
foreach (['.menu.primary', '#site-header > nav.primary'] as $selector) {
    if ($options->sanitizeSwitcherSelector($selector) !== $selector) {
        throw new RuntimeException('Valid selector altered: ' . $selector);
    }
}
foreach (['header_main', '_header'] as $id) {
    if ($options->sanitizeSwitcherInstanceId($id) !== $id) {
        throw new RuntimeException('Existing instance ID altered: ' . $id);
    }
}
$expected = [
    'first' => 'f3265fea4068b3eb8d5ed3fb5a71b4c677014fff56071630d9468973c758e250',
    'reordered' => 'f3265fea4068b3eb8d5ed3fb5a71b4c677014fff56071630d9468973c758e250',
    'emptyMaps' => '634f5604bc541841ea88e3f4946580e4f12ff247897d2de2ea46c883276b66a8',
    'unicodeSeparators' => '21be0b82e93c8f9a72c4b43ffe8e259c66ac8b53085bf40d1f241b4351565562',
];
foreach ($expected as $name => $hash) {
    if ($options->switcherConfigHash($fixtures[$name]) !== $hash) {
        throw new RuntimeException('Switcher hash mismatch for ' . $name . ': ' . $options->switcherConfigHash($fixtures[$name]));
    }
}
echo "SwitcherContractTest: OK\n";
