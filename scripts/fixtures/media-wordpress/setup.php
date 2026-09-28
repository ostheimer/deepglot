<?php
if (!defined('WP_CLI') || !WP_CLI) { exit; }
if (wp_using_ext_object_cache()) { throw new RuntimeException('Use unique fixture texts or an object-cache-specific snapshot before running this fixture.'); }
$slug='deepglot-media-acceptance-20260928';
if (get_page_by_path($slug)) { throw new RuntimeException('Fixture slug already exists; refusing overwrite.'); }
if (get_option('deepglot_media_acceptance_cache_snapshot', null) !== null) { throw new RuntimeException('Fixture cache snapshot already exists.'); }
$cache=new Deepglot\Support\TranslationCache();
$t=['Medienprüfung'=>'Media acceptance','Neutrale Medienprüfung'=>'Neutral media acceptance','Temporäre Testseite mit eigenen neutralen Medien.'=>'Temporary test page with our own neutral media.','Deepglot fixture: Bilder'=>'Deepglot fixture: Images','Deepglot fixture: Dokumente'=>'Deepglot fixture: Documents','Deepglot fixture: Videos'=>'Deepglot fixture: Videos','Deepglot fixture: Einbettungen'=>'Deepglot fixture: Embeds','Neutrales Testbild'=>'Neutral test image','Unverändertes Testbild'=>'Unchanged test image','Test-PDF'=>'Test PDF','Test-Dokument'=>'Test document','Nur URL-Prüfung, keine Verbindung zu Drittanbietern.'=>'URL verification only, no connection to third parties.','YouTube URL fixture'=>'YouTube URL fixture','YouTube privacy URL fixture'=>'YouTube privacy URL fixture','Vimeo URL fixture'=>'Vimeo URL fixture'];
$snapshot=[];
foreach(array_keys($t) as $text){$key='dgv1_'.sha1('de|en|'.$text);$snapshot[$key]=['value'=>get_transient($key),'expires'=>(int)get_option('_transient_timeout_'.$key,0)];}
if(!add_option('deepglot_media_acceptance_cache_snapshot',$snapshot,'',false)){throw new RuntimeException('Cannot persist fixture cache snapshot.');}
$cache->setMany($t,'de','en');
$id=wp_insert_post(['post_type'=>'page','post_status'=>'publish','post_title'=>'Deepglot disposable media acceptance','post_name'=>$slug,'post_content'=>'Disposable media acceptance fixture.'],true);
if(is_wp_error($id)){throw new RuntimeException($id->get_error_message());}
update_post_meta($id,'_deepglot_disposable_acceptance',true);
update_option('deepglot_media_acceptance_blocked_requests',0,false);
echo json_encode(['pageId'=>$id,'url'=>get_permalink($id),'cacheEntries'=>count($t)]);
