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

  function init() {
    initHomeFilters();
    initToc();
    initMobileTocDrawer();
    initMobileDirectoryDrawer();
    initHomeHeaderMotion();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
