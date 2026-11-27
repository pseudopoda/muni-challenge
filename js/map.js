/*
 * Interactive route map (MapLibre GL + OpenFreeMap vector tiles, no API key).
 * Exposes window.MuniMap with init / update / focus / resize.
 *
 * Layers, bottom to top:
 *   network – the whole of every line (js/network.js), faint, in its section's colour
 *   walks   – dashed transfers between lines (red when over the walk limit)
 *   legs    – the part of each line you actually ride
 *   legs    – (above) the part of each line you actually ride
 *   trail   – where you've been today (when the app may use your location all day)
 *   nav     – dotted walking route from your location (🚶 directions)
 *   markers – numbered boarding points, the 🍻 finish, live buses and your location
 * Tap a section in the legend to show just that part of the day.
 * saveOffline() stores the San Francisco basemap in the Cache API for use underground.
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
  let onSelect = null;        // tap a line or stop: app shows it in its card instead of a popup
  let ready = false;          // our sources/layers exist on the current style
  let fellBack = false;       // basemap unreachable: plain background instead
  let fitted = false;
  let current = null;         // last update() arguments
  let focusBlock = null;      // legend section being shown on its own
  let markers = [];
  let popup = null;
  let prefs = loadPrefs();

  // Location and walking directions.
  const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
  const MAP_CACHE = "muni-map-v1"; // shared with sw.js
  let me = null;              // { ll: [lat, lon], acc }
  let meMarker = null;
  let watchId = null;
  let follow = false;         // keep the camera on you while navigating
  let nav = null;             // { to, name, line, depMin, route: [[lat, lon]], from, at, fetching }
  let banner = null;
  let onPositionCb = null;    // app hook: every location fix
  let keepWatching = false;   // app asked for location all day (ride detection, trail)
  let wakeLock = null;        // screen stays on during walking directions
  let vehicleMarkers = [];
  let trail = [];

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
    onSelect = opts.onSelect || null;
    onPositionCb = opts.onPosition || null;
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
    map.addControl(new LocateControl(), "top-right");
    banner = document.createElement("div");
    banner.className = "nav-banner";
    banner.hidden = true;
    el.parentElement.append(banner);
    map.on("dragstart", () => { if (nav && follow) { follow = false; renderBanner(); } });

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
      if (f) pick(f.properties.id, e.lngLat);
    });
    map.on("click", "hit-network", (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ["hit"] }).length) return; // the ridden part wins
      const f = e.features[0];
      if (f && prefs.network) pick(f.properties.id, e.lngLat);
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
      div.firstChild.addEventListener("click", () => {
        if (nav && follow) { follow = false; renderBanner(); }
        setFocusBlock(null);
        fitAll(true);
      });
      return div;
    }
    onRemove() {}
  }

  class LocateControl {
    onAdd() {
      const div = document.createElement("div");
      div.className = "maplibregl-ctrl maplibregl-ctrl-group";
      div.innerHTML = '<button type="button" class="locate-btn" title="Show my location" aria-label="Show my location">◎</button>';
      div.firstChild.addEventListener("click", () => {
        startWatching();
        if (me) map.easeTo({ center: lngLat(me.ll), zoom: Math.max(map.getZoom(), 15.5) });
        else pendingCenter = true;
      });
      return div;
    }
    onRemove() {}
  }
  let pendingCenter = false;

  // Zoom must be the outermost expression, so the next-leg choice goes inside each stop.
  const LINE_WIDTH = (base, nextBase) => {
    const at = (k) => (nextBase ? ["case", ["get", "next"], nextBase * k, base * k] : base * k);
    return ["interpolate", ["linear"], ["zoom"], 10, at(0.55), 14, at(1), 17, at(1.7)];
  };

  function addLayers() {
    if (map.getSource("legs")) { ready = true; return; }
    const empty = { type: "FeatureCollection", features: [] };
    ["network", "walks", "legs", "trail"].forEach((id) => map.addSource(id, { type: "geojson", data: empty }));

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
      id: "trail", type: "line", source: "trail",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#1a73e8", "line-width": LINE_WIDTH(3), "line-opacity": 0.45 },
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

    // Walking directions: Google-Maps-style blue dots.
    map.addSource("nav", { type: "geojson", data: empty });
    map.addLayer({
      id: "nav-casing", type: "line", source: "nav",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": LINE_WIDTH(9), "line-dasharray": [0, 1.6] },
    });
    map.addLayer({
      id: "nav", type: "line", source: "nav",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#1a73e8", "line-width": LINE_WIDTH(6), "line-dasharray": [0, 2.1] },
    });
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
        const path = (it.walkIn && it.walkIn.path) || [prev.b, it.a];
        walks.push({ type: "Feature", properties: { long: !!it.longWalk, dim }, geometry: { type: "LineString", coordinates: path.map(lngLat) } });
      }
    });

    if (finish) {
      const last = [...items].reverse().find((l) => !String(l.block).startsWith("owl"));
      if (last && !last.leg.manual) {
        const path = finish.path || [last.b, finish.at];
        walks.push({ type: "Feature", properties: { long: false, dim: dimmed(last.block) }, geometry: { type: "LineString", coordinates: path.map(lngLat) } });
      }
    }

    const fc = (features) => ({ type: "FeatureCollection", features });
    map.getSource("legs").setData(fc(legs));
    map.getSource("walks").setData(fc(walks));
    map.getSource("network").setData(fc(network));
    drawTrail();
    drawNav();
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
      node.addEventListener("click", (e) => { e.stopPropagation(); pick(it.id, lngLat(it.a)); });
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
      '<div class="pop-btns"><button type="button" class="link-btn" data-toggle="' + esc(it.id) + '">' + (it.done ? "Unmark" : "Mark ridden ✓") + "</button>" +
      (leg.board && leg.board.ll ? '<button type="button" class="link-btn" data-walk="1">🚶 Walk here</button>' : "") + "</div>" +
      "</div>"
    );
  }

  function pick(id, at) {
    if (onSelect) onSelect(id);
    else openPopup(id, at);
  }

  function openPopup(id, at) {
    const it = current && current.items.find((i) => i.id === id);
    if (!it) return;
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: "280px", offset: 10 }).setLngLat(at).setHTML(popupHtml(it)).addTo(map);
    const btn = popup.getElement().querySelector("[data-toggle]");
    if (btn) btn.addEventListener("click", () => { popup.remove(); onToggle(id); });
    const walk = popup.getElement().querySelector("[data-walk]");
    if (walk) walk.addEventListener("click", () => navigate({ to: it.leg.board.ll, name: it.leg.board.name, line: it.leg.line, depMin: it.leg.dep_min }));
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
    const card = document.getElementById("mapCard");
    const w = legend ? legend.offsetWidth : 0, h = legend ? legend.offsetHeight : 0;
    const bottom = Math.min(card && !card.hidden ? card.offsetHeight + 50 : 30, el.clientHeight / 2);
    if (el.clientWidth - w > 360) return { top: 30, left: w + 30, right: 50, bottom };
    return { top: Math.min(h + 20, el.clientHeight / 3), left: 20, right: 50, bottom };
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
    if (nav && follow) { follow = false; renderBanner(); } // stop snapping back to you
    if (popup) popup.remove();
    fitTo([it], true);
    if (onSelect) return; // the app's card shows the details
    const path = it.path || [it.a, it.b];
    openPopup(id, lngLat(path[Math.floor(path.length / 2)]));
  }

  function resize() {
    if (!map) return;
    map.resize();
    fitIfNeeded();
  }

  // ---- Your location & walking directions ------------------------------------

  const metersBetween = (a, b) => {
    const lat = ((a[0] + b[0]) / 2) * Math.PI / 180;
    return Math.hypot((b[1] - a[1]) * 111320 * Math.cos(lat), (b[0] - a[0]) * 110540);
  };

  function clockMin(m) {
    m = Math.round(m) % 1440;
    const h = Math.floor(m / 60);
    return ((h % 12) || 12) + ":" + String(m % 60).padStart(2, "0") + " " + (h < 12 ? "AM" : "PM");
  }

  // Clock minutes, moved onto the plan's frame for `ref` (Owl times run past 1440).
  function nowMin(ref) {
    const d = new Date();
    const m = d.getHours() * 60 + d.getMinutes();
    return ref == null ? m : m + 1440 * Math.round((ref - m) / 1440);
  }

  function startWatching() {
    if (watchId != null) return;
    if (!navigator.geolocation) { if (nav) { nav.error = "Location isn’t available on this device."; renderBanner(); } return; }
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }

  function onPosition(pos) {
    me = { ll: [pos.coords.latitude, pos.coords.longitude], acc: pos.coords.accuracy, at: Date.now() };
    if (!meMarker) {
      const dot = document.createElement("div");
      dot.className = "me-dot";
      dot.title = "You are here";
      meMarker = new maplibregl.Marker({ element: dot }).setLngLat(lngLat(me.ll)).addTo(map);
    } else {
      meMarker.setLngLat(lngLat(me.ll));
    }
    if (pendingCenter) {
      pendingCenter = false;
      map.easeTo({ center: lngLat(me.ll), zoom: Math.max(map.getZoom(), 15.5) });
    }
    if (nav) updateNav();
    if (onPositionCb) onPositionCb({ ll: me.ll, acc: me.acc, at: me.at });
  }

  function onPositionError(err) {
    const msg = err && err.code === 1 ? "Location permission is off — allow it for this site to get directions." : "Can’t find your location right now.";
    if (nav) { nav.error = msg; renderBanner(); }
    else showToast(msg);
  }

  function showToast(text) {
    banner.innerHTML = '<div class="nav-main">' + esc(text) + '</div><div class="nav-btns"><button type="button" data-act="end">OK</button></div>';
    banner.querySelector("[data-act=end]").addEventListener("click", () => { banner.hidden = true; });
    banner.hidden = false;
  }

  /** Start walking directions to a stop: { to: [lat, lon], name, line, depMin }. */
  function navigate(opts) {
    if (!map) return;
    nav = { ...opts, route: null, from: null, at: 0, fetching: false, failedAt: 0, error: null };
    follow = true;
    if (popup) popup.remove();
    startWatching();
    keepAwake(true);
    renderBanner();
    if (me) updateNav();
    else map.easeTo({ center: lngLat(opts.to), zoom: 16 });
    drawNav();
  }

  function endNav() {
    nav = null;
    follow = false;
    banner.hidden = true;
    keepAwake(false);
    drawNav();
    if (!keepWatching) stopWatching();
  }

  function stopWatching() {
    if (watchId == null) return;
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  /** Keep the screen on while walking directions are up (where the browser allows it). */
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && "wakeLock" in navigator && !document.hidden) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { /* not supported or not allowed right now */ }
  }
  // The lock drops when the page is hidden; take it again on return.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && nav) keepAwake(true); });

  /** The app may use your location all day (ride detection, trail). */
  function watch(on) {
    keepWatching = on;
    if (on) startWatching();
    else if (!nav) stopWatching();
  }

  /** Live buses: [{ ll: [lat, lon], label, color, title }]. */
  function setVehicles(list) {
    vehicleMarkers.forEach((m) => m.remove());
    vehicleMarkers = [];
    if (!map) return;
    for (const v of list) {
      const node = document.createElement("div");
      node.className = "bus-dot";
      node.style.setProperty("--c", v.color);
      node.textContent = v.label;
      node.title = v.title;
      vehicleMarkers.push(new maplibregl.Marker({ element: node }).setLngLat(lngLat(v.ll)).addTo(map));
    }
  }

  /** Where you've been: [[lat, lon]] (breaks of > 1 km start a new line). */
  function setTrail(points) {
    trail = points || [];
    drawTrail();
  }

  function drawTrail() {
    if (!map || !map.getSource("trail")) return;
    const lines = [];
    let cur = [];
    trail.forEach((p, i) => {
      if (i && metersBetween(trail[i - 1], p) > 1000) { if (cur.length > 1) lines.push(cur); cur = []; }
      cur.push(lngLat(p));
    });
    if (cur.length > 1) lines.push(cur);
    map.getSource("trail").setData({ type: "FeatureCollection", features: lines.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } })) });
  }

  function updateNav() {
    if (!nav || !me) return;
    const off = nav.route ? distanceToPath(me.ll, nav.route) : Infinity;
    const moved = nav.from ? metersBetween(nav.from, me.ll) : Infinity;
    const stale = Date.now() - nav.at > 60000 && moved > 30;
    const backoff = Date.now() - nav.failedAt < 30000;
    if (!nav.fetching && !backoff && (off > 40 || stale)) fetchRoute();
    if (follow) map.easeTo({ center: lngLat(me.ll), zoom: Math.max(map.getZoom(), 16.5), duration: 600 });
    drawNav();
    renderBanner();
  }

  async function fetchRoute() {
    const target = nav;
    target.fetching = true;
    const from = me.ll.slice();
    const url = ROUTER + from[1] + "," + from[0] + ";" + target.to[1] + "," + target.to[0] + "?overview=full&geometries=geojson";
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j.code !== "Ok" || !j.routes.length) throw new Error(j.code || "no route");
      target.route = j.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      target.from = from;
      target.at = Date.now();
      target.error = null;
    } catch (e) {
      target.failedAt = Date.now();
      target.error = "offline";
    } finally {
      target.fetching = false;
      if (nav === target) { drawNav(); renderBanner(); }
    }
  }

  // Local planar metres, good enough over a few kilometres.
  function toXY(p, lat0) {
    return [p[1] * 111320 * Math.cos(lat0 * Math.PI / 180), p[0] * 110540];
  }

  function nearestOnPath(p, path) {
    const lat0 = p[0], P = toXY(p, lat0);
    let best = { d: Infinity, k: 0 };
    for (let k = 1; k < path.length; k++) {
      const A = toXY(path[k - 1], lat0), B = toXY(path[k], lat0);
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dy));
      if (d < best.d) best = { d, k };
    }
    return best;
  }

  const distanceToPath = (p, path) => (path.length > 1 ? nearestOnPath(p, path).d : Infinity);

  /** What's left of the walk from where you are: [[lat, lon]] starting at you. */
  function remainingRoute() {
    if (!nav || !me) return [];
    if (!nav.route) return [me.ll, nav.to];
    const { k } = nearestOnPath(me.ll, nav.route);
    return [me.ll].concat(nav.route.slice(k));
  }

  function routeLength(path) {
    let m = 0;
    for (let i = 1; i < path.length; i++) m += metersBetween(path[i - 1], path[i]);
    return m;
  }

  function drawNav() {
    if (!map || !map.getSource("nav")) return;
    const coords = remainingRoute();
    map.getSource("nav").setData({
      type: "FeatureCollection",
      features: coords.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords.map(lngLat) } }] : [],
    });
  }

  function renderBanner() {
    if (!nav) { banner.hidden = true; return; }
    let main, sub = "to " + esc(nav.name) + (nav.line ? " for the " + esc(nav.line) : "");
    if (nav.error && nav.error !== "offline") {
      main = esc(nav.error);
    } else if (!me) {
      main = "Finding your location…";
    } else if (metersBetween(me.ll, nav.to) < 30) {
      main = "You’re at the stop ✓";
    } else {
      const left = nav.route ? routeLength(remainingRoute()) : metersBetween(me.ll, nav.to) * 1.25;
      const mins = Math.max(1, Math.round(left / 75));
      main = (left < 950 ? Math.round(left / 10) * 10 + " m" : (left / 1609.34).toFixed(1) + " mi") + " · " + mins + " min walk";
      if (nav.depMin != null) {
        const spare = nav.depMin - (nowMin(nav.depMin) + mins);
        if (Math.abs(spare) < 240) sub += " · " + (spare >= 0 ? "due " + clockMin(nav.depMin) + " (" + Math.round(spare) + " min spare)" : "planned " + clockMin(nav.depMin) + " — you’ll miss it");
      }
      if (nav.error === "offline") sub += " · offline: straight line";
    }
    banner.innerHTML =
      '<div class="nav-main">🚶 ' + main + '</div><div class="nav-sub">' + sub + "</div>" +
      '<div class="nav-btns">' + (follow ? "" : '<button type="button" data-act="recenter">Recenter</button>') +
      '<button type="button" data-act="end">End</button></div>';
    const rc = banner.querySelector("[data-act=recenter]");
    if (rc) rc.addEventListener("click", () => { follow = true; if (me) map.easeTo({ center: lngLat(me.ll), zoom: 16.5 }); renderBanner(); });
    banner.querySelector("[data-act=end]").addEventListener("click", endNav);
    banner.hidden = false;
  }

  // ---- Offline basemap ----------------------------------------------------------

  const SF = { s: 37.70, n: 37.835, w: -122.52, e: -122.355 }; // incl. Treasure Island

  function tileXY(lon, lat, z) {
    const n = 2 ** z, r = lat * Math.PI / 180;
    return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
  }

  /** Store the light + dark styles, sprites, label fonts and SF tiles (z10–14) in the cache sw.js reads. */
  async function saveOffline(progress) {
    if (!("caches" in window)) throw new Error("this browser can’t store files offline");
    const cache = await caches.open(MAP_CACHE);
    const grab = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status + " for " + url.split("/").slice(-2).join("/"));
      await cache.put(url, r.clone());
      return r;
    };
    const urls = new Set();
    let tiles = null, maxzoom = 14;
    for (const name of ["liberty", "dark"]) {
      const style = await (await grab("https://tiles.openfreemap.org/styles/" + name)).json();
      for (const src of Object.values(style.sources || {})) {
        if (src.url && !tiles) {
          const tj = await (await grab(src.url)).json();
          tiles = tj.tiles[0];
          maxzoom = Math.min(14, tj.maxzoom || 14);
        }
      }
      if (typeof style.sprite === "string") [".json", ".png", "@2x.json", "@2x.png"].forEach((s) => urls.add(style.sprite + s));
      const fonts = new Set();
      (style.layers || []).forEach((l) => {
        const f = l.layout && l.layout["text-font"];
        if (Array.isArray(f) && f.every((x) => typeof x === "string")) fonts.add(f.join(","));
      });
      if (style.glyphs) fonts.forEach((f) => urls.add(style.glyphs.replace("{fontstack}", encodeURIComponent(f)).replace("{range}", "0-255")));
    }
    if (!tiles) throw new Error("no tile source in the map style");
    for (let z = 10; z <= maxzoom; z++) {
      const [x0, y0] = tileXY(SF.w, SF.n, z), [x1, y1] = tileXY(SF.e, SF.s, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.add(tiles.replace("{z}", z).replace("{x}", x).replace("{y}", y));
    }
    const list = [...urls], total = list.length;
    let done = 0, saved = 0;
    const worker = async () => {
      while (list.length) {
        const url = list.pop();
        try {
          if (!(await cache.match(url))) await grab(url);
          saved++;
        } catch (e) { /* skip one missing file */ }
        progress(++done, total);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (saved < total * 0.8) throw new Error("only " + saved + " of " + total + " files saved");
    return saved;
  }

  /** Your position if known within the last `maxMin` minutes; otherwise ask once (null if unavailable). */
  async function getLocation(maxMin) {
    if (me && Date.now() - me.at < maxMin * 60000) return me.ll;
    if (!navigator.geolocation) return null;
    try {
      const pos = await new Promise((ok, fail) =>
        navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 8000, maximumAge: maxMin * 60000 }));
      if (map) onPosition(pos);
      return [pos.coords.latitude, pos.coords.longitude];
    } catch (e) {
      return null;
    }
  }

  const navigating = () => !!nav;

  window.MuniMap = { init, update, focus, resize, navigate, saveOffline, getLocation, watch, setVehicles, setTrail, navigating };
})();
