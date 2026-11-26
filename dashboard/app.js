/* PSFA Deployment Dashboard - core: data decoding, filter state, helpers.
 * Plain browser script (no modules) so the page also works from file://. */
(function () {
  "use strict";
  const D = window.PSFA_DATA;
  if (!D) {
    document.body.innerHTML = "<p style='padding:2em'>Missing dashboard/data/incidents.js. Run <code>bash run.sh --update</code>.</p>";
    throw new Error("PSFA_DATA missing");
  }
  const M = D.meta, C = D.cols, N = M.rows;
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const CATS = D.dict.category;
  const TYPES = D.dict.type; // [label, l1, l2, l3, catIdx]
  const STATIONS = D.dict.station; // [number, lat, lon, city, address, colourSlot]
  const UNIT_BUCKETS = ["0", "1", "2", "3-4", "5+"];
  const SHIFT0 = M.shift_start_hour;
  const [DAY_H0, DAY_H1] = M.day_hours;

  // ------------------------------------------------------------- calendar
  const [fy, fm, fd] = M.first_day.split("-").map(Number);
  const BASE_MS = Date.UTC(fy, fm - 1, fd);
  const dayISO = (i) => new Date(BASE_MS + i * 86400000).toISOString().slice(0, 10);
  const isoDay = (s) => Math.round((Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - BASE_MS) / 86400000);
  const LAST = isoDay(M.last_day);
  const NDAYS = LAST + 1;
  const dayWd = (i) => (M.first_weekday + i) % 7;
  const dayMonth = (i) => dayISO(i).slice(0, 7);
  const WIN = [isoDay(M.window_start), isoDay(M.window_end)];
  const MONTHS = [];
  for (let i = 0; i < NDAYS; i++) { const m = dayMonth(i); if (MONTHS[MONTHS.length - 1] !== m) MONTHS.push(m); }

  // ------------------------------------------------------------- per-row derived arrays
  const hour = new Uint8Array(N), bin10 = new Uint8Array(N), wd = new Uint8Array(N);
  const shiftDay = new Int32Array(N), shiftHour = new Uint8Array(N), ubucket = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    const m = C.m[i], d = C.d[i], h = (m / 60) | 0;
    hour[i] = h; bin10[i] = (m / 10) | 0; wd[i] = dayWd(d);
    shiftDay[i] = h >= SHIFT0 ? d : d - 1;
    shiftHour[i] = (h - SHIFT0 + 24) % 24;
    const u = C.u[i];
    ubucket[i] = u < 0 ? -1 : u === 0 ? 0 : u === 1 ? 1 : u === 2 ? 2 : u <= 4 ? 3 : 4;
  }

  // ------------------------------------------------------------- state
  const defaultState = () => ({
    from: WIN[0], to: WIN[1], preset: "window",
    cats: CATS.map(() => true),
    units: "all", aid: "all", dn: "all", wk: "all", station: -9,
    drill: { type: null, path: null, wh: null, zip: null, action: null, loc: null },
  });
  let state = defaultState();
  const listeners = [];
  function setState(patch, opts) {
    state = Object.assign({}, state, patch);
    if (patch.drill) state.drill = Object.assign({}, state.drill, patch.drill);
    if (!opts || !opts.silentHash) writeHash();
    listeners.forEach((fn) => fn(state));
  }
  function resetState() { state = defaultState(); writeHash(); listeners.forEach((fn) => fn(state)); }

  // URL hash <-> state (bookmarkable views)
  function writeHash() {
    const p = new URLSearchParams();
    if (state.preset !== "window") { p.set("from", dayISO(state.from)); p.set("to", dayISO(state.to)); p.set("p", state.preset); }
    if (state.cats.some((x) => !x)) p.set("cats", state.cats.map((x) => (x ? 1 : 0)).join(""));
    ["units", "aid", "dn", "wk"].forEach((k) => { if (state[k] !== "all") p.set(k, state[k]); });
    if (state.station !== -9) p.set("st", state.station);
    const dr = state.drill;
    if (dr.type !== null) p.set("type", dr.type);
    if (dr.path) p.set("path", JSON.stringify(dr.path));
    if (dr.wh) p.set("wh", dr.wh.join(","));
    if (dr.zip !== null) p.set("zip", dr.zip);
    if (dr.action !== null) p.set("act", dr.action);
    if (dr.loc !== null) p.set("loc", dr.loc);
    const s = p.toString();
    history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const s = defaultState();
    try {
      if (p.get("from") && p.get("to")) {
        s.from = clampDay(isoDay(p.get("from"))); s.to = clampDay(isoDay(p.get("to"))); s.preset = p.get("p") || "custom";
      }
      const cats = p.get("cats");
      if (cats && cats.length === CATS.length) s.cats = cats.split("").map((c) => c === "1");
      ["units", "aid", "dn", "wk"].forEach((k) => { if (p.get(k)) s[k] = p.get(k); });
      if (p.get("st") !== null && p.get("st") !== "") s.station = Number(p.get("st"));
      const num = (k) => (p.get(k) !== null && p.get(k) !== "" ? Number(p.get(k)) : null);
      s.drill.type = num("type"); s.drill.zip = num("zip"); s.drill.action = num("act"); s.drill.loc = num("loc");
      if (p.get("path")) s.drill.path = JSON.parse(p.get("path"));
      if (p.get("wh")) s.drill.wh = p.get("wh").split(",").map(Number);
    } catch (e) { return defaultState(); }
    return s;
  }
  const clampDay = (d) => Math.max(0, Math.min(LAST, isNaN(d) ? 0 : d));

  // ------------------------------------------------------------- filtering
  function weekdayOk(w, st) {
    if (st.wk === "weekday" && w >= 5) return false;
    if (st.wk === "weekend" && w < 5) return false;
    if (st.drill.wh && st.drill.wh[0] !== w) return false;
    return true;
  }
  function pathOk(t, path) {
    const ti = TYPES[t];
    if (path.l1 !== undefined && ti[1] !== path.l1) return false;
    if (path.l2 !== undefined && ti[2] !== path.l2) return false;
    if (path.l3 !== undefined && ti[3] !== path.l3) return false;
    return true;
  }
  /** Returns Int32Array of row indices matching st (optionally ignoring some keys). */
  function filterRows(st, ignore) {
    ignore = ignore || {};
    const out = new Int32Array(N);
    let k = 0;
    const dr = st.drill;
    const ub = st.units === "all" || ignore.units ? -9 : UNIT_BUCKETS.indexOf(st.units);
    const aid = st.aid === "all" || ignore.aid ? -9 : D.dict.aid.indexOf(st.aid);
    const aidBoth = D.dict.aid.indexOf("Both");
    const pathCache = dr.path ? TYPES.map((_, t) => pathOk(t, dr.path)) : null;
    for (let i = 0; i < N; i++) {
      const d = C.d[i];
      if (d < st.from || d > st.to) continue;
      if (!ignore.cats && !st.cats[C.c[i]]) continue;
      if (!ignore.station && st.station !== -9 && C.s[i] !== st.station) continue;
      if (ub !== -9 && ubucket[i] !== ub) continue;
      if (aid !== -9 && !(C.a[i] === aid || (C.a[i] === aidBoth && (st.aid === "Given" || st.aid === "Received")))) continue;
      const h = hour[i];
      if (st.dn !== "all") { const isDay = h >= DAY_H0 && h < DAY_H1; if ((st.dn === "Day") !== isDay) continue; }
      if (!weekdayOk(wd[i], st)) continue;
      if (dr.wh && dr.wh[1] !== h) continue;
      if (dr.type !== null && C.t[i] !== dr.type) continue;
      if (pathCache && !pathCache[C.t[i]]) continue;
      if (dr.zip !== null && C.z[i] !== dr.zip) continue;
      if (dr.loc !== null && C.l[i] !== dr.loc) continue;
      if (dr.action !== null && C.ac[i].indexOf(dr.action) < 0) continue;
      out[k++] = i;
    }
    return out.subarray(0, k);
  }
  /** Calendar days in range that pass the weekday filters (zero-call days count). */
  function dayList(st) {
    const out = [];
    for (let d = st.from; d <= st.to; d++) if (weekdayOk(dayWd(d), st)) out.push(d);
    return out;
  }

  // ------------------------------------------------------------- helpers
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const fmt = (v, dp) => (v === null || v === undefined || isNaN(v) ? "–" : (dp === 2 ? nf2 : dp === 1 ? nf1 : nf0).format(v));
  const pct = (a, b) => (b ? fmt((100 * a) / b, 1) + "%" : "–");
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const prettyDay = (i) => { const s = dayISO(i); return MONTH_NAMES[+s.slice(5, 7) - 1] + " " + +s.slice(8, 10) + ", " + s.slice(0, 4); };
  const shortDay = (i) => { const s = dayISO(i); return MONTH_NAMES[+s.slice(5, 7) - 1] + " " + +s.slice(8, 10); };
  const prettyMonth = (m) => MONTH_NAMES[+m.slice(5, 7) - 1] + " " + m.slice(0, 4);
  const hhmm = (min) => String((min / 60) | 0).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function colors() {
    const s = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar("--s" + i));
    return {
      series: s, cat: (i) => s[i % 8], other: cssVar("--other"),
      ink: cssVar("--ink"), ink2: cssVar("--ink-2"), muted: cssVar("--muted"),
      grid: cssVar("--grid"), axis: cssVar("--axis"), surface: cssVar("--surface"), surface2: cssVar("--surface-2"),
      seq: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cssVar("--seq-" + i)),
      night: cssVar("--night-band"),
      trend: cssVar("--trend"), trend2: cssVar("--trend-2"), band: cssVar("--trend-band"), day: cssVar("--day"), nightBar: cssVar("--night"),
      gseq: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cssVar("--g" + i)),
    };
  }

  // ------------------------------------------------------------- ECharts helpers
  const charts = {};
  function chart(id) {
    if (!charts[id]) {
      const el = document.getElementById(id);
      charts[id] = echarts.init(el, null, { renderer: "canvas" });
      new ResizeObserver(() => charts[id] && charts[id].resize()).observe(el);
    }
    return charts[id];
  }
  function disposeCharts() { Object.keys(charts).forEach((k) => { charts[k].dispose(); delete charts[k]; }); }

  function axisBase(c) {
    return {
      axisLine: { lineStyle: { color: c.axis } }, axisTick: { show: false },
      axisLabel: { color: c.muted, fontSize: 11 }, splitLine: { lineStyle: { color: c.grid } },
      nameTextStyle: { color: c.muted, fontSize: 11, align: "left" },
    };
  }
  function baseOption(c, extra) {
    return Object.assign({
      animationDuration: 300, animationDurationUpdate: 300,
      aria: { enabled: true },
      textStyle: { fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: c.ink2 },
      grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
      tooltip: {
        backgroundColor: c.surface, borderColor: c.grid, borderWidth: 1, padding: [8, 10],
        textStyle: { color: c.ink, fontSize: 12 }, extraCssText: "box-shadow:0 4px 14px rgba(0,0,0,.12);border-radius:8px;",
      },
    }, extra || {});
  }
  /** Tooltip row: short line key in series color, value strong, label secondary. */
  function ttRow(color, value, label) {
    return '<div style="display:flex;align-items:center;gap:8px;margin:2px 0">' +
      (color ? '<span style="display:inline-block;width:12px;height:2px;background:' + color + '"></span>' : "") +
      "<strong>" + esc(value) + '</strong><span style="opacity:.7">' + esc(label) + "</span></div>";
  }
  function ttHead(text) { return '<div style="opacity:.7;margin-bottom:4px">' + esc(text) + "</div>"; }

  // ------------------------------------------------------------- table views
  const tables = {};
  function setTable(key, columns, rows) { tables[key] = { columns, rows }; refreshTableView(key); }
  function tableHTML(t) {
    if (!t) return "<p class='note' style='padding:8px'>No data.</p>";
    const isNum = t.columns.map((_, j) => t.rows.length && t.rows.every((r) => typeof r[j] === "number"));
    let h = "<table class='data'><thead><tr>" + t.columns.map((c, j) => "<th" + (isNum[j] ? " class='num'" : "") + ">" + esc(c) + "</th>").join("") + "</tr></thead><tbody>";
    t.rows.forEach((r) => {
      h += "<tr>" + r.map((v, j) => "<td" + (isNum[j] ? " class='num'" : "") + ">" + esc(typeof v === "number" ? (Number.isInteger(v) ? fmt(v) : fmt(v, 2)) : v) + "</td>").join("") + "</tr>";
    });
    return h + "</tbody></table>";
  }
  function refreshTableView(key) {
    const card = document.querySelector('.card[data-chart="' + key + '"]');
    if (!card) return;
    const box = card.querySelector(".tableview");
    if (box && !box.hidden) box.innerHTML = tableHTML(tables[key]);
  }
  function installTableToggles() {
    document.querySelectorAll(".card[data-chart]").forEach((card) => {
      const key = card.dataset.chart;
      const ch = card.querySelector(".chart");
      if (!ch) return;
      let tools = card.querySelector(".chead .tools");
      if (!tools) { tools = document.createElement("div"); tools.className = "tools"; card.querySelector(".chead").appendChild(tools); }
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "tbtn"; btn.textContent = "Table"; btn.setAttribute("aria-pressed", "false");
      btn.title = "Show the numbers behind this chart";
      tools.appendChild(btn);
      const box = document.createElement("div");
      box.className = "tablebox tableview"; box.hidden = true;
      ch.after(box);
      btn.addEventListener("click", () => {
        const on = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(on));
        box.hidden = !on;
        if (on) box.innerHTML = tableHTML(tables[key]);
      });
    });
  }

  // segmented control helper
  function seg(id, onChange) {
    const el = document.getElementById(id);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      onChange(b.dataset.v);
    });
    return {
      get: () => (el.querySelector('button[aria-pressed="true"]') || {}).dataset.v,
      set: (v) => el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === v))),
    };
  }

  window.App = {
    D, M, C, N, WEEKDAYS, CATS, TYPES, STATIONS, UNIT_BUCKETS, SHIFT0, DAY_H0, DAY_H1,
    BASE_MS, LAST, NDAYS, WIN, MONTHS, dayISO, isoDay, dayWd, dayMonth, prettyDay, shortDay, prettyMonth, hhmm,
    hour, bin10, wd, shiftDay, shiftHour, ubucket,
    get state() { return state; }, setState, resetState, readHash, onChange: (fn) => listeners.push(fn),
    filterRows, dayList, weekdayOk,
    esc, fmt, pct, quantile, colors, chart, disposeCharts, axisBase, baseOption, ttRow, ttHead,
    setTable, installTableToggles, seg, MONTH_NAMES,
    replaceState: (s) => { state = s; },
  };
})();
