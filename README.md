# GATE Progress Tracker 🚀

A Chrome extension designed to help GATE aspirants track their
preparation progress through YouTube playlists.

The extension lets you organize subjects, connect YouTube playlists,
automatically track watched videos, and monitor your overall preparation
progress.

## ✨ Features

-   📚 Support for multiple GATE domains such as CS, EC, EE, ME and CE
-   📖 Add and manage subjects
-   ▶️ Assign YouTube playlists to subjects
-   👀 Automatically detect watched YouTube videos
-   📊 Track subject-wise and overall progress
-   ✅ Manually mark videos as watched/unwatched
-   🕒 Maintain watch history with timestamps
-   💾 Store user data locally in the browser
-   🎯 Simple dashboard for monitoring preparation

## 📥 Installation

### Option 1: Direct GitHub ZIP (Easiest)

1. Click the green **Code** button at the top of [github.com/raghavui/gate-tracker](https://github.com/raghavui/gate-tracker) and select **Download ZIP** (or download `gate-tracker-main.zip`).
2. Extract the downloaded ZIP file on your computer.
3. Open Google Chrome and go to `chrome://extensions`.
4. Enable **Developer mode** (toggle switch in the top-right corner).
5. Click **Load unpacked** (top-left corner).
6. Select the extracted `gate-tracker-main` folder.
7. Pin **GATE Progress Tracker** from the Chrome extensions menu (🧩 icon).

### Option 2: Download Release ZIP

1. Go to the [Releases](../../releases) page.
2. Download `gate-tracker-v1.0.0.zip` from **Assets**.
3. Extract the ZIP file.
4. Open Chrome, go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the extracted folder.

> The extension is distributed as a ZIP package for installation as an unpacked Chrome extension. It does not currently require Chrome Web Store publishing.

## 🖥️ How It Works

1.  Select your GATE domain.
2.  Add the subjects you are preparing.
3.  Add the corresponding YouTube playlists.
4.  Start watching the videos.
5.  The extension tracks your progress.
6.  View subject-wise and overall completion from the dashboard.

## 🔒 Privacy

-   User progress is stored locally in the browser.
-   The extension does not intentionally send personal tracking data to
    an external server.
-   YouTube is used to access and track the relevant video/playlist
    information.

## ⚠️ Known Limitations

-   YouTube may change its page structure, which can affect playlist or
    video detection.
-   Video tracking requires the YouTube tab to remain open and the video
    to be playing.
-   Private YouTube playlists cannot be read.
-   The extension currently requires Chrome Developer Mode for
    installation.

## 🛠️ Technology

-   HTML
-   CSS
-   JavaScript
-   Chrome Extensions API
-   YouTube integration
-   Chrome Local Storage

## 📂 Project Structure

``` text
gate-tracker/
├── manifest.json
├── background.js
├── content-watch.js
├── popup.html
├── popup.js
├── popup.css
├── syllabi.js
├── README.md
└── ...
```

## 🧑‍💻 Development

To run the project locally:

1.  Clone the repository:

    ``` bash
    git clone https://github.com/raghavui/gate-tracker.git
    ```

2.  Open Chrome and go to:

    `chrome://extensions`

3.  Enable **Developer mode**.

4.  Click **Load unpacked**.

5.  Select the cloned `gate-tracker` folder.

6.  Make changes to the source files and reload the extension from the
    Chrome extensions page.

## 📦 Releases

Stable versions are available on the [GitHub Releases](../../releases)
page.

Current release:

**v1.0.0 --- Initial Release**

## 🗺️ Future Improvements

-   Chrome Web Store publication
-   Improved YouTube detection
-   More detailed analytics
-   Better progress visualization
-   Additional GATE exam features
-   Improved extension UI/UX

## 🤝 Contributing

Contributions, suggestions, and bug reports are welcome.

If you find a bug or have an idea for improvement, feel free to open an
issue or submit a pull request.

## ⭐ Support

If you find **GATE Progress Tracker** useful, consider giving the
repository a ⭐ on GitHub.

------------------------------------------------------------------------

Made for GATE aspirants 🎓
