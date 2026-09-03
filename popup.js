(function () {
  let data = null;
  let activeTab = "progress";
  const uiCollapsed = {}; // subjectId/playlistId -> bool, session-only

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function sendMessage(msg) {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
      return Promise.resolve({ ok: true, data: { domain: null, subjects: [], history: [] } });
    }
    return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
  }

  async function loadData() {
    const res = await sendMessage({ type: "GET_DATA" });
    data = res.data;
    render();
  }

  let saveTimer = null;
  function persist() {
    render();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => sendMessage({ type: "SET_DATA", data }), 150);
  }

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  // ---------- derived stats ----------
  function subjectStats(subject) {
    let total = 0, watched = 0;
    subject.playlists.forEach(pl => {
      total += pl.videos.length;
      watched += pl.videos.filter(v => v.watched).length;
    });
    return { total, watched, pct: total ? Math.round((watched / total) * 100) : 0 };
  }
  function playlistStats(pl) {
    const total = pl.videos.length;
    const watched = pl.videos.filter(v => v.watched).length;
    return { total, watched, pct: total ? Math.round((watched / total) * 100) : 0 };
  }
  function overallStats() {
    let total = 0, watched = 0;
    data.subjects.forEach(s => {
      const st = subjectStats(s);
      total += st.total;
      watched += st.watched;
    });
    return { total, watched, pct: total ? Math.round((watched / total) * 100) : 0 };
  }

  // ---------- mutations ----------
  function setDomain(domainKey) {
    const syllabus = GATE_SYLLABI[domainKey];
    data.domain = domainKey;
    const existingNames = new Set(data.subjects.map(s => s.name));
    syllabus.subjects.forEach(name => {
      if (!existingNames.has(name)) {
        data.subjects.push({ id: uid(), name, playlists: [] });
      }
    });
    persist();
  }

  function addSubject(name) {
    if (!name.trim()) return;
    data.subjects.push({ id: uid(), name: name.trim(), playlists: [] });
    persist();
  }
  function removeSubject(id) {
    data.subjects = data.subjects.filter(s => s.id !== id);
    persist();
  }
  function removePlaylist(subjectId, plId) {
    const s = data.subjects.find(x => x.id === subjectId);
    s.playlists = s.playlists.filter(p => p.id !== plId);
    persist();
  }
  function toggleVideoManual(subjectId, plId, vId) {
    const s = data.subjects.find(x => x.id === subjectId);
    const pl = s.playlists.find(p => p.id === plId);
    const v = pl.videos.find(v => v.id === vId);
    v.watched = !v.watched;
    v.watchedAt = v.watched ? Date.now() : null;
    persist();
  }

  async function addPlaylist(subjectId, url, statusEl) {
    if (!url.trim()) return;
    statusEl.textContent = "Reading playlist…";
    statusEl.className = "status-msg";
    const res = await sendMessage({ type: "FETCH_PLAYLIST", url: url.trim() });
    if (!res.ok) {
      statusEl.textContent = res.error;
      statusEl.className = "status-msg error";
      return;
    }
    const s = data.subjects.find(x => x.id === subjectId);
    s.playlists.push({
      id: uid(),
      name: `Playlist (${res.videos.length} videos)`,
      url: url.trim(),
      videos: res.videos.map(v => ({ id: v.id, title: v.title, watched: false, watchedAt: null }))
    });
    persist();
  }

  async function resetAll() {
    if (!confirm("Clear all subjects, playlists and history? This cannot be undone.")) return;
    data = { domain: null, subjects: [], history: [] };
    persist();
  }

  // ---------- render ----------
  function render() {
    const app = document.getElementById("app");
    if (!data.domain && data.subjects.length === 0) {
      app.innerHTML = renderDomainPicker();
      bindDomainPicker();
      return;
    }

    const ov = overallStats();
    const domainLabel = data.domain ? GATE_SYLLABI[data.domain].label : "Custom setup";

    app.innerHTML = `
      <div class="header">
        <div>
          <h1>GATE Tracker</h1>
          <div class="domain-label">${esc(domainLabel)} <button class="footer-link" id="changeDomainBtn" style="display:inline;margin:0;">change</button></div>
        </div>
        <div class="ring-wrap">
          <div class="ring" style="--pct:${ov.pct}"><span class="ring-pct">${ov.pct}%</span></div>
        </div>
      </div>
      <div class="tabs">
        <button class="tab-btn ${activeTab === 'progress' ? 'active' : ''}" data-tab="progress">Progress</button>
        <button class="tab-btn ${activeTab === 'history' ? 'active' : ''}" data-tab="history">History</button>
      </div>
      <div id="tabContent"></div>
    `;

    document.getElementById("changeDomainBtn").addEventListener("click", () => {
      app.innerHTML = renderDomainPicker(true);
      bindDomainPicker();
    });
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        render();
      });
    });

    const tabContent = document.getElementById("tabContent");
    if (activeTab === "progress") {
      tabContent.innerHTML = renderProgress();
      bindProgress();
    } else {
      tabContent.innerHTML = renderHistory();
    }
  }

  function renderDomainPicker(isChange) {
    const options = Object.keys(GATE_SYLLABI).map(key => {
      const d = GATE_SYLLABI[key];
      return `
        <div class="domain-option" data-domain="${key}">
          <span class="name">${esc(d.label)}</span>
          <span class="count mono">${d.subjects.length ? d.subjects.length + " subjects" : "start blank"}</span>
        </div>
      `;
    }).join("");
    return `
      <h1 style="font-size:18px;margin:0 0 10px;">GATE Tracker</h1>
      <div class="domain-picker">
        <p>${isChange ? "Add subjects from another domain — your existing ones stay put." : "Which GATE domain are you preparing for? Subjects load in automatically."}</p>
        <div class="domain-grid">${options}</div>
      </div>
      ${isChange ? '<button class="footer-link" id="cancelChange">cancel</button>' : ''}
    `;
  }

  function bindDomainPicker() {
    document.querySelectorAll(".domain-option").forEach(el => {
      el.addEventListener("click", () => setDomain(el.dataset.domain));
    });
    const cancel = document.getElementById("cancelChange");
    if (cancel) cancel.addEventListener("click", render);
  }

  function renderProgress() {
    const subjectsHtml = data.subjects.map(s => renderSubject(s)).join("");
    return `
      ${subjectsHtml || '<p class="empty-note">No subjects yet.</p>'}
      <form class="add-subject-row" id="addSubjectForm">
        <input type="text" id="newSubjectInput" placeholder="Add a subject" autocomplete="off">
        <button type="submit" class="primary">Add</button>
      </form>
      <button class="footer-link" id="resetBtn">Clear all data</button>
    `;
  }

  function renderSubject(s) {
    const st = subjectStats(s);
    const collapsed = uiCollapsed[s.id];
    const barClass = st.total > 0 && st.watched === st.total ? "complete" : "";
    return `
      <div class="subject-block ${collapsed ? 'collapsed' : ''}">
        <div class="subject-head" data-toggle="subject" data-id="${s.id}">
          <div class="left">
            <span class="caret">▾</span>
            <span class="sname">${esc(s.name)}</span>
          </div>
          <div class="sright">
            <span class="sfrac">${st.watched}/${st.total}</span>
            <div class="mini-bar"><div class="${barClass}" style="width:${st.pct}%"></div></div>
            <button class="ghost" data-action="remove-subject" data-subject="${s.id}">✕</button>
          </div>
        </div>
        <div class="subject-body">
          ${s.playlists.map(pl => renderPlaylist(s.id, pl)).join('') || '<p class="empty-note">No playlists assigned yet.</p>'}
          <form class="add-playlist-row" data-action="add-playlist" data-subject="${s.id}">
            <input type="text" placeholder="Paste a YouTube playlist URL">
            <button type="submit">Fetch</button>
          </form>
          <div class="status-msg" data-status="${s.id}"></div>
        </div>
      </div>
    `;
  }

  function renderPlaylist(subjectId, pl) {
    const st = playlistStats(pl);
    return `
      <div class="playlist-item">
        <div class="playlist-item-head">
          <span class="pname">${esc(pl.name)}</span>
          <span class="pfrac">${st.watched}/${st.total}</span>
          <button class="ghost" data-action="remove-playlist" data-subject="${subjectId}" data-playlist="${pl.id}">✕</button>
        </div>
        ${pl.videos.map(v => `
          <div class="video-row ${v.watched ? 'watched' : ''}">
            <input type="checkbox" ${v.watched ? 'checked' : ''} data-action="toggle-video" data-subject="${subjectId}" data-playlist="${pl.id}" data-video="${v.id}">
            <span class="vtitle" title="${esc(v.title)}">${esc(v.title)}</span>
            <span class="vtime">${v.watched ? fmtTime(v.watchedAt) : ''}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderHistory() {
    if (!data.history.length) {
      return '<p class="empty-note">Nothing tracked yet. Watch a video on YouTube from an assigned playlist and it\'ll show up here once it finishes.</p>';
    }
    const rows = data.history.map(h => `
      <li class="history-row ${h.matched ? '' : 'unmatched'}">
        <span class="htitle">${esc(h.title)}</span>
        <span class="hmeta">
          <span>${fmtTime(h.watchedAt)}</span>
          <span>${h.matched ? esc(h.subjectName) : 'not in a tracked playlist'}</span>
        </span>
      </li>
    `).join('');
    return `<ul class="history-list">${rows}</ul>`;
  }

  function bindProgress() {
    document.querySelectorAll('[data-toggle="subject"]').forEach(el => {
      el.addEventListener("click", () => {
        const id = el.dataset.id;
        uiCollapsed[id] = !uiCollapsed[id];
        render();
      });
    });
    document.querySelectorAll('[data-action="remove-subject"]').forEach(el => {
      el.addEventListener("click", e => { e.stopPropagation(); removeSubject(el.dataset.subject); });
    });
    document.querySelectorAll('[data-action="remove-playlist"]').forEach(el => {
      el.addEventListener("click", e => { e.stopPropagation(); removePlaylist(el.dataset.subject, el.dataset.playlist); });
    });
    document.querySelectorAll('[data-action="toggle-video"]').forEach(el => {
      el.addEventListener("click", e => e.stopPropagation());
      el.addEventListener("change", () => toggleVideoManual(el.dataset.subject, el.dataset.playlist, el.dataset.video));
    });
    document.querySelectorAll('[data-action="add-playlist"]').forEach(form => {
      form.addEventListener("click", e => e.stopPropagation());
      form.addEventListener("submit", e => {
        e.preventDefault();
        const input = form.querySelector("input");
        const statusEl = document.querySelector(`[data-status="${form.dataset.subject}"]`);
        addPlaylist(form.dataset.subject, input.value, statusEl);
      });
    });
    const addSubjectForm = document.getElementById("addSubjectForm");
    if (addSubjectForm) {
      addSubjectForm.addEventListener("submit", e => {
        e.preventDefault();
        const input = document.getElementById("newSubjectInput");
        addSubject(input.value);
      });
    }
    const resetBtn = document.getElementById("resetBtn");
    if (resetBtn) resetBtn.addEventListener("click", resetAll);
  }

  loadData();
})();