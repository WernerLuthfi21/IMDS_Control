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
    var openModels = new Set(records.filter(function (r) { return OPEN(r.status); }).map(function (r) { return r.model; }));
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
        "#imds-load{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:calc(100vw - 32px);z-index:9998;display:flex;align-items:center;gap:10px;padding:7px 14px;border-radius:999px;background:var(--surface,#fff);color:var(--ink,#1f2933);font:600 12px var(--f-ui,sans-serif);box-shadow:0 6px 24px rgba(40,20,80,.16);border:1px solid var(--line-strong,#e8e1f1);transition:opacity .4s}" +
        "#imds-load.ok{border-color:var(--ok)}#imds-load.err{border-color:var(--bad);color:var(--bad)}#imds-load.fade{opacity:0;pointer-events:none}" +
        "#imds-load button{border:1px solid var(--line-strong,#ddd);background:transparent;color:inherit;border-radius:8px;padding:2px 10px;cursor:pointer;font:inherit}";
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

  // Deep link from Judgement: /imds-tracker?supplier=<code or name> opens that supplier once the data is in.
  var deepLinked = false;
  function deepLinkOnce() {
    if (deepLinked) return; deepLinked = true;
    var params = new URLSearchParams(window.location.search);
    var q = (params.get("supplier") || "").trim().toUpperCase();
    if (params.get("from") === "tracker-migration") {
      // Preview handoff only. Filters and composer intent reuse the existing
      // UI handlers; a URL cannot download, send or commit anything.
      var model = params.get("model"), status = params.get("status"), urgency = params.get("urgency");
      setFilter({
        model: model && D.registry.has(model) && M.isVisible(model) ? model : "ALL",
        status: ["complete", "process", "missing", "rejected"].includes(status) ? status : "ALL",
        supplier: "ALL",
        urgency: ["pastdue", "due14", "ontime"].includes(urgency) ? urgency : "ALL",
        q: params.get("query") || ""
      });
      var action = params.get("action");
      if (action === "recap-email") { window.__imdsEmailRecap(); return; }
      if (action === "executive-report") {
        go("reports");
        window.setTimeout(function () { document.querySelector("#view-reports [data-action='pdf-summary']")?.focus(); }, 120);
        return;
      }
      if (q && action !== "supplier" && action !== "reminder") {
        var supplier = D.records.find(function (row) { return row.company.toUpperCase() === q; });
        if (supplier) setFilter({supplier:supplier.company});
        return;
      }
    }
    if (!q) return;
    var hit = (D.records || []).find(function (r) { return String(r.vendorCode || "").trim().toUpperCase() === q || String(r.company || "").trim().toUpperCase() === q; });
    if (hit && params.get("from") === "tracker-migration" && params.get("action") === "reminder") {
      window.__imdsEmailFor(hit.company, "followup");
      return;
    }
    if (!hit) { try { toast("Supplier " + q + " is not in the Tracker data.", "info"); } catch (e) { /* toast unavailable */ } return; }
    try { go("suppliers"); window.setTimeout(function () { openSupplier(hit.company); }, 120); } catch (e) { /* view not ready; the user can open it from Suppliers */ }
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
    window.setTimeout(deepLinkOnce, 0);
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

  // ---- Importing workbooks: shared by the Settings boxes and by dropping a file anywhere on the page ----
  var importing = false, panelNotify = null;
  function report(kind, text) { try { toast(text, kind === "err" ? "err" : kind === "ok" ? "ok" : "info"); } catch (e) { /* toast unavailable */ } if (panelNotify) panelNotify(kind, text); }
  function sleep(ms) { return new Promise(function (r) { window.setTimeout(r, ms); }); }
  function isNetworkError(e) { return e && (e.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(String(e.message))); }

  // The server may finish a long import even if the connection drops. Ask it before telling anyone it failed.
  async function importOutcome(kind, file, startedAt) {
    for (var i = 0; i < 12; i++) {
      try {
        var j = await api("/api/imds-master/parts?page=1&pageSize=1");
        var rec = kind === "master" ? j.latestMasterImport : j.latestMdsImport;
        if (rec && rec.file_name === file.name && new Date(rec.created_at).getTime() >= startedAt - 2000) return rec;
      } catch (e) { /* keep waiting */ }
      await sleep(4000);
    }
    return null;
  }

  async function importWorkbook(kind, file) {
    if (!file) return false;
    if (!/\.xlsx$/i.test(file.name)) { report("err", file.name + " is not an .xlsx workbook."); return false; }
    if (importing) { report("info", "Another file is still being imported. Please wait a moment."); return false; }
    importing = true;
    var startedAt = Date.now(), endpoint = kind === "master" ? "/api/imds-master/import-master" : "/api/imds-master/import-md-system";
    loadStatus("busy", "Importing " + file.name + "…");
    try {
      var j;
      try {
        if (file.size <= 3.5 * 1024 * 1024) {
          // Small files go straight to the server in one request: one step, nothing else that can fail.
          var form = new FormData(); form.append("file", file, file.name);
          j = await api(endpoint, { method: "POST", body: form });
        } else {
          var slot = await api("/api/imds-master/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size }) });
          if (!slot.signedUrl) throw new Error("The upload could not start. Sign in again and retry.");
          var fd = new FormData(); fd.append("cacheControl", "3600"); fd.append("", file);
          var up = null;
          for (var attempt = 0; attempt < 3 && !(up && up.ok); attempt++) {
            try { up = await fetch(slot.signedUrl, { method: "PUT", body: fd, headers: { "x-upsert": "false" } }); } catch (e) { if (attempt === 2) throw e; await sleep(1200); }
          }
          if (!up.ok) throw new Error("Upload to storage failed (HTTP " + up.status + ").");
          j = await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: slot.path, fileName: file.name }) });
        }
      } catch (e) {
        if (!isNetworkError(e) && !(e && /time limit|unexpected response/i.test(String(e.message)))) throw e;
        loadStatus("busy", "Connection interrupted — checking whether the server finished…");
        var rec = await importOutcome(kind, file, startedAt);
        if (!rec) throw new Error("The connection to the server was interrupted and the import could not be confirmed. Check your internet connection and try once more; nothing is imported twice.");
        j = null;
      }
      var text = j ? (kind === "master"
        ? "Master updated: " + (j.inserted || 0) + " new, " + (j.updated || 0) + " refreshed from " + (j.totalRows || 0) + " rows."
        : "MD System updated: " + (j.matchedSourceRows || 0) + " of " + (j.totalRows || 0) + " rows matched" + (j.autoStatusUpdated ? " · " + j.autoStatusUpdated + " status(es) changed" : "") + (j.unmatchedRows ? " · " + j.unmatchedRows + " not in the master" : "") + ".")
        : "Import finished on the server (" + file.name + ").";
      report("ok", text);
      loadStatus("ok", "Updated · loading the latest data…");
      refreshSharedMaster(false);
      if (typeof window.__imdsSmReload === "function") window.__imdsSmReload();
      window.setTimeout(autoSync, 800);          // push the changes to Excel right away
      return true;
    } catch (e) {
      report("err", (e && e.message ? e.message : "Import failed.") + " (" + file.name + ")");
      loadStatus("err", "Import failed");
      return false;
    } finally { importing = false; }
  }

  // Which of the two files is this? Sheet names are decisive; the file name is the fallback.
  async function detectKind(file) {
    try {
      if (window.XLSX && XLSX.read) {
        var wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", bookSheets: true });
        var names = (wb.SheetNames || []).map(function (n) { return String(n).toLowerCase(); });
        if (names.indexOf("export") >= 0) return "mds";
        if (names.indexOf("part list latest") >= 0) return "master";
        if (!names.length) return "mds";            // an empty search export: the server explains it
      }
    } catch (e) { /* fall back to the name */ }
    if (/searchresult|md.?system|inbox/i.test(file.name)) return "mds";
    if (/remaining|master|part.?list/i.test(file.name)) return "master";
    return null;
  }

  function initGlobalDrop() {
    var depth = 0, veil = null;
    function ensure() {
      if (veil) return veil;
      var st = document.createElement("style");
      st.textContent = "#imds-veil{position:fixed;inset:10px;z-index:9997;border:2px dashed rgba(139,92,246,.75);border-radius:18px;background:rgba(109,40,217,.07);display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .15s}#imds-veil.on{opacity:1}#imds-veil span{padding:8px 16px;border-radius:999px;background:var(--surface,#fff);color:inherit;font:600 13px var(--f-ui,sans-serif);box-shadow:0 6px 24px rgba(40,20,80,.18)}.drop-tip{color:var(--muted);font-size:12px;margin:10px 0 0}";
      document.head.appendChild(st);
      veil = document.createElement("div"); veil.id = "imds-veil"; veil.setAttribute("aria-hidden", "true"); veil.innerHTML = "<span>Drop the Excel file to update the data</span>";
      document.body.appendChild(veil); return veil;
    }
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }
    // The two boxes that handle their own files (Directory import, the local-file fallback).
    // The supplier drawer takes the supplier's clarification file itself (Tracker → Suppliers → a supplier).
    function own(t) { return t && t.closest && t.closest("#dir-drop,#dropzone,#supplier-drawer"); }
    // Around those boxes a drop must neither open the file in the browser nor import it: drop on the box.
    function near(t) { return t && t.closest && t.closest("#dir-import,section[aria-labelledby='h-source']"); }
    var idle = 0;
    function clearZones() { Array.prototype.forEach.call(document.querySelectorAll("[data-kind].drag"), function (x) { x.classList.remove("drag"); }); }
    function hideSoon() { clearTimeout(idle); idle = setTimeout(function () { depth = 0; if (veil) veil.classList.remove("on"); clearZones(); }, 450); }
    document.addEventListener("dragenter", function (e) { if (!hasFiles(e) || own(e.target) || near(e.target)) return; e.preventDefault(); depth++; ensure().classList.add("on"); hideSoon(); });
    document.addEventListener("dragover", function (e) {
      if (!hasFiles(e) || own(e.target)) return;
      e.preventDefault();
      if (near(e.target)) { if (e.dataTransfer) e.dataTransfer.dropEffect = "none"; if (veil) veil.classList.remove("on"); return; }
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; ensure().classList.add("on"); hideSoon();
      var z = e.target.closest && e.target.closest("[data-kind]");
      Array.prototype.forEach.call(document.querySelectorAll("[data-kind].drag"), function (x) { if (x !== z) x.classList.remove("drag"); });
      if (z) z.classList.add("drag");
    });
    document.addEventListener("dragleave", function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth && veil) veil.classList.remove("on"); });
    document.addEventListener("dragend", function () { depth = 0; if (veil) veil.classList.remove("on"); });
    document.addEventListener("drop", async function (e) {
      if (!hasFiles(e) || own(e.target)) return;
      e.preventDefault(); depth = 0; if (veil) veil.classList.remove("on"); clearZones();
      if (near(e.target)) { report("err", "Drop the file on the box itself."); return; }
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      var zone = e.target.closest && e.target.closest("[data-kind]"), forced = zone ? zone.getAttribute("data-kind") : null;
      var jobs = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!/\.xlsx$/i.test(f.name)) { report("err", f.name + " is not an .xlsx workbook."); continue; }
        var k = forced || await detectKind(f);
        if (!k) { report("err", "Could not tell what " + f.name + " is. Drop it on one of the two boxes in Settings."); continue; }
        jobs.push({ kind: k, file: f });
      }
      jobs.sort(function (a, b) { return (a.kind === "master" ? 0 : 1) - (b.kind === "master" ? 0 : 1); });   // master first, then MD System
      for (var j = 0; j < jobs.length; j++) await importWorkbook(jobs[j].kind, jobs[j].file);
    });
    // A faint hint on the Overview; invisible unless you look for it.
    var hero = document.querySelector(".hero");
    if (hero && !hero.querySelector(".drop-tip")) { ensure(); var tip = document.createElement("p"); tip.className = "drop-tip"; tip.textContent = "Tip: drop an updated Excel file anywhere on this page to update the data."; (hero.querySelector(".hero-copy") || hero).appendChild(tip); }
  }

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
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px;margin:12px 0">' +
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
    var msg = panel.querySelector("#sm-msg");
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
        panel.querySelector("#sm-sync").textContent = (s.configured ? "Excel sync via Power Automate" : "Excel sync not configured (updates stay safely queued)") + " · " + s.queue.pending + " waiting / " + s.queue.failed + " failed / " + s.queue.sent + " handed to the flow (check its Run history)";
      } catch (e) { panel.querySelector("#sm-sync").textContent = "Excel sync: " + e.message; }
    }
    panelNotify = say;
    async function run(kind, file) { await importWorkbook(kind, file); loadState(); }
    Array.prototype.forEach.call(panel.querySelectorAll("label.dropzone"), function (lab) {
      var kind = lab.getAttribute("data-kind"), input = lab.querySelector("input");
      input.onchange = function () { run(kind, input.files && input.files[0]); input.value = ""; };
    });
    panel.querySelector("#sm-refresh").onclick = function () { refreshSharedMaster(false); loadState(); };
    panel.querySelector("#sm-sync-now").onclick = async function () {
      try { var r = await api("/api/imds-master/sync", { method: "POST" }); say(r.failed ? "err" : "ok", r.configured ? "Excel sync: " + r.sent + " batch(es) handed to the flow, " + r.failed + " failed, " + r.pending + " waiting. Excel changes within a minute; if not, open the flow's Run history." : "Excel sync is not configured yet. " + r.pending + " update batch(es) remain safely queued."); loadState(); }
      catch (e) { say("err", e.message); }
    };
    window.__imdsSmReload = loadState;
    loadState();

    initFollowupCenter(follow);
    initFollowupSettings(follow, follow.querySelector("#shared-followup-panel"));
    if (location.hash === "#followup" && new URLSearchParams(location.search).get("section") === "templates") { var templateTab = follow.querySelector('[data-fmode="templates"]'); if (templateTab) templateTab.click(); }
    initWorkspaceSettingsTabs(settings, panel, legacy);
  }


  // UI-only navigation. Move existing DOM nodes, never recreate forms or change save handlers.
  function compactTabs(host, items, label, onSelect, selected) {
    var nav = document.createElement("div"); nav.className = "seg compact-workspace-tabs"; nav.setAttribute("role", "group"); nav.setAttribute("aria-label", label);
    var buttons = items.map(function (item) {
      var b = document.createElement("button"); b.type = "button"; b.className = "seg-btn"; b.textContent = item[1];
      b.setAttribute("aria-controls", item[2].id); nav.appendChild(b);
      b.onclick = function () { select(item[0]); }; return b;
    });
    function select(key) {
      items.forEach(function (item, i) { var on = item[0] === key; item[2].hidden = !on; buttons[i].classList.toggle("on", on); buttons[i].setAttribute("aria-pressed", String(on)); });
      if (onSelect) onSelect(key);
    }
    host.insertAdjacentElement("afterend", nav); select(selected || items[0][0]); return select;
  }
  function initWorkspaceSettingsTabs(settings, shared, legacy) {
    if (settings.querySelector(".compact-workspace-tabs")) return;
    var head = settings.querySelector("header.view-head"), model = settings.querySelector("#settings-models"), appearance = settings.querySelector('[aria-labelledby="h-appearance"]');
    if (!head || !model || !appearance) return;
    var legacyToggle = settings.querySelector("#sm-legacy");
    function pane(id, nodes) { var p = document.createElement("div"); p.id = id; p.className = "compact-workspace-pane"; settings.appendChild(p); nodes.forEach(function(n){if(n)p.appendChild(n);}); return p; }
    var data = pane("settings-data-pane", [shared, legacyToggle && legacyToggle.parentElement, legacy]);
    var models = pane("settings-models-pane", [model]);
    var empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "Connect or upload the shared master in Data source to configure models."; models.prepend(empty);
    var observer = new MutationObserver(function(){empty.hidden = !model.hidden;}); observer.observe(model,{attributes:true,attributeFilter:["hidden"]}); empty.hidden = !model.hidden;
    var app = pane("settings-appearance-pane", [appearance]);
    var link = document.createElement("p"); link.className = "muted"; link.textContent = "Email templates, defaults and sending rules are now in Follow-up → Templates & rules."; app.appendChild(link);
    var search = document.createElement("input"); search.type = "search"; search.className = "field compact-model-search"; search.placeholder = "Find a model…"; search.setAttribute("aria-label","Find a model");
    model.querySelector(".panel-head").after(search);
    var body = model.querySelector("#model-config-tbody");
    function filter() { var q = search.value.trim().toLowerCase(); Array.prototype.forEach.call(body.rows,function(row){row.hidden = !!q && !row.cells[0].textContent.toLowerCase().includes(q);}); }
    search.addEventListener("input",filter); new MutationObserver(filter).observe(body,{childList:true});
    var requested = new URLSearchParams(location.search).get("section");
    var select = compactTabs(head,[["data","Data source",data],["models","Models & display",models],["appearance","Appearance",app]],"Tracker settings sections",null,requested==="models"?"models":"data");
    // Existing Settings entry remains available; deep link can open model controls directly.
    window.addEventListener("hashchange",function(){if(location.hash==="#settings" && new URLSearchParams(location.search).get("section")==="models")select("models");});
  }
  function initTemplateWorkspaceTabs(sec) {
    var head = sec.querySelector(".panel-head"), body = sec.querySelector("#fs-body"), cc = sec.querySelector("#fs-req"), sig = sec.querySelector("#fs-sig"), footer = sec.querySelector("#fs-foot"), picker = sec.querySelector("#fs-tsel"), save = sec.querySelector("#fs-save");
    if(!head || !body || !cc || !sig || !footer || !picker || !save)return;
    var pickerGrid=picker.closest(".fu-grid"), editor=body.closest(".fu-box"), rules=cc.closest(".fu-grid"), signature=sig.closest(".fu-grid"), format=footer.closest(".fu-box").parentElement, bar=save.closest(".fu-bar");
    function pane(id,nodes){var p=document.createElement("div");p.id=id;p.className="compact-workspace-pane";sec.insertBefore(p,bar);nodes.forEach(function(n){p.appendChild(n);});return p;}
    var preview=sec.querySelector("#fs-prev"); var previewBox=document.createElement("div");previewBox.className="fu-box compact-template-preview";var title=document.createElement("h3");title.textContent="Live preview · sample data";previewBox.appendChild(title);previewBox.appendChild(preview);
    var split=document.createElement("div");split.className="compact-template-split";split.appendChild(editor);split.appendChild(previewBox);
    body.style.minHeight="200px";
    var edit=pane("fs-edit-pane",[pickerGrid,split]); var defaults=pane("fs-rules-pane",[rules]); var identity=pane("fs-identity-pane",[signature,format]);
    compactTabs(head,[["edit","Edit template",edit],["rules","Recipients & files",defaults],["identity","Signature & layout",identity]],"Email template sections",null,"edit");
    bar.classList.add("compact-save-bar");
  }

  // ---- Directory: saved on the server, so contacts follow the user to every browser ----
  var dirSync = { version: 0, timer: null, busy: false, again: false, applying: false, blocked: false };
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function dirPayload() { return { v: 1, entries: DIR.entries, buyers: DIR.buyers, aliases: DIR.aliases, meta: DIR.meta }; }
  function dirStatus(text, bad) {
    var tools = document.getElementById("dir-tools"), n = document.getElementById("dir-sync");
    if (!n && tools) { n = document.createElement("span"); n.id = "dir-sync"; n.className = "muted small"; n.setAttribute("role", "status"); n.style.alignSelf = "center"; tools.prepend(n); }
    if (n) { n.textContent = text; n.style.color = bad ? "var(--bad)" : ""; }
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

  // ---- Built-in PUD buyer identities (e-mail only; never overwrites what the user typed) ----
  var BUYER_SEED = {
    Puguh: "wahyu.bakhtiar@toyota.co.id", Luthfy: "ahmad.syofyan@toyota.co.id", Omen: "Fathurohman@toyota.co.id",
    Irman: "irman.firmansyah@toyota.co.id", Taris: "adabina.ladiva@toyota.co.id", Liza: "elizabeth.listya@toyota.co.id",
    Aries: "aries.fredi@toyota.co.id", Bangun: "arif.santoso@toyota.co.id", Fifi: "anindya.darmawan@toyota.co.id",
    Regia: "regia.erfawinanda@toyota.co.id"
  };
  function seedBuyers() {
    try {
      var changed = 0;
      DIR.buyers = DIR.buyers || {};
      Object.keys(BUYER_SEED).forEach(function (k) {
        var hit = Object.keys(DIR.buyers).filter(function (x) { return x.trim().toLowerCase() === k.toLowerCase(); })[0] || k;
        var b = DIR.buyers[hit] || (DIR.buyers[hit] = {});
        if (!b.email) { b.email = BUYER_SEED[k].toLowerCase(); changed++; }
      });
      if (changed) { saveDir(); try { renderAll(); } catch (e) { /* re-renders on navigation */ } }
    } catch (e) { /* seed is best-effort */ }
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
    st.textContent = ".mk{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:10px;margin:6px 0 14px}.mk button{text-align:left;border:1px solid var(--line-strong,#d5d0e0);background:var(--surface,#fff);color:inherit;border-radius:12px;padding:10px 14px;cursor:pointer;font:inherit}.mk button b{display:block;font-size:14px}.mk button span{font-size:12px;color:var(--muted,#6b7280)}.mk button[aria-pressed=true]{border-color:#6d28d9;box-shadow:0 0 0 2px rgba(109,40,217,.25);background:rgba(109,40,217,.08)}" +
      ".mh{display:flex;align-items:center;gap:8px;margin:16px 0 6px;font-size:13px;font-weight:700}.mh i{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#6d28d9;color:#fff;font:700 11px var(--f-ui,sans-serif);font-style:normal}" +
      ".fu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px;margin:8px 0}.fu-grid .field span{display:block;font-size:12px;font-weight:600;margin-bottom:4px}.fu-grid select,.fu-grid input[type=text],.fu-grid textarea{width:100%}" +
      ".fu-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.fu-chip{border:1px solid var(--line-strong,#d5d0e0);background:var(--surface,#fff);border-radius:999px;padding:3px 11px;font:600 12px var(--f-ui,sans-serif);cursor:pointer;color:inherit}.fu-chip[aria-pressed=true]{background:#6d28d9;border-color:#6d28d9;color:#fff}.fu-chip.lock{background:transparent;border-style:dashed;cursor:default;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".fs-preview{border:1px solid var(--line,#e8e1f1);border-radius:10px;padding:12px 14px;max-height:340px;overflow:auto;background:var(--surface,var(--card,transparent));color:var(--ink,inherit);line-height:1.35;overflow-wrap:anywhere}.fs-preview p{margin:0 0 10px}.fs-preview ul,.fs-preview ol{margin:0 0 10px;padding-left:22px}.fs-preview a{color:var(--accent,inherit)}" +
      ".fu-box{border:1px solid var(--line,#e8e1f1);border-radius:12px;padding:12px}.fu-box h3{font-size:13px;margin:0 0 6px}.fu-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}.fu-prog{height:6px;border-radius:99px;background:rgba(127,127,127,.25);overflow:hidden;flex:1;min-width:140px}.fu-prog i{display:block;height:100%;width:0;background:#6d28d9;transition:width .25s}" +
      ".fu-mail{max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fu-to1{font-weight:600}.fu-more{display:inline-block;padding:0 6px;border-radius:99px;background:var(--neutral-soft,rgba(127,127,127,.15));color:var(--muted);font-size:12px;font-weight:600}" +
      ".fu-tagx{display:inline-block;margin-left:4px;padding:1px 7px;border-radius:99px;border:1px solid var(--line-strong,#ddd);color:var(--muted);font-size:11px;font-weight:600;vertical-align:1px}.fu-tagx.mid{border-color:var(--warn,#9a5a08);color:var(--warn-ink,#865008);background:var(--warn-soft,#fbf0dc)}" +
      ".lib-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}.lib-list li{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid var(--line,#e8e1f1);border-radius:8px}.lib-name{display:flex;flex-direction:column;min-width:0;overflow-wrap:anywhere}.lib-act{display:flex;gap:10px;font-size:13px}.lib-add{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}" +
      ".au-top{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:flex-start;margin-bottom:10px}.au-h2{font-size:18px;margin:0}.au-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr));gap:12px;margin:12px 0}" +
      ".au-card{border:1px solid var(--line,#e8e1f1);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--surface)}.au-card.on{border-color:var(--violet,#7c3aed);box-shadow:inset 3px 0 0 var(--violet,#7c3aed)}.au-card-h{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.au-card-b{display:flex;flex-direction:column;gap:4px;font-size:13px}.au-card-a{display:flex;flex-wrap:wrap;gap:6px}" +
      ".au-pill{font-size:11px;font-weight:700;padding:1px 8px;border-radius:99px}.au-pill.on{background:var(--ok-soft,#e4f4eb);color:var(--ok-ink,#126b42)}.au-pill.off{background:var(--neutral-soft,rgba(127,127,127,.15));color:var(--muted)}.au-empty{display:flex;flex-direction:column;gap:4px;padding:16px;border:1px dashed var(--line-strong,#ccc);border-radius:12px}" +
      ".au-edit{border:1px solid var(--line-strong,#ddd);border-radius:12px;padding:14px;margin:12px 0;background:var(--surface-2,transparent)}.au-edit-h{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}.au-edit-h h3{margin:0;font-size:16px}.au-edit input[type=number],.au-edit input[type=date],.au-edit input[type=text]{width:100%;min-height:38px;padding:0 10px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit}" +
      ".au-edit-bar{position:sticky;bottom:0;background:var(--surface-2,var(--surface));padding:8px 0;border-top:1px solid var(--line)}.au-files{margin:12px 0}.au-planbox{margin:12px 0}.au-plan-h{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}.au-plan-h h3{margin:0}" +
      ".au-stats{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px;color:var(--muted);margin-top:4px}.au-stats b{color:var(--ink)}" +
      ".au-split{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:12px;margin-top:10px;align-items:start}.au-side{position:sticky;top:72px}.au-pick{display:none}" +
      ".au-sup{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;max-height:min(62vh,560px);overflow:auto;border:1px solid var(--line,#e8e1f1);border-radius:10px;padding:4px}" +
      ".au-sup button{all:unset;box-sizing:border-box;width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;padding:8px 10px;border-radius:8px;cursor:pointer}.au-sup button:hover{background:var(--surface-2,rgba(127,127,127,.06))}.au-sup button[aria-selected=true]{background:var(--lilac);box-shadow:inset 3px 0 0 var(--violet,#7c3aed)}.au-sup button:focus-visible{outline:2px solid var(--focus,#6d28d9);outline-offset:1px}" +
      ".au-sup-n{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.au-sup-m{grid-column:1/-1;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".au-st{font-size:11px;font-weight:700;padding:1px 7px;border-radius:99px;white-space:nowrap;align-self:start}.au-st.go{background:var(--lilac);color:var(--brand-text)}.au-st.ok{background:var(--ok-soft,#e4f4eb);color:var(--ok-ink,#126b42)}.au-st.held{background:var(--warn-soft,#fbf0dc);color:var(--warn-ink,#865008)}.au-st.err{background:var(--bad-soft,#fde8ec);color:var(--bad,#c62840)}" +
      ".au-detail{border:1px solid var(--line,#e8e1f1);border-radius:10px;padding:12px 14px;background:var(--surface);min-width:0}.au-nav{display:flex;justify-content:space-between;align-items:center;margin:-4px 0 8px}" +
      ".au-detail .au-body{max-height:min(52vh,520px);overflow:auto}.au-cc summary{cursor:pointer;color:var(--brand-text);font-weight:600}.au-cc{overflow-wrap:anywhere}.au-files-l{display:flex;flex-wrap:wrap;gap:4px 8px}.au-file{display:inline-block;padding:1px 8px;border-radius:99px;background:var(--surface-2,rgba(127,127,127,.08));border:1px solid var(--line);font-size:12px;overflow-wrap:anywhere}" +
      "@media (max-width:860px){.au-split{grid-template-columns:1fr}.au-side{position:static}.au-sup{display:none}.au-pick{display:block}.au-pick select{width:100%;min-height:40px}.au-mh{grid-template-columns:70px minmax(0,1fr)}}" +
      ".au-mailcard{margin-top:12px}.au-mh{display:grid;grid-template-columns:80px minmax(0,1fr);gap:4px 10px;font-size:13px;margin-bottom:10px}.au-mh span{color:var(--muted);font-weight:600}.au-mh b{font-weight:500;overflow-wrap:anywhere}.au-body{max-height:none}" +
      ".fu-attf{display:flex;gap:8px;align-items:flex-start;margin-top:2px}.fu-attf>span{display:flex;flex-direction:column;gap:2px;min-width:0}" +
      ".sc-planbox .fu-mail{max-width:300px;white-space:normal;overflow-wrap:anywhere}.sc-grid input[type=number]{width:100%;min-height:38px;padding:0 10px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit}" +
      ".sc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px;margin:10px 0}.sc-switch{display:flex;gap:8px;align-items:center;margin:0 0 10px}.sc-days{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.sc-models{margin-top:10px}" +
      ".sc-ready{display:flex;flex-wrap:wrap;gap:8px 18px;padding:10px 12px;border-radius:10px;background:var(--surface-2,rgba(127,127,127,.06));border:1px solid var(--line,#e8e1f1);font-size:13px}.sc-r.ok{color:var(--ok-ink,#126B42);font-weight:600}.sc-r.no{color:var(--bad,#C62840);font-weight:600}.sc-h{font-size:13px;margin:14px 0 6px}.sc-planbox{margin:10px 0}" +
      ".fu-ccs{display:grid;gap:6px}.fu-ccs .inline-check{display:flex;flex-wrap:wrap;gap:2px 6px;align-items:baseline}" +
      ".fu-res.ok{color:var(--ok-ink,#126B42);font-weight:600}.fu-res.err{color:var(--bad,#C62840);font-weight:600}.fu-res.held{color:var(--warn-ink,#865008);font-weight:600}.fu-det td{background:rgba(127,127,127,.08)}.fu-det textarea{width:100%;font:13px/1.45 ui-monospace,monospace;min-height:240px}.fu-det input[type=text]{width:100%}.fu-mail{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fu-only{display:inline-flex;gap:6px;align-items:center}" +
      ".fu-sql{width:100%;min-height:150px;font:12px/1.4 ui-monospace,monospace}" +
      ".fu-signs{display:block;margin-top:4px;font-size:12px}.mk button{position:relative}.fu-tag{position:absolute;top:10px;right:12px;font:700 10px/1 var(--f-ui,sans-serif);letter-spacing:.06em;text-transform:uppercase;font-style:normal;padding:4px 7px;border-radius:99px;background:rgba(127,127,127,.14);color:var(--muted,#6b7280)}.fu-tag.l{background:rgba(198,40,64,.12);color:var(--bad,#C62840)}.fu-tag.t{background:rgba(18,107,66,.12);color:var(--ok-ink,#126B42)}" +
      ".fu-adv{border:1px solid var(--line,#e8e1f1);border-radius:12px;padding:10px 14px;margin:4px 0 8px}.fu-adv>summary{cursor:pointer;font-weight:600;font-size:13px}.fu-adv[open]>summary{margin-bottom:6px}#fu-testto-wrap{max-width:440px}.fu-checks{display:flex;flex-direction:column;gap:6px;justify-content:end}.fu-tools{margin:6px 0}" +
      ".fu-dock{position:sticky;bottom:12px;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:14px 0 0;padding:12px 14px;border-radius:14px;border:1px solid var(--line-strong,#d5d0e0);background:var(--surface,#fff);box-shadow:0 10px 30px rgba(30,20,60,.14)}.fu-dock.live{border-color:var(--bad,#C62840)}.fu-dock-text{flex:1;min-width:200px;display:flex;flex-direction:column;gap:2px}.fu-dock-text b{font-size:14px}.fu-progrow{flex-basis:100%;display:flex;gap:10px;align-items:center}" +
      ".btn.fu-live{background:var(--bad,#C62840);border-color:var(--bad,#C62840);color:#fff}" +
      ".fu-mailcard{max-width:860px;margin:4px auto;padding:14px 16px;border-radius:12px;background:var(--surface,#fff);border:1px solid var(--line,#e8e1f1)}.fu-hdr{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 10px;font-size:13px}.fu-hdr dt{color:var(--muted,#6b7280);font-weight:600}.fu-hdr dd{margin:0;overflow-wrap:anywhere}.fu-hdr summary{cursor:pointer}.fu-file{display:inline-block;padding:2px 8px;border-radius:6px;background:rgba(109,40,217,.08);font-size:12px;margin:0 4px 2px 0}.fu-file::before{content:\"\\1F4CE \"}" +
      ".fu-det .fu-mailcard textarea{min-height:200px;resize:vertical;overflow:auto}.fu-note{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:rgba(18,107,66,.08);font-size:13px}.fu-note.live{background:rgba(198,40,64,.08)}" +
      ".fu-done{display:flex;gap:12px;align-items:flex-start;margin:12px 0 0;padding:14px 16px;border-radius:14px;border:1px solid var(--line,#e8e1f1)}.fu-done.ok{background:rgba(18,107,66,.07);border-color:rgba(18,107,66,.35)}.fu-done.mixed{background:rgba(134,80,8,.07)}.fu-done.bad{background:rgba(198,40,64,.07)}.fu-done-ic{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:50%;font-weight:800;color:#fff;background:var(--ok-ink,#126B42)}.fu-done.mixed .fu-done-ic{background:var(--warn-ink,#865008)}.fu-done.bad .fu-done-ic{background:var(--bad,#C62840)}.fu-done-n{display:flex;flex-wrap:wrap;gap:12px;margin-top:4px;font-size:13px}.fu-done-n .ok{color:var(--ok-ink,#126B42);font-weight:700}.fu-done-n .bad{color:var(--bad,#C62840);font-weight:700}" +
      "@media (prefers-reduced-motion:no-preference){.fu-done.ok .fu-done-ic{animation:fuPop .45s cubic-bezier(.2,1.6,.4,1)}@keyframes fuPop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}}" +
      ".fu-dlg{border:none;border-radius:16px;padding:20px;max-width:min(560px,calc(100vw - 32px));background:var(--surface,#fff);color:inherit;box-shadow:0 24px 60px rgba(0,0,0,.3)}.fu-dlg::backdrop{background:rgba(20,14,40,.45)}.fu-dlg h3{margin:0 0 10px;font-size:17px}.fu-list{margin:8px 0;padding-left:18px;max-height:240px;overflow:auto;font-size:13px}.fu-list li{margin:3px 0}" +
      ".fu-grid .field small.fu-signs{text-transform:none;letter-spacing:0;font-weight:500}.fu-det .fu-mailcard textarea{font:14px/1.55 var(--f-ui,system-ui,sans-serif)}" +
      "@media (max-width:760px){#shared-followup-panel .table-wrap{overflow:visible}#shared-followup-panel .table-wrap table,#fu-body{display:block;width:100%}#fu-head{display:none}" +
      "#fu-body tr{display:grid;grid-template-columns:28px 1fr auto;gap:2px 10px;padding:12px 2px;border-bottom:1px solid var(--line,#e8e1f1)}#fu-body tr>*{display:block;border:0;padding:0;text-align:left;grid-column:2;font-size:13px}" +
      "#fu-body tr>td:first-child{grid-column:1;grid-row:1 / span 6}#fu-body tr>td:last-child{grid-column:3;grid-row:1}#fu-body tr>th{font-size:14px}#fu-body tr>td:only-child{grid-column:1 / -1;grid-row:auto}" +
      "#fu-body tr>td:nth-child(3)::before{content:\"Parts: \";color:var(--muted)}#fu-body tr>td:nth-child(4)::before{content:\"Models: \";color:var(--muted)}#fu-body tr>td:nth-child(6)::before{content:\"CC: \";color:var(--muted)}#fu-body tr>td:nth-child(7)::before{content:\"Last e-mailed: \";color:var(--muted)}" +
      "#fu-body .fu-mail{max-width:none;white-space:normal;overflow-wrap:anywhere}#fu-body tr.fu-det{display:block;padding:0}#fu-body tr.fu-det>td{display:block}.fu-mailcard{padding:12px}}";
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
  function fill(tpl, ctx) { return String(tpl || "").replace(/\{(supplier|code|count|projects|deadlines|partlist|models|modelshort|sender|sendername|greeting|date|updated|duedate)\}/g, function (m, k) { return ctx[k] == null ? "" : ctx[k]; }); }
  // Footer per sender + e-mail font (Follow-up → Templates & rules). Same rules as lib/followup/center.ts (footerFor, cleanFont).
  var FONT_FAMILIES = ["Calibri", "Arial", "Segoe UI", "Verdana", "Tahoma", "Aptos", "Times New Roman"];
  function ownFooter(cfg, who) { var o = (cfg && cfg.senderFooters) || {}, w = String(who || "").trim().toLowerCase(); var k = w ? Object.keys(o).filter(function (x) { return x.toLowerCase() === w; })[0] : null; return k && String(o[k]).trim() ? o[k] : ""; }
  function footerOf(cfg, who) { return ownFooter(cfg, who) || (cfg && cfg.signature != null ? cfg.signature : ""); }
  function fontLabel(cfg) { var f = (cfg && cfg.font) || {}; return (f.family || "Calibri") + " " + (f.sizePt || 11) + " pt"; }
  // Preview only; the e-mail itself is rendered on the server by lib/followup/payload.ts toHtml with the same rules.
  function previewHtml(text) {
    return String(text).replace(/\r\n|\r/g, "\n").split(/\n{2,}/).map(function (b) { return b.replace(/^\n+|\n+$/g, ""); }).filter(Boolean).map(function (b) {
      var lines = b.split("\n"), link = function (t) { return esc(t).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:)]/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + "</a>"; }); };
      if (lines.length === 1 && /^[A-Z0-9 &/()-]{6,60}$/.test(lines[0].trim()) && /[A-Z]{3}/.test(lines[0])) return "<p><b>" + esc(lines[0].trim()) + "</b></p>";
      var kindOf = function (l) { return /^\s*\d+[.)]\s+/.test(l) ? "ol" : /^\s*[•\-*]\s+/.test(l) ? "ul" : "p"; }, runs = [];
      lines.forEach(function (l) { var k = kindOf(l); if (runs.length && runs[runs.length - 1].kind === k) runs[runs.length - 1].lines.push(l); else runs.push({ kind: k, lines: [l] }); });
      return runs.map(function (r) { return r.kind === "p" ? "<p>" + r.lines.map(link).join("<br>") + "</p>" : "<" + r.kind + ">" + r.lines.map(function (l) { return "<li>" + link(l.replace(/^\s*([•\-*]|\d+[.)])\s+/, "")) + "</li>"; }).join("") + "</" + r.kind + ">"; }).join("");
    }).join("");
  }
  function partLines(kind, parts, include) {
    if (!include) return "(please see the attached file)";
    return parts.map(function (r, i) {
      if (kind === "request") return (i + 1) + ". " + r.partNo + " — " + (r.partName || "") + (r.targetDate ? " — Target Date: " + datePretty(r.targetDate) : "") + (r.status === "rejected" ? " — REJECTED, please resubmit" : "") + (r.pastDue ? " — PAST DUE" : "");
      return (i + 1) + ". " + r.partNo + " — " + (r.partName || "(part name not on file)") + (r.status === "rejected" ? " — REJECTED, please resubmit" : "") + (r.pastDue ? " — PAST DUE" : "");
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
    if (actions) actions.innerHTML = '<div class="seg" role="group" aria-label="Follow-up view"><button type="button" class="seg-btn on" data-fmode="queues" aria-pressed="true">Needs follow-up</button><button type="button" class="seg-btn" data-fmode="email" aria-pressed="false">Compose email</button><button type="button" class="seg-btn" data-fmode="auto" aria-pressed="false">Automatic</button><button type="button" class="seg-btn" data-fmode="templates" aria-pressed="false">Templates &amp; rules</button><a class="btn btn-ghost btn-sm" href="/follow-up?channel=whatsapp">WhatsApp drafts ↗</a></div>';
    var box = document.createElement("section");
    box.className = "panel"; box.id = "shared-followup-panel"; box.hidden = true;
    box.innerHTML = '<div id="fu-state" class="banner" role="status">Loading…</div>' +
      '<div class="mh"><i>1</i>What do you want to send?</div><div class="mk" id="fu-kinds" role="group" aria-label="Type of e-mail"></div>' +
      '<div class="mh"><i>2</i>Which parts and which models?</div><div class="fu-grid">' +
      '<label class="field"><span>Parts to include</span><select id="fu-scope"><option value="open">Not submitted yet or rejected (supplier must act)</option><option value="notdone">Everything not accepted yet (includes TMMIN working)</option></select></label>' +
      '<div class="fu-box"><h3>Models</h3><div class="fu-chips" id="fu-models" role="group" aria-label="Models"></div><p class="muted small" id="fu-models-hint" style="margin:4px 0 0"></p></div></div>' +
      '<div class="mh"><i>3</i>Message</div><div class="fu-grid">' +
      '<label class="field"><span>Template <span class="muted" id="fu-tdef"></span></span><select id="fu-template"></select></label>' +
      '<label class="field"><span>Sender</span><select id="fu-sender"></select><small class="muted fu-signs" id="fu-signs"></small></label>' +
      '<label class="inline-check" style="align-self:end"><input type="checkbox" id="fu-list" checked> List the part numbers in the message</label></div>' +
      '<div class="mh"><i>4</i>CC and attachments</div><div class="fu-grid">' +
      '<div class="fu-box"><h3>CC</h3><div class="fu-chips" id="fu-req"></div>' +
      '<div class="fu-ccs"><label class="inline-check"><input type="checkbox" id="fu-cc-mid"> Middle management <span class="muted small">staff · supervisor · dept. head · GM</span></label><label class="inline-check"><input type="checkbox" id="fu-cc-top"> Top management <span class="muted small">marketing director</span></label><label class="inline-check"><input type="checkbox" id="fu-cc-dir"> Director <span class="muted small">president / vice president</span></label><label class="inline-check"><input type="checkbox" id="fu-cc-buyer"> PUD buyer <span class="muted small">TMMIN purchasing</span></label></div>' +
      '<p class="muted small" style="margin:6px 0 0">Contacts marked “Always CC” in the Directory are added automatically.</p>' +
      '<label class="field" style="margin-top:8px"><span>Extra CC (optional, separate with ;)</span><input type="text" id="fu-extra" autocomplete="off" placeholder="name@company.com"></label></div>' +
      '<div class="fu-box"><h3>Attachments</h3><label class="inline-check"><input type="checkbox" id="fu-att-pdf"> <span id="fu-att-pdf-l"></span></label><br><label class="inline-check"><input type="checkbox" id="fu-att-xlsx"> <span id="fu-att-xlsx-l"></span></label><p class="muted small" style="margin:10px 0 4px">Standard files (attached unchanged):</p><div id="fu-lib"></div><p class="muted small" style="margin:8px 0 0" id="fu-att-note"></p></div></div>' +
      '<div class="mh"><i>5</i>How should it go out?</div>' +
      '<div class="mk" id="fu-mode" role="group" aria-label="Send mode">' +
      '<button type="button" data-send="test" aria-pressed="true"><em class="fu-tag t">Safe</em><b>Test to myself</b><span>Only you receive it, marked [TEST]. No supplier, no CC.</span></button>' +
      '<button type="button" data-send="draft" aria-pressed="false"><em class="fu-tag d">Manual</em><b>Outlook drafts</b><span>Downloads ready drafts with attachments. You check and press Send in Outlook.</span></button>' +
      '<button type="button" data-send="live" aria-pressed="false"><em class="fu-tag l">Live</em><b>Send to suppliers</b><span>Power Automate sends now, with the mandatory CC and sign-off.</span></button></div>' +
      '<div class="fu-grid" id="fu-opts"><label class="field" id="fu-testto-wrap"><span>Send the test to</span><input type="text" id="fu-testto" autocomplete="off" placeholder="your.name@toyota.co.id"></label></div>' +
      '<details class="fu-adv" id="fu-adv"><summary>Sending options <span class="muted small" id="fu-adv-sum"></span></summary><div class="fu-grid">' +
      '<label class="field"><span>How many per click</span><select id="fu-limit"><option value="1">First 1 selected</option><option value="3">First 3 selected</option><option value="5">First 5 selected</option><option value="10">First 10 selected</option><option value="0">All selected</option></select></label>' +
      '<label class="field"><span>Pause between e-mails</span><select id="fu-pause"><option value="0">None</option><option value="2">2 seconds</option><option value="5">5 seconds</option><option value="15">15 seconds</option></select></label>' +
      '<div class="fu-checks"><label class="inline-check"><input type="checkbox" id="fu-stop" checked> Stop at the first failure</label><label class="inline-check"><input type="checkbox" id="fu-force"> Send even if e-mailed recently</label></div></div>' +
      '<div class="fu-bar"><button type="button" class="btn btn-secondary btn-sm" id="fu-ping">Check the connection (sends one test to me)</button><span class="muted small" id="fu-ping-msg" role="status"></span></div></details>' +
      '<div class="mh"><i>6</i>Pick suppliers and check each e-mail</div>' +
      '<div class="fu-bar fu-tools"><span id="fu-only" class="fu-only" hidden></span><label class="inline-check" id="fu-all-wrap"><input type="checkbox" id="fu-all"> Select all ready</label><span class="muted small" id="fu-count"></span></div>' +
      '<div class="table-wrap"><table class="tbl compact"><thead id="fu-head"></thead><tbody id="fu-body"></tbody></table></div>' +
      '<div class="fu-dock" id="fu-dock"><div class="fu-dock-text"><b id="fu-sum-title"></b><span class="muted small" id="fu-sum"></span></div><button type="button" class="btn btn-primary" id="fu-send" disabled>Send</button>' +
      '<div class="fu-progrow" id="fu-progwrap" hidden><div class="fu-prog" aria-hidden="true"><i id="fu-prog"></i></div><span class="small" id="fu-prog-text" role="status"></span></div></div>' +
      '<div class="fu-done" id="fu-done" hidden role="status"></div>' +
      '<dialog class="fu-dlg" id="fu-dlg" aria-labelledby="fu-dlg-t"><h3 id="fu-dlg-t"></h3><div id="fu-dlg-body"></div><div class="fu-bar" style="justify-content:flex-end;margin-bottom:0"><button type="button" class="btn btn-secondary btn-sm" id="fu-dlg-no">Cancel</button><button type="button" class="btn btn-primary btn-sm" id="fu-dlg-yes"></button></div></dialog>';
    var anchor = follow.querySelector("#follow-sub") || follow.lastElementChild;
    anchor.insertAdjacentElement("afterend", box);
    // Keep recipient selection and the delivery mode visible; put optional CC/files behind a disclosure.
    var ccGrid = box.querySelector("#fu-cc-mid").closest(".fu-grid");
    var ccHeading = ccGrid.previousElementSibling;
    var ccDetails = document.createElement("details"); ccDetails.className = "fu-adv";
    var ccSummary = document.createElement("summary"); ccSummary.textContent = "4 · CC and attachments (review optional settings)";
    ccDetails.appendChild(ccSummary); ccHeading.before(ccDetails); ccDetails.appendChild(ccGrid); ccHeading.remove();
    var recipientTable = box.querySelector("#fu-body").closest(".table-wrap");
    recipientTable.classList.add("compact-recipient-table");
    var $ = function (id) { return box.querySelector("#" + id); };
    var auto = null;
    var S = { lib: [], kind: "followup", scope: "open", models: [], only: "", selected: {}, edits: {}, results: {}, sending: false, mode: "queues", ready: false, open: "" };
    var team = function () { return typeof SENDERS === "object" ? SENDERS : {}; };
    var saved = {}; try { saved = JSON.parse(lsGet(MAIL_KEY) || "{}"); } catch (e) { saved = {}; }
    ["kind", "scope"].forEach(function (k) { if (saved[k]) S[k] = saved[k]; });
    if (!KIND_META[S.kind]) S.kind = "followup";
    var sender = saved.sender && team()[saved.sender] ? saved.sender : (Object.keys(team())[0] || "");
    S.send = saved.send === "live" || saved.send === "draft" || saved.send === "test" ? saved.send : (saved.live === true ? "live" : ""); S.live = S.send === "live"; S.testTo = saved.testTo || ""; S.limit = saved.limit != null ? String(saved.limit) : "1"; S.pause = saved.pause || "0"; S.stop = saved.stop !== false;
    function persist() { lsSet(MAIL_KEY, JSON.stringify({ send: S.send, live: S.live, testTo: S.testTo, limit: S.limit, pause: S.pause, stop: S.stop, kind: S.kind, scope: S.scope, sender: $("fu-sender").value, roles: roles(), att: { pdf: $("fu-att-pdf").checked, xlsx: $("fu-att-xlsx").checked, lib: S.lib }, list: $("fu-list").checked })); }
    function roles() { return { mid: $("fu-cc-mid").checked, top: $("fu-cc-top").checked, dir: $("fu-cc-dir").checked, buyer: $("fu-cc-buyer").checked }; }

    function setMode(m) {
      S.mode = m;
      ["follow-tabs", "follow-panel", "follow-sub"].forEach(function (id) { var el = follow.querySelector("#" + id); if (el) el.hidden = m !== "queues"; });
      box.hidden = m !== "email";
      var templates = follow.querySelector("#followup-settings-panel"); if (templates) templates.hidden = m !== "templates";
      if (m === "auto" && !auto) auto = initAutoPanel(follow, box);
      if (auto) { follow.querySelector("#shared-auto-panel").hidden = m !== "auto"; if (m === "auto") auto.open(); }
      Array.prototype.forEach.call(follow.querySelectorAll("[data-fmode]"), function (b) { var on = b.getAttribute("data-fmode") === m; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      if (m === "email") boot();
    }
    follow.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-fmode]"); if (b) setMode(b.getAttribute("data-fmode")); });

    libraryView($("fu-lib"), { selected: function () { return S.lib || []; }, onChange: function (ids) { S.lib = ids; persist(); draw(); } });
    async function boot() {
      try {
        loadLibrary();
        var res = await Promise.all([loadMailConfig(false), api("/api/imds-master/followups")]);
        mailInfo = res[1];
        if (!S.ready) {
          var cfg = res[0], rs = saved.roles || cfg.ccRoles, at = saved.att || cfg.attachments;
          $("fu-cc-mid").checked = !!rs.mid; $("fu-cc-top").checked = !!rs.top; $("fu-cc-dir").checked = !!rs.dir; $("fu-cc-buyer").checked = !!rs.buyer;
          $("fu-att-pdf").checked = at.pdf !== false; $("fu-att-xlsx").checked = at.xlsx !== false; S.lib = Array.isArray(at.lib) ? at.lib : []; $("fu-list").checked = saved.list !== false;
          $("fu-scope").value = S.scope;
          $("fu-sender").innerHTML = Object.keys(team()).map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + " · " + esc(team()[n]) + "</option>"; }).join("");
          if (sender) $("fu-sender").value = sender;
          if (!S.send) { S.send = mailInfo.configured && mailInfo.canSend ? "test" : "draft"; S.live = S.send === "live"; }
          $("fu-testto").value = S.testTo || mailInfo.me || ""; $("fu-limit").value = S.limit; $("fu-pause").value = S.pause; $("fu-stop").checked = S.stop;
          S.ready = true;
        }
        draw();
      } catch (e) { $("fu-state").textContent = e.message; }
    }
    onMailConfig(function () { if (S.ready) draw(); });

    function templatesOfKind() { return mailCfg.templates.filter(function (t) { return t.kind === S.kind; }); }
    function currentTemplate() { var id = $("fu-template").value; return mailCfg.templates.filter(function (t) { return t.id === id; })[0] || templatesOfKind()[0]; }

    function selectedParts() {
      return visibleRecords().filter(function (r) { return (OPEN(r.status) || (S.scope === "notdone" && r.status === "process")) && (!S.models.length || S.models.indexOf(r.model) >= 0) && (!S.only || r.company === S.only); });
    }
    function ccFor(lookups, to) {
      var me = team()[$("fu-sender").value] || "";
      var list = (mailCfg.requiredCc || []).concat(Object.keys(team()).map(function (n) { return team()[n]; }));
      var rs = roles();
      lookups.forEach(function (l) { list = list.concat(l.ccAlways || []); if (rs.mid) list = list.concat(l.mid); if (rs.top) list = list.concat(l.top); if (rs.dir) list = list.concat(l.dir || []); if (rs.buyer && l.buyer) list = list.concat(l.buyer.emails || []); });
      list = list.concat(splitEmails($("fu-extra").value));
      return dedupeMail(list, to.concat([me]));
    }
    function baseCtx() {
      var now = new Date();
      var who = $("fu-sender").value, names = (mailCfg && mailCfg.senderNames) || {};
      return { sender: who, sendername: names[who] || who, greeting: greeting(), date: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(now),
        updated: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(now) + ", " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " WIB",
        duedate: longDate(new Date(now.getTime() + 7 * 86400000)), models: summaryModelsText(), modelshort: summaryModelLabels().join(", ") };
    }
    // Power Automate sends have no Outlook signature: add the configured sign-off once (Follow-up → Templates & rules).
    // A sender's own footer (Settings → Footer per sender) wins over the shared signature, same rule as lib/followup/center.ts footerFor.
    function signed(body, ctx) {
      var sig = String(footerOf(mailCfg, ctx.sender)).trim();
      if (!sig) return body;
      sig = fill(sig, ctx);
      var first = sig.split("\n")[0].trim().toLowerCase(), tail = String(body).slice(-400).toLowerCase();
      if ((first && tail.indexOf(first) >= 0) || /\b(best|kind|warm) regards\b|\bsincerely\b/.test(tail)) return body;
      return String(body).replace(/\s+$/, "") + "\n\n" + sig;
    }
    function buildGroups() {
      var t = currentTemplate(), base = baseCtx(), include = $("fu-list").checked, parts = selectedParts();
      if (S.kind === "recap") {
        var companies = Array.from(new Set(parts.map(function (r) { return r.company; })));
        var lookups = companies.map(function (c) { return contactLookup(c); });
        var to = dedupeMail([].concat.apply([], lookups.map(function (l) { return l.pic; })), []);
        var ctx = Object.assign({}, base, { supplier: "IMDS Team", code: "", count: parts.length, projects: projNames(parts), deadlines: projLines(parts), partlist: "" });
        return [{ key: "RECAP", name: "ALL SUPPLIERS (RECAP)", code: "", parts: parts, to: to, cc: ccFor(lookups, to), companies: companies.length, ready: to.length > 0 && parts.length > 0, subject: fill(t.subject, ctx), body: signed(fill(t.body, ctx), ctx), projects: [] }];
      }
      var by = new Map();
      parts.forEach(function (r) { if (!by.has(r.company)) by.set(r.company, []); by.get(r.company).push(r); });
      var out = [];
      by.forEach(function (list, company) {
        list.sort(function (a, b) { return ((a.targetDate && a.targetDate.getTime()) || Infinity) - ((b.targetDate && b.targetDate.getTime()) || Infinity); });
        var l = contactLookup(company, null, { fallbackMid: !mailCfg || mailCfg.fallbackMid !== false }), to = l.pic.slice();
        var ctx = Object.assign({}, base, { supplier: company, code: list[0].vendorCode || "-", count: list.length, projects: projNames(list), deadlines: projLines(list), partlist: partLines(S.kind, list, include) });
        out.push({ key: company, name: company, code: list[0].vendorCode || "", parts: list, to: to, cc: ccFor([l], to), lookup: l, ready: to.length > 0, subject: fill(t.subject, ctx), body: signed(fill(t.body, ctx), ctx),
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
      $("fu-req").innerHTML = rq.length ? '<span class="muted small">Always on CC:</span> ' + rq.map(function (e) { return '<span class="fu-chip lock" title="Mandatory — change in Follow-up → Templates & rules">🔒 ' + esc(e) + "</span>"; }).join("") : '<span class="muted small">No mandatory CC set (Follow-up → Templates & rules).</span>';
      var recap = S.kind === "recap";
      Array.prototype.forEach.call($("fu-mode").querySelectorAll("button"), function (b) { var m = b.getAttribute("data-send"); b.setAttribute("aria-pressed", String(m === S.send)); if (m === "live") b.title = mailInfo.configured ? "" : "Power Automate is not set up yet. Use Outlook drafts."; });
      $("fu-testto-wrap").hidden = S.send !== "test"; $("fu-force").closest("label").hidden = !S.live; $("fu-ping").closest(".fu-bar").hidden = S.send === "draft";
      $("fu-limit").closest("label").hidden = recap;
      $("fu-att-pdf-l").textContent = recap ? "Executive summary PDF (all suppliers)" : "PDF recap of this supplier's parts";
      $("fu-att-xlsx-l").textContent = recap ? "Excel list of all outstanding parts" : "Excel list of unsubmitted part numbers (supplier fills the plan date)";
      $("fu-att-note").textContent = recap ? "Generated now from the current data." : "Generated per supplier, only with the parts listed in its e-mail.";
      $("fu-list").closest("label").hidden = recap;
      $("fu-all-wrap").hidden = recap;
      $("fu-send").className = "btn btn-primary" + (S.live ? " fu-live" : "");
      var who = $("fu-sender").value, full = (cfg.senderNames || {})[who] || who;
      var own = ownFooter(cfg, who);
      $("fu-signs").textContent = String(footerOf(cfg, who)).trim() ? (own ? "Own footer of " + who : "Signed “" + (full || "—") + "”") + " · " + fontLabel(cfg) : "No sign-off (Follow-up → Templates & rules)";
      $("fu-adv-sum").textContent = "· " + ($("fu-limit").value === "0" ? "all selected" : "first " + $("fu-limit").value) + " per click · " + ($("fu-pause").value === "0" ? "no pause" : $("fu-pause").value + " s pause") + ($("fu-stop").checked ? " · stops on failure" : "");
      var onlyEl = $("fu-only");
      if (S.only) { onlyEl.hidden = false; onlyEl.innerHTML = '<span class="fu-chip" aria-pressed="true">' + esc(S.only) + ' ✕</span>'; } else onlyEl.hidden = true;
      var su = mailInfo.setup || {}, tick = function (ok, t) { return (ok ? "✔ " : "✖ ") + t; };
      $("fu-state").textContent = (mailInfo.configured ? "" : "Power Automate is not ready: " + [tick(su.url, "flow URL (POWER_AUTOMATE_EMAIL_URL)"), tick(su.secret, "shared secret (POWER_AUTOMATE_SECRET)")].join(" · ") + ". Add them in Vercel → Settings → Environment Variables and redeploy (step-by-step: docs/PANDUAN_SETUP_LENGKAP_ID.md, section 6c). Until then, use “📨 Outlook drafts” below: it works for everyone from their own mailbox, with the attachments. ") + (cfg.__missingTable ? "⚠ The settings table is not created yet — built-in templates are used and changes cannot be saved. See Follow-up → Templates & rules. " : "") +
        (mailInfo.canSend ? "" : "Your role (" + (mailInfo.role || "viewer") + ") cannot send through Power Automate, but you can create 📨 Outlook drafts from your own mailbox. ");
      $("fu-state").hidden = !$("fu-state").textContent;
      groups = buildGroups();
      renderTable();
    }
    function renderTable() {
      var recap = S.kind === "recap", body = $("fu-body"), head = $("fu-head");
      if (recap) {
        head.innerHTML = "";
        var g = groups[0];
        if (!g || !g.parts.length) { body.innerHTML = '<tr><td class="muted">Nothing outstanding for this selection. 🎉</td></tr>'; $("fu-send").disabled = true; $("fu-count").textContent = ""; summary(); return; }
        body.innerHTML = '<tr><td><div class="small"><b>To:</b> ' + g.to.length + " supplier PIC(s) from " + g.companies + " supplier(s) · <b>CC:</b> " + esc(g.cc.join("; ") || "—") + " · <b>Parts:</b> " + g.parts.length + '</div>' +
          '<label class="field" style="margin-top:8px"><span>Subject</span><input type="text" class="fu-sub" id="fu-rsub"></label><label class="field"><span>Message</span><textarea class="fu-msg" id="fu-rmsg" style="min-height:300px;width:100%;font:13px/1.45 ui-monospace,monospace"></textarea></label>' +
          '<div class="row-actions"><button type="button" class="btn btn-secondary btn-sm" id="fu-rout">Open in Outlook draft</button></div></td></tr>';
        var ed = S.edits.RECAP || {};
        $("fu-rsub").value = ed.subject != null ? ed.subject : g.subject; $("fu-rmsg").value = ed.body != null ? ed.body : g.body;
        $("fu-rsub").oninput = function () { (S.edits.RECAP = S.edits.RECAP || {}).subject = this.value; };
        $("fu-rmsg").oninput = function () { (S.edits.RECAP = S.edits.RECAP || {}).body = this.value; };
        $("fu-rout").onclick = function () { outlookDraft(g.to, g.cc, $("fu-rsub").value, $("fu-rmsg").value); };
        $("fu-count").textContent = g.to.length + " recipient(s)";
        $("fu-send").disabled = S.sending || (S.send !== "draft" && !mailInfo.configured) || !(S.send === "draft" ? mailInfo.canDraft !== false : mailInfo.canSend) || !g.ready;
        summary();
        return;
      }
      head.innerHTML = '<tr><th scope="col"><span class="sr-only">Select</span></th><th scope="col">Supplier</th><th scope="col" class="r">Parts</th><th scope="col">Models</th><th scope="col">To</th><th scope="col" class="r">CC (people)</th><th scope="col">Last e-mailed</th><th scope="col">Result</th><th scope="col"><span class="sr-only">Preview</span></th></tr>';
      if (!groups.length) { body.innerHTML = '<tr><td colspan="9" class="muted">No supplier has outstanding parts for this selection. 🎉</td></tr>'; $("fu-count").textContent = ""; $("fu-send").disabled = true; summary(); return; }
      body.innerHTML = groups.map(function (g, i) {
        var last = mailInfo.lastSent[g.name], r = S.results[g.key];
        return '<tr data-i="' + i + '"><td><input type="checkbox" class="fu-pick" aria-label="Select ' + esc(g.name) + '"' + (S.selected[g.key] && g.ready ? " checked" : "") + (g.ready ? "" : " disabled") + "></td>" +
          '<th scope="row">' + esc(g.name) + '<div class="muted small">' + esc(g.code || "no code") + "</div></th><td class=\"r\">" + g.parts.length + "</td><td>" + esc(g.projects.join(", ") || "—") + '</td><td class="fu-mail" title="' + esc(g.to.join("; ")) + '">' + (g.ready ? '<span class="fu-to1">' + esc(g.to[0]) + "</span>" + (g.to.length > 1 ? ' <span class="fu-more">+' + (g.to.length - 1) + "</span>" : "") + (g.lookup && g.lookup.toFrom === "mid" ? ' <span class="fu-tagx mid" title="No IMDS PIC in the Directory: middle management receives it">via middle mgmt</span>' : g.lookup && g.lookup.src !== "directory" ? ' <span class="fu-tagx">' + esc(g.lookup.src) + "</span>" : "") : '<span class="fu-res err">No PIC or middle management e-mail — add it in Directory</span>') + '</td><td class="r" title="' + esc(g.cc.join("; ")) + '">' + g.cc.length + "</td><td>" + (last ? esc(new Date(last).toLocaleDateString()) : '<span class="muted">—</span>') + "</td><td>" + (r ? '<span class="fu-res ' + r.kind + '">' + esc(r.text) + "</span>" : "") + '</td><td><button type="button" class="btn btn-ghost btn-sm fu-prev">' + (S.open === g.key ? "Hide" : "Preview") + "</button></td></tr>" + (S.open === g.key ? detailRow(g, i) : "");
      }).join("");
      var n = groups.filter(function (g) { return S.selected[g.key] && g.ready; }).length;
      $("fu-count").textContent = n + " selected · " + groups.filter(function (g) { return g.ready; }).length + " of " + groups.length + " ready";
      $("fu-send").disabled = (S.send !== "test" ? !n : !groups.some(function (g) { return g.ready; })) || S.sending || (S.send !== "draft" && !mailInfo.configured) || !(S.send === "draft" ? mailInfo.canDraft !== false : mailInfo.canSend);
      $("fu-send").title = !mailInfo.configured ? "Sending is not configured (POWER_AUTOMATE_EMAIL_URL / POWER_AUTOMATE_SECRET)." : "";
      if (S.open) wireDetail();
      summary();
    }
    /** Exactly the e-mails the main button will handle, in order (same rule the button uses). */
    function todoList() {
      var ready = groups.filter(function (g) { return g.ready; });
      var picked = ready.filter(function (g) { return S.selected[g.key]; });
      var todo = S.kind === "recap" ? ready : (S.send !== "test" ? picked : (picked.length ? picked : ready));
      var lim = Number($("fu-limit").value) || 0; if (S.kind !== "recap" && lim) todo = todo.slice(0, lim);
      return todo;
    }
    function attText() { return [$("fu-att-pdf").checked ? "PDF" : "", $("fu-att-xlsx").checked ? "Excel" : "", libNames().length ? libNames().join(", ") : ""].filter(Boolean).join(" + ") || "no attachments"; }
    function libNames() { return (S.lib || []).map(function (id) { var f = LIB.files.find(function (x) { return x.id === id; }); return f ? f.name : ""; }).filter(Boolean); }
    /** One plain sentence above the main button: what happens when it is pressed. */
    function summary() {
      var todo = todoList(), n = todo.length, recap = S.kind === "recap", names = todo.slice(0, 3).map(function (g) { return g.name; }).join(", ") + (n > 3 ? " +" + (n - 3) + " more" : "");
      var title, line, verb;
      if (!n) {
        title = S.send === "test" ? "Nothing to test yet" : "Select at least one supplier";
        line = groups.length ? (S.send === "test" ? "No supplier has a PIC e-mail yet." : "Tick the suppliers below (only rows with a PIC e-mail can be picked).") : "No outstanding parts for this selection.";
        verb = S.send === "draft" ? "Create drafts" : S.live ? "Send" : "Send test";
      } else if (S.send === "test") {
        title = "Test: " + n + " e-mail" + (n > 1 ? "s" : "") + " to " + (($("fu-testto").value || "").trim() || "your address");
        line = (recap ? "The recap" : names) + " · " + attText() + " · no supplier and no CC receives anything";
        verb = "Send test to me";
      } else if (S.send === "draft") {
        title = n + " Outlook draft" + (n > 1 ? "s" : "") + " to download";
        line = (recap ? "The recap" : names) + " · " + attText() + " · nothing is sent until you press Send in Outlook";
        verb = n > 1 ? "Create " + n + " drafts" : "Create draft";
      } else {
        title = recap ? "Live: recap to " + todo[0].to.length + " supplier PIC(s)" : "Live: e-mail " + n + " supplier" + (n > 1 ? "s" : "") + " now";
        line = (recap ? "One e-mail" : names) + " · from " + ($("fu-sender").value || "the flow mailbox") + " · " + attText() + " · mandatory CC added";
        verb = recap ? "Send recap" : "Send to " + n + " supplier" + (n > 1 ? "s" : "");
      }
      $("fu-sum-title").textContent = title; $("fu-sum").textContent = line;
      if (!S.sending) $("fu-send").textContent = verb;
      $("fu-dock").classList.toggle("live", S.send === "live" && n > 0);
    }
    function fileBase(g) { return String(g.name).replace(/[^a-z0-9]+/gi, "_"); }
    function detailRow(g, i) {
      var who = $("fu-sender").value, from = who ? who + " <" + (team()[who] || "") + ">" : "Flow mailbox";
      var files = [];
      if ($("fu-att-pdf").checked) files.push("IMDS_" + fileBase(g) + ".pdf");
      if ($("fu-att-xlsx").checked) files.push("Excel list of " + g.parts.length + " part(s)");
      libNames().forEach(function (n) { files.push(n); });
      var test = S.send === "test", tt = ($("fu-testto").value || "").trim();
      return '<tr class="fu-det" data-d="' + i + '"><td colspan="9"><div class="fu-mailcard">' +
        (test ? '<p class="fu-note">Test mode: this goes only to ' + esc(tt || "your address") + ", without CC, subject starts with [TEST].</p>" : "") +
        '<dl class="fu-hdr"><dt>From</dt><dd>' + esc(from) + "</dd><dt>To</dt><dd>" + esc(g.to.join("; ")) + "</dd><dt>CC</dt><dd>" + (g.cc.length ? '<details><summary>' + g.cc.length + " address" + (g.cc.length > 1 ? "es" : "") + "</summary>" + esc(g.cc.join("; ")) + "</details>" : "—") + "</dd>" +
        "<dt>Files</dt><dd>" + (files.length ? files.map(function (f) { return '<span class="fu-file">' + esc(f) + "</span>"; }).join(" ") : '<span class="muted">none</span>') + "</dd></dl>" +
        '<label class="field"><span>Subject</span><input type="text" class="fu-sub"></label><label class="field"><span>Message <span class="muted">— edits apply to this supplier only</span></span><textarea class="fu-msg" spellcheck="true"></textarea></label>' +
        '<div class="row-actions"><button type="button" class="btn btn-secondary btn-sm fu-eml">Download as Outlook draft</button><button type="button" class="btn btn-ghost btn-sm fu-out" title="Opens a new e-mail in your mail app without attachments">Quick e-mail (no files)</button><button type="button" class="btn btn-ghost btn-sm fu-reset" hidden>Undo my edits</button></div></div></td></tr>';
    }
    function fitText(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 4, 900) + "px"; }
    function wireDetail() {
      var det = $("fu-body").querySelector(".fu-det"); if (!det) return;
      var g = groups[Number(det.getAttribute("data-d"))], ed = S.edits[g.key] || {};
      var sub = det.querySelector(".fu-sub"), msg = det.querySelector(".fu-msg");
      sub.value = ed.subject != null ? ed.subject : g.subject; msg.value = ed.body != null ? ed.body : g.body;
      var reset = det.querySelector(".fu-reset"), mark = function () { reset.hidden = !S.edits[g.key]; };
      sub.oninput = function () { (S.edits[g.key] = S.edits[g.key] || {}).subject = sub.value; mark(); };
      msg.oninput = function () { (S.edits[g.key] = S.edits[g.key] || {}).body = msg.value; fitText(msg); mark(); };
      reset.onclick = function () { delete S.edits[g.key]; renderTable(); };
      mark(); window.requestAnimationFrame(function () { fitText(msg); });
      det.querySelector(".fu-out").onclick = function () { outlookDraft(g.to, g.cc, sub.value, msg.value); };
      det.querySelector(".fu-eml").onclick = async function () {
        var btn = this; btn.disabled = true; var keep = S.send; S.send = "draft";
        try { var r = await sendOne(g); await deliverDrafts([{ name: r.fileName, b64: r.eml }]); S.results[g.key] = { kind: "ok", text: "Draft ready" }; }
        catch (e) { S.results[g.key] = { kind: "err", text: e.message }; }
        finally { S.send = keep; btn.disabled = false; renderTable(); }
      };
    }
    function redraw() { persist(); S.selected = {}; S.results = {}; S.edits = {}; $("fu-all").checked = false; draw(); }

    $("fu-kinds").onclick = function (e) { var b = e.target.closest && e.target.closest("button[data-kind]"); if (!b) return; S.kind = b.getAttribute("data-kind"); S.open = ""; $("fu-template").value = ""; redraw(); };
    $("fu-scope").onchange = function () { S.scope = this.value; redraw(); };
    ["fu-template", "fu-sender", "fu-list", "fu-cc-mid", "fu-cc-top", "fu-cc-dir", "fu-cc-buyer", "fu-att-pdf", "fu-att-xlsx"].forEach(function (id) { $(id).onchange = function () { if (id === "fu-sender") lsSet("imds-sender", this.value); if (id === "fu-att-pdf" || id === "fu-att-xlsx") { persist(); return; } redraw(); }; });
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
    /** In-page confirmation listing exactly who gets what. Falls back to the browser confirm where <dialog> is missing. */
    function askConfirm(todo, testTo) {
      var mode = S.send, recap = S.kind === "recap", n = todo.length;
      var title = mode === "test" ? "Send " + n + " test e-mail" + (n > 1 ? "s" : "") + " to yourself?" : mode === "draft" ? "Create " + n + " Outlook draft" + (n > 1 ? "s" : "") + "?" : recap ? "Send the recap to " + todo[0].to.length + " supplier PIC(s) now?" : "E-mail " + n + " supplier" + (n > 1 ? "s" : "") + " now?";
      var note = mode === "test" ? "Everything goes only to " + testTo + ". No supplier and no CC receives anything." : mode === "draft" ? "Nothing is sent. Outlook opens each draft from your own mailbox; you check it and press Send." : "This goes out for real through Power Automate. The mandatory CC and the sign-off are added.";
      var rows = todo.slice(0, 8).map(function (g) { return "<li><b>" + esc(g.name) + '</b> <span class="muted">· ' + g.parts.length + " part(s) · " + esc(mode === "test" ? testTo : g.to.join("; ")) + "</span></li>"; }).join("") + (n > 8 ? '<li class="muted">+' + (n - 8) + " more</li>" : "");
      var html = '<p class="fu-note' + (mode === "live" ? " live" : "") + '">' + esc(note) + "</p><ul class=\"fu-list\">" + rows + "</ul>" +
        '<p class="muted small">From: ' + esc($("fu-sender").value || "flow mailbox") + " · Files: " + esc(attText()) + "</p>";
      var dlg = $("fu-dlg");
      if (!dlg || typeof dlg.showModal !== "function") return Promise.resolve(window.confirm(title + "\n" + note));
      $("fu-dlg-t").textContent = title; $("fu-dlg-body").innerHTML = html;
      var yes = $("fu-dlg-yes"); yes.textContent = mode === "test" ? "Send test" : mode === "draft" ? "Create drafts" : "Yes, send now"; yes.className = "btn btn-primary btn-sm" + (mode === "live" ? " fu-live" : "");
      return new Promise(function (resolve) {
        var done = function (v) { dlg.close(); $("fu-dlg-yes").onclick = $("fu-dlg-no").onclick = dlg.oncancel = null; resolve(v); };
        $("fu-dlg-yes").onclick = function () { done(true); }; $("fu-dlg-no").onclick = function () { done(false); };
        dlg.oncancel = function (e) { e.preventDefault(); done(false); };
        dlg.showModal(); $("fu-dlg-no").focus();
      });
    }
    /** A clear end state: counts, what it means, and the next step. */
    function finished(r) {
      var el = $("fu-done"), mode = S.send, good = r.ok > 0 && !r.fail;
      var head = mode === "draft" ? r.ok + " draft" + (r.ok === 1 ? "" : "s") + " downloaded" : mode === "test" ? r.ok + " test e-mail" + (r.ok === 1 ? "" : "s") + " handed over" : r.ok + " e-mail" + (r.ok === 1 ? "" : "s") + " handed to Power Automate";
      var next = mode === "draft" ? "Open the " + (r.ok > 1 ? ".zip, then each .eml file" : ".eml file") + ": Outlook shows a new message with the attachments. Check it and press Send." :
        mode === "test" ? "Check " + (r.testTo || "your inbox") + " in a minute. Looks right? Switch to “Send to suppliers”." :
        "“Handed over” means the flow accepted it. Delivery shows in Outlook Sent items" + (r.from ? " of " + r.from : "") + ".";
      el.className = "fu-done " + (good ? "ok" : r.ok ? "mixed" : "bad");
      el.innerHTML = '<span class="fu-done-ic" aria-hidden="true">' + (good ? "✓" : r.ok ? "!" : "✕") + '</span><div><b>' + esc(head) + "</b>" +
        '<div class="fu-done-n"><span class="ok">' + r.ok + " done</span><span>" + r.skip + " skipped</span><span" + (r.fail ? ' class="bad"' : "") + ">" + r.fail + " failed</span>" + (r.stopped ? "<span>stopped at the first failure</span>" : "") + "</div>" +
        '<p class="small" style="margin:6px 0 0">' + esc(r.fail && !r.ok ? "Nothing went out. The reason is in the Result column of each row." : next) + "</p></div>";
      el.hidden = false; $("fu-progwrap").hidden = true;
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    async function sendOne(g) {
      var ed = S.edits[g.key] || {};
      var payload = { kind: S.kind, supplierCode: g.code, supplierName: g.name, to: g.to, cc: g.cc, subject: ed.subject != null ? ed.subject : g.subject, messageBody: ed.body != null ? ed.body : g.body,
        sender: team()[$("fu-sender").value] || undefined, force: S.live && $("fu-force").checked, test: S.send === "test" || undefined, testTo: S.send === "test" ? ($("fu-testto").value || "").trim() : undefined, mode: S.send === "draft" ? "draft" : "send", partIds: g.parts.map(function (r) { return r.masterId; }).filter(Boolean),
        attachments: { pdf: $("fu-att-pdf").checked && S.kind !== "recap", xlsx: $("fu-att-xlsx").checked, library: (S.lib || []).filter(function (id) { return LIB.files.some(function (f) { return f.id === id; }); }) } };
      if (S.kind === "recap") payload.extraPdf = await recapPdf();
      // Attach the same PDF the "Supplier PDF" button makes, drawn here in the browser (the server's text PDF is only a fallback).
      else if ($("fu-att-pdf").checked) {
        try {
          var sdoc = generateSupplierPDF(g.name, { returnDoc: true });
          if (sdoc) { var suri = sdoc.output("datauristring"); payload.supplierPdf = { name: "IMDS_" + String(g.name).replace(/[^a-z0-9]+/gi, "_") + ".pdf", base64: suri.slice(suri.indexOf(",") + 1) }; }
        } catch (pdfError) { /* fall back to the server PDF */ }
      }
      return api("/api/imds-master/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    $("fu-mode").onclick = function (e) { var b = e.target.closest && e.target.closest("button[data-send]"); if (!b) return; S.send = b.getAttribute("data-send"); S.live = S.send === "live"; $("fu-done").hidden = true; persist(); draw(); };
    $("fu-testto").oninput = function () { S.testTo = this.value.trim(); persist(); summary(); };
    $("fu-limit").onchange = function () { S.limit = this.value; persist(); draw(); };
    $("fu-pause").onchange = function () { S.pause = this.value; persist(); draw(); };
    $("fu-stop").onchange = function () { S.stop = this.checked; persist(); draw(); };
    var sleep = function (ms) { return new Promise(function (r) { window.setTimeout(r, ms); }); };
    $("fu-ping").onclick = async function () {
      var msg = $("fu-ping-msg"), me = ($("fu-testto").value || mailInfo.me || "").trim();
      if (!mailInfo.configured) { msg.textContent = "Not ready yet — see the checklist at the top of this page."; msg.style.color = "var(--bad)"; return; }
      this.disabled = true; msg.style.color = ""; msg.textContent = "Sending…";
      try {
        var r = await api("/api/imds-master/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "followup", test: true, testTo: me, supplierName: "CONNECTION TEST", to: [me || "x@x.x"], subject: "IMDS Tracker connection test", messageBody: "This is a test from the IMDS Tracker e-mail center.\nIf you can read this, the Power Automate flow accepted the request and your mailbox sent it.\n\nNo supplier received anything.", sender: team()[$("fu-sender").value] || undefined }) });
        msg.style.color = "var(--ok-ink)"; msg.textContent = "Handed to Power Automate for " + r.to.join(", ") + " (sent from " + r.sentFrom + "). Check your inbox in a minute; if nothing arrives, open the flow's Run history.";
      } catch (e) { msg.style.color = "var(--bad)"; msg.textContent = e.message; }
      this.disabled = false;
    };
    $("fu-send").onclick = async function () {
      if (S.sending) return;
      var todo = todoList();
      if (!todo.length) return;
      var testTo = ($("fu-testto").value || "").trim();
      if (S.send === "test" && !testTo) { $("fu-testto").focus(); toast("Enter the address that should receive the test.", "info"); return; }
      if (!(await askConfirm(todo, testTo))) return;
      $("fu-done").hidden = true;
      S.sending = true; renderTable(); $("fu-send").textContent = "Working…"; $("fu-progwrap").hidden = false; $("fu-prog").style.width = "0";
      var drafts = [], done = 0, ok = 0, skip = 0, fail = 0, last = "", pause = Number($("fu-pause").value) || 0, stopped = false;
      for (var i = 0; i < todo.length; i++) {
        var g = todo[i];
        $("fu-prog-text").textContent = (S.send === "draft" ? "Preparing " : S.live ? "Sending " : "Test ") + (i + 1) + " of " + todo.length + " — " + g.name;
        S.results[g.key] = { kind: "held", text: "Sending…" }; renderTable();
        try { var r = await sendOne(g); if (r.draft) drafts.push({ name: r.fileName, b64: r.eml }); S.results[g.key] = { kind: "ok", text: r.draft ? "Draft ready" : S.live ? "Handed to Power Automate" : "Test sent to " + testTo }; ok++; last = r.sentFrom || ""; if (S.live) { S.selected[g.key] = false; mailInfo.lastSent[g.name] = new Date().toISOString(); } }
        catch (e) {
          if (e.payload && e.payload.skipped === "RECENTLY_SENT") { S.results[g.key] = { kind: "held", text: "Skipped — e-mailed recently" }; skip++; }
          else { S.results[g.key] = { kind: "err", text: e.message }; fail++; if ($("fu-stop").checked) { stopped = true; done++; break; } }
        }
        done++; $("fu-prog").style.width = Math.round(done / todo.length * 100) + "%";
        if (pause && i < todo.length - 1) await sleep(pause * 1000);
      }
      S.sending = false; renderTable();
      if (drafts.length) await deliverDrafts(drafts);
      finished({ ok: ok, skip: skip, fail: fail, stopped: stopped, from: last, testTo: testTo, total: todo.length });
    };

    function b64bytes(b64) { var bin = atob(b64), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
    var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
    /** Minimal ZIP (stored, no compression): enough to hand many .eml drafts over in one download. */
    function zipBlob(files) {
      var enc = new TextEncoder(), parts = [], central = [], offset = 0;
      var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; }, u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
      files.forEach(function (f) {
        var name = enc.encode(f.name), data = f.bytes, crc = crc32(data);
        var local = new Uint8Array([].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)));
        parts.push(local, name, data);
        central.push(new Uint8Array([].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
        offset += local.length + name.length + data.length;
      });
      var size = central.reduce(function (a, p) { return a + p.length; }, 0);
      var end = new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(size), u32(offset), u16(0)));
      return new Blob(parts.concat(central, [end]), { type: "application/zip" });
    }
    async function deliverDrafts(list) {
      if (list.length === 1) { await saveBlobFile(new Blob([b64bytes(list[0].b64)], { type: "message/rfc822" }), list[0].name, "Outlook draft"); return; }
      var seen = {};
      var files = list.map(function (d) { var n = d.name; while (seen[n]) n = n.replace(/(\.eml)$/, "_" + (seen[d.name] = (seen[d.name] || 1) + 1) + "$1"); seen[n] = 1; return { name: n, bytes: b64bytes(d.b64) }; });
      await saveBlobFile(zipBlob(files), "IMDS_Outlook_drafts_" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()) + ".zip", "Outlook drafts");
    }

    window.__imdsEmailFor = function (company, kind) {
      S.kind = kind || "followup"; S.only = company || ""; S.models = []; S.open = company || ""; S.selected = {}; S.results = {}; S.edits = {};
      go("followup"); setMode("email");
      if (company) window.setTimeout(function () { var g = groups.filter(function (x) { return x.name === company; })[0]; if (g) { S.selected[g.key] = true; S.open = g.key; renderTable(); } }, 0);
      persist();
      window.setTimeout(function () { box.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
    };
    window.__imdsEmailRecap = function () { window.__imdsEmailFor("", "recap"); };
    setMode(location.hash === "#followup" && new URLSearchParams(location.search).get("section") === "templates" ? "templates" : "queues");
  }

  // ---- Follow-up → Templates & rules ----
  // ---- Standard files (file library): uploaded once, attached exactly as uploaded. Used by the composer and automations. ----
  var LIB = { files: [], canEdit: false, canPublish: false, loaded: false, error: "", maxBytes: 3145728, exec: null };
  var libViews = [];
  function libSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  async function loadLibrary() {
    try { var r = await api("/api/imds-master/attachments"); LIB.files = r.files || []; LIB.canEdit = !!r.canEdit; LIB.canPublish = !!r.canPublishSummary; LIB.exec = r.execSummary || null; LIB.error = r.error || ""; LIB.maxBytes = r.maxBytes || LIB.maxBytes; }
    catch (e) { LIB.error = e.message; }
    LIB.loaded = true; libViews.forEach(function (v) { v(); });
  }
  /**
   * The Tracker's own "Executive summary PDF" (same function as the button) saved on the server, so summary e-mails
   * of the automations attach exactly that PDF. Made from the data on screen; refreshed when Follow-up → Automatic
   * opens (if older than an hour or the data changed), before a preview / send now, and every 2 hours while open.
   */
  var execBusy = false;
  function dataStamp() { try { return String(D.records.length) + "|" + String(SRC && SRC.lastSync ? +SRC.lastSync : "") + "|" + D.records.filter(function (r) { return r.status === "complete"; }).length; } catch (e) { return ""; } }
  async function publishExecSummary(force) {
    if (execBusy || !LIB.canPublish || typeof generateSummaryPDF !== "function" || !window.jspdf || !D.records || !D.records.length) return false;
    var stamp = dataStamp(), fresh = LIB.exec && LIB.exec.ageH < 1 && lsGet("imds-exec-stamp") === stamp;
    if (!force && fresh) return false;
    execBusy = true;
    try {
      var doc = generateSummaryPDF({ returnDoc: true }); if (!doc) return false;
      var uri = doc.output("datauristring");
      var r = await api("/api/imds-master/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "exec-summary", base64: uri.slice(uri.indexOf(",") + 1) }) });
      LIB.exec = { at: r.at, size: r.size, ageH: 0 }; lsSet("imds-exec-stamp", stamp); libViews.forEach(function (v) { v(); });
      return true;
    } catch (e) { console.warn("Executive summary PDF not saved:", e.message); return false; }
    finally { execBusy = false; }
  }
  function execText() {
    if (!LIB.exec) return "not made yet — it is made from the data on screen when this page is open";
    var t = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date(LIB.exec.at)) + " WIB";
    return "updated " + t + " (" + libSize(LIB.exec.size || 0) + ")";
  }
  function fileToBase64(file) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(",")[1] || ""); }; fr.onerror = function () { rej(new Error("The file could not be read.")); }; fr.readAsDataURL(file); });
  }
  async function uploadLibFile(file, replaceId) {
    if (file.size > LIB.maxBytes) { toast(file.name + " is larger than " + libSize(LIB.maxBytes) + ".", "err"); return; }
    try {
      var b64 = await fileToBase64(file);
      await api("/api/imds-master/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, contentType: file.type || (/\.xlsx$/i.test(file.name) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : /\.pdf$/i.test(file.name) ? "application/pdf" : ""), base64: b64, replaceId: replaceId || undefined }) });
      toast((replaceId ? "Replaced: " : "Added to the files: ") + file.name, "ok"); await loadLibrary();
    } catch (e) { toast(e.message, "err"); }
  }
  /**
   * Renders the file list into `host`. opts.selected: array of ids (ticked), opts.onChange(ids) when ticks change.
   * Admins / preparers also get Add, Replace, Remove. Every file can be downloaded to check it is the original.
   */
  function libraryView(host, opts) {
    function draw() {
      var sel = opts.selected();
      if (!LIB.loaded) { host.innerHTML = '<p class="muted small">Loading files…</p>'; return; }
      host.innerHTML = (LIB.error ? '<p class="small t-bad" style="margin:0 0 6px">' + esc(LIB.error) + "</p>" : "") +
        (LIB.files.length ? '<ul class="lib-list">' + LIB.files.map(function (f) {
          return '<li><label class="inline-check">' + (opts.manageOnly ? "" : '<input type="checkbox" data-libid="' + esc(f.id) + '"' + (sel.indexOf(f.id) >= 0 ? " checked" : "") + ">") + '<span class="lib-name">' + esc(f.name) + '<span class="muted small">' + libSize(f.size) + (f.at ? " · " + esc(new Date(f.at).toLocaleDateString()) : "") + "</span></span></label>" +
            '<span class="lib-act"><a class="link-btn" href="/api/imds-master/attachments?id=' + encodeURIComponent(f.id) + '" download>Download</a>' +
            (LIB.canEdit ? '<button type="button" class="link-btn" data-libreplace="' + esc(f.id) + '">Replace</button><button type="button" class="link-btn t-bad" data-libdel="' + esc(f.id) + '">Remove</button>' : "") + "</span></li>";
        }).join("") + "</ul>" : '<p class="muted small" style="margin:0">No standard files yet.' + (LIB.canEdit ? " Add one, for example your IMDS Supplier Check Form." : "") + "</p>") +
        (LIB.canEdit ? '<div class="lib-add"><button type="button" class="btn btn-secondary btn-sm" data-libadd="1">+ Add file</button><span class="muted small">Attached exactly as uploaded (PDF, Excel, Word, PowerPoint, image; max ' + libSize(LIB.maxBytes) + ")</span></div>" : "");
    }
    var input = document.createElement("input"); input.type = "file"; input.hidden = true; input.accept = ".xlsx,.xls,.pdf,.docx,.doc,.pptx,.png,.jpg,.jpeg,.csv,.txt";
    var replaceId = ""; host.after(input);
    input.addEventListener("change", function () { var f = input.files && input.files[0]; input.value = ""; if (f) uploadLibFile(f, replaceId); });
    host.addEventListener("click", function (e) {
      var t = e.target.closest("[data-libadd],[data-libreplace],[data-libdel]"); if (!t) return;
      if (t.hasAttribute("data-libadd")) { replaceId = ""; input.click(); }
      else if (t.hasAttribute("data-libreplace")) { replaceId = t.getAttribute("data-libreplace"); input.click(); }
      else if (window.confirm("Remove this file from the standard files? E-mails and automations that use it stop attaching it.")) {
        api("/api/imds-master/attachments?id=" + encodeURIComponent(t.getAttribute("data-libdel")), { method: "DELETE" }).then(function () { toast("File removed", "ok"); loadLibrary(); }, function (er) { toast(er.message, "err"); });
      }
    });
    host.addEventListener("change", function (e) {
      var c = e.target.closest("[data-libid]"); if (!c) return;
      var ids = Array.prototype.map.call(host.querySelectorAll("[data-libid]:checked"), function (x) { return x.getAttribute("data-libid"); });
      opts.onChange(ids);
    });
    libViews.push(draw); draw();
    return draw;
  }

  // ---- Follow-up → Automatic: automations (weekly / every 2 weeks / monthly), reminder to the TMMIN PIC, preview, drafts ----
  function initAutoPanel(follow, after) {
    var DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
    var KINDS = { followup: "Follow-up per supplier", request: "Request per supplier", recap: "Summary to all suppliers (one e-mail + PDF)" };
    var sec = document.createElement("section");
    sec.className = "panel"; sec.id = "shared-auto-panel"; sec.hidden = true;
    sec.innerHTML = '<div class="au-top"><div><h2 class="au-h2">Automatic follow-ups</h2><p class="muted small" style="margin:2px 0 0">Each automation sends on its own days and hour (WIB) through Power Automate, with the template, CC rules, sign-off and files you choose. Before every run the TMMIN PIC gets a reminder with the full list, so a run can still be checked, changed or skipped.</p></div><button type="button" class="btn btn-primary btn-sm" id="au-new">+ New automation</button></div>' +
      '<div class="sc-ready" id="au-ready" role="status">Loading…</div>' +
      '<div id="au-list" class="au-list"></div>' +
      '<div id="au-edit" class="au-edit" hidden></div>' +
      '<div id="au-prev" hidden></div>' +
      '<details class="fu-adv au-files" open><summary><b>Standard files</b> <span class="muted small">— your own files, attached unchanged (e.g. IMDS Supplier Check Form)</span></summary><div id="au-lib"></div></details>' +
      '<h3 class="sc-h">History</h3><div class="table-wrap"><table class="tbl compact"><thead><tr><th scope="col">When</th><th scope="col">Automation</th><th scope="col">What</th><th scope="col" class="r">Handed off</th><th scope="col" class="r">Failed</th><th scope="col" class="r">Skipped</th><th scope="col">Note</th></tr></thead><tbody id="au-runs"></tbody></table></div>';
    after.insertAdjacentElement("afterend", sec);
    var $ = function (id) { return sec.querySelector("#" + id); };
    var st = null, draft = null, busy = false;
    libraryView($("au-lib"), { manageOnly: true, selected: function () { return []; }, onChange: function () {} });
    function say(t, bad) { var el = $("au-msg"); if (el) { el.textContent = t; el.style.color = bad ? "var(--bad)" : ""; } else if (t) toast(t, bad ? "err" : "ok"); }
    function when(iso) { return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date(iso)) + " WIB"; }
    function ready() {
      var r = (st && st.ready) || {}, tick = function (ok, t, fix) { return '<span class="sc-r ' + (ok ? "ok" : "no") + '">' + (ok ? "✓ " : "✕ ") + t + (ok ? "" : ' <span class="muted small">— ' + fix + "</span>") + "</span>"; };
      $("au-ready").innerHTML = tick(r.cron, "Scheduler", "add CRON_SECRET in Vercel → Environment Variables, then redeploy") + tick(r.serviceKey, "Server access to the master", "SUPABASE_SERVICE_ROLE_KEY in Vercel") + tick(r.flow, "Power Automate e-mail flow", "POWER_AUTOMATE_EMAIL_URL + POWER_AUTOMATE_SECRET");
    }
    function list() {
      var items = (st && st.automations) || [];
      $("au-list").innerHTML = items.length ? items.map(function (a) {
        var skipped = a.skip && a.nextSlot !== a.skip ? "" : "";
        return '<article class="au-card' + (a.enabled ? " on" : "") + '" data-id="' + esc(a.id) + '"><div class="au-card-h"><span class="au-pill ' + (a.enabled ? "on" : "off") + '">' + (a.enabled ? "On" : "Off") + '</span><b>' + esc(a.name) + '</b><span class="muted small">' + esc(KINDS[a.kind]) + "</span></div>" +
          '<div class="au-card-b"><span>🗓 ' + esc(a.describe) + "</span>" +
          '<span>' + (a.enabled && a.next.length ? "Next: <b>" + esc(when(a.next[0])) + "</b>" + (a.skip ? ' <span class="fu-tagx mid">skipping ' + esc(a.skip.replace("@", " ") + ":00") + "</span>" : "") : '<span class="muted">Not scheduled (switched off)</span>') + "</span>" +
          '<span>' + (a.notify.enabled ? "🔔 Reminder " + a.notify.leadHours + " h before" + (a.noticeAt ? " (" + esc(when(a.noticeAt)) + ")" : "") + " to " + esc(a.noticeTo.join(", ")) : '<span class="t-bad">No reminder before sending</span>') + "</span>" +
          '<span class="muted small">Files: ' + esc(a.kind === "recap" ? "Executive summary PDF only (" + execText() + ")" : [a.attachments.pdf ? "PDF" : "", a.attachments.xlsx ? "Excel" : ""].concat(a.attachments.library.map(function (id) { var f = (st.library || []).find(function (x) { return x.id === id; }); return f ? f.name : "(removed file)"; })).filter(Boolean).join(" + ") || "none") + "</span></div>" +
          '<div class="au-card-a"><button type="button" class="btn btn-secondary btn-sm" data-au="edit">Edit</button><button type="button" class="btn btn-secondary btn-sm" data-au="preview">Preview</button>' +
          (st.canRun ? '<button type="button" class="btn btn-ghost btn-sm" data-au="toggle">' + (a.enabled ? "Switch off" : "Switch on") + "</button>" + (a.enabled && a.next.length ? '<button type="button" class="btn btn-ghost btn-sm" data-au="skip">' + (a.skip ? "Undo skip" : "Skip next run") + "</button>" : "") + '<button type="button" class="btn btn-ghost btn-sm" data-au="run">Send now…</button><button type="button" class="btn btn-ghost btn-sm t-bad" data-au="delete">Delete</button>' : "") + "</div></article>";
      }).join("") : '<div class="au-empty"><b>No automation yet.</b><span class="muted small">Create one: for example a weekly follow-up every Monday 09:00 WIB, or a monthly summary PDF to all suppliers.</span></div>';
    }
    function runs() {
      var l = (st && st.runs) || [];
      $("au-runs").innerHTML = l.length ? l.map(function (r) {
        var what = r.kind === "notice" ? (r.test ? "Test reminder" : "Reminder") + " → " + esc((r.to || []).join(", ")) : r.manual ? "Send now" : "Scheduled run";
        return "<tr><td>" + esc(when(r.at)) + "</td><td>" + esc(r.name || r.automation || "—") + "</td><td>" + what + '</td><td class="r">' + (r.kind === "notice" ? (r.ok ? "✓" : "—") : (r.sent || 0)) + '</td><td class="r">' + (r.failed ? '<b class="t-bad">' + r.failed + "</b>" : r.kind === "notice" && !r.ok ? '<b class="t-bad">✕</b>' : 0) + '</td><td class="r">' + (r.skipped || 0) + "</td><td>" + esc(r.error || r.note || "") + "</td></tr>";
      }).join("") : '<tr><td colspan="7" class="muted">Nothing has run yet.</td></tr>';
    }
    async function load() {
      try { st = await api("/api/imds-master/followups/schedule"); ready(); list(); runs(); $("au-new").hidden = !st.canRun; }
      catch (e) { $("au-ready").textContent = e.message; }
      await loadLibrary();
      if (st && st.automations.some(function (a) { return a.kind === "recap"; }) && await publishExecSummary(false)) list();
    }
    setInterval(function () { if (st && st.automations.some(function (a) { return a.kind === "recap" && a.enabled; })) publishExecSummary(false); }, 2 * 3600000);
    async function saveAll(mutate, msg) {
      var g = await api("/api/imds-master/settings?key=followup_config"), value = Object.assign({}, g.value || {});
      value.automations = mutate((value.automations || []).slice());
      await api("/api/imds-master/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "followup_config", value: value, baseVersion: g.version }) });
      if (typeof window.__imdsReloadMailSettings === "function") window.__imdsReloadMailSettings();
      await load(); if (msg) toast(msg, "ok");
    }
    function todayIso() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()); }
    function blank() { return { id: "a" + Date.now().toString(36), name: "Weekly follow-up", enabled: false, kind: "followup", frequency: "weekly", days: [1], hour: 9, anchor: todayIso(), monthWeek: 1, templateId: "", sender: (function () { var last = lsGet("imds-sender"); return st.team.some(function (t) { return t.name === last; }) ? last : (st.team[0] || {}).name || ""; })(), models: [], includeWorking: false, onlyPastDue: false, maxSuppliers: 60, fallbackMid: true, cc: { mid: false, top: false, dir: false, buyer: true }, attachments: { pdf: true, xlsx: true, library: [] }, notify: { enabled: true, leadHours: 24, to: [] }, skip: "" }; }
    function editor() {
      var a = draft, ed = $("au-edit"), team = st.team || [], tl = (st.templates || []).filter(function (t) { return t.kind === a.kind; });
      var recap = a.kind === "recap", keys = typeof M === "object" && M.keys ? M.keys().filter(function (k) { return k !== "UNASSIGNED"; }) : [];
      a.models.forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      var me = (team.find(function (t) { return t.name === a.sender; }) || team[0] || {}).email || "";
      ed.innerHTML = '<div class="au-edit-h"><h3>' + (st.automations.some(function (x) { return x.id === a.id; }) ? "Edit automation" : "New automation") + '</h3><span class="muted small">Nothing is sent while you edit. Save keeps it; switch it on when the preview looks right.</span></div>' +
        '<div class="mh"><i>1</i>Name and type</div><div class="fu-grid"><label class="field"><span>Name</span><input type="text" id="ae-name" value="' + esc(a.name) + '" maxlength="80"></label>' +
        '<label class="field"><span>What to send</span><select id="ae-kind">' + Object.keys(KINDS).map(function (k) { return '<option value="' + k + '"' + (a.kind === k ? " selected" : "") + ">" + KINDS[k] + "</option>"; }).join("") + "</select></label>" +
        '<label class="sc-switch" style="align-self:end"><input type="checkbox" id="ae-on"' + (a.enabled ? " checked" : "") + "> <b>Switched on</b></label></div>" +
        '<div class="mh"><i>2</i>When</div><div class="fu-grid"><label class="field"><span>How often</span><select id="ae-freq"><option value="weekly">Every week</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Every month</option></select></label>' +
        '<div class="field"><span>Day(s)</span><div class="sc-days" id="ae-days">' + DAYS.map(function (d) { return '<button type="button" class="fu-chip" data-day="' + d[0] + '" aria-pressed="' + (a.days.indexOf(d[0]) >= 0) + '">' + d[1] + "</button>"; }).join("") + "</div></div>" +
        '<label class="field"><span>Time (WIB)</span><select id="ae-hour">' + Array.from({ length: 24 }, function (_, h) { var t = (h < 10 ? "0" : "") + h; return '<option value="' + h + '"' + (a.hour === h ? " selected" : "") + ">" + t + ":00 – " + t + ":59</option>"; }).join("") + "</select></label>" +
        (a.frequency === "biweekly" ? '<label class="field"><span>First sending week (any date in it)</span><input type="date" id="ae-anchor" value="' + esc(a.anchor) + '"></label>' : "") +
        (a.frequency === "monthly" ? '<label class="field"><span>Week of the month</span><select id="ae-mweek">' + [[1, "First"], [2, "Second"], [3, "Third"], [4, "Fourth"], [5, "Last"]].map(function (w) { return '<option value="' + w[0] + '"' + (a.monthWeek === w[0] ? " selected" : "") + ">" + w[1] + " week</option>"; }).join("") + "</select></label>" : "") +
        "</div><p class=\"muted small\" id=\"ae-when\"></p>" +
        '<div class="mh"><i>3</i>Which parts</div><div class="fu-grid"><div class="fu-box"><h3>Models</h3><div class="fu-chips" id="ae-models">' + (keys.map(function (k) { return '<button type="button" class="fu-chip" data-m="' + esc(k) + '" aria-pressed="' + (a.models.indexOf(k) >= 0) + '">' + esc(k) + "</button>"; }).join("") || '<span class="muted small">Models appear once the master is loaded.</span>') + '</div><p class="muted small" style="margin:4px 0 0">' + (a.models.length ? "Only the selected models." : "All models (tap to limit).") + "</p></div>" +
        '<div class="fu-box"><h3>Parts and limits</h3><div class="fu-ccs"><label class="inline-check"><input type="checkbox" id="ae-working"' + (a.includeWorking ? " checked" : "") + "> Also parts under TMMIN judgement (Working)</label><label class=\"inline-check\"><input type=\"checkbox\" id=\"ae-pastdue\"" + (a.onlyPastDue ? " checked" : "") + "> Only suppliers with a part past its target date</label></div>" +
        (recap ? "" : '<label class="field" style="margin-top:8px"><span>At most, suppliers per run</span><input type="number" id="ae-max" min="1" max="300" value="' + a.maxSuppliers + '"></label>') + "</div></div>" +
        '<div class="mh"><i>4</i>Message</div><div class="fu-grid"><label class="field"><span>Template</span><select id="ae-tpl"><option value="">Default ' + ({ followup: "follow-up", request: "request", recap: "status recap" })[a.kind] + " template</option>" + tl.map(function (t) { return '<option value="' + esc(t.id) + '"' + (a.templateId === t.id ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") + "</select></label>" +
        '<label class="field"><span>Sender (sign-off)</span><select id="ae-sender">' + team.map(function (t) { return '<option value="' + esc(t.name) + '"' + (a.sender === t.name ? " selected" : "") + ">" + esc(t.name) + " · " + esc(t.email) + "</option>"; }).join("") + "</select></label></div>" +
        '<div class="mh"><i>5</i>Recipients and files</div><div class="fu-grid"><div class="fu-box"><h3>CC</h3><div class="fu-ccs"><label class="inline-check"><input type="checkbox" id="ae-cc-mid"' + (a.cc.mid ? " checked" : "") + '> Middle management</label><label class="inline-check"><input type="checkbox" id="ae-cc-top"' + (a.cc.top ? " checked" : "") + '> Top management</label><label class="inline-check"><input type="checkbox" id="ae-cc-dir"' + (a.cc.dir ? " checked" : "") + '> Director</label><label class="inline-check"><input type="checkbox" id="ae-cc-buyer"' + (a.cc.buyer ? " checked" : "") + '> PUD buyer</label><label class="inline-check"><input type="checkbox" id="ae-fallback"' + (a.fallbackMid ? " checked" : "") + "> No IMDS PIC → send to middle management</label></div><p class=\"muted small\" style=\"margin:6px 0 0\">Always: the mandatory CC, the IMDS team and “Always CC” contacts.</p></div>" +
        (recap ? '<div class="fu-box"><h3>File</h3><p style="margin:0 0 6px"><b>Executive summary PDF</b> only — the same PDF as the “Executive summary PDF” button, made by the Tracker from its data.</p><p class="muted small" style="margin:0 0 8px" id="ae-exec">' + esc(execText()) + '</p><div class="fu-bar" style="margin:0"><button type="button" class="btn btn-secondary btn-sm" id="ae-exec-now">Update it now</button>' + (LIB.exec ? '<a class="link-btn" href="/api/imds-master/attachments?id=sys_exec_summary" download>Download to check</a>' : "") + '</div><p class="muted small" style="margin:8px 0 0">Not made yet or older than 7 days at sending time → the summary is not sent and the reminder says so.</p><input type="checkbox" id="ae-pdf" checked hidden><input type="checkbox" id="ae-xlsx" hidden></div></div>' :
        '<div class="fu-box"><h3>Files</h3><div class="fu-ccs"><label class="inline-check"><input type="checkbox" id="ae-pdf"' + (a.attachments.pdf ? " checked" : "") + '> PDF recap of the supplier’s parts</label><label class="inline-check"><input type="checkbox" id="ae-xlsx"' + (a.attachments.xlsx ? " checked" : "") + '> Excel list (supplier fills the plan date)</label></div><p class="muted small" style="margin:8px 0 4px">Standard files (attached unchanged):</p><div id="ae-lib"></div></div></div>') +
        '<div class="mh"><i>6</i>Reminder to the TMMIN PIC before sending</div><div class="fu-grid"><label class="sc-switch"><input type="checkbox" id="ae-notify"' + (a.notify.enabled ? " checked" : "") + '> <b>Send a reminder first</b></label>' +
        '<label class="field"><span>How long before</span><select id="ae-lead">' + [1, 2, 4, 12, 24, 48, 72].map(function (h) { return '<option value="' + h + '"' + (a.notify.leadHours === h ? " selected" : "") + ">" + (h < 24 ? h + " hour" + (h > 1 ? "s" : "") : h / 24 + " day" + (h > 24 ? "s" : "")) + " before</option>"; }).join("") + "</select></label>" +
        '<label class="field"><span>Reminder to (separate with ;)</span><input type="text" id="ae-to" value="' + esc(a.notify.to.join("; ")) + '" placeholder="' + esc(me) + ' (the sender)"></label></div>' +
        '<div class="fu-bar au-edit-bar"><button type="button" class="btn btn-primary btn-sm" id="ae-save">Save</button><button type="button" class="btn btn-secondary btn-sm" id="ae-preview">Preview this run</button><button type="button" class="btn btn-secondary btn-sm" id="ae-notice">Send the reminder now (test)</button><button type="button" class="btn btn-ghost btn-sm" id="ae-cancel">Close</button><span class="muted small" id="au-msg" role="status"></span></div>';
      ed.querySelector("#ae-freq").value = a.frequency;
      if (ed.querySelector("#ae-lib")) libraryView(ed.querySelector("#ae-lib"), { selected: function () { return draft ? draft.attachments.library : []; }, onChange: function (ids) { draft.attachments.library = ids; } });
      whenText();
    }
    function whenText() {
      var a = draft, el = $("ae-when"); if (!el) return;
      var h = (a.hour < 10 ? "0" : "") + a.hour, names = a.days.map(function (d) { return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d]; }).join(", ");
      el.textContent = !a.days.length ? "Pick at least one day." : (a.frequency === "biweekly" ? "Every 2 weeks (starting the week of " + a.anchor + ") on " : a.frequency === "monthly" ? "Every month, " + ["", "first", "second", "third", "fourth", "last"][a.monthWeek] + " week, on " : "Every ") + names + ", between " + h + ":00 and " + h + ":59 WIB." + (a.notify.enabled ? " Reminder " + a.notify.leadHours + " h before." : "");
    }
    function read() {
      var a = draft, ed = $("au-edit"), v = function (id) { var el = ed.querySelector("#" + id); return el ? el : null; };
      a.name = v("ae-name").value.trim() || "Automatic follow-up"; a.enabled = v("ae-on").checked;
      var kind = v("ae-kind").value; if (kind !== a.kind) { a.kind = kind; a.templateId = ""; } else a.templateId = v("ae-tpl").value;
      a.frequency = v("ae-freq").value; a.hour = Number(v("ae-hour").value);
      if (v("ae-anchor")) a.anchor = v("ae-anchor").value || a.anchor; if (v("ae-mweek")) a.monthWeek = Number(v("ae-mweek").value);
      a.includeWorking = v("ae-working").checked; a.onlyPastDue = v("ae-pastdue").checked; if (v("ae-max")) a.maxSuppliers = Math.max(1, Math.min(300, Number(v("ae-max").value) || 60));
      a.sender = v("ae-sender").value;
      a.cc = { mid: v("ae-cc-mid").checked, top: v("ae-cc-top").checked, dir: v("ae-cc-dir").checked, buyer: v("ae-cc-buyer").checked }; a.fallbackMid = v("ae-fallback").checked;
      a.attachments.pdf = v("ae-pdf").checked; a.attachments.xlsx = v("ae-xlsx").checked; if (a.kind === "recap") { a.attachments = { pdf: true, xlsx: false, library: [] }; }
      a.notify = { enabled: v("ae-notify").checked, leadHours: Number(v("ae-lead").value), to: v("ae-to").value.split(/[;,\s]+/).map(function (x) { return x.trim(); }).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); }) };
    }
    function openEditor(a) { draft = JSON.parse(JSON.stringify(a)); $("au-edit").hidden = false; editor(); $("au-prev").hidden = true; $("au-edit").scrollIntoView({ behavior: "smooth", block: "start" }); }
    $("au-new").onclick = function () { if (st) openEditor(blank()); };
    sec.addEventListener("click", async function (ev) {
      var t = ev.target;
      var day = t.closest && t.closest("#ae-days [data-day]"), mod = t.closest && t.closest("#ae-models [data-m]");
      if (day && draft) { read(); var n = Number(day.getAttribute("data-day")), i = draft.days.indexOf(n); if (i >= 0) draft.days.splice(i, 1); else draft.days.push(n); draft.days.sort(); editor(); return; }
      if (mod && draft) { read(); var k = mod.getAttribute("data-m"), j = draft.models.indexOf(k); if (j >= 0) draft.models.splice(j, 1); else draft.models.push(k); editor(); return; }
      var card = t.closest && t.closest(".au-card"), act = t.closest && t.closest("[data-au]");
      if (card && act && st) {
        var a = st.automations.find(function (x) { return x.id === card.getAttribute("data-id"); }); if (!a) return;
        var what = act.getAttribute("data-au");
        try {
          if (what === "edit") openEditor(a);
          else if (what === "preview") { draft = JSON.parse(JSON.stringify(a)); $("au-edit").hidden = true; preview(); }
          else if (what === "toggle") await saveAll(function (l) { return l.map(function (x) { return x.id === a.id ? Object.assign({}, x, { enabled: !a.enabled }) : x; }); }, a.enabled ? "Switched off" : "Switched on — " + a.describe);
          else if (what === "skip") await saveAll(function (l) { return l.map(function (x) { return x.id === a.id ? Object.assign({}, x, { skip: a.skip ? "" : a.nextSlot }) : x; }); }, a.skip ? "The next run will send again" : "The next run (" + when(a.next[0]) + ") will be skipped");
          else if (what === "delete") { if (window.confirm("Delete the automation “" + a.name + "”? Nothing is sent by it any more.")) await saveAll(function (l) { return l.filter(function (x) { return x.id !== a.id; }); }, "Automation deleted"); }
          else if (what === "run") {
            if (!window.confirm("Send “" + a.name + "” NOW to the suppliers in its preview (live e-mails through Power Automate)? Check the preview first.")) return;
            if (a.kind === "recap") await publishExecSummary(true);
            toast("Sending… this can take a few minutes.", "info");
            var r = await api("/api/imds-master/followups/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run-now", id: a.id }) });
            draft = JSON.parse(JSON.stringify(a)); showPlan(r, "Sent now"); toast(r.sent + " handed off, " + r.failed + " failed, " + r.skipped + " skipped", r.failed ? "err" : "ok"); load();
          }
        } catch (e) { toast(e.message, "err"); }
        return;
      }
      var id = t.id;
      if (id === "ae-cancel") { draft = null; $("au-edit").hidden = true; return; }
      if (id === "ae-save" && draft) {
        read(); if (!draft.days.length) { say("Pick at least one day.", true); return; }
        var d = draft;
        try { await saveAll(function (l) { var i = l.findIndex(function (x) { return x.id === d.id; }); if (i >= 0) l[i] = d; else l.push(d); return l; }, d.enabled ? "Saved and switched on" : "Saved (switched off)"); $("au-edit").hidden = true; draft = null; }
        catch (e) { say(e.message, true); }
        return;
      }
      if (id === "ae-preview" && draft) { read(); preview(); return; }
      if (id === "ae-exec-now") { var el = $("ae-exec"); el.textContent = "Making the executive summary PDF…"; var ok = await publishExecSummary(true); if (ok && draft) { read(); editor(); } else el.textContent = "Could not make it here (load the data first; reviewer, preparer or admin role)."; list(); return; }
      if (id === "ae-notice" && draft) {
        read(); say("Sending the reminder…");
        try { var n = await api("/api/imds-master/followups/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notice-test", automation: draft }) }); say("Reminder handed off to " + n.to.join(", ") + "."); load(); }
        catch (e) { say(e.message, true); }
      }
    });
    sec.addEventListener("change", function (ev) { if (!draft || !ev.target.id || ev.target.id.indexOf("ae-") !== 0) return; var re = ["ae-kind", "ae-freq"].indexOf(ev.target.id) >= 0; read(); if (re) editor(); else whenText(); });
    var plan = null;
    async function preview() {
      if (busy) return; busy = true;
      if (draft && draft.kind === "recap") await publishExecSummary(false);
      var box = $("au-prev"); box.hidden = false; box.innerHTML = '<div class="fu-box"><p class="muted">Building the preview from the current master, Directory and files…</p></div>';
      try { var r = await api("/api/imds-master/followups/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", automation: draft }) }); showPlan(r, "Preview of the next run — nothing is sent"); }
      catch (e) { box.innerHTML = '<div class="fu-box"><p class="t-bad">' + esc(e.message) + "</p></div>"; }
      busy = false;
    }
    var sel = 0;
    function chip(p) {
      return p.skip ? '<span class="au-st held">Skipped</span>' : p.status === "FAILED" ? '<span class="au-st err">Failed</span>' : p.status === "HANDED_OFF" ? '<span class="au-st ok">Handed off</span>' : p.status === "SENT" ? '<span class="au-st ok">Sent</span>' : '<span class="au-st go">Will send</span>';
    }
    function showPlan(r, title) {
      plan = r; var rows = r.planned || [], box = $("au-prev"); box.hidden = false;
      var go = rows.filter(function (p) { return !p.skip; }).length;
      sel = Math.max(0, rows.findIndex(function (p) { return !p.skip; }));
      box.innerHTML = '<div class="fu-box au-planbox"><div class="au-plan-h"><div><h3>' + esc(title) + "</h3>" +
        '<div class="au-stats"><span><b>' + go + "</b> e-mail" + (go === 1 ? "" : "s") + "</span>" + (rows.length - go ? "<span><b>" + (rows.length - go) + "</b> skipped</span>" : "") + (r.runAt ? "<span>Runs " + esc(when(r.runAt)) + "</span>" : "") + "<span>From " + esc(r.from) + "</span></div>" +
        (r.note ? '<p class="small t-warn" style="margin:4px 0 0">' + esc(r.note) + "</p>" : "") + '</div><button type="button" class="btn btn-ghost btn-sm" id="au-prev-x">Close preview</button></div>' +
        (rows.length ? '<div class="au-split"><div class="au-side"><label class="au-pick"><span class="sr-only">E-mail</span><select id="au-sel">' + rows.map(function (p, i) { return '<option value="' + i + '">' + esc(p.supplier) + (p.skip ? " — skipped" : "") + "</option>"; }).join("") + "</select></label>" +
          '<ul class="au-sup" role="listbox" aria-label="E-mails in this run">' + rows.map(function (p, i) {
            return '<li><button type="button" role="option" data-pi="' + i + '" aria-selected="false"><span class="au-sup-n">' + esc(p.supplier) + "</span>" + chip(p) +
              '<span class="au-sup-m">' + p.parts + " part" + (p.parts === 1 ? "" : "s") + (p.to.length ? " · " + esc(p.to[0]) + (p.to.length > 1 ? " +" + (p.to.length - 1) : "") : "") + "</span></button></li>";
          }).join("") + '</ul></div><div class="au-detail" id="au-detail" aria-live="polite"></div></div>'
          : '<p class="muted">No supplier has outstanding parts for these settings.</p>') + "</div>";
      if (rows.length) pick(sel);
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function pick(i) {
      var rows = plan.planned, p = rows[i]; if (!p) return; sel = i;
      Array.prototype.forEach.call($("au-prev").querySelectorAll(".au-sup [data-pi]"), function (b) { b.setAttribute("aria-selected", String(Number(b.getAttribute("data-pi")) === i)); });
      var s2 = $("au-sel"); if (s2) s2.value = String(i);
      var on = $("au-prev").querySelector('.au-sup [data-pi="' + i + '"]'); if (on) on.scrollIntoView({ block: "nearest" });
      var tag = p.toFrom === "mid" ? ' <span class="fu-tagx mid">no IMDS PIC → middle management</span>' : p.toFrom === "master" ? ' <span class="fu-tagx">from the master sheet</span>' : "";
      $("au-detail").innerHTML = '<div class="au-nav"><button type="button" class="btn btn-ghost btn-sm" data-step="-1"' + (i ? "" : " disabled") + '>‹ Previous</button><span class="muted small">' + (i + 1) + " of " + rows.length + '</span><button type="button" class="btn btn-ghost btn-sm" data-step="1"' + (i < rows.length - 1 ? "" : " disabled") + ">Next ›</button></div>" +
        '<div class="au-mh"><span>Supplier</span><b>' + esc(p.supplier) + (p.code ? ' <span class="muted">· ' + esc(p.code) + "</span>" : "") + " " + chip(p) + "</b>" +
        "<span>To</span><b>" + (esc(p.to.join("; ")) || "—") + tag + "</b>" +
        '<span>CC</span><b><details class="au-cc"><summary>' + p.cc.length + " people</summary>" + esc(p.cc.join("; ") || "—") + "</details></b>" +
        "<span>Subject</span><b>" + esc(p.subject) + "</b>" +
        '<span>Files</span><b class="au-files-l">' + (p.attachments.length ? p.attachments.map(function (n) { return '<span class="au-file">📎 ' + esc(n) + "</span>"; }).join("") : "none") + "</b></div>" +
        (p.info ? '<p class="small muted" style="margin:0 0 8px">' + esc(p.info) + "</p>" : "") +
        (p.skip ? '<p class="fu-res held" style="margin:0 0 8px">Not sent: ' + esc(p.skip) + "</p>" : "") +
        (p.status === "FAILED" ? '<p class="fu-res err" style="margin:0 0 8px">' + esc(p.error || "Failed") + "</p>" : "") +
        (p.body ? '<div class="fs-preview au-body">' + previewHtml(p.body) + "</div>" : "") +
        (p.body && !p.skip ? '<div class="fu-bar" style="margin:10px 0 0"><button type="button" class="btn btn-secondary btn-sm" data-draft="' + esc(p.supplier) + '">Download as Outlook draft (with the real files)</button><span class="muted small" id="au-draft-msg"></span></div>' : "");
    }
    $("au-prev").addEventListener("change", function (ev) { if (ev.target.id === "au-sel") pick(Number(ev.target.value)); });
    $("au-prev").addEventListener("keydown", function (ev) {
      if (!plan || !ev.target.closest(".au-sup")) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); var n = Math.max(0, Math.min(plan.planned.length - 1, sel + (ev.key === "ArrowDown" ? 1 : -1))); pick(n); var b = $("au-prev").querySelector('.au-sup [data-pi="' + n + '"]'); if (b) b.focus(); }
    });
    $("au-prev").addEventListener("click", async function (ev) {
      if (ev.target.id === "au-prev-x") { $("au-prev").hidden = true; return; }
      var o = ev.target.closest("[data-pi]"); if (o && plan) { pick(Number(o.getAttribute("data-pi"))); return; }
      var stp = ev.target.closest("[data-step]"); if (stp && plan) { pick(sel + Number(stp.getAttribute("data-step"))); return; }
      var d = ev.target.closest("[data-draft]");
      if (d && draft) {
        var m = $("au-draft-msg"); m.textContent = "Building the draft with its files…";
        try {
          var r = await api("/api/imds-master/followups/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", automation: draft, supplier: d.getAttribute("data-draft") }) });
          var bin = atob(r.eml), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          var url = URL.createObjectURL(new Blob([bytes], { type: "message/rfc822" })), link = document.createElement("a"); link.href = url; link.download = r.fileName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          m.textContent = "Downloaded " + r.fileName + " · files: " + r.attachments.map(function (x) { return x.name; }).join(", ") + ". Nothing was sent.";
        } catch (e) { m.textContent = e.message; m.style.color = "var(--bad)"; }
      }
    });
    return { open: load };
  }

  function initFollowupSettings(settings, after) {
    injectFollowCss();
    var sec = document.createElement("section");
    sec.className = "panel"; sec.id = "followup-settings-panel"; sec.hidden = true;
    sec.innerHTML = '<div class="panel-head"><div><h2>E-mail templates and rules</h2><p class="panel-sub">Templates for the three e-mail types, the mandatory CC and the defaults. Saved on the server for everyone. Automatic sending and standard files are in <b>Follow-up → Automatic</b>.</p></div></div>' +
      '<div id="fs-msg" class="banner" role="status">Loading…</div><div id="fs-sql" hidden></div>' +
      '<div class="fu-grid"><label class="field"><span>Template</span><select id="fs-tsel"></select></label>' +
      '<div class="fu-bar" style="margin:0;align-self:end"><button type="button" class="btn btn-secondary btn-sm" id="fs-add">+ New</button><button type="button" class="btn btn-secondary btn-sm" id="fs-dup">Duplicate</button><button type="button" class="btn btn-ghost btn-sm" id="fs-del">Delete</button><button type="button" class="btn btn-ghost btn-sm" id="fs-def">Make default</button></div></div>' +
      '<div class="fu-box"><div class="fu-grid"><label class="field"><span>Type</span><select id="fs-kind"><option value="request">Request (kick-off)</option><option value="followup">Follow-up (per supplier)</option><option value="recap">Status recap (all suppliers)</option></select></label><label class="field"><span>Template name</span><input type="text" id="fs-name"></label></div>' +
      '<label class="field"><span>Subject</span><input type="text" id="fs-subj" style="width:100%"></label><label class="field"><span>Message</span><textarea id="fs-body" style="width:100%;min-height:320px;font:13px/1.45 ui-monospace,monospace"></textarea></label>' +
      '<p class="muted small" style="margin:6px 0 0">Placeholders: <code>{supplier}</code> <code>{code}</code> <code>{count}</code> <code>{projects}</code> <code>{deadlines}</code> <code>{partlist}</code> <code>{models}</code> <code>{modelshort}</code> <code>{sender}</code> <code>{sendername}</code> <code>{greeting}</code> <code>{date}</code> <code>{updated}</code> <code>{duedate}</code></p></div>' +
      '<div class="fu-grid"><div class="fu-box"><h3>Mandatory CC (added to every e-mail; cannot be removed when sending)</h3><textarea id="fs-req" rows="4" style="width:100%" placeholder="one e-mail per line"></textarea></div>' +
      '<div class="fu-box"><h3>CC by default</h3><div class="fu-ccs"><label class="inline-check"><input type="checkbox" id="fs-mid"> Middle management</label><label class="inline-check"><input type="checkbox" id="fs-top"> Top management</label><label class="inline-check"><input type="checkbox" id="fs-dir"> Director</label><label class="inline-check"><input type="checkbox" id="fs-buyer"> PUD buyer</label></div>' +
      '<h3 style="margin-top:12px">No IMDS PIC?</h3><label class="inline-check"><input type="checkbox" id="fs-fallback"> Send to middle management instead <span class="muted small">(staff / supervisor, else dept. head / GM)</span></label></div>' +
      '<div class="fu-box"><h3>Attachments by default</h3><label class="inline-check"><input type="checkbox" id="fs-pdf"> PDF</label><br><label class="inline-check"><input type="checkbox" id="fs-xlsx"> Excel list of parts</label></div></div>' +
      '<div class="fu-grid"><div class="fu-box"><h3>Signature (added under every e-mail)</h3><textarea id="fs-sig" rows="5" style="width:100%" placeholder="Best regards,&#10;&#10;{sendername}&#10;TMMIN - Material Engineering"></textarea><p class="muted small" style="margin:6px 0 0">Not added twice: a template that already ends with “Best regards” keeps its own.</p></div>' +
      '<div class="fu-box"><h3>Full name per sender ({sendername})</h3><textarea id="fs-names" rows="5" style="width:100%" placeholder="Werner = Abdullah Luthfi Werner"></textarea><p class="muted small" style="margin:6px 0 0">One per line: <code>short name = full name</code>.</p></div></div>' +
      '<div class="fu-grid"><div class="fu-box"><h3>Footer per sender (optional, replaces the signature for that sender)</h3><div class="fu-grid" style="margin:0 0 6px"><label class="field"><span>Sender</span><select id="fs-fsender"></select></label><label class="field"><span>Or a new sender (short name)</span><input type="text" id="fs-fnew" placeholder="e.g. Hendrick"></label></div>' +
      '<textarea id="fs-foot" rows="6" style="width:100%" placeholder="Empty = use the signature above.&#10;&#10;Best regards,&#10;&#10;{sendername}&#10;IMDS PIC · Material Engineering&#10;TMMIN · Ext. 1234"></textarea><p class="muted small" style="margin:6px 0 0" id="fs-fhint">Each sender can have its own footer (name, title, phone). Empty uses the shared signature.</p></div>' +
      '<div class="fu-box"><h3>E-mail font and layout</h3><div class="fu-grid" style="margin:0"><label class="field"><span>Font</span><select id="fs-font">' + FONT_FAMILIES.map(function (f) { return '<option>' + f + '</option>'; }).join("") + '</select></label><label class="field"><span>Size</span><select id="fs-size">' + [9, 10, 11, 12, 13, 14, 16].map(function (n) { return '<option value="' + n + '">' + n + ' pt</option>'; }).join("") + '</select></label></div>' +
      '<p class="muted small" style="margin:6px 0">Outlook shows the e-mail in this font. Blank lines start a new paragraph; lines starting with “•”, “-” or “1.” become lists; links are clickable; an ALL-CAPS line (e.g. IMPORTANT NOTES) is bold.</p>' +
      '<div class="fs-preview" id="fs-prev" aria-label="Preview of the selected template with the footer of the chosen sender"></div></div></div>' +
      '<div class="fu-bar"><button type="button" class="btn btn-primary btn-sm" id="fs-save">Save</button><button type="button" class="btn btn-ghost btn-sm" id="fs-reset">Restore built-in templates</button><span class="muted small" id="fs-ver"></span></div>';
    after.insertAdjacentElement("afterend", sec);
    initTemplateWorkspaceTabs(sec);
    var $ = function (id) { return sec.querySelector("#" + id); };
    var cfg = null, version = 0, cur = 0, builtin = null;
    function say(t, bad) { var m = $("fs-msg"); m.textContent = t; m.style.color = bad ? "var(--bad)" : ""; }
    function stash() { if (!cfg || !cfg.templates[cur]) return; var t = cfg.templates[cur]; t.name = $("fs-name").value; t.subject = $("fs-subj").value; t.body = $("fs-body").value; t.kind = $("fs-kind").value; }
    function label(t) { return (KIND_META[t.kind] ? KIND_META[t.kind].label : t.kind) + " · " + t.name + (cfg.defaults[t.kind] === t.id ? " (default)" : ""); }
    function fillList() { $("fs-tsel").innerHTML = cfg.templates.map(function (t, i) { return '<option value="' + i + '">' + esc(label(t)) + "</option>"; }).join(""); $("fs-tsel").value = String(cur); }
    function fillTemplate() { var t = cfg.templates[cur]; $("fs-name").value = t.name; $("fs-subj").value = t.subject; $("fs-body").value = t.body; $("fs-kind").value = t.kind; }
    function fillAll() {
      fillList(); fillTemplate();
      $("fs-req").value = cfg.requiredCc.join("\n"); $("fs-mid").checked = cfg.ccRoles.mid; $("fs-top").checked = cfg.ccRoles.top; $("fs-dir").checked = !!cfg.ccRoles.dir; $("fs-buyer").checked = cfg.ccRoles.buyer; $("fs-fallback").checked = cfg.fallbackMid !== false;
      $("fs-pdf").checked = cfg.attachments.pdf; $("fs-xlsx").checked = cfg.attachments.xlsx;
      $("fs-sig").value = cfg.signature || ""; $("fs-names").value = Object.keys(cfg.senderNames || {}).map(function (k) { return k + " = " + cfg.senderNames[k]; }).join("\n");
      cfg.senderFooters = cfg.senderFooters || {}; cfg.font = cfg.font || { family: "Calibri", sizePt: 11 };
      $("fs-font").value = cfg.font.family; $("fs-size").value = String(cfg.font.sizePt);
      fillFooterSenders(); preview();
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
        if (!g || !g.value || !Array.isArray(g.value.templates)) throw new Error("The e-mail templates could not be loaded from the server. Reload the page; if this stays, apply the tracker settings migration (Follow-up → Templates & rules).");
        cfg = g.value; version = g.version; mailCfg = Object.assign({}, cfg, { __missingTable: !!g.tableMissing, __version: g.version });
        if (!builtin) builtin = JSON.parse(JSON.stringify(cfg));
        cur = Math.max(0, cfg.templates.findIndex(function (t) { return t.id === cfg.defaults.followup; }));
        fillAll(); showSql(!!g.tableMissing);
        say(g.tableMissing ? "Showing the built-in templates. They work, but edits cannot be saved until the table is created (see below)." : "Edit a template or the rules, then save.", !!g.tableMissing);
        mailOnChange.forEach(function (fn) { fn(); });
      } catch (e) { say(e.message, true); }
    }
    var footSender = "";
    function senderKeys() { var k = Object.keys(cfg.senderNames || {}).concat(Object.keys(cfg.senderFooters || {})); return k.filter(function (x, i) { return k.indexOf(x) === i; }); }
    function stashFooter() { if (!footSender) return; var v = $("fs-foot").value.replace(/\s+$/, ""); if (v.trim()) cfg.senderFooters[footSender] = v; else delete cfg.senderFooters[footSender]; }
    function fillFooterSenders() {
      var keys = senderKeys(); if (!footSender || keys.indexOf(footSender) < 0) footSender = keys[0] || "";
      $("fs-fsender").innerHTML = keys.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + (cfg.senderFooters[k] ? " · own footer" : " · uses signature") + "</option>"; }).join("") || '<option value="">No senders yet</option>';
      $("fs-fsender").value = footSender; $("fs-foot").value = cfg.senderFooters[footSender] || "";
    }
    function preview() {
      if (!cfg) return; stash();
      var t = cfg.templates[cur], who = footSender || "", full = (cfg.senderNames || {})[who] || who;
      var ctx = { supplier: "PT SAMPLE SUPPLIER", code: "00000", count: 3, projects: "SAMPLE MODEL", deadlines: "• SAMPLE MODEL: 31 December 2026", partlist: "1. 00000-00000 · Sample part (plan: 15 December 2026)\n2. 00000-00001 · Sample part (plan: 15 December 2026)", models: "SAMPLE MODEL", modelshort: "SAMPLE", sender: who, sendername: full, greeting: "Good morning", date: "23 November 2026", updated: "23 November 2026", duedate: "30 November 2026" };
      var body = fill(t ? t.body : "", ctx), sig = String(footerOf({ signature: $("fs-sig").value, senderFooters: Object.assign({}, cfg.senderFooters, footSender ? (function () { var o = {}; o[footSender] = $("fs-foot").value; return o; })() : {}) }, who)).trim();
      if (sig) body = body.replace(/\s+$/, "") + "\n\n" + fill(sig, ctx);
      var box = $("fs-prev"); box.style.fontFamily = "'" + $("fs-font").value + "', Arial, sans-serif"; box.style.fontSize = $("fs-size").value + "pt";
      box.innerHTML = '<div class="muted small" style="margin:0 0 6px;font:12px/1.3 inherit">Preview · ' + esc(who || "no sender") + ' · sample values (FIXTURE)</div>' + previewHtml(body);
    }
    $("fs-fsender").onchange = function () { stashFooter(); footSender = $("fs-fsender").value; $("fs-foot").value = cfg.senderFooters[footSender] || ""; preview(); };
    $("fs-fnew").onchange = function () { var n = $("fs-fnew").value.trim().slice(0, 40); if (!n) return; stashFooter(); if (!cfg.senderNames[n]) cfg.senderNames[n] = n; footSender = n; $("fs-fnew").value = ""; $("fs-names").value = Object.keys(cfg.senderNames).map(function (k) { return k + " = " + cfg.senderNames[k]; }).join("\n"); fillFooterSenders(); preview(); };
    ["fs-foot", "fs-sig", "fs-body"].forEach(function (id) { $(id).addEventListener("input", preview); });
    ["fs-font", "fs-size"].forEach(function (id) { $(id).addEventListener("change", preview); });
    $("fs-tsel").onchange = function () { stash(); cur = Number($("fs-tsel").value); fillTemplate(); fillList(); preview(); };
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
      cfg.requiredCc = req; cfg.ccRoles = { mid: $("fs-mid").checked, top: $("fs-top").checked, dir: $("fs-dir").checked, buyer: $("fs-buyer").checked }; cfg.fallbackMid = $("fs-fallback").checked; cfg.attachments = { pdf: $("fs-pdf").checked, xlsx: $("fs-xlsx").checked };
      cfg.signature = $("fs-sig").value.trim(); stashFooter();
      cfg.font = { family: $("fs-font").value, sizePt: Number($("fs-size").value) };
      cfg.senderNames = {}; $("fs-names").value.split("\n").forEach(function (line) { var m = /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(line); if (m) cfg.senderNames[m[1]] = m[2]; });
      try {
        var clean = { templates: cfg.templates, defaults: cfg.defaults, requiredCc: cfg.requiredCc, ccRoles: cfg.ccRoles, attachments: cfg.attachments, signature: cfg.signature, senderNames: cfg.senderNames, senderFooters: cfg.senderFooters, font: cfg.font, fallbackMid: cfg.fallbackMid !== false, automations: cfg.automations || [] };
        var r = await api("/api/imds-master/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "followup_config", value: clean, baseVersion: version }) });
        version = r.version; await load(); say("Saved. The e-mail center uses these templates now.");
      } catch (e) { if (e.payload && e.payload.tableMissing) showSql(true); say(e.payload && e.payload.conflict ? e.message + " (Press F5 to reload.)" : e.message, true); }
    };
    window.__imdsReloadMailSettings = load;
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
    initGlobalDrop();
    initBuyerPaste();
    initDirectorySync().then(seedBuyers, seedBuyers);
    startFast();
    // Tracker part operations (target dates, Check, Stop run) reload the shared master after the server saved them.
    window.__imdsRefreshData = function () { return refreshSharedMaster(true); };
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