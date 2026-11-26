/* PSFA Deployment Dashboard - Leaflet map: heat, points by category, points by likely station. */
(function () {
  "use strict";
  const A = window.App;
  const { C, CATS, TYPES } = A;
  let map, tiles, heat, points, pins, renderer, lastRows = null;
  const ui = { mode: "heat", pins: true };

  // OpenStreetMap standard tiles (no key). Muted to gray via CSS so the data stands out.
  const TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Incidents: NERIS Public';

  function init() {
    if (typeof L === "undefined") { document.getElementById("map").textContent = "Map library failed to load."; return; }
    map = L.map("map", { preferCanvas: true, zoomControl: true, scrollWheelZoom: false });
    map.on("click focus", () => map.scrollWheelZoom.enable());
    map.on("mouseout blur", () => map.scrollWheelZoom.disable());
    renderer = L.canvas({ padding: 0.3 });
    setTiles();
    const lats = [], lons = [];
    for (let i = 0; i < A.N; i++) if (C.lat[i] !== null) { lats.push(C.lat[i] / 1e5); lons.push(C.lon[i] / 1e5); }
    lats.sort((a, b) => a - b); lons.sort((a, b) => a - b);
    if (lats.length) map.fitBounds([[A.quantile(lats, 0.01), A.quantile(lons, 0.01)], [A.quantile(lats, 0.99), A.quantile(lons, 0.99)]]);
    else map.setView([47.4, -122.2], 11);
    A.seg("mapMode", (v) => { ui.mode = v; if (lastRows) update(lastRows); });
    document.getElementById("mapPins").addEventListener("change", (e) => { ui.pins = e.target.checked; drawPins(); });
  }

  function setTiles() {
    if (tiles) map.removeLayer(tiles);
    tiles = L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(map);
  }

  const stationColor = (c, k) => c.series[A.STATIONS[k][5] % 8];

  function drawPins() {
    if (pins) { map.removeLayer(pins); pins = null; }
    if (!ui.pins) return;
    const c = A.colors();
    pins = L.layerGroup();
    A.STATIONS.forEach((s, k) => {
      const span = document.createElement("span");
      span.textContent = s[0];
      if (ui.mode === "station") span.style.borderColor = stationColor(c, k);
      if (A.state.station === k) { span.style.background = c.ink; span.style.color = c.surface; }
      const icon = L.divIcon({ className: "station-pin", html: span.outerHTML, iconSize: [26, 26], iconAnchor: [13, 13] });
      const m = L.marker([s[1], s[2]], { icon, keyboard: true, title: "Station " + s[0], zIndexOffset: 1000 });
      const div = document.createElement("div");
      const b = document.createElement("strong"); b.textContent = "Station " + s[0];
      div.append(b, document.createElement("br"), document.createTextNode(s[4]));
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "tbtn"; btn.style.marginTop = "6px";
      btn.textContent = A.state.station === k ? "Show all stations" : "Filter to this station's area";
      btn.addEventListener("click", () => { map.closePopup(); A.setState({ station: A.state.station === k ? -9 : k }); });
      div.append(document.createElement("br"), btn);
      m.bindPopup(div);
      m.addTo(pins);
    });
    pins.addTo(map);
  }

  function popupFor(i) {
    const div = document.createElement("div");
    const add = (strong, text) => { const p = document.createElement("div"); if (strong) { const b = document.createElement("strong"); b.textContent = strong; p.appendChild(b); p.appendChild(document.createTextNode(" ")); } p.appendChild(document.createTextNode(text)); div.appendChild(p); };
    add(null, TYPES[C.t[i]][0]);
    add("Category:", CATS[C.c[i]]);
    add("When:", A.prettyDay(C.d[i]) + " " + A.hhmm(C.m[i]) + " (" + A.WEEKDAYS[A.wd[i]] + ")");
    add("PSFA units:", C.u[i] < 0 ? "unknown" : String(C.u[i]));
    add("Likely station*:", C.s[i] >= 0 ? A.STATIONS[C.s[i]][0] + " (" + C.sd[i] + " km away)" : "unknown");
    add("Aid:", A.D.dict.aid[C.a[i]]);
    add("Location:", A.D.dict.loc[C.l[i]] + " · ZIP " + A.D.dict.zip[C.z[i]]);
    add("CAD #:", C.id[i]);
    return div;
  }

  function legendItem(lg, name, col) {
    const s = document.createElement("span");
    const sw = document.createElement("span"); sw.className = "sw"; sw.style.background = col;
    s.append(sw, document.createTextNode(name));
    lg.appendChild(s);
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
      if (!e) { e = { lat: C.lat[i] / 1e5, lon: C.lon[i] / 1e5, n: 0, types: new Map(), zip: C.z[i], s: C.s[i] }; byLoc.set(key, e); }
      e.n++; e.types.set(C.t[i], (e.types.get(C.t[i]) || 0) + 1);
    }
    if (ui.mode === "heat") {
      // cap each spot's weight so one care facility doesn't swamp the picture
      const pts = []; byLoc.forEach((e) => pts.push([e.lat, e.lon, Math.min(e.n, 4)]));
      const g = c.gseq;
      heat = L.heatLayer(pts, { radius: 11, blur: 14, max: 2, minOpacity: 0.3, gradient: { 0.15: g[3], 0.45: g[5], 0.75: g[6], 1.0: g[7] } }).addTo(map);
    } else {
      points = L.layerGroup();
      const byStation = ui.mode === "station";
      // draw in time order (categories interleaved) so no category is artificially painted on top
      for (const i of rows) {
        if (C.lat[i] === null) continue;
        const col = byStation ? (C.s[i] >= 0 ? stationColor(c, C.s[i]) : c.other) : c.cat(C.c[i]);
        L.circleMarker([C.lat[i] / 1e5, C.lon[i] / 1e5], { renderer, radius: 3.5, color: c.surface, weight: 0.8, fillColor: col, fillOpacity: 0.8 })
          .bindPopup(() => popupFor(i)).addTo(points);
      }
      points.addTo(map);
    }
    drawPins();

    // legend
    const lg = document.getElementById("mapLegend");
    lg.textContent = "";
    lg.className = "legend";
    if (ui.mode === "heat") {
      const s = document.createElement("span");
      s.textContent = "Darker (light theme) / brighter (dark theme) = more incidents. Repeat addresses are capped so one busy building doesn't dominate.";
      lg.appendChild(s);
    } else if (ui.mode === "category") {
      CATS.forEach((name, k) => { if (A.state.cats[k]) legendItem(lg, name, c.cat(k)); });
    } else {
      lg.className = "legend stations";
      A.STATIONS.forEach((s, k) => legendItem(lg, "Station " + s[0] + " · " + s[3], stationColor(c, k)));
      const note = document.createElement("span");
      note.style.gridColumn = "1 / -1";
      note.textContent = "Each point takes the color of its nearest station. Neighboring stations always get different colors (colors repeat only far apart). Numbered pins mark the stations.";
      lg.appendChild(note);
    }
    const missing = rows.length - mapped;
    document.getElementById("mapCount").textContent = A.fmt(mapped) + " incidents mapped" + (missing ? " · " + A.fmt(missing) + " without usable coordinates" : "") + " · Basemap © OpenStreetMap";

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
      left.textContent = (e.s >= 0 ? "Stn " + A.STATIONS[e.s][0] + " · " : "") + "ZIP " + A.D.dict.zip[e.zip] + " · " + Math.round((100 * t[1]) / e.n) + "% " + TYPES[t[0]][0].replace(/^.* › /, "");
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
