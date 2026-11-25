/*
 * Interactive route map (MapLibre GL + OpenFreeMap vector tiles, no API key).
 * Exposes window.MuniMap with init / update / focus / resize.
 *
 * Layers, bottom to top:
 *   network – the whole of every line (js/network.js), faint, in its section's colour
 *   walks   – dashed transfers between lines (red when over the walk limit)
 *   legs    – the part of each line you actually ride
 *   markers – numbered boarding points and the 🍻 finish
 * Tap a section in the legend to show just that part of the day.
 */
(function () {
  "use strict";

  const DONE_COLOR = "#9a9a9a";
  const DIM_COLOR = "#9aa0a6";
  const NETWORK = window.MUNI_NETWORK || {};
  const PREFS_KEY = "muni-challenge:map";
  const DARK = window.matchMedia("(prefers-color-scheme: dark)");

  let map = null;
  let el = null;
  let onToggle = () => {};
  let ready = false;          // our sources/layers exist on the current style
  let fellBack = false;       // basemap unreachable: plain background instead
  let fitted = false;
  let current = null;         // last update() arguments
  let focusBlock = null;      // legend section being shown on its own
  let markers = [];
  let popup = null;
  let prefs = loadPrefs();

  function loadPrefs() {
    try { return Object.assign({ network: true }, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")); }
    catch (e) { return { network: true }; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* not persisted */ }
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lngLat = (p) => [p[1], p[0]];

  function styleUrl() {
    return "https://tiles.openfreemap.org/styles/" + (DARK.matches ? "dark" : "liberty");
  }
  function plainStyle() {
    return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": DARK.matches ? "#15181b" : "#dfe6ea" } }] };
  }

  // ---- Setup ---------------------------------------------------------------

  function init(container, opts) {
    el = container;
    if (!window.maplibregl) {
      el.innerHTML = '<p class="map-error">Map couldn’t load (offline?). The list still works.</p>';
      return false;
    }
    onToggle = opts.onToggle;
    map = new maplibregl.Map({
      container: el,
      style: styleUrl(),
      center: [-122.4413, 37.768],
      zoom: 11.5,
      minZoom: 9.5,
      maxZoom: 18,
      pitchWithRotate: false,
      dragRotate: false,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new FitControl(), "top-right");

    // Treat the basemap as unreachable only after repeated errors and no successful load.
    let loaded = false, errors = 0;
    const fallback = () => {
      if (loaded || fellBack) return;
      fellBack = true;
      el.parentElement.classList.add("no-tiles");
      map.setStyle(plainStyle(), { diff: false });
    };
    map.on("load", () => { loaded = true; });
    map.on("error", (e) => {
      console.warn("Map:", e.error && e.error.message);
      if (++errors >= 4) fallback();
    });
    setTimeout(fallback, 15000);

    // Our layers have to be re-added whenever the style (re)loads, e.g. on a theme change.
    map.on("style.load", () => { ready = false; addLayers(); draw(); });
    // diff:false makes the new style load from scratch, so "style.load" fires and our layers come back.
    DARK.addEventListener("change", () => map.setStyle(fellBack ? plainStyle() : styleUrl(), { diff: false }));

    // Tap the ridden part of a line, or (when shown) anywhere on the whole line.
    map.on("click", "hit", (e) => {
      const f = e.features[0];
      if (f) openPopup(f.properties.id, e.lngLat);
    });
    map.on("click", "hit-network", (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ["hit"] }).length) return; // the ridden part wins
      const f = e.features[0];
      if (f && prefs.network) openPopup(f.properties.id, e.lngLat);
    });
    ["hit", "hit-network"].forEach((layer) => {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    });
    return true;
  }

  class FitControl {
    onAdd() {
      const div = document.createElement("div");
      div.className = "maplibregl-ctrl maplibregl-ctrl-group";
      div.innerHTML = '<button type="button" class="fit-btn" title="Show the whole day" aria-label="Show the whole day">⤢</button>';
      div.firstChild.addEventListener("click", () => { setFocusBlock(null); fitAll(true); });
      return div;
    }
    onRemove() {}
  }

  // Zoom must be the outermost expression, so the next-leg choice goes inside each stop.
  const LINE_WIDTH = (base, nextBase) => {
    const at = (k) => (nextBase ? ["case", ["get", "next"], nextBase * k, base * k] : base * k);
    return ["interpolate", ["linear"], ["zoom"], 10, at(0.55), 14, at(1), 17, at(1.7)];
  };

  function addLayers() {
    if (map.getSource("legs")) { ready = true; return; }
    const empty = { type: "FeatureCollection", features: [] };
    ["network", "walks", "legs"].forEach((id) => map.addSource(id, { type: "geojson", data: empty }));

    map.addLayer({
      id: "network", type: "line", source: "network",
      layout: { "line-cap": "round", "line-join": "round", visibility: prefs.network ? "visible" : "none" },
      paint: {
        "line-color": ["case", ["get", "dim"], DIM_COLOR, ["get", "color"]],
        "line-width": LINE_WIDTH(2.6),
        "line-opacity": ["case", ["get", "dim"], 0.12, 0.38],
      },
    });
    map.addLayer({
      id: "walks", type: "line", source: "walks",
      layout: { "line-cap": "round" },
      paint: {
        "line-color": ["case", ["get", "long"], "#c62828", DARK.matches ? "#ddd" : "#444"],
        "line-width": ["case", ["get", "long"], 3, 2],
        "line-dasharray": [2, 2],
        "line-opacity": ["case", ["get", "dim"], 0.2, 0.85],
      },
    });
    map.addLayer({
      id: "legs-casing", type: "line", source: "legs",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": LINE_WIDTH(8, 12),
        "line-opacity": ["case", ["get", "dim"], 0, 0.9],
      },
    });
    map.addLayer({
      id: "legs", type: "line", source: "legs",
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["case", ["get", "next"], 2, ["get", "done"], 0, 1] },
      paint: {
        "line-color": ["case", ["get", "dim"], DIM_COLOR, ["get", "done"], DONE_COLOR, ["get", "color"]],
        "line-width": LINE_WIDTH(5, 7),
        "line-opacity": ["case", ["get", "dim"], 0.3, ["get", "done"], 0.65, 0.95],
      },
    });
    // Wide invisible line so thin routes are easy to tap; whole lines are tappable too.
    map.addLayer({ id: "hit", type: "line", source: "legs", paint: { "line-color": "#000", "line-width": 20, "line-opacity": 0 } });
    map.addLayer({ id: "hit-network", type: "line", source: "network", paint: { "line-color": "#000", "line-width": 14, "line-opacity": 0 } }, "walks");
    ready = true;
  }

  // ---- Drawing -------------------------------------------------------------

  /**
   * items: [{ leg, id, block, color, done, n, a, b, path, walk, longWalk }] in itinerary order.
   * blocks: [{ id, color, time, title, legs }] for the legend.
   */
  function update(items, nextId, finish, blocks) {
    current = { items, nextId, finish, blocks: blocks || [] };
    if (focusBlock && !current.blocks.some((b) => b.id === focusBlock)) focusBlock = null;
    renderLegend();
    if (map) draw();
  }

  function dimmed(block) {
    return focusBlock != null && block !== focusBlock;
  }

  function draw() {
    // While a new style is loading our sources are gone; "style.load" redraws.
    if (!current || !map || !ready || !map.getSource("legs")) return;
    const { items, nextId, finish } = current;
    const legs = [], walks = [], network = [];

    items.forEach((it, i) => {
      if (!it.a || !it.b) return;
      const dim = dimmed(it.block);
      const props = { id: it.id, color: it.color, done: it.done, next: it.id === nextId, dim };
      legs.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: (it.path || [it.a, it.b]).map(lngLat) } });

      (NETWORK[it.leg.line] || []).forEach((shape) => {
        network.push({ type: "Feature", properties: { id: it.id, color: it.color, dim }, geometry: { type: "LineString", coordinates: shape.map(lngLat) } });
      });

      const prev = items[i - 1];
      if (prev && it.walk != null && it.walk > 25) {
        walks.push({ type: "Feature", properties: { long: !!it.longWalk, dim }, geometry: { type: "LineString", coordinates: [lngLat(prev.b), lngLat(it.a)] } });
      }
    });

    if (finish) {
      const last = [...items].reverse().find((l) => l.block !== "owl");
      if (last && !last.leg.manual) {
        walks.push({ type: "Feature", properties: { long: false, dim: dimmed(last.block) }, geometry: { type: "LineString", coordinates: [lngLat(last.b), lngLat(finish.at)] } });
      }
    }

    const fc = (features) => ({ type: "FeatureCollection", features });
    map.getSource("legs").setData(fc(legs));
    map.getSource("walks").setData(fc(walks));
    map.getSource("network").setData(fc(network));
    drawMarkers();
    fitIfNeeded();
  }

  function drawMarkers() {
    markers.forEach((m) => m.remove());
    markers = [];
    const { items, nextId, finish } = current;
    items.forEach((it) => {
      if (!it.a) return;
      const state = it.id === nextId ? "next" : it.done ? "done" : "";
      const node = document.createElement("button");
      node.type = "button";
      node.className = "stop-num " + state + (dimmed(it.block) ? " dim" : "");
      node.style.setProperty("--c", it.done ? DONE_COLOR : it.color);
      node.textContent = it.n;
      node.title = it.n + ". " + it.leg.line;
      node.setAttribute("aria-label", "Leg " + it.n + ": " + it.leg.line);
      node.addEventListener("click", (e) => { e.stopPropagation(); openPopup(it.id, lngLat(it.a)); });
      markers.push(new maplibregl.Marker({ element: node }).setLngLat(lngLat(it.a)).addTo(map));
    });
    if (finish) {
      const node = document.createElement("div");
      node.className = "finish-icon";
      node.textContent = "🍻";
      node.title = finish.name;
      const pop = new maplibregl.Popup({ offset: 16 }).setHTML("<div class=\"pop\"><strong>Finish</strong>" + esc(finish.name) + "</div>");
      markers.push(new maplibregl.Marker({ element: node }).setLngLat(lngLat(finish.at)).setPopup(pop).addTo(map));
    }
  }

  // ---- Popups --------------------------------------------------------------

  function stopHtml(stop) {
    if (!stop.code) return esc(stop.name);
    return esc(stop.name) + ' <a href="https://www.sfmta.com/' + encodeURIComponent(stop.code) + '" target="_blank" rel="noopener">#' + esc(stop.code) + " live ↗</a>";
  }

  function popupHtml(it) {
    const leg = it.leg;
    const block = current.blocks.find((b) => b.id === it.block);
    return (
      '<div class="pop" style="--block:' + it.color + '">' +
      "<strong>" + it.n + ". " + esc(leg.line) + "</strong>" +
      (leg.risk ? ' <span class="tag risk">⚠ Infrequent</span>' : "") +
      (block ? '<div class="pop-block">' + esc(block.time + " · " + block.title) + "</div>" : "") +
      (leg.depart ? "<div><b>" + esc(leg.depart) + " → " + esc(leg.arrive) + "</b></div>" : "") +
      "<div><b>Board:</b> " + stopHtml(leg.board) + "</div>" +
      "<div><b>Alight:</b> " + stopHtml(leg.alight) + "</div>" +
      '<button type="button" class="link-btn" data-toggle="' + esc(it.id) + '">' + (it.done ? "Unmark" : "Mark ridden ✓") + "</button>" +
      "</div>"
    );
  }

  function openPopup(id, at) {
    const it = current && current.items.find((i) => i.id === id);
    if (!it) return;
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: "280px", offset: 10 }).setLngLat(at).setHTML(popupHtml(it)).addTo(map);
    const btn = popup.getElement().querySelector("[data-toggle]");
    if (btn) btn.addEventListener("click", () => { popup.remove(); onToggle(id); });
  }

  // ---- Legend (tap a section to show just that part of the day) ------------

  function renderLegend() {
    const box = document.getElementById("mapLegend");
    if (!box || !current) return;
    const done = (b) => current.items.filter((i) => i.block === b.id && i.done).length;
    const count = (b) => current.items.filter((i) => i.block === b.id).length;
    // Start collapsed on phones so the map isn't covered.
    if (!box.dataset.closed) box.dataset.closed = window.matchMedia("(max-width: 600px)").matches ? "1" : "0";
    box.innerHTML =
      '<details class="legend-panel"' + (box.dataset.closed === "1" ? "" : " open") + ">" +
      "<summary>Sections of the day" + (focusBlock ? ' <span class="legend-showing">· 1 shown</span>' : "") + "</summary>" +
      '<ul class="legend-list">' +
      current.blocks.map((b) =>
        '<li><button type="button" class="legend-row' + (focusBlock === b.id ? " on" : "") + (dimmed(b.id) ? " off" : "") + '" data-block="' + esc(b.id) + '" aria-pressed="' + (focusBlock === b.id) + '">' +
        '<span class="swatch" style="background:' + b.color + '"></span>' +
        '<span class="legend-name"><b>' + esc(b.time) + "</b> " + esc(b.title) + "</span>" +
        '<span class="legend-count">' + done(b) + "/" + count(b) + "</span></button></li>"
      ).join("") +
      "</ul>" +
      '<div class="legend-key">' +
      '<label><input type="checkbox" id="netToggle"' + (prefs.network ? " checked" : "") + "> Whole lines</label>" +
      '<span><span class="swatch walk"></span>walk</span>' +
      '<span><span class="swatch" style="background:' + DONE_COLOR + '"></span>ridden</span>' +
      "</div></details>";

    const details = box.querySelector("details");
    details.addEventListener("toggle", () => { box.dataset.closed = details.open ? "0" : "1"; });
    box.querySelectorAll("[data-block]").forEach((btn) => {
      btn.addEventListener("click", () => setFocusBlock(focusBlock === btn.dataset.block ? null : btn.dataset.block, true));
    });
    box.querySelector("#netToggle").addEventListener("change", (e) => {
      prefs.network = e.target.checked;
      savePrefs();
      if (map && ready) map.setLayoutProperty("network", "visibility", prefs.network ? "visible" : "none");
    });
  }

  function setFocusBlock(id, zoom) {
    focusBlock = id;
    renderLegend();
    draw();
    if (!zoom || !map) return;
    if (id) fitTo(current.items.filter((i) => i.block === id), true);
    else fitAll(true);
  }

  // ---- Camera --------------------------------------------------------------

  function boundsOf(items, withFinish) {
    const b = new maplibregl.LngLatBounds();
    items.forEach((it) => (it.path || [it.a, it.b]).forEach((p) => p && b.extend(lngLat(p))));
    if (withFinish && current.finish) b.extend(lngLat(current.finish.at));
    return b.isEmpty() ? null : b;
  }

  // Keep the route clear of the legend: beside it on wide maps, above it on narrow ones.
  function padding() {
    const legend = document.getElementById("mapLegend");
    const w = legend ? legend.offsetWidth : 0, h = legend ? legend.offsetHeight : 0;
    if (el.clientWidth - w > 360) return { top: 30, left: w + 30, right: 50, bottom: 30 };
    return { top: 30, left: 20, right: 50, bottom: Math.min(h + 20, el.clientHeight / 2) };
  }

  function fitTo(items, animate) {
    const b = boundsOf(items, false);
    if (b) map.fitBounds(b, { padding: padding(), maxZoom: 15.5, duration: animate ? 500 : 0 });
  }

  function fitAll(animate) {
    if (!current) return;
    const b = boundsOf(current.items, true);
    if (b) map.fitBounds(b, { padding: padding(), duration: animate ? 500 : 0 });
  }

  // The map starts hidden on phones, so wait until it has a real size before fitting.
  function fitIfNeeded() {
    if (fitted || !current || !current.items.length || !el.clientWidth) return;
    fitAll(false);
    fitted = true;
  }

  function focus(id) {
    const it = current && current.items.find((i) => i.id === id);
    if (!map || !it || !it.a) return;
    if (focusBlock && focusBlock !== it.block) setFocusBlock(null);
    fitTo([it], true);
    const path = it.path || [it.a, it.b];
    openPopup(id, lngLat(path[Math.floor(path.length / 2)]));
  }

  function resize() {
    if (!map) return;
    map.resize();
    fitIfNeeded();
  }

  window.MuniMap = { init, update, focus, resize };
})();
