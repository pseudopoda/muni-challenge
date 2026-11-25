/*
 * Interactive route map (Leaflet + OpenStreetMap tiles).
 * Exposes window.MuniMap with init / update / focus / resize.
 */
(function () {
  "use strict";

  const DONE_COLOR = "#9a9a9a";
  let map = null;
  let layer = null;
  let byId = {}; // leg id -> { line, popup bounds }
  let onToggle = () => {};
  let fitted = false;
  let routeBounds = null;

  // Fit to the whole route once the map is actually visible (it starts hidden on phones).
  function fitIfNeeded() {
    if (fitted || !routeBounds || map.getSize().x === 0) return;
    map.fitBounds(routeBounds, { padding: [20, 20] });
    fitted = true;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function numberIcon(n, color, state) {
    return L.divIcon({
      className: "stop-num " + state,
      html: '<span style="--c:' + color + '">' + n + "</span>",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  function init(el, opts) {
    if (!window.L) {
      el.innerHTML = '<p class="map-error">Map couldn’t load (offline?). The list still works.</p>';
      return false;
    }
    onToggle = opts.onToggle;
    map = L.map(el, { zoomControl: true, scrollWheelZoom: true }).setView([37.76, -122.44], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);

    // Popup "mark ridden" buttons.
    map.on("popupopen", (e) => {
      const btn = e.popup.getElement().querySelector("[data-toggle]");
      if (btn) btn.addEventListener("click", () => { onToggle(btn.dataset.toggle); map.closePopup(); });
    });
    return true;
  }

  function stopHtml(stop, fallback) {
    if (!stop) return esc(fallback);
    return esc(stop.name) + ' <a href="https://www.sfmta.com/' + encodeURIComponent(stop.code) + '" target="_blank" rel="noopener">#' + esc(stop.code) + " live ↗</a>";
  }

  function popupHtml(leg, g, id, n, done) {
    return (
      '<div class="pop">' +
      "<strong>" + n + ". " + esc(leg.line) + "</strong>" +
      (leg.risk ? ' <span class="tag risk">⚠ Infrequent</span>' : "") +
      "<div><b>Board:</b> " + stopHtml(g && g.board, leg.board) + "</div>" +
      "<div><b>Alight:</b> " + stopHtml(g && g.alight, leg.alight) + "</div>" +
      "<div><b>Then:</b> " + esc(leg.next) + "</div>" +
      '<button type="button" class="link-btn" data-toggle="' + id + '">' + (done ? "Unmark" : "Mark ridden ✓") + "</button>" +
      "</div>"
    );
  }

  /**
   * legs: [{ leg, id, color, done, n }] in itinerary order; nextId: id of the next leg to ride.
   */
  function update(legs, nextId, finish) {
    if (!map) return;
    layer.clearLayers();
    byId = {};
    const all = [];

    legs.forEach((item, i) => {
      const { leg, g, a, b, id, color, done, n } = item;
      if (!a || !b) return;
      const isNext = id === nextId;
      const c = done ? DONE_COLOR : color;
      const path = g ? g.path : [a, b];

      // Walking transfer from the previous leg's alight point (red if it breaks the 5-block rule).
      const prev = legs[i - 1];
      if (prev && prev.b && map.distance(prev.b, a) > 25) {
        L.polyline([prev.b, a], { color: item.longWalk ? "#c62828" : "#555", weight: item.longWalk ? 3 : 2, dashArray: "6 6", opacity: 0.8, interactive: false }).addTo(layer);
      }

      if (isNext) L.polyline(path, { color: "#fff", weight: 11, opacity: 0.9, interactive: false }).addTo(layer);
      const line = L.polyline(path, { color: c, weight: isNext ? 7 : 5, opacity: done ? 0.6 : 0.95 })
        .bindPopup(popupHtml(leg, g, id, n, done))
        .addTo(layer);
      L.circleMarker(b, { radius: 4, color: "#fff", weight: 1.5, fillColor: c, fillOpacity: 1, interactive: false }).addTo(layer);
      L.marker(a, { icon: numberIcon(n, c, isNext ? "next" : done ? "done" : ""), zIndexOffset: isNext ? 1000 : done ? -100 : 0, title: n + ". " + leg.line })
        .on("click", () => line.openPopup(a))
        .addTo(layer);

      byId[id] = line;
      all.push(...path);
    });

    if (finish) {
      const last = legs[legs.length - 1];
      if (last && last.b && map.distance(last.b, finish.at) > 25) {
        L.polyline([last.b, finish.at], { color: "#555", weight: 2, dashArray: "6 6", opacity: 0.7 }).addTo(layer);
      }
      L.marker(finish.at, {
        icon: L.divIcon({ className: "finish-icon", html: "🍻", iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: finish.name,
        zIndexOffset: 2000,
      }).bindPopup("<strong>Finish</strong><br>" + esc(finish.name)).addTo(layer);
      all.push(finish.at);
    }

    if (all.length) routeBounds = L.latLngBounds(all);
    fitIfNeeded();
  }

  function focus(id) {
    const line = byId[id];
    if (!map || !line) return;
    map.fitBounds(line.getBounds(), { padding: [60, 60], maxZoom: 16 });
    line.openPopup(line.getCenter());
  }

  function resize() {
    if (!map) return;
    map.invalidateSize();
    fitIfNeeded();
  }

  window.MuniMap = { init, update, focus, resize };
})();
