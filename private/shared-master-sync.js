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


  // ---- Import panel (IMDS Remaining + MD System) inside the Tracker itself ----
  function initImportPanel() {
    if (document.getElementById("imds-import-fab")) return;
    var css = document.createElement("style");
    css.textContent = "#imds-import-fab{position:fixed;right:18px;bottom:68px;z-index:9999;padding:11px 16px;border:0;border-radius:999px;background:#6d28d9;color:#fff;font:600 13px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(76,29,149,.24)}" +
      "#imds-import-box{position:fixed;inset:0;z-index:10000;background:rgba(20,16,32,.45);display:none;align-items:center;justify-content:center;padding:16px;font:14px system-ui,sans-serif}#imds-import-box.on{display:flex}" +
      "#imds-import-box .pn{background:#fff;color:#211a2b;border-radius:14px;max-width:760px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:92vh;overflow:auto}" +
      "#imds-import-box h2{margin:0 0 4px;font-size:18px}#imds-import-box .sub{color:#746b80;font-size:12px;margin-bottom:14px}" +
      "#imds-import-box .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}" +
      "#imds-import-box label.dz{border:2px dashed #c4b5fd;border-radius:12px;padding:18px;display:grid;gap:6px;cursor:pointer;min-height:130px;align-content:center}#imds-import-box label.dz.over{background:#f5f3ff;border-color:#6d28d9}" +
      "#imds-import-box label.dz b{font-size:14px}#imds-import-box label.dz span{color:#746b80;font-size:12px}" +
      "#imds-import-msg{margin-top:12px;padding:10px 12px;border-radius:8px;font-size:13px;display:none;white-space:pre-wrap}#imds-import-msg.info{display:block;background:#f5f3ff;color:#4c1d95}#imds-import-msg.ok{display:block;background:#ecfdf3;color:#166534}#imds-import-msg.err{display:block;background:#fef2f2;color:#b91c1c}" +
      "#imds-import-box .row{display:flex;justify-content:flex-end;margin-top:14px}#imds-import-box .row button{border:1px solid #ddd;background:#fff;border-radius:8px;padding:8px 14px;cursor:pointer}";
    document.head.appendChild(css);
    var fab = document.createElement("button");
    fab.id = "imds-import-fab"; fab.type = "button"; fab.textContent = "⬆ Import data";
    var box = document.createElement("div");
    box.id = "imds-import-box";
    box.innerHTML = '<div class="pn" role="dialog" aria-label="Import data"><h2>Import data</h2><div class="sub">Upload the IMDS Remaining master and the MD System search results here. New rows are added, nothing is deleted, manual edits are kept.</div>' +
      '<div class="grid"><label class="dz" data-kind="master"><input type="file" accept=".xlsx" hidden><b>① IMDS Remaining master</b><span>Drop the workbook containing <b>Part List LATEST</b>, or click to browse.</span></label>' +
      '<label class="dz" data-kind="mds"><input type="file" accept=".xlsx" hidden><b>② MD System search results</b><span>Drop the Search Results workbook, or click to browse.</span></label></div>' +
      '<div id="imds-import-msg" role="status"></div><div class="row"><button type="button" id="imds-import-close">Close</button></div></div>';
    document.body.appendChild(fab); document.body.appendChild(box);
    var msg = box.querySelector("#imds-import-msg"), working = false;
    function say(kind, text) { msg.className = kind; msg.textContent = text; }
    fab.onclick = function () { box.classList.add("on"); };
    box.querySelector("#imds-import-close").onclick = function () { box.classList.remove("on"); };
    box.addEventListener("click", function (e) { if (e.target === box) box.classList.remove("on"); });
    async function run(kind, file) {
      if (!file || working) return;
      if (!/\.xlsx$/i.test(file.name)) { say("err", "Please choose an .xlsx workbook."); return; }
      working = true;
      try {
        say("info", "Uploading " + file.name + "…");
        var r1 = await fetch("/api/imds-master/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size }) });
        var slot = await r1.json().catch(function () { return {}; });
        if (!r1.ok || !slot.signedUrl) throw new Error(slot.error || "The upload could not start. Sign in again and retry.");
        var fd = new FormData(); fd.append("cacheControl", "3600"); fd.append("", file);
        var up = await fetch(slot.signedUrl, { method: "PUT", body: fd, headers: { "x-upsert": "false" } });
        if (!up.ok) throw new Error("Upload to storage failed (HTTP " + up.status + ").");
        say("info", "File uploaded. Importing rows — large workbooks can take up to a minute…");
        var r2 = await fetch(kind === "master" ? "/api/imds-master/import-master" : "/api/imds-master/import-md-system", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: slot.path, fileName: file.name }) });
        var raw = await r2.text(), j;
        try { j = JSON.parse(raw); } catch (e) { throw new Error(r2.status === 504 ? "The import ran past the server time limit. Try again, or split the workbook." : "The server returned an unexpected response (HTTP " + r2.status + ")."); }
        if (!r2.ok) throw new Error(j.error || "Import failed.");
        say("ok", kind === "master"
          ? "Master updated: " + (j.inserted || 0) + " new, " + (j.updated || 0) + " refreshed, " + (j.skipped || 0) + " skipped from " + (j.totalRows || 0) + " rows."
          : "MD System import: " + (j.matchedMasterRows || 0) + " rows matched; " + (j.ambiguousRows || 0) + " ambiguous; " + (j.unmatchedRows || 0) + " unmatched.");
        try { refreshSharedMaster(false); } catch (e) { /* the 15 s refresh will pick it up */ }
      } catch (e) { say("err", e && e.message ? e.message : "Import failed."); }
      finally { working = false; }
    }
    Array.prototype.forEach.call(box.querySelectorAll("label.dz"), function (lab) {
      var kind = lab.getAttribute("data-kind"), input = lab.querySelector("input");
      input.onchange = function () { run(kind, input.files && input.files[0]); input.value = ""; };
      lab.addEventListener("dragover", function (e) { e.preventDefault(); lab.classList.add("over"); });
      lab.addEventListener("dragleave", function () { lab.classList.remove("over"); });
      lab.addEventListener("drop", function (e) { e.preventDefault(); lab.classList.remove("over"); run(kind, e.dataTransfer.files && e.dataTransfer.files[0]); });
    });
  }

  function start() {
    initImportPanel();
    refreshSharedMaster(false);
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