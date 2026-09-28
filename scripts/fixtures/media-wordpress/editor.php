<?php
if (!defined('WP_CLI') || !WP_CLI) { exit; }
$o=new Deepglot\Config\Options();$cache=new Deepglot\Support\TranslationCache();$translator=new Deepglot\Frontend\HtmlTranslator(new Deepglot\Api\Client($o),$o,$cache);
ob_start();include __DIR__.'/template.php';$html=ob_get_clean();
$before=(int)get_option('deepglot_media_acceptance_blocked_requests',0);
$result=$translator->translateForEditor($html,'en',home_url('/deepglot-media-acceptance-20260928/'));
$d=new DOMDocument();libxml_use_internal_errors(true);$d->loadHTML($result['html']);libxml_clear_errors();(new Deepglot\Frontend\MediaRewriter($o))->rewrite($d,'en');
if(count($result['segments'])===0||$d->getElementById('direct')->getAttribute('src')!=='/wp-content/uploads/deepglot-media-acceptance-20260928/en-v2.png'){throw new RuntimeException('Editor annotations or media mapping failed.');}
$after=(int)get_option('deepglot_media_acceptance_blocked_requests',0);if($before!==$after){throw new RuntimeException('Unexpected editor translation request.');}
echo json_encode(['editorSegments'=>count($result['segments']),'mediaReplacementWithEditorAnnotations'=>true,'providerRequests'=>0,'boundary'=>'Installed WordPress translator/rewriter; authenticated editor save authorization remains covered by CI.']);
