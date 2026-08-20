<?php

/**
 * Prove that the release builder reads one explicit commit, includes only the
 * runtime allowlist, and emits byte-identical archives for repeated builds.
 */

function packageAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/**
 * @param list<string> $command
 * @return array{exitCode: int, stdout: string, stderr: string}
 */
function runPackageCommand(array $command, string $workingDirectory, ?array $environment = null): array
{
    $process = proc_open(
        $command,
        [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ],
        $pipes,
        $workingDirectory,
        $environment
    );

    packageAssert(is_resource($process), 'Could not start command: ' . implode(' ', $command));
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);

    return [
        'exitCode' => $exitCode,
        'stdout' => is_string($stdout) ? $stdout : '',
        'stderr' => is_string($stderr) ? $stderr : '',
    ];
}

function findPackageExecutable(string $command): ?string
{
    if ($command === '' || str_contains($command, DIRECTORY_SEPARATOR)) {
        return null;
    }

    $path = getenv('PATH');
    if (!is_string($path) || $path === '') {
        return null;
    }

    $currentDirectory = getcwd();
    foreach (explode(PATH_SEPARATOR, $path) as $directory) {
        $directory = $directory !== '' ? $directory : $currentDirectory;
        if (!is_string($directory) || $directory === '') {
            continue;
        }

        $resolvedDirectory = realpath($directory);
        if (!is_string($resolvedDirectory) || !str_starts_with($resolvedDirectory, DIRECTORY_SEPARATOR)) {
            continue;
        }

        $candidate = $resolvedDirectory . DIRECTORY_SEPARATOR . $command;
        if (!is_file($candidate) || !is_executable($candidate)) {
            continue;
        }

        return $candidate;
    }

    return null;
}

function requirePackageExecutable(string $command): string
{
    $executable = findPackageExecutable($command);
    packageAssert(
        $executable !== null,
        sprintf('Required package-test dependency "%s" was not found in PATH', $command)
    );

    return $executable;
}

/**
 * @return array{path: string, mode: 'sha256sum'|'shasum'}
 */
function requirePackageShaUtility(): array
{
    $sha256sum = findPackageExecutable('sha256sum');
    if ($sha256sum !== null) {
        return ['path' => $sha256sum, 'mode' => 'sha256sum'];
    }

    $shasum = findPackageExecutable('shasum');
    if ($shasum !== null) {
        return ['path' => $shasum, 'mode' => 'shasum'];
    }

    throw new RuntimeException('Required package-test dependency "sha256sum" or "shasum" was not found in PATH');
}

/**
 * @param list<string> $commands
 */
function createControlledPackagePath(string $directory, array $commands): void
{
    packageAssert(mkdir($directory, 0777, true) || is_dir($directory), 'Could not create controlled PATH');

    foreach ($commands as $command) {
        $target = requirePackageExecutable($command);
        packageAssert(symlink($target, $directory . '/' . $command), 'Could not link controlled command: ' . $command);
    }
}

/**
 * @return list<string>
 */
function packageDirectoryEntries(string $directory): array
{
    if (!is_dir($directory)) {
        return [];
    }

    $entries = scandir($directory);
    packageAssert(is_array($entries), 'Could not inspect package output directory');

    return array_values(array_filter($entries, static fn (string $entry): bool => $entry !== '.' && $entry !== '..'));
}

function copyPackageDirectory(string $source, string $destination): void
{
    packageAssert(is_dir($source), 'Fixture source directory does not exist: ' . $source);
    packageAssert(mkdir($destination, 0777, true) || is_dir($destination), 'Could not create fixture directory');

    $iterator = new FilesystemIterator($source, FilesystemIterator::SKIP_DOTS);
    foreach ($iterator as $item) {
        $target = $destination . DIRECTORY_SEPARATOR . $item->getBasename();
        if ($item->isDir() && !$item->isLink()) {
            copyPackageDirectory($item->getPathname(), $target);
            continue;
        }

        packageAssert(copy($item->getPathname(), $target), 'Could not copy fixture file: ' . $item->getPathname());
    }
}

function removePackageDirectory(string $directory): void
{
    if (!is_dir($directory)) {
        return;
    }

    $iterator = new FilesystemIterator($directory, FilesystemIterator::SKIP_DOTS);
    foreach ($iterator as $item) {
        if ($item->isDir() && !$item->isLink()) {
            removePackageDirectory($item->getPathname());
        } else {
            unlink($item->getPathname());
        }
    }
    rmdir($directory);
}

$forceCleanupFailure = getenv('DEEPGLOT_PACKAGE_TEST_FORCE_FAILURE') === '1';
$cleanupSelfTestToken = getenv('DEEPGLOT_PACKAGE_TEST_CLEANUP_TOKEN');

if ($forceCleanupFailure) {
    if (!is_string($cleanupSelfTestToken) || preg_match('/^[0-9a-f]{32}$/D', $cleanupSelfTestToken) !== 1) {
        fwrite(STDERR, "Invalid package-test cleanup token\n");
        exit(64);
    }

    $fixtureRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'deepglot-package-cleanup-test-' . $cleanupSelfTestToken;
    if (file_exists($fixtureRoot) || is_link($fixtureRoot)) {
        fwrite(STDERR, "Package-test cleanup fixture already exists\n");
        exit(73);
    }
} else {
    $fixtureRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'deepglot-package-test-' . bin2hex(random_bytes(8));
}
$fixturePlugin = $fixtureRoot . '/wordpress-plugin/deepglot';
$builderSource = __DIR__ . '/../../build-zip.sh';
$builderFixture = $fixtureRoot . '/wordpress-plugin/build-zip.sh';
$testExitCode = 0;
$fixtureCleanupOwned = !$forceCleanupFailure;

try {
    if ($forceCleanupFailure) {
        packageAssert(mkdir($fixtureRoot, 0700, false), 'Could not reserve forced cleanup fixture root');
        $fixtureCleanupOwned = true;
        packageAssert(mkdir($fixtureRoot . '/forced-cleanup', 0700, false), 'Could not create forced cleanup fixture');
        file_put_contents($fixtureRoot . '/forced-cleanup/marker.txt', 'must be removed');
        throw new RuntimeException('Forced package-test cleanup failure');
    }

    $bashBinary = requirePackageExecutable('bash');
    $unzipBinary = requirePackageExecutable('unzip');
    $sleepBinary = requirePackageExecutable('sleep');

    $packageTestSource = file_get_contents(__FILE__);
    $legacyCleanupRootVariable = 'DEEPGLOT_PACKAGE_TEST_' . 'FIXTURE_ROOT';
    packageAssert(
        is_string($packageTestSource)
            && !str_contains($packageTestSource, $legacyCleanupRootVariable)
            && str_contains($packageTestSource, 'DEEPGLOT_PACKAGE_TEST_CLEANUP_TOKEN'),
        'Cleanup self-test must derive its fixture only from a validated random token'
    );

    $cleanupSelfTestToken = bin2hex(random_bytes(16));
    $cleanupSelfTestRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'deepglot-package-cleanup-test-' . $cleanupSelfTestToken;
    packageAssert(
        !file_exists($cleanupSelfTestRoot) && !is_link($cleanupSelfTestRoot),
        'Random cleanup self-test fixture must not already exist'
    );
    $cleanupSelfTestEnvironment = getenv();
    packageAssert(is_array($cleanupSelfTestEnvironment), 'Could not read environment for cleanup self-test');
    $cleanupSelfTestEnvironment['DEEPGLOT_PACKAGE_TEST_FORCE_FAILURE'] = '1';
    $cleanupSelfTestEnvironment['DEEPGLOT_PACKAGE_TEST_CLEANUP_TOKEN'] = $cleanupSelfTestToken;
    $cleanupSelfTest = runPackageCommand(
        [PHP_BINARY, __FILE__],
        __DIR__,
        $cleanupSelfTestEnvironment
    );
    packageAssert(
        $cleanupSelfTest['exitCode'] !== 0
            && str_contains($cleanupSelfTest['stderr'], 'Forced package-test cleanup failure')
            && !file_exists($cleanupSelfTestRoot),
        'PluginPackageBuildTest must clean its fixture before exiting after a failure'
    );

    $invalidCleanupEnvironment = $cleanupSelfTestEnvironment;
    $invalidCleanupEnvironment['DEEPGLOT_PACKAGE_TEST_CLEANUP_TOKEN'] = '../invalid';
    $invalidCleanupSelfTest = runPackageCommand(
        [PHP_BINARY, __FILE__],
        __DIR__,
        $invalidCleanupEnvironment
    );
    packageAssert(
        $invalidCleanupSelfTest['exitCode'] === 64
            && str_contains($invalidCleanupSelfTest['stderr'], 'Invalid package-test cleanup token'),
        'Cleanup self-test must reject a non-hex path token before creating a fixture'
    );

    packageAssert(is_file($builderSource), 'Release builder must exist at wordpress-plugin/build-zip.sh');
    copyPackageDirectory(__DIR__ . '/..', $fixturePlugin);
    packageAssert(copy($builderSource, $builderFixture), 'Could not copy the release builder');
    chmod($builderFixture, 0755);

    $resolverAliasDirectory = $fixtureRoot . '/resolver-alias';
    packageAssert(mkdir($resolverAliasDirectory, 0700, false), 'Could not create executable-alias fixture');
    $resolverDispatcher = '#!' . $bashBinary . "\n" . <<<'BASH'
printf '%s\n' "${0##*/}"
BASH;
    file_put_contents($resolverAliasDirectory . '/toolbox', $resolverDispatcher);
    chmod($resolverAliasDirectory . '/toolbox', 0755);
    packageAssert(
        symlink('toolbox', $resolverAliasDirectory . '/sha256sum'),
        'Could not create executable-alias symlink'
    );
    $originalPath = getenv('PATH');
    packageAssert(is_string($originalPath), 'Could not read PATH for executable-alias regression');
    putenv('PATH=' . $resolverAliasDirectory . PATH_SEPARATOR . $originalPath);
    try {
        $resolvedAlias = findPackageExecutable('sha256sum');
        packageAssert(
            $resolvedAlias === realpath($resolverAliasDirectory) . '/sha256sum',
            'Executable resolver must preserve the final alias name'
        );
        $aliasInvocation = runPackageCommand([$resolvedAlias], $fixtureRoot);
        packageAssert(
            $aliasInvocation['exitCode'] === 0 && trim($aliasInvocation['stdout']) === 'sha256sum',
            'Resolved executable alias must retain argv[0] applet dispatch'
        );
        $shaSelection = requirePackageShaUtility();
        packageAssert(
            $shaSelection['path'] === $resolvedAlias && $shaSelection['mode'] === 'sha256sum',
            'SHA utility mode must come from the selected command name, not the resolved basename'
        );
    } finally {
        putenv('PATH=' . $originalPath);
    }

    file_put_contents($fixturePlugin . '/assets/.DS_Store', 'Committed OS metadata must be excluded.');

    $commands = [
        ['git', 'init', '--quiet'],
        ['git', 'add', 'wordpress-plugin'],
        [
            'git',
            '-c', 'user.name=Deepglot Package Test',
            '-c', 'user.email=package-test@deepglot.invalid',
            'commit', '--quiet', '-m', 'Package fixture',
        ],
    ];
    foreach ($commands as $command) {
        $result = runPackageCommand($command, $fixtureRoot);
        packageAssert(
            $result['exitCode'] === 0,
            'Fixture command failed: ' . implode(' ', $command) . "\n" . $result['stderr']
        );
    }

    $revision = runPackageCommand(['git', 'rev-parse', 'HEAD'], $fixtureRoot);
    $commit = trim($revision['stdout']);
    packageAssert($revision['exitCode'] === 0 && preg_match('/^[0-9a-f]{40}$/', $commit) === 1, 'Fixture commit must be a full SHA');

    $shortRef = runPackageCommand([$bashBinary, $builderFixture, 'HEAD', $fixtureRoot . '/invalid'], $fixtureRoot);
    packageAssert($shortRef['exitCode'] !== 0, 'Release builder must reject symbolic or abbreviated revisions');

    $cleanBuilder = file_get_contents($builderFixture);
    packageAssert(is_string($cleanBuilder), 'Could not read fixture release builder');
    file_put_contents($builderFixture, $cleanBuilder . "\n# Uncommitted builder mutation.\n");
    $dirtyBuilder = runPackageCommand(
        [$bashBinary, $builderFixture, $commit, $fixtureRoot . '/invalid-dirty-builder'],
        $fixtureRoot
    );
    packageAssert(
        $dirtyBuilder['exitCode'] !== 0
            && str_contains($dirtyBuilder['stderr'], 'Release builder bytes do not match commit'),
        'Release builder must reject bytes that differ from the requested commit'
    );
    file_put_contents($builderFixture, $cleanBuilder);
    chmod($builderFixture, 0755);

    file_put_contents($fixturePlugin . '/includes/Uncommitted.php', "<?php\n// Must never enter the release archive.\n");

    $controlledCommands = ['git', 'awk', 'dirname', 'mkdir', 'mktemp', 'mv', 'rm', 'rmdir'];
    $missingShaPath = $fixtureRoot . '/path-without-sha';
    createControlledPackagePath($missingShaPath, $controlledCommands);
    $baseEnvironment = getenv();
    packageAssert(is_array($baseEnvironment), 'Could not read package-test environment');
    $missingShaEnvironment = $baseEnvironment;
    $missingShaEnvironment['PATH'] = $missingShaPath;
    $missingShaOutput = $fixtureRoot . '/dist-missing-sha';
    $missingShaBuild = runPackageCommand(
        [$bashBinary, $builderFixture, $commit, $missingShaOutput],
        $fixtureRoot,
        $missingShaEnvironment
    );
    packageAssert(
        $missingShaBuild['exitCode'] !== 0
            && str_contains($missingShaBuild['stderr'], 'A SHA-256 utility'),
        'Release builder must reject a missing SHA-256 utility'
    );
    packageAssert(!file_exists($missingShaOutput), 'SHA-256 tooling must be validated before creating the output directory');
    $missingShaRetry = runPackageCommand([$bashBinary, $builderFixture, $commit, $missingShaOutput], $fixtureRoot);
    packageAssert(
        $missingShaRetry['exitCode'] === 0,
        "Build must succeed after restoring SHA-256 tooling\n"
            . $missingShaRetry['stdout'] . $missingShaRetry['stderr']
    );

    $failingShaPath = $fixtureRoot . '/path-with-failing-sha';
    createControlledPackagePath($failingShaPath, $controlledCommands);
    file_put_contents($failingShaPath . '/sha256sum', '#!' . $bashBinary . "\nexit 91\n");
    chmod($failingShaPath . '/sha256sum', 0755);
    $failingShaEnvironment = $baseEnvironment;
    $failingShaEnvironment['PATH'] = $failingShaPath;
    $failingShaOutput = $fixtureRoot . '/dist-failing-sha';
    $failingShaBuild = runPackageCommand(
        [$bashBinary, $builderFixture, $commit, $failingShaOutput],
        $fixtureRoot,
        $failingShaEnvironment
    );
    packageAssert($failingShaBuild['exitCode'] !== 0, 'Release builder must surface a failing SHA-256 utility');
    packageAssert(
        packageDirectoryEntries($failingShaOutput) === [],
        'Failed release builds must remove final artifacts and temporary files'
    );
    $failingShaRetry = runPackageCommand([$bashBinary, $builderFixture, $commit, $failingShaOutput], $fixtureRoot);
    packageAssert(
        $failingShaRetry['exitCode'] === 0,
        "A cleaned output directory must allow a successful retry\n"
            . $failingShaRetry['stdout'] . $failingShaRetry['stderr']
    );

    $guardedZip = $failingShaOutput . '/deepglot-0.12.6.zip';
    $guardedChecksum = $guardedZip . '.sha256';
    $guardedZipHash = hash_file('sha256', $guardedZip);
    $guardedChecksumHash = hash_file('sha256', $guardedChecksum);
    $overwriteAttempt = runPackageCommand([$bashBinary, $builderFixture, $commit, $failingShaOutput], $fixtureRoot);
    packageAssert(
        $overwriteAttempt['exitCode'] === 73
            && hash_file('sha256', $guardedZip) === $guardedZipHash
            && hash_file('sha256', $guardedChecksum) === $guardedChecksumHash,
        'Overwrite guard must preserve existing release artifacts'
    );

    $parallelPath = $fixtureRoot . '/path-with-blocking-sha';
    createControlledPackagePath($parallelPath, $controlledCommands);
    $shaSelection = requirePackageShaUtility();
    $realShaUtility = $shaSelection['path'];
    $blockingShaScript = '#!' . $bashBinary . "\n" . <<<'SH'
set -eu
: > "$DEEPGLOT_HASH_READY_FILE"
while [ ! -f "$DEEPGLOT_HASH_RELEASE_FILE" ]; do
    "$DEEPGLOT_SLEEP_UTILITY" 0.01
done
if [ "$DEEPGLOT_REAL_SHA_MODE" = "shasum" ]; then
    exec "$DEEPGLOT_REAL_SHA_UTILITY" -a 256 "$@"
fi
exec "$DEEPGLOT_REAL_SHA_UTILITY" "$@"
SH;
    file_put_contents($parallelPath . '/sha256sum', $blockingShaScript);
    chmod($parallelPath . '/sha256sum', 0755);
    $parallelEnvironment = $baseEnvironment;
    $parallelEnvironment['PATH'] = $parallelPath;
    $parallelEnvironment['DEEPGLOT_HASH_READY_FILE'] = $fixtureRoot . '/parallel-hash-ready';
    $parallelEnvironment['DEEPGLOT_HASH_RELEASE_FILE'] = $fixtureRoot . '/parallel-hash-release';
    $parallelEnvironment['DEEPGLOT_REAL_SHA_UTILITY'] = $realShaUtility;
    $parallelEnvironment['DEEPGLOT_REAL_SHA_MODE'] = $shaSelection['mode'];
    $parallelEnvironment['DEEPGLOT_SLEEP_UTILITY'] = $sleepBinary;
    $parallelOutput = $fixtureRoot . '/dist-parallel';
    $parallelScript = <<<'BASH'
set -euo pipefail
builder="$1"
commit="$2"
output_directory="$3"
ready_file="$4"
release_file="$5"
bash_binary="$6"
sleep_binary="$7"
first_pid=''

release_first_build() {
    exit_status=$?
    trap - EXIT
    : > "$release_file"
    if [[ -n "$first_pid" ]]; then
        wait "$first_pid" 2>/dev/null || true
    fi
    exit "$exit_status"
}
trap release_first_build EXIT

"$bash_binary" "$builder" "$commit" "$output_directory" &
first_pid=$!
for ((attempt = 0; attempt < 500; attempt++)); do
    [[ -f "$ready_file" ]] && break
    kill -0 "$first_pid" 2>/dev/null || break
    "$sleep_binary" 0.01
done
[[ -f "$ready_file" ]]

set +e
"$bash_binary" "$builder" "$commit" "$output_directory"
collision_status=$?
set -e
if [[ $collision_status -ne 75 ]]; then
    printf 'unexpected collision status: %s\n' "$collision_status" >&2
    exit 90
fi
if [[ ! -f "$output_directory/deepglot-0.12.6.zip" || -f "$output_directory/deepglot-0.12.6.zip.sha256" ]]; then
    printf 'parallel collision changed the first build artifacts\n' >&2
    exit 91
fi

: > "$release_file"
wait "$first_pid"
first_pid=''
if [[ ! -f "$output_directory/deepglot-0.12.6.zip" || ! -f "$output_directory/deepglot-0.12.6.zip.sha256" ]]; then
    printf 'first parallel build did not complete\n' >&2
    exit 92
fi
if [[ -e "$output_directory/.deepglot-0.12.6.lock" ]]; then
    printf 'parallel build lock was not removed\n' >&2
    exit 93
fi

set +e
"$bash_binary" "$builder" "$commit" "$output_directory"
guard_status=$?
set -e
if [[ $guard_status -ne 73 ]]; then
    printf 'unexpected overwrite guard status: %s\n' "$guard_status" >&2
    exit 94
fi
if [[ -e "$output_directory/.deepglot-0.12.6.lock" ]]; then
    printf 'overwrite guard did not release the build lock\n' >&2
    exit 95
fi
BASH;
    $parallelBuild = runPackageCommand(
        [
            $bashBinary, '-c', $parallelScript, 'deepglot-parallel-build',
            $builderFixture,
            $commit,
            $parallelOutput,
            $parallelEnvironment['DEEPGLOT_HASH_READY_FILE'],
            $parallelEnvironment['DEEPGLOT_HASH_RELEASE_FILE'],
            $bashBinary,
            $sleepBinary,
        ],
        $fixtureRoot,
        $parallelEnvironment
    );
    packageAssert(
        $parallelBuild['exitCode'] === 0,
        "Parallel release lock must reject the second builder without harming the first\n"
            . $parallelBuild['stdout'] . $parallelBuild['stderr']
    );
    $parallelZip = $parallelOutput . '/deepglot-0.12.6.zip';
    packageAssert(
        file_get_contents($parallelZip . '.sha256') === hash_file('sha256', $parallelZip) . "  deepglot-0.12.6.zip\n",
        'First parallel build must retain a correct ZIP and checksum'
    );

    foreach (['utc' => 'UTC', 'honolulu' => 'Pacific/Honolulu'] as $outputName => $timezone) {
        $timezoneEnvironment = $baseEnvironment;
        $timezoneEnvironment['TZ'] = $timezone;
        $result = runPackageCommand(
            [$bashBinary, $builderFixture, $commit, $fixtureRoot . '/dist-' . $outputName],
            $fixtureRoot,
            $timezoneEnvironment
        );
        packageAssert($result['exitCode'] === 0, 'Release build failed: ' . $result['stderr']);
    }

    $firstZip = $fixtureRoot . '/dist-utc/deepglot-0.12.6.zip';
    $secondZip = $fixtureRoot . '/dist-honolulu/deepglot-0.12.6.zip';
    $firstChecksum = $fixtureRoot . '/dist-utc/deepglot-0.12.6.zip.sha256';
    packageAssert(is_file($firstZip) && is_file($secondZip), 'Expected release ZIPs were not created');
    packageAssert(hash_file('sha256', $firstZip) === hash_file('sha256', $secondZip), 'Cross-timezone builds must be byte-identical');

    $expectedChecksum = hash_file('sha256', $firstZip) . "  deepglot-0.12.6.zip\n";
    packageAssert(file_get_contents($firstChecksum) === $expectedChecksum, 'Checksum sidecar must use the relative ZIP filename');

    $archiveListing = runPackageCommand([$unzipBinary, '-Z1', $firstZip], $fixtureRoot);
    packageAssert($archiveListing['exitCode'] === 0, 'Release ZIP must be readable by unzip');
    $archiveEntries = array_values(array_filter(explode("\n", trim($archiveListing['stdout']))));
    foreach ($archiveEntries as $entry) {
        packageAssert(str_starts_with($entry, 'deepglot/'), 'Every archive entry must use the deepglot/ root');
        packageAssert(!str_contains($entry, '/tests/'), 'Plugin tests must not enter the release archive');
        packageAssert(!str_contains($entry, 'DYNAMIC_TRANSLATION_QA.md'), 'QA documents must not enter the release archive');
        packageAssert(!str_contains($entry, '.DS_Store'), 'OS metadata must not enter the release archive');
        packageAssert(!str_contains($entry, 'Uncommitted.php'), 'Uncommitted files must not enter the release archive');
    }
    packageAssert(in_array('deepglot/LICENSE', $archiveEntries, true), 'Plugin LICENSE must enter the release archive');

    $tree = runPackageCommand(
        ['git', 'ls-tree', '-r', '--name-only', $commit . ':wordpress-plugin/deepglot'],
        $fixtureRoot
    );
    packageAssert($tree['exitCode'] === 0, 'Could not inspect fixture commit tree');
    $expectedFiles = [];
    foreach (array_filter(explode("\n", trim($tree['stdout']))) as $path) {
        if (
            in_array($path, ['deepglot.php', 'bootstrap.php', 'README.md', 'readme.txt', 'LICENSE'], true)
            || preg_match('#^(assets|includes|languages)/#', $path) === 1
        ) {
            if (preg_match('#(^|/)(\.DS_Store|Thumbs\.db|\._[^/]*)$#', $path) === 1) {
                continue;
            }
            $expectedFiles[] = 'deepglot/' . $path;
        }
    }
    sort($expectedFiles);
    $actualFiles = array_values(array_filter($archiveEntries, static fn (string $entry): bool => !str_ends_with($entry, '/')));
    sort($actualFiles);
    packageAssert($actualFiles === $expectedFiles, 'Release ZIP contents must exactly match the runtime allowlist');

    $extractDirectory = $fixtureRoot . '/extracted';
    mkdir($extractDirectory);
    $extract = runPackageCommand([$unzipBinary, '-qq', $firstZip, '-d', $extractDirectory], $fixtureRoot);
    packageAssert($extract['exitCode'] === 0, 'Release ZIP must extract successfully');

    $phpFiles = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($extractDirectory . '/deepglot', FilesystemIterator::SKIP_DOTS)
    );
    foreach ($phpFiles as $file) {
        if ($file->isFile() && $file->getExtension() === 'php') {
            $lint = runPackageCommand([PHP_BINARY, '-l', $file->getPathname()], $fixtureRoot);
            packageAssert($lint['exitCode'] === 0, 'Packaged PHP lint failed: ' . $lint['stderr']);
        }
    }

    packageAssert(symlink('../deepglot.php', $fixturePlugin . '/includes/CommittedSymlink.php'), 'Could not create symlink fixture');
    $addSymlink = runPackageCommand(['git', 'add', 'wordpress-plugin/deepglot/includes/CommittedSymlink.php'], $fixtureRoot);
    packageAssert($addSymlink['exitCode'] === 0, 'Could not stage symlink fixture');
    $commitSymlink = runPackageCommand(
        [
            'git',
            '-c', 'user.name=Deepglot Package Test',
            '-c', 'user.email=package-test@deepglot.invalid',
            'commit', '--quiet', '-m', 'Add invalid package symlink',
        ],
        $fixtureRoot
    );
    packageAssert($commitSymlink['exitCode'] === 0, 'Could not commit symlink fixture');
    $symlinkRevision = runPackageCommand(['git', 'rev-parse', 'HEAD'], $fixtureRoot);
    $symlinkCommit = trim($symlinkRevision['stdout']);
    packageAssert(preg_match('/^[0-9a-f]{40}$/', $symlinkCommit) === 1, 'Symlink fixture commit must be a full SHA');
    $symlinkBuild = runPackageCommand(
        [$bashBinary, $builderFixture, $symlinkCommit, $fixtureRoot . '/invalid-symlink'],
        $fixtureRoot
    );
    packageAssert(
        $symlinkBuild['exitCode'] !== 0
            && str_contains($symlinkBuild['stderr'], 'Unsupported Git mode or type in package allowlist')
            && str_contains($symlinkBuild['stderr'], 'includes/CommittedSymlink.php'),
        "Release builder must reject committed symlinks in the allowlist\n"
            . $symlinkBuild['stdout'] . $symlinkBuild['stderr']
    );

    fwrite(STDOUT, "PluginPackageBuildTest: OK\n");
} catch (Throwable $error) {
    fwrite(STDERR, '✗ ' . $error->getMessage() . PHP_EOL);
    $testExitCode = 1;
} finally {
    if ($fixtureCleanupOwned) {
        removePackageDirectory($fixtureRoot);
    }
}

exit($testExitCode);
