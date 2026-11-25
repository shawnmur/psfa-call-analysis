/* PSFA Deployment Dashboard - Leaflet map (heat + points), repeat locations. */
(function () {
  "use strict";
  const A = window.App;
  const { C, CATS, TYPES } = A;
  let map, tiles, heat, points, renderer, fitted = false, lastRows = null;
  const ui = { mode: "heat", hl: ["Medical", "Fire", "Alarms"].map((n) => CATS.indexOf(n)) };

  // OpenStreetMap standard tiles (no key). Muted to gray via CSS so the data stands out.
  const TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Incidents: NERIS Public';
  const isDark = () => getComputedStyle(document.documentElement).colorScheme.indexOf("dark") >= 0;

  function init() {
    if (typeof L === "undefined") { document.getElementById("map").textContent = "Map library failed to load."; return; }
    map = L.map("map", { preferCanvas: true, zoomControl: true, scrollWheelZoom: false });
    map.on("click focus", () => map.scrollWheelZoom.enable());
    map.on("mouseout blur", () => map.scrollWheelZoom.disable());
    renderer = L.canvas({ padding: 0.3 });
    setTiles();
    // initial view: 1st-99th percentile of valid points
    const lats = [], lons = [];
    for (let i = 0; i < A.N; i++) if (C.lat[i] !== null) { lats.push(C.lat[i] / 1e5); lons.push(C.lon[i] / 1e5); }
    lats.sort((a, b) => a - b); lons.sort((a, b) => a - b);
    if (lats.length) map.fitBounds([[A.quantile(lats, 0.01), A.quantile(lons, 0.01)], [A.quantile(lats, 0.99), A.quantile(lons, 0.99)]]);
    else map.setView([47.38, -122.23], 11);
    fitted = true;

    A.seg("mapMode", (v) => { ui.mode = v; renderHighlights(); if (lastRows) update(lastRows); });
    renderHighlights();
  }

  function setTiles() {
    if (tiles) map.removeLayer(tiles);
    tiles = L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 });
    tiles.addTo(map);
  }

  function renderHighlights() {
    const el = document.getElementById("mapHighlights");
    el.textContent = "";
    if (ui.mode !== "points") return;
    const lab = document.createElement("span"); lab.className = "clickable-hint"; lab.textContent = "Color:"; el.appendChild(lab);
    ui.hl.forEach((ci, k) => {
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "Highlight category " + (k + 1));
      const none = document.createElement("option"); none.value = "-1"; none.textContent = "(none)"; sel.appendChild(none);
      CATS.forEach((name, j) => { const o = document.createElement("option"); o.value = String(j); o.textContent = name; if (j === ci) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", () => { ui.hl[k] = Number(sel.value); if (lastRows) update(lastRows); });
      el.appendChild(sel);
    });
  }

  function popupFor(i) {
    const div = document.createElement("div");
    const add = (strong, text) => { const p = document.createElement("div"); if (strong) { const b = document.createElement("strong"); b.textContent = strong; p.appendChild(b); p.appendChild(document.createTextNode(" ")); } p.appendChild(document.createTextNode(text)); div.appendChild(p); };
    add(null, TYPES[C.t[i]][0]);
    add("When:", A.prettyDay(C.d[i]) + " " + A.hhmm(C.m[i]) + " (" + A.WEEKDAYS[A.wd[i]] + ")");
    add("PSFA units:", C.u[i] < 0 ? "unknown" : String(C.u[i]));
    add("Aid:", A.D.dict.aid[C.a[i]]);
    add("Location:", A.D.dict.loc[C.l[i]] + " · ZIP " + A.D.dict.zip[C.z[i]]);
    add("CAD #:", C.id[i]);
    return div;
  }

  function update(rows) {
    lastRows = rows;
    if (!map) return;
    const c = A.colors();
    if (heat) { map.removeLayer(heat); heat = null; }
    if (points) { map.removeLayer(points); points = null; }
    let mapped = 0;
    const byLoc = new Map();
    for (const i of rows) {
      if (C.lat[i] === null) continue;
      mapped++;
      const key = Math.round(C.lat[i] / 10) + "," + Math.round(C.lon[i] / 10); // ~1e-4 deg ≈ 10 m
      let e = byLoc.get(key);
      if (!e) { e = { lat: C.lat[i] / 1e5, lon: C.lon[i] / 1e5, n: 0, types: new Map(), zip: C.z[i] }; byLoc.set(key, e); }
      e.n++; e.types.set(C.t[i], (e.types.get(C.t[i]) || 0) + 1);
    }
    if (ui.mode === "heat") {
      // cap each spot's weight so one care facility doesn't swamp the picture
      const pts = []; byLoc.forEach((e) => pts.push([e.lat, e.lon, Math.min(e.n, 4)]));
      const g = c.seq;
      heat = L.heatLayer(pts, { radius: 11, blur: 14, max: 2, minOpacity: 0.35, gradient: { 0.15: g[2], 0.4: g[4], 0.7: g[6], 1.0: g[7] } }).addTo(map);
    } else {
      points = L.layerGroup();
      const hl = ui.hl;
      const ordered = [];
      for (const i of rows) if (C.lat[i] !== null) ordered.push(i);
      // gray first, highlights on top
      ordered.sort((a, b) => (hl.indexOf(C.c[a]) >= 0) - (hl.indexOf(C.c[b]) >= 0));
      for (const i of ordered) {
        const k = hl.indexOf(C.c[i]);
        const col = k >= 0 ? c.cat(C.c[i]) : c.other;
        L.circleMarker([C.lat[i] / 1e5, C.lon[i] / 1e5], { renderer, radius: k >= 0 ? 4 : 3, color: c.surface, weight: 1, fillColor: col, fillOpacity: k >= 0 ? 0.85 : 0.5 })
          .bindPopup(() => popupFor(i)).addTo(points);
      }
      points.addTo(map);
    }
    // legend
    const lg = document.getElementById("mapLegend");
    lg.textContent = "";
    if (ui.mode === "heat") {
      const s = document.createElement("span");
      s.textContent = "Stronger blue = more incidents. Repeat addresses are capped so one busy building doesn't dominate.";
      lg.appendChild(s);
    } else {
      const items = ui.hl.filter((x) => x >= 0).map((ci) => [CATS[ci], c.cat(ci)]).concat([["Everything else", c.other]]);
      items.forEach(([name, col]) => { const s = document.createElement("span"); const sw = document.createElement("span"); sw.className = "sw"; sw.style.background = col; s.appendChild(sw); s.appendChild(document.createTextNode(name)); lg.appendChild(s); });
    }
    const att = document.createElement("span"); att.style.marginLeft = "auto"; att.textContent = "Basemap © OpenStreetMap contributors"; lg.appendChild(att);
    const missing = rows.length - mapped;
    document.getElementById("mapCount").textContent = A.fmt(mapped) + " incidents mapped" + (missing ? " · " + A.fmt(missing) + " without usable coordinates" : "");

    // repeat locations
    const top = Array.from(byLoc.values()).filter((e) => e.n >= 3).sort((a, b) => b.n - a.n).slice(0, 10);
    const ul = document.getElementById("repList");
    ul.textContent = "";
    if (!top.length) { const li = document.createElement("li"); li.textContent = "No location with 3+ incidents in this filter."; ul.appendChild(li); }
    top.forEach((e) => {
      const li = document.createElement("li");
      li.tabIndex = 0;
      const t = Array.from(e.types.entries()).sort((a, b) => b[1] - a[1])[0];
      const left = document.createElement("span"); left.className = "t";
      left.textContent = "ZIP " + A.D.dict.zip[e.zip] + " · " + Math.round((100 * t[1]) / e.n) + "% " + TYPES[t[0]][0].replace(/^.* › /, "");
      const n = document.createElement("span"); n.className = "n"; n.textContent = A.fmt(e.n);
      li.append(left, n);
      const go = () => { map.setView([e.lat, e.lon], 16); document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" }); };
      li.addEventListener("click", go);
      li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
      ul.appendChild(li);
    });
  }

  window.MapView = { init, update, retheme: () => { if (map) { setTiles(); if (lastRows) update(lastRows); } }, invalidate: () => map && map.invalidateSize() };
})();
