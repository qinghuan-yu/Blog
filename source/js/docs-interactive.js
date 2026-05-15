(function () {
  function getUrlTag() {
    var params = new URLSearchParams(window.location.search);
    return params.get("tag") || "all";
  }

  function setUrlTag(tag) {
    var params = new URLSearchParams(window.location.search);
    if (!tag || tag === "all") {
      params.delete("tag");
    } else {
      params.set("tag", tag);
    }

    var query = params.toString();
    var nextUrl = window.location.pathname + (query ? "?" + query : "") + window.location.hash;
    window.history.replaceState(null, "", nextUrl);
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\u4e00-\u9fa5\-\s]/g, "")
      .replace(/\s+/g, "-");
  }

  function bindPanelWheelScroll(panel, scrollList) {
    if (!panel || !scrollList) {
      return;
    }

    panel.addEventListener(
      "wheel",
      function (event) {
        if (!panel.contains(event.target)) {
          return;
        }

        var canScroll = scrollList.scrollHeight > scrollList.clientHeight;
        if (!canScroll) {
          return;
        }

        event.preventDefault();
        var nextTop = scrollList.scrollTop + event.deltaY;
        var maxTop = scrollList.scrollHeight - scrollList.clientHeight;
        scrollList.scrollTop = Math.max(0, Math.min(nextTop, maxTop));
      },
      { passive: false }
    );
  }

  function getScrollableTarget(panel, preferredList) {
    if (preferredList && preferredList.scrollHeight > preferredList.clientHeight) {
      return preferredList;
    }

    if (panel && panel.scrollHeight > panel.clientHeight) {
      return panel;
    }

    return null;
  }

  function scheduleFrame(callback) {
    var frameId = 0;

    return function () {
      if (frameId) {
        return;
      }

      frameId = window.requestAnimationFrame(function () {
        frameId = 0;
        callback();
      });
    };
  }

  function initPanelScrollGuards() {
    var guardedPanels = [];

    Array.prototype.slice.call(document.querySelectorAll(".doc-page-toc")).forEach(function (panel) {
      var list = panel.querySelector("[data-toc-list]");
      if (list) {
        bindPanelWheelScroll(panel, list);
        guardedPanels.push({ panel: panel, list: list });
      }
    });

    Array.prototype.slice.call(document.querySelectorAll(".doc-directory")).forEach(function (panel) {
      var list = panel.querySelector("[data-directory-list]");
      if (list) {
        bindPanelWheelScroll(panel, list);
        guardedPanels.push({ panel: panel, list: list });
      }
    });

    if (!guardedPanels.length) {
      return;
    }

    var activePanelIndex = -1;

    guardedPanels.forEach(function (item, index) {
      item.panel.addEventListener("mouseenter", function () {
        activePanelIndex = index;
      });

      item.panel.addEventListener("mouseleave", function () {
        if (activePanelIndex === index) {
          activePanelIndex = -1;
        }
      });
    });

    document.addEventListener(
      "wheel",
      function (event) {
        if (activePanelIndex < 0) {
          return;
        }

        var current = guardedPanels[activePanelIndex];
        if (!current || !current.panel.matches(":hover")) {
          activePanelIndex = -1;
          return;
        }

        var target = getScrollableTarget(current.panel, current.list);
        if (!target) {
          return;
        }

        event.preventDefault();
        var nextTop = target.scrollTop + event.deltaY;
        var maxTop = target.scrollHeight - target.clientHeight;
        target.scrollTop = Math.max(0, Math.min(nextTop, maxTop));
      },
      { passive: false, capture: true }
    );
  }

  function initHomeFilters() {
    var filterRoot = document.querySelector("[data-filter-root]");
    var homeRoot = document.querySelector("[data-home-root]");
    if (!filterRoot || !homeRoot) {
      return;
    }

    var controls = Array.prototype.slice.call(filterRoot.querySelectorAll("[data-filter-control]"));
    var cards = Array.prototype.slice.call(homeRoot.querySelectorAll("[data-doc-card]"));
    var directoryItems = Array.prototype.slice.call(homeRoot.querySelectorAll("[data-directory-item]"));
    var label = filterRoot.querySelector("[data-filter-label]");
    var emptyState = homeRoot.querySelector("[data-empty-state]");

    function applyFilter(tag) {
      var activeTag = tag || "all";
      var visibleCount = 0;

      controls.forEach(function (control) {
        control.classList.toggle("is-active", control.getAttribute("data-filter-control") === activeTag);
      });

      cards.forEach(function (card) {
        var tags = (card.getAttribute("data-card-tags") || "").split("|").filter(Boolean);
        var visible = activeTag === "all" || tags.indexOf(activeTag) !== -1;
        card.hidden = !visible;
        if (visible) {
          visibleCount += 1;
        }
      });

      directoryItems.forEach(function (item) {
        var tags = (item.getAttribute("data-card-tags") || "").split("|").filter(Boolean);
        item.hidden = !(activeTag === "all" || tags.indexOf(activeTag) !== -1);
      });

      if (label) {
        label.textContent = "当前：" + (activeTag === "all" ? "全部" : activeTag);
      }

      if (emptyState) {
        emptyState.hidden = visibleCount !== 0;
      }

      setUrlTag(activeTag);
    }

    filterRoot.addEventListener("click", function (event) {
      var control = event.target.closest("[data-filter-control]");
      if (!control) {
        return;
      }
      applyFilter(control.getAttribute("data-filter-control"));
    });

    homeRoot.addEventListener("click", function (event) {
      var tagButton = event.target.closest("[data-filter-tag]");
      if (!tagButton) {
        return;
      }
      event.preventDefault();
      applyFilter(tagButton.getAttribute("data-filter-tag"));
    });

    applyFilter(getUrlTag());
  }

  function initToc() {
    var tocRoot = document.querySelector("[data-doc-toc-root]");
    if (!tocRoot) {
      return;
    }

    var content = tocRoot.querySelector("[data-doc-content]");
    var tocList = tocRoot.querySelector("[data-toc-list]");
    var mobileTrigger = tocRoot.querySelector("[data-mobile-toc-trigger]");
    if (!content || !tocList) {
      return;
    }

    var headings = Array.prototype.slice.call(content.querySelectorAll("h2, h3"));
    if (!headings.length) {
      if (mobileTrigger) {
        mobileTrigger.hidden = true;
        mobileTrigger.setAttribute("aria-expanded", "false");
      }
      var mobilePanel = tocRoot.querySelector(".doc-page-toc");
      if (mobilePanel) {
        mobilePanel.setAttribute("aria-hidden", "true");
      }
      tocRoot.classList.remove("is-mobile-toc-open");
      return;
    }

    if (mobileTrigger) {
      mobileTrigger.hidden = false;
    }

    function keepActiveLinkVisible(activeLink) {
      if (!activeLink) {
        return;
      }

      var containerRect = tocList.getBoundingClientRect();
      var linkRect = activeLink.getBoundingClientRect();
      var offsetTop = linkRect.top - containerRect.top;
      var offsetBottom = linkRect.bottom - containerRect.bottom;

      if (offsetTop < 8 || offsetBottom > -8) {
        var targetTop = activeLink.offsetTop - tocList.clientHeight * 0.38;
        tocList.scrollTo({
          top: Math.max(0, targetTop),
          behavior: "smooth",
        });
      }
    }

    var usedIds = Object.create(null);

    var links = headings.map(function (heading, index) {
      if (!heading.id) {
        var baseId = slugify(heading.textContent) || "section-" + (index + 1);
        var count = (usedIds[baseId] || 0) + 1;
        usedIds[baseId] = count;
        heading.id = count === 1 ? baseId : baseId + "-" + count;
      }

      var link = document.createElement("a");
      link.href = "#" + heading.id;
      link.textContent = heading.textContent;
      if (heading.tagName.toLowerCase() === "h3") {
        link.classList.add("lv3");
      }
      tocList.appendChild(link);
      return link;
    });

    tocList.querySelectorAll(".doc-toc-empty").forEach(function (node) {
      node.remove();
    });

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) {
            return;
          }

          var activeLink = null;
          links.forEach(function (link) {
            var isActive = link.getAttribute("href") === "#" + entry.target.id;
            link.classList.toggle("is-active", isActive);
            if (isActive) {
              activeLink = link;
            }
          });

          keepActiveLinkVisible(activeLink);
        });
      },
      {
        rootMargin: "-20% 0px -65% 0px",
        threshold: 1,
      }
    );

    headings.forEach(function (heading) {
      observer.observe(heading);
    });
  }

  function initMobileTocDrawer() {
    initMobileDrawerGroup({
      rootSelector: "[data-doc-toc-root]",
      triggerSelector: "[data-mobile-toc-trigger]",
      maskSelector: "[data-mobile-toc-mask]",
      closeSelector: "[data-mobile-toc-close]",
      panelSelector: ".doc-page-toc",
      listSelector: "[data-toc-list]",
    });
  }

  function initMobileDirectoryDrawer() {
    initMobileDrawerGroup({
      rootSelector: "[data-home-directory-root]",
      triggerSelector: "[data-mobile-directory-trigger]",
      maskSelector: "[data-mobile-directory-mask]",
      closeSelector: "[data-mobile-directory-close]",
      panelSelector: ".doc-directory",
      listSelector: "[data-directory-list]",
      requireVisibleItems: true,
    });
  }

  function syncMobileBodyLock() {
    var hasOpen =
      document.querySelector("[data-doc-toc-root].is-mobile-toc-open") !== null ||
      document.querySelector("[data-home-directory-root].is-mobile-toc-open") !== null;
    document.body.classList.toggle("is-mobile-toc-open", hasOpen);
  }

  function initMobileDrawerGroup(options) {
    var roots = Array.prototype.slice.call(document.querySelectorAll(options.rootSelector));
    if (!roots.length) {
      return;
    }

    var mobileQuery = window.matchMedia("(max-width: 1080px)");

    roots.forEach(function (root) {
      var trigger = root.querySelector(options.triggerSelector);
      var mask = root.querySelector(options.maskSelector);
      var closeBtn = root.querySelector(options.closeSelector);
      var panel = root.querySelector(options.panelSelector);
      var list = root.querySelector(options.listSelector);

      if (!trigger || !mask || !panel || (options.requireVisibleItems && !list)) {
        return;
      }

      function hasVisibleItems() {
        return !options.requireVisibleItems || (list && list.querySelector("a:not([hidden])") !== null);
      }

      function setOpen(open) {
        var shouldOpen = Boolean(open && mobileQuery.matches && !trigger.hidden && hasVisibleItems());
        root.classList.toggle("is-mobile-toc-open", shouldOpen);
        syncMobileBodyLock();
        trigger.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
        panel.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
        mask.hidden = !shouldOpen;
      }

      function syncTriggerVisibility() {
        if (!options.requireVisibleItems) {
          return;
        }

        trigger.hidden = !hasVisibleItems();
        if (trigger.hidden) {
          setOpen(false);
        }
      }

      trigger.addEventListener("click", function () {
        setOpen(true);
      });

      mask.addEventListener("click", function () {
        setOpen(false);
      });

      if (closeBtn) {
        closeBtn.addEventListener("click", function () {
          setOpen(false);
        });
      }

      if (list) {
        list.addEventListener("click", function (event) {
          if (event.target.closest("a")) {
            setOpen(false);
          }
        });
      }

      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          setOpen(false);
        }
      });

      function syncByViewport() {
        if (!mobileQuery.matches) {
          setOpen(false);
        }
      }

      window.addEventListener("resize", syncByViewport, { passive: true });
      if (mobileQuery.addEventListener) {
        mobileQuery.addEventListener("change", syncByViewport);
      }

      syncTriggerVisibility();
      setOpen(false);
    });
  }

  function initHomeHeaderMotion() {
    if (!document.body.classList.contains("page-home")) {
      return;
    }

    function syncHeaderState() {
      document.body.classList.toggle("home-scrolled", window.scrollY > 36);
    }

    var scheduleHeaderState = scheduleFrame(syncHeaderState);

    window.addEventListener("scroll", scheduleHeaderState, { passive: true });
    syncHeaderState();
  }

  function initSidebarPinning() {
    var panels = Array.prototype.slice.call(document.querySelectorAll(".doc-directory, .doc-page-toc"));
    if (!panels.length) {
      return;
    }

    var desktopQuery = window.matchMedia("(min-width: 1081px)");
    var topOffset = 102;

    function clearPinnedState() {
      panels.forEach(function (panel) {
        panel.classList.remove("is-pinned");
        panel.style.setProperty("--pin-top", topOffset + "px");
      });
    }

    function measureStartPositions() {
      clearPinnedState();
      panels.forEach(function (panel) {
        var container = panel.closest(".doc-home-grid, .doc-page-layout");
        var rect = panel.getBoundingClientRect();
        var startY = window.scrollY + rect.top - topOffset;
        var startRounded = Math.max(0, Math.round(startY));
        var containerBottom = container
          ? window.scrollY + container.getBoundingClientRect().bottom
          : window.scrollY + rect.bottom;
        var panelHeight = rect.height;
        var endY = Math.round(containerBottom - topOffset - panelHeight);
        var pinRange = endY - startRounded;

        panel.setAttribute("data-pin-start", String(startRounded));
        panel.setAttribute("data-pin-end", String(Math.max(startRounded, endY)));
        panel.setAttribute("data-pin-disabled", pinRange <= 0 ? "1" : "0");
        panel.style.setProperty("--pin-left", Math.round(rect.left) + "px");
        panel.style.setProperty("--pin-width", Math.round(rect.width) + "px");
        panel.style.setProperty("--pin-top", topOffset + "px");
      });
    }

    function syncPinnedState() {
      if (!desktopQuery.matches) {
        clearPinnedState();
        return;
      }

      var currentY = window.scrollY;
      panels.forEach(function (panel) {
        if (panel.getAttribute("data-pin-disabled") === "1") {
          panel.classList.remove("is-pinned");
          panel.style.setProperty("--pin-top", topOffset + "px");
          return;
        }

        var startY = Number(panel.getAttribute("data-pin-start") || "0");
        var endY = Number(panel.getAttribute("data-pin-end") || String(startY));

        if (currentY < startY) {
          panel.classList.remove("is-pinned");
          panel.style.setProperty("--pin-top", topOffset + "px");
          return;
        }

        panel.classList.add("is-pinned");

        if (currentY <= endY) {
          panel.style.setProperty("--pin-top", topOffset + "px");
        } else {
          panel.style.setProperty("--pin-top", topOffset - (currentY - endY) + "px");
        }
      });
    }

    function refresh() {
      if (!desktopQuery.matches) {
        clearPinnedState();
        return;
      }
      measureStartPositions();
      syncPinnedState();
    }

    var schedulePinnedState = scheduleFrame(syncPinnedState);
    var scheduleRefresh = scheduleFrame(refresh);

    window.addEventListener("scroll", schedulePinnedState, { passive: true });
    window.addEventListener("resize", scheduleRefresh, { passive: true });
    if (desktopQuery.addEventListener) {
      desktopQuery.addEventListener("change", refresh);
    }

    refresh();
  }

  function init() {
    initPanelScrollGuards();
    initHomeFilters();
    initToc();
    initMobileTocDrawer();
    initMobileDirectoryDrawer();
    initHomeHeaderMotion();
    initSidebarPinning();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
