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
  try {
    const u = new URL(url);
    return u.searchParams.get("list");
  } catch (e) {
    return null;
  }
}

// Recursively search YouTube's embedded page data for playlist video entries.
// This walks the whole object tree rather than a fixed path, since YouTube's
// internal structure shifts between updates.
function findPlaylistVideos(node, out) {
  if (!node || typeof node !== "object") return;
  if (node.playlistVideoRenderer) {
    const v = node.playlistVideoRenderer;
    const videoId = v.videoId;
    const title = (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text) ||
                  (v.title && v.title.simpleText) ||
                  videoId;
    if (videoId && title) out.push({ id: videoId, title });
  }
  for (const key in node) {
    findPlaylistVideos(node[key], out);
  }
}

function parseVideosFromHtml(html) {
  const videos = [];
  const seen = new Set();

  const match = html.match(/(?:var\s+|window\["ytInitialData"\]\s*=\s*|ytInitialData\s*=\s*)({[\s\S]*?});\s*<\/script>/) ||
                html.match(/ytInitialData\s*=\s*({[\s\S]*?});/);

  if (match) {
    try {
      const data = JSON.parse(match[1]);
      findPlaylistVideos(data, videos);
    } catch (e) {
      // Ignore JSON parse error, try regex fallback
    }
  }

  // Regex fallback directly on HTML
  if (videos.length === 0) {
    const regex = /"playlistVideoRenderer":\s*\{"videoId":"([^"]+)".*?"title":\s*\{(?:"runs":\[\{"text":"([^"]+)"\}]|"simpleText":"([^"]+)")/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      const id = m[1];
      const title = m[2] || m[3] || id;
      if (!seen.has(id)) {
        seen.add(id);
        videos.push({ id, title });
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

  return unique;
}

function extractVideosFromPage() {
  const videos = [];
  const seen = new Set();

  // 1. Try DOM elements ytd-playlist-video-renderer
  const nodes = document.querySelectorAll("ytd-playlist-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer");
  nodes.forEach(node => {
    const titleEl = node.querySelector("#video-title, a#video-title, span#video-title");
    const linkEl = node.querySelector("a[href*='watch?v=']");
    if (linkEl && titleEl) {
      const href = linkEl.getAttribute("href") || "";
      const match = href.match(/v=([a-zA-Z0-9_-]{11})/);
      if (match && !seen.has(match[1])) {
        seen.add(match[1]);
        videos.push({ id: match[1], title: titleEl.textContent.trim() });
      }
    }
  });

  // 2. Try window.ytInitialData if available on page
  if (videos.length === 0 && window.ytInitialData) {
    function findVideos(n) {
      if (!n || typeof n !== "object") return;
      if (n.playlistVideoRenderer) {
        const v = n.playlistVideoRenderer;
        const id = v.videoId;
        const title = (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text) ||
                      (v.title && v.title.simpleText) || id;
        if (id && title && !seen.has(id)) {
          seen.add(id);
          videos.push({ id, title });
        }
      }
      for (const k in n) findVideos(n[k]);
    }
    findVideos(window.ytInitialData);
  }

  return videos;
}

async function fetchPlaylist(rawUrl) {
  const listId = extractPlaylistId(rawUrl) || rawUrl.trim();
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;

  let videos = [];

  // Strategy 1: Remote Fetch
  try {
    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (res.ok) {
      const html = await res.text();
      videos = parseVideosFromHtml(html);
    }
  } catch (e) {
    console.warn("Remote fetch failed, trying tab inspection:", e);
  }

  // Strategy 2: Active & Open Tab Communication
  if (videos.length === 0 && typeof chrome !== "undefined" && chrome.tabs) {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url && (tab.url.includes("youtube.com") || tab.url.includes("youtu.be"))) {
          // 2a. Message content script on open YouTube tab
          try {
            const response = await new Promise(resolve => {
              const timer = setTimeout(() => resolve(null), 400);
              chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PLAYLIST" }, res => {
                clearTimeout(timer);
                resolve(res);
              });
            });
            if (response && response.ok && response.videos && response.videos.length > 0) {
              videos = response.videos;
              break;
            }
          } catch (err) {}

          // 2b. Fallback to chrome.scripting.executeScript
          if (chrome.scripting) {
            try {
              const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractVideosFromPage
              });
              if (results && results[0] && results[0].result && results[0].result.length > 0) {
                videos = results[0].result;
                break;
              }
            } catch (err) {}
          }
        }
      }
    } catch (e) {
      console.warn("Tab execution fallback failed:", e);
    }
  }

  if (videos.length === 0) {
    throw new Error("Couldn't read that playlist's video list. Make sure the playlist is public/unlisted or open it in a YouTube tab.");
  }

  return videos;
}

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "VIDEO_WATCHED") {
    handleVideoWatched(msg).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "FETCH_PLAYLIST") {
    fetchPlaylist(msg.url)
      .then(videos => sendResponse({ ok: true, videos }))
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