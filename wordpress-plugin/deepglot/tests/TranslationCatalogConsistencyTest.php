<?php

/**
 * Prevent shipped WordPress translation catalogues from drifting behind the
 * PHP copy or the plugin release. The source scan uses PHP's tokenizer rather
 * than matching snippets, and the MO reader verifies the compiled catalogues
 * contain exactly the entries and translations declared by their PO source.
 */

function catalogAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

/** @param array<int, mixed> $tokens */
function nextSignificantToken(array $tokens, int $index): array
{
    for ($count = count($tokens); $index < $count; $index++) {
        $token = $tokens[$index];
        if (is_array($token) && in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }

        return [$token, $index];
    }

    return [null, $index];
}

/**
 * @param array<int, mixed> $tokens
 * @return array<int, array<int, mixed>>
 */
function parseCallArguments(array $tokens, int $openParenthesisIndex): array
{
    $arguments = [];
    $current = [];
    $depth = 0;

    for ($index = $openParenthesisIndex + 1, $count = count($tokens); $index < $count; $index++) {
        $token = $tokens[$index];

        if ($token === '(' || $token === '[' || $token === '{') {
            $depth++;
            $current[] = $token;
            continue;
        }

        if ($token === ')' || $token === ']' || $token === '}') {
            if ($token === ')' && $depth === 0) {
                $arguments[] = $current;
                return $arguments;
            }

            $depth--;
            $current[] = $token;
            continue;
        }

        if ($token === ',' && $depth === 0) {
            $arguments[] = $current;
            $current = [];
            continue;
        }

        $current[] = $token;
    }

    return [];
}

/** @param array<int, mixed> $tokens */
function literalString(array $tokens): ?string
{
    $value = '';
    $foundString = false;

    foreach ($tokens as $token) {
        if (is_array($token) && in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }

        if ($token === '.') {
            continue;
        }

        if (!is_array($token) || $token[0] !== T_CONSTANT_ENCAPSED_STRING) {
            return null;
        }

        $quoted = $token[1];
        $body = substr($quoted, 1, -1);
        if ($quoted[0] === "'") {
            $value .= str_replace(["\\\\", "\\'"], ["\\", "'"], $body);
        } else {
            $value .= stripcslashes($body);
        }
        $foundString = true;
    }

    return $foundString ? $value : null;
}

/**
 * @return array<string, true>
 */
function phpGettextMessages(string $pluginDirectory): array
{
    $specifications = [
        '__' => ['messages' => [0], 'domain' => 1, 'context' => null],
        '_e' => ['messages' => [0], 'domain' => 1, 'context' => null],
        'esc_html__' => ['messages' => [0], 'domain' => 1, 'context' => null],
        'esc_html_e' => ['messages' => [0], 'domain' => 1, 'context' => null],
        'esc_attr__' => ['messages' => [0], 'domain' => 1, 'context' => null],
        'esc_attr_e' => ['messages' => [0], 'domain' => 1, 'context' => null],
        '_x' => ['messages' => [0], 'domain' => 2, 'context' => 1],
        '_ex' => ['messages' => [0], 'domain' => 2, 'context' => 1],
        'esc_html_x' => ['messages' => [0], 'domain' => 2, 'context' => 1],
        'esc_attr_x' => ['messages' => [0], 'domain' => 2, 'context' => 1],
        '_n' => ['messages' => [0, 1], 'domain' => 3, 'context' => null],
        '_n_noop' => ['messages' => [0, 1], 'domain' => 2, 'context' => null],
        '_nx' => ['messages' => [0, 1], 'domain' => 4, 'context' => 3],
        '_nx_noop' => ['messages' => [0, 1], 'domain' => 3, 'context' => 2],
    ];

    $messages = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($pluginDirectory, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if (!$file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }

        $relativePath = substr($file->getPathname(), strlen($pluginDirectory) + 1);
        if (str_starts_with($relativePath, 'tests' . DIRECTORY_SEPARATOR)) {
            continue;
        }

        $source = file_get_contents($file->getPathname());
        catalogAssert(is_string($source), 'PHP source must be readable: ' . $relativePath);
        $tokens = token_get_all($source);

        foreach ($tokens as $index => $token) {
            if (!is_array($token) || $token[0] !== T_STRING) {
                continue;
            }

            $function = strtolower($token[1]);
            if (!isset($specifications[$function])) {
                continue;
            }

            [$next, $openIndex] = nextSignificantToken($tokens, $index + 1);
            if ($next !== '(') {
                continue;
            }

            $arguments = parseCallArguments($tokens, $openIndex);
            $specification = $specifications[$function];
            $domainIndex = $specification['domain'];
            if (!isset($arguments[$domainIndex]) || literalString($arguments[$domainIndex]) !== 'deepglot') {
                continue;
            }

            $sourceMessages = [];
            foreach ($specification['messages'] as $messageIndex) {
                $message = isset($arguments[$messageIndex]) ? literalString($arguments[$messageIndex]) : null;
                catalogAssert(
                    $message !== null && $message !== '',
                    sprintf('Gettext message must be a static literal in %s:%d', $relativePath, $token[2])
                );
                $sourceMessages[] = $message;
            }

            $key = implode("\0", $sourceMessages);
            if ($specification['context'] !== null) {
                $contextIndex = $specification['context'];
                $context = isset($arguments[$contextIndex]) ? literalString($arguments[$contextIndex]) : null;
                catalogAssert(
                    $context !== null && $context !== '',
                    sprintf('Gettext context must be a static literal in %s:%d', $relativePath, $token[2])
                );
                $key = $context . "\x04" . $key;
            }

            $messages[$key] = true;
        }
    }

    return $messages;
}

function poString(string $quoted, string $path): string
{
    $decoded = json_decode($quoted, true);
    catalogAssert(is_string($decoded), 'Invalid PO string in ' . $path . ': ' . $quoted);
    return $decoded;
}

/**
 * @return array<string, string>
 */
function parsePoCatalog(string $path): array
{
    $content = file_get_contents($path);
    catalogAssert(is_string($content), 'Catalogue must be readable: ' . $path);
    $entries = [];

    foreach (preg_split('/\R{2,}/u', trim($content)) ?: [] as $chunk) {
        $fields = [];
        $activeField = null;

        foreach (preg_split('/\R/u', $chunk) ?: [] as $line) {
            if (preg_match('/^(msgctxt|msgid|msgid_plural|msgstr(?:\[\d+\])?)\s+(".*")$/u', $line, $match) === 1) {
                $activeField = $match[1];
                $fields[$activeField] = poString($match[2], $path);
                continue;
            }

            if ($activeField !== null && preg_match('/^(".*")$/u', $line, $match) === 1) {
                $fields[$activeField] .= poString($match[1], $path);
            }
        }

        if (!array_key_exists('msgid', $fields)) {
            continue;
        }

        $key = ($fields['msgctxt'] ?? '') !== ''
            ? $fields['msgctxt'] . "\x04" . $fields['msgid']
            : $fields['msgid'];
        if (isset($fields['msgid_plural'])) {
            $key .= "\0" . $fields['msgid_plural'];
        }

        $translations = [];
        foreach ($fields as $field => $value) {
            if ($field === 'msgstr') {
                $translations[0] = $value;
            } elseif (preg_match('/^msgstr\[(\d+)\]$/', $field, $match) === 1) {
                $translations[(int) $match[1]] = $value;
            }
        }
        ksort($translations);
        catalogAssert($translations !== [], 'PO entry has no translation in ' . $path . ': ' . $key);
        catalogAssert(!array_key_exists($key, $entries), 'Duplicate PO entry in ' . $path . ': ' . $key);
        $entries[$key] = implode("\0", $translations);
    }

    return $entries;
}

function moUInt32(string $bytes, int $offset, bool $littleEndian): int
{
    $format = $littleEndian ? 'Vvalue' : 'Nvalue';
    $unpacked = unpack($format, substr($bytes, $offset, 4));
    catalogAssert(is_array($unpacked) && isset($unpacked['value']), 'MO integer could not be decoded');
    return (int) $unpacked['value'];
}

/**
 * @return array<string, string>
 */
function parseMoCatalog(string $path): array
{
    $bytes = file_get_contents($path);
    catalogAssert(is_string($bytes) && strlen($bytes) >= 28, 'Compiled MO must be readable: ' . $path);

    $littleMagic = unpack('Vvalue', substr($bytes, 0, 4));
    $bigMagic = unpack('Nvalue', substr($bytes, 0, 4));
    $littleEndian = ($littleMagic['value'] ?? null) === 0x950412de;
    catalogAssert($littleEndian || ($bigMagic['value'] ?? null) === 0x950412de, 'Invalid MO magic: ' . $path);
    catalogAssert(moUInt32($bytes, 4, $littleEndian) <= 1, 'Unsupported MO revision: ' . $path);

    $count = moUInt32($bytes, 8, $littleEndian);
    $originalTable = moUInt32($bytes, 12, $littleEndian);
    $translationTable = moUInt32($bytes, 16, $littleEndian);
    catalogAssert($originalTable + ($count * 8) <= strlen($bytes), 'Invalid MO original table: ' . $path);
    catalogAssert($translationTable + ($count * 8) <= strlen($bytes), 'Invalid MO translation table: ' . $path);

    $entries = [];
    for ($index = 0; $index < $count; $index++) {
        $originalLength = moUInt32($bytes, $originalTable + ($index * 8), $littleEndian);
        $originalOffset = moUInt32($bytes, $originalTable + ($index * 8) + 4, $littleEndian);
        $translationLength = moUInt32($bytes, $translationTable + ($index * 8), $littleEndian);
        $translationOffset = moUInt32($bytes, $translationTable + ($index * 8) + 4, $littleEndian);
        catalogAssert($originalOffset + $originalLength <= strlen($bytes), 'Invalid MO source entry: ' . $path);
        catalogAssert($translationOffset + $translationLength <= strlen($bytes), 'Invalid MO translation entry: ' . $path);

        $original = substr($bytes, $originalOffset, $originalLength);
        $translation = substr($bytes, $translationOffset, $translationLength);
        catalogAssert(!array_key_exists($original, $entries), 'Duplicate MO entry in ' . $path . ': ' . $original);
        $entries[$original] = $translation;
    }

    return $entries;
}

function catalogueProjectVersion(array $catalogue): string
{
    $header = $catalogue[''] ?? '';
    catalogAssert(
        preg_match('/^Project-Id-Version:\s*Deepglot\s+([^\s]+)$/m', $header, $match) === 1,
        'Catalogue header must declare a Deepglot project version'
    );
    return $match[1] ?? '';
}

$pluginDirectory = realpath(__DIR__ . '/..');
catalogAssert(is_string($pluginDirectory), 'Plugin directory must be readable');
$languagesDirectory = $pluginDirectory . '/languages';
$bootstrap = file_get_contents($pluginDirectory . '/deepglot.php');
catalogAssert(is_string($bootstrap), 'Plugin bootstrap must be readable');
catalogAssert(
    preg_match('/^ \* Version:\s*([^\s]+)$/m', $bootstrap, $versionMatch) === 1,
    'Plugin version header must be readable'
);
$pluginVersion = $versionMatch[1] ?? '';

$sourceMessages = phpGettextMessages($pluginDirectory);
catalogAssert($sourceMessages !== [], 'At least one PHP Gettext message must be found');

$pot = parsePoCatalog($languagesDirectory . '/deepglot.pot');
$potMessages = array_fill_keys(array_filter(array_keys($pot), static fn (string $key): bool => $key !== ''), true);
$missingFromPot = array_keys(array_diff_key($sourceMessages, $potMessages));
catalogAssert(
    $missingFromPot === [],
    'POT is missing PHP Gettext messages: ' . implode(' | ', $missingFromPot)
);
catalogAssert(
    catalogueProjectVersion($pot) === $pluginVersion,
    'POT project version must match plugin version ' . $pluginVersion
);

$poFiles = glob($languagesDirectory . '/deepglot-*.po') ?: [];
$moFiles = glob($languagesDirectory . '/deepglot-*.mo') ?: [];
sort($poFiles);
sort($moFiles);
catalogAssert($poFiles !== [], 'Bundled PO catalogues must exist');
catalogAssert(count($poFiles) === count($moFiles), 'Every bundled PO catalogue must have one MO catalogue');

foreach ($poFiles as $poPath) {
    $moPath = substr($poPath, 0, -3) . '.mo';
    catalogAssert(is_file($moPath), 'Compiled MO is missing for ' . basename($poPath));

    $po = parsePoCatalog($poPath);
    $missingFromPo = array_keys(array_diff_key($potMessages, $po));
    catalogAssert(
        $missingFromPo === [],
        basename($poPath) . ' is missing POT messages: ' . implode(' | ', $missingFromPo)
    );
    catalogAssert(
        catalogueProjectVersion($po) === $pluginVersion,
        basename($poPath) . ' project version must match plugin version ' . $pluginVersion
    );

    $mo = parseMoCatalog($moPath);
    // GNU msgfmt intentionally omits this source-template timestamp from MO
    // headers while preserving every runtime-relevant header field.
    $po[''] = preg_replace('/^POT-Creation-Date:.*\n/m', '', $po[''] ?? '') ?? '';
    ksort($po);
    ksort($mo);
    $missingMoKeys = array_keys(array_diff_key($po, $mo));
    $extraMoKeys = array_keys(array_diff_key($mo, $po));
    $changedMoValues = [];
    foreach (array_intersect_key($po, $mo) as $key => $translation) {
        if ($translation !== $mo[$key]) {
            $changedMoValues[] = $key === '' ? '(header)' : $key;
        }
    }
    catalogAssert(
        $po === $mo,
        sprintf(
            '%s must be compiled from its matching PO catalogue (missing: %s; extra: %s; changed: %s)',
            basename($moPath),
            implode(' | ', array_slice($missingMoKeys, 0, 3)),
            implode(' | ', array_slice($extraMoKeys, 0, 3)),
            implode(' | ', array_slice($changedMoValues, 0, 3))
        )
    );
}

fwrite(
    STDOUT,
    sprintf(
        "TranslationCatalogConsistencyTest: OK (%d PHP messages, %d locales)\n",
        count($sourceMessages),
        count($poFiles)
    )
);
