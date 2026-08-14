<?php

namespace Deepglot\Frontend;

/**
 * Owns the pre-WordPress-6.9 output-buffer fallback from start through cleanup.
 */
final class LegacyTemplateRenderer
{
    private static ?string $template = null;

    /** @var (\Closure(string): string)|null */
    private static ?\Closure $processor = null;

    /**
     * @param \Closure(string): string $processor
     */
    public static function prepare(string $template, \Closure $processor): string
    {
        self::$template = $template;
        self::$processor = $processor;

        return __DIR__ . '/LegacyTemplateWrapper.php';
    }

    /**
     * Renders the pending WordPress template and restores the previous buffer
     * level even if template execution fails.
     */
    public static function renderPending(): void
    {
        $template = self::$template;
        $processor = self::$processor;

        if ($template === null || $processor === null) {
            return;
        }

        $initialBufferLevel = ob_get_level();
        $output = '';

        ob_start();

        try {
            include $template;

            // A theme or plugin may open a nested buffer while rendering the
            // template. Flush it into Deepglot's owned buffer first, otherwise
            // the cleanup call would close the wrong buffer and lose earlier
            // template output.
            while (ob_get_level() > $initialBufferLevel + 1) {
                if (!ob_end_flush()) {
                    break;
                }
            }

            $capturedOutput = ob_get_clean();
            $output = is_string($capturedOutput) ? $capturedOutput : '';
        } finally {
            while (ob_get_level() > $initialBufferLevel) {
                if (!ob_end_clean()) {
                    break;
                }
            }

            self::$template = null;
            self::$processor = null;
        }

        try {
            $processedOutput = $processor($output);
        } catch (\Throwable $exception) {
            $processedOutput = $output;
        }

        // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Complete rendered template HTML, processed by Deepglot's DOM pipeline.
        echo is_string($processedOutput) ? $processedOutput : $output;
    }
}
