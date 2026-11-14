// BiliBili Enhance — gRPC 部分（详情页 / 评论区 / 播放器）。
//
// B 站 App 的视频详情、评论、播放器状态走的是 gRPC（protobuf over HTTP/2），
// 不是 REST，所以 bilibili_clean.js 碰不到这些接口。这里按字段号就地删，
// 只做「删整字段」和「按条件删重复项」两种操作，其余字节原样保留，
// 未知字段、字段顺序、编码方式都不动，最差是不生效，不会把消息改坏。
//
// 用到的字段号（来自 B 站 App 的 proto）：
//
//   bilibili.app.view.v1.ViewReply            旧版详情页
//     10 relates              相关推荐（里面混广告）
//     30 cms                  广告卡片
//     31 cm_config            广告配置
//     34 tf_panel_customized  办卡免流推广
//     41 cm_ipad              iPad 广告
//     48 cm_under_player      播放器下方广告
//     32 tab                  播放页定制标签（otype=3 或带 ad_tab_info 时是广告）
//   bilibili.app.view.v1.Relate               相关推荐条目
//     7 goto / 28 cm / 32 unique_id
//     广告判定：goto 是 cm 或 game，或者带 cm / unique_id
//
//   bilibili.app.viewunite.v1.ViewReply       新版详情页
//     7 cm                    视频下方广告
//     5 tab                   详情 Tab：模块 18/29/55 是推广位，
//                             模块 28 里的 RelateCard 混广告（见下）
//   bilibili.app.viewunite.common.Module      详情页模块
//     1 type / 22 relates     22 是推荐模块数据，cards 在 Relates.cards=1
//   bilibili.app.viewunite.common.RelateCard  新版推荐卡
//     1 relate_card_type / 6 cm / 11 cm_stock
//     广告判定：类型是 B 站标记的广告类型（4/5/11），或带 cm / cm_stock
//
//   bilibili.main.community.reply.v1.MainListReply   评论列表
//     11 cm                   评论列表广告
//     28 subject_top_cards    评论区顶部卡片（type=3 是带货卡）
//     4 up_top / 5 admin_top / 6 vote_top / 14 top_replies
//     置顶评论里带 b23.tv/cm、b23.tv/mall、cm.bilibili.com 带货链接的删掉
//
//   bilibili.app.viewunite.v1.View/PlayPause    暂停广告，整条返回空消息
//   bilibili.app.viewunite.v1.View/ViewEndPage  播放结束页广告，同上
//
// gRPC 的响应是「1 字节 flag + 4 字节大端长度 + 消息体」的帧。B 站会用
// flag=1 表示消息体是 gzip 的（帧级压缩，不是 Content-Encoding），这里解压
// 后按未压缩回写。解压不了就整条放行，不做半截修改。

(() => {
  "use strict";

  const EMPTY = new Uint8Array(0);

  const res = (typeof $response !== "undefined" && $response) || {};
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = res.url || req.url || "";

  // ---- 参数 -------------------------------------------------------------

  let opt = {};
  const arg = typeof $argument !== "undefined" ? $argument : undefined;
  if (typeof arg === "string") {
    try {
      opt = JSON.parse(arg) || {};
    } catch (e) {
      opt = {};
    }
  } else if (Array.isArray(arg)) {
    opt = { block_ads: arg[0]};
  } else if (arg && typeof arg === "object") {
    opt = arg;
  }

  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");
  const blockAds = flag(opt.block_ads, true);

  if (!blockAds) {
    $done({});
    return;
  }
