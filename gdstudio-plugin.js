/*
 * GD Studio 音源桥接插件（MusicFree 插件协议）
 * 适用于 Sonnets / MusicFree 等支持 MusicFree 协议的播放器。
 *
 * 数据源 API：https://music-api.gdstudio.xyz/api.php
 * 在播放器「设置 -> 插件设置」中以“单个 JavaScript 插件地址”导入本文件即可。
 *
 * 说明：本插件仅用于学习，非商用；音源版权归原平台所有，
 * 出处：GD音乐台 music.gdstudio.xyz
 */

const API = "https://music-api.gdstudio.xyz/api.php";

// 默认音源；可通过插件用户变量修改。稳定源：netease / joox / bilibili
const DEFAULT_SOURCE = "netease";

/* ---------------- HTTP ---------------- */

// 宿主（Sonnets/MusicFree）内置 axios，需通过 require 引入，不能直接用全局。
const axios = require("axios");

function httpGet(params) {
  const search = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
    .join("&");
  const url = API + "?" + search;

  return axios
    .get(url, { timeout: 20000 })
    .then((res) => {
      const data = typeof res.data === "string" ? safeJson(res.data) : res.data;
      if (data === null || data === undefined) {
        throw new Error("服务器返回无法解析");
      }
      return data;
    });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/* ---------------- 音质映射 ---------------- */

// MusicFree 音质 -> GD br
const QUALITY_TO_BR = {
  low: 128,
  standard: 192,
  high: 320,
  super: 999,
};

/* ---------------- 结果组装 ---------------- */

function toMusicItem(raw) {
  const source = raw.source || DEFAULT_SOURCE;
  const artist = Array.isArray(raw.artist) ? raw.artist.join(" / ") : raw.artist || "";

  return {
    // MusicFree 主键
    id: String(raw.id),
    platform: "gdstudio",
    title: raw.name || "未知曲目",
    artist: artist,
    album: raw.album || "",
    duration: 0,
    artwork: "", // 封面延迟到 getMusicInfo 时按 pic_id 拉取，避免搜索时大量请求
    // —— 桥接所需的附加字段 ——
    _src: source, // 实际音源（netease/joox/...）
    _picId: String(raw.pic_id || ""),
    _lyricId: String(raw.lyric_id || raw.id || ""),
  };
}

/* ---------------- 歌单链接解析 ---------------- */

/// 从各音源分享链接中识别 { source, sheetId }
function parseSheetURL(urlLike) {
  let text = String(urlLike || "").trim();

  // 1) 纯数字：默认按用户当前音源
  if (/^\d+$/.test(text)) {
    return { source: getUserSource(), sheetId: text };
  }

  // 2) 网易云 music.163.com
  //    链接形式：/playlist?id=xxx 或 /playlist/xxx
  let m =
    text.match(/music\.163\.com[^\s]*[?&]id=(\d+)/) ||
    text.match(/music\.163\.com\/playlist\/(\d+)/) ||
    text.match(/163\.com[^\s]*id=(\d+)/);
  if (m) return { source: "netease", sheetId: m[1] };

  // 3) QQ音乐 y.qq.com
  //    /playlist/xxx/ 或 id=xxx
  m =
    text.match(/y\.qq\.com\/.*?id=(\w+)/) ||
    text.match(/y\.qq\.com\/n\/rycloud\/playlist\/detail\/(\w+)/) ||
    text.match(/y\.qq\.com\/.*\/(\w+)\.html/);
  if (m) return { source: "tencent", sheetId: m[1] };

  // 4) 酷我 kuwo.cn
  //    /playlist/detail/xxx 或 pid=xxx
  m =
    text.match(/kuwo\.cn[^\s]*[?&]pid=(\d+)/) ||
    text.match(/kuwo\.cn\/playlist\/detail\/(\d+)/);
  if (m) return { source: "kuwo", sheetId: m[1] };

  // 5) URL 里带常见参数 id/pid
  try {
    const u = new URL(text);
    const id = u.searchParams.get("id") || u.searchParams.get("pid");
    if (id) {
      const host = u.hostname;
      let source = getUserSource();
      if (host.includes("163")) source = "netease";
      else if (host.includes("qq.com") || host.includes("y.qq")) source = "tencent";
      else if (host.includes("kuwo")) source = "kuwo";
      return { source, sheetId: id };
    }
  } catch (e) {}

  return null;
}

/// 把“歌单接口返回的网易云原始曲目”转成插件音乐项
/// 网易云字段：id, name, ar[歌手], al{name,pic,picUrl}, dt(毫秒)
function toMusicItemFromPlaylist(raw, source) {
  const artists = Array.isArray(raw.ar)
    ? raw.ar.map((a) => a && a.name).filter(Boolean)
    : [];
  const album = raw.al || {};
  const picId = album.pic_str || String(album.pic || raw.al && raw.al.pic || "");

  return {
    id: String(raw.id),
    platform: "gdstudio",
    title: raw.name || "未知曲目",
    artist: artists.join(" / "),
    album: album.name || "",
    duration: raw.dt ? raw.dt / 1000 : 0,
    artwork: album.picUrl || "", // 歌单内已带封面，直接用
    _src: source,
    _picId: picId,
    _lyricId: String(raw.id),
  };
}

/* ---------------- 用户变量 ---------------- */

// 宿主（Sonnets/MusicFree）把用户变量放在 process.env.userVariables
function getUserSource() {
  try {
    const uv =
      (typeof process !== "undefined" &&
        process.env &&
        process.env.userVariables) ||
      {};
    return uv.source || DEFAULT_SOURCE;
  } catch (e) {
    return DEFAULT_SOURCE;
  }
}

/* ---------------- 插件定义 ---------------- */

const plugin = {
  platform: "gdstudio",
  version: "1.1.0",
  author: "GD Studio bridge",
  description:
    "GD音乐台音源（网易云/JOOX/B站等），数据来自 music.gdstudio.xyz。仅用于学习。",
  srcUrl: undefined, // 导入后由宿主自动记录用于更新

  primaryKey: ["id", "platform"],
  defaultSearchType: "music",
  supportedSearchType: ["music"],

  userVariables: [
    {
      key: "source",
      name: "音源",
      hint: "可选 netease / joox / bilibili / tencent / kuwo / ytmusic，默认 netease",
    },
  ],

  /* ---- 搜索（仅音乐） ---- */
  async search(query, page, type) {
    if (type !== "music") {
      return { isEnd: true, data: [] };
    }

    const source = getUserSource();

    const list = await httpGet({
      types: "search",
      source: source,
      name: query,
      count: 30,
      pages: page || 1,
    });

    const data = Array.isArray(list) ? list.map(toMusicItem) : [];
    return {
      isEnd: data.length < 30,
      data: data,
    };
  },

  /* ---- 播放前补全信息（封面等） ---- */
  async getMusicInfo(musicBase) {
    const picId = musicBase._picId;
    const source = musicBase._src || DEFAULT_SOURCE;
    const patch = {};

    if (picId) {
      try {
        const pic = await httpGet({
          types: "pic",
          source: source,
          id: picId,
          size: 500,
        });
        if (pic && pic.url) patch.artwork = pic.url;
      } catch (e) {}
    }

    return Object.keys(patch).length ? patch : null;
  },

  /* ---- 取播放地址 ---- */
  async getMediaSource(musicItem, quality) {
    const source = musicItem._src || DEFAULT_SOURCE;
    const br = QUALITY_TO_BR[quality] || 320;

    const result = await httpGet({
      types: "url",
      source: source,
      id: musicItem.id,
      br: br,
    });

    if (!result || !result.url) {
      // 高码率失败时兜底 320 / 128
      if (br !== 128) {
        const fallback = await httpGet({
          types: "url",
          source: source,
          id: musicItem.id,
          br: 128,
        });
        if (fallback && fallback.url) {
          return { url: fallback.url, quality: quality };
        }
      }
      return null;
    }

    return {
      url: result.url,
      quality: quality,
    };
  },

  /* ---- 取歌词（原文 + 翻译） ---- */
  async getLyric(musicItem) {
    const source = musicItem._src || DEFAULT_SOURCE;
    const lyricId = musicItem._lyricId || musicItem.id;

    const result = await httpGet({
      types: "lyric",
      source: source,
      id: lyricId,
    });

    if (!result || !result.lyric) {
      return null;
    }

    return {
      rawLrc: result.lyric || "",
      translation: result.tlyric || "",
    };
  },

  /* ---- 导入歌单（贴歌单链接，返回曲目数组） ---- */
  async importMusicSheet(urlLike) {
    const parsed = parseSheetURL(urlLike);
    if (!parsed) {
      throw new Error(
        "无法识别歌单链接，请粘贴包含歌单 ID 的链接（网易云/QQ/酷我）"
      );
    }

    const result = await httpGet({
      types: "playlist",
      source: parsed.source,
      id: parsed.sheetId,
    });

    const tracks =
      result && result.playlist && Array.isArray(result.playlist.tracks)
        ? result.playlist.tracks
        : [];

    if (!tracks.length) {
      throw new Error("歌单为空或无法获取（该音源可能暂不支持）");
    }

    return tracks.map((t) => toMusicItemFromPlaylist(t, parsed.source));
  },
};

/* ---------------- 导出 ---------------- */

// MusicFree / Sonnets 的 CommonJS 运行环境
module.exports = plugin;
