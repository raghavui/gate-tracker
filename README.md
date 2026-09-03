# GATE Progress Tracker (Chrome extension)

## Install it (unpacked — this isn't on the Chrome Web Store)

1. Unzip this folder somewhere permanent (don't delete it after install — Chrome loads the extension from these files).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder.
5. Pin the extension (puzzle-piece icon → pin) so it's easy to open.

## How to use it

1. Click the extension icon. Pick your GATE domain (CS, EC, EE, ME, CE, or Custom) — the standard subject list loads in automatically. You can add/remove subjects any time.
2. Open a subject, paste a YouTube playlist URL into "Paste a YouTube playlist URL", and click **Fetch**. The extension reads the playlist's video list directly from the page.
3. Just watch your videos on YouTube normally. When a video from an assigned playlist plays to about 95%, it's marked watched automatically — no need to check anything by hand. You can still tick/untick videos manually if you want to correct something.
4. Check the **History** tab for a timestamped log of everything it's detected, and the **Progress** tab for per-subject and overall completion.

## How the automatic tracking works

- A small script runs only on `youtube.com/watch` pages, watches the video player's progress, and reports back once you cross ~95% of a video.
- It matches the video by its YouTube video ID against the playlists you've assigned to subjects. A watched video that isn't part of any assigned playlist still shows up in History, just marked "not in a tracked playlist," so you can see the extension is working even before you've assigned everything.
- Playlist reading works by fetching the public playlist page and parsing its video list, so it only works for playlists that are public or unlisted-with-link (not private ones you don't have direct page access to).

## Known limitations

- This is unpacked/local only — it isn't reviewed or published, so treat it as a personal tool, not something to install from an untrusted source.
- YouTube periodically changes its page structure; if playlist-reading ever stops working, that's usually why.
- Detection needs the tab to be open and playing — it doesn't track videos watched in incognito mode unless you explicitly allow the extension there (`chrome://extensions` → Details → "Allow in Incognito").
- All data is stored locally in your browser (`chrome.storage.local`) — nothing is sent anywhere else.
