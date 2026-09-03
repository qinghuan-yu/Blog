# Design QA

## Evidence

- Source visual truth: `C:\Users\qinghuanyu\.codex\generated_images\01a06668-97ec-7a83-a82e-d607fc72677b\exec-a9cc127d-f41b-49db-a940-162055cdf9af.png`
- Browser-rendered implementation: `C:\Users\qinghuanyu\.codex\visualizations\2026\09\03\01a06668-97ec-7a83-a82e-d607fc72677b\implementation-home-desktop-final.png`
- Responsive evidence: `implementation-home-mobile-final.png`, `implementation-home-mobile-drawer-final.png`, `implementation-article-desktop.png`, and `implementation-article-mobile-toc.png` in the same visualization folder.
- State: home page at the top of the page, default “全部” filter; article page at the top; mobile navigation drawers open and closed.
- CSS viewport: 1440 × 1024 desktop and 390 × 844 mobile, device scale factor 1 for the final responsive checks.
- Captured pixels: source 1487 × 1058; desktop implementation 1425 × 951. The comparison used the complete visible content region and normalized the small browser-surface crop difference by matching the same top-of-page state and proportions.

## Full-view comparison

The implementation matches the selected direction’s defining composition: a quiet paper-white canvas, thin header rule, oversized serif title, chronological article rows, and a narrow right utility rail combining tags, directory, and quick links. The actual project’s eleven tags and eleven posts are retained, so the sidebar is denser than the concept’s abbreviated mock data; its internal scrolling preserves the intended proportion.

## Focused-region comparison

- Hero/header: title scale, serif weight, left alignment, whitespace, thin rules, and navy active underline match the source hierarchy.
- Article rows: date rail, title/summary alignment, separators, and restrained link treatment match. Real tags are retained as small inline controls because they are an existing interaction.
- Utility rail: tags, active state, numbered directory, and quick links remain visually grouped without cards or shadows.
- Article page: the same type, color, rule, and two-column language continues into long-form reading; the 51-item article TOC remains scrollable and active-tracked.

## Required fidelity surfaces

- Fonts and typography: Georgia/Times with Noto Serif SC fallback reproduces the editorial serif direction; Manrope is limited to small metadata. Title, row titles, body copy, line height, and letter spacing are legible at desktop and mobile widths.
- Spacing and layout rhythm: desktop proportions follow the source’s wide article column and narrow sidebar. Mobile collapses to one column with a floating directory trigger and bottom drawer.
- Colors and visual tokens: warm near-white, charcoal, muted gray, fine neutral rules, and restrained navy active states match the selected palette. No gradients, glass, shadows, or decorative cards remain.
- Image quality and asset fidelity: the selected concept contains no required raster imagery. No placeholder art or generated background assets are used. Concept-only utility icons were intentionally replaced by explicit text labels, avoiding invented or mismatched icon assets.
- Copy and content: implementation uses the repository’s real Chinese post titles, dates, summaries, tags, GitHub URL, and email address rather than the mock’s sample values.

## Comparison history

1. Initial desktop pass
   - Earlier findings: P2 content region began too low; P2 article rows were too tall; P2 quick navigation fell below the first viewport.
   - Fixes: reduced hero and row height, tightened title scale and sidebar section rhythm, and constrained the directory to an internal scrolling region.
   - Post-fix evidence: `implementation-home-desktop-final.png` shows the corrected hierarchy and the quick-navigation heading within the desktop viewport.
2. Initial mobile pass
   - Earlier finding: P1 the hidden overlay mask still rendered because author CSS overrode the browser’s hidden-state rule, dimming the page and intercepting drawer controls.
   - Fix: added an explicit `[hidden]` rule and reran open/close interactions.
   - Post-fix evidence: `implementation-home-mobile-final.png` is unobscured; `implementation-home-mobile-drawer-final.png` shows the open drawer. ARIA state changes from `true` to `false` and back to `true` with no console errors.
3. Long-article sticky navigation pass
   - Earlier finding: P1 the scroll script applied `is-docked`, but the redesigned stylesheet did not define the corresponding fixed-position state, so the TOC moved out of the viewport deep in an article.
   - Fix: restored the desktop docked state at a 24px viewport offset and constrained the TOC inner region to the remaining viewport height.
   - Post-fix evidence: `article-toc-docked.png` shows the TOC fixed beside section 8.1. Before and after switching between deep chapters, its measured top remains 24px while article scroll position changes from 12939px to 17554px; the internal TOC scroll position advances from 0 to 524px.

## Interaction checks

- Tag filter “前端”: 3 article rows and 3 matching directory entries; URL query updates correctly.
- Directory anchor: navigates to the selected article row and leaves exactly one active directory entry.
- Desktop article TOC: 51 generated links; no console warnings or errors.
- Mobile home drawer: trigger visible, mask and panel open, close control restores the closed state.
- Mobile article drawer: trigger visible, 51 links available, open/close state and ARIA values correct.
- Deep article navigation: the right TOC remains fixed at 24px from the viewport top, scrolls internally to keep later entries available, and changes chapters without returning to the article header.

## Findings

No actionable P0, P1, or P2 differences remain.

## Follow-up polish

- P3: the concept shows four top-level navigation items and utility icons. The implementation intentionally exposes only routes that exist in this Hexo project and uses clear text actions; those can be extended later if archive/about routes or an icon package are added.

final result: passed
