// Runs on every youtube.com/watch page. Watches the <video> element and,
// once playback crosses ~95%, reports the video as watched to the background
// script. Handles YouTube's single-page-app navigation (no full reload
// between videos) by re-attaching on the "yt-navigate-finish" event.

(function () {
  const WATCHED_THRESHOLD = 0.95;
  let currentVideoId = null;
  let reportedForCurrent = false;
  let attachedVideoEl = null;

  function getVideoIdFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("v");
    } catch (e) {
      return null;
    }
  }

  function getVideoTitle() {
    // Document title is usually "Video Title - YouTube".
    const t = document.title || "";
    return t.replace(/\s*-\s*YouTube\s*$/, "").trim();
  }

  function onTimeUpdate(e) {
    const video = e.target;
    if (!video.duration || reportedForCurrent) return;
    if (video.currentTime / video.duration >= WATCHED_THRESHOLD) {
      reportedForCurrent = true;
      chrome.runtime.sendMessage({
        type: "VIDEO_WATCHED",
        videoId: currentVideoId,
        title: getVideoTitle(),
        watchedAt: Date.now()
      });
    }
  }

  function attach() {
    const videoId = getVideoIdFromUrl();
    if (!videoId) return;

    if (videoId !== currentVideoId) {
      currentVideoId = videoId;
      reportedForCurrent = false;
    }

    const video = document.querySelector("video");
    if (!video || video === attachedVideoEl) return;

    if (attachedVideoEl) {
      attachedVideoEl.removeEventListener("timeupdate", onTimeUpdate);
    }
    attachedVideoEl = video;
    video.addEventListener("timeupdate", onTimeUpdate);
  }

  // Initial load: the <video> element may not exist yet, so poll briefly.
  let attempts = 0;
  const poll = setInterval(() => {
    attach();
    attempts++;
    if (attachedVideoEl || attempts > 20) clearInterval(poll);
  }, 500);

  // YouTube fires this custom event when navigating between videos without
  // a full page reload.
  document.addEventListener("yt-navigate-finish", () => {
    attachedVideoEl = null;
    let a2 = 0;
    const p2 = setInterval(() => {
      attach();
      a2++;
      if (attachedVideoEl || a2 > 20) clearInterval(p2);
    }, 500);
  });

  // Listener for background request to extract playlist videos from active page
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "EXTRACT_PLAYLIST") {
      const videos = extractPlaylistVideosFromDOM();
      sendResponse({ ok: true, videos });
      return true;
    }
  });

  function isDurationString(str) {
    if (!str) return true;
    const cleaned = str.trim();
    return /^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(cleaned);
  }

  function getTitleFromDOMNode(node) {
    const titleEl = node.querySelector("#video-title, yt-formatted-string#video-title, a#video-title, span#video-title");
    if (titleEl) {
      const attr = titleEl.getAttribute("title");
      if (attr && attr.trim() && !isDurationString(attr)) return attr.trim();
      const aria = titleEl.getAttribute("aria-label");
      if (aria && aria.trim() && !isDurationString(aria)) return aria.trim();
      const txt = (titleEl.textContent || "").trim();
      if (txt && !isDurationString(txt) && txt.toLowerCase() !== "youtube") return txt;
    }

    const linkWithTitle = node.querySelector("a[title]");
    if (linkWithTitle) {
      const attr = linkWithTitle.getAttribute("title");
      if (attr && attr.trim() && !isDurationString(attr)) return attr.trim();
    }

    return null;
  }

  function extractPlaylistVideosFromDOM() {
    const videos = [];
    const seen = new Set();

    const nodes = document.querySelectorAll(
      "ytd-playlist-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer"
    );

    nodes.forEach(node => {
      const link = node.querySelector("a[href*='watch?v=']");
      const title = getTitleFromDOMNode(node);

      if (link && title) {
        const href = link.getAttribute("href") || "";
        const match = href.match(/v=([a-zA-Z0-9_-]{11})/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          videos.push({ id: match[1], title });
        }
      }
    });

    return videos;
  }
})();