async function run() {
  const url = 'https://www.youtube.com/playlist?list=PLvTTv60o7qj_tdY9zH7YcEEStjfiXzKAz';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await res.text();
  console.log('Fetched HTML length:', html.length);

  // Method 1: Extract ytInitialData object
  let jsonStr = null;
  const startMarker = 'ytInitialData = ';
  const startIdx = html.indexOf(startMarker);
  if (startIdx !== -1) {
    const jsonStart = startIdx + startMarker.length;
    const endIdx = html.indexOf(';</script>', jsonStart);
    if (endIdx !== -1) {
      jsonStr = html.slice(jsonStart, endIdx);
    }
  }

  if (!jsonStr) {
    console.log('Could not locate ytInitialData string bounds');
  } else {
    console.log('Extracted jsonStr length:', jsonStr.length);
    try {
      const data = JSON.parse(jsonStr);
      console.log('Parsed JSON successfully!');

      function findPlaylistVideos(node, out) {
        if (!node || typeof node !== 'object') return;
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

      const videos = [];
      findPlaylistVideos(data, videos);
      console.log('Method 1 videos count:', videos.length);
      if (videos.length > 0) {
        console.log('Sample video:', videos[0]);
      }
    } catch (e) {
      console.log('JSON parse error:', e.message);
    }
  }

  // Method 2: Extract videoId & title patterns directly from HTML
  const fallbackVideos = [];
  const regex = /"playlistVideoRenderer":\s*\{"videoId":"([^"]+)".*?"title":\s*\{(?:"runs":\[\{"text":"([^"]+)"\}]|"simpleText":"([^"]+)")/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const id = match[1];
    const title = match[2] || match[3] || id;
    fallbackVideos.push({ id, title });
  }
  console.log('Method 2 regex videos count:', fallbackVideos.length);
  if (fallbackVideos.length > 0) {
    console.log('Method 2 sample video:', fallbackVideos[0]);
  }
}

run();
