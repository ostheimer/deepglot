<?php
/**
 * Plugin Name: Deepglot
 * Plugin URI: https://deepglot.ai
 * Description: Übersetzt WordPress-Inhalte mit Deepglot und einer kompatiblen Übersetzungs-API.
 * Version: 0.11.6
 * Author: Andreas Ostheimer
 * Author URI: https://www.ostheimer.at
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: deepglot
 * Domain Path: /languages
 * Requires at least: 6.0
 * Requires PHP: 8.0
 */

defined('ABSPATH') || exit;

define('DEEPGLOT_PLUGIN_FILE', __FILE__);
define('DEEPGLOT_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('DEEPGLOT_PLUGIN_URL', plugin_dir_url(__FILE__));
define('DEEPGLOT_PLUGIN_VERSION', '0.11.6');

require_once DEEPGLOT_PLUGIN_DIR . 'includes/Autoloader.php';

$deepglotAutoloader = new \Deepglot\Autoloader(DEEPGLOT_PLUGIN_DIR . 'includes');
$deepglotAutoloader->register();

register_activation_hook(__FILE__, ['Deepglot\\Plugin', 'activate']);

$GLOBALS['deepglot_plugin'] = require DEEPGLOT_PLUGIN_DIR . 'bootstrap.php';
