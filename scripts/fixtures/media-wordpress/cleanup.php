<?php
if (!defined('WP_CLI') || !WP_CLI) { exit; }
$slug='deepglot-media-acceptance-20260928';$post=get_page_by_path($slug);
if(!$post||!get_post_meta($post->ID,'_deepglot_disposable_acceptance',true)){throw new RuntimeException('Refusing cleanup of an unowned page.');}
require_once __DIR__.'/support.php';
$media=get_option('deepglot_media_replacements',[]);
foreach($media as $mappings){
    foreach($mappings as $original=>$localized){
        if(dg_media_acceptance_owns_url($original)||dg_media_acceptance_owns_url($localized)){
            throw new RuntimeException('Remove and sync dashboard fixtures before cleanup.');
        }
    }
}
$blocked=(int)get_option('deepglot_media_acceptance_blocked_requests',0);
$snapshot=get_option('deepglot_media_acceptance_cache_snapshot',null);
if(!is_array($snapshot)){throw new RuntimeException('Fixture cache snapshot missing; inspect before removing cache entries.');}
require __DIR__.'/purge.php';
dg_media_acceptance_restore_cache($snapshot);
delete_option('deepglot_media_acceptance_cache_snapshot');
wp_delete_post($post->ID,true);
delete_option('deepglot_media_acceptance_blocked_requests');
echo json_encode(['deletedOwnPage'=>$post->ID,'remainingFixturePage'=>get_page_by_path($slug)!==null,'remainingMediaCount'=>count(get_option('deepglot_media_replacements',[])),'blockedFixtureRequests'=>$blocked,'sourcePostsUntouched'=>true]);
