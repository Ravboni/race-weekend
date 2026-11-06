const assert = require('assert');
const test = require('node:test');
const manifest = require('../service/pip-manifest');
const source = 'https://f1prodlive.akamaized.net/out/v1/event/manifest.mpd?token=private';
function mpd(content, extra) { return '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" '+(extra||'')+'>'+content+'</MPD>'; }
function period(extra) { return '<Period><AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.640028" frameRate="50"><SegmentTemplate media="video-$RepresentationID$-$Time$.m4s" initialization="init-$RepresentationID$.mp4"><SegmentTimeline><S t="0" d="1000" r="5"/></SegmentTimeline></SegmentTemplate><Representation id="sd" width="960" height="540" bandwidth="1000"/><Representation id="hd" width="1280" height="720" bandwidth="2000"/><Representation id="full" width="1920" height="1080" bandwidth="3000"/></AdaptationSet><AdaptationSet contentType="audio" lang="por" codecs="mp4a.40.2"><Representation id="audio-por"/></AdaptationSet><AdaptationSet mimeType="audio/mp4" lang="eng"><Representation id="audio-eng"/></AdaptationSet>'+(extra||'')+'</Period>'; }
function filter(xml, height) { return manifest.filter(xml, source, {maxHeight:height||720,maxFrameRate:50}); }
test('caps AVC video and preserves timing and every audio language', () => {
 const result=filter(mpd(period()));
 // The compatible ladder below the cap stays available for native ABR.
 assert.equal(result.height,720); assert.match(result.xml,/id="hd"/); assert.match(result.xml,/id="sd"/); assert.doesNotMatch(result.xml,/id="full"/);
 assert.match(result.xml,/lang="por"/); assert.match(result.xml,/lang="eng"/); assert.match(result.xml,/<S t="0" d="1000" r="5"/);
 assert.match(result.xml,/<BaseURL>https:\/\/f1prodlive.akamaized.net\/out\/v1\/event\/<\/BaseURL>/);
});
test('filters every period and removes manifest escape paths from dynamic MPD', () => {
 const xml=mpd('<Location>https://f1prodlive.akamaized.net/original.mpd</Location><PatchLocation>patch.xml</PatchLocation>'+period()+period()).replace('type="static"','type="dynamic" minimumUpdatePeriod="PT2S" availabilityStartTime="2026-01-01T00:00:00Z"');
 const result=filter(xml); assert.equal((result.xml.match(/id="hd"/g)||[]).length,2); assert.match(result.xml,/minimumUpdatePeriod="PT2S"/); assert.doesNotMatch(result.xml,/<Location|<PatchLocation|id="full"/);
});
test('resolves existing root BaseURL rather than inserting conflicting alternatives', () => {
 const result=filter(mpd('<BaseURL>../media/</BaseURL>'+period())); assert.match(result.xml,/<BaseURL>https:\/\/f1prodlive.akamaized.net\/out\/v1\/media\/<\/BaseURL>/); assert.equal((result.xml.match(/<BaseURL>/g)||[]).length,1);
});
test('rejects protected, malformed, oversized and remotely injected periods', () => {
 assert.throws(()=>filter(mpd(period('<ContentProtection schemeIdUri="x"/>'))),/protected/i);
 assert.throws(()=>filter('<MPD><Period></MPD>'),/manifest/i);
 assert.throws(()=>filter('<!DOCTYPE MPD [<!ENTITY e SYSTEM "file:///etc/passwd">]>'+mpd(period())),/manifest/i);
 assert.throws(()=>filter(mpd(period())+' '.repeat(2100000)),/large/i);
 assert.throws(()=>filter(mpd(period()).replace('<Period>','<Period xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="other.mpd">')),/external/i);
});
test('never allows HEVC, oversize width, missing dimensions or >50fps fallback', () => {
 for (const xml of [mpd(period()).replace(/avc1.640028/g,'hvc1.1.6.L120'),mpd(period()).replace(/width="\d+"/g,'width="4096"'),mpd(period()).replace(/height="\d+"/g,''),mpd(period()).replace('frameRate="50"','frameRate="60"')]) assert.throws(()=>filter(xml),/representation/i);
 assert.equal(filter(mpd(period()).replace('frameRate="50"','frameRate="50000/1000"'),540).height,540);
});
test('URL allowlist rejects credentials, ports, non-TLS and deceptive domains', () => {
 assert(manifest.allowedURL(source)); assert(manifest.allowedURL('https://stream.formula1.com/live.mpd'));
 for (const url of ['http://f1prodlive.akamaized.net/a','https://f1prodlive.akamaized.net:444/a','https://user:pass@f1prodlive.akamaized.net/a','https://formula1.com.evil.test/a','https://127.0.0.1/a','https://evilformula1.com/a','https://f1prodlive.akamaized.net/a#fragment']) assert.equal(manifest.allowedURL(url),null,url);
});
test('only bounded resolution/frame-rate options are accepted', () => {
 assert.throws(()=>manifest.filter(mpd(period()),source,{maxHeight:2160,maxFrameRate:50}),/limit/i);
 assert.throws(()=>manifest.filter(mpd(period()),source,{maxHeight:720,maxFrameRate:60}),/limit/i);
});

test('rejects nested private/external media links while retaining relative templates', () => {
 assert.throws(()=>filter(mpd(period()).replace('<Representation id="hd"','<BaseURL>http://127.0.0.1/private/</BaseURL><Representation id="hd"')),/base URL/);
 assert.throws(()=>filter(mpd(period()).replace('media="video-$RepresentationID$-$Time$.m4s"','media="https://untrusted.example/segment.m4s"')),/media URL/);
 assert.match(filter(mpd(period()).replace('media="video-$RepresentationID$-$Time$.m4s"','media="/media/video-$Number%05d$.m4s"')).xml,/media="\/media\/video-\$Number%05d\$\.m4s"/);
});
