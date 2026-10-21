# UI and design

The visual language and interaction rules of the interface. Useful for testers who want to know what
"correct" looks like, and for developers adding screens.

---

## 1. Principles

- **Arabic first, right to left.** `<html lang="ar" dir="rtl">`. The menu is on the right, the first column
  of a table is on the right, a month starts on the right. Icons that point somewhere (back, next) are
  mirrored on purpose.
- **Calm and legal.** A navy and gold palette on warm paper-white; generous spacing; serif headings. No
  decorative motion.
- **Mobile first.** Every screen is designed for a phone and then widened. Nothing may scroll sideways.
- **Honest interface.** Colour is backed by a word wherever there is room (badges, legends) and by the
  tooltip / accessible name where there is not (calendar chips); a failed save is shown as a failure, and
  simulated features are labelled «تجريبي».

## 2. Typography

| Use | Font | Where |
|---|---|---|
| Interface text | **Noto Kufi Arabic** | Body, buttons, menus |
| Headings, page titles | **Amiri** (fallback Noto Naskh Arabic) | `h1`–`h3`, `.font-heading` |
| Legal / document text | **Noto Naskh Arabic** | Briefs, document viewer, `.font-legal` |
| Numbers that must line up | **DM Mono** | File references, times, receipt numbers, amounts |

**Text size** is a user preference (Settings → المظهر والتفضيلات): small 15 px, medium 16 px, large 18 px on
the root. Everything is sized in `rem`, so the whole interface scales.

## 3. Colour

Colours are CSS variables (`src/index.css`) mapped to Tailwind names (`tailwind.config.ts`), with a
complete dark theme under `.dark`.

| Token | Light | Used for |
|---|---|---|
| `night` / `primary` | deep navy | Menu, primary buttons, headings |
| `gold` | warm gold | Accent, today, selection, focus ring, "this week" |
| `cream`, `warm-white` | off-white | Page background, text on navy |
| `alert` | brick red | Errors, conflicts, **urgent** hearings, destructive actions |
| `success` | green | Confirmations |
| `muted` | warm grey | Secondary text, "later" |

Urgency has one meaning everywhere (agenda, dashboard, lists): **red = within 48 hours · gold = within a
week · grey = later**, named in a legend, in badges, and in each calendar chip's tooltip.

## 4. Layout

| Width | Navigation | Notes |
|---|---|---|
| **Phone, tablet** (< 1024 px) | Bottom bar: الرئيسية، القضايا، المساعد، الجلسات، المزيد. «المزيد» opens a side sheet with the rest. | The bar hides while the on-screen keyboard is open. Full-screen pages (assistant, archive upload) use a menu button in the header instead. |
| **Desktop** (≥ 1024 px) | Fixed 16 rem menu on the right | Header with page title, quick search (**Ctrl + K**), notifications. |

Below 768 px lists switch from tables to stacked cards (`useIsCompact`).

### The desktop menu

Three stacked parts: a pinned header (logo), a **scrolling list** of sections, and a pinned footer
(demo-mode button, user card with sign-out).

- It is sized to the window height (`100dvh`). On windows shorter than 820 px the rows tighten (a `short:`
  Tailwind variant), so the whole menu — user card included — fits down to about 600 px tall.
- If it still does not fit, only the list scrolls: with a thin dark scrollbar that brightens on hover,
  **fading edges** where more items continue (`ScrollFade`), and the **current section scrolled into view**
  after every navigation.

## 5. Scrolling behaviour

Rules that apply everywhere:

- **Themed scrollbars.** Flat, no arrow buttons, no white track; thin inside lists, tables and dialogs, normal
  width for the page. They follow the light/dark theme.
- **No layout jump.** The page reserves its scrollbar lane (`scrollbar-gutter: stable`), so moving between a
  short page and a long one does not shift the content.
- **New page, top of page.** Navigating to another page scrolls to the top. **Back/Forward** is left to the
  browser so you return to where you were.
- **Sticky header safe.** Anchors and focused fields land below the sticky header
  (`scroll-padding-top`).
- **Nested scrollers don't trap the page.** Dialogs, sheets and menus use `overscroll-contain`; dialogs are
  limited to the visible height (`dvh`) and scroll inside.
- **Dynamic viewport units** (`dvh`) are used instead of `vh`, so phone browser bars do not cut content.

### The assistant's conversation

A chat has stricter needs than a page, so it follows its own rules
(`src/hooks/use-stick-to-bottom.ts`, used by `src/pages/Assistant.tsx`):

- **Its own scroll panel.** The page itself never scrolls on the assistant screen: the header and the message
  box stay put and only the conversation scrolls. (`AppShell`'s `fullHeight` mode must not be `flex-1`,
  otherwise the page grows with the conversation and the message box leaves the screen. A test guards this.)
- **Follows while you are at the bottom.** New text, expanding cards, the answer's action row, a taller message
  box and the on-screen keyboard all keep the latest message in view. This is driven by size changes, not by
  message updates.
- **Lets go when you scroll up.** The direction of your scrolling is what counts, so a small scroll up during
  streaming is respected. Content arriving meanwhile shows a gold **رد جديد** button; scrolling back to the
  bottom, or the button, resumes following.
- **Always goes to the latest on your actions.** Sending a message, or opening another conversation, jumps to
  the bottom. Short hops glide; long jumps are instant (and everything is instant with reduced motion).

## 6. The month calendar (الجلسات)

`src/components/hearings/MonthCalendar.tsx`, used by `src/pages/Agenda.tsx`.

- **Grid:** a real `<table>` (Sunday first, weekday headers) so screen readers announce day and column.
  Every month shows complete rows; days outside the month are blank cells.
- **Hearing chips:** `0842 — 09:00` — the end of the file reference and the time, coloured by urgency. The
  chip is a link to the file; its tooltip and accessible name carry the type, client, time and full
  reference. A day shows up to three chips, then "+N أخرى".
- **Adaptive chips:** when a day cell is wide enough the chip is one line with the dash; in a narrow
  calendar it stacks reference over time (a CSS container query reacts to the cell, not the window).
- **Day selection:** the whole cell is a button (a stretched button under the chips). A selected day has a
  gold ring and filters the list on the side. Today is a filled gold disc.
- **Navigation:** previous / next month, **اليوم** appears when you are on another month. The page requests
  hearings for the visible month as well as the default window (90 days back, one year ahead).
- **Layout:** the calendar takes the main column; the upcoming-hearings list and reminder settings sit
  beside it on the left (below it on narrower screens). Selecting a day on a stacked layout scrolls the list
  into view.
- **Phones:** the grid shows one dot per hearing; the page also offers a week strip.

## 7. Accessibility

- **Touch targets** are at least 44 px on touch devices (a `coarse:` Tailwind variant raises buttons,
  menu rows and badges).
- **Keyboard:** everything is reachable; focus shows a gold ring. A "skip to content" link
  (**الانتقال إلى المحتوى**) is the first tab stop.
- **Names:** icon-only buttons have Arabic `aria-label`s; dialogs have titles and descriptions; lists and
  calendars have labelled regions.
- **Motion:** animations are short and are disabled when the system asks for reduced motion.
- **Contrast:** text and status colours are defined for both themes; urgency is also given as text (badges,
  legend, chip tooltips and accessible names).
- **Zoom / large text:** layouts use `rem` units and are built to wrap rather than truncate.

## 8. Printing

Receipts, documents and briefs print cleanly: an A4 page, margins, white background; the menu, header and
buttons are hidden (`.no-print`), and print-only blocks are shown (`.print-only`).

## 9. Where things are

```
src/index.css                     design tokens, fonts, scrollbars, shared component classes
tailwind.config.ts                colour names, `short:` and `coarse:` variants
src/components/ui/                base components (Radix-based): button, dialog, sheet, select, tabs, table…
src/components/shared/            MetricCard, StatusBadge, EmptyState, PageHeader, ScrollFade, ConfirmDialog…
src/components/layout/            AppShell (header + page frame), Sidebar, BottomNav, MobileNavigation, nav-items
src/components/hearings/          MonthCalendar, HearingDialog, HearingActions
src/pages/                        one file per screen
src/lib/theme.ts                  light/dark and text-size preferences
```

**Adding a screen:** wrap it in `AppShell` (title, subtitle, optional actions), use `Card` /
`MetricCard` / `StatusBadge` for content, keep touch targets at 44 px, and add it to `nav-items.ts` and the
routes in `src/App.tsx`.
