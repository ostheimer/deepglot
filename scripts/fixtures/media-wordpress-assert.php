<?php
/** Verify captured anonymous HTML; never fetches third-party embed providers. */
declare(strict_types=1);
if ($argc !== 4 || !in_array($argv[2], ['de','en'], true) || !in_array($argv[3], ['de','en','en-v2'], true)) {
    fwrite(STDERR,"Usage: php media-wordpress-assert.php <html-file> <page-language> <asset-language>\n");exit(2);
}
[$script,$file,$lang,$asset]=$argv;
$d=new DOMDocument();libxml_use_internal_errors(true);$d->loadHTML(file_get_contents($file));libxml_clear_errors();
$x=new DOMXPath($d);$p='/wp-content/uploads/deepglot-media-acceptance-20260928/';
function same($actual,$expected,$label):void {if($actual!==$expected){fwrite(STDERR,"FAIL $label: ".json_encode(['actual'=>$actual,'expected'=>$expected])."\n");exit(1);}}
function attr(DOMDocument $d,string $id,string $name):string { $el=$d->getElementById($id);if(!$el){throw new RuntimeException("Missing $id");}return $el->getAttribute($name); }
same($d->documentElement->getAttribute('lang'),$lang,'html language');
same(attr($d,'direct','src'),$p.$asset.'.png','image src');
same(attr($d,'direct','width'),'480','image width');same(attr($d,'direct','height'),'240','image height');
same(attr($d,'direct','alt'),$lang==='en'?'Neutral test image':'Neutrales Testbild','translated alt');
same(attr($d,'lazy','data-src'),$p.$asset.'.png','lazy URL');
same(attr($d,'lazy','data-srcset'),$p.$asset.'.png 480w','lazy srcset descriptor');
same(attr($d,'picture','srcset'),$p.$asset.'.png 480w, '.$p.'unmapped.png 960w','picture fallback and widths');
same(attr($d,'picture','type'),'image/png','picture MIME');
same(attr($d,'responsive','srcset'),$p.$asset.'.png 1x, '.$p.'unmapped.png 2x','density descriptors');
$absolute=attr($d,'responsive','src');same(parse_url($absolute,PHP_URL_PATH),$p.$asset.'.png','absolute image URL');
same(attr($d,'fallback','src'),$p.'unmapped.png','unmapped image fallback');
$docAsset=$asset==='de'?'de':'en';
foreach(['pdf'=>'pdf','document'=>'docx'] as $id=>$ext){same(attr($d,$id,'href'),$p.$docAsset.'.'.$ext,'document '.$ext);same($d->getElementById($id)->hasAttribute('download'),true,'download preserved');}
same(attr($d,'mp4','src'),$p.$docAsset.'.mp4','video src');
same(attr($d,'webm','src'),$p.$docAsset.'.webm','video source');same(attr($d,'webm','data-src'),$p.$docAsset.'.webm','lazy video source');same(attr($d,'webm','type'),'video/webm','video MIME');
$embedAsset=$asset==='de'?'de':'en';
foreach(['youtube'=>['www.youtube.com','DgMediaDE01','DgMediaEN01'],'nocookie'=>['www.youtube-nocookie.com','DgMediaDE01','DgMediaEN01'],'vimeo'=>['player.vimeo.com','98765432101','98765432102']] as $id=>$parts){[$host,$de,$en]=$parts;$path=$id==='vimeo'?'/video/':'/embed/';same(attr($d,$id,'data-src'),'https://'.$host.$path.($embedAsset==='de'?$de:$en),'embed '.$id);same(attr($d,$id,'src'),'','embed must not load provider');}
same($x->evaluate('string(//title)'),$lang==='en'?'Media acceptance':'Medienprüfung','SEO title');
same($x->evaluate('string(//meta[@name="description"]/@content)'),$lang==='en'?'Neutral media acceptance':'Neutrale Medienprüfung','SEO description');
$j=json_decode($x->evaluate('string(//script[@type="application/ld+json"])'),true,512,JSON_THROW_ON_ERROR);
same($j['headline'],$lang==='en'?'Media acceptance':'Medienprüfung','JSON-LD translation');
same(parse_url($j['image'],PHP_URL_PATH),$p.'de.png','JSON-LD shared media identity');
same($x->evaluate('string(//meta[@name="robots"]/@content)'),'noindex,nofollow','fixture noindex');
echo "OK: $lang HTML / $asset assets; responsive, lazy, document, video, embeds, text, alt, SEO, JSON-LD, fallback.\n";
