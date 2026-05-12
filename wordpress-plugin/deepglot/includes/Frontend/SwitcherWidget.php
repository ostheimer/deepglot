<?php

namespace Deepglot\Frontend;

use WP_Widget;

/**
 * Classic WP_Widget that lets a site owner drop the Deepglot language
 * switcher into any sidebar / widget area. Matches the UX of Weglot's
 * Widget_Selector_Weglot so existing customer expectations carry over.
 *
 * WordPress instantiates widget classes itself (no constructor args)
 * via register_widget(), so we use a static bind() to inject the
 * LanguageSwitcher dependency once at plugin boot time.
 */
class SwitcherWidget extends WP_Widget
{
    /** @var LanguageSwitcher|null */
    private static ?LanguageSwitcher $boundSwitcher = null;

    public function __construct()
    {
        parent::__construct(
            'deepglot_switcher',
            __('Deepglot Sprachschalter', 'deepglot'),
            ['description' => __('Sprachumschalter in einer Widget-Area anzeigen.', 'deepglot')]
        );
    }

    /**
     * Inject the LanguageSwitcher instance. Must be called before
     * register_widget(). WP-CLI / unit-test friendly.
     */
    public static function bind(LanguageSwitcher $switcher): void
    {
        self::$boundSwitcher = $switcher;
    }

    /**
     * Hook the widget into widgets_init so WP registers it on every
     * admin and frontend request.
     */
    public static function register(): void
    {
        add_action('widgets_init', static function (): void {
            register_widget(self::class);
        });
    }

    /**
     * Frontend render.
     *
     * @param array<string,mixed> $args
     * @param array<string,mixed> $instance
     */
    public function widget($args, $instance)
    {
        $title = isset($instance['title']) ? (string) apply_filters('widget_title', $instance['title']) : '';
        $body  = self::$boundSwitcher !== null ? self::$boundSwitcher->renderShortcode([]) : '';

        // Open wrapper.
        echo $args['before_widget'] ?? ''; // phpcs:ignore WordPress.Security.EscapeOutput

        if ($title !== '') {
            echo ($args['before_title'] ?? '') . esc_html($title) . ($args['after_title'] ?? ''); // phpcs:ignore WordPress.Security.EscapeOutput
        }

        echo $body; // phpcs:ignore WordPress.Security.EscapeOutput
        echo $args['after_widget'] ?? ''; // phpcs:ignore WordPress.Security.EscapeOutput
    }

    /**
     * Admin form.
     *
     * @param array<string,mixed> $instance
     */
    public function form($instance)
    {
        $title = isset($instance['title']) ? (string) $instance['title'] : '';
        ?>
        <p>
            <label for="<?php echo esc_attr($this->get_field_id('title')); ?>">
                <?php esc_html_e('Titel:', 'deepglot'); ?>
            </label>
            <input
                class="widefat"
                id="<?php echo esc_attr($this->get_field_id('title')); ?>"
                name="<?php echo esc_attr($this->get_field_name('title')); ?>"
                type="text"
                value="<?php echo esc_attr($title); ?>"
            />
        </p>
        <?php
    }

    /**
     * Sanitise saved instance.
     *
     * @param array<string,mixed> $new_instance
     * @param array<string,mixed> $old_instance
     * @return array<string,mixed>
     */
    public function update($new_instance, $old_instance)
    {
        $rawTitle = isset($new_instance['title']) ? (string) $new_instance['title'] : '';
        return [
            'title' => sanitize_text_field(wp_strip_all_tags($rawTitle)),
        ];
    }
}
