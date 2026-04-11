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
