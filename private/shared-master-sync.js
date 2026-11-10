(function () {
  if (window.__IMDS_SHARED_MASTER_INIT__) return;
  window.__IMDS_SHARED_MASTER_INIT__ = true;
  var busy = false;
  var timer = null;

  function toLocalDate(value) {
    if (!value) return null;
    var s = String(value).slice(0, 10);
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function buildSharedDataset(rows) {
    var raw = [];
    var groups = new Map();
    var today = todayStart();
    var issues = {
      unparsableDates: 0, badDateSamples: [], reviewStatuses: new Map(),
      blankPartRows: 0, unassignedRows: 0, modelMerges: new Map(),
      missingColumns: [], emptyRows: 0
    };

    (rows || []).forEach(function (source, index) {
      var company = clean(source.company_name) || "(Unknown Supplier)";
      var partNo = clean(source.part_no);
      var modelRaw = clean(source.project);
      var model = normModelKey(modelRaw);
      var name = clean(source.part_name);
      var statusRaw = clean(source.imds_status);
      var status = classify(statusRaw);
      var target = toLocalDate(source.submission_plan);

      if (!partNo) issues.blankPartRows++;
      if (model === UNASSIGNED) issues.unassignedRows++;
      if (status === "review") issues.reviewStatuses.set(statusRaw, (issues.reviewStatuses.get(statusRaw) || 0) + 1);

      var record = {
        model: model,
        project: model,
        modelRaw: modelRaw,
        company: company,
        masterId: clean(source.id),
        supplierPromiseDate: clean(source.supplier_promise_date),
        vendorCode: clean(source.vendor_code),
        email: clean(source.main_pic_email),
        partNo: partNo,
        partName: name,
        targetDate: target,
        statusRaw: statusRaw,
        status: status,
        mdSystemStatus: clean(source.status_update),
        mdSystemIdVersion: clean(source.md_id_version),
        mdSystemLastChanged: clean(source.md_status_update_date),
        mdSystemComment: clean(source.comment),
        mdSystemRecords: Array.isArray(source.md_system_records) ? source.md_system_records : [],
        lastMasterUpdated: clean(source.updated_at),
        pastDue: !!(target && status !== "complete" && target < today),
        srcRow: Number(source.source_row || (index + 1))
      };
      raw.push(record);

      var key = partNo ? company + "|" + model + "|" + partNo.toUpperCase() : "#row" + raw.length;
      if (!groups.has(key)) {
        groups.set(key, Object.assign({}, record, { sourceCount: 1, sourceRows: [record] }));
      } else {
        var grouped = groups.get(key);
        grouped.sourceCount++;
        grouped.sourceRows.push(record);
        grouped.status = mergeStatus(grouped.status, status);
        if (target && (!grouped.targetDate || target < grouped.targetDate)) grouped.targetDate = target;
        grouped.pastDue = !!(grouped.targetDate && grouped.status !== "complete" && grouped.targetDate < today);
        if (!grouped.partName && name) grouped.partName = name;
      }
    });

    var records = Array.from(groups.values());
    var openModels = new Set(records.filter(function (r) { return r.status === "missing"; }).map(function (r) { return r.model; }));
    records.forEach(function (r, index) {
      r.id = index;
      if (!openModels.has(r.model)) r.pastDue = false;
    });

    var duplicates = records.filter(function (r) { return r.sourceCount > 1; });
    var validation = {
      raw: raw.length,
      total: records.length,
      duplicateRows: raw.length - records.length,
      duplicateGroups: duplicates.length,
      suppliers: new Set(records.map(function (r) { return r.company; })).size,
      projects: new Set(records.map(function (r) { return r.model; })).size
    };

    return { records: records, rawRecords: raw, duplicates: duplicates, validation: validation, issues: issues };
  }

  function sharedContacts(list) {
    var result = new Map();
    (list || []).forEach(function (contact) {
      var company = clean(contact.company);
      if (!company) return;
      result.set(company.toUpperCase(), {
        company: company,
        pic: clean(contact.pic),
        cc: clean(contact.cc),
        spv: clean(contact.spv),
        note: clean(contact.note)
      });
    });
    return result;
  }

  // ---- Loading status + instant start from the last copy kept on this device ----
  var CACHE_DB = "imds-tracker-cache", CACHE_KEY = "shared-master";
  function cacheOpen() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(CACHE_DB, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("kv"); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function cacheGet() {
    return cacheOpen().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try { var r = db.transaction("kv").objectStore("kv").get(CACHE_KEY); r.onsuccess = function () { resolve(r.result || null); }; r.onerror = function () { resolve(null); }; } catch (e) { resolve(null); }
      });
    });
  }
  function cachePut(value) {
    return cacheOpen().then(function (db) { if (!db) return; try { db.transaction("kv", "readwrite").objectStore("kv").put(value, CACHE_KEY); } catch (e) { /* cache is optional */ } });
  }
  var loadEl = null, barEl = null;
  function loadStatus(kind, text, retry) {
    if (!loadEl) {
      var st = document.createElement("style");
      st.textContent = "#imds-bar{position:fixed;left:0;right:0;top:0;height:3px;z-index:9999;overflow:hidden;opacity:0;transition:opacity .25s;pointer-events:none}#imds-bar.on{opacity:1}" +
        "#imds-bar::before{content:'';position:absolute;inset:0;width:40%;background:linear-gradient(90deg,#c4b5fd,#6d28d9);animation:imdsbar 1.1s ease-in-out infinite}@keyframes imdsbar{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}" +
        "#imds-load{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9998;display:flex;align-items:center;gap:10px;padding:7px 14px;border-radius:999px;background:#fff;color:#1f2933;font:600 12px system-ui,sans-serif;box-shadow:0 6px 24px rgba(40,20,80,.16);border:1px solid #e8e1f1;transition:opacity .4s}" +
        "#imds-load.ok{border-color:#91c8a9}#imds-load.err{border-color:#e7a4ad;color:#b91c1c}#imds-load.fade{opacity:0;pointer-events:none}" +
        "#imds-load button{border:1px solid #ddd;background:#fff;border-radius:8px;padding:2px 10px;cursor:pointer;font:inherit}";
      document.head.appendChild(st);
      barEl = document.createElement("div"); barEl.id = "imds-bar"; barEl.setAttribute("aria-hidden", "true"); document.body.appendChild(barEl);
      loadEl = document.createElement("div"); loadEl.id = "imds-load"; loadEl.setAttribute("role", "status"); loadEl.setAttribute("aria-live", "polite");
      document.body.appendChild(loadEl);
    }
    barEl.classList.toggle("on", kind === "busy");
    loadEl.className = kind === "ok" ? "ok" : kind === "err" ? "err" : "";
    loadEl.innerHTML = "<span></span>" + (retry ? '<button type="button">Retry</button>' : "");
    loadEl.querySelector("span").textContent = text;
    if (retry) loadEl.querySelector("button").onclick = retry;
    if (kind === "ok") window.setTimeout(function () { if (loadEl) loadEl.classList.add("fade"); }, 2000);
  }

  var lastEtag = null, hasData = false;
  function applyPayload(payload) {
    var dataset = buildSharedDataset(payload.rows);
    if (!dataset.records.length) return null;
    var contacts = sharedContacts(payload.contacts);
    dataset.rawRecords.forEach(function (record) {
      if (!contacts.has(record.company.toUpperCase())) {
        contacts.set(record.company.toUpperCase(), { company: record.company, pic: record.email || "", cc: "", spv: "", note: "" });
      }
    });
    commitDataset(dataset, contacts);
    SRC.fileName = "Shared IMDS Master";
    SRC.sheetName = "Part List LATEST";
    SRC.fileHandle = null;
    SRC.lastFile = null;
    SRC.lastSync = new Date();
    SRC.graphConnected = false;
    afterLoad();
    if (typeof setConnectionState === "function") setConnectionState("CONNECTED");
    if (typeof setSourceStatus === "function") setSourceStatus("Shared master live · " + dataset.validation.total.toLocaleString() + " unique parts · " + new Date().toLocaleTimeString(), "ok");
    window.__IMDS_SHARED_MASTER_READY__ = true;
    window.__IMDS_SHARED_MASTER_LAST_SYNC__ = new Date().toISOString();
    hasData = true;
    return dataset;
  }

  async function refreshSharedMaster(silent) {
    if (busy) return;
    busy = true;
    var shown = !silent || !hasData;
    if (!silent && !hasData) loadStatus("busy", "Loading from database…");
    else if (!silent) loadStatus("busy", "Checking for updates…");
    try {
      var headers = { "Accept": "application/json" };
      if (lastEtag && hasData) headers["If-None-Match"] = lastEtag;
      var response = await fetch("/api/imds-master/tracker-data", { method: "GET", cache: "no-store", credentials: "same-origin", headers: headers });
      if (response.status === 304) {
        if (!silent) loadStatus("ok", "Up to date · " + new Date().toLocaleTimeString());
        return "same";
      }
      var raw = await response.text(), payload;
      try { payload = JSON.parse(raw); } catch (e) { throw new Error("The server returned an unexpected response (HTTP " + response.status + ")."); }
      if (!response.ok) throw new Error(payload && payload.error ? payload.error : "Shared master could not be loaded.");
      if (!Array.isArray(payload.rows)) throw new Error("Shared master response is invalid.");
      if (!payload.rows.length) {
        if (typeof setConnectionState === "function") setConnectionState("NOT_CONNECTED");
        if (shown) loadStatus("err", "The shared master is empty. Upload the IMDS Remaining master in Settings.");
        return "empty";
      }
      var dataset = applyPayload(payload);
      lastEtag = response.headers.get("ETag") || null;
      if (lastEtag) cachePut({ etag: lastEtag, payload: payload, savedAt: Date.now() });
      if (dataset && (shown || !silent)) loadStatus("ok", "Live · " + dataset.validation.total.toLocaleString() + " parts");
      return "ok";
    } catch (error) {
      console.error("IMDS Tracker shared-master refresh failed.", error);
      var message = error && error.message ? error.message : "Shared master refresh failed.";
      if (!silent || !hasData) loadStatus("err", hasData ? "Could not refresh: " + message : message, function () { refreshSharedMaster(false); });
      if (!window.__IMDS_SHARED_MASTER_READY__ && typeof setConnectionState === "function") setConnectionState("SOURCE_ERROR");
      return "error";
    } finally {
      busy = false;
    }
  }

  // Show the last copy instantly, then verify against the database in the background.
  async function startFast() {
    loadStatus("busy", "Loading from database…");
    try {
      var cached = await cacheGet();
      if (cached && cached.payload && Array.isArray(cached.payload.rows) && cached.payload.rows.length) {
        applyPayload(cached.payload);
        lastEtag = cached.etag || null;
        loadStatus("busy", "Showing saved data · checking for updates…");
      }
    } catch (e) { /* fall through to the network */ }
    var result = await refreshSharedMaster(hasData);
    if (result === "same") loadStatus("ok", "Live · up to date");
    else if (result === "error" && hasData) loadStatus("err", "Could not reach the database; showing the last saved data.", function () { refreshSharedMaster(false); });
  }

  // ---- Tracker-native panels: Settings → shared master import; Follow-up → sequential supplier e-mail ----
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function api(url, opts) {
    return fetch(url, Object.assign({ credentials: "same-origin", cache: "no-store" }, opts || {})).then(function (r) {
      return r.text().then(function (raw) {
        var j; try { j = JSON.parse(raw); } catch (e) { throw new Error(r.status === 504 ? "The server ran past its time limit. Try again, or split the workbook." : "The server returned an unexpected response (HTTP " + r.status + ")."); }
        if (!r.ok) { var err = new Error(j && j.error ? j.error : "Request failed (HTTP " + r.status + ")."); err.payload = j; throw err; }
        return j;
      });
    });
  }
  function fmtWhen(v) { if (!v) return ""; var d = new Date(v); return isNaN(d.getTime()) ? "" : d.toLocaleString(); }

  function initSharedPanels() {
    if (document.getElementById("shared-import-panel")) return;
    var settings = document.getElementById("view-settings");
    var follow = document.getElementById("view-followup");
    if (!settings || !follow) return;

    // ---------- Settings: the two uploads, remembered on the server ----------
    var panel = document.createElement("section");
    panel.className = "panel"; panel.id = "shared-import-panel";
    panel.innerHTML = '<div class="panel-head"><div><h2>Shared master data</h2><p class="panel-sub">Upload once. The data is saved on the server and reloaded automatically every time you open the Tracker; there is nothing to reconnect.</p></div></div>' +
      '<div id="sm-state" class="banner" role="status"></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin:12px 0">' +
      '<label class="dropzone" data-kind="master" style="cursor:pointer"><input type="file" accept=".xlsx" hidden><span class="dz-ic" aria-hidden="true">📄</span><div><b>① IMDS Remaining master</b><br><span class="muted">Workbook with <b>Part List LATEST</b>. New rows are added; nothing is deleted; manual edits are kept.</span><br><span class="muted sm-last"></span></div></label>' +
      '<label class="dropzone" data-kind="mds" style="cursor:pointer"><input type="file" accept=".xlsx" hidden><span class="dz-ic" aria-hidden="true">🔎</span><div><b>② MD System search results</b><br><span class="muted">Re-upload whenever MD System is updated. Only the MD System fields change.</span><br><span class="muted sm-last"></span></div></label></div>' +
      '<div id="sm-msg" class="log hidden" aria-live="polite"></div>' +
      '<h3 style="margin:14px 0 6px;font-size:14px">MD System uploads (what period each file covers)</h3><div id="sm-log" class="muted small">No MD System upload yet.</div>' +
      '<div class="row-actions" style="align-items:center;gap:10px"><span class="muted" id="sm-sync">Excel sync: checking…</span><button type="button" class="btn btn-secondary btn-sm" id="sm-sync-now">Sync to Excel now</button><button type="button" class="btn btn-secondary btn-sm" id="sm-refresh">↻ Reload shared master</button><a class="btn btn-secondary btn-sm" href="/api/imds-master/export">Download Super Master XLSX</a></div>';
    var legacy = settings.querySelector('section.panel[aria-labelledby="h-source"]');
    var head = settings.querySelector("header.view-head");
    (head ? head.insertAdjacentElement("afterend", panel) : settings.prepend(panel));
    if (legacy) {
      legacy.hidden = true;
      var toggle = document.createElement("p");
      toggle.className = "muted small"; toggle.style.margin = "8px 0";
      toggle.innerHTML = '<button type="button" class="link-btn" id="sm-legacy">Advanced: read a local Excel file in this browser instead</button>';
      panel.insertAdjacentElement("afterend", toggle);
      toggle.querySelector("button").onclick = function () { legacy.hidden = !legacy.hidden; };
    }
    var msg = panel.querySelector("#sm-msg"), working = false;
    function say(kind, text) { msg.className = "log " + (kind === "err" ? "err" : ""); msg.textContent = text; msg.classList.remove("hidden"); }
    async function loadState() {
      try {
        var j = await api("/api/imds-master/parts?page=1&pageSize=1");
        var m = j.latestMasterImport, d = j.latestMdsImport, st = panel.querySelector("#sm-state");
        st.textContent = (j.total ? "Connected to the shared master · " + Number(j.total).toLocaleString() + " parts" : "Shared master is empty. Upload the IMDS Remaining master to begin.");
        var lasts = panel.querySelectorAll(".sm-last");
        lasts[0].textContent = m ? "Last: " + (m.file_name || "") + " · " + fmtWhen(m.created_at) + " · " + (m.inserted_rows || 0) + " new / " + (m.updated_rows || 0) + " refreshed" : "Nothing uploaded yet.";
        var logs = j.mdsImports || [], box = panel.querySelector("#sm-log");
        box.innerHTML = logs.length ? '<table class="tbl compact"><thead><tr><th scope="col">Uploaded</th><th scope="col">File</th><th scope="col">Data from</th><th scope="col">Data to</th><th scope="col" class="r">Rows</th><th scope="col" class="r">Matched</th><th scope="col" class="r">Unmatched</th></tr></thead><tbody>' + logs.map(function (b) { return "<tr><td>" + esc(fmtWhen(b.created_at)) + "</td><td>" + esc(b.file_name) + "</td><td>" + esc(b.periodFrom || "—") + "</td><td>" + esc(b.periodTo || "—") + '</td><td class="r">' + esc(b.total_rows) + '</td><td class="r">' + esc(b.matched) + '</td><td class="r">' + esc(b.unmatched) + "</td></tr>"; }).join("") + "</tbody></table>" : "No MD System upload yet.";
        lasts[1].textContent = d ? "Last: " + (d.file_name || "") + " · " + fmtWhen(d.created_at) : "Nothing uploaded yet.";
      } catch (e) { panel.querySelector("#sm-state").textContent = e.message; }
      try {
        var s = await api("/api/imds-master/sync");
        panel.querySelector("#sm-sync").textContent = (s.configured ? "Excel sync via Power Automate" : "Excel sync not configured (updates stay safely queued)") + " · " + s.queue.pending + " pending / " + s.queue.failed + " failed / " + s.queue.sent + " sent";
      } catch (e) { panel.querySelector("#sm-sync").textContent = "Excel sync: " + e.message; }
    }
    async function run(kind, file) {
      if (!file || working) return;
      if (!/\.xlsx$/i.test(file.name)) { say("err", "Please choose an .xlsx workbook."); return; }
      working = true;
      try {
        say("info", "Uploading " + file.name + "…");
        var slot = await api("/api/imds-master/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size }) });
        if (!slot.signedUrl) throw new Error("The upload could not start. Sign in again and retry.");
        var fd = new FormData(); fd.append("cacheControl", "3600"); fd.append("", file);
        var up = await fetch(slot.signedUrl, { method: "PUT", body: fd, headers: { "x-upsert": "false" } });
        if (!up.ok) throw new Error("Upload to storage failed (HTTP " + up.status + ").");
        say("info", "File uploaded. Importing rows — large workbooks can take up to a minute…");
        var j = await api(kind === "master" ? "/api/imds-master/import-master" : "/api/imds-master/import-md-system", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: slot.path, fileName: file.name }) });
        say("ok", kind === "master"
          ? "Master updated: " + (j.inserted || 0) + " new, " + (j.updated || 0) + " refreshed, " + (j.skipped || 0) + " skipped from " + (j.totalRows || 0) + " rows."
          : "MD System import: " + (j.matchedMasterRows || 0) + " rows matched; " + (j.ambiguousRows || 0) + " ambiguous; " + (j.unmatchedRows || 0) + " unmatched.");
        refreshSharedMaster(false); loadState();
      } catch (e) { say("err", e && e.message ? e.message : "Import failed."); }
      finally { working = false; }
    }
    Array.prototype.forEach.call(panel.querySelectorAll("label.dropzone"), function (lab) {
      var kind = lab.getAttribute("data-kind"), input = lab.querySelector("input");
      input.onchange = function () { run(kind, input.files && input.files[0]); input.value = ""; };
      lab.addEventListener("dragover", function (e) { e.preventDefault(); lab.classList.add("dragover"); });
      lab.addEventListener("dragleave", function () { lab.classList.remove("dragover"); });
      lab.addEventListener("drop", function (e) { e.preventDefault(); lab.classList.remove("dragover"); run(kind, e.dataTransfer.files && e.dataTransfer.files[0]); });
    });
    panel.querySelector("#sm-refresh").onclick = function () { refreshSharedMaster(false); loadState(); };
    panel.querySelector("#sm-sync-now").onclick = async function () {
      try { var r = await api("/api/imds-master/sync", { method: "POST" }); say(r.failed ? "err" : "ok", r.configured ? "Excel sync: " + r.sent + " sent, " + r.failed + " failed, " + r.pending + " pending." : "Excel sync is not configured yet. " + r.pending + " update batch(es) remain safely queued."); loadState(); }
      catch (e) { say("err", e.message); }
    };
    window.__imdsSmReload = loadState;
    loadState();

    initFollowupCenter(follow);
    initFollowupSettings(settings, panel);
  }

  // ---- Directory: saved on the server, so contacts follow the user to every browser ----
  var dirSync = { version: 0, timer: null, busy: false, again: false, applying: false, blocked: false };
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function dirPayload() { return { v: 1, entries: DIR.entries, buyers: DIR.buyers, aliases: DIR.aliases, meta: DIR.meta }; }
  function dirStatus(text, bad) {
    var tools = document.getElementById("dir-tools"), n = document.getElementById("dir-sync");
    if (!n && tools) { n = document.createElement("span"); n.id = "dir-sync"; n.className = "muted small"; n.setAttribute("role", "status"); n.style.alignSelf = "center"; tools.prepend(n); }
    if (n) { n.textContent = text; n.style.color = bad ? "#b91c1c" : ""; }
  }
  function schedulePush() {
    if (dirSync.blocked) return;
    window.clearTimeout(dirSync.timer);
    dirStatus("Unsaved changes…");
    dirSync.timer = window.setTimeout(function () { pushDirectory(false); }, 1500);
  }
  async function pushDirectory(retried) {
    if (dirSync.busy) { dirSync.again = true; return; }
    dirSync.busy = true; dirStatus("Saving to database…");
    try {
      var r = await api("/api/imds-master/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "directory", value: dirPayload(), baseVersion: dirSync.version }) });
      dirSync.version = r.version; lsSet("imds-dir-srv-version", String(r.version)); lsSet("imds-dir-dirty", "0");
      dirStatus("Directory saved in the database");
    } catch (e) {
      if (e.payload && e.payload.conflict && !retried) {
        try { var g = await api("/api/imds-master/settings?key=directory"); dirSync.version = g.version; } catch (e2) { /* reported below */ }
        dirSync.busy = false; return pushDirectory(true);
      }
      if (/role is required/i.test(String(e.message))) { dirSync.blocked = true; dirStatus("Read-only: your role cannot save contacts to the database.", true); }
      else dirStatus("Not saved to the database: " + e.message + " (kept in this browser)", true);
    } finally {
      dirSync.busy = false;
      if (dirSync.again) { dirSync.again = false; schedulePush(); }
    }
  }
  function applyDirectory(v) {
    dirSync.applying = true;
    try {
      DIR.entries = v.entries || {}; DIR.buyers = v.buyers || {}; DIR.aliases = v.aliases || {}; DIR.meta = v.meta || {};
      DIR.version++; DIRM = null; DIRIDX = null;
      store.set(DIR_KEY, JSON.stringify({ v: 1, entries: DIR.entries, buyers: DIR.buyers, aliases: DIR.aliases, meta: DIR.meta }));
    } finally { dirSync.applying = false; }
    try { renderAll(); } catch (e) { /* the view re-renders on next navigation */ }
  }
  async function initDirectorySync() {
    var baseSave = saveDir;
    saveDir = function () {
      var ok = baseSave.apply(this, arguments);
      if (!dirSync.applying) { lsSet("imds-dir-dirty", "1"); schedulePush(); }
      return ok;
    };
    var known = Number(lsGet("imds-dir-srv-version") || 0);
    try {
      var g = await api("/api/imds-master/settings?key=directory");
      var localCount = Object.keys(DIR.entries || {}).length, dirty = lsGet("imds-dir-dirty") === "1";
      if (!g.exists) { dirSync.version = 0; if (localCount) await pushDirectory(false); else dirStatus("Directory is empty. Import contacts once and they are remembered."); return; }
      dirSync.version = g.version;
      var server = g.value || {};
      if (localCount && (dirty || !known)) {
        // This browser has contacts the server may not: add what is missing, never overwrite the server's entries.
        var added = 0;
        server.entries = server.entries || {}; server.buyers = server.buyers || {};
        Object.keys(DIR.entries).forEach(function (k) { if (!server.entries[k]) { server.entries[k] = DIR.entries[k]; added++; } });
        Object.keys(DIR.buyers || {}).forEach(function (k) { if (!server.buyers[k]) server.buyers[k] = DIR.buyers[k]; });
        server.aliases = Object.assign({}, DIR.aliases || {}, server.aliases || {}); server.meta = Object.assign({}, DIR.meta || {}, server.meta || {});
        applyDirectory(server);
        if (added || dirty) { lsSet("imds-dir-dirty", "1"); await pushDirectory(false); return; }
      } else if (g.version !== known || !localCount) applyDirectory(server);
      lsSet("imds-dir-srv-version", String(g.version));
      dirStatus("Directory loaded from the database · " + Object.keys(DIR.entries).length.toLocaleString() + " suppliers");
    } catch (e) { dirStatus("Directory database unavailable: " + e.message + " (using this browser's copy)", true); }
  }

  // ---- E-mail center (Follow-up → "Send e-mails"): ONE place for request, follow-up and recap e-mails ----
  var MAIL_KEY = "imds-mail-opts";
  var KIND_META = {
    request: { label: "Request", help: "Kick-off: ask the supplier to confirm status and plan dates" },
    followup: { label: "Follow-up", help: "Chase one supplier about its outstanding parts" },
    recap: { label: "Status recap", help: "One progress e-mail to every supplier PIC" }
  };
  var mailCfg = null, mailInfo = { configured: false, senders: [], canSend: false, canConfigure: false, lastSent: {}, gapHours: 0 };
  var mailOnChange = [];

  function injectFollowCss() {
    if (document.getElementById("fu-css")) return;
    var st = document.createElement("style"); st.id = "fu-css";
    st.textContent = ".mk{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:6px 0 14px}.mk button{text-align:left;border:1px solid var(--line-strong,#d5d0e0);background:var(--surface,#fff);color:inherit;border-radius:12px;padding:10px 14px;cursor:pointer;font:inherit}.mk button b{display:block;font-size:14px}.mk button span{font-size:12px;color:var(--muted,#6b7280)}.mk button[aria-pressed=true]{border-color:#6d28d9;box-shadow:0 0 0 2px rgba(109,40,217,.25);background:rgba(109,40,217,.08)}" +
      ".mh{display:flex;align-items:center;gap:8px;margin:16px 0 6px;font-size:13px;font-weight:700}.mh i{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#6d28d9;color:#fff;font:700 11px system-ui;font-style:normal}" +
      ".fu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:8px 0}.fu-grid .field span{display:block;font-size:12px;font-weight:600;margin-bottom:4px}.fu-grid select,.fu-grid input[type=text],.fu-grid textarea{width:100%}" +
      ".fu-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.fu-chip{border:1px solid var(--line-strong,#d5d0e0);background:var(--surface,#fff);border-radius:999px;padding:3px 11px;font:600 12px system-ui,sans-serif;cursor:pointer;color:inherit}.fu-chip[aria-pressed=true]{background:#6d28d9;border-color:#6d28d9;color:#fff}.fu-chip.lock{background:transparent;border-style:dashed;cursor:default}" +
      ".fu-box{border:1px solid var(--line,#e8e1f1);border-radius:12px;padding:12px}.fu-box h3{font-size:13px;margin:0 0 6px}.fu-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}.fu-prog{height:6px;border-radius:99px;background:rgba(127,127,127,.25);overflow:hidden;flex:1;min-width:140px}.fu-prog i{display:block;height:100%;width:0;background:#6d28d9;transition:width .25s}" +
      ".fu-res.ok{color:#15803d;font-weight:600}.fu-res.err{color:#dc2626;font-weight:600}.fu-res.skip{color:#ca8a04;font-weight:600}.fu-det td{background:rgba(127,127,127,.08)}.fu-det textarea{width:100%;font:13px/1.45 ui-monospace,monospace;min-height:240px}.fu-det input[type=text]{width:100%}.fu-mail{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fu-only{display:inline-flex;gap:6px;align-items:center}" +
      ".fu-sql{width:100%;min-height:150px;font:12px/1.4 ui-monospace,monospace}";
    document.head.appendChild(st);
  }

  var SQL_MIGRATION = "create table if not exists public.imds_tracker_settings (\n  key text primary key check (key in ('directory','followup_config')),\n  value jsonb not null default '{}'::jsonb,\n  version integer not null default 1 check (version >= 1),\n  updated_by uuid references auth.users(id),\n  updated_at timestamptz not null default now()\n);\nalter table public.imds_tracker_settings enable row level security;\ngrant select, insert, update on public.imds_tracker_settings to authenticated;\ncreate policy imds_tracker_settings_read on public.imds_tracker_settings for select to authenticated using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));\ncreate policy imds_tracker_settings_insert on public.imds_tracker_settings for insert to authenticated with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));\ncreate policy imds_tracker_settings_update on public.imds_tracker_settings for update to authenticated using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[])) with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));\nnotify pgrst, 'reload schema';";

  async function loadMailConfig(force) {
    if (mailCfg && !force) return mailCfg;
    var g = await api("/api/imds-master/settings?key=followup_config");
    mailCfg = g.value; mailCfg.__missingTable = !!g.tableMissing; mailCfg.__version = g.version;
    return mailCfg;
  }
  function onMailConfig(fn) { mailOnChange.push(fn); }

  function longDate(d) { return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(d); }
  function fill(tpl, ctx) { return String(tpl || "").replace(/\{(supplier|code|count|projects|deadlines|partlist|models|modelshort|sender|greeting|date|updated|duedate)\}/g, function (m, k) { return ctx[k] == null ? "" : ctx[k]; }); }
  function partLines(kind, parts, include) {
    if (!include) return "(please see the attached file)";
    return parts.map(function (r, i) {
      if (kind === "request") return (i + 1) + ". " + r.partNo + " — " + (r.partName || "") + (r.targetDate ? " — Target Date: " + datePretty(r.targetDate) : "") + (r.pastDue ? " — PAST DUE" : "");
      return (i + 1) + ". " + r.partNo + " — " + (r.partName || "(part name not on file)") + (r.pastDue ? " — PAST DUE" : "");
    }).join("\n");
  }
  function dedupeMail(list, skip) {
    var seen = new Set((skip || []).map(function (e) { return String(e).toLowerCase(); })), out = [];
    list.forEach(function (e) { var k = String(e || "").trim().toLowerCase(); if (k && !seen.has(k)) { seen.add(k); out.push(String(e).trim()); } });
    return out;
  }
  function outlookDraft(to, cc, subject, body) {
    var url = "https://outlook.office.com/mail/deeplink/compose?to=" + encodeURIComponent(to.join(",")) + "&cc=" + encodeURIComponent(cc.join(",")) + "&subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    var w = null; try { w = window.open(url, "_blank"); } catch (e) { /* blocked */ }
    if (w) return;
    var text = "To: " + to.join(", ") + "\nCC: " + cc.join(", ") + "\nSubject: " + subject + "\n\n" + body;
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function () { toast("Outlook could not be opened from here. The full message was copied — paste it into a new Outlook e-mail.", "info"); },
      function () { toast("Outlook could not be opened from here. Copy the message from the preview instead.", "err"); });
  }

  function initFollowupCenter(follow) {
    injectFollowCss();
    var head = follow.querySelector("header.view-head");
    var actions = head && head.querySelector(".view-actions");
    if (actions) actions.innerHTML = '<div class="seg" role="group" aria-label="Follow-up view"><button type="button" class="seg-btn on" data-fmode="queues" aria-pressed="true">Who to chase</button><button type="button" class="seg-btn" data-fmode="email" aria-pressed="false">Send e-mails</button></div>';
    var box = document.createElement("section");
    box.className = "panel"; box.id = "shared-followup-panel"; box.hidden = true;
    box.innerHTML = '<div id="fu-state" class="banner" role="status">Loading…</div>' +
      '<div class="mh"><i>1</i>What do you want to send?</div><div class="mk" id="fu-kinds" role="group" aria-label="Type of e-mail"></div>' +
      '<div class="mh"><i>2</i>Which parts and which models?</div><div class="fu-grid">' +
      '<label class="field"><span>Parts to include</span><select id="fu-scope"><option value="open">Not submitted yet (supplier must act)</option><option value="notdone">Everything not accepted yet (includes TMMIN working)</option></select></label>' +
      '<div class="fu-box"><h3>Models</h3><div class="fu-chips" id="fu-models" role="group" aria-label="Models"></div><p class="muted small" id="fu-models-hint" style="margin:4px 0 0"></p></div></div>' +
      '<div class="mh"><i>3</i>Message</div><div class="fu-grid">' +
      '<label class="field"><span>Template <span class="muted" id="fu-tdef"></span></span><select id="fu-template"></select></label>' +
      '<label class="field"><span>Sender</span><select id="fu-sender"></select></label>' +
      '<label class="inline-check" style="align-self:end"><input type="checkbox" id="fu-list" checked> List the part numbers in the message</label></div>' +
      '<div class="mh"><i>4</i>CC and attachments</div><div class="fu-grid">' +
      '<div class="fu-box"><h3>CC</h3><div class="fu-chips" id="fu-req"></div>' +
      '<label class="inline-check"><input type="checkbox" id="fu-cc-mid"> Supplier middle management</label><br><label class="inline-check"><input type="checkbox" id="fu-cc-top"> Supplier top management</label><br><label class="inline-check"><input type="checkbox" id="fu-cc-buyer"> PUD buyer</label>' +
      '<label class="field" style="margin-top:8px"><span>Extra CC (optional, separate with ;)</span><input type="text" id="fu-extra" autocomplete="off" placeholder="name@company.com"></label></div>' +
      '<div class="fu-box"><h3>Attachments</h3><label class="inline-check"><input type="checkbox" id="fu-att-pdf"> <span id="fu-att-pdf-l"></span></label><br><label class="inline-check"><input type="checkbox" id="fu-att-xlsx"> <span id="fu-att-xlsx-l"></span></label><p class="muted small" style="margin:8px 0 0" id="fu-att-note"></p></div></div>' +
      '<div class="mh"><i>5</i>Review and send</div>' +
      '<div class="fu-bar"><span id="fu-only" class="fu-only" hidden></span><label class="inline-check" id="fu-all-wrap"><input type="checkbox" id="fu-all"> Select all ready</label><label class="inline-check"><input type="checkbox" id="fu-force"> Send even if e-mailed recently</label><span class="muted small" id="fu-count"></span><span style="flex:1"></span><button type="button" class="btn btn-primary btn-sm" id="fu-send" disabled>Send selected</button></div>' +
      '<div class="fu-bar" id="fu-progwrap" hidden><div class="fu-prog" aria-hidden="true"><i id="fu-prog"></i></div><span class="small" id="fu-prog-text"></span></div>' +
      '<div class="table-wrap"><table class="tbl compact"><thead id="fu-head"></thead><tbody id="fu-body"></tbody></table></div>';
    var anchor = follow.querySelector("#follow-sub") || follow.lastElementChild;
    anchor.insertAdjacentElement("afterend", box);
    var $ = function (id) { return box.querySelector("#" + id); };
    var S = { kind: "followup", scope: "open", models: [], only: "", selected: {}, edits: {}, results: {}, sending: false, mode: "queues", ready: false, open: "" };
    var team = function () { return typeof SENDERS === "object" ? SENDERS : {}; };
    var saved = {}; try { saved = JSON.parse(lsGet(MAIL_KEY) || "{}"); } catch (e) { saved = {}; }
    ["kind", "scope"].forEach(function (k) { if (saved[k]) S[k] = saved[k]; });
    if (!KIND_META[S.kind]) S.kind = "followup";
    var sender = saved.sender && team()[saved.sender] ? saved.sender : (Object.keys(team())[0] || "");
    function persist() { lsSet(MAIL_KEY, JSON.stringify({ kind: S.kind, scope: S.scope, sender: $("fu-sender").value, roles: roles(), att: { pdf: $("fu-att-pdf").checked, xlsx: $("fu-att-xlsx").checked }, list: $("fu-list").checked })); }
    function roles() { return { mid: $("fu-cc-mid").checked, top: $("fu-cc-top").checked, buyer: $("fu-cc-buyer").checked }; }

    function setMode(m) {
      S.mode = m;
      ["follow-tabs", "follow-panel", "follow-sub"].forEach(function (id) { var el = follow.querySelector("#" + id); if (el) el.hidden = m === "email"; });
      box.hidden = m !== "email";
      Array.prototype.forEach.call(follow.querySelectorAll("[data-fmode]"), function (b) { var on = b.getAttribute("data-fmode") === m; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      if (m === "email") boot();
    }
    follow.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-fmode]"); if (b) setMode(b.getAttribute("data-fmode")); });

    async function boot() {
      try {
        var res = await Promise.all([loadMailConfig(false), api("/api/imds-master/followups")]);
        mailInfo = res[1];
        if (!S.ready) {
          var cfg = res[0], rs = saved.roles || cfg.ccRoles, at = saved.att || cfg.attachments;
          $("fu-cc-mid").checked = !!rs.mid; $("fu-cc-top").checked = !!rs.top; $("fu-cc-buyer").checked = !!rs.buyer;
          $("fu-att-pdf").checked = at.pdf !== false; $("fu-att-xlsx").checked = at.xlsx !== false; $("fu-list").checked = saved.list !== false;
          $("fu-scope").value = S.scope;
          $("fu-sender").innerHTML = Object.keys(team()).map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
          if (sender) $("fu-sender").value = sender;
          S.ready = true;
        }
        draw();
      } catch (e) { $("fu-state").textContent = e.message; }
    }
    onMailConfig(function () { if (S.ready) draw(); });

    function templatesOfKind() { return mailCfg.templates.filter(function (t) { return t.kind === S.kind; }); }
    function currentTemplate() { var id = $("fu-template").value; return mailCfg.templates.filter(function (t) { return t.id === id; })[0] || templatesOfKind()[0]; }

    function selectedParts() {
      return visibleRecords().filter(function (r) { return (r.status === "missing" || (S.scope === "notdone" && r.status === "process")) && (!S.models.length || S.models.indexOf(r.model) >= 0) && (!S.only || r.company === S.only); });
    }
    function ccFor(lookups, to) {
      var me = team()[$("fu-sender").value] || "";
      var list = (mailCfg.requiredCc || []).concat(Object.keys(team()).map(function (n) { return team()[n]; }));
      var rs = roles();
      lookups.forEach(function (l) { if (rs.mid) list = list.concat(l.mid); if (rs.top) list = list.concat(l.top); if (rs.buyer && l.buyer) list = list.concat(l.buyer.emails || []); });
      list = list.concat(splitEmails($("fu-extra").value));
      return dedupeMail(list, to.concat([me]));
    }
    function baseCtx() {
      var now = new Date();
      return { sender: $("fu-sender").value, greeting: greeting(), date: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(now),
        updated: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(now) + ", " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " WIB",
        duedate: longDate(new Date(now.getTime() + 7 * 86400000)), models: summaryModelsText(), modelshort: summaryModelLabels().join(", ") };
    }
    function buildGroups() {
      var t = currentTemplate(), base = baseCtx(), include = $("fu-list").checked, parts = selectedParts();
      if (S.kind === "recap") {
        var companies = Array.from(new Set(parts.map(function (r) { return r.company; })));
        var lookups = companies.map(function (c) { return contactLookup(c); });
        var to = dedupeMail([].concat.apply([], lookups.map(function (l) { return l.pic; })), []);
        var ctx = Object.assign({}, base, { supplier: "IMDS Team", code: "", count: parts.length, projects: projNames(parts), deadlines: projLines(parts), partlist: "" });
        return [{ key: "RECAP", name: "ALL SUPPLIERS (RECAP)", code: "", parts: parts, to: to, cc: ccFor(lookups, to), companies: companies.length, ready: to.length > 0 && parts.length > 0, subject: fill(t.subject, ctx), body: fill(t.body, ctx), projects: [] }];
      }
      var by = new Map();
      parts.forEach(function (r) { if (!by.has(r.company)) by.set(r.company, []); by.get(r.company).push(r); });
      var out = [];
      by.forEach(function (list, company) {
        list.sort(function (a, b) { return ((a.targetDate && a.targetDate.getTime()) || Infinity) - ((b.targetDate && b.targetDate.getTime()) || Infinity); });
        var l = contactLookup(company), to = l.pic.slice();
        var ctx = Object.assign({}, base, { supplier: company, code: list[0].vendorCode || "-", count: list.length, projects: projNames(list), deadlines: projLines(list), partlist: partLines(S.kind, list, include) });
        out.push({ key: company, name: company, code: list[0].vendorCode || "", parts: list, to: to, cc: ccFor([l], to), lookup: l, ready: to.length > 0, subject: fill(t.subject, ctx), body: fill(t.body, ctx),
          projects: Array.from(new Set(list.map(function (r) { return M.label(r.model); }))) });
      });
      out.sort(function (a, b) { return b.parts.length - a.parts.length || a.name.localeCompare(b.name); });
      return out;
    }

    var groups = [];
    function draw() {
      var cfg = mailCfg; if (!cfg) return;
      $("fu-kinds").innerHTML = Object.keys(KIND_META).map(function (k) { return '<button type="button" data-kind="' + k + '" aria-pressed="' + (S.kind === k) + '"><b>' + esc(KIND_META[k].label) + "</b><span>" + esc(KIND_META[k].help) + "</span></button>"; }).join("");
      var tlist = templatesOfKind(), cur = $("fu-template").value;
      $("fu-template").innerHTML = tlist.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + (cfg.defaults[S.kind] === t.id ? " (default)" : "") + "</option>"; }).join("");
      $("fu-template").value = tlist.some(function (t) { return t.id === cur; }) ? cur : cfg.defaults[S.kind];
      $("fu-tdef").textContent = tlist.length > 1 ? "— " + tlist.length + " available" : "";
      var keys = M.keys().filter(function (k) { return M.isVisible(k); });
      $("fu-models").innerHTML = keys.map(function (k) { return '<button type="button" class="fu-chip" data-m="' + esc(k) + '" aria-pressed="' + (S.models.indexOf(k) >= 0) + '">' + esc(M.label(k)) + "</button>"; }).join("") || '<span class="muted small">No models yet.</span>';
      $("fu-models-hint").textContent = S.models.length ? "Only the selected models are included." : "All models are included. Tap a model to limit the e-mail to it.";
      var rq = (cfg.requiredCc || []);
      $("fu-req").innerHTML = rq.length ? '<span class="muted small">Always on CC:</span> ' + rq.map(function (e) { return '<span class="fu-chip lock" title="Mandatory — change in Settings → E-mail templates">🔒 ' + esc(e) + "</span>"; }).join("") : '<span class="muted small">No mandatory CC set (Settings → E-mail templates).</span>';
      var recap = S.kind === "recap";
      $("fu-att-pdf-l").textContent = recap ? "Executive summary PDF (all suppliers)" : "PDF recap of this supplier's parts";
      $("fu-att-xlsx-l").textContent = recap ? "Excel list of all outstanding parts" : "Excel list of unsubmitted part numbers (supplier fills the plan date)";
      $("fu-att-note").textContent = recap ? "Generated now from the current data." : "Generated per supplier, only with the parts listed in its e-mail.";
      $("fu-list").closest("label").hidden = recap;
      $("fu-all-wrap").hidden = recap;
      $("fu-send").textContent = recap ? "Send recap" : "Send selected";
      var onlyEl = $("fu-only");
      if (S.only) { onlyEl.hidden = false; onlyEl.innerHTML = '<span class="fu-chip" aria-pressed="true">' + esc(S.only) + ' ✕</span>'; } else onlyEl.hidden = true;
      $("fu-state").textContent = (cfg.__missingTable ? "⚠ The settings table is not created yet — built-in templates are used and changes cannot be saved. See Settings → E-mail templates. " : "") +
        (mailInfo.configured ? "" : "Sending through Power Automate is not configured yet; you can still open each e-mail as an Outlook draft. ") + (mailInfo.canSend ? "" : "Your role cannot send e-mails. ");
      $("fu-state").hidden = !$("fu-state").textContent;
      groups = buildGroups();
      renderTable();
    }
    function renderTable() {
      var recap = S.kind === "recap", body = $("fu-body"), head = $("fu-head");
      if (recap) {
        head.innerHTML = "";
        var g = groups[0];
        if (!g || !g.parts.length) { body.innerHTML = '<tr><td class="muted">Nothing outstanding for this selection. 🎉</td></tr>'; $("fu-send").disabled = true; $("fu-count").textContent = ""; return; }
        body.innerHTML = '<tr><td><div class="small"><b>To:</b> ' + g.to.length + " supplier PIC(s) from " + g.companies + " supplier(s) · <b>CC:</b> " + esc(g.cc.join("; ") || "—") + " · <b>Parts:</b> " + g.parts.length + '</div>' +
          '<label class="field" style="margin-top:8px"><span>Subject</span><input type="text" class="fu-sub" id="fu-rsub"></label><label class="field"><span>Message</span><textarea class="fu-msg" id="fu-rmsg" style="min-height:300px;width:100%;font:13px/1.45 ui-monospace,monospace"></textarea></label>' +
          '<div class="row-actions"><button type="button" class="btn btn-secondary btn-sm" id="fu-rout">Open in Outlook draft</button></div></td></tr>';
        var ed = S.edits.RECAP || {};
        $("fu-rsub").value = ed.subject != null ? ed.subject : g.subject; $("fu-rmsg").value = ed.body != null ? ed.body : g.body;
        $("fu-rsub").oninput = function () { (S.edits.RECAP = S.edits.RECAP || {}).subject = this.value; };
        $("fu-rmsg").oninput = function () { (S.edits.RECAP = S.edits.RECAP || {}).body = this.value; };
        $("fu-rout").onclick = function () { outlookDraft(g.to, g.cc, $("fu-rsub").value, $("fu-rmsg").value); };
        $("fu-count").textContent = g.to.length + " recipient(s)";
        $("fu-send").disabled = S.sending || !mailInfo.configured || !mailInfo.canSend || !g.ready;
        return;
      }
      head.innerHTML = '<tr><th scope="col"><span class="sr-only">Select</span></th><th scope="col">Supplier</th><th scope="col" class="r">Parts</th><th scope="col">Models</th><th scope="col">To</th><th scope="col" class="r">CC</th><th scope="col">Last e-mailed</th><th scope="col">Result</th><th scope="col"><span class="sr-only">Preview</span></th></tr>';
      if (!groups.length) { body.innerHTML = '<tr><td colspan="9" class="muted">No supplier has outstanding parts for this selection. 🎉</td></tr>'; $("fu-count").textContent = ""; $("fu-send").disabled = true; return; }
      body.innerHTML = groups.map(function (g, i) {
        var last = mailInfo.lastSent[g.name], r = S.results[g.key];
        return '<tr data-i="' + i + '"><td><input type="checkbox" class="fu-pick" aria-label="Select ' + esc(g.name) + '"' + (S.selected[g.key] && g.ready ? " checked" : "") + (g.ready ? "" : " disabled") + "></td>" +
          '<th scope="row">' + esc(g.name) + '<div class="muted small">' + esc(g.code || "no code") + "</div></th><td class=\"r\">" + g.parts.length + "</td><td>" + esc(g.projects.join(", ") || "—") + '</td><td class="fu-mail" title="' + esc(g.to.join("; ")) + '">' + (g.ready ? esc(g.to.join("; ")) + (g.lookup && g.lookup.src !== "directory" ? ' <span class="muted small">(' + esc(g.lookup.src) + ")</span>" : "") : '<span class="fu-res err">No PIC e-mail — add it in Directory</span>') + '</td><td class="r">' + g.cc.length + "</td><td>" + (last ? esc(new Date(last).toLocaleDateString()) : '<span class="muted">—</span>') + "</td><td>" + (r ? '<span class="fu-res ' + r.kind + '">' + esc(r.text) + "</span>" : "") + '</td><td><button type="button" class="btn btn-ghost btn-sm fu-prev">' + (S.open === g.key ? "Hide" : "Preview") + "</button></td></tr>" + (S.open === g.key ? detailRow(g, i) : "");
      }).join("");
      var n = groups.filter(function (g) { return S.selected[g.key] && g.ready; }).length;
      $("fu-count").textContent = n + " selected · " + groups.filter(function (g) { return g.ready; }).length + " of " + groups.length + " ready";
      $("fu-send").disabled = !n || S.sending || !mailInfo.configured || !mailInfo.canSend;
      $("fu-send").title = !mailInfo.configured ? "Sending is not configured (POWER_AUTOMATE_EMAIL_URL / POWER_AUTOMATE_SECRET)." : "";
      if (S.open) wireDetail();
    }
    function detailRow(g, i) {
      return '<tr class="fu-det" data-d="' + i + '"><td colspan="9"><div class="small"><b>To:</b> ' + esc(g.to.join("; ")) + "<br><b>CC:</b> " + esc(g.cc.join("; ") || "—") + '</div><label class="field" style="margin-top:8px"><span>Subject</span><input type="text" class="fu-sub"></label><label class="field"><span>Message — edit if needed (this supplier only)</span><textarea class="fu-msg"></textarea></label><div class="row-actions"><button type="button" class="btn btn-secondary btn-sm fu-out">Open in Outlook draft</button></div></td></tr>';
    }
    function wireDetail() {
      var det = $("fu-body").querySelector(".fu-det"); if (!det) return;
      var g = groups[Number(det.getAttribute("data-d"))], ed = S.edits[g.key] || {};
      var sub = det.querySelector(".fu-sub"), msg = det.querySelector(".fu-msg");
      sub.value = ed.subject != null ? ed.subject : g.subject; msg.value = ed.body != null ? ed.body : g.body;
      sub.oninput = function () { (S.edits[g.key] = S.edits[g.key] || {}).subject = sub.value; };
      msg.oninput = function () { (S.edits[g.key] = S.edits[g.key] || {}).body = msg.value; };
      det.querySelector(".fu-out").onclick = function () { outlookDraft(g.to, g.cc, sub.value, msg.value); };
    }
    function redraw() { persist(); S.selected = {}; S.results = {}; S.edits = {}; $("fu-all").checked = false; draw(); }

    $("fu-kinds").onclick = function (e) { var b = e.target.closest && e.target.closest("button[data-kind]"); if (!b) return; S.kind = b.getAttribute("data-kind"); S.open = ""; $("fu-template").value = ""; redraw(); };
    $("fu-scope").onchange = function () { S.scope = this.value; redraw(); };
    ["fu-template", "fu-sender", "fu-list", "fu-cc-mid", "fu-cc-top", "fu-cc-buyer", "fu-att-pdf", "fu-att-xlsx"].forEach(function (id) { $(id).onchange = function () { if (id === "fu-sender") lsSet("imds-sender", this.value); if (id === "fu-att-pdf" || id === "fu-att-xlsx") { persist(); return; } redraw(); }; });
    var tmr; $("fu-extra").oninput = function () { window.clearTimeout(tmr); tmr = window.setTimeout(redraw, 350); };
    $("fu-models").onclick = function (e) {
      var b = e.target.closest && e.target.closest("button[data-m]"); if (!b) return;
      var m = b.getAttribute("data-m"), i = S.models.indexOf(m); if (i >= 0) S.models.splice(i, 1); else S.models.push(m); redraw();
    };
    $("fu-only").onclick = function () { S.only = ""; redraw(); };
    $("fu-all").onchange = function () { var on = this.checked; groups.forEach(function (g) { if (g.ready) S.selected[g.key] = on; }); renderTable(); };
    $("fu-body").onchange = function (e) { if (!e.target.classList.contains("fu-pick")) return; var g = groups[Number(e.target.closest("tr").getAttribute("data-i"))]; S.selected[g.key] = e.target.checked; renderTable(); };
    $("fu-body").onclick = function (e) {
      var btn = e.target.closest && e.target.closest(".fu-prev"); if (!btn) return;
      var g = groups[Number(btn.closest("tr").getAttribute("data-i"))]; S.open = S.open === g.key ? "" : g.key; renderTable();
    };

    async function recapPdf() {
      if (!$("fu-att-pdf").checked) return undefined;
      var doc = generateSummaryPDF({ returnDoc: true });
      if (!doc) throw new Error("The executive summary PDF could not be generated.");
      var uri = doc.output("datauristring"); return { name: "IMDS_Submission_Summary_" + new Date().toISOString().slice(0, 10) + ".pdf", base64: uri.slice(uri.indexOf(",") + 1) };
    }
    async function sendOne(g) {
      var ed = S.edits[g.key] || {};
      var payload = { kind: S.kind, supplierCode: g.code, supplierName: g.name, to: g.to, cc: g.cc, subject: ed.subject != null ? ed.subject : g.subject, messageBody: ed.body != null ? ed.body : g.body,
        sender: team()[$("fu-sender").value] || undefined, force: $("fu-force").checked, partIds: g.parts.map(function (r) { return r.masterId; }).filter(Boolean),
        attachments: { pdf: $("fu-att-pdf").checked && S.kind !== "recap", xlsx: $("fu-att-xlsx").checked } };
      if (S.kind === "recap") payload.extraPdf = await recapPdf();
      return api("/api/imds-master/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    $("fu-send").onclick = async function () {
      if (S.sending) return;
      var todo = S.kind === "recap" ? groups.filter(function (g) { return g.ready; }) : groups.filter(function (g) { return S.selected[g.key] && g.ready; });
      if (!todo.length) return;
      var att = [$("fu-att-pdf").checked ? "PDF" : "", $("fu-att-xlsx").checked ? "Excel" : ""].filter(Boolean).join(" + ") || "none";
      var msg = S.kind === "recap" ? "Send ONE recap e-mail to " + todo[0].to.length + " supplier PIC(s)?" : "Send " + todo.length + " e-mail(s), one per supplier?";
      if (!window.confirm(msg + "\nAttachments: " + att + "\nMandatory CC is added automatically.\nThey go out through Power Automate.")) return;
      S.sending = true; renderTable(); $("fu-progwrap").hidden = false;
      var done = 0, ok = 0, skip = 0, fail = 0, last = "";
      for (var i = 0; i < todo.length; i++) {
        var g = todo[i];
        $("fu-prog-text").textContent = "Sending " + (i + 1) + " of " + todo.length + " — " + g.name;
        S.results[g.key] = { kind: "skip", text: "Sending…" }; renderTable();
        try { var r = await sendOne(g); S.results[g.key] = { kind: "ok", text: "Handed to Power Automate" }; ok++; S.selected[g.key] = false; last = r.sentFrom || ""; mailInfo.lastSent[g.name] = new Date().toISOString(); }
        catch (e) {
          if (e.payload && e.payload.skipped === "RECENTLY_SENT") { S.results[g.key] = { kind: "skip", text: "Skipped — e-mailed recently" }; skip++; }
          else { S.results[g.key] = { kind: "err", text: e.message }; fail++; }
        }
        done++; $("fu-prog").style.width = Math.round(done / todo.length * 100) + "%";
      }
      S.sending = false; renderTable();
      $("fu-prog-text").textContent = "Finished: " + ok + " handed to Power Automate · " + skip + " skipped · " + fail + " failed" + (last ? " · sent from " + last : "") + ". “Handed over” means the flow accepted it — confirm delivery in Outlook Sent items.";
    };

    window.__imdsEmailFor = function (company, kind) {
      S.kind = kind || "followup"; S.only = company || ""; S.models = []; S.open = company || ""; S.selected = {}; S.results = {}; S.edits = {};
      go("followup"); setMode("email");
      if (company) window.setTimeout(function () { var g = groups.filter(function (x) { return x.name === company; })[0]; if (g) { S.selected[g.key] = true; S.open = g.key; renderTable(); } }, 0);
      persist();
      window.setTimeout(function () { box.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
    };
    window.__imdsEmailRecap = function () { window.__imdsEmailFor("", "recap"); };
    setMode("queues");
  }

  // ---- Settings → E-mail templates ----
  function initFollowupSettings(settings, after) {
    injectFollowCss();
    var sec = document.createElement("section");
    sec.className = "panel"; sec.id = "followup-settings-panel";
    sec.innerHTML = '<div class="panel-head"><div><h2>E-mail templates and rules</h2><p class="panel-sub">Templates for the three e-mail types, the mandatory CC and the defaults. Saved on the server for everyone.</p></div></div>' +
      '<div id="fs-msg" class="banner" role="status">Loading…</div><div id="fs-sql" hidden></div>' +
      '<div class="fu-grid"><label class="field"><span>Template</span><select id="fs-tsel"></select></label>' +
      '<div class="fu-bar" style="margin:0;align-self:end"><button type="button" class="btn btn-secondary btn-sm" id="fs-add">+ New</button><button type="button" class="btn btn-secondary btn-sm" id="fs-dup">Duplicate</button><button type="button" class="btn btn-ghost btn-sm" id="fs-del">Delete</button><button type="button" class="btn btn-ghost btn-sm" id="fs-def">Make default</button></div></div>' +
      '<div class="fu-box"><div class="fu-grid"><label class="field"><span>Type</span><select id="fs-kind"><option value="request">Request (kick-off)</option><option value="followup">Follow-up (per supplier)</option><option value="recap">Status recap (all suppliers)</option></select></label><label class="field"><span>Template name</span><input type="text" id="fs-name"></label></div>' +
      '<label class="field"><span>Subject</span><input type="text" id="fs-subj" style="width:100%"></label><label class="field"><span>Message</span><textarea id="fs-body" style="width:100%;min-height:320px;font:13px/1.45 ui-monospace,monospace"></textarea></label>' +
      '<p class="muted small" style="margin:6px 0 0">Placeholders: <code>{supplier}</code> <code>{code}</code> <code>{count}</code> <code>{projects}</code> <code>{deadlines}</code> <code>{partlist}</code> <code>{models}</code> <code>{modelshort}</code> <code>{sender}</code> <code>{greeting}</code> <code>{date}</code> <code>{updated}</code> <code>{duedate}</code></p></div>' +
      '<div class="fu-grid"><div class="fu-box"><h3>Mandatory CC (added to every e-mail; cannot be removed when sending)</h3><textarea id="fs-req" rows="4" style="width:100%" placeholder="one e-mail per line"></textarea></div>' +
      '<div class="fu-box"><h3>CC by default</h3><label class="inline-check"><input type="checkbox" id="fs-mid"> Supplier middle management</label><br><label class="inline-check"><input type="checkbox" id="fs-top"> Supplier top management</label><br><label class="inline-check"><input type="checkbox" id="fs-buyer"> PUD buyer</label></div>' +
      '<div class="fu-box"><h3>Attachments by default</h3><label class="inline-check"><input type="checkbox" id="fs-pdf"> PDF</label><br><label class="inline-check"><input type="checkbox" id="fs-xlsx"> Excel list of parts</label></div></div>' +
      '<div class="fu-bar"><button type="button" class="btn btn-primary btn-sm" id="fs-save">Save</button><button type="button" class="btn btn-ghost btn-sm" id="fs-reset">Restore built-in templates</button><span class="muted small" id="fs-ver"></span></div>';
    after.insertAdjacentElement("afterend", sec);
    var $ = function (id) { return sec.querySelector("#" + id); };
    var cfg = null, version = 0, cur = 0, builtin = null;
    function say(t, bad) { var m = $("fs-msg"); m.textContent = t; m.style.color = bad ? "#dc2626" : ""; }
    function stash() { if (!cfg || !cfg.templates[cur]) return; var t = cfg.templates[cur]; t.name = $("fs-name").value; t.subject = $("fs-subj").value; t.body = $("fs-body").value; t.kind = $("fs-kind").value; }
    function label(t) { return (KIND_META[t.kind] ? KIND_META[t.kind].label : t.kind) + " · " + t.name + (cfg.defaults[t.kind] === t.id ? " (default)" : ""); }
    function fillList() { $("fs-tsel").innerHTML = cfg.templates.map(function (t, i) { return '<option value="' + i + '">' + esc(label(t)) + "</option>"; }).join(""); $("fs-tsel").value = String(cur); }
    function fillTemplate() { var t = cfg.templates[cur]; $("fs-name").value = t.name; $("fs-subj").value = t.subject; $("fs-body").value = t.body; $("fs-kind").value = t.kind; }
    function fillAll() {
      fillList(); fillTemplate();
      $("fs-req").value = cfg.requiredCc.join("\n"); $("fs-mid").checked = cfg.ccRoles.mid; $("fs-top").checked = cfg.ccRoles.top; $("fs-buyer").checked = cfg.ccRoles.buyer;
      $("fs-pdf").checked = cfg.attachments.pdf; $("fs-xlsx").checked = cfg.attachments.xlsx;
      $("fs-ver").textContent = version ? "Saved version " + version : "Built-in defaults (not saved yet)";
    }
    function showSql(on) {
      var b = $("fs-sql"); b.hidden = !on; if (!on) return;
      b.innerHTML = '<div class="fu-box" style="margin:8px 0"><b>One-time setup:</b> the database table for these settings does not exist yet. Open Supabase → SQL editor, paste this and press Run. Then reload this page.<textarea class="fu-sql" readonly></textarea><div class="row-actions"><button type="button" class="btn btn-secondary btn-sm" id="fs-copy">Copy the SQL</button></div></div>';
      b.querySelector("textarea").value = SQL_MIGRATION;
      b.querySelector("#fs-copy").onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(SQL_MIGRATION) : Promise.reject()).then(function () { toast("SQL copied", "ok"); }, function () { b.querySelector("textarea").select(); }); };
    }
    async function load() {
      try {
        var g = await api("/api/imds-master/settings?key=followup_config");
        cfg = g.value; version = g.version; mailCfg = Object.assign({}, cfg, { __missingTable: !!g.tableMissing, __version: g.version });
        if (!builtin) builtin = JSON.parse(JSON.stringify(cfg));
        cur = Math.max(0, cfg.templates.findIndex(function (t) { return t.id === cfg.defaults.followup; }));
        fillAll(); showSql(!!g.tableMissing);
        say(g.tableMissing ? "Showing the built-in templates. They work, but edits cannot be saved until the table is created (see below)." : "Edit a template or the rules, then save.", !!g.tableMissing);
        mailOnChange.forEach(function (fn) { fn(); });
      } catch (e) { say(e.message, true); }
    }
    $("fs-tsel").onchange = function () { stash(); cur = Number($("fs-tsel").value); fillTemplate(); fillList(); };
    $("fs-kind").onchange = function () { stash(); fillList(); };
    $("fs-name").oninput = function () { stash(); fillList(); };
    function uid() { return "t" + Date.now().toString(36); }
    $("fs-add").onclick = function () { stash(); var k = cfg.templates[cur] ? cfg.templates[cur].kind : "followup"; cfg.templates.push({ id: uid(), kind: k, name: "New template", subject: "IMDS follow-up | {supplier} | {count} part(s)", body: "Dear {supplier} Team,\n\n{greeting}.\nThis is {sender} from Material Engineering - TMMIN.\n\n{partlist}\n\nThank you for your kind cooperation." }); cur = cfg.templates.length - 1; fillList(); fillTemplate(); };
    $("fs-dup").onclick = function () { stash(); var t = cfg.templates[cur]; cfg.templates.push({ id: uid(), kind: t.kind, name: t.name + " (copy)", subject: t.subject, body: t.body }); cur = cfg.templates.length - 1; fillList(); fillTemplate(); };
    $("fs-del").onclick = function () {
      var t = cfg.templates[cur];
      if (cfg.templates.filter(function (x) { return x.kind === t.kind; }).length < 2) { say("Keep at least one template for each type.", true); return; }
      if (!window.confirm("Delete “" + t.name + "”?")) return;
      cfg.templates.splice(cur, 1); if (cfg.defaults[t.kind] === t.id) cfg.defaults[t.kind] = cfg.templates.filter(function (x) { return x.kind === t.kind; })[0].id; cur = 0; fillList(); fillTemplate();
    };
    $("fs-def").onclick = function () { stash(); var t = cfg.templates[cur]; cfg.defaults[t.kind] = t.id; fillList(); say("“" + t.name + "” will be the default " + (KIND_META[t.kind] ? KIND_META[t.kind].label.toLowerCase() : "") + " template after you save."); };
    $("fs-reset").onclick = function () { if (!builtin || !window.confirm("Replace the templates and rules on screen with the built-in ones? Nothing is saved until you press Save.")) return; cfg = JSON.parse(JSON.stringify(builtin)); cur = 0; fillAll(); };
    $("fs-save").onclick = async function () {
      stash();
      var req = $("fs-req").value.split(/[\n;,\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var bad = req.filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
      if (bad.length) { say("These are not valid e-mail addresses: " + bad.join(", "), true); return; }
      cfg.requiredCc = req; cfg.ccRoles = { mid: $("fs-mid").checked, top: $("fs-top").checked, buyer: $("fs-buyer").checked }; cfg.attachments = { pdf: $("fs-pdf").checked, xlsx: $("fs-xlsx").checked };
      try {
        var clean = { templates: cfg.templates, defaults: cfg.defaults, requiredCc: cfg.requiredCc, ccRoles: cfg.ccRoles, attachments: cfg.attachments };
        var r = await api("/api/imds-master/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "followup_config", value: clean, baseVersion: version }) });
        version = r.version; await load(); say("Saved. The e-mail center uses these templates now.");
      } catch (e) { if (e.payload && e.payload.tableMissing) showSql(true); say(e.payload && e.payload.conflict ? e.message + " (Press F5 to reload.)" : e.message, true); }
    };
    load();
  }

  // ---- Directory → PUD buyers: paste the buyer list once ----
  function initBuyerPaste() {
    var pane = document.getElementById("dir-pane-buyers"); if (!pane || document.getElementById("buyer-paste")) return;
    var d = document.createElement("section"); d.className = "panel"; d.id = "buyer-paste";
    d.innerHTML = '<div class="panel-head"><div><h2>Update buyers from a pasted list</h2><p class="panel-sub">Paste rows copied from Excel. Two kinds of rows are understood: <b>email ⇥ buyer name</b> (sets the buyer e-mail) and <b>supplier code ⇥ code ⇥ supplier name ⇥ buyer</b> (assigns the buyer to the supplier). Nothing is deleted.</p></div></div><textarea id="bp-text" rows="6" style="width:100%;font:12px/1.4 ui-monospace,monospace" placeholder="wahyu.bakhtiar@toyota.co.id&#9;Puguh&#10;5020&#9;5020&#9;Chuhatsu Indonesia&#9;Puguh"></textarea><div class="row-actions"><button type="button" class="btn btn-primary btn-sm" id="bp-run">Apply</button><span class="muted small" id="bp-msg" role="status"></span></div>';
    pane.insertAdjacentElement("beforebegin", d);
    d.querySelector("#bp-run").onclick = function () {
      var msg = d.querySelector("#bp-msg"), lines = d.querySelector("#bp-text").value.split(/\r?\n/).map(function (l) { return l.split("\t").map(function (c) { return c.trim(); }); }).filter(function (c) { return c.some(Boolean); });
      var emails = 0, assigned = 0, unmatched = [], skipped = 0, now = new Date().toISOString();
      function buyerKey(name) { var n = String(name || "").trim().toLowerCase(); if (!n) return ""; var hit = Object.keys(DIR.buyers).filter(function (k) { return k.toLowerCase() === n || String(DIR.buyers[k].full || "").toLowerCase() === n; })[0]; return hit || ""; }
      function canon(name) { return String(name || "").trim().replace(/\s+/g, " "); }
      lines.forEach(function (c) {
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c[0]) && c[1]) { var nm = canon(c[1]), k = buyerKey(nm) || nm; DIR.buyers[k] = DIR.buyers[k] || {}; DIR.buyers[k].email = c[0].toLowerCase(); emails++; return; }
        if (c.length >= 4 && !/^supp/i.test(c[0])) {
          var nm2 = canon(c[3]); if (!nm2) { skipped++; return; }
          var bk = buyerKey(nm2) || nm2; if (!DIR.buyers[bk]) DIR.buyers[bk] = {};
          var code = String(c[0] || c[1] || "").trim().toUpperCase().replace(/\.0$/, "");
          var key = Object.keys(DIR.entries).filter(function (k) { var e = DIR.entries[k]; return code && String(e.code || "").trim().toUpperCase().replace(/\.0$/, "") === code; })[0];
          if (!key) { var m = dirFor(canon(c[2]).toUpperCase()); if (m) key = m.key; }
          if (!key) { var nk = nameKey(c[2]); key = Object.keys(DIR.entries).filter(function (k) { return nameKey(DIR.entries[k].name || k) === nk; })[0]; }
          if (!key) { unmatched.push(canon(c[2])); return; }
          var en = DIR.entries[key]; en.f = en.f || {}; en.m = en.m || {}; en.f.buyer = bk; en.m.buyer = 1; en.at = now; assigned++; return;
        }
        skipped++;
      });
      saveDir(); try { renderAll(); } catch (e) { /* re-render on navigation */ }
      msg.textContent = emails + " buyer e-mail(s) set · " + assigned + " supplier(s) assigned" + (unmatched.length ? " · " + unmatched.length + " not in the Directory yet (" + unmatched.slice(0, 6).join(", ") + (unmatched.length > 6 ? "…" : "") + ")" : "") + (skipped ? " · " + skipped + " row(s) not understood" : "") + ". Saved to the database automatically.";
    };
  }

  // ---- Automatic Excel sync: no button needed. Pushes any queued updates to Power Automate while the Tracker is open. ----
  var autoSyncBusy = false, autoSyncStopped = false;
  async function autoSync() {
    if (autoSyncBusy || autoSyncStopped || document.hidden) return;
    autoSyncBusy = true;
    try {
      var st = await api("/api/imds-master/sync");
      if (!st.configured) return;                              // nothing to push to yet
      if ((st.queue.pending || 0) + (st.queue.failed || 0) === 0) return;
      await api("/api/imds-master/sync", { method: "POST" });
      if (typeof window.__imdsSmReload === "function") window.__imdsSmReload();
    } catch (e) {
      if (/role is required|Authentication required/i.test(String(e && e.message))) autoSyncStopped = true; // viewer role: stop quietly
    } finally { autoSyncBusy = false; }
  }

  function start() {
    initSharedPanels();
    initBuyerPaste();
    initDirectorySync();
    startFast();
    window.setTimeout(autoSync, 4000);
    window.setInterval(autoSync, 60000);
    timer = window.setInterval(function () {
      if (!document.hidden) refreshSharedMaster(true);
    }, 15000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refreshSharedMaster(true);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.addEventListener("pagehide", function () {
    if (timer) window.clearInterval(timer);
  }, { once: true });
})();