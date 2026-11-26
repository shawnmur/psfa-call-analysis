/* PSFA Deployment Dashboard - wiring: filter bar, render loop, table, export, theme. */
(function () {
  "use strict";
  const A = window.App, CH = window.Charts, R = CH.R, MV = window.MapView;
  const { C, CATS, TYPES, M, esc, fmt } = A;

  // ------------------------------------------------------------- header
  document.getElementById("subtitle").textContent =
    "Puget Sound Regional Fire Authority · data through " + A.prettyDay(A.LAST) +
    " · NERIS publishes about 60 days late · " + fmt(A.N) + " incidents";
  document.getElementById("footer").textContent =
    "Source: " + M.source + ", export of " + M.export_date + ". Generated " + M.generated_at +
    ". Unofficial personal-research dashboard. Not for operational use.";

  // ------------------------------------------------------------- theme
  const themeBtn = document.getElementById("themeBtn");
  const savedTheme = (() => { try { return localStorage.getItem("psfa-theme"); } catch (e) { return null; } })();
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  themeBtn.addEventListener("click", () => {
    const dark = getComputedStyle(document.documentElement).colorScheme.indexOf("dark") >= 0;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("psfa-theme", next); } catch (e) { /* ignore */ }
    A.disposeCharts();
    MV.retheme();
    renderAll();
  });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) { A.disposeCharts(); MV.retheme(); renderAll(); }
  });

  // ------------------------------------------------------------- about
  const about = [
    "Source: NERIS Public (U.S. Fire Administration / FSRI), the national fire-incident reporting system. Department FD53033674. Export of " + M.export_date + ".",
    "NERIS publishes about 60 days late, and departments can edit records after submitting, so recent weeks may still change.",
    "Coverage starts " + A.prettyDay(0) + ", when PSFA began reporting to NERIS. The default range (" + A.prettyDay(A.WIN[0]) + " – " + A.prettyDay(A.WIN[1]) + ") leaves out the incomplete ramp-up and the ragged last few days.",
    "Incident type is the final type as found on scene, not the dispatch type. Medical types are generalized for privacy, and about 63% are coded only as \"Medical\".",
    "Categories are this dashboard's grouping: fire alarms and false alarms are \"Alarms\", and motor-vehicle collisions are pulled out of the Medical and Hazard branches.",
    "Units are PSFA's own units dispatched. NERIS has no unit IDs or station numbers.",
    "Likely station (*) is inferred: each incident is credited to the nearest of PSFA's 17 stations in a straight line (station addresses from pugetsoundfire.org, geocoded with the US Census geocoder). It ignores roads and drive time, units already busy on other calls, move-ups, and multi-unit responses, so treat it as \"whose first-due area this probably is\", not who actually went. A public-records request would give the real responding units.",
    "Aid Given incidents are often outside PSFA's area. Aid Received with 0 units means another agency handled it.",
    "NERIS's duration field is always 0 for PSFA, so how long calls last isn't available.",
    "Addresses are reduced to ZIP code. Map points are the reported incident coordinates; " + fmt(M.geo.invalid + M.geo.coarse) + " incidents have missing or unusable coordinates and aren't mapped.",
    "Times are local Pacific time (checked against the UTC timestamp in each NERIS ID). On the spring-forward day there is no 02:00 hour.",
    "Removed: test records and duplicate submissions (same CAD number and time; the latest submission is kept).",
    "Shift views assume 24-hour shifts starting at " + String(M.shift_start_hour).padStart(2, "0") + ":00. Day = 07:00–18:59.",
    "To refresh: in Terminal, run  bash run.sh --update  (downloads about 700 MB). Your data/psfa_incidents.csv keeps all history.",
  ];
  const ul = document.getElementById("aboutList");
  about.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
  const dlg = document.getElementById("about");
  document.getElementById("aboutBtn").addEventListener("click", () => dlg.showModal());
  document.getElementById("aboutClose").addEventListener("click", () => dlg.close());

  // ------------------------------------------------------------- filter bar
  const fPreset = document.getElementById("fPreset"), fFrom = document.getElementById("fFrom"), fTo = document.getElementById("fTo");
  const presets = [["window", "Complete-data window", A.WIN[0], A.WIN[1]], ["all", "All data (incl. partial days)", 0, A.LAST]];
  const lastWin = A.WIN[1];
  presets.push(["l30", "Last 30 days of data", Math.max(0, lastWin - 29), lastWin]);
  presets.push(["l90", "Last 90 days of data", Math.max(0, lastWin - 89), lastWin]);
  A.MONTHS.forEach((m) => {
    const s = Math.max(0, A.isoDay(m + "-01"));
    const [y, mo] = m.split("-").map(Number);
    const e = Math.min(A.LAST, A.isoDay(new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)));
    presets.push(["m" + m, A.prettyMonth(m), s, e]);
  });
  presets.push(["custom", "Custom", null, null]);
  presets.forEach(([v, label]) => { const o = document.createElement("option"); o.value = v; o.textContent = label; fPreset.appendChild(o); });
  fFrom.min = fTo.min = A.dayISO(0); fFrom.max = fTo.max = A.dayISO(A.LAST);
  fPreset.addEventListener("change", () => {
    const p = presets.find((x) => x[0] === fPreset.value);
    if (p && p[2] !== null) A.setState({ preset: p[0], from: p[2], to: p[3] });
  });
  const onDate = () => {
    let f = A.isoDay(fFrom.value), t = A.isoDay(fTo.value);
    if (isNaN(f) || isNaN(t)) return;
    f = Math.max(0, Math.min(A.LAST, f)); t = Math.max(0, Math.min(A.LAST, t));
    if (f > t) [f, t] = [t, f];
    A.setState({ preset: "custom", from: f, to: t });
  };
  fFrom.addEventListener("change", onDate); fTo.addEventListener("change", onDate);

  // category chips
  const fCats = document.getElementById("fCats");
  const lab = document.createElement("span"); lab.className = "flabel"; lab.textContent = "Category"; fCats.appendChild(lab);
  const chipEls = CATS.map((name, k) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.title = "Click to toggle · double-click for only this";
    const sw = document.createElement("span"); sw.className = "sw"; sw.style.background = "var(--s" + (k + 1) + ")";
    b.append(sw, document.createTextNode(name));
    let timer = null;
    b.addEventListener("click", () => {
      clearTimeout(timer);
      timer = setTimeout(() => { const cats = A.state.cats.slice(); cats[k] = !cats[k]; if (!cats.some(Boolean)) cats[k] = true; A.setState({ cats }); }, 220);
    });
    b.addEventListener("dblclick", () => { clearTimeout(timer); A.setState({ cats: CATS.map((_, j) => j === k) }); });
    fCats.appendChild(b);
    return b;
  });
  const fUnits = document.getElementById("fUnits"), fAid = document.getElementById("fAid"), fStation = document.getElementById("fStation");
  [["-9", "All"]].concat(A.STATIONS.map((s, k) => [String(k), s[0] + " · " + s[3]])).forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; fStation.appendChild(o); });
  fStation.addEventListener("change", () => A.setState({ station: Number(fStation.value) }));
  fUnits.addEventListener("change", () => A.setState({ units: fUnits.value }));
  fAid.addEventListener("change", () => A.setState({ aid: fAid.value }));
  const dn = A.seg("fDN", (v) => A.setState({ dn: v }));
  const wk = A.seg("fWK", (v) => A.setState({ wk: v }));
  document.getElementById("fReset").addEventListener("click", () => { CH.ui.expl = []; A.resetState(); });

  function syncControls() {
    const st = A.state;
    fPreset.value = st.preset;
    fFrom.value = A.dayISO(st.from); fTo.value = A.dayISO(st.to);
    chipEls.forEach((b, k) => b.setAttribute("aria-pressed", String(st.cats[k])));
    fUnits.value = st.units; fAid.value = st.aid; dn.set(st.dn); wk.set(st.wk); fStation.value = String(st.station);
    // drill chips
    const box = document.getElementById("fDrills");
    box.textContent = "";
    const dr = st.drill;
    const add = (text, clear) => {
      const s = document.createElement("span"); s.className = "chip drill";
      s.appendChild(document.createTextNode(text));
      const x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Remove filter " + text);
      x.addEventListener("click", clear); s.appendChild(x); box.appendChild(s);
    };
    if (dr.type !== null) add("Type: " + TYPES[dr.type][0], () => A.setState({ drill: { type: null } }));
    if (dr.path) add("Type: " + [dr.path.l1, dr.path.l2].filter(Boolean).join(" › "), () => A.setState({ drill: { path: null } }));
    if (dr.wh) add(A.WEEKDAYS[dr.wh[0]] + " " + String(dr.wh[1]).padStart(2, "0") + ":00–" + String(dr.wh[1]).padStart(2, "0") + ":59", () => A.setState({ drill: { wh: null } }));
    if (dr.zip !== null) add("ZIP " + A.D.dict.zip[dr.zip], () => A.setState({ drill: { zip: null } }));
    if (dr.action !== null) add("Action: " + A.D.dict.action[dr.action], () => A.setState({ drill: { action: null } }));
    if (dr.loc !== null) add("Location: " + A.D.dict.loc[dr.loc], () => A.setState({ drill: { loc: null } }));
  }
  CH.setSync(syncControls);

  // ------------------------------------------------------------- explore table
  const tbl = { sort: "when", dir: -1, page: 0, q: "", rows: [] };
  const COLS = [
    ["when", "When", (i) => A.dayISO(C.d[i]) + " " + A.hhmm(C.m[i]), (i) => C.d[i] * 1440 + C.m[i]],
    ["cat", "Category", (i) => CATS[C.c[i]]],
    ["type", "Type (as found)", (i) => TYPES[C.t[i]][0]],
    ["units", "Units", (i) => (C.u[i] < 0 ? "" : C.u[i]), (i) => C.u[i]],
    ["aid", "Aid", (i) => A.D.dict.aid[C.a[i]]],
    ["zip", "ZIP", (i) => A.D.dict.zip[C.z[i]]],
    ["stn", "Likely station*", (i) => (C.s[i] >= 0 ? A.STATIONS[C.s[i]][0] : "")],
    ["loc", "Location", (i) => A.D.dict.loc[C.l[i]]],
    ["cad", "CAD #", (i) => C.id[i]],
  ];
  function tableRows(rows) {
    const q = tbl.q.trim().toLowerCase();
    let out = Array.from(rows);
    if (q) out = out.filter((i) => (TYPES[C.t[i]][0] + " " + CATS[C.c[i]] + " " + A.D.dict.zip[C.z[i]] + " " + C.id[i] + " " + A.D.dict.loc[C.l[i]] + (C.s[i] >= 0 ? " station " + A.STATIONS[C.s[i]][0] : "")).toLowerCase().indexOf(q) >= 0);
    const col = COLS.find((c) => c[0] === tbl.sort);
    const key = col[3] || col[2];
    out.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * tbl.dir; });
    return out;
  }
  function renderTable(rows) {
    tbl.rows = tableRows(rows);
    const pages = Math.max(1, Math.ceil(tbl.rows.length / 25));
    tbl.page = Math.min(tbl.page, pages - 1);
    const el = document.getElementById("tbl");
    let h = "<thead><tr>" + COLS.map((c) => "<th class='sortable" + (c[0] === "units" ? " num" : "") + "' data-k='" + c[0] + "'>" + esc(c[1]) + (tbl.sort === c[0] ? (tbl.dir > 0 ? " ▲" : " ▼") : "") + "</th>").join("") + "</tr></thead><tbody>";
    tbl.rows.slice(tbl.page * 25, tbl.page * 25 + 25).forEach((i) => {
      h += "<tr>" + COLS.map((c) => "<td" + (c[0] === "units" ? " class='num'" : "") + ">" + esc(c[2](i)) + "</td>").join("") + "</tr>";
    });
    el.innerHTML = h + "</tbody>";
    document.getElementById("tblPage").textContent = "Page " + (tbl.page + 1) + " of " + pages + " · " + fmt(tbl.rows.length) + " incidents";
  }
  document.getElementById("tbl").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]"); if (!th) return;
    if (tbl.sort === th.dataset.k) tbl.dir *= -1; else { tbl.sort = th.dataset.k; tbl.dir = th.dataset.k === "when" || th.dataset.k === "units" ? -1 : 1; }
    renderTable(current);
  });
  document.getElementById("tblPrev").addEventListener("click", () => { tbl.page = Math.max(0, tbl.page - 1); renderTable(current); });
  document.getElementById("tblNext").addEventListener("click", () => { tbl.page++; renderTable(current); });
  let qTimer = null;
  document.getElementById("tblSearch").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { tbl.q = e.target.value; tbl.page = 0; renderTable(current); }, 150); });
  document.getElementById("tblDownload").addEventListener("click", () => {
    const head = ["date", "time", "weekday", "category", "type", "type_level1", "type_level2", "type_level3", "units", "aid", "zip", "location_use", "actions", "lat", "lon", "inferred_station", "station_distance_km", "cad_number"];
    const q = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head.join(",")];
    tbl.rows.forEach((i) => {
      const t = TYPES[C.t[i]];
      lines.push([A.dayISO(C.d[i]), A.hhmm(C.m[i]), A.WEEKDAYS[A.wd[i]], CATS[C.c[i]], t[0], t[1], t[2], t[3], C.u[i] < 0 ? "" : C.u[i], A.D.dict.aid[C.a[i]], A.D.dict.zip[C.z[i]], A.D.dict.loc[C.l[i]],
        C.ac[i].map((a) => A.D.dict.action[a]).join("; "), C.lat[i] === null ? "" : C.lat[i] / 1e5, C.lon[i] === null ? "" : C.lon[i] / 1e5, C.s[i] >= 0 ? A.STATIONS[C.s[i]][0] : "", C.sd[i] === null ? "" : C.sd[i], C.id[i]].map(q).join(","));
    });
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "psfa_filtered_" + A.dayISO(A.state.from) + "_to_" + A.dayISO(A.state.to) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  // ------------------------------------------------------------- chart-local controls
  A.seg("volGran", (v) => { CH.ui.volGran = v; renderOne(R.volume); });
  A.seg("volMeasure", (v) => { CH.ui.volMeasure = v; renderOne(R.volume); });
  A.seg("volView", (v) => { CH.ui.volView = v; renderOne(R.volume); });
  A.seg("todCompare", (v) => { CH.ui.todCompare = v; renderOne(R.tod); });
  document.getElementById("todSmooth").addEventListener("change", (e) => { CH.ui.todSmooth = e.target.checked; renderOne(R.tod); });

  // ------------------------------------------------------------- render loop
  let current = new Int32Array(0), ctx = null;
  function makeCtx() {
    const st = A.state;
    const rows = A.filterRows(st);
    return { rows, days: A.dayList(st), st, c: A.colors() };
  }
  function renderOne(fn) { if (ctx) { ctx.c = A.colors(); safe(fn, ctx); } }
  function safe(fn, x) { try { fn(x); } catch (e) { console.error(e); } }
  A.seg("stSort", (v) => { CH.ui.stSort = v; renderOne(R.stations); });
  const ORDER = ["tiles", "volume", "stations", "stationHour", "stationMix", "tod", "heat", "dow", "shift", "cats", "explorer", "toptypes", "typehour", "units", "unitsType", "unitsHour", "aid", "actions", "locuse", "largest", "zips"];
  function renderAll() {
    ctx = makeCtx();
    current = ctx.rows;
    syncControls();
    document.getElementById("fCount").innerHTML = "Showing <strong>" + fmt(ctx.rows.length) + "</strong> of " + fmt(A.N) + " incidents";
    ORDER.forEach((k) => safe(R[k], ctx));
    safe(MV.update, ctx.rows);
    renderTable(ctx.rows);
  }
  let raf = 0;
  A.onChange(() => { cancelAnimationFrame(raf); document.body.classList.add("recomputing"); raf = requestAnimationFrame(() => { renderAll(); document.body.classList.remove("recomputing"); }); });

  // ------------------------------------------------------------- boot
  A.installTableToggles();
  A.replaceState(A.readHash());
  MV.init();
  renderAll();
  // developer aid for screenshots: index.html?only=secF
  const only = new URLSearchParams(location.search).get("only");
  if (only) document.querySelectorAll("section.block, #framing").forEach((el) => { if (only.split(",").indexOf(el.id) < 0) el.hidden = true; });
  // developer aid: ?ui=volView:share,mapMode:points clicks those segmented buttons after load
  const uiParam = new URLSearchParams(location.search).get("ui");
  if (uiParam) setTimeout(() => uiParam.split(",").forEach((kv) => {
    const [id, v] = kv.split(":"); const b = document.querySelector("#" + id + ' button[data-v="' + v + '"]'); if (b) b.click();
  }), 200);
  if (new URLSearchParams(location.search).get("theme")) { document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme"); A.disposeCharts(); MV.retheme(); renderAll(); }
  window.addEventListener("hashchange", () => { A.replaceState(A.readHash()); renderAll(); });
})();
