<?php
if (!defined('WP_CLI') || !WP_CLI) { exit; }
$slug='deepglot-media-acceptance-20260928';$post=get_page_by_path($slug);
if(!$post||!get_post_meta($post->ID,'_deepglot_disposable_acceptance',true)){throw new RuntimeException('Disposable fixture missing.');}
add_filter('wpe_purge_varnish_cache_paths',static fn($paths,$id)=>$id===$post->ID?['^/('.'en/'.')?'.$slug.'/.*$']:$paths,PHP_INT_MAX,2);
if(class_exists('WpeCommon')){$result=WpeCommon::purge_varnish_cache($post->ID,true);echo json_encode(['fixtureCachePurgeRequested'=>true,'result'=>$result]);}else{echo json_encode(['fixtureCachePurgeRequested'=>false]);}
