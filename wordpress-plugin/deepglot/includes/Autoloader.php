<?php

namespace Deepglot;

class Autoloader
{
    private string $baseDir;

    public function __construct(string $baseDir)
    {
        $this->baseDir = rtrim($baseDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    }

    public function register(): void
    {
        spl_autoload_register([$this, 'loadClass']);
    }

    public function loadClass(string $className): void
    {
        if (strpos($className, 'Deepglot\\') !== 0) {
            return;
        }

        $relativeClass = substr($className, strlen('Deepglot\\'));
        $relativePath = str_replace('\\', DIRECTORY_SEPARATOR, $relativeClass) . '.php';
        $file = $this->baseDir . $relativePath;

        if (is_readable($file)) {
            require_once $file;
        }
    }
}
