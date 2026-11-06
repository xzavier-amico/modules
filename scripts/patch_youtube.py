#!/usr/bin/env python3
"""Patch gholts YouTube scripts for Egern/Loon compat.

Two kinds of changes are applied:

1. Surge -> Egern/Loon runtime compatibility ($done normalization, 5 MiB guard).
2. Feature extraction: hard-coded behavior is made configurable with the same
   snake_case parameter names used by the Loon plugin / Egern module.  Every
   replacement asserts that it matched exactly once, so an upstream rewrite
   fails the update instead of silently shipping an unpatched script.

Defaults keep the original behavior.  The script is idempotent: patched files
are recognized by a marker and skipped on subsequent runs.
"""
import sys
import pathlib
import re

# snake_case (Loon / Egern) -> camelCase (upstream script keys)
ARG_KEYS = {
    "block_upload": "blockUpload",
    "block_shorts": "blockShorts",
    "block_shorts_feed": "blockShortsFeed",
    "block_members_only": "blockMembersOnly",
    "auto_hd": "autoHd",
    "block_games": "blockGames",
    "block_vertical_live": "blockVerticalLive",
    "jump_ahead": "jumpAhead",
    "block_store": "blockStore",
    "block_ai": "blockAi",
    "on_the_go": "onTheGo",
    "background_play": "backgroundPlay",
    "pip": "pip",
    "max_speed": "maxSpeed",
    "hide_premium": "hidePremium",
    "prefer_premium": "preferPremium",
    "max_height": "maxHeight",
    "block_player_ads": "blockPlayerAds",
    "block_feed_ads": "blockFeedAds",
    "block_shorts_ads": "blockShortsAds",
    "remove_paid_promotion": "removePaidPromotion",
    "block_ad_tracking": "blockAdTracking",
    "block_guide_items": "blockGuideItems",
    "on_the_go_audio": "onTheGoAudio",
    "on_the_go_chapters": "onTheGoChapters",
    "strip_hot_hash": "stripHotHash",
}

# Scans a decoded VideoLockup message for an exact members-only badge text.
# The protobuf field numbers for the new lockup metadata are not modelled, so
# walk the raw bytes and compare complete string fields against known labels.
MEMBERS_ONLY_HELPER = (
    'const YL=["Members only","会员专享","會員專享","メンバー限定","멤버 전용","BADGE_MEMBERS_ONLY"];'
    'function ytmob(g){try{const b=g&&g[_]&&g[_].bytes;if(!b||!b.length)return!1;'
    'const L=YL,D=new TextDecoder("utf-8",{fatal:!0});'
    'function w(b,d){if(d>14)return!1;let p=0;while(p<b.length){let t=0,s=0,c;'
    'do{if(p>=b.length)return!1;c=b[p++];t+=(c&127)*2**s;s+=7;if(s>35)return!1}while(c&128);'
    'const n=Math.floor(t/8),q=t%8;'
    'if(q===0){do{if(p>=b.length)return!1;c=b[p++]}while(c&128)}'
    'else if(q===1){p+=8}else if(q===5){p+=4}'
    'else if(q===2){let l=0;s=0;do{if(p>=b.length)return!1;c=b[p++];l+=(c&127)*2**s;s+=7;if(s>35)return!1}while(c&128);'
    'if(p+l>b.length)return!1;const u=b.subarray(p,p+l);'
    'try{if(L.includes(D.decode(u)))return!0}catch{}'
    'if(w(u,d+1))return!0;p+=l}'
    'else return!1}return!1}return w(b,0)}catch{return!1}}'
    # A card holds one video, a shelf or section holds many. Counting the
    # distinct /vi/<id>/ thumbnail ids and the members-only badge occurrences
    # tells them apart: the object is dropped only when every video it holds is
    # members-only, so a mixed shelf never loses its normal entries.
    'function ytall(g){try{const b=g&&g[_]&&g[_].bytes;if(!b||!b.length)return!1;'
    'const s=new TextDecoder("utf-8").decode(b),m=s.match(/\\/vi\\/[A-Za-z0-9_-]{11}\\//g);'
    'if(!m)return!1;const u=new Set;for(const x of m)u.add(x.slice(4,15));'
    'let c=0,k;for(const l of YL)for(k=-1;(k=s.indexOf(l,k+1))>=0;)c++;'
    'return c>=u.size}catch{return!1}}'
)

# Channel pages and the home feed answer with a two-column browse tree whose
# renderers are not modelled upstream. Only the path down to the item list is
# added: BrowseContent -> twoColumnBrowseResultsRenderer -> tabs -> tabRenderer
# -> richGridRenderer -> richItemContents. The items themselves stay unmodelled
# so their original bytes survive for the badge scan in ytmob().
BROWSE_SCHEMA_OLD = (
    'BrowseContent:[[58173949,"singleColumnResultsRenderer","SingleColumnResultsRenderer"],'
    '[153515154,"elementRenderer","ElementRenderer"],'
    '[49399797,"sectionListRenderer","SectionListRenderer"]],'
)
BROWSE_SCHEMA_NEW = (
    'BrowseContent:[[58173949,"singleColumnResultsRenderer","SingleColumnResultsRenderer"],'
    '[52123031,"twoColumnBrowseResultsRenderer","TwoColumnBrowseResultsRenderer"],'
    '[255072793,"richGridRenderer","RichGridRenderer"],'
    '[153515154,"elementRenderer","ElementRenderer"],'
    '[49399797,"sectionListRenderer","SectionListRenderer"]],'
    'TwoColumnBrowseResultsRenderer:[[3,"tabs","BrowseTabSupportedRenderer",!0]],'
    'RichGridRenderer:[[1,"richItemContents","RichItemContent",!0]],'
)


def fix_done_arg(arg):
    """Fix a $done(...) argument string."""
    arg = arg.strip()
    if arg == "" or arg == "void 0" or arg == "undefined":
        return "{}"
    # ternary: X ? void 0 : Y  ->  X ? {} : Y
    arg = re.sub(r'\?\s*void\s*0\s*:', '?{}:', arg)
    # ternary: X ? Y : void 0  ->  X ? Y : {}
    arg = re.sub(r':\s*void\s*0\s*$', ':{}', arg)
    # trailing :void 0 before closing paren (handled by $ above mostly)
    arg = re.sub(r':\s*void\s*0(\s*\))', r':{}\1', arg)
    return arg


def norm_arg(default_name):
    """Build a compact argument normalizer used by response/ump/request.js.

    Accepts Egern's JSON string as well as Loon's plugin object, maps snake_case
    keys to upstream camelCase keys, and coerces max_speed / max_height.
    """
    pairs = ",".join(f'{k}:"{v}"' for k, v in ARG_KEYS.items())
    return (
        'let a=$argument;'
        'if("string"==typeof a&&!a.includes("{{{"))try{a=JSON.parse(a)}catch{a=void 0}'
        f'if(!a||"object"!=typeof a)return {default_name};'
        'a={...a};'
        f'const m={{{pairs}}};'
        'for(const k in m)void 0!==a[k]&&void 0===a[m[k]]&&(a[m[k]]=a[k]);'
        'const ms=String(a.maxSpeed??"4").toLowerCase();'
        'a.maxSpeed=ms==="off"||a.maxSpeed===!1?!1:Math.max(2,Math.min(4,parseInt(ms)||4));'
        'const mh=parseInt(a.maxHeight);'
        'a.maxHeight=Number.isFinite(mh)?Math.max(144,Math.min(4320,mh)):4320;'
        f'return{{...{default_name},...a}}'
    )


def sub(text, old, new, label, marker=None):
    """Replace exactly one occurrence; skip if an idempotency marker is present."""
    if marker and marker in text:
        return text
    count = text.count(old)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def patch_response(t):
    # ---- argument normalizer (Egern JSON string + Loon object) ----
    t = sub(
        t,
        'function(g={}){return"string"!=typeof $argument||$argument.includes("{{{")?g:{...g,...JSON.parse($argument)}}',
        'function(g={}){' + norm_arg("g") + '}',
        "response argument parser",
        'a.maxSpeed=ms==="off"',
    )

    # ---- player/feed options in N() ----
    t = sub(
        t,
        "function N(E,{blockGames:i=!0,blockVerticalLive:r=!1,jumpAhead:U=!0,blockStore:J=!0,blockAi:P=!0,onTheGo:N=!0}={}){",
        "function N(E,{blockGames:i=!0,blockVerticalLive:r=!1,jumpAhead:U=!0,blockStore:J=!0,blockAi:P=!0,onTheGo:N=!0,maxSpeed:maxSpeedOpt=4,hidePremium:hidePremiumOpt=!0,blockFeedAds:blockFeedAdsOpt=!0,blockShortsFeed:blockShortsFeedOpt=!1,blockMembersOnly:blockMembersOnlyOpt=!1,onTheGoAudio:onTheGoAudioOpt=!0,onTheGoChapters:onTheGoChaptersOpt=!0}={}){",
        "response N signature",
        "maxSpeed:maxSpeedOpt=4",
    )

    # ---- speed menu: raise to configured max speed; premium upsell toggle ----
    t = sub(
        t,
        'const I=function(I){const A=g.encode("PApremium_upsell");return Sg(I,[66439850,1,153515154,172660663,1,168777401,5,407694004,4,4,170382688,1,169495254,443434441,1,1,441573002,4,153515154,172660663,1,168777401,5,413471385,1,1602],g=>{const I=t(g),C=I.find(g=>5===g.no&&5===g.wire);if(!C)return g;const E=new DataView(C.data.buffer,C.data.byteOffset,4).getFloat32(0,!0);if(!(E>0))return g;let e=g;if(E<4){const g=new Uint8Array(4);new DataView(g.buffer).setFloat32(0,4,!0),e=o(I.map(I=>I===C?o([B(45),g]):I.raw))}return Sg(e,[10,1674],g=>{const I=t(g),C=I.filter(g=>3!==g.no||2!==g.wire||!V(g.data,A));return C.length===I.length?g:o(C.map(g=>g.raw))})})}(A.overflowMenu)',
        'const I=function(I){const A=g.encode("PApremium_upsell");return Sg(I,[66439850,1,153515154,172660663,1,168777401,5,407694004,4,4,170382688,1,169495254,443434441,1,1,441573002,4,153515154,172660663,1,168777401,5,413471385,1,1602],g=>{const I=t(g),C=I.find(g=>5===g.no&&5===g.wire);if(!C)return g;const E=new DataView(C.data.buffer,C.data.byteOffset,4).getFloat32(0,!0);if(!(E>0))return g;let e=g;const maxRate=!1===maxSpeedOpt?0:Math.max(2,Math.min(4,parseInt(maxSpeedOpt)||4));if(maxRate>0&&E<maxRate){const g=new Uint8Array(4);new DataView(g.buffer).setFloat32(0,maxRate,!0),e=o(I.map(I=>I===C?o([B(45),g]):I.raw))}return!1===hidePremiumOpt?e:Sg(e,[10,1674],g=>{const I=t(g),C=I.filter(g=>3!==g.no||2!==g.wire||!V(g.data,A));return C.length===I.length?g:o(C.map(g=>g.raw))})})}(A.overflowMenu)',
        "response speed menu",
        "const maxRate=!1===maxSpeedOpt?0:Math.max(2,Math.min(4,parseInt(maxSpeedOpt)||4));if(maxRate>0&&E<maxRate)",
    )

    # ---- On-the-go audio/video mode buttons and chapters button ----
    t = sub(
        t,
        'G(5,Y),G(6,x("youtube_outline_experimental/headset_24pt","Switch to audio mode",D([169495254,300135747,2],s))),G(12,x("youtube_outline_experimental/video_24pt","Switch to video mode",D([169495254,300413109,2],s)))]',
        'G(5,Y),...(!1===onTheGoAudioOpt?[]:[G(6,x("youtube_outline_experimental/headset_24pt","Switch to audio mode",D([169495254,300135747,2],s))),G(12,x("youtube_outline_experimental/video_24pt","Switch to video mode",D([169495254,300413109,2],s)))])]',
        "response on-the-go audio",
        "!1===onTheGoAudioOpt?[]:[G(6,x(\"youtube_outline_experimental/headset_24pt\"",
    )
    t = sub(
        t,
        'm&&y.push(G(8,x("youtube_outline_experimental/view_list_24pt","Chapters",D([169495254,138681778],o([G(3,d),G(10,o([G(1,1),G(3,m)]))])))));',
        '!1!==onTheGoChaptersOpt&&m&&y.push(G(8,x("youtube_outline_experimental/view_list_24pt","Chapters",D([169495254,138681778],o([G(3,d),G(10,o([G(1,1),G(3,m)]))])))));',
        "response on-the-go chapters",
        "!1!==onTheGoChaptersOpt&&m&&y.push",
    )

    # ---- feed ad filtering (keep game/store/vertical-live/AI filtering) ----
    t = sub(
        t,
        "E&&(b.test(E)||C&&F.test(E))",
        "E&&((!1!==blockFeedAdsOpt&&b.test(E))||C&&F.test(E))",
        "response feed ad layout",
        "E&&((!1!==blockFeedAdsOpt&&b.test(E))",
    )
    t = sub(
        t,
        "||g.sponsoredVideo||g.sponsoredDisplay||",
        "||(!1!==blockFeedAdsOpt&&g.sponsoredVideo)||(!1!==blockFeedAdsOpt&&g.sponsoredDisplay)||",
        "response sponsored feed entries",
        "(!1!==blockFeedAdsOpt&&g.sponsoredVideo)",
    )
    t = sub(
        t,
        "Bg(g).some(g=>2===g.wire&&(V(g.data)||325515470===g.no&&function(g){",
        "Bg(g).some(g=>2===g.wire&&((!1!==blockFeedAdsOpt&&V(g.data))||!1!==blockFeedAdsOpt&&325515470===g.no&&function(g){",
        "response pagead feed entries",
        "(!1!==blockFeedAdsOpt&&V(g.data))",
    )
    t = sub(
        t,
        "||C&&400157044===g.no||455507059===g.no||",
        "||C&&400157044===g.no||!1!==blockFeedAdsOpt&&455507059===g.no||",
        "response 455507059 feed ad",
        "!1!==blockFeedAdsOpt&&455507059===g.no",
    )
    t = sub(
        t,
        "let S=!!B&&(b.test(B)||J&&F.test(B));",
        "let S=!!B&&((!1!==blockFeedAdsOpt&&b.test(B))||J&&F.test(B));",
        "response feed ad parent layout",
        "let S=!!B&&((!1!==blockFeedAdsOpt&&b.test(B))",
    )
    t = sub(
        t,
        "h&&A.products?.length||K&&V(A)",
        "h&&A.products?.length||K&&!1!==blockFeedAdsOpt&&V(A)",
        "response promoted contents",
        "K&&!1!==blockFeedAdsOpt&&V(A)",
    )
    t = sub(
        t,
        'return function g(I,E=!1){if(!I||"object"!=typeof I||ArrayBuffer.isView(I))return 0;',
        'return function g(I,E=!1){if(!I||"object"!=typeof I||ArrayBuffer.isView(I))return 0;if(!1!==blockShortsFeedOpt&&I.reelShelfRenderer)return 2;',
        "response Shorts feed shelf",
        "blockShortsFeedOpt&&I.reelShelfRenderer",
    )

    # ---- members-only feed items (badge text scan, opt-in) ----
    t = sub(
        t,
        'new Set(["Browse","BrowseContent",',
        'new Set(["Browse","BrowseContent","TwoColumnBrowseResultsRenderer","RichGridRenderer",',
        "response browse type whitelist",
        '"TwoColumnBrowseResultsRenderer","RichGridRenderer"',
    )
    t = sub(
        t,
        BROWSE_SCHEMA_OLD,
        BROWSE_SCHEMA_NEW,
        "response two-column browse schema",
        'TwoColumnBrowseResultsRenderer:[[3,"tabs"',
    )
    t = sub(
        t,
        'return function g(I,E=!1){if(!I||"object"!=typeof I||ArrayBuffer.isView(I))return 0;if(!1!==blockShortsFeedOpt&&I.reelShelfRenderer)return 2;',
        'return function g(I,E=!1){if(!I||"object"!=typeof I||ArrayBuffer.isView(I))return 0;if(E&&!1!==blockMembersOnlyOpt&&ytmob(I)&&ytall(I))return 1;if(!1!==blockShortsFeedOpt&&I.reelShelfRenderer)return 2;',
        "response members-only browse items",
        "if(E&&!1!==blockMembersOnlyOpt&&ytmob(I)&&ytall(I))return 1;",
    )
    t = sub(
        t,
        "function Bg(g){",
        MEMBERS_ONLY_HELPER + "function Bg(g){",
        "response members-only helper",
        "function ytmob(",
    )
    t = sub(
        t,
        "}(g.videoLockup))||Bg(g).some",
        "}(g.videoLockup)||(!1!==blockMembersOnlyOpt&&g.videoLockup&&ytmob(g.videoLockup)))||Bg(g).some",
        "response members-only feed items",
        "!1!==blockMembersOnlyOpt&&g.videoLockup&&ytmob",
    )

    # ---- player response (X): paid promotion / ad slots / speed / tracking / PiP / background ----
    t = sub(
        t,
        'let A=N(g,I);A=Z(g,"paidPromotion")||A;',
        'let A=N(g,I);!1!==I.removePaidPromotion&&(A=Z(g,"paidPromotion")||A);',
        "response paidPromotion",
        '!1!==I.removePaidPromotion&&(A=Z(g,"paidPromotion")',
    )
    t = sub(
        t,
        'for(const I of["adPlacements","adSlots"])g[I]?.length&&(Ag(g,I,[]),A=!0);',
        'if(!1!==I.blockPlayerAds)for(const I of["adPlacements","adSlots"])g[I]?.length&&(Ag(g,I,[]),A=!0);',
        "response player ad slots",
        'if(!1!==I.blockPlayerAds)for(const I of["adPlacements","adSlots"])',
    )
    t = sub(
        t,
        'const C=g.playerConfig?.granularVariableSpeedConfig;void 0!==C?.maximumPlaybackRate&&C.maximumPlaybackRate>0&&C.maximumPlaybackRate<400&&(Ag(C,"maximumPlaybackRate",400),A=!0),g.playbackTracking&&(A=Z(g.playbackTracking,"pageadViewthroughconversion")||A);',
        'const C=g.playerConfig?.granularVariableSpeedConfig,maxRate=!1===I.maxSpeed?0:Math.max(2,Math.min(4,parseInt(I.maxSpeed)||4))*100;maxRate>0&&void 0!==C?.maximumPlaybackRate&&C.maximumPlaybackRate>0&&C.maximumPlaybackRate<maxRate&&(Ag(C,"maximumPlaybackRate",maxRate),A=!0),!1!==I.blockAdTracking&&g.playbackTracking&&(A=Z(g.playbackTracking,"pageadViewthroughconversion")||A);',
        "response max playback rate / ad tracking",
        'maxRate>0&&void 0!==C?.maximumPlaybackRate',
    )
    t = sub(
        t,
        'const g=E.pictureInPictureRender??{};Ag(E,"pictureInPictureRender",g);const I=g.pictureInPictureAbility??{};Ag(g,"pictureInPictureAbility",I),A=Ag(I,"active",!0)||A,A=Ag(I,"f4",0)||A,A=Ag(I,"f6",0)||A,A=Ag(I,"f8",1)||A;',
        'if(!1!==I.pip){const g=E.pictureInPictureRender??{};Ag(E,"pictureInPictureRender",g);const I=g.pictureInPictureAbility??{};Ag(g,"pictureInPictureAbility",I),A=Ag(I,"active",!0)||A,A=Ag(I,"f4",0)||A,A=Ag(I,"f6",0)||A,A=Ag(I,"f8",1)||A;}',
        "response PiP",
        'if(!1!==I.pip){const g=E.pictureInPictureRender',
    )
    t = sub(
        t,
        'const C=E.backgroundPlayerRender??{};Ag(E,"backgroundPlayerRender",C);const o=C.backgroundAbility??{};Ag(C,"backgroundAbility",o),A=Ag(o,"active",!0)||A',
        'if(!1!==I.backgroundPlay){const C=E.backgroundPlayerRender??{};Ag(E,"backgroundPlayerRender",C);const o=C.backgroundAbility??{};Ag(C,"backgroundAbility",o),A=Ag(o,"active",!0)||A;}',
        "response background play",
        'if(!1!==I.backgroundPlay){const C=E.backgroundPlayerRender',
    )

    # ---- Shorts ads ----
    t = sub(
        t,
        '"reel/reel_watch_sequence":["Shorts",function(g){const I=g.entries.filter(g=>!g.command?.reelWatchEndpoint?.adClientParams?.isAd),A=I.length!==g.entries.length;return A&&Ag(g,"entries",I),A}]',
        '"reel/reel_watch_sequence":["Shorts",function(g,I){if(!1===I.blockShortsAds)return!1;const A=g.entries.filter(g=>!g.command?.reelWatchEndpoint?.adClientParams?.isAd),C=A.length!==g.entries.length;return C&&Ag(g,"entries",A),C}]',
        "response Shorts ads",
        '"reel/reel_watch_sequence":["Shorts",function(g,I){if(!1===I.blockShortsAds)',
    )

    # ---- guide: premium entry + custom browseIds ----
    t = sub(
        t,
        'const A=new Set(["SPunlimited"]);I.blockUpload&&A.add("FEuploads"),I.blockShorts&&A.add("FEshorts");',
        'const A=new Set(!1===I.hidePremium?[]:["SPunlimited"]);String(I.blockGuideItems??"").split(",").map(g=>g.trim()).filter(Boolean).forEach(g=>A.add(g));I.blockUpload&&A.add("FEuploads"),I.blockShorts&&A.add("FEshorts");',
        "response guide items",
        'String(I.blockGuideItems??"")',
    )

    # ---- account settings: only force background playback when enabled ----
    t = sub(
        t,
        '"account/get_setting":["Setting",function(g){let I=!1;',
        '"account/get_setting":["Setting",function(g,bgArgs){if(!1===bgArgs.backgroundPlay)return!1;let I=!1;',
        "response background setting",
        "function(g,bgArgs){if(!1===bgArgs.backgroundPlay)",
    )

    # ---- max_height cap for the auto-HD quality cache ----
    t = sub(
        t,
        "!1!==a.autoHd&&function(A){if(!A.length)return;const C=A.map",
        "!1!==a.autoHd&&function(A){if(!A.length)return;const maxHeight=Math.max(144,Math.min(4320,parseInt(a.maxHeight)||4320)),C=A.map",
        "response quality maxHeight",
        "const maxHeight=Math.max(144,Math.min(4320,parseInt(a.maxHeight)||4320)),C=A.map",
    )
    t = sub(
        t,
        "if(!e||!o||o>2147483647||o<n.height)continue;",
        "if(!e||!o||o>2147483647||o>maxHeight||o<n.height)continue;",
        "response quality height filter",
        "o>2147483647||o>maxHeight||o<n.height",
    )
    t = sub(
        t,
        "g.length>256||!i(I)?B=!0:",
        "g.length>256||!i(I)||I.height>maxHeight?B=!0:",
        "response stale quality cache",
        "!i(I)||I.height>maxHeight?B=!0:",
    )
    return t


def patch_ump(t):
    # ---- argument normalizer ----
    t = sub(
        t,
        'function(g={}){return"string"!=typeof $argument||$argument.includes("{{{")?g:{...g,...JSON.parse($argument)}}',
        'function(g={}){' + norm_arg("g") + '}',
        "ump argument parser",
        'a.maxSpeed=ms==="off"',
    )

    # ---- player/feed options in Z() ----
    t = sub(
        t,
        "function Z(E,{blockGames:o=!0,blockVerticalLive:e=!1,jumpAhead:h=!0,blockStore:a=!0,blockAi:L=!0,onTheGo:O=!0}={}){",
        "function Z(E,{blockGames:o=!0,blockVerticalLive:e=!1,jumpAhead:h=!0,blockStore:a=!0,blockAi:L=!0,onTheGo:O=!0,maxSpeed:maxSpeedOpt=4,hidePremium:hidePremiumOpt=!0,blockFeedAds:blockFeedAdsOpt=!0,blockShortsFeed:blockShortsFeedOpt=!1,blockMembersOnly:blockMembersOnlyOpt=!1,onTheGoAudio:onTheGoAudioOpt=!0,onTheGoChapters:onTheGoChaptersOpt=!0}={}){",
        "ump Z signature",
        "maxSpeed:maxSpeedOpt=4",
    )

    # ---- speed menu ----
    t = sub(
        t,
        'const I=function(I){const A=g.encode("PApremium_upsell");return Sg(I,[66439850,1,153515154,172660663,1,168777401,5,407694004,4,4,170382688,1,169495254,443434441,1,1,441573002,4,153515154,172660663,1,168777401,5,413471385,1,1602],g=>{const I=S(g),C=I.find(g=>5===g.no&&5===g.wire);if(!C)return g;const E=new DataView(C.data.buffer,C.data.byteOffset,4).getFloat32(0,!0);if(!(E>0))return g;let o=g;if(E<4){const g=new Uint8Array(4);new DataView(g.buffer).setFloat32(0,4,!0),o=B(I.map(I=>I===C?B([n(45),g]):I.raw))}return Sg(o,[10,1674],g=>{const I=S(g),C=I.filter(g=>3!==g.no||2!==g.wire||!P(g.data,A));return C.length===I.length?g:B(C.map(g=>g.raw))})})}(A.overflowMenu)',
        'const I=function(I){const A=g.encode("PApremium_upsell");return Sg(I,[66439850,1,153515154,172660663,1,168777401,5,407694004,4,4,170382688,1,169495254,443434441,1,1,441573002,4,153515154,172660663,1,168777401,5,413471385,1,1602],g=>{const I=S(g),C=I.find(g=>5===g.no&&5===g.wire);if(!C)return g;const E=new DataView(C.data.buffer,C.data.byteOffset,4).getFloat32(0,!0);if(!(E>0))return g;let o=g;const maxRate=!1===maxSpeedOpt?0:Math.max(2,Math.min(4,parseInt(maxSpeedOpt)||4));if(maxRate>0&&E<maxRate){const g=new Uint8Array(4);new DataView(g.buffer).setFloat32(0,maxRate,!0),o=B(I.map(I=>I===C?B([n(45),g]):I.raw))}return!1===hidePremiumOpt?o:Sg(o,[10,1674],g=>{const I=S(g),C=I.filter(g=>3!==g.no||2!==g.wire||!P(g.data,A));return C.length===I.length?g:B(C.map(g=>g.raw))})})}(A.overflowMenu)',
        "ump speed menu",
        "const maxRate=!1===maxSpeedOpt?0:Math.max(2,Math.min(4,parseInt(maxSpeedOpt)||4));if(maxRate>0&&E<maxRate)",
    )

    # ---- On-the-go audio/video mode buttons and chapters button ----
    t = sub(
        t,
        'D(5,M),D(6,b("youtube_outline_experimental/headset_24pt","Switch to audio mode",f([169495254,300135747,2],R))),D(12,b("youtube_outline_experimental/video_24pt","Switch to video mode",f([169495254,300413109,2],R)))]',
        'D(5,M),...(!1===onTheGoAudioOpt?[]:[D(6,b("youtube_outline_experimental/headset_24pt","Switch to audio mode",f([169495254,300135747,2],R))),D(12,b("youtube_outline_experimental/video_24pt","Switch to video mode",f([169495254,300413109,2],R)))])]',
        "ump on-the-go audio",
        '!1===onTheGoAudioOpt?[]:[D(6,b("youtube_outline_experimental/headset_24pt"',
    )
    t = sub(
        t,
        'p&&G.push(D(8,b("youtube_outline_experimental/view_list_24pt","Chapters",f([169495254,138681778],B([D(3,Y),D(10,B([D(1,1),D(3,p)]))])))));',
        '!1!==onTheGoChaptersOpt&&p&&G.push(D(8,b("youtube_outline_experimental/view_list_24pt","Chapters",f([169495254,138681778],B([D(3,Y),D(10,B([D(1,1),D(3,p)]))])))));',
        "ump on-the-go chapters",
        "!1!==onTheGoChaptersOpt&&p&&G.push",
    )

    # ---- feed ad filtering ----
    t = sub(
        t,
        "E&&(F.test(E)||C&&H.test(E))",
        "E&&((!1!==blockFeedAdsOpt&&F.test(E))||C&&H.test(E))",
        "ump feed ad layout",
        "E&&((!1!==blockFeedAdsOpt&&F.test(E))",
    )
    t = sub(
        t,
        "||g.sponsoredVideo||g.sponsoredDisplay||",
        "||(!1!==blockFeedAdsOpt&&g.sponsoredVideo)||(!1!==blockFeedAdsOpt&&g.sponsoredDisplay)||",
        "ump sponsored feed entries",
        "(!1!==blockFeedAdsOpt&&g.sponsoredVideo)",
    )
    t = sub(
        t,
        "tg(g).some(g=>2===g.wire&&(P(g.data)||325515470===g.no&&function(g){",
        "tg(g).some(g=>2===g.wire&&((!1!==blockFeedAdsOpt&&P(g.data))||!1!==blockFeedAdsOpt&&325515470===g.no&&function(g){",
        "ump pagead feed entries",
        "(!1!==blockFeedAdsOpt&&P(g.data))",
    )
    t = sub(
        t,
        "||C&&400157044===g.no||455507059===g.no||",
        "||C&&400157044===g.no||!1!==blockFeedAdsOpt&&455507059===g.no||",
        "ump 455507059 feed ad",
        "!1!==blockFeedAdsOpt&&455507059===g.no",
    )
    t = sub(
        t,
        "let i=!!n&&(F.test(n)||a&&H.test(n));",
        "let i=!!n&&((!1!==blockFeedAdsOpt&&F.test(n))||a&&H.test(n));",
        "ump feed ad parent layout",
        "let i=!!n&&((!1!==blockFeedAdsOpt&&F.test(n))",
    )
    t = sub(
        t,
        "K&&A.products?.length||s&&P(A)",
        "K&&A.products?.length||s&&!1!==blockFeedAdsOpt&&P(A)",
        "ump promoted contents",
        "s&&!1!==blockFeedAdsOpt&&P(A)",
    )
    t = sub(
        t,
        'return function g(I,E=!1){if(!I||"object"!=typeof I||ArrayBuffer.isView(I))return 0;',
        'return function g(I,E=!1){if(!I||"object"!=typeof I||ArrayBuffer.isView(I))return 0;if(!1!==blockShortsFeedOpt&&I.reelShelfRenderer)return 2;',
        "ump Shorts feed shelf",
        "blockShortsFeedOpt&&I.reelShelfRenderer",
    )

    # ---- members-only feed items (badge text scan, opt-in) ----
    t = sub(
        t,
        'new Set(["BrowseContent",',
        'new Set(["BrowseContent","TwoColumnBrowseResultsRenderer","RichGridRenderer",',
        "ump browse type whitelist",
        '"TwoColumnBrowseResultsRenderer","RichGridRenderer"',
    )
    t = sub(
        t,
        BROWSE_SCHEMA_OLD,
        BROWSE_SCHEMA_NEW,
        "ump two-column browse schema",
        'TwoColumnBrowseResultsRenderer:[[3,"tabs"',
    )
    t = sub(
        t,
        'return function g(I,E=!1){if(!I||"object"!=typeof I||ArrayBuffer.isView(I))return 0;if(!1!==blockShortsFeedOpt&&I.reelShelfRenderer)return 2;',
        'return function g(I,E=!1){if(!I||"object"!=typeof I||ArrayBuffer.isView(I))return 0;if(E&&!1!==blockMembersOnlyOpt&&ytmob(I)&&ytall(I))return 1;if(!1!==blockShortsFeedOpt&&I.reelShelfRenderer)return 2;',
        "ump members-only browse items",
        "if(E&&!1!==blockMembersOnlyOpt&&ytmob(I)&&ytall(I))return 1;",
    )
    t = sub(
        t,
        "function tg(g){",
        MEMBERS_ONLY_HELPER + "function tg(g){",
        "ump members-only helper",
        "function ytmob(",
    )
    t = sub(
        t,
        "}(g.videoLockup))||tg(g).some",
        "}(g.videoLockup)||(!1!==blockMembersOnlyOpt&&g.videoLockup&&ytmob(g.videoLockup)))||tg(g).some",
        "ump members-only feed items",
        "!1!==blockMembersOnlyOpt&&g.videoLockup&&ytmob",
    )

    # ---- player response (z) ----
    t = sub(
        t,
        'let A=Z(g,I);A=T(g,"paidPromotion")||A;',
        'let A=Z(g,I);!1!==I.removePaidPromotion&&(A=T(g,"paidPromotion")||A);',
        "ump paidPromotion",
        '!1!==I.removePaidPromotion&&(A=T(g,"paidPromotion")',
    )
    t = sub(
        t,
        'for(const I of["adPlacements","adSlots"])g[I]?.length&&(Cg(g,I,[]),A=!0);',
        'if(!1!==I.blockPlayerAds)for(const I of["adPlacements","adSlots"])g[I]?.length&&(Cg(g,I,[]),A=!0);',
        "ump player ad slots",
        'if(!1!==I.blockPlayerAds)for(const I of["adPlacements","adSlots"])',
    )
    t = sub(
        t,
        'const C=g.playerConfig?.granularVariableSpeedConfig;void 0!==C?.maximumPlaybackRate&&C.maximumPlaybackRate>0&&C.maximumPlaybackRate<400&&(Cg(C,"maximumPlaybackRate",400),A=!0),g.playbackTracking&&(A=T(g.playbackTracking,"pageadViewthroughconversion")||A);',
        'const C=g.playerConfig?.granularVariableSpeedConfig,maxRate=!1===I.maxSpeed?0:Math.max(2,Math.min(4,parseInt(I.maxSpeed)||4))*100;maxRate>0&&void 0!==C?.maximumPlaybackRate&&C.maximumPlaybackRate>0&&C.maximumPlaybackRate<maxRate&&(Cg(C,"maximumPlaybackRate",maxRate),A=!0),!1!==I.blockAdTracking&&g.playbackTracking&&(A=T(g.playbackTracking,"pageadViewthroughconversion")||A);',
        "ump max playback rate / ad tracking",
        'maxRate>0&&void 0!==C?.maximumPlaybackRate',
    )
    t = sub(
        t,
        'const g=E.pictureInPictureRender??{};Cg(E,"pictureInPictureRender",g);const I=g.pictureInPictureAbility??{};Cg(g,"pictureInPictureAbility",I),A=Cg(I,"active",!0)||A,A=Cg(I,"f4",0)||A,A=Cg(I,"f6",0)||A,A=Cg(I,"f8",1)||A;',
        'if(!1!==I.pip){const g=E.pictureInPictureRender??{};Cg(E,"pictureInPictureRender",g);const I=g.pictureInPictureAbility??{};Cg(g,"pictureInPictureAbility",I),A=Cg(I,"active",!0)||A,A=Cg(I,"f4",0)||A,A=Cg(I,"f6",0)||A,A=Cg(I,"f8",1)||A;}',
        "ump PiP",
        'if(!1!==I.pip){const g=E.pictureInPictureRender',
    )
    t = sub(
        t,
        'const C=E.backgroundPlayerRender??{};Cg(E,"backgroundPlayerRender",C);const o=C.backgroundAbility??{};Cg(C,"backgroundAbility",o),A=Cg(o,"active",!0)||A',
        'if(!1!==I.backgroundPlay){const C=E.backgroundPlayerRender??{};Cg(E,"backgroundPlayerRender",C);const o=C.backgroundAbility??{};Cg(C,"backgroundAbility",o),A=Cg(o,"active",!0)||A;}',
        "ump background play",
        'if(!1!==I.backgroundPlay){const C=E.backgroundPlayerRender',
    )

    # ---- max_height cap for the auto-HD quality cache ----
    t = sub(
        t,
        "!1!==s.autoHd&&function(A){if(!A.length)return;const C=A.map",
        "!1!==s.autoHd&&function(A){if(!A.length)return;const maxHeight=Math.max(144,Math.min(4320,parseInt(s.maxHeight)||4320)),C=A.map",
        "ump quality maxHeight",
        "const maxHeight=Math.max(144,Math.min(4320,parseInt(s.maxHeight)||4320)),C=A.map",
    )
    t = sub(
        t,
        "if(!B||!o||o>2147483647||o<e.height)continue;",
        "if(!B||!o||o>2147483647||o>maxHeight||o<e.height)continue;",
        "ump quality height filter",
        "o>2147483647||o>maxHeight||o<e.height",
    )
    t = sub(
        t,
        "g.length>256||!h(I)?t=!0:",
        "g.length>256||!h(I)||I.height>maxHeight?t=!0:",
        "ump stale quality cache",
        "!h(I)||I.height>maxHeight?t=!0:",
    )
    return t


def patch_request(t):
    # ---- argument normalizer ----
    t = sub(
        t,
        'function u(e={}){return"string"!=typeof $argument||$argument.includes("{{{")?e:{...e,...JSON.parse($argument)}}',
        'function u(e={}){' + norm_arg("e") + '}',
        "request argument parser",
        'a.maxSpeed=ms==="off"',
    )

    # ---- player ad_break: optional empty protobuf ----
    t = sub(
        t,
        'if(d=$request.url.split("?")[0],d.endsWith("/player/ad_break"))y=g();',
        'if(d=$request.url.split("?")[0],d.endsWith("/player/ad_break"))!1!==u().blockPlayerAds&&(y=g());',
        "request ad_break",
        'd.endsWith("/player/ad_break"))!1!==u().blockPlayerAds',
    )

    # ---- log_event: optional hot-hash header stripping ----
    t = sub(
        t,
        'y=function(e){const r=Object.keys(e.headers??{}).filter(e=>"x-youtube-hot-hash-data"===e.toLowerCase());',
        'y=function(e){if(!1===u().stripHotHash)return;const r=Object.keys(e.headers??{}).filter(e=>"x-youtube-hot-hash-data"===e.toLowerCase());',
        "request hot hash header",
        "if(!1===u().stripHotHash)return;",
    )

    # Helper functions are needed because h()/c() have local variables named u
    # that would shadow the $argument parser.
    t = sub(
        t,
        "function h(e,t){const n=new Map",
        "function mh(){return Math.max(144,Math.min(4320,parseInt(u().maxHeight)||4320))}function pp(){return!1!==u().preferPremium}function h(e,t){const n=new Map",
        "request option helper functions",
        "function mh(){return Math.max(144",
    )

    # ---- initplayback fallback height ----
    t = sub(
        t,
        "[[16,4320],[26,1],[30,0]]",
        "[[16,mh()],[26,1],[30,0]]",
        "request init playback fallback height",
        "[[16,mh()],[26,1],[30,0]]",
    )

    # ---- prefer premium bitrate when available ----
    t = sub(
        t,
        "formats:h.length?h:c",
        "formats:h.length&&pp()?h:c",
        "request premium bitrate preference",
        "formats:h.length&&pp()?h:c",
    )
    return t


def patch(path):
    p = pathlib.Path(path)
    t = p.read_text()

    # Replace $done(...) calls: match one level of nested parens
    def repl(m):
        inner = m.group(1)
        new_inner = fix_done_arg(inner)
        return "$done(" + new_inner + ")"

    t = re.sub(r'\$done\(([^()]*(?:\([^()]*\)[^()]*)*)\)', repl, t)

    # large-body guard in response.js (only where $response exists)
    t = re.sub(r'!\$response\.body\?\.length\)\s*return\s*\$done\(\{\}\)',
               '!$response.body?.length||$response.body.length>5242880)return $done({})', t)

    # verify no bare $done() remain
    assert not re.search(r'\$done\(\s*\)', t), f"{path}: bare $done() remains"

    name = p.name
    if name == "response.js":
        t = patch_response(t)
    elif name == "ump.js":
        t = patch_ump(t)
    elif name == "request.js":
        t = patch_request(t)

    p.write_text(t)
    print(f"patched {path}")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        patch(arg)
