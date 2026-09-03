import fs from 'node:fs';

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

async function run() {
  const url = 'https://www.youtube.com/playlist?list=PLvTTv60o7qj_tdY9zH7YcEEStjfiXzKAz';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await res.text();
  console.log('HTML length:', html.length);

  const marker = 'ytInitialData';
  const pos = html.indexOf(marker);
  console.log('Marker pos:', pos);

  if (pos !== -1) {
    const jsonStr = extractJsonObject(html, pos);
    console.log('Extracted jsonStr length:', jsonStr ? jsonStr.length : 'null');
    if (jsonStr) {
      try {
        const data = JSON.parse(jsonStr);
        console.log('JSON parse SUCCESS!');
        
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
        console.log('Videos found in ytInitialData:', videos.length);
      } catch (e) {
        console.log('JSON parse fail:', e.message);
      }
    }
  }
}

run();
