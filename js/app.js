(function () {
  "use strict";

  const DATA = window.MUNI_DATA;
  const MAP = window.MuniMap;
  const STORAGE_KEY = "muni-challenge:v1";
  const MODE_LABEL = { cable: "Cable car", rail: "Rail", bus: "Bus", owl: "Owl" };
  const WIDE = window.matchMedia("(min-width: 1000px)");

  // ---- State -------------------------------------------------------------

  function loadState() {
    const fallback = { options: { owl: false, event: false, earlybird: false }, done: {} };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        options: Object.assign({}, fallback.options, parsed.options),
        done: parsed.done || {},
      };
    } catch (e) {
      return fallback;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable (private mode etc.) — progress just won't persist */
    }
  }

  const state = loadState();

  // A leg's id is derived from its line name so saved progress survives reordering.
  const legId = (leg) => leg.line.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  function isOptionOn(key) {
    if (!key) return true;
    const opt = DATA.options[key];
    if (opt && opt.requires && !state.options[opt.requires]) return false;
    return !!state.options[key];
  }

  function visibleBlocks() {
    return DATA.blocks
      .filter((b) => isOptionOn(b.option))
      .map((b) => ({ ...b, legs: b.legs.filter((l) => isOptionOn(l.option)) }))
      .filter((b) => b.legs.length);
  }

  function toggleDone(id, value) {
    const on = value === undefined ? !state.done[id] : value;
    if (on) state.done[id] = Date.now();
    else delete state.done[id];
    saveState();
    render();
  }

  // ---- View (list / map) -------------------------------------------------

  function setView(view) {
    document.body.dataset.view = view;
    document.querySelectorAll(".view-toggle button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.view === view));
    });
    if (view === "map") MAP.resize();
  }

  function showOnMap(id) {
    if (!WIDE.matches) setView("map");
    // Wait a frame so the map has its real size before zooming.
    requestAnimationFrame(() => { MAP.resize(); MAP.focus(id); });
  }

  // ---- Rendering ---------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children || [])) {
      if (c != null) node.append(c);
    }
    return node;
  }

  function renderOptions() {
    const box = $("options");
    box.replaceChildren();
    for (const [key, opt] of Object.entries(DATA.options)) {
      const disabled = opt.requires && !state.options[opt.requires];
      const input = el("input", {
        type: "checkbox",
        checked: !!state.options[key] && !disabled,
        disabled: disabled,
        onchange: (e) => {
          state.options[key] = e.target.checked;
          saveState();
          render();
        },
      });
      box.append(
        el("label", { class: "opt" + (disabled ? " disabled" : "") }, [
          input,
          el("span", { text: opt.label }),
          el("span", { class: "hint", text: opt.hint }),
        ])
      );
    }
  }

  function renderLeg(leg, n, color) {
    const id = legId(leg);
    const done = !!state.done[id];
    const classes = ["leg", leg.mode === "owl" && "owl", leg.risk && "risk", done && "done"].filter(Boolean).join(" ");

    const tags = [el("span", { class: "tag " + leg.mode, text: MODE_LABEL[leg.mode] })];
    if (leg.risk) tags.push(el("span", { class: "tag risk", text: "⚠ Infrequent" }));

    const route = el("dl", { class: "leg-route" }, [
      el("dt", { text: "Board" }), el("dd", { text: leg.board }),
      el("dt", { text: "Alight" }), el("dd", { text: leg.alight }),
      el("dt", { text: "Then" }), el("dd", { text: leg.next }),
    ]);

    return el("li", { class: classes, id: "leg-" + id, "data-id": id, style: "--block:" + color }, [
      el("input", {
        type: "checkbox",
        class: "check",
        checked: done,
        "aria-label": "Rode " + leg.line,
        onchange: (e) => toggleDone(id, e.target.checked),
      }),
      el("div", { class: "leg-body" }, [
        el("div", { class: "leg-head" }, [
          el("p", { class: "leg-line" }, [el("span", { class: "leg-num", text: n }), el("span", { text: leg.line })].concat(tags)),
          leg.from ? el("button", { type: "button", class: "map-btn", title: "Show on map", "aria-label": "Show " + leg.line + " on map", text: "📍", onclick: () => showOnMap(id) }) : null,
        ]),
        route,
        leg.note ? el("p", { class: "leg-note", text: leg.note }) : null,
      ]),
    ]);
  }

  function render() {
    renderOptions();

    const blocks = visibleBlocks();
    const items = [];
    blocks.forEach((b) => b.legs.forEach((leg) => {
      const id = legId(leg);
      items.push({ leg, id, color: b.color, done: !!state.done[id], n: items.length + 1 });
    }));
    const total = new Set(items.map((i) => i.id)).size;
    const doneCount = items.filter((i) => i.done).length;
    const next = items.find((i) => !i.done);

    const container = $("itinerary");
    container.replaceChildren();
    let n = 0;
    for (const block of blocks) {
      const blockDone = block.legs.filter((l) => state.done[legId(l)]).length;
      container.append(
        el("section", { id: "block-" + block.id }, [
          el("h2", { class: "block-head", style: "--block:" + block.color }, [
            el("span", {}, [el("span", { class: "time", text: block.time }), block.title]),
            el("span", { class: "count", text: blockDone + "/" + block.legs.length }),
          ]),
          el("ol", { class: "legs" }, block.legs.map((leg) => renderLeg(leg, ++n, block.color))),
        ])
      );
    }

    if (next) $("leg-" + next.id).classList.add("next");
    $("jumpNext").hidden = !next;

    $("doneCount").textContent = doneCount;
    $("totalCount").textContent = total;
    $("progressFill").style.width = (total ? (100 * doneCount) / total : 0) + "%";
    const bar = $("progressBar");
    bar.setAttribute("aria-valuemax", total);
    bar.setAttribute("aria-valuenow", doneCount);

    $("finishText").textContent =
      doneCount === total
        ? "You did it — all " + total + " lines. 🎉"
        : total + " lines on today's plan · " + (total - doneCount) + " to go.";

    MAP.update(items, next && next.id, DATA.finish);
    renderLegend(blocks);
  }

  function renderLegend(blocks) {
    $("mapLegend").replaceChildren(
      ...blocks.map((b) => el("span", { class: "legend-item" }, [el("span", { class: "swatch", style: "background:" + b.color }), b.time])),
      el("span", { class: "legend-item" }, [el("span", { class: "swatch walk" }), "walk"]),
      el("span", { class: "legend-item" }, [el("span", { class: "swatch", style: "background:#9a9a9a" }), "ridden"])
    );
  }

  function renderStatic() {
    $("excluded").replaceChildren(...DATA.excluded.map((t) => el("li", { text: t })));
    $("caveats").replaceChildren(...DATA.caveats.map((t) => el("li", { text: t })));
  }

  // ---- Wiring ------------------------------------------------------------

  $("jumpNext").addEventListener("click", () => {
    const next = document.querySelector(".leg.next");
    if (!next) return;
    if (document.body.dataset.view === "map" && !WIDE.matches) MAP.focus(next.dataset.id);
    else next.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  document.querySelectorAll(".view-toggle button").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
  WIDE.addEventListener("change", () => MAP.resize());

  $("resetBtn").addEventListener("click", () => {
    if (!confirm("Clear all checked-off lines?")) return;
    state.done = {};
    saveState();
    render();
  });

  MAP.init($("map"), { onToggle: (id) => toggleDone(id) });
  renderStatic();
  render();

  // Offline support — only works when served over http(s).
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
