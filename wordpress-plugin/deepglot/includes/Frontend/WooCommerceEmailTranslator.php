<?php

namespace Deepglot\Frontend;

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Support\SiteRouting;

class WooCommerceEmailTranslator
{
    private const ORDER_LANGUAGE_META_KEY = '_deepglot_checkout_language';

    /**
     * @var string[]
     */
    private const STANDARD_EMAIL_IDS = [
        'new_order',
        'cancelled_order',
        'failed_order',
        'customer_on_hold_order',
        'customer_processing_order',
        'customer_completed_order',
        'customer_refunded_order',
        'customer_invoice',
        'customer_note',
        'customer_reset_password',
        'customer_new_account',
    ];

    private Options $options;
    private SiteRouting $routing;
    private Client $client;
    private HtmlTranslator $htmlTranslator;

    private ?string $currentEmailLanguage = null;
    private bool $currentEmailIsHtml = false;

    public function __construct(Options $options, SiteRouting $routing, Client $client, HtmlTranslator $htmlTranslator)
    {
        $this->options = $options;
        $this->routing = $routing;
        $this->client = $client;
        $this->htmlTranslator = $htmlTranslator;
    }

    public function register(): void
    {
        if (!class_exists('WooCommerce')) {
            return;
        }

        add_action('woocommerce_checkout_create_order', [$this, 'storeCheckoutLanguage'], 10, 2);
        add_action('woocommerce_email_header', [$this, 'captureEmailContext'], 5, 2);
        add_action('woocommerce_email_footer', [$this, 'clearEmailContext'], 99, 1);
        add_filter('woocommerce_mail_content', [$this, 'translateMailContent'], 10, 1);

        foreach (self::STANDARD_EMAIL_IDS as $emailId) {
            add_filter('woocommerce_email_subject_' . $emailId, [$this, 'translateEmailSubject'], 10, 2);
            add_filter('woocommerce_email_heading_' . $emailId, [$this, 'translateEmailHeading'], 10, 2);
        }
    }

    public function storeCheckoutLanguage($order, $data): void
    {
        if (!$this->isEnabled() || !is_object($order) || !method_exists($order, 'update_meta_data')) {
            return;
        }

        $language = $this->detectCheckoutLanguage();
        $order->update_meta_data(self::ORDER_LANGUAGE_META_KEY, $language);
    }

    public function captureEmailContext($heading, $email): void
    {
        if (!$this->isEnabled() || !is_object($email)) {
            return;
        }

        $order = property_exists($email, 'object') ? $email->object : null;
        $this->currentEmailLanguage = $this->resolveOrderLanguage($order);
        $this->currentEmailIsHtml = property_exists($email, 'plain_text') ? !$email->plain_text : true;
    }

    public function clearEmailContext($email): void
    {
        $this->currentEmailLanguage = null;
        $this->currentEmailIsHtml = false;
    }

    public function translateMailContent(string $content): string
    {
        if (!$this->isEnabled() || !$this->currentEmailIsHtml || $content === '') {
            return $content;
        }

        $language = $this->currentEmailLanguage ?? $this->options->getSourceLanguage();

        if ($language === $this->options->getSourceLanguage()) {
            return $content;
        }

        return $this->htmlTranslator->translate($content, $language);
    }

    public function translateEmailSubject(string $subject, $order): string
    {
        return $this->translatePlainText($subject, $this->resolveOrderLanguage($order));
    }

    public function translateEmailHeading(string $heading, $order): string
    {
        return $this->translatePlainText($heading, $this->resolveOrderLanguage($order));
    }

    private function translatePlainText(string $text, string $language): string
    {
        if (!$this->isEnabled() || $text === '' || $language === $this->options->getSourceLanguage()) {
            return $text;
        }

        $result = $this->client->translate([$text], $this->options->getSourceLanguage(), $language);

        if (is_wp_error($result) || empty($result['to_words'][0])) {
            return $text;
        }

        return (string) $result['to_words'][0];
    }

    private function resolveOrderLanguage($order): string
    {
        $sourceLanguage = $this->options->getSourceLanguage();

        if (!is_object($order) || !method_exists($order, 'get_meta')) {
            return $sourceLanguage;
        }

        $language = strtolower(trim((string) $order->get_meta(self::ORDER_LANGUAGE_META_KEY)));
        $supportedTargets = $this->routing->getTargetLanguages();

        if ($language !== '' && in_array($language, $supportedTargets, true)) {
            return $language;
        }

        return $sourceLanguage;
    }

    private function detectCheckoutLanguage(): string
    {
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $host = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
        $detected = $this->routing->detectLanguage($uri, $host);
        $supportedTargets = $this->routing->getTargetLanguages();

        if ($detected !== null && in_array($detected, $supportedTargets, true)) {
            return $detected;
        }

        return $this->options->getSourceLanguage();
    }

    private function isEnabled(): bool
    {
        return $this->options->isEnabled() && $this->options->isConfigured() && $this->options->shouldTranslateEmails();
    }
}
