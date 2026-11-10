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

  // ---- Follow-up center (Follow-up view) ----
  function injectFollowCss() {
    if (document.getElementById("fu-css")) return;
    var st = document.createElement("style"); st.id = "fu-css";
    st.textContent = ".fu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:10px 0}.fu-grid .field span{display:block;font-size:12px;font-weight:600;margin-bottom:4px}.fu-grid select,.fu-grid input[type=text],.fu-grid textarea{width:100%}" +
      ".fu-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.fu-chip{border:1px solid var(--line-strong,#d5d0e0);background:var(--surface,#fff);border-radius:999px;padding:3px 11px;font:600 12px system-ui,sans-serif;cursor:pointer;color:inherit}.fu-chip[aria-pressed=true]{background:#6d28d9;border-color:#6d28d9;color:#fff}.fu-chip.lock{background:#f3f0fa;border-style:dashed;cursor:default}" +
      ".fu-box{border:1px solid var(--line,#e8e1f1);border-radius:12px;padding:12px;background:var(--surface-2,#faf8fd)}.fu-box h3{font-size:13px;margin:0 0 6px}.fu-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}.fu-prog{height:6px;border-radius:99px;background:#ece7f6;overflow:hidden;flex:1;min-width:140px}.fu-prog i{display:block;height:100%;width:0;background:#6d28d9;transition:width .25s}" +
      ".fu-res.ok{color:#15803d;font-weight:600}.fu-res.err{color:#b91c1c;font-weight:600}.fu-res.skip{color:#a16207;font-weight:600}.fu-det td{background:var(--surface-2,#faf8fd)}.fu-det textarea{width:100%;font:13px/1.45 ui-monospace,monospace;min-height:180px}.fu-det input[type=text]{width:100%}.fu-mail{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}";
    document.head.appendChild(st);
  }

  function initFollowupCenter(follow) {
    injectFollowCss();
    var head = follow.querySelector("header.view-head");
    var box = document.createElement("section");
    box.className = "panel"; box.id = "shared-followup-panel";
    box.innerHTML = '<div class="panel-head"><div><h2>E-mail suppliers</h2><p class="panel-sub">One e-mail per supplier, listing only that supplier\'s outstanding parts. Pick the scope, template, CC and attachments, review, then send.</p></div></div>' +
      '<div id="fu-state" class="banner" role="status">Open this page to load the supplier list.</div>' +
      '<div class="fu-grid">' +
      '<label class="field"><span>Which parts</span><select id="fu-scope"><option value="action">Not submitted / rejected (supplier must act)</option><option value="all">Everything not ACCEPTED yet</option></select></label>' +
      '<label class="field"><span>E-mail template</span><select id="fu-template"></select></label>' +
      '<label class="field" id="fu-sender-wrap"><span>Send as</span><select id="fu-sender"></select></label></div>' +
      '<div class="fu-box"><h3>Models</h3><div class="fu-chips" id="fu-models" role="group" aria-label="Models to chase"></div><p class="muted small" id="fu-models-hint" style="margin:4px 0 0">All models are included.</p></div>' +
      '<div class="fu-grid">' +
      '<div class="fu-box"><h3>CC (copy)</h3><div class="fu-chips" id="fu-req" aria-label="Required CC"></div>' +
      '<label class="inline-check"><input type="checkbox" id="fu-cc-mid"> Middle management (staff, SPV, DPH, GM)</label><br><label class="inline-check"><input type="checkbox" id="fu-cc-top"> Top management (MD, VP, PD)</label><br><label class="inline-check"><input type="checkbox" id="fu-cc-buyer"> PUD buyer</label>' +
      '<label class="field" style="margin-top:8px"><span>Extra CC (optional, separate with ;)</span><input type="text" id="fu-extra" autocomplete="off" placeholder="name@company.com"></label></div>' +
      '<div class="fu-box"><h3>Attachments</h3><label class="inline-check"><input type="checkbox" id="fu-att-pdf"> PDF — status recap of the parts</label><br><label class="inline-check"><input type="checkbox" id="fu-att-xlsx"> Excel — list of unsubmitted part numbers (supplier fills the plan date)</label>' +
      '<p class="muted small" style="margin:8px 0 0">Both are generated per supplier, only with that supplier\'s parts.</p></div></div>' +
      '<div class="fu-bar"><button type="button" class="btn btn-secondary btn-sm" id="fu-reload">↻ Refresh list</button><label class="inline-check"><input type="checkbox" id="fu-all"> Select all ready</label><label class="inline-check"><input type="checkbox" id="fu-force"> Send even if sent recently</label><span class="muted small" id="fu-count"></span><span style="flex:1"></span><button type="button" class="btn btn-primary btn-sm" id="fu-send" disabled>Send selected</button></div>' +
      '<div class="fu-bar" id="fu-progwrap" hidden><div class="fu-prog" aria-hidden="true"><i id="fu-prog"></i></div><span class="small" id="fu-prog-text"></span></div>' +
      '<div class="table-wrap"><table class="tbl compact"><thead><tr><th scope="col"><span class="sr-only">Select</span></th><th scope="col">Supplier</th><th scope="col" class="r">Parts</th><th scope="col">Models</th><th scope="col">To</th><th scope="col" class="r">CC</th><th scope="col">Result</th><th scope="col"><span class="sr-only">Preview</span></th></tr></thead><tbody id="fu-body"><tr><td colspan="8" class="muted">Loading…</td></tr></tbody></table></div>';
    (head ? head.insertAdjacentElement("afterend", box) : follow.prepend(box));
    var $ = function (id) { return box.querySelector("#" + id); };
    var S = { data: null, models: [], selected: {}, edits: {}, results: {}, sending: false, ready: false, t: null };
    var keyOf = function (s) { return (s.supplierCode || "") + "|" + s.supplierName; };

    function query() {
      var q = new URLSearchParams();
      q.set("scope", $("fu-scope").value);
      if ($("fu-template").value) q.set("template", $("fu-template").value);
      if (S.models.length) q.set("models", S.models.join(","));
      if ($("fu-sender").value) q.set("sender", $("fu-sender").value);
      if (S.ready) { q.set("ccMid", $("fu-cc-mid").checked ? "1" : "0"); q.set("ccTop", $("fu-cc-top").checked ? "1" : "0"); q.set("ccBuyer", $("fu-cc-buyer").checked ? "1" : "0"); }
      if ($("fu-extra").value.trim()) q.set("extraCc", $("fu-extra").value.trim());
      return q.toString();
    }
    function fillControls(d) {
      var c = d.config;
      if (!S.ready) {
        $("fu-scope").value = c.statusScope; $("fu-cc-mid").checked = c.ccRoles.mid; $("fu-cc-top").checked = c.ccRoles.top; $("fu-cc-buyer").checked = c.ccRoles.buyer;
        $("fu-att-pdf").checked = c.attachments.pdf; $("fu-att-xlsx").checked = c.attachments.xlsx;
      }
      var tsel = $("fu-template"), cur = tsel.value || d.applied.templateId;
      tsel.innerHTML = c.templates.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>"; }).join("");
      tsel.value = c.templates.some(function (t) { return t.id === cur; }) ? cur : c.defaultTemplateId;
      var ssel = $("fu-sender"), scur = ssel.value;
      ssel.innerHTML = (d.senders && d.senders.length) ? d.senders.map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.name) + "</option>"; }).join("") : '<option value="">Default mailbox of the flow</option>';
      if (scur) ssel.value = scur;
      box.querySelector("#fu-req").innerHTML = c.requiredCc.length ? '<span class="muted small">Always on CC:</span> ' + c.requiredCc.map(function (e) { return '<span class="fu-chip lock" title="Set in Settings → Follow-up e-mail">🔒 ' + esc(e) + "</span>"; }).join("") : '<span class="muted small">No always-on CC (set one in Settings → Follow-up e-mail).</span>';
      var mbox = $("fu-models");
      mbox.innerHTML = d.models.map(function (m) { return '<button type="button" class="fu-chip" data-m="' + esc(m) + '" aria-pressed="' + (S.models.indexOf(m) >= 0) + '">' + esc(m) + "</button>"; }).join("") || '<span class="muted small">No models in the shared master yet.</span>';
      $("fu-models-hint").textContent = S.models.length ? "Only " + S.models.join(", ") + " will be chased." : "All models are included. Tap a model to chase only that one.";
      S.ready = true;
    }
    function resultText(k) {
      var r = S.results[k]; if (!r) return "";
      return '<span class="fu-res ' + r.kind + '">' + esc(r.text) + "</span>";
    }
    function render() {
      var d = S.data, body = $("fu-body"); if (!d) return;
      var list = d.suppliers;
      if (!list.length) { body.innerHTML = '<tr><td colspan="8" class="muted">No supplier has outstanding parts for this selection. 🎉</td></tr>'; $("fu-count").textContent = ""; $("fu-send").disabled = true; return; }
      body.innerHTML = list.map(function (s, i) {
        var k = keyOf(s), ok = s.emailReady;
        var to = ok ? esc(s.to.join("; ")) : '<span class="fu-res err">No PIC e-mail — add it in Directory</span>';
        var tag = s.recipientSource === "directory" ? ' <span class="muted small">(Directory)</span>' : "";
        return '<tr data-i="' + i + '"><td><input type="checkbox" class="fu-pick" aria-label="Select ' + esc(s.supplierName) + '"' + (S.selected[k] && ok ? " checked" : "") + (ok ? "" : " disabled") + "></td>" +
          "<th scope=\"row\">" + esc(s.supplierName) + '<div class="muted small">' + esc(s.supplierCode || "no code") + "</div></th>" +
          '<td class="r">' + s.partCount + "</td><td>" + esc(s.projects.join(", ") || "—") + '</td><td class="fu-mail" title="' + esc(s.to.join("; ")) + '">' + to + tag + '</td><td class="r">' + s.cc.length + "</td><td>" + resultText(k) + '</td><td><button type="button" class="btn btn-ghost btn-sm fu-prev">Preview</button></td></tr>';
      }).join("");
      var n = list.filter(function (s) { return S.selected[keyOf(s)] && s.emailReady; }).length;
      $("fu-count").textContent = n + " selected · " + list.filter(function (s) { return s.emailReady; }).length + " of " + list.length + " ready";
      $("fu-send").disabled = !n || S.sending || !d.configured;
      $("fu-send").title = d.configured ? "" : "E-mail sending is not configured (POWER_AUTOMATE_EMAIL_URL / POWER_AUTOMATE_SECRET).";
    }
    function stateBanner(d) {
      var st = $("fu-state"), total = d.suppliers.reduce(function (a, s) { return a + s.partCount; }, 0);
      st.textContent = d.suppliers.length + " supplier(s) · " + total.toLocaleString() + " outstanding part(s)" + (d.configured ? "" : " · E-mail sending is not configured yet (nothing can be sent).");
    }
    async function load() {
      window.clearTimeout(S.t);
      $("fu-body").innerHTML = '<tr><td colspan="8" class="muted">Loading…</td></tr>';
      try {
        var d = await api("/api/imds-master/followups?" + query());
        S.data = d; fillControls(d); stateBanner(d);
        S.selected = {}; d.suppliers.forEach(function (s) { if (s.emailReady) S.selected[keyOf(s)] = false; });
        $("fu-all").checked = false; render();
      } catch (e) { $("fu-state").textContent = e.message; $("fu-body").innerHTML = '<tr><td colspan="8" class="fu-res err">' + esc(e.message) + "</td></tr>"; }
    }
    function later() { window.clearTimeout(S.t); S.t = window.setTimeout(load, 450); }
    window.__imdsFollowReload = function () { S.ready = false; load(); };

    ["fu-scope", "fu-template", "fu-sender"].forEach(function (id) { $(id).onchange = load; });
    ["fu-cc-mid", "fu-cc-top", "fu-cc-buyer"].forEach(function (id) { $(id).onchange = load; });
    $("fu-extra").oninput = later;
    $("fu-reload").onclick = load;
    $("fu-models").onclick = function (e) {
      var b = e.target.closest && e.target.closest("button[data-m]"); if (!b) return;
      var m = b.getAttribute("data-m"), i = S.models.indexOf(m);
      if (i >= 0) S.models.splice(i, 1); else S.models.push(m);
      b.setAttribute("aria-pressed", String(i < 0));
      $("fu-models-hint").textContent = S.models.length ? "Only " + S.models.join(", ") + " will be chased." : "All models are included. Tap a model to chase only that one.";
      later();
    };
    $("fu-all").onchange = function () {
      var on = this.checked; (S.data ? S.data.suppliers : []).forEach(function (s) { if (s.emailReady) S.selected[keyOf(s)] = on; }); render();
    };
    $("fu-body").onchange = function (e) {
      if (!e.target.classList.contains("fu-pick")) return;
      var s = S.data.suppliers[Number(e.target.closest("tr").getAttribute("data-i"))]; S.selected[keyOf(s)] = e.target.checked; render();
    };
    $("fu-body").onclick = function (e) {
      var btn = e.target.closest && e.target.closest(".fu-prev"); if (!btn) return;
      var tr = btn.closest("tr"), next = tr.nextElementSibling;
      if (next && next.classList.contains("fu-det")) { next.remove(); return; }
      var s = S.data.suppliers[Number(tr.getAttribute("data-i"))], k = keyOf(s), ed = S.edits[k] || {};
      var det = document.createElement("tr"); det.className = "fu-det";
      det.innerHTML = '<td colspan="8"><div class="small"><b>To:</b> ' + esc(s.to.join("; ")) + "<br><b>CC:</b> " + esc(s.cc.join("; ") || "—") + (s.requiredCc.length ? ' <span class="muted">(always: ' + esc(s.requiredCc.join("; ")) + ")</span>" : "") +
        (s.warnings.length ? '<br><span class="fu-res skip">' + esc(s.warnings.join(" ")) + "</span>" : "") + '</div><label class="field" style="margin-top:8px"><span>Subject</span><input type="text" class="fu-sub"></label><label class="field"><span>Message (edit if needed — only for this supplier)</span><textarea class="fu-msg"></textarea></label>' +
        '<div class="muted small">Parts: ' + s.partCount + " · attachments follow the selection above.</div></td>";
      tr.after(det);
      var sub = det.querySelector(".fu-sub"), msg = det.querySelector(".fu-msg");
      sub.value = ed.subject != null ? ed.subject : s.subject; msg.value = ed.body != null ? ed.body : s.body;
      sub.oninput = function () { (S.edits[k] = S.edits[k] || {}).subject = sub.value; };
      msg.oninput = function () { (S.edits[k] = S.edits[k] || {}).body = msg.value; };
    };
    $("fu-send").onclick = async function () {
      if (S.sending || !S.data) return;
      var todo = S.data.suppliers.filter(function (s) { return S.selected[keyOf(s)] && s.emailReady; });
      if (!todo.length) return;
      var atts = [$("fu-att-pdf").checked ? "PDF" : "", $("fu-att-xlsx").checked ? "Excel" : ""].filter(Boolean).join(" + ") || "no attachment";
      if (!window.confirm("Send " + todo.length + " e-mail(s), one per supplier?\nAttachments: " + atts + "\nCC: " + ($("fu-cc-mid").checked ? "middle mgmt " : "") + ($("fu-cc-top").checked ? "top mgmt " : "") + ($("fu-cc-buyer").checked ? "buyer " : "") + (S.data.config.requiredCc.length ? "+ always-on CC" : "") + "\nThey go out through Power Automate from the chosen mailbox.")) return;
      S.sending = true; $("fu-send").disabled = true; $("fu-progwrap").hidden = false;
      var done = 0, ok = 0, skip = 0, fail = 0;
      for (var i = 0; i < todo.length; i++) {
        var s = todo[i], k = keyOf(s), ed = S.edits[k] || {};
        $("fu-prog-text").textContent = "Sending " + (i + 1) + " of " + todo.length + " — " + s.supplierName;
        S.results[k] = { kind: "skip", text: "Sending…" }; render();
        try {
          var r = await api("/api/imds-master/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            supplierCode: s.supplierCode, supplierName: s.supplierName, sender: $("fu-sender").value || undefined, force: $("fu-force").checked,
            models: S.models, scope: $("fu-scope").value, templateId: $("fu-template").value,
            roles: { mid: $("fu-cc-mid").checked, top: $("fu-cc-top").checked, buyer: $("fu-cc-buyer").checked }, extraCc: $("fu-extra").value.split(/[;,\s]+/).filter(Boolean),
            attachments: { pdf: $("fu-att-pdf").checked, xlsx: $("fu-att-xlsx").checked },
            subject: ed.subject || undefined, messageBody: ed.body || undefined }) });
          S.results[k] = { kind: "ok", text: "Handed to Power Automate" + (r.attachmentName ? " · " + r.attachmentName.split(", ").length + " file(s)" : "") }; ok++; S.selected[k] = false;
        } catch (e) {
          if (e.payload && e.payload.skipped === "RECENTLY_SENT") { S.results[k] = { kind: "skip", text: "Skipped — sent recently" }; skip++; }
          else { S.results[k] = { kind: "err", text: e.message }; fail++; }
        }
        done++; $("fu-prog").style.width = Math.round(done / todo.length * 100) + "%"; render();
      }
      S.sending = false; render();
      $("fu-prog-text").textContent = "Finished: " + ok + " handed to Power Automate · " + skip + " skipped · " + fail + " failed. “Handed over” means the flow accepted it; check the Outlook Sent items to confirm delivery.";
    };
    var seen = false;
    function maybeLoad() { if (!seen && !follow.hidden) { seen = true; load(); } }
    new MutationObserver(maybeLoad).observe(follow, { attributes: true, attributeFilter: ["hidden"] });
    maybeLoad();
  }

  // ---- Settings → Follow-up e-mail (templates, required CC, defaults) ----
  function initFollowupSettings(settings, after) {
    injectFollowCss();
    var sec = document.createElement("section");
    sec.className = "panel"; sec.id = "followup-settings-panel";
    sec.innerHTML = '<div class="panel-head"><div><h2>Follow-up e-mail</h2><p class="panel-sub">Templates, mandatory CC, default attachments. Saved on the server and used by everyone who sends follow-ups.</p></div></div>' +
      '<div id="fs-msg" class="banner" role="status">Loading…</div>' +
      '<div class="fu-grid"><label class="field"><span>Template</span><select id="fs-tsel"></select></label>' +
      '<div class="fu-bar" style="margin:0;align-self:end"><button type="button" class="btn btn-secondary btn-sm" id="fs-add">+ New</button><button type="button" class="btn btn-secondary btn-sm" id="fs-dup">Duplicate</button><button type="button" class="btn btn-ghost btn-sm" id="fs-del">Delete</button><button type="button" class="btn btn-ghost btn-sm" id="fs-def">Make default</button></div></div>' +
      '<div class="fu-box"><label class="field"><span>Template name</span><input type="text" id="fs-name" style="width:100%"></label><label class="field"><span>Subject</span><input type="text" id="fs-subj" style="width:100%"></label><label class="field"><span>Message</span><textarea id="fs-body" style="width:100%;min-height:220px;font:13px/1.45 ui-monospace,monospace"></textarea></label>' +
      '<p class="muted small" style="margin:6px 0 0">Placeholders: <code>{supplier}</code> <code>{code}</code> <code>{count}</code> <code>{models}</code> <code>{partlist}</code> <code>{sender}</code> <code>{date}</code></p></div>' +
      '<div class="fu-grid"><div class="fu-box"><h3>Mandatory CC (always added, cannot be switched off when sending)</h3><textarea id="fs-req" rows="3" style="width:100%" placeholder="one e-mail per line"></textarea></div>' +
      '<div class="fu-box"><h3>CC by default</h3><label class="inline-check"><input type="checkbox" id="fs-mid"> Middle management</label><br><label class="inline-check"><input type="checkbox" id="fs-top"> Top management</label><br><label class="inline-check"><input type="checkbox" id="fs-buyer"> PUD buyer</label></div>' +
      '<div class="fu-box"><h3>Attachments by default</h3><label class="inline-check"><input type="checkbox" id="fs-pdf"> PDF recap</label><br><label class="inline-check"><input type="checkbox" id="fs-xlsx"> Excel list of unsubmitted parts</label></div>' +
      '<div class="fu-box"><h3>Which parts by default</h3><select id="fs-scope" style="width:100%"><option value="action">Not submitted / rejected</option><option value="all">Everything not ACCEPTED</option></select><label class="field" style="margin-top:8px"><span>Max parts listed in the message body</span><input type="number" id="fs-max" min="0" max="100" style="width:100%"></label></div></div>' +
      '<div class="fu-bar"><button type="button" class="btn btn-primary btn-sm" id="fs-save">Save follow-up settings</button><span class="muted small" id="fs-ver"></span></div>';
    after.insertAdjacentElement("afterend", sec);
    var $ = function (id) { return sec.querySelector("#" + id); };
    var cfg = null, version = 0, cur = 0;
    function say(t, bad) { var m = $("fs-msg"); m.textContent = t; m.style.color = bad ? "#b91c1c" : ""; }
    function stash() {
      if (!cfg) return; var t = cfg.templates[cur]; if (!t) return;
      t.name = $("fs-name").value; t.subject = $("fs-subj").value; t.body = $("fs-body").value;
    }
    function fillList() { $("fs-tsel").innerHTML = cfg.templates.map(function (t, i) { return '<option value="' + i + '">' + esc(t.name) + (t.id === cfg.defaultTemplateId ? " (default)" : "") + "</option>"; }).join(""); $("fs-tsel").value = String(cur); }
    function fillTemplate() { var t = cfg.templates[cur]; $("fs-name").value = t.name; $("fs-subj").value = t.subject; $("fs-body").value = t.body; }
    function fillAll() {
      fillList(); fillTemplate();
      $("fs-req").value = cfg.requiredCc.join("\n"); $("fs-mid").checked = cfg.ccRoles.mid; $("fs-top").checked = cfg.ccRoles.top; $("fs-buyer").checked = cfg.ccRoles.buyer;
      $("fs-pdf").checked = cfg.attachments.pdf; $("fs-xlsx").checked = cfg.attachments.xlsx; $("fs-scope").value = cfg.statusScope; $("fs-max").value = cfg.maxPartsInBody;
      $("fs-ver").textContent = version ? "Version " + version : "Using built-in defaults (not saved yet)";
    }
    async function load() {
      try { var g = await api("/api/imds-master/settings?key=followup_config"); cfg = g.value; version = g.version; cur = Math.max(0, cfg.templates.findIndex(function (t) { return t.id === cfg.defaultTemplateId; })); fillAll(); say("Edit a template or the rules, then save."); }
      catch (e) { say(e.message, true); }
    }
    $("fs-tsel").onchange = function () { stash(); cur = Number($("fs-tsel").value); fillTemplate(); };
    ["fs-name"].forEach(function (id) { $(id).oninput = function () { stash(); var o = $("fs-tsel").options[cur]; if (o) o.textContent = $("fs-name").value + (cfg.templates[cur].id === cfg.defaultTemplateId ? " (default)" : ""); }; });
    $("fs-add").onclick = function () { stash(); cfg.templates.push({ id: "t" + Date.now().toString(36), name: "New template", subject: "IMDS follow-up | {supplier} | {count} part(s)", body: "Dear {supplier} Team,\n\n{partlist}\n\nBest regards,\n{sender}" }); cur = cfg.templates.length - 1; fillList(); fillTemplate(); };
    $("fs-dup").onclick = function () { stash(); var t = cfg.templates[cur]; cfg.templates.push({ id: "t" + Date.now().toString(36), name: t.name + " (copy)", subject: t.subject, body: t.body }); cur = cfg.templates.length - 1; fillList(); fillTemplate(); };
    $("fs-del").onclick = function () {
      if (cfg.templates.length < 2) { say("Keep at least one template.", true); return; }
      if (!window.confirm("Delete the template “" + cfg.templates[cur].name + "”?")) return;
      var gone = cfg.templates.splice(cur, 1)[0]; if (gone.id === cfg.defaultTemplateId) cfg.defaultTemplateId = cfg.templates[0].id; cur = 0; fillList(); fillTemplate();
    };
    $("fs-def").onclick = function () { stash(); cfg.defaultTemplateId = cfg.templates[cur].id; fillList(); say("“" + cfg.templates[cur].name + "” will be the default after you save."); };
    $("fs-save").onclick = async function () {
      stash();
      var req = $("fs-req").value.split(/[\n;,\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var bad = req.filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
      if (bad.length) { say("These are not valid e-mail addresses: " + bad.join(", "), true); return; }
      cfg.requiredCc = req; cfg.ccRoles = { mid: $("fs-mid").checked, top: $("fs-top").checked, buyer: $("fs-buyer").checked };
      cfg.attachments = { pdf: $("fs-pdf").checked, xlsx: $("fs-xlsx").checked }; cfg.statusScope = $("fs-scope").value; cfg.maxPartsInBody = Number($("fs-max").value) || 0;
      try {
        var r = await api("/api/imds-master/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "followup_config", value: cfg, baseVersion: version }) });
        version = r.version; say("Saved."); await load();
        if (typeof window.__imdsFollowReload === "function") window.__imdsFollowReload();
      } catch (e) { say(e.payload && e.payload.conflict ? e.message + " (Press F5 to reload.)" : e.message, true); }
    };
    load();
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