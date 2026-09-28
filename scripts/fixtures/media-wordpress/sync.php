<?php
if (!defined('WP_CLI') || !WP_CLI) { exit; }
$o=new Deepglot\Config\Options();$c=new Deepglot\Api\Client($o);$sync=new Deepglot\Sync\SettingsSync($o,$c);$r=$sync->refreshRuntimeConfig(null,null,true);
if(is_wp_error($r)){echo json_encode(['error'=>$r->get_error_code(),'message'=>$r->get_error_message()]);exit(1);}
echo json_encode(['media'=>get_option('deepglot_media_replacements',[]),'source'=>$o->getSourceLanguage(),'targets'=>$o->getTargetLanguages(),'blockedFixtureApiRequests'=>get_option('deepglot_media_acceptance_blocked_requests',0)]);
