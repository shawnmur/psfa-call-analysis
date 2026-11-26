/* PSFA Deployment Dashboard - chart renderers. Each takes a context:
 *   { rows: Int32Array of row indices, days: [day idx...], st: state, c: colors }  */
(function () {
  "use strict";
  const A = window.App;
  const { C, CATS, TYPES, WEEKDAYS, esc, fmt, pct, ttRow, ttHead } = A;
  const R = {}; // renderers
  const ui = { volGran: "day", volMeasure: "inc", volView: "total", todCompare: "none", todSmooth: true, expl: [] };

  const unitsOf = (i) => (C.u[i] > 0 ? C.u[i] : 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  // ===================================================================== tiles
  R.tiles = function (ctx) {
    const { rows, days } = ctx;
    const n = rows.length, nd = days.length || 1;
    const perDay = new Map(days.map((d) => [d, 0]));
    let units = 0, med = 0, given = 0, received = 0;
    const aidG = A.D.dict.aid.indexOf("Given"), aidR = A.D.dict.aid.indexOf("Received"), aidB = A.D.dict.aid.indexOf("Both");
    const wh = new Float64Array(7 * 24);
    const medIdx = CATS.indexOf("Medical");
    for (const i of rows) {
      if (perDay.has(C.d[i])) perDay.set(C.d[i], perDay.get(C.d[i]) + 1);
      units += unitsOf(i);
      if (C.c[i] === medIdx) med++;
      if (C.a[i] === aidG || C.a[i] === aidB) given++;
      if (C.a[i] === aidR || C.a[i] === aidB) received++;
      wh[A.wd[i] * 24 + A.hour[i]]++;
    }
    const dayCounts = Array.from(perDay.values()).sort((a, b) => a - b);
    const wdN = new Array(7).fill(0); days.forEach((d) => wdN[A.dayWd(d)]++);
    let best = -1, bestV = -1;
    for (let k = 0; k < 7 * 24; k++) { const w = (k / 24) | 0; if (wdN[w]) { const v = wh[k] / wdN[w]; if (v > bestV) { bestV = v; best = k; } } }
    const tiles = [
      ["Incidents", fmt(n), days.length + " days in range"],
      ["Average per day", fmt(n / nd, 1), "Typical day: " + fmt(A.quantile(dayCounts, 0.1)) + "–" + fmt(A.quantile(dayCounts, 0.9)) + " (10th–90th pct)"],
      ["Unit responses", fmt(units), fmt(n ? units / n : NaN, 2) + " PSFA units per call"],
      ["Medical share", pct(med, n), fmt(med) + " medical incidents"],
      ["Busiest hour of the week", best >= 0 ? WEEKDAYS[(best / 24) | 0] + " " + String(best % 24).padStart(2, "0") + ":00" : "–", best >= 0 ? fmt(bestV, 1) + " calls in that hour on average" : ""],
      ["Mutual aid given", fmt(given), "and " + fmt(received) + " times aid was received"],
    ];
    const stc = new Array(A.STATIONS.length).fill(0);
    for (const i of rows) if (C.s[i] >= 0) stc[C.s[i]]++;
    let bs = -1; stc.forEach((v, k) => { if (bs < 0 || v > stc[bs]) bs = k; });
    if (bs >= 0 && stc[bs] > 0) tiles.splice(2, 0, ["Busiest station area*", "Station " + A.STATIONS[bs][0], fmt(stc[bs] / nd, 1) + " calls/day · " + A.STATIONS[bs][3]]);
    const el = document.getElementById("tiles");
    el.textContent = "";
    tiles.forEach(([k, v, s]) => {
      const t = document.createElement("div"); t.className = "tile";
      const a = document.createElement("div"); a.className = "k"; a.textContent = k;
      const b = document.createElement("div"); b.className = "v"; b.textContent = v;
      const d = document.createElement("div"); d.className = "s"; d.textContent = s;
      t.append(a, b, d); el.appendChild(t);
    });
  };

  // ===================================================================== B. volume
  function periodKey(d, gran) {
    if (gran === "day") return d;
    if (gran === "week") return d - A.dayWd(d);
    return A.dayMonth(d);
  }
  R.volume = function (ctx) {
    const { rows, st, c } = ctx;
    const gran = ui.volGran, measure = ui.volMeasure, view = ui.volView;
    const ch = A.chart("chVolume");
    // periods across the selected date range (zero-filled)
    const keys = [], keyIdx = new Map(), spans = [];
    for (let d = st.from; d <= st.to; d++) {
      const k = periodKey(d, gran);
      if (!keyIdx.has(k)) { keyIdx.set(k, keys.length); keys.push(k); spans.push([d, d]); }
      spans[keyIdx.get(k)][1] = d;
    }
    const lo = Math.max(st.from, A.WIN[0]), hi = Math.min(st.to, A.WIN[1]);
    const partial = keys.map((k, j) => {
      const [s, e] = spans[j];
      let ps, pe;
      if (gran === "day") { ps = pe = s; }
      else if (gran === "week") { ps = k; pe = k + 6; }
      else { ps = A.isoDay(k + "-01"); const [y, m] = k.split("-").map(Number); pe = A.isoDay(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)); }
      return ps < lo || pe > hi || s > ps || e < pe;
    });
    const total = new Float64Array(keys.length);
    const byCat = CATS.map(() => new Float64Array(keys.length));
    for (const i of rows) {
      if (!A.weekdayOk(A.wd[i], st)) continue;
      const j = keyIdx.get(periodKey(C.d[i], gran));
      if (j === undefined) continue;
      const v = measure === "units" ? unitsOf(i) : 1;
      total[j] += v; byCat[C.c[i]][j] += v;
    }
    const label = (k) => (gran === "month" ? A.prettyMonth(k) : gran === "week" ? "Week of " + A.shortDay(k) : A.prettyDay(k));
    const axisLabel = (k) => (gran === "month" ? A.MONTH_NAMES[+k.slice(5, 7) - 1] + " " + k.slice(2, 4) : A.shortDay(k));
    const xs = keys.map(axisLabel);
    const unit = measure === "units" ? "unit responses" : "incidents";
    const per = gran === "day" ? "per day" : gran === "week" ? "per week" : "per month";
    document.getElementById("volTitle").textContent = (measure === "units" ? "Unit responses " : "Incidents ") + per;
    document.getElementById("volDesc").textContent = view === "share" ? "Share of " + unit + " by category." :
      view === "multi" ? "Each category on its own scale, so small categories' trends are visible." + (gran === "day" ? " 7-day averages." : " Partial periods are left out.") :
        gran === "day" ? "Thin line = each day; bold = 7-day average. The 3 busiest days are labeled." : "Faded bars are partial periods (not fully covered by the data or the date filter).";
    const ax = A.axisBase(c);
    let opt;
    if (view === "multi") {
      const order = CATS.map((_, k) => k);
      const grids = [], xA = [], yA = [], series = [], titles = [];
      order.forEach((k, g) => {
        const col = g % 4, row = (g / 4) | 0;
        const left = 2 + col * 25, top = 8 + row * 50;
        grids.push({ left: left + 3 + "%", width: "19%", top: top + "%", height: "33%", containLabel: false });
        titles.push({ text: CATS[k] + "  " + fmt(sum(byCat[k])), left: left + 3 + "%", top: top - 6 + "%", textStyle: { fontSize: 12, fontWeight: 600, color: c.ink } });
        xA.push(Object.assign({}, ax, { type: "category", gridIndex: g, data: xs, axisLabel: { show: false }, splitLine: { show: false } }));
        yA.push(Object.assign({}, ax, { type: "value", gridIndex: g, splitNumber: 2, axisLabel: { color: c.muted, fontSize: 10 } }));
        series.push({ type: "line", name: CATS[k], xAxisIndex: g, yAxisIndex: g, data: Array.from(gran === "day" ? movingAvg(byCat[k], 7) : byCat[k]).map((v, j) => (gran !== "day" && partial[j] ? null : v)), showSymbol: false, lineStyle: { width: 2, color: c.cat(k) }, itemStyle: { color: c.cat(k) }, areaStyle: { color: c.cat(k), opacity: 0.08 } });
      });
      opt = A.baseOption(c, {
        title: titles, grid: grids, xAxis: xA, yAxis: yA, series,
        tooltip: Object.assign(A.baseOption(c).tooltip, { trigger: "axis", formatter: (ps) => ttHead(label(keys[ps[0].dataIndex])) + ps.map((p) => ttRow(p.color, fmt(p.value, gran === "day" ? 1 : 0), p.seriesName + (gran === "day" ? " (7-day avg)" : ""))).join("") }),
        axisPointer: { link: [{ xAxisIndex: "all" }] },
      });
      A.setTable("volume", ["Period"].concat(CATS), keys.map((k, j) => [label(k)].concat(CATS.map((_, ci) => byCat[ci][j]))));
    } else if (view === "share") {
      const series = CATS.map((name, k) => ({
        type: "bar", name, stack: "s", barCategoryGap: gran === "day" ? "10%" : "30%",
        data: keys.map((_, j) => ({ value: total[j] ? (100 * byCat[k][j]) / total[j] : 0, itemStyle: { opacity: partial[j] ? 0.45 : 1 } })),
        itemStyle: { color: c.cat(k), borderColor: c.surface, borderWidth: gran === "day" ? 0 : 1 },
        emphasis: { focus: "series" },
      }));
      opt = A.baseOption(c, {
        legend: { top: 0, textStyle: { color: c.ink2 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
        grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
        xAxis: Object.assign({}, ax, { type: "category", data: xs, splitLine: { show: false } }),
        yAxis: Object.assign({}, ax, { type: "value", max: 100, axisLabel: { color: c.muted, formatter: "{value}%" } }),
        tooltip: Object.assign(A.baseOption(c).tooltip, { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => ttHead(label(keys[ps[0].dataIndex]) + (partial[ps[0].dataIndex] ? " (partial)" : "")) + ps.slice().reverse().filter((p) => p.value > 0).map((p) => ttRow(p.color, fmt(p.value, 1) + "%", p.seriesName)).join("") }),
        series,
      });
      A.setTable("volume", ["Period"].concat(CATS.map((x) => x + " %")), keys.map((k, j) => [label(k)].concat(CATS.map((_, ci) => (total[j] ? (100 * byCat[ci][j]) / total[j] : 0)))));
    } else {
      const series = [];
      if (gran === "day") {
        const ma = movingAvg(total, 7);
        const top = Array.from(total.keys()).sort((a, b) => total[b] - total[a]).slice(0, 3);
        series.push({ type: "line", name: "Daily", data: Array.from(total), showSymbol: false, lineStyle: { width: 1, color: c.trend, opacity: 0.45 }, itemStyle: { color: c.trend },
          markPoint: { symbol: "circle", symbolSize: 8, itemStyle: { color: c.trend, borderColor: c.surface, borderWidth: 2 }, label: { show: true, position: "top", color: c.ink, fontSize: 11, formatter: (p) => A.shortDay(keys[p.data.coord[0]]) + ": " + fmt(p.value) }, data: top.map((j) => ({ coord: [j, total[j]], value: total[j] })) },
          markArea: partialAreas(keys, partial, c) });
        series.push({ type: "line", name: "7-day average", data: Array.from(ma), showSymbol: false, lineStyle: { width: 2.5, color: c.trend }, itemStyle: { color: c.trend }, z: 3 });
      } else {
        series.push({ type: "bar", name: unit, barCategoryGap: "25%", data: keys.map((_, j) => ({ value: total[j], itemStyle: { opacity: partial[j] ? 0.4 : 1 } })), itemStyle: { color: c.trend, borderRadius: [4, 4, 0, 0] },
          label: { show: keys.length <= 14, position: "top", color: c.ink2, fontSize: 11, formatter: (p) => fmt(p.value) } });
      }
      opt = A.baseOption(c, {
        grid: { left: 8, right: 16, top: 34, bottom: gran === "day" ? 48 : 8, containLabel: true },
        xAxis: Object.assign({}, ax, { type: "category", data: xs, boundaryGap: gran !== "day", splitLine: { show: false } }),
        yAxis: Object.assign({}, ax, { type: "value", name: unit }),
        tooltip: Object.assign(A.baseOption(c).tooltip, { trigger: "axis", axisPointer: { type: gran === "day" ? "line" : "shadow", lineStyle: { color: c.axis } },
          formatter: (ps) => ttHead(label(keys[ps[0].dataIndex]) + (partial[ps[0].dataIndex] ? " · partial" : "")) + ps.map((p) => ttRow(p.color, fmt(typeof p.value === "object" ? p.value.value : p.value, p.seriesName === "7-day average" ? 1 : 0), p.seriesName)).join("") }),
        dataZoom: gran === "day" ? [{ type: "slider", height: 18, bottom: 6, borderColor: c.grid, fillerColor: c.band, dataBackground: { lineStyle: { color: c.trend2 }, areaStyle: { color: c.band } }, selectedDataBackground: { lineStyle: { color: c.trend }, areaStyle: { color: c.band } }, textStyle: { color: c.muted }, handleStyle: { color: c.surface, borderColor: c.axis } }, { type: "inside" }] : [],
        series,
      });
      A.setTable("volume", ["Period", unit, "Partial?"], keys.map((k, j) => [label(k), total[j], partial[j] ? "partial" : ""]));
    }
    ch.setOption(opt, true);
    const nPartial = partial.filter(Boolean).length;
    document.getElementById("volNote").textContent = nPartial && gran !== "day" ? nPartial + " partial period(s) shown faded." :
      (st.from < A.WIN[0] || st.to > A.WIN[1]) && gran === "day" ? "Shaded = days outside the complete-data window (" + A.prettyDay(A.WIN[0]) + " – " + A.prettyDay(A.WIN[1]) + "), when reporting was incomplete." : "";
  };
  function partialAreas(keys, partial, c) {
    const areas = [];
    let s = -1;
    for (let j = 0; j <= keys.length; j++) {
      if (j < keys.length && partial[j]) { if (s < 0) s = j; }
      else if (s >= 0) { areas.push([{ xAxis: s }, { xAxis: j - 1 }]); s = -1; }
    }
    return { silent: true, itemStyle: { color: c.night }, data: areas };
  }
  function movingAvg(arr, w) {
    const out = new Float64Array(arr.length);
    let s = 0;
    for (let j = 0; j < arr.length; j++) { s += arr[j]; if (j >= w) s -= arr[j - w]; out[j] = s / Math.min(j + 1, w); }
    return out;
  }

  // ===================================================================== C. time of day
  function smooth144(a) {
    const out = new Float64Array(144);
    for (let j = 0; j < 144; j++) out[j] = (a[(j + 143) % 144] + a[j] + a[(j + 1) % 144]) / 3;
    return out;
  }
  R.tod = function (ctx) {
    const { rows, days, c } = ctx;
    const ch = A.chart("chTod");
    const xs = []; for (let j = 0; j < 144; j++) xs.push(A.hhmm(j * 10));
    const nWkday = days.filter((d) => A.dayWd(d) < 5).length, nWkend = days.length - nWkday;
    const groups = [];
    const cmp = ui.todCompare;
    if (cmp === "none") {
      const a = new Float64Array(144); for (const i of rows) a[A.bin10[i]]++;
      groups.push({ name: "All calls", color: c.trend, counts: a, denom: days.length, n: rows.length });
    } else if (cmp === "wk") {
      const a = new Float64Array(144), b = new Float64Array(144); let na = 0, nb = 0;
      for (const i of rows) { if (A.wd[i] < 5) { a[A.bin10[i]]++; na++; } else { b[A.bin10[i]]++; nb++; } }
      if (nWkday) groups.push({ name: "Mon–Fri", color: c.trend, counts: a, denom: nWkday, n: na });
      if (nWkend) groups.push({ name: "Sat–Sun", color: c.trend2, counts: b, denom: nWkend, n: nb });
    } else {
      const pick = ["Medical", "Fire", "Alarms"].map((n) => CATS.indexOf(n));
      const arrs = pick.map(() => new Float64Array(144)), other = new Float64Array(144);
      const ns = pick.map(() => 0); let no = 0;
      for (const i of rows) { const k = pick.indexOf(C.c[i]); if (k >= 0) { arrs[k][A.bin10[i]]++; ns[k]++; } else { other[A.bin10[i]]++; no++; } }
      pick.forEach((ci, k) => { if (ns[k]) groups.push({ name: CATS[ci], color: c.cat(ci), counts: arrs[k], denom: ns[k] / 100, n: ns[k], share: true }); });
      if (no) groups.push({ name: "All other", color: c.other, counts: other, denom: no / 100, n: no, share: true });
    }
    const share = cmp === "cat";
    const series = groups.map((g) => {
      const raw = g.counts.map((v) => (g.denom ? v / g.denom : 0));
      const data = ui.todSmooth ? smooth144(raw) : raw;
      return { type: "line", name: g.name, data: Array.from(data), showSymbol: false, smooth: false, lineStyle: { width: 2, color: g.color }, itemStyle: { color: g.color },
        areaStyle: groups.length === 1 ? { color: g.color, opacity: 0.1 } : undefined };
    });
    if (series.length) series[0].markArea = { silent: true, itemStyle: { color: c.night }, data: [[{ xAxis: 0 }, { xAxis: A.DAY_H0 * 6 }], [{ xAxis: A.DAY_H1 * 6 }, { xAxis: 143 }]] };
    const ax = A.axisBase(c);
    ch.setOption(A.baseOption(c, {
      legend: groups.length > 1 ? { top: 0, textStyle: { color: c.ink2 }, itemWidth: 14, itemHeight: 2, icon: "rect" } : undefined,
      grid: { left: 8, right: 16, top: groups.length > 1 ? 56 : 34, bottom: 8, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "category", data: xs, boundaryGap: false, splitLine: { show: false }, axisLabel: { color: c.muted, interval: 11 } }),
      yAxis: Object.assign({}, ax, { type: "value", name: share ? "% of that group's calls" : "calls per 10 min, per day", axisLabel: { color: c.muted, formatter: share ? "{value}%" : null } }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: c.axis } },
        formatter: (ps) => ttHead(xs[ps[0].dataIndex] + "–" + A.hhmm(ps[0].dataIndex * 10 + 9) + (ui.todSmooth ? " (smoothed)" : "")) + ps.map((p) => ttRow(p.color, share ? fmt(p.value, 2) + "%" : fmt(p.value, 2), p.seriesName)).join("") }),
      series,
    }), true);
    A.setTable("tod", ["Time"].concat(groups.map((g) => g.name + (share ? " (% of group)" : " (avg/day)"))), xs.map((x, j) => [x].concat(groups.map((g) => (g.denom ? g.counts[j] / g.denom : 0)))));
    const note = document.getElementById("todNote");
    const minN = Math.min.apply(null, groups.map((g) => g.n).concat([rows.length]));
    note.textContent = groups.map((g) => g.name + ": n = " + fmt(g.n)).join(" · ") + (share ? " · Each line shows when that group's calls happen (sums to 100%)." : " · Averaged over " + fmt(days.length) + " days.");
    note.className = minN < 500 ? "warn" : "note";
    if (minN < 500) note.textContent = "Small sample, so patterns may be noise. " + note.textContent;
  };

  R.heat = function (ctx) {
    const { rows, days, c, st } = ctx;
    const ch = A.chart("chHeat");
    const wdN = new Array(7).fill(0); days.forEach((d) => wdN[A.dayWd(d)]++);
    const cnt = new Float64Array(7 * 24);
    for (const i of rows) cnt[A.wd[i] * 24 + A.hour[i]]++;
    const data = [];
    let max = 0;
    for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) {
      const v = wdN[w] ? cnt[w * 24 + h] / wdN[w] : 0;
      max = Math.max(max, v);
      data.push([h, w, +v.toFixed(2)]);
    }
    const ax = A.axisBase(c);
    ch.setOption(A.baseOption(c, {
      grid: { left: 8, right: 16, top: 8, bottom: 44, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "category", data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")), splitLine: { show: false }, axisLine: { show: false } }),
      yAxis: Object.assign({}, ax, { type: "category", data: WEEKDAYS, inverse: true, splitLine: { show: false }, axisLine: { show: false } }),
      visualMap: { min: 0, max: max || 1, dimension: 2, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 160, itemWidth: 10, text: [fmt(max, 1), "0"], textStyle: { color: c.muted, fontSize: 11 }, inRange: { color: c.gseq.slice(0, 8) } },
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => ttHead(WEEKDAYS[p.value[1]] + " " + String(p.value[0]).padStart(2, "0") + ":00–" + String(p.value[0]).padStart(2, "0") + ":59") + ttRow(null, fmt(p.value[2], 2), "calls on average") + ttRow(null, fmt(cnt[p.value[1] * 24 + p.value[0]]), "total") }),
      series: [{ type: "heatmap", data, itemStyle: { borderColor: c.surface, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: c.ink, borderWidth: 1 } } }],
    }), true);
    ch.off("click");
    ch.on("click", (p) => {
      const cur = st.drill.wh;
      const v = [p.value[1], p.value[0]];
      A.setState({ drill: { wh: cur && cur[0] === v[0] && cur[1] === v[1] ? null : v } });
    });
    A.setTable("heat", ["Weekday"].concat(Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0") + ":00")), WEEKDAYS.map((w, wi) => [w].concat(Array.from({ length: 24 }, (_, h) => (wdN[wi] ? cnt[wi * 24 + h] / wdN[wi] : 0)))));
  };

  R.dow = function (ctx) {
    const { rows, days, c } = ctx;
    const wdN = new Array(7).fill(0); days.forEach((d) => wdN[A.dayWd(d)]++);
    const cnt = new Array(7).fill(0); for (const i of rows) cnt[A.wd[i]]++;
    const vals = cnt.map((v, w) => (wdN[w] ? v / wdN[w] : 0));
    const ax = A.axisBase(c);
    A.chart("chDow").setOption(A.baseOption(c, {
      xAxis: Object.assign({}, ax, { type: "category", data: WEEKDAYS, splitLine: { show: false } }),
      yAxis: Object.assign({}, ax, { type: "value", name: "calls per day" }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => ttHead(p.name) + ttRow(null, fmt(p.value, 1), "calls per day") + ttRow(null, fmt(wdN[p.dataIndex]), p.name + "s in range") }),
      series: [{ type: "bar", data: vals.map((v) => +v.toFixed(2)), barCategoryGap: "30%", itemStyle: { color: c.trend, borderRadius: [4, 4, 0, 0] }, label: { show: true, position: "top", color: c.ink2, fontSize: 11, formatter: (p) => fmt(p.value, 0) } }],
    }), true);
    A.setTable("dow", ["Weekday", "Avg calls/day", "Days in range"], WEEKDAYS.map((w, k) => [w, vals[k], wdN[k]]));
  };

  // typical shift
  R.shift = function (ctx) {
    const { rows, days, c, st } = ctx;
    // shifts fully inside the date range: start day s in [from, to-1]
    const shiftSet = new Map();
    days.forEach((d) => { if (d < st.to || st.from === st.to) shiftSet.set(d, shiftSet.size); });
    const S = shiftSet.size;
    const mat = new Float64Array(Math.max(S, 1) * 24);
    for (const i of rows) { const k = shiftSet.get(A.shiftDay[i]); if (k !== undefined) mat[k * 24 + A.shiftHour[i]]++; }
    const med = [], p10 = [], p90 = [], mean = [];
    for (let h = 0; h < 24; h++) {
      const col = []; for (let k = 0; k < S; k++) col.push(mat[k * 24 + h]);
      col.sort((a, b) => a - b);
      med.push(A.quantile(col, 0.5)); p10.push(A.quantile(col, 0.1)); p90.push(A.quantile(col, 0.9)); mean.push(col.length ? sum(col) / col.length : 0);
    }
    const totals = [], overnight = [];
    const ovStart = (22 - A.SHIFT0 + 24) % 24; // shift hour of 22:00
    for (let k = 0; k < S; k++) {
      let t = 0, o = 0;
      for (let h = 0; h < 24; h++) { const v = mat[k * 24 + h]; t += v; if (h >= ovStart) o += v; }
      totals.push(t); overnight.push(o);
    }
    const sT = totals.slice().sort((a, b) => a - b), sO = overnight.slice().sort((a, b) => a - b);
    const xs = []; for (let h = 0; h < 24; h++) xs.push(String((h + A.SHIFT0) % 24).padStart(2, "0") + ":00");
    const ax = A.axisBase(c);
    A.chart("chShift").setOption(A.baseOption(c, {
      legend: { top: 0, textStyle: { color: c.ink2 }, data: ["Median shift", "Average", "10th–90th percentile"] },
      grid: { left: 8, right: 16, top: 56, bottom: 8, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "category", data: xs, boundaryGap: false, splitLine: { show: false }, axisLabel: { color: c.muted, interval: 2 } }),
      yAxis: Object.assign({}, ax, { type: "value", name: "calls in that hour" }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { trigger: "axis", formatter: (ps) => { const j = ps[0].dataIndex; return ttHead(xs[j] + " (hour " + (j + 1) + " of the shift)") + ttRow(c.trend, fmt(med[j], 1), "median shift") + ttRow(c.trend2, fmt(mean[j], 2), "average") + ttRow(null, fmt(p10[j], 0) + "–" + fmt(p90[j], 0), "10th–90th percentile"); } }),
      series: [
        { type: "line", name: "p10", data: p10, stack: "band", lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
        { type: "line", name: "10th–90th percentile", data: p90.map((v, j) => v - p10[j]), stack: "band", lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: c.trend, opacity: 0.14 }, itemStyle: { color: c.trend }, silent: true },
        { type: "line", name: "Median shift", data: med, showSymbol: false, step: "middle", lineStyle: { width: 2.5, color: c.trend }, itemStyle: { color: c.trend } },
        { type: "line", name: "Average", data: mean.map((v) => +v.toFixed(2)), showSymbol: false, lineStyle: { width: 1.5, color: c.trend2 }, itemStyle: { color: c.trend2 } },
      ],
    }), true);
    A.setTable("shift", ["Clock time", "Shift hour", "Median", "Average", "10th pct", "90th pct"], xs.map((x, j) => [x, j + 1, med[j], mean[j], p10[j], p90[j]]));
    document.getElementById("shiftDesc").textContent = "Calls per hour of a 24-hour shift starting " + String(A.SHIFT0).padStart(2, "0") + ":00 (assumed). Line = median shift, band = 10th–90th percentile, over " + fmt(S) + " shifts.";

    // distribution
    const maxT = sT.length ? sT[sT.length - 1] : 0;
    const bw = maxT > 120 ? 10 : maxT > 40 ? 5 : maxT > 12 ? 2 : 1;
    const b0 = sT.length ? Math.floor(sT[0] / bw) : 0;
    const nb = Math.floor(maxT / bw) + 1 - b0;
    const hist = new Array(Math.max(nb, 1)).fill(0); totals.forEach((t) => hist[Math.floor(t / bw) - b0]++);
    const hx = hist.map((_, k) => { const b = k + b0; return bw === 1 ? String(b) : b * bw + "–" + (b * bw + bw - 1); });
    A.chart("chShiftDist").setOption(A.baseOption(c, {
      xAxis: Object.assign({}, ax, { type: "category", data: hx, name: "calls per shift", nameLocation: "middle", nameGap: 26, splitLine: { show: false } }),
      yAxis: Object.assign({}, ax, { type: "value", name: "shifts" }),
      grid: { left: 8, right: 16, top: 34, bottom: 24, containLabel: true },
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => ttHead(p.name + " calls") + ttRow(null, fmt(p.value), "shifts") }),
      series: [{ type: "bar", data: hist, barCategoryGap: "10%", itemStyle: { color: c.trend, borderRadius: [3, 3, 0, 0] } }],
    }), true);
    A.setTable("shiftdist", ["Calls per shift", "Shifts"], hx.map((x, b) => [x, hist[b]]));
    document.getElementById("shiftDistDesc").textContent = S ? "Median shift: " + fmt(A.quantile(sT, 0.5)) + " calls (busy 90th pct: " + fmt(A.quantile(sT, 0.9)) + "). On half of shifts, at least " + fmt(Math.floor(A.quantile(sO, 0.5))) + " come after 22:00." : "Pick a range longer than one day.";
  };

  // ===================================================================== D. types
  R.cats = function (ctx) {
    const { rows, c, st } = ctx;
    const all = A.filterRows(st, { cats: true });
    const cnt = new Array(CATS.length).fill(0); for (const i of all) cnt[C.c[i]]++;
    const tot = sum(cnt);
    const order = CATS.map((_, k) => k).sort((a, b) => cnt[b] - cnt[a]);
    const ax = A.axisBase(c);
    const ch = A.chart("chCats");
    ch.setOption(A.baseOption(c, {
      grid: { left: 8, right: 70, top: 4, bottom: 4, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "value", show: false }),
      yAxis: Object.assign({}, ax, { type: "category", data: order.map((k) => CATS[k]), inverse: true, axisLine: { show: false }, axisLabel: { color: c.ink2, fontSize: 12 } }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => ttHead(p.name) + ttRow(null, fmt(p.value), "incidents") + ttRow(null, pct(p.value, tot), "of all") }),
      series: [{ type: "bar", barCategoryGap: "28%", data: order.map((k) => ({ value: cnt[k], itemStyle: { color: c.cat(k), opacity: st.cats[k] ? 1 : 0.3 } })), itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: c.ink2, fontSize: 11, formatter: (p) => fmt(p.value) + "  " + pct(p.value, tot) } }],
    }), true);
    ch.off("click");
    ch.on("click", (p) => {
      const k = CATS.indexOf(p.name);
      const only = st.cats.every((v, j) => (j === k ? v : !v));
      A.setState({ cats: CATS.map((_, j) => (only ? true : j === k)) });
    });
    A.setTable("cats", ["Category", "Incidents", "Share %"], order.map((k) => [CATS[k], cnt[k], tot ? (100 * cnt[k]) / tot : 0]));
  };

  R.explorer = function (ctx) {
    const { rows, c } = ctx;
    const path = ui.expl; // [l1, l2] human labels
    const lvl = Math.min(path.length, 2);
    const cnt = new Map(), byCat = new Map();
    let n = 0;
    for (const i of rows) {
      const t = TYPES[C.t[i]];
      if (path.length >= 1 && t[1] !== path[0]) continue;
      if (path.length >= 2 && t[2] !== path[1]) continue;
      n++;
      const key = t[1 + lvl];
      cnt.set(key, (cnt.get(key) || 0) + 1);
      if (!byCat.has(key)) byCat.set(key, new Array(CATS.length).fill(0));
      byCat.get(key)[C.c[i]]++;
    }
    const items = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]);
    const top = items.slice(0, 15);
    const otherCats = new Array(CATS.length).fill(0);
    items.slice(15).forEach(([k]) => byCat.get(k).forEach((v, ci) => { otherCats[ci] += v; }));
    if (items.length > 15) { const lab = "All other (" + (items.length - 15) + " types)"; top.push([lab, sum(items.slice(15).map((x) => x[1]))]); byCat.set(lab, otherCats); }
    const usedCats = CATS.map((_, ci) => ci).filter((ci) => top.some((x) => byCat.get(x[0])[ci] > 0));
    const ax = A.axisBase(c);
    const ch = A.chart("chExplorer");
    ch.setOption(A.baseOption(c, {
      grid: { left: 8, right: 70, top: 4, bottom: 4, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "value", show: false }),
      yAxis: Object.assign({}, ax, { type: "category", data: top.map((x) => x[0]), inverse: true, axisLine: { show: false }, axisLabel: { color: c.ink2, fontSize: 12, width: 220, overflow: "truncate" } }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => {
        const name = top[ps[0].dataIndex][0], tot = top[ps[0].dataIndex][1];
        return ttHead(name) + ttRow(null, fmt(tot), "incidents · " + pct(tot, n) + " of this level") +
          ps.filter((p) => p.value > 0).map((p) => ttRow(p.color, fmt(p.value), p.seriesName)).join("") +
          (lvl < 2 && name.indexOf("All other (") !== 0 ? '<div style="opacity:.6;margin-top:4px">Click to drill in</div>' : "");
      } }),
      // one stacked segment per dashboard category, so every bar wears the category colours
      // (NERIS branches mix categories: e.g. Public service = Public service + Alarms)
      series: usedCats.map((ci, j) => ({ type: "bar", name: CATS[ci], stack: "cat", barCategoryGap: "28%",
        data: top.map((x) => byCat.get(x[0])[ci]), itemStyle: { color: c.cat(ci), borderColor: c.surface, borderWidth: 1 },
        label: j === usedCats.length - 1 ? { show: true, position: "right", color: c.ink2, fontSize: 11, formatter: (p) => fmt(top[p.dataIndex][1]) } : undefined })),
    }), true);
    ch.off("click");
    ch.on("click", (p) => {
      if (lvl >= 2 || p.name.indexOf("All other (") === 0) return;
      ui.expl = path.concat([p.name]);
      R.explorer(ctx);
    });
    // breadcrumb
    const cr = document.getElementById("explCrumbs");
    cr.textContent = "";
    const mk = (text, depth) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = text;
      b.addEventListener("click", () => { ui.expl = path.slice(0, depth); R.explorer(ctx); });
      return b;
    };
    cr.appendChild(path.length ? mk("All types", 0) : Object.assign(document.createElement("strong"), { textContent: "All types" }));
    path.forEach((p, k) => {
      const s = document.createElement("span"); s.className = "sep"; s.textContent = "›"; cr.appendChild(s);
      cr.appendChild(k === path.length - 1 ? Object.assign(document.createElement("strong"), { textContent: p }) : mk(p, k + 1));
    });
    const fbtn = document.getElementById("explFilter");
    fbtn.hidden = path.length === 0;
    fbtn.onclick = () => {
      const pth = { l1: path[0] }; if (path[1]) pth.l2 = path[1];
      A.setState({ drill: { path: pth, type: null } });
    };
    const medPlain = cnt.get("(not specified)");
    document.getElementById("explNote").textContent = path[0] === "Medical" && medPlain ? fmt(medPlain) + " (" + pct(medPlain, n) + ") of medical incidents are coded only as \"Medical\" with no detail. NERIS generalizes medical types for privacy." : "";
    A.setTable("explorer", ["Type", "Incidents", "Share %"], items.map((x) => [x[0], x[1], n ? (100 * x[1]) / n : 0]));
  };

  R.toptypes = function (ctx) {
    const { rows, c, st } = ctx;
    const cnt = new Map(); let plain = 0;
    for (const i of rows) { const t = C.t[i]; if (TYPES[t][0] === "Medical") { plain++; continue; } cnt.set(t, (cnt.get(t) || 0) + 1); }
    const items = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const labels = uniqLabels(items.map((x) => x[0]));
    const ax = A.axisBase(c);
    const ch = A.chart("chTopTypes");
    ch.setOption(A.baseOption(c, {
      grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "value", show: false }),
      yAxis: Object.assign({}, ax, { type: "category", data: labels, inverse: true, axisLine: { show: false }, axisLabel: { color: c.ink2, fontSize: 12, width: 230, overflow: "truncate" } }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => ttHead(TYPES[items[p.dataIndex][0]][0]) + ttRow(c.cat(TYPES[items[p.dataIndex][0]][4]), fmt(p.value), "incidents · " + CATS[TYPES[items[p.dataIndex][0]][4]]) }),
      series: [{ type: "bar", data: items.map((x) => ({ value: x[1], itemStyle: { color: c.cat(TYPES[x[0]][4]) } })), barCategoryGap: "25%", itemStyle: { borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", color: c.ink2, fontSize: 11, formatter: (p) => fmt(p.value) } }],
    }), true);
    ch.off("click");
    ch.on("click", (p) => { const t = items[p.dataIndex][0]; A.setState({ drill: { type: st.drill.type === t ? null : t, path: null } }); });
    document.getElementById("topTypesDesc").textContent = "Bar color = category. Not shown: " + fmt(plain) + " incidents coded only as \"Medical\" (" + pct(plain, rows.length) + ").";
    A.setTable("toptypes", ["Type", "Category", "Incidents"], items.map((x) => [TYPES[x[0]][0], CATS[TYPES[x[0]][4]], x[1]]));
  };

  R.typehour = function (ctx) {
    const { rows, c } = ctx;
    const cnt = new Map();
    for (const i of rows) { const t = C.t[i]; if (TYPES[t][0] !== "Medical") cnt.set(t, (cnt.get(t) || 0) + 1); }
    const top = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x[0]);
    const tl = uniqLabels(top);
    // each type row is shaded in its category's colour; the reference row stays neutral grey
    const rowsDef = [{ name: "All calls (reference)", n: rows.length, color: c.trend }].concat(top.map((t, k) => ({ name: tl[k], n: cnt.get(t), t, cat: TYPES[t][4], color: c.cat(TYPES[t][4]) })));
    const mats = rowsDef.map(() => new Float64Array(24));
    const tIndex = new Map(top.map((t, k) => [t, k + 1]));
    for (const i of rows) { mats[0][A.hour[i]]++; const k = tIndex.get(C.t[i]); if (k) mats[k][A.hour[i]]++; }
    const data = [];
    rowsDef.forEach((r, k) => {
      const mx = Math.max.apply(null, mats[k]) || 1;
      for (let h = 0; h < 24; h++) {
        const v = mats[k][h] / mx;
        // single-hue ramp per row: surface -> category colour (a floor keeps quiet hours visible)
        data.push({ value: [h, k, +v.toFixed(3), mats[k][h]], itemStyle: { color: mixHex(c.surface, r.color, 0.08 + 0.92 * v) } });
      }
    });
    const ax = A.axisBase(c);
    A.chart("chTypeHour").setOption(A.baseOption(c, {
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "category", data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")), splitLine: { show: false }, axisLine: { show: false }, axisLabel: { color: c.muted, interval: 2 } }),
      yAxis: Object.assign({}, ax, { type: "category", data: rowsDef.map((r, k) => "{k" + k + "|} " + r.name + "  (" + fmt(r.n) + ")"), inverse: true, axisLine: { show: false },
        axisLabel: { color: c.ink2, fontSize: 11, width: 230, overflow: "truncate", rich: swatchRich(rowsDef.map((r) => r.color)) } }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => { const r = rowsDef[p.value[1]]; return ttHead(r.name + " · " + String(p.value[0]).padStart(2, "0") + ":00") + ttRow(r.color, fmt(p.value[3]), "calls in this hour") + ttRow(null, fmt(100 * p.value[2], 0) + "%", "of this type's busiest hour") + (r.cat !== undefined ? ttRow(null, CATS[r.cat], "category") : ""); } }),
      series: [{ type: "heatmap", data, itemStyle: { borderColor: c.surface, borderWidth: 1.5, borderRadius: 2 } }],
    }), true);
    A.setTable("typehour", ["Type", "n"].concat(Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"))), rowsDef.map((r, k) => [r.name, r.n].concat(Array.from(mats[k]))));
  };
  /** Short labels for a list of type ids, disambiguated by branch when two collide. */
  function uniqLabels(ids) {
    const base = ids.map(shortType), seen = {};
    base.forEach((b) => { seen[b] = (seen[b] || 0) + 1; });
    return ids.map((t, k) => (seen[base[k]] > 1 ? base[k] + " (" + TYPES[t][1].split(" ")[0].toLowerCase() + ")" : base[k]));
  }
  /** Blend two #rrggbb colours: t=0 -> a, t=1 -> b. */
  function mixHex(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const x = p(a), y = p(b);
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
  }
  /** ECharts rich-text styles k0..kN that render a small colour square (label swatch). */
  function swatchRich(colors) {
    const out = {};
    colors.forEach((col, k) => { out["k" + k] = { width: 9, height: 9, borderRadius: 2, backgroundColor: col }; });
    return out;
  }
  function shortType(t) { const ti = TYPES[t]; return ti[3] !== "(not specified)" ? ti[3] : ti[2] !== "(not specified)" ? ti[2] : ti[1]; }

  // ===================================================================== E. deployment
  R.units = function (ctx) {
    const { c, st } = ctx;
    const rows = A.filterRows(st, { units: true });
    const hist = new Array(11).fill(0);
    for (const i of rows) { const u = C.u[i]; if (u >= 0) hist[Math.min(u, 10)]++; }
    const xs = hist.map((_, k) => (k === 10 ? "10+" : String(k)));
    const ax = A.axisBase(c);
    const sel = st.units;
    const bucketOf = (k) => (k === 0 ? "0" : k === 1 ? "1" : k === 2 ? "2" : k <= 4 ? "3-4" : "5+");
    const ch = A.chart("chUnits");
    ch.setOption(A.baseOption(c, {
      grid: { left: 8, right: 16, top: 34, bottom: 24, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "category", data: xs, name: "PSFA units", nameLocation: "middle", nameGap: 26, splitLine: { show: false } }),
      yAxis: Object.assign({}, ax, { type: "value", name: "incidents" }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => ttHead(p.name + " unit" + (p.name === "1" ? "" : "s")) + ttRow(null, fmt(hist[p.dataIndex]), "incidents") + ttRow(null, pct(hist[p.dataIndex], rows.length), "of incidents") }),
      series: [{ type: "bar", data: hist.map((v, k) => ({ value: v, itemStyle: { opacity: sel === "all" || sel === bucketOf(k) ? 1 : 0.3 } })), barCategoryGap: "20%", itemStyle: { color: c.trend, borderRadius: [3, 3, 0, 0] }, label: { show: true, position: "top", color: c.ink2, fontSize: 10, formatter: (p) => (hist[p.dataIndex] ? pct(hist[p.dataIndex], rows.length) : "") } }],
    }), true);
    ch.off("click");
    ch.on("click", (p) => { const b = bucketOf(p.dataIndex); A.setState({ units: st.units === b ? "all" : b }); syncControls(); });
    A.setTable("units", ["Units", "Incidents", "Share %"], xs.map((x, k) => [x, hist[k], rows.length ? (100 * hist[k]) / rows.length : 0]));
  };

  R.unitsType = function (ctx) {
    const { rows, c } = ctx;
    const agg = new Map();
    for (const i of rows) { const u = C.u[i]; if (u < 0) continue; const t = C.t[i]; const a = agg.get(t) || [0, 0, 0]; a[0]++; a[1] += u; if (u >= 5) a[2]++; agg.set(t, a); }
    const items = Array.from(agg.entries()).filter((x) => x[1][0] >= 30).map((x) => [x[0], x[1][1] / x[1][0], x[1][0], x[1][2]]).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const ax = A.axisBase(c);
    A.chart("chUnitsType").setOption(A.baseOption(c, {
      grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "value", show: false }),
      yAxis: Object.assign({}, ax, { type: "category", data: uniqLabels(items.map((x) => x[0])), inverse: true, axisLine: { show: false }, axisLabel: { color: c.ink2, fontSize: 12, width: 260, overflow: "truncate" } }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => { const x = items[p.dataIndex]; return ttHead(TYPES[x[0]][0]) + ttRow(null, fmt(x[1], 2), "PSFA units on average") + ttRow(null, fmt(x[2]), "incidents") + ttRow(null, fmt(x[3]), "with 5+ units"); } }),
      series: [{ type: "bar", data: items.map((x) => ({ value: +x[1].toFixed(2), itemStyle: { color: c.cat(TYPES[x[0]][4]) } })), barCategoryGap: "25%", itemStyle: { borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", color: c.ink2, fontSize: 11, formatter: (p) => fmt(p.value, 1) } }],
    }), true);
    A.setTable("unitsType", ["Type", "Avg units", "Incidents", "With 5+ units"], items.map((x) => [TYPES[x[0]][0], x[1], x[2], x[3]]));
  };

  R.unitsHour = function (ctx) {
    const { rows, days, c } = ctx;
    const s = new Float64Array(24); for (const i of rows) s[A.hour[i]] += unitsOf(i);
    const nd = days.length || 1;
    const vals = Array.from(s).map((v) => +(v / nd).toFixed(2));
    const xs = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0") + ":00");
    const ax = A.axisBase(c);
    A.chart("chUnitsHour").setOption(A.baseOption(c, {
      xAxis: Object.assign({}, ax, { type: "category", data: xs, splitLine: { show: false }, axisLabel: { color: c.muted, interval: 2 } }),
      yAxis: Object.assign({}, ax, { type: "value", name: "unit responses per day" }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => ttHead(p.name + "–" + p.name.slice(0, 2) + ":59") + ttRow(null, fmt(p.value, 1), "unit responses per day") }),
      series: [{ type: "bar", data: vals.map((v, h) => ({ value: v, itemStyle: { opacity: h >= A.DAY_H0 && h < A.DAY_H1 ? 1 : 0.7 } })), barCategoryGap: "18%", itemStyle: { color: c.trend, borderRadius: [3, 3, 0, 0] } }],
    }), true);
    A.setTable("unitsHour", ["Hour", "Unit responses/day"], xs.map((x, h) => [x, vals[h]]));
  };

  R.aid = function (ctx) {
    const { rows, c } = ctx;
    const G = A.D.dict.aid.indexOf("Given"), Rc = A.D.dict.aid.indexOf("Received"), B = A.D.dict.aid.indexOf("Both");
    const months = [], mi = new Map();
    for (let d = ctx.st.from; d <= ctx.st.to; d++) { const m = A.dayMonth(d); if (!mi.has(m)) { mi.set(m, months.length); months.push(m); } }
    const g = new Array(months.length).fill(0), r = new Array(months.length).fill(0);
    for (const i of rows) { const k = mi.get(A.dayMonth(C.d[i])); if (k === undefined) continue; const a = C.a[i]; if (a === G || a === B) g[k]++; if (a === Rc || a === B) r[k]++; }
    const ax = A.axisBase(c);
    A.chart("chAid").setOption(A.baseOption(c, {
      legend: { top: 0, textStyle: { color: c.ink2 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 56, bottom: 8, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "category", data: months.map((m) => A.MONTH_NAMES[+m.slice(5, 7) - 1]), splitLine: { show: false } }),
      yAxis: Object.assign({}, ax, { type: "value", name: "incidents" }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => ttHead(A.prettyMonth(months[ps[0].dataIndex])) + ps.map((p) => ttRow(p.color, fmt(p.value), "aid " + p.seriesName.toLowerCase())).join("") }),
      series: [
        { type: "bar", name: "Given", data: g, itemStyle: { color: c.trend, borderRadius: [3, 3, 0, 0] }, barGap: "8%", barCategoryGap: "30%" },
        { type: "bar", name: "Received", data: r, itemStyle: { color: c.trend2, borderRadius: [3, 3, 0, 0] } },
      ],
    }), true);
    A.setTable("aid", ["Month", "Aid given", "Aid received"], months.map((m, k) => [A.prettyMonth(m), g[k], r[k]]));
  };

  function rankedBar(id, key, items, total, c, onClick, selected, labelFn) {
    const ax = A.axisBase(c);
    const ch = A.chart(id);
    ch.setOption(A.baseOption(c, {
      grid: { left: 8, right: 70, top: 4, bottom: 4, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "value", show: false }),
      yAxis: Object.assign({}, ax, { type: "category", data: items.map((x) => x[1]), inverse: true, axisLine: { show: false }, axisLabel: { color: c.ink2, fontSize: 12, width: 250, overflow: "truncate" } }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => ttHead(p.name) + ttRow(null, fmt(items[p.dataIndex][2]), "incidents") + ttRow(null, pct(items[p.dataIndex][2], total), labelFn || "of incidents") }),
      series: [{ type: "bar", data: items.map((x) => ({ value: x[2], itemStyle: { opacity: selected === null || selected === x[0] ? 1 : 0.35 } })), barCategoryGap: "25%", itemStyle: { color: c.trend, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: c.ink2, fontSize: 11, formatter: (p) => pct(items[p.dataIndex][2], total) } }],
    }), true);
    ch.off("click");
    ch.on("click", (p) => onClick(items[p.dataIndex][0]));
    A.setTable(key, ["Item", "Incidents", "Share %"], items.map((x) => [x[1], x[2], total ? (100 * x[2]) / total : 0]));
  }

  R.actions = function (ctx) {
    const { c, st } = ctx;
    const rows = ctx.rows;
    const cnt = new Map(); let withAny = 0;
    for (const i of rows) { const ac = C.ac[i]; if (ac.length) withAny++; for (const a of ac) cnt.set(a, (cnt.get(a) || 0) + 1); }
    const items = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([a, n]) => [a, A.D.dict.action[a], n]);
    rankedBar("chActions", "actions", items, withAny, c, (a) => A.setState({ drill: { action: st.drill.action === a ? null : a } }), st.drill.action, "of incidents with an action recorded");
    document.getElementById("actionsDesc").textContent = "Share of incidents where crews recorded that action (an incident can have several). " + pct(withAny, rows.length) + " of incidents have any action recorded.";
  };

  R.locuse = function (ctx) {
    const { rows, c, st } = ctx;
    const cnt = new Map(); for (const i of rows) cnt.set(C.l[i], (cnt.get(C.l[i]) || 0) + 1);
    const items = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).map(([l, n]) => [l, A.D.dict.loc[l], n]);
    rankedBar("chLocUse", "locuse", items, rows.length, c, (l) => A.setState({ drill: { loc: st.drill.loc === l ? null : l } }), st.drill.loc);
  };

  R.largest = function (ctx) {
    const { rows } = ctx;
    const top = Array.from(rows).filter((i) => C.u[i] > 0).sort((a, b) => C.u[b] - C.u[a] || C.d[b] - C.d[a]).slice(0, 25);
    const cols = ["Units", "When", "Type", "Aid", "ZIP", "Location", "CAD #"];
    const data = top.map((i) => [C.u[i], A.dayISO(C.d[i]) + " " + A.hhmm(C.m[i]), TYPES[C.t[i]][0], A.D.dict.aid[C.a[i]], A.D.dict.zip[C.z[i]], A.D.dict.loc[C.l[i]], C.id[i]]);
    const el = document.getElementById("largestTable");
    let h = "<table class='data'><thead><tr>" + cols.map((x, j) => "<th" + (j === 0 ? " class='num'" : "") + ">" + esc(x) + "</th>").join("") + "</tr></thead><tbody>";
    data.forEach((r) => { h += "<tr>" + r.map((v, j) => "<td" + (j === 0 ? " class='num'" : "") + ">" + esc(v) + "</td>").join("") + "</tr>"; });
    el.innerHTML = h + "</tbody></table>";
  };

  R.zips = function (ctx) {
    const { rows, c, st } = ctx;
    const cnt = new Map(); for (const i of rows) cnt.set(C.z[i], (cnt.get(C.z[i]) || 0) + 1);
    const items = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([z, n]) => [z, A.D.dict.zip[z], n]);
    rankedBar("chZips", "zips", items, rows.length, c, (z) => A.setState({ drill: { zip: st.drill.zip === z ? null : z } }), st.drill.zip);
  };

  // ===================================================================== S. stations (inferred)
  const stName = (k) => "Station " + A.STATIONS[k][0];
  function stationAgg(rows) {
    const S = A.STATIONS.length;
    const day = new Array(S).fill(0), night = new Array(S).fill(0), dist = A.STATIONS.map(() => []);
    for (const i of rows) {
      const k = C.s[i]; if (k < 0) continue;
      const h = A.hour[i];
      if (h >= A.DAY_H0 && h < A.DAY_H1) day[k]++; else night[k]++;
      if (C.sd[i] !== null) dist[k].push(C.sd[i]);
    }
    return { day, night, dist };
  }
  ui.stSort = "total";
  R.stations = function (ctx) {
    const { c, st, days } = ctx;
    const rows = A.filterRows(st, { station: true });
    const nd = days.length || 1;
    const { day, night, dist } = stationAgg(rows);
    const key = ui.stSort === "day" ? day : ui.stSort === "night" ? night : day.map((v, k) => v + night[k]);
    const order = A.STATIONS.map((_, k) => k).sort((a, b) => key[b] - key[a]);
    const sel = st.station;
    const op = (k) => (sel === -9 || sel === k ? 1 : 0.3);
    const ax = A.axisBase(c);
    const ch = A.chart("chStations");
    ch.setOption(A.baseOption(c, {
      legend: { top: 0, textStyle: { color: c.ink2 }, icon: "roundRect", itemWidth: 10, itemHeight: 10, data: ["Day", "Night"] },
      grid: { left: 8, right: 48, top: 30, bottom: 4, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "value", show: false }),
      yAxis: Object.assign({}, ax, { type: "category", data: order.map((k) => stName(k) + " · " + A.STATIONS[k][3]), inverse: true, axisLine: { show: false }, axisLabel: { color: c.ink2, fontSize: 12 } }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => {
        const k = order[ps[0].dataIndex], tot = day[k] + night[k];
        const ds = dist[k].slice().sort((a, b) => a - b);
        return ttHead(stName(k) + " · " + A.STATIONS[k][4]) + ttRow(null, fmt(tot / nd, 1), "calls per day") +
          ttRow(c.day, fmt(day[k] / nd, 1), "day") + ttRow(c.nightBar, fmt(night[k] / nd, 1), "night") +
          ttRow(null, fmt(tot), "calls in range") + ttRow(null, fmt(A.quantile(ds, 0.5), 1) + " km", "median distance to station");
      } }),
      series: [
        { type: "bar", name: "Day", stack: "dn", data: order.map((k) => ({ value: +(day[k] / nd).toFixed(2), itemStyle: { opacity: op(k) } })), itemStyle: { color: c.day, borderColor: c.surface, borderWidth: 1 }, barCategoryGap: "28%" },
        { type: "bar", name: "Night", stack: "dn", data: order.map((k) => ({ value: +(night[k] / nd).toFixed(2), itemStyle: { opacity: op(k) } })), itemStyle: { color: c.nightBar, borderColor: c.surface, borderWidth: 1, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right", color: c.ink2, fontSize: 11, formatter: (p) => fmt((day[order[p.dataIndex]] + night[order[p.dataIndex]]) / nd, 1) } },
      ],
    }), true);
    ch.off("click");
    ch.on("click", (p) => { const k = order[p.dataIndex]; A.setState({ station: st.station === k ? -9 : k }); });
    A.setTable("stations", ["Station", "City", "Calls/day", "Day calls/day", "Night calls/day", "Calls", "Night %"], order.map((k) => [stName(k), A.STATIONS[k][3], (day[k] + night[k]) / nd, day[k] / nd, night[k] / nd, day[k] + night[k], day[k] + night[k] ? (100 * night[k]) / (day[k] + night[k]) : 0]));
    const unknown = rows.length - day.reduce((a, b) => a + b, 0) - night.reduce((a, b) => a + b, 0);
    document.getElementById("stationsNote").textContent = "Inferred = nearest station in a straight line; it ignores roads, move-ups, and units already out on calls. " +
      (unknown ? fmt(unknown) + " incidents without usable coordinates aren't credited to a station. " : "") + "Aid-given calls (outside PSFA) are credited to the nearest PSFA station; set Aid = None to leave them out.";
  };

  R.stationHour = function (ctx) {
    const { c, st, days } = ctx;
    const rows = A.filterRows(st, { station: true });
    const S = A.STATIONS.length, nd = days.length || 1;
    const cnt = new Float64Array(S * 24), tot = new Array(S).fill(0);
    for (const i of rows) { const k = C.s[i]; if (k < 0) continue; cnt[k * 24 + A.hour[i]]++; tot[k]++; }
    const order = A.STATIONS.map((_, k) => k).sort((a, b) => tot[b] - tot[a]);
    const data = []; let max = 0;
    order.forEach((k, r) => { for (let h = 0; h < 24; h++) { const v = cnt[k * 24 + h] / nd; max = Math.max(max, v); data.push([h, r, +v.toFixed(3)]); } });
    const ax = A.axisBase(c);
    const ch = A.chart("chStationHour");
    ch.setOption(A.baseOption(c, {
      grid: { left: 8, right: 16, top: 8, bottom: 44, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "category", data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")), splitLine: { show: false }, axisLine: { show: false }, axisLabel: { color: c.muted, interval: 2 } }),
      yAxis: Object.assign({}, ax, { type: "category", data: order.map(stName), inverse: true, axisLine: { show: false }, axisLabel: { color: c.ink2, fontSize: 11 } }),
      visualMap: { min: 0, max: max || 1, dimension: 2, orient: "horizontal", left: "center", bottom: 0, itemHeight: 160, itemWidth: 10, text: [fmt(max, 2), "0"], textStyle: { color: c.muted, fontSize: 11 }, inRange: { color: c.gseq } },
      tooltip: Object.assign(A.baseOption(c).tooltip, { formatter: (p) => ttHead(stName(order[p.value[1]]) + " · " + String(p.value[0]).padStart(2, "0") + ":00") + ttRow(null, fmt(p.value[2], 2), "calls per day in this hour") }),
      series: [{ type: "heatmap", data, itemStyle: { borderColor: c.surface, borderWidth: 1.5, borderRadius: 2 } }],
    }), true);
    ch.off("click");
    ch.on("click", (p) => { const k = order[p.value[1]]; A.setState({ station: st.station === k ? -9 : k }); });
    A.setTable("stationHour", ["Station"].concat(Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"))), order.map((k) => [stName(k)].concat(Array.from({ length: 24 }, (_, h) => cnt[k * 24 + h] / nd))));
  };

  R.stationMix = function (ctx) {
    const { c, st } = ctx;
    const rows = A.filterRows(st, { station: true });
    const S = A.STATIONS.length;
    const m = A.STATIONS.map(() => new Array(CATS.length).fill(0)), tot = new Array(S).fill(0);
    for (const i of rows) { const k = C.s[i]; if (k < 0) continue; m[k][C.c[i]]++; tot[k]++; }
    const order = A.STATIONS.map((_, k) => k).sort((a, b) => tot[b] - tot[a]);
    const ax = A.axisBase(c);
    A.chart("chStationMix").setOption(A.baseOption(c, {
      legend: { top: 0, textStyle: { color: c.ink2 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 40, bottom: 4, containLabel: true },
      xAxis: Object.assign({}, ax, { type: "value", max: 100, axisLabel: { color: c.muted, formatter: "{value}%" } }),
      yAxis: Object.assign({}, ax, { type: "category", data: order.map((k) => stName(k) + " (" + fmt(tot[k]) + ")"), inverse: true, axisLine: { show: false }, axisLabel: { color: c.ink2, fontSize: 11 } }),
      tooltip: Object.assign(A.baseOption(c).tooltip, { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => ttHead(stName(order[ps[0].dataIndex])) + ps.filter((p) => p.value > 0).map((p) => ttRow(p.color, fmt(p.value, 1) + "%", p.seriesName)).join("") }),
      series: CATS.map((name, ci) => ({ type: "bar", name, stack: "mix", barCategoryGap: "30%", data: order.map((k) => (tot[k] ? +((100 * m[k][ci]) / tot[k]).toFixed(2) : 0)), itemStyle: { color: c.cat(ci), borderColor: c.surface, borderWidth: 1 }, emphasis: { focus: "series" } })),
    }), true);
    A.setTable("stationMix", ["Station", "Calls"].concat(CATS.map((x) => x + " %")), order.map((k) => [stName(k), tot[k]].concat(CATS.map((_, ci) => (tot[k] ? (100 * m[k][ci]) / tot[k] : 0)))));
  };

  let syncControls = () => {};
  window.Charts = { R, ui, setSync: (fn) => { syncControls = fn; } };
})();
