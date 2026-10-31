/* ===== CyberChef responsive layer ===== */
/* Keep template literals and lodash template delimiters out of this file: HtmlWebpackPlugin runs
   the page template through lodash.template, which would interpret them (patch-html.js checks). */
(function () {
  "use strict";
  var BP = parseInt("__CC_MOBILE_BP__", 10) || 900;
  var SITE_TITLE = "__CC_TITLE__";

  /* Layout (bottom tab bar) depends on the viewport width. Interaction (tap to add, buttons, no drag
     and drop) depends on the pointer type. A landscape tablet therefore keeps the desktop layout
     without drag and drop, and a narrow desktop window keeps double click and drag and drop. */
  var mq = window.matchMedia("(max-width: " + BP + "px)");
  var tq = window.matchMedia("(pointer: coarse)");
  /* Classes go on <body>: CyberChef overwrites <html>.className when it applies a theme */
  var root = document.body;

  var TABS = [
    { id: "operations", label: "Operations", icon: "view_list" },
    { id: "recipe",     label: "Recipe",     icon: "restaurant_menu" },
    { id: "input",      label: "Input",      icon: "input" },
    { id: "output",     label: "Output",     icon: "output" }
  ];
  var RECIPE_BUTTONS = [
    { act: "info", icon: "info_outline",        label: "Description" },
    { act: "up",   icon: "keyboard_arrow_up",   label: "Move up" },
    { act: "down", icon: "keyboard_arrow_down", label: "Move down" },
    { act: "del",  icon: "delete",              label: "Remove" }
  ];
  var current = "input";
  var bar = null;
  var toastEl = null, toastTimer = null;
  var infoEl = null, infoReturnFocus = null, opDescriptions = null;
  var INFO_ZONE = 48; /* px at the right edge of an operation row that open its description (matches the CSS icon) */
  var refreshTimer = null;

  function isMobile() { return root.classList.contains("cc-mobile"); }
  function isTouch() { return root.classList.contains("cc-touch"); }
  function applyTouch() { root.classList.toggle("cc-touch", tq.matches); }

  function buildBar() {
    if (bar) return;
    bar = document.createElement("nav");
    bar.id = "cc-m-tabs";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", "CyberChef panels");
    TABS.forEach(function (tab) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cc-m-tab";
      b.setAttribute("role", "tab");
      b.setAttribute("data-tab", tab.id);
      var i = document.createElement("i");
      i.className = "material-icons";
      i.setAttribute("aria-hidden", "true");
      i.textContent = tab.icon;
      var s = document.createElement("span");
      s.textContent = tab.label;
      b.appendChild(i);
      b.appendChild(s);
      if (tab.id === "recipe") {
        var badge = document.createElement("span");
        badge.className = "cc-m-badge";
        badge.hidden = true;
        b.appendChild(badge);
      }
      b.addEventListener("click", function () { setTab(tab.id); });
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }

  function setTab(id) {
    current = id;
    TABS.forEach(function (tab) { root.classList.toggle("cc-m-show-" + tab.id, tab.id === id); });
    if (bar) {
      Array.prototype.forEach.call(bar.children, function (b) {
        var on = b.getAttribute("data-tab") === id;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    refresh();
  }

  /* Places the panes right below the banner, whatever its height */
  function updateTop() {
    var banner = document.getElementById("banner");
    var top = banner ? Math.max(0, Math.round(banner.getBoundingClientRect().bottom)) : 0;
    root.style.setProperty("--cc-m-top", top + "px");
  }

  /* Tells CyberChef / CodeMirror that the pane sizes have changed */
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      updateTop();
      window.dispatchEvent(new Event("resize"));
    }, 50);
  }

  function apply() {
    if (mq.matches) {
      buildBar();
      root.classList.add("cc-mobile");
      setTab(current);
    } else {
      root.classList.remove("cc-mobile");
      refresh();
    }
  }

  function updateBadge() {
    var list = document.getElementById("rec-list");
    var badge = bar && bar.querySelector(".cc-m-badge");
    if (!list || !badge) return;
    var n = list.children.length;
    badge.textContent = String(n);
    badge.hidden = n === 0;
  }

  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "cc-m-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1600);
  }

  function stateChanged() {
    window.dispatchEvent(new CustomEvent("statechange", { bubbles: true }));
  }

  /* Move up / move down / remove buttons on each recipe operation (there is no drag and drop with a coarse pointer) */
  function decorateRecipeItem(li) {
    if (li.nodeType !== 1 || !li.matches("li.operation") || li.querySelector(".cc-m-ops")) return;
    var box = document.createElement("span");
    box.className = "cc-m-ops";
    RECIPE_BUTTONS.forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm cc-m-op-btn";
      b.setAttribute("data-act", d.act);
      b.setAttribute("aria-label", d.label);
      b.title = d.label;
      var i = document.createElement("i");
      i.className = "material-icons";
      i.setAttribute("aria-hidden", "true");
      i.textContent = d.icon;
      b.appendChild(i);
      box.appendChild(b);
    });
    li.appendChild(box);
  }

  /* ---- Operation description (the popover CyberChef shows on hover) ---- */

  /* Operations in the recipe are created from the name only, so their description is looked up
     by name in the category lists, which hold every operation with its description in data-content. */
  function descriptionFor(name) {
    if (!opDescriptions) {
      opDescriptions = {};
      Array.prototype.forEach.call(document.querySelectorAll("#categories li.operation"), function (li) {
        var d = li.getAttribute("data-content"), n = li.textContent.trim();
        if (d && !Object.prototype.hasOwnProperty.call(opDescriptions, n)) opDescriptions[n] = d;
      });
    }
    return Object.prototype.hasOwnProperty.call(opDescriptions, name) ? opDescriptions[name] : null;
  }

  function buildInfo() {
    infoEl = document.createElement("div");
    infoEl.id = "cc-m-info";
    infoEl.setAttribute("role", "dialog");
    infoEl.setAttribute("aria-modal", "true");
    infoEl.setAttribute("aria-labelledby", "cc-m-info-title");
    var backdrop = document.createElement("div");
    backdrop.className = "cc-m-info-backdrop";
    var sheet = document.createElement("div");
    sheet.className = "cc-m-info-sheet";
    var head = document.createElement("div");
    head.className = "cc-m-info-head";
    var h = document.createElement("h5");
    h.id = "cc-m-info-title";
    var close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn-sm cc-m-info-close";
    close.setAttribute("aria-label", "Close");
    var ci = document.createElement("i");
    ci.className = "material-icons";
    ci.setAttribute("aria-hidden", "true");
    ci.textContent = "close";
    close.appendChild(ci);
    var body = document.createElement("div");
    body.className = "cc-m-info-body";
    head.appendChild(h);
    head.appendChild(close);
    sheet.appendChild(head);
    sheet.appendChild(body);
    infoEl.appendChild(backdrop);
    infoEl.appendChild(sheet);
    document.body.appendChild(infoEl);
    backdrop.addEventListener("click", hideInfo);
    close.addEventListener("click", hideInfo);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && infoEl.classList.contains("show")) hideInfo();
    });
  }

  function showInfo(name) {
    if (!infoEl) buildInfo();
    var desc = descriptionFor(name);
    infoEl.querySelector("#cc-m-info-title").textContent = name;
    var body = infoEl.querySelector(".cc-m-info-body");
    /* The text comes from CyberChef's own bundled operation descriptions (what its popover renders) */
    if (desc) body.innerHTML = desc;
    else body.textContent = "No description available.";
    body.scrollTop = 0;
    infoReturnFocus = document.activeElement;
    infoEl.classList.add("show");
    infoEl.querySelector(".cc-m-info-close").focus();
  }

  function hideInfo() {
    if (!infoEl) return;
    infoEl.classList.remove("show");
    if (infoReturnFocus && infoReturnFocus.focus) infoReturnFocus.focus();
    infoReturnFocus = null;
  }

  function setupRecipeControls(list) {
    Array.prototype.forEach.call(list.children, decorateRecipeItem);
    list.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".cc-m-op-btn");
      if (!btn) return;
      var li = btn.closest("li.operation");
      var act = btn.getAttribute("data-act");
      if (act === "info") {
        var title = li.querySelector(".op-title");
        showInfo(title ? title.textContent : li.textContent.trim());
        return;
      }
      if (act === "up" && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
      else if (act === "down" && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
      else if (act === "del") li.remove();
      else return;
      if (act !== "del") li.scrollIntoView({ block: "nearest" });
      stateChanged();
    });
  }

  /* A single tap on an operation adds it to the recipe. CyberChef listens for a double click to do
     that, so a synthetic dblclick is dispatched. */
  function setupTapToAdd() {
    document.addEventListener("click", function (e) {
      if (!isTouch() || !e.target.closest) return;
      var li = e.target.closest("#operations li.operation");
      if (!li) return;
      /* The icon at the right edge of the row opens the description instead of adding the operation */
      if (e.clientX >= li.getBoundingClientRect().right - INFO_ZONE) {
        e.preventDefault();
        e.stopPropagation();
        showInfo(li.textContent.trim());
        return;
      }
      li.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
      li.classList.remove("cc-m-added");
      void li.offsetWidth;
      li.classList.add("cc-m-added");
      /* Removed when it ends, otherwise the animation replays every time the pane is shown again */
      li.addEventListener("animationend", function () { li.classList.remove("cc-m-added"); }, { once: true });
      toast("Added: " + li.textContent.trim());
    }, true);
  }

  /* With a coarse pointer, Sortable drag and drop (which fights with scrolling and taps) and native
     dblclick events (double tap, which would add or remove operations by accident) are disabled.
     The synthetic dblclick events from setupTapToAdd are not "trusted", so they still go through. */
  function disableDragAndNativeDblclick() {
    var SEL = "#operations li.operation, #rec-list li.operation";
    var KEEP = "input, select, textarea, button, a, .arg, .form-group, .cc-m-ops, .dropdown-menu";
    ["pointerdown", "touchstart", "mousedown", "dragstart"].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        if (!isTouch() || !e.target.closest) return;
        if (e.target.closest(SEL) && !e.target.closest(KEEP)) e.stopImmediatePropagation();
      }, true);
    });
    document.addEventListener("dblclick", function (e) {
      if (isTouch() && e.isTrusted && e.target.closest && e.target.closest(SEL)) e.stopImmediatePropagation();
    }, true);
  }

  /* CyberChef rewrites document.title every time the recipe changes ("To Base64 - CyberChef"), so
     the name of this build is kept with an observer. If the new title ended in "CyberChef" it would
     match again and loop, so it is not watched in that case. */
  function fixTitle() {
    if (/CyberChef$/.test(document.title)) document.title = document.title.replace(/CyberChef$/, SITE_TITLE);
  }
  function watchTitle() {
    var el = document.querySelector("title");
    if (!el || /CyberChef$/.test(SITE_TITLE)) return;
    fixTitle();
    if (window.MutationObserver) new MutationObserver(fixTitle).observe(el, { childList: true, characterData: true, subtree: true });
  }

  function init() {
    if (!document.getElementById("IO")) return; /* Not the CyberChef page */
    watchTitle();
    applyTouch();
    apply();
    if (mq.addEventListener) { mq.addEventListener("change", apply); tq.addEventListener("change", applyTouch); }
    else if (mq.addListener) { mq.addListener(apply); tq.addListener(applyTouch); }
    window.addEventListener("resize", updateTop);
    window.addEventListener("orientationchange", refresh);
    window.addEventListener("load", refresh);

    var list = document.getElementById("rec-list");
    if (list) {
      setupRecipeControls(list);
      if (window.MutationObserver) {
        new MutationObserver(function (recs) {
          recs.forEach(function (r) { Array.prototype.forEach.call(r.addedNodes, decorateRecipeItem); });
          updateBadge();
        }).observe(list, { childList: true });
      }
    }
    updateBadge();
    setupTapToAdd();
    disableDragAndNativeDblclick();

    /* Pressing "Bake!" jumps straight to the output */
    document.addEventListener("click", function (e) {
      if (isMobile() && e.target.closest && e.target.closest("#bake")) {
        setTimeout(function () { setTab("output"); }, 150);
      }
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
