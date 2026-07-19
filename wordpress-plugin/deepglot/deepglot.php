<?php
/**
 * Plugin Name: Deepglot
 * Plugin URI: https://deepglot.ai
 * Description: AI-powered website translation with SEO-friendly URLs, hreflang tags, and a customizable language switcher.
 * Version: 0.10.1
 * Author: Andreas Ostheimer
 * Author URI: https://www.ostheimer.at
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: deepglot
 * Domain Path: /languages
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

defined('ABSPATH') || exit;

define('DEEPGLOT_PLUGIN_FILE', __FILE__);
define('DEEPGLOT_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('DEEPGLOT_PLUGIN_URL', plugin_dir_url(__FILE__));
define('DEEPGLOT_PLUGIN_VERSION', '0.10.1');

require_once DEEPGLOT_PLUGIN_DIR . 'includes/Autoloader.php';

$deepglotAutoloader = new \Deepglot\Autoloader(DEEPGLOT_PLUGIN_DIR . 'includes');
$deepglotAutoloader->register();

register_activation_hook(__FILE__, ['Deepglot\\Plugin', 'activate']);

$GLOBALS['deepglot_plugin'] = require DEEPGLOT_PLUGIN_DIR . 'bootstrap.php';
