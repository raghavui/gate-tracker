// Background service worker.
// Owns the data model in chrome.storage.local and handles two jobs:
//  1. Recording a video as watched when content-watch.js reports it.
//  2. Fetching a YouTube playlist page and extracting its video list.

const STORAGE_KEY = "gateTrackerData";

function emptyData() {
  return { domain: null, subjects: [], history: [] };
}

async function getData() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return res[STORAGE_KEY] || emptyData();
}

async function setData(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

// ---------- video watched ----------
async function handleVideoWatched({ videoId, title, watchedAt }) {
  const data = await getData();
  let matched = false;
  let matchSubjectName = null;

  for (const subject of data.subjects) {
    for (const playlist of subject.playlists) {
      const video = playlist.videos.find(v => v.id === videoId);
      if (video) {
        matched = true;
        matchSubjectName = subject.name;
        if (!video.watched) {
          video.watched = true;
          video.watchedAt = watchedAt;
        }
      }
    }
  }

  // Log every detected watch to history, even if it isn't part of a
  // tracked playlist yet, so the person can see the extension is working.
  data.history.unshift({
    videoId,
    title: title || videoId,
    subjectName: matchSubjectName,
    watchedAt,
    matched
  });
  // Keep history from growing unbounded.
  if (data.history.length > 500) data.history.length = 500;

  await setData(data);
}

// ---------- playlist scraping ----------
function extractPlaylistId(url) {
  if (!url) return null;
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    const listParam = u.searchParams.get("list");
    if (listParam) return listParam;
  } catch (e) {}

  const m = trimmed.match(/list=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];

  return trimmed;
}

function isDurationString(str) {
  if (!str) return true;
  const cleaned = str.trim();
  return /^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(cleaned);
}

// Recursively search YouTube's embedded page data for playlist video entries.
function findPlaylistVideos(node, out, seen = new Set()) {
  if (!node || typeof node !== "object") return;

  if (node.playlistVideoRenderer) {
    const v = node.playlistVideoRenderer;
    const videoId = v.videoId;
    let title = (v.title && v.title.runs && v.title.runs.map(r => r.text).join("")) ||
                (v.title && v.title.simpleText) ||
                (v.title && v.title.accessibility && v.title.accessibility.accessibilityData && v.title.accessibility.accessibilityData.label) ||
                videoId;
    if (title && isDurationString(title)) {
      title = videoId;
    }
    if (videoId && title && !seen.has(videoId)) {
      seen.add(videoId);
      out.push({ id: videoId, title: title.trim() });
    }
  }

  if (node.lockupViewModel) {
    const lvm = node.lockupViewModel;
    const videoId = lvm.contentId;
    let title = lvm.metadata &&
                lvm.metadata.lockupMetadataViewModel &&
                lvm.metadata.lockupMetadataViewModel.title &&
                lvm.metadata.lockupMetadataViewModel.title.content;
    if (!title && lvm.metadata && lvm.metadata.lockupMetadataViewModel && lvm.metadata.lockupMetadataViewModel.title && lvm.metadata.lockupMetadataViewModel.title.accessibility && lvm.metadata.lockupMetadataViewModel.title.accessibility.accessibilityData) {
      title = lvm.metadata.lockupMetadataViewModel.title.accessibility.accessibilityData.label;
    }
    if (title && isDurationString(title)) {
      title = videoId;
    }
    if (videoId && title && !seen.has(videoId)) {
      seen.add(videoId);
      out.push({ id: videoId, title: title.trim() });
    }
  }

  if (node.videoRenderer || node.gridVideoRenderer) {
    const v = node.videoRenderer || node.gridVideoRenderer;
    const videoId = v.videoId;
    let title = (v.title && v.title.runs && v.title.runs.map(r => r.text).join("")) ||
                (v.title && v.title.simpleText) ||
                videoId;
    if (title && isDurationString(title)) {
      title = videoId;
    }
    if (videoId && title && !seen.has(videoId)) {
      seen.add(videoId);
      out.push({ id: videoId, title: title.trim() });
    }
  }

  for (const key in node) {
    findPlaylistVideos(node[key], out, seen);
  }
}

function extractJsonObject(str, startPos) {
  const openBrace = str.indexOf("{", startPos);
  if (openBrace === -1) return null;
  let count = 0;
  let inString = false;
  let escape = false;

  for (let i = openBrace; i < str.length; i++) {
    const ch = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") count++;
      else if (ch === "}") {
        count--;
        if (count === 0) {
          return str.slice(openBrace, i + 1);
        }
      }
    }
  }
  return null;
}

function extractPlaylistTitle(data) {
  if (!data || typeof data !== "object") return null;
  try {
    if (data.metadata && data.metadata.playlistMetadataRenderer && data.metadata.playlistMetadataRenderer.title) {
      return data.metadata.playlistMetadataRenderer.title;
    }
    if (data.header && data.header.playlistHeaderRenderer && data.header.playlistHeaderRenderer.title) {
      const t = data.header.playlistHeaderRenderer.title;
      return t.simpleText || (t.runs && t.runs.map(r => r.text).join(""));
    }
    if (data.sidebar && data.sidebar.playlistSidebarRenderer) {
      const info = data.sidebar.playlistSidebarRenderer.items && data.sidebar.playlistSidebarRenderer.items[0] && data.sidebar.playlistSidebarRenderer.items[0].playlistSidebarPrimaryInfoRenderer;
      if (info && info.title) {
        const t = info.title;
        return t.simpleText || (t.runs && t.runs.map(r => r.text).join(""));
      }
    }
  } catch (e) {}
  return null;
}

function parseVideosFromHtml(html) {
  const videos = [];
  const seen = new Set();
  let playlistTitle = null;

  const pos = html.indexOf("ytInitialData");
  if (pos !== -1) {
    const jsonStr = extractJsonObject(html, pos);
    if (jsonStr) {
      try {
        const data = JSON.parse(jsonStr);
        playlistTitle = extractPlaylistTitle(data);
        findPlaylistVideos(data, videos, seen);
      } catch (e) {
        // Ignore JSON parse error, try fallback
      }
    }
  }

  // Regex fallback 1: playlistVideoRenderer
  if (videos.length === 0) {
    const regex = /"playlistVideoRenderer":\s*\{"videoId":"([^"]+)".*?"title":\s*\{(?:"runs":\[\{"text":"([^"]+)"\}]|"simpleText":"([^"]+)")/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      const id = m[1];
      const title = m[2] || m[3] || id;
      if (!seen.has(id) && !isDurationString(title)) {
        seen.add(id);
        videos.push({ id, title: title.trim() });
      }
    }
  }

  // Regex fallback 2: lockupViewModel contentId
  if (videos.length === 0) {
    const regexLockup = /"lockupViewModel":\s*\{[^}]*?"contentId":"([a-zA-Z0-9_-]{11})"/g;
    let m;
    while ((m = regexLockup.exec(html)) !== null) {
      const id = m[1];
      if (!seen.has(id)) {
        seen.add(id);
        videos.push({ id, title: id });
      }
    }
  }

  // De-duplicate by video id, preserving order.
  const unique = [];
  const idSet = new Set();
  videos.forEach(v => {
    if (!idSet.has(v.id)) {
      idSet.add(v.id);
      unique.push(v);
    }
  });

  return { videos: unique, playlistTitle };
}

function extractVideosFromPage() {
  function isDuration(str) {
    if (!str) return true;
    const cleaned = str.trim();
    return /^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(cleaned);
  }

  function getDomTitle(node) {
    const titleEl = node.querySelector("#video-title, yt-formatted-string#video-title, a#video-title, span#video-title, .yt-lockup-metadata-view-model-wiz__title, h3, a[href*='watch?v=']");
    if (titleEl) {
      const attr = titleEl.getAttribute("title");
      if (attr && attr.trim() && !isDuration(attr)) return attr.trim();
      const aria = titleEl.getAttribute("aria-label");
      if (aria && aria.trim() && !isDuration(aria)) return aria.trim();
      const txt = (titleEl.textContent || "").trim();
      if (txt && !isDuration(txt) && txt.toLowerCase() !== "youtube") return txt;
    }

    const linkWithTitle = node.querySelector("a[title]");
    if (linkWithTitle) {
      const attr = linkWithTitle.getAttribute("title");
      if (attr && attr.trim() && !isDuration(attr)) return attr.trim();
    }

    return null;
  }

  const videos = [];
  const seen = new Set();

  // 1. Try window.ytInitialData if available on page
  if (typeof window.ytInitialData === "object" && window.ytInitialData) {
    function findVideos(n) {
      if (!n || typeof n !== "object") return;
      if (n.playlistVideoRenderer) {
        const v = n.playlistVideoRenderer;
        const id = v.videoId;
        let title = (v.title && v.title.runs && v.title.runs.map(r => r.text).join("")) ||
                    (v.title && v.title.simpleText) || id;
        if (title && isDuration(title)) title = id;
        if (id && title && !seen.has(id)) {
          seen.add(id);
          videos.push({ id, title: title.trim() });
        }
      }
      if (n.lockupViewModel) {
        const lvm = n.lockupViewModel;
        const id = lvm.contentId;
        let title = lvm.metadata &&
                    lvm.metadata.lockupMetadataViewModel &&
                    lvm.metadata.lockupMetadataViewModel.title &&
                    lvm.metadata.lockupMetadataViewModel.title.content;
        if (title && isDuration(title)) title = id;
        if (id && title && !seen.has(id)) {
          seen.add(id);
          videos.push({ id, title: title.trim() });
        }
      }
      for (const k in n) findVideos(n[k]);
    }
    findVideos(window.ytInitialData);
  }

  // 2. Try DOM elements ytd-playlist-video-renderer, yt-lockup-view-model, etc.
  if (videos.length === 0) {
    const nodes = document.querySelectorAll(
      "ytd-playlist-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytd-playlist-panel-video-renderer"
    );
    nodes.forEach(node => {
      const link = node.querySelector("a[href*='watch?v=']");
      const title = getDomTitle(node);

      if (link) {
        const href = link.getAttribute("href") || "";
        const match = href.match(/v=([a-zA-Z0-9_-]{11})/);
        if (match && !seen.has(match[1])) {
          const videoTitle = title || match[1];
          seen.add(match[1]);
          videos.push({ id: match[1], title: videoTitle });
        }
      }
    });
  }

  return videos;
}

async function extractFromTab(tabId) {
  try {
    const response = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 400);
      chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PLAYLIST" }, res => {
        const err = chrome.runtime.lastError;
        clearTimeout(timer);
        resolve(res);
      });
    });
    if (response && response.ok && response.videos && response.videos.length > 0) {
      return response.videos;
    }
  } catch (err) {}

  if (typeof chrome !== "undefined" && chrome.scripting) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractVideosFromPage
      });
      if (results && results[0] && results[0].result && results[0].result.length > 0) {
        return results[0].result;
      }
    } catch (err) {}
  }
  return [];
}

async function fetchPlaylist(rawUrl) {
  const listId = extractPlaylistId(rawUrl);
  if (!listId) {
    throw new Error("Invalid playlist URL or ID.");
  }
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;

  let videos = [];
  let playlistTitle = null;

  // Strategy 1: Direct Remote Fetch
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (res.ok) {
      const html = await res.text();
      const parsed = parseVideosFromHtml(html);
      videos = parsed.videos;
      playlistTitle = parsed.playlistTitle;

      // InnerTube API fallback if HTML parsing returned 0 videos
      if (videos.length === 0) {
        const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
        if (keyMatch) {
          const apiKey = keyMatch[1];
          const browseId = listId.startsWith("VL") ? listId : "VL" + listId;
          const apiRes = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            },
            body: JSON.stringify({
              context: {
                client: {
                  clientName: "WEB",
                  clientVersion: "2.20240301.00.00",
                  originalUrl: url,
                  mainAppWebInfo: { graftUrl: `/playlist?list=${listId}` }
                }
              },
              browseId
            })
          });
          if (apiRes.ok) {
            const json = await apiRes.json();
            const seen = new Set();
            findPlaylistVideos(json, videos, seen);
            if (!playlistTitle) playlistTitle = extractPlaylistTitle(json);
          }
        }
      }
    }
  } catch (e) {
    console.warn("Direct remote fetch failed:", e);
  }

  // Strategy 2: Check open YouTube tab ONLY if tab URL strictly matches requested listId
  if (videos.length === 0 && typeof chrome !== "undefined" && chrome.tabs) {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url && typeof tab.url === "string") {
          const tabListId = extractPlaylistId(tab.url);
          if (tabListId && tabListId === listId) {
            const v = await extractFromTab(tab.id);
            if (v && v.length > 0) {
              videos = v;
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn("Open tab check failed:", e);
    }
  }

  // Strategy 3: Temporary background tab fallback specifically for this listId
  if (videos.length === 0 && typeof chrome !== "undefined" && chrome.tabs && chrome.scripting) {
    let tempTab = null;
    try {
      tempTab = await chrome.tabs.create({ url, active: false });
      if (tempTab && tempTab.id) {
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 400));
          const v = await extractFromTab(tempTab.id);
          if (v && v.length > 0) {
            videos = v;
            break;
          }
        }
      }
    } catch (e) {
      console.warn("Background tab rendering fallback failed:", e);
    } finally {
      if (tempTab && tempTab.id) {
        try {
          await chrome.tabs.remove(tempTab.id);
        } catch (e) {}
      }
    }
  }

  if (videos.length === 0) {
    throw new Error("Couldn't read that playlist's video list. Make sure the playlist link is public/unlisted.");
  }

  return { videos, playlistTitle };
}

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "VIDEO_WATCHED") {
    handleVideoWatched(msg).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "FETCH_PLAYLIST") {
    fetchPlaylist(msg.url)
      .then(res => sendResponse({ ok: true, videos: res.videos, playlistTitle: res.playlistTitle }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "GET_DATA") {
    getData().then(data => sendResponse({ ok: true, data }));
    return true;
  }
  if (msg.type === "SET_DATA") {
    setData(msg.data).then(() => sendResponse({ ok: true }));
    return true;
  }
});