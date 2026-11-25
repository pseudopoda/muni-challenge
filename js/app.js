(function () {
  "use strict";

  const DATA = window.MUNI_DATA;
  const STORAGE_KEY = "muni-challenge:v1";
  const MODE_LABEL = { cable: "Cable car", rail: "Rail", bus: "Bus", owl: "Owl" };

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

  function renderLeg(leg) {
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

    return el("li", { class: classes, id: "leg-" + id, "data-id": id }, [
      el("input", {
        type: "checkbox",
        class: "check",
        checked: done,
        "aria-label": "Rode " + leg.line,
        onchange: (e) => {
          if (e.target.checked) state.done[id] = Date.now();
          else delete state.done[id];
          saveState();
          render();
        },
      }),
      el("div", { class: "leg-body" }, [
        el("p", { class: "leg-line" }, [el("span", { text: leg.line })].concat(tags)),
        route,
        leg.note ? el("p", { class: "leg-note", text: leg.note }) : null,
      ]),
    ]);
  }

  function render() {
    renderOptions();

    const blocks = visibleBlocks();
    const legs = blocks.flatMap((b) => b.legs);
    const total = new Set(legs.map(legId)).size;
    const doneCount = legs.filter((l) => state.done[legId(l)]).length;

    const container = $("itinerary");
    container.replaceChildren();
    for (const block of blocks) {
      const blockDone = block.legs.filter((l) => state.done[legId(l)]).length;
      container.append(
        el("section", { id: "block-" + block.id }, [
          el("h2", { class: "block-head" }, [
            el("span", {}, [el("span", { class: "time", text: block.time }), block.title]),
            el("span", { class: "count", text: blockDone + "/" + block.legs.length }),
          ]),
          el("ol", { class: "legs" }, block.legs.map(renderLeg)),
        ])
      );
    }

    // Highlight the first unridden leg.
    const next = legs.find((l) => !state.done[legId(l)]);
    if (next) $("leg-" + legId(next)).classList.add("next");
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
  }

  function renderStatic() {
    $("excluded").replaceChildren(...DATA.excluded.map((t) => el("li", { text: t })));
    $("caveats").replaceChildren(...DATA.caveats.map((t) => el("li", { text: t })));
  }

  // ---- Wiring ------------------------------------------------------------

  $("jumpNext").addEventListener("click", () => {
    const next = document.querySelector(".leg.next");
    if (next) next.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  $("resetBtn").addEventListener("click", () => {
    if (!confirm("Clear all checked-off lines?")) return;
    state.done = {};
    saveState();
    render();
  });

  renderStatic();
  render();

  // Offline support — only works when served over http(s).
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
