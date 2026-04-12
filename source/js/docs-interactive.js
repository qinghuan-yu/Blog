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

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
    if (!content || !tocList) {
      return;
    }

    var headings = Array.prototype.slice.call(content.querySelectorAll("h2, h3"));
    if (!headings.length) {
      return;
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

    var links = headings.map(function (heading, index) {
      if (!heading.id) {
        heading.id = slugify(heading.textContent) || "section-" + (index + 1);
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

  function initHomeHeaderMotion() {
    if (!document.body.classList.contains("page-home")) {
      return;
    }

    function syncHeaderState() {
      document.body.classList.toggle("home-scrolled", window.scrollY > 36);
    }

    window.addEventListener("scroll", syncHeaderState, { passive: true });
    syncHeaderState();
  }

  function init() {
    initPanelScrollGuards();
    initHomeFilters();
    initToc();
    initHomeHeaderMotion();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
