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
  version: "1.0.0",
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
};

/* ---------------- 导出 ---------------- */

// MusicFree / Sonnets 的 CommonJS 运行环境
module.exports = plugin;
