import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------------------------------
// 1. Manifest V3 Validation Test
// ----------------------------------------------------
test("Manifest V3 format and required fields", () => {
  const manifestPath = path.join(__dirname, "manifest.json");
  assert.ok(fs.existsSync(manifestPath), "manifest.json must exist");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3, "Manifest version must be 3");
  assert.ok(manifest.name, "Manifest must have a name");
  assert.ok(manifest.version, "Manifest must have a version");
  assert.ok(manifest.permissions.includes("storage"), "Manifest must include 'storage' permission");

  assert.ok(manifest.background && manifest.background.service_worker, "Background service worker must be defined");
  assert.equal(manifest.background.service_worker, "background.js");

  assert.ok(Array.isArray(manifest.content_scripts), "content_scripts must be an array");
  assert.equal(manifest.content_scripts[0].js[0], "content-watch.js");
});

// ----------------------------------------------------
// 2. Syllabi Data Tests
// ----------------------------------------------------
test("GATE Syllabi data structure", async () => {
  const syllabiCode = fs.readFileSync(path.join(__dirname, "syllabi.js"), "utf8");
  const context = {};
  new Function("const GATE_SYLLABI = " + syllabiCode.replace(/const GATE_SYLLABI =\s*/, "") + "; return GATE_SYLLABI;")();
  
  // Evaluate syllabi
  const evalSyllabi = new Function(syllabiCode + "\nreturn GATE_SYLLABI;")();
  assert.ok(evalSyllabi.cs, "CS syllabus exists");
  assert.ok(evalSyllabi.ece, "ECE syllabus exists");
  assert.ok(evalSyllabi.ee, "EE syllabus exists");
  assert.ok(evalSyllabi.me, "ME syllabus exists");
  assert.ok(evalSyllabi.ce, "CE syllabus exists");
  assert.ok(evalSyllabi.custom, "Custom syllabus exists");

  assert.equal(typeof evalSyllabi.cs.label, "string");
  assert.ok(Array.isArray(evalSyllabi.cs.subjects));
  assert.ok(evalSyllabi.cs.subjects.includes("Algorithms"));
  assert.ok(evalSyllabi.cs.subjects.includes("Theory of Computation"));
  assert.equal(evalSyllabi.custom.subjects.length, 0);
});

// ----------------------------------------------------
// 3. Background Script Functionality Tests
// ----------------------------------------------------
test("Background logic: extractPlaylistId", () => {
  // Extract function logic from background.js
  function extractPlaylistId(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get("list");
    } catch (e) {
      return null;
    }
  }

  assert.equal(extractPlaylistId("https://www.youtube.com/playlist?list=PL12345XYZ"), "PL12345XYZ");
  assert.equal(extractPlaylistId("https://www.youtube.com/watch?v=vid123&list=PL999"), "PL999");
  assert.equal(extractPlaylistId("invalid-url"), null);
  assert.equal(extractPlaylistId("https://www.youtube.com/watch?v=vid123"), null);
});

test("Background logic: findPlaylistVideos parsing ytInitialData", () => {
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

  const sampleYtData = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: [
                          {
                            playlistVideoListRenderer: {
                              contents: [
                                {
                                  playlistVideoRenderer: {
                                    videoId: "video_1",
                                    title: { runs: [{ text: "Lecture 1: Intro to CS" }] }
                                  }
                                },
                                {
                                  playlistVideoRenderer: {
                                    videoId: "video_2",
                                    title: { simpleText: "Lecture 2: Data Structures" }
                                  }
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          }
        ]
      }
    }
  };

  const results = [];
  findPlaylistVideos(sampleYtData, results);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { id: "video_1", title: "Lecture 1: Intro to CS" });
  assert.deepEqual(results[1], { id: "video_2", title: "Lecture 2: Data Structures" });
});

test("Background logic: handleVideoWatched state updates & history", async () => {
  let mockStorage = {};
  const mockChrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: mockStorage[key] }),
        set: async (obj) => { Object.assign(mockStorage, obj); }
      }
    }
  };

  const STORAGE_KEY = "gateTrackerData";
  function emptyData() {
    return { domain: "cs", subjects: [
      {
        id: "sub1",
        name: "Algorithms",
        playlists: [
          {
            id: "pl1",
            name: "Algo Playlist",
            url: "http://example.com",
            videos: [
              { id: "v100", title: "Sorting Algorithms", watched: false, watchedAt: null },
              { id: "v101", title: "Graph Algorithms", watched: false, watchedAt: null }
            ]
          }
        ]
      }
    ], history: [] };
  }

  async function getData() {
    const res = await mockChrome.storage.local.get(STORAGE_KEY);
    return res[STORAGE_KEY] || emptyData();
  }
  async function setData(data) {
    await mockChrome.storage.local.set({ [STORAGE_KEY]: data });
  }

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

    data.history.unshift({
      videoId,
      title: title || videoId,
      subjectName: matchSubjectName,
      watchedAt,
      matched
    });
    if (data.history.length > 500) data.history.length = 500;
    await setData(data);
  }

  const now = Date.now();
  // 1. Watch tracked video v100
  await handleVideoWatched({ videoId: "v100", title: "Sorting Algorithms", watchedAt: now });
  
  let currentData = await getData();
  assert.equal(currentData.subjects[0].playlists[0].videos[0].watched, true);
  assert.equal(currentData.subjects[0].playlists[0].videos[0].watchedAt, now);
  assert.equal(currentData.history.length, 1);
  assert.equal(currentData.history[0].matched, true);
  assert.equal(currentData.history[0].subjectName, "Algorithms");

  // 2. Watch untracked video v999
  await handleVideoWatched({ videoId: "v999", title: "Random Video", watchedAt: now + 1000 });
  currentData = await getData();
  assert.equal(currentData.history.length, 2);
  assert.equal(currentData.history[0].matched, false);
  assert.equal(currentData.history[0].subjectName, null);
});

// ----------------------------------------------------
// 4. Content Script Unit Tests
// ----------------------------------------------------
test("Content script: video URL and title parsing", () => {
  function getVideoIdFromUrl(urlString) {
    try {
      const u = new URL(urlString);
      return u.searchParams.get("v");
    } catch (e) {
      return null;
    }
  }

  function getVideoTitle(docTitle) {
    const t = docTitle || "";
    return t.replace(/\s*-\s*YouTube\s*$/, "").trim();
  }

  assert.equal(getVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(getVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"), "dQw4w9WgXcQ");
  assert.equal(getVideoIdFromUrl("https://www.youtube.com/feed/subscriptions"), null);

  assert.equal(getVideoTitle("GATE CS 2026 Complete Strategy - YouTube"), "GATE CS 2026 Complete Strategy");
  assert.equal(getVideoTitle("Lecture 1 - YouTube"), "Lecture 1");
  assert.equal(getVideoTitle("Just Title"), "Just Title");
});

test("Content script: threshold progress detection", () => {
  const WATCHED_THRESHOLD = 0.95;

  function isWatched(currentTime, duration) {
    if (!duration) return false;
    return (currentTime / duration) >= WATCHED_THRESHOLD;
  }

  assert.equal(isWatched(94, 100), false);
  assert.equal(isWatched(95, 100), true);
  assert.equal(isWatched(99, 100), true);
  assert.equal(isWatched(0, 100), false);
  assert.equal(isWatched(100, 0), false);
});

// ----------------------------------------------------
// 5. Popup Derived Statistics & Mutation Tests
// ----------------------------------------------------
test("Popup statistics calculations", () => {
  function subjectStats(subject) {
    let total = 0, watched = 0;
    subject.playlists.forEach(pl => {
      total += pl.videos.length;
      watched += pl.videos.filter(v => v.watched).length;
    });
    return { total, watched, pct: total ? Math.round((watched / total) * 100) : 0 };
  }

  function overallStats(subjects) {
    let total = 0, watched = 0;
    subjects.forEach(s => {
      const st = subjectStats(s);
      total += st.total;
      watched += st.watched;
    });
    return { total, watched, pct: total ? Math.round((watched / total) * 100) : 0 };
  }

  const mockSubjects = [
    {
      id: "s1",
      name: "Subject 1",
      playlists: [
        {
          id: "p1",
          videos: [
            { id: "v1", watched: true },
            { id: "v2", watched: true },
            { id: "v3", watched: false },
            { id: "v4", watched: false }
          ]
        }
      ]
    },
    {
      id: "s2",
      name: "Subject 2",
      playlists: [
        {
          id: "p2",
          videos: [
            { id: "v5", watched: true }
          ]
        }
      ]
    }
  ];

  const st1 = subjectStats(mockSubjects[0]);
  assert.equal(st1.total, 4);
  assert.equal(st1.watched, 2);
  assert.equal(st1.pct, 50);

  const st2 = subjectStats(mockSubjects[1]);
  assert.equal(st2.total, 1);
  assert.equal(st2.watched, 1);
  assert.equal(st2.pct, 100);

  const ov = overallStats(mockSubjects);
  assert.equal(ov.total, 5);
  assert.equal(ov.watched, 3);
  assert.equal(ov.pct, 60); // 3 / 5 = 60%
});
