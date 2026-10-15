// GENERATED FILE - do not edit.
// Source: public/index.html. Regenerate with: npm run build:ui
export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Jarvis</title>
  <style>
    :root { --bg:#0b0d12; --panel:#151922; --text:#e8ecf3; --muted:#8a94a7; --accent:#4cc9f0; --danger:#ef476f; --ok:#06d6a0; }
    @media (prefers-color-scheme: light) {
      :root { --bg:#f5f7fb; --panel:#ffffff; --text:#14181f; --muted:#5b6578; --accent:#0a7ea4; --danger:#c1123c; --ok:#04845f; }
    }
    :root[data-theme="dark"] { --bg:#0b0d12; --panel:#151922; --text:#e8ecf3; --muted:#8a94a7; --accent:#4cc9f0; --danger:#ef476f; --ok:#06d6a0; }
    body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, sans-serif; }
    main { max-width: 720px; margin: 0 auto; padding: 16px; }
    h1 { font-size: 20px; margin: 8px 0 16px; }
    .panel { background: var(--panel); border-radius: 14px; padding: 16px; margin-bottom: 16px; }
    #log { min-height: 200px; max-height: 50vh; overflow-y: auto; white-space: pre-wrap; }
    .msg { margin: 8px 0; }
    .you { color: var(--accent); }
    .muted { color: var(--muted); font-size: 14px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    select { padding: 10px; border-radius: 10px; border: 1px solid var(--muted); background: var(--panel); color: var(--text); font: inherit; min-height: 44px; flex: 1; min-width: 160px; }
    input[type=text], input[type=password] { flex: 1; min-width: 160px; padding: 10px; border-radius: 10px; border: 1px solid var(--muted); background: transparent; color: var(--text); font: inherit; }
    button { padding: 10px 14px; border-radius: 10px; border: 0; background: var(--accent); color: #000; font: inherit; font-weight: 600; cursor: pointer; min-height: 44px; }
    button.secondary { background: transparent; color: var(--text); border: 1px solid var(--muted); }
    button.danger { background: var(--danger); color: #fff; }
    button.mic.on { background: var(--danger); color: #fff; }
    button:disabled { opacity: .5; cursor: default; }
    .approval { border-top: 1px solid var(--muted); padding: 10px 0; }
    .approval:first-child { border-top: 0; }
  </style>
</head>
<body>
<main>
  <h1>Jarvis</h1>

  <section class="panel" id="authPanel">
    <div class="row">
      <input type="password" id="token" placeholder="Access token" autocomplete="current-password">
      <button id="saveToken">Unlock</button>
    </div>
    <p class="muted">Token is stored in this browser only. Ask the owner for it if you don't have it.</p>
  </section>

  <section class="panel" id="businessPanel" hidden>
    <div class="row">
      <select id="business" aria-label="Business">
        <option value="">My own accounts</option>
      </select>
      <button id="briefBtn">Brief me</button>
      <button class="secondary" id="syncBtn">Sync now</button>
    </div>
    <div class="row" style="margin-top:8px">
      <input type="text" id="newBusiness" placeholder="Add a business by name" aria-label="New business name">
      <button class="secondary" id="addBusiness">Add</button>
    </div>
  </section>

  <section class="panel" id="appPanel" hidden>
    <div id="log" aria-live="polite"></div>
    <div class="row" style="margin-top:12px">
      <button class="mic" id="mic" aria-label="Talk">Talk</button>
      <input type="text" id="input" placeholder='Try "brief acme" or "pending"' aria-label="Message">
      <button id="send">Send</button>
      <button class="secondary" id="speakToggle" aria-pressed="true">Voice reply: on</button>
    </div>
    <p class="muted" id="voiceStatus"></p>
  </section>

  <section class="panel" id="approvalsPanel" hidden>
    <div class="row" style="justify-content:space-between">
      <strong>Waiting for your approval</strong>
      <button class="secondary" id="refreshApprovals">Refresh</button>
    </div>
    <div id="approvals"></div>
  </section>

  <section class="panel" id="statusPanel" hidden>
    <strong>Connections</strong>
    <div id="status" class="muted"></div>
  </section>
</main>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const storageKey = "jarvis.token";
  let token = null;
  try { token = localStorage.getItem(storageKey); } catch (_) {}

  const api = async (path, options = {}) => {
    const res = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(options.headers || {}) },
    });
    if (res.status === 401) { lock(); throw new Error("Token rejected"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  function lock() {
    token = null;
    try { localStorage.removeItem(storageKey); } catch (_) {}
    $("authPanel").hidden = false;
    $("businessPanel").hidden = true;
    $("appPanel").hidden = true;
    $("approvalsPanel").hidden = true;
    $("statusPanel").hidden = true;
  }

  function unlock() {
    $("authPanel").hidden = true;
    $("businessPanel").hidden = false;
    $("appPanel").hidden = false;
    $("approvalsPanel").hidden = false;
    $("statusPanel").hidden = false;
    loadStatus();
    loadBusinesses();
    loadApprovals();
    addLine("jarvis", "Ready. Say or type \\u201chelp\\u201d to see what works without any AI cost.");
  }

  // Tag replies that cost nothing, so AI spend stays visible.
  function markFree() {
    const last = $("log").lastElementChild;
    if (!last) return;
    const tag = document.createElement("span");
    tag.className = "muted";
    tag.textContent = "  (no AI used)";
    last.appendChild(tag);
  }

  function addLine(who, text) {
    const div = document.createElement("div");
    div.className = "msg " + (who === "you" ? "you" : "");
    div.textContent = (who === "you" ? "You: " : "Jarvis: ") + text;
    $("log").appendChild(div);
    $("log").scrollTop = $("log").scrollHeight;
  }

  // ----- Voice output -----
  let speakOn = true;
  $("speakToggle").onclick = () => {
    speakOn = !speakOn;
    $("speakToggle").textContent = "Voice reply: " + (speakOn ? "on" : "off");
    $("speakToggle").setAttribute("aria-pressed", String(speakOn));
    if (!speakOn) {
      speechSynthesis?.cancel();
      if (audio) audio.pause();
    }
  };
  let voiceProvider = "browser";
  let audio = null;

  // The free browser voice. Always available, used as the fallback.
  function speakWithBrowser(text) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  // The real voice, generated server-side so the key never reaches this page.
  // Any failure falls back rather than leaving the user in silence.
  async function speakWithProvider(text) {
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("speak failed");
      const blob = await res.blob();
      if (audio) { audio.pause(); URL.revokeObjectURL(audio.src); }
      audio = new Audio(URL.createObjectURL(blob));
      audio.onended = () => { URL.revokeObjectURL(audio.src); };
      await audio.play();
    } catch (_) {
      speakWithBrowser(text);
    }
  }

  function speak(text) {
    if (!speakOn || !text) return;
    if (voiceProvider === "elevenlabs") { speakWithProvider(text); return; }
    speakWithBrowser(text);
  }

  // ----- Voice input -----
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  if (Rec) {
    recognition = new Rec();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (e) => { $("input").value = e.results[0][0].transcript; send(); };
    recognition.onend = () => { $("mic").classList.remove("on"); $("mic").textContent = "Talk"; };
    recognition.onerror = (e) => { $("voiceStatus").textContent = "Voice error: " + e.error; };
  } else {
    $("mic").disabled = true;
    $("voiceStatus").textContent = "Voice input needs Chrome, Edge, or Safari. You can still type.";
  }
  $("mic").onclick = () => {
    if (!recognition) return;
    if ($("mic").classList.contains("on")) { recognition.stop(); return; }
    $("mic").classList.add("on");
    $("mic").textContent = "Listening…";
    $("voiceStatus").textContent = "";
    recognition.start();
  };

  // ----- Chat -----
  async function send() {
    const message = $("input").value.trim();
    if (!message) return;
    $("input").value = "";
    $("send").disabled = true;
    addLine("you", message);
    try {
      const { text, usedAI } = await api("/api/chat", { method: "POST", body: JSON.stringify({ message }) });
      addLine("jarvis", text);
      if (usedAI === false) markFree();
      speak(text);
      loadApprovals();
    } catch (err) {
      addLine("jarvis", "Error: " + err.message);
    } finally {
      $("send").disabled = false;
    }
  }
  $("send").onclick = send;
  $("input").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  // ----- Approvals -----
  async function loadApprovals() {
    try {
      const { items } = await api("/api/approvals?status=pending");
      const box = $("approvals");
      box.textContent = "";
      if (!items.length) { box.textContent = "Nothing waiting."; return; }
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "approval";
        const label = document.createElement("div");
        label.textContent = item.summary;
        const btns = document.createElement("div");
        btns.className = "row";
        btns.style.marginTop = "8px";
        const ok = Object.assign(document.createElement("button"), { textContent: "Approve" });
        const no = Object.assign(document.createElement("button"), { textContent: "Reject", className: "secondary" });
        ok.onclick = () => decide(item.id, "approve");
        no.onclick = () => decide(item.id, "reject");
        btns.append(ok, no);
        row.append(label, btns);
        box.append(row);
      }
    } catch (err) {
      $("approvals").textContent = "Could not load approvals: " + err.message;
    }
  }
  async function decide(id, decision) {
    try {
      const { item } = await api(\`/api/approvals/\${id}/\${decision}\`, { method: "POST" });
      addLine("jarvis", \`\${decision === "approve" ? "Approved" : "Rejected"}: \${item.status}\${item.error ? " (" + item.error + ")" : ""}\`);
    } catch (err) {
      addLine("jarvis", "Error: " + err.message);
    }
    loadApprovals();
  }
  $("refreshApprovals").onclick = loadApprovals;

  async function loadStatus() {
    try {
      const { connectors, voice } = await api("/api/status");
      voiceProvider = voice?.provider ?? "browser";
      const lines = Object.entries(connectors)
        .map(([name, on]) => \`\${name}: \${on ? "connected" : "mock mode"}\`);
      lines.push(\`voice: \${voiceProvider === "elevenlabs" ? "ElevenLabs" : "browser (free)"}\`);
      $("status").textContent = lines.join(" · ");
    } catch (_) {}
  }

  // ----- Businesses, briefs, sync -----
  async function loadBusinesses() {
    try {
      const { businesses } = await api("/api/businesses");
      const select = $("business");
      const chosen = select.value;
      select.textContent = "";
      select.append(Object.assign(document.createElement("option"), { value: "", textContent: "My own accounts" }));
      for (const b of businesses) {
        select.append(Object.assign(document.createElement("option"), { value: b.name, textContent: b.name }));
      }
      if (chosen) select.value = chosen;
    } catch (err) {
      addLine("jarvis", "Could not load businesses: " + err.message);
    }
  }

  $("addBusiness").onclick = async () => {
    const name = $("newBusiness").value.trim();
    if (!name) return;
    try {
      await api("/api/businesses", { method: "POST", body: JSON.stringify({ name }) });
      $("newBusiness").value = "";
      await loadBusinesses();
      $("business").value = name;
      addLine("jarvis", "Added " + name + ".");
    } catch (err) {
      addLine("jarvis", "Error: " + err.message);
    }
  };

  $("briefBtn").onclick = async () => {
    const name = $("business").value;
    if (!name) { addLine("jarvis", "Pick a business first, or just ask me in chat."); return; }
    $("briefBtn").disabled = true;
    try {
      const brief = await api("/api/brief?business=" + encodeURIComponent(name) + "&hours=24");
      addLine("jarvis", brief.spoken);
      speak(brief.spoken);
      loadApprovals();
    } catch (err) {
      addLine("jarvis", "Error: " + err.message);
    } finally {
      $("briefBtn").disabled = false;
    }
  };

  $("syncBtn").onclick = async () => {
    $("syncBtn").disabled = true;
    addLine("jarvis", "Syncing…");
    try {
      const out = await api("/api/sync", { method: "POST" });
      const recorded = out.reports.reduce((n, r) => n + r.recorded, 0);
      const notConnected = [...new Set(out.reports.flatMap((r) => r.notConnected))];
      let msg = "Synced " + out.businesses + " business(es). " + recorded + " new event(s).";
      if (notConnected.length) msg += " Not connected yet: " + notConnected.join(", ") + ".";
      addLine("jarvis", msg);
    } catch (err) {
      addLine("jarvis", "Error: " + err.message);
    } finally {
      $("syncBtn").disabled = false;
    }
  };

  // ----- Unlock -----
  $("saveToken").onclick = () => {
    token = $("token").value.trim();
    if (!token) return;
    try { localStorage.setItem(storageKey, token); } catch (_) {}
    api("/api/status")
      .then(() => unlock())
      .catch(() => { token = null; $("authPanel").querySelector(".muted").textContent = "That token was not accepted."; });
  };

  if (token) { unlock(); } else { lock(); }
})();
</script>
</body>
</html>
`;
