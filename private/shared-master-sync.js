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

  async function refreshSharedMaster(silent) {
    if (busy) return;
    busy = true;
    try {
      var response = await fetch("/api/imds-master/tracker-data", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      var payload = await response.json();
      if (!response.ok) throw new Error(payload && payload.error ? payload.error : "Shared master could not be loaded.");
      if (!Array.isArray(payload.rows)) throw new Error("Shared master response is invalid.");

      var dataset = buildSharedDataset(payload.rows);
      if (!dataset.records.length) {
        if (!silent && typeof toast === "function") toast("Shared master is empty. Upload Part List LATEST in Master Data first.", "info");
        if (typeof setConnectionState === "function") setConnectionState("NOT_CONNECTED");
        return;
      }

      var contacts = sharedContacts(payload.contacts);
      dataset.rawRecords.forEach(function (record) {
        if (!contacts.has(record.company.toUpperCase())) {
          contacts.set(record.company.toUpperCase(), {
            company: record.company, pic: record.email || "", cc: "", spv: "", note: ""
          });
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
      if (typeof setSourceStatus === "function") {
        setSourceStatus("Shared master live · " + dataset.validation.total.toLocaleString() + " unique parts · " + new Date().toLocaleTimeString(), "ok");
      }
      window.__IMDS_SHARED_MASTER_READY__ = true;
      window.__IMDS_SHARED_MASTER_LAST_SYNC__ = new Date().toISOString();
      if (!silent && typeof toast === "function") toast("Shared IMDS Master refreshed.", "ok");
    } catch (error) {
      console.error("IMDS Tracker shared-master refresh failed.", error);
      if (!silent && typeof toast === "function") toast(error && error.message ? error.message : "Shared master refresh failed.", "err");
      if (!window.__IMDS_SHARED_MASTER_READY__ && typeof setConnectionState === "function") setConnectionState("SOURCE_ERROR");
    } finally {
      busy = false;
    }
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

    // ---------- Follow-up: one e-mail per supplier, sent in sequence ----------
    var fp = document.createElement("section");
    fp.className = "panel"; fp.id = "shared-followup-panel";
    fp.innerHTML = '<div class="panel-head"><div><h2>E-mail suppliers (Power Automate)</h2><p class="panel-sub">Each supplier gets its own message and its own PDF report. Suppliers e-mailed recently are skipped.</p></div>' +
      '<div class="view-actions"><select id="fp-sender" class="btn btn-secondary btn-sm" aria-label="Send as" hidden></select><button type="button" class="btn btn-secondary btn-sm" id="fp-load">Load suppliers</button><button type="button" class="btn btn-primary btn-sm" id="fp-all" disabled>Send all sequentially</button></div></div>' +
      '<div id="fp-note" class="muted small"></div><div id="fp-list" style="display:grid;gap:8px;margin-top:10px"></div>';
    var tabs = follow.querySelector("#follow-tabs");
    (tabs ? tabs.insertAdjacentElement("beforebegin", fp) : follow.appendChild(fp));
    var list = [], configured = false, busyFp = false;
    var $n = fp.querySelector("#fp-note"), $l = fp.querySelector("#fp-list"), $all = fp.querySelector("#fp-all"), $snd = fp.querySelector("#fp-sender");
    function draw() {
      $all.disabled = busyFp || !configured || !list.some(function (x) { return x.emailReady; });
      $l.innerHTML = list.map(function (x, i) {
        return '<div style="border:1px solid #e8e1f1;border-radius:10px;padding:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>' + esc(x.supplierName) + '</b><span class="muted small">' + esc(x.supplierCode || "no code") + " · " + esc(x.partCount) + " parts · To: " + esc((x.to || []).join("; ") || "PIC missing") + '</span><span style="margin-left:auto" class="small">' + (x.emailReady ? "Ready" : "PIC required") + '</span><button type="button" class="btn btn-secondary btn-sm" data-i="' + i + '"' + (busyFp || !configured || !x.emailReady ? " disabled" : "") + ">Send</button></div>";
      }).join("") || '<div class="muted small">No outstanding suppliers.</div>';
    }
    async function loadList() {
      $n.textContent = "Preparing supplier groups…";
      try {
        var j = await api("/api/imds-master/followups");
        list = j.suppliers || []; configured = !!j.configured;
        $n.textContent = configured ? list.length + " supplier(s) with outstanding parts." : "The Power Automate e-mail flow is not configured, so sending is disabled. Previews still work.";
        if (Array.isArray(j.senders) && j.senders.length) { $snd.hidden = false; $snd.innerHTML = '<option value="">Send as: default</option>' + j.senders.map(function (s) { return '<option value="' + esc(s.email) + '">' + esc(s.name || s.email) + "</option>"; }).join(""); }
      } catch (e) { $n.textContent = e.message; }
      draw();
    }
    async function sendOne(x) {
      var body = { supplierCode: x.supplierCode, supplierName: x.supplierName, subject: x.subject, messageBody: x.body, sender: $snd.value || undefined };
      return api("/api/imds-master/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    $l.addEventListener("click", async function (e) {
      var b = e.target.closest("button[data-i]"); if (!b || busyFp) return;
      var x = list[Number(b.getAttribute("data-i"))]; busyFp = true; draw();
      try { var r = await sendOne(x); $n.textContent = "Sent to " + x.supplierName + ": " + r.recipient + " · " + r.partCount + " parts · PDF attached."; }
      catch (err) { $n.textContent = x.supplierName + ": " + err.message; }
      busyFp = false; loadList();
    });
    $all.onclick = async function () {
      var ready = list.filter(function (x) { return x.emailReady; });
      if (!ready.length || busyFp || !confirm("Send " + ready.length + " separate e-mail(s), one after another?")) return;
      busyFp = true; draw(); var sent = 0, skipped = 0, failed = [];
      for (var i = 0; i < ready.length; i++) {
        $n.textContent = "Sending " + (i + 1) + " of " + ready.length + " — " + ready[i].supplierName + "…";
        try { await sendOne(ready[i]); sent++; }
        catch (err) { if (err.payload && err.payload.skipped === "RECENTLY_SENT") skipped++; else failed.push(ready[i].supplierName + ": " + err.message); }
      }
      busyFp = false;
      await loadList();
      $n.textContent = "Done: " + sent + "/" + ready.length + " sent, " + skipped + " skipped (e-mailed recently), " + failed.length + " failed." + (failed.length ? " " + failed.join(" | ") : "");
    };
    fp.querySelector("#fp-load").onclick = loadList;
    loadList();
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
    refreshSharedMaster(false);
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