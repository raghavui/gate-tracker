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

async function fetchPlaylist(rawUrl) {
  const listId = extractPlaylistId(rawUrl) || rawUrl.trim();
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;

  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Couldn't load that playlist page (status ${res.status}).`);
  }
  const html = await res.text();

  const match = html.match(/var ytInitialData\s*=\s*({.*?});<\/script>/s);
  if (!match) {
    throw new Error("Couldn't read that playlist's video list. It may be private or unlisted-without-access.");
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    throw new Error("Couldn't parse that playlist's data.");
  }

  const videos = [];
  findPlaylistVideos(data, videos);

  // De-duplicate by video id, preserving order.
  const seen = new Set();
  const unique = videos.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });

  if (unique.length === 0) {
    throw new Error("That playlist looks empty, or its page structure isn't readable right now.");
  }

  return unique;
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