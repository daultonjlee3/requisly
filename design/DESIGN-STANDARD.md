# Requisly — Design Standard

**Direction: "Manifest & Stamp."** Requisly is a working tool for people who run real purchasing — not a marketing dashboard. The visual language borrows from shipping manifests and purchasing ledgers: ink on paper, stamped confirmations, mono type for data that needs to line up. Every design decision should serve legibility and speed for someone doing this daily, not novelty.

Reference implementation: see the attached HTML prototypes (`index.html`, `purchase-orders.html`, `po-detail.html`, `create-po.html`, `receive.html`, `suppliers.html`, `supplier-detail.html`, `onboarding.html`, `empty-workspace.html`, `supplier-link.html`) and `assets/styles.css`. Treat the CSS custom properties there as the literal source of truth — this doc explains *why* they're set that way and how to extend them consistently.

---

## 1. Color

Two palettes: **ink & paper** (structure, chrome, text) and **status hues** (the timeline states). Don't introduce new colors outside these without a stated reason — the whole point is that color means something specific in this product.

### Ink & paper

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#14182B` | Primary text, sidebar background, headings |
| `--ink-soft` | `#2B3050` | Reserved for secondary dark surfaces |
| `--ink-faint` | `#565C7A` | Secondary text, labels, muted metadata |
| `--paper` | `#F1F2F6` | App background (cool grey, not warm cream) |
| `--paper-raised` | `#FFFFFF` | Cards, inputs, anything "lifted" off the page |
| `--paper-sunk` | `#E6E8EF` | Recessed surfaces — disabled fills, subtle badges |
| `--line` | `#DCDFE8` | Default hairline borders, table dividers |
| `--line-strong` | `#C4C9D6` | Input borders, dashed states, stronger dividers |

### Accent — "stamp ink"

| Token | Hex | Use |
|---|---|---|
| `--accent` | `#3644E8` | Primary actions, active nav, links, focus rings |
| `--accent-ink` | `#2530B8` | Hover/pressed state of accent |
| `--accent-wash` | `#EAECFD` | Accent-tinted backgrounds (selection, highlight cards) |

This indigo is the one saturated color allowed to mean "primary" or "brand." It does not get reused for status.

### Status hues (timeline states)

Each status has a solid tone (text/icons) and a wash (background). Never invent a new status color inline — extend this table instead.

| State(s) | Solid | Wash | Meaning |
|---|---|---|---|
| Created / neutral / draft | `--status-idle` `#8B90A3` | `--status-idle-wash` `#EEEFF3` | Nothing has happened yet |
| Sent / Viewed | `--status-sent` `#2F6FE0` | `--status-sent-wash` `#E9F0FD` | Ball is in the supplier's court |
| Confirmed / Ready to receive | `--status-confirmed` `#1F9D63` | `--status-confirmed-wash` `#E7F7EF` | Supplier or system confirmed something good |
| Production / In Transit | `--status-transit` `#C9862B` | `--status-transit-wash` `#FBF0E1` | In motion, not yet in your hands |
| Received / Closed | `--status-received` `#3644E8` | `--status-received-wash` `#EAECFD` | Complete — reuses accent, the "done" color |
| Overdue / alert / damaged | `--status-alert` `#D14848` | `--status-alert-wash` `#FBEAEA` | Needs a human to look at it now |

**Rule of thumb:** solid color on wash background for chips and dots, never solid-on-solid except for primary buttons.

---

## 2. Typography

Three type families, each with one job. Never substitute one for another's role.

| Role | Family | Where |
|---|---|---|
| Display | **Space Grotesk** (500/600/700) | `h1`–`h3`, card headers, nav brand, the "stamp" badge |
| Body | **Inter** (400/500/600) | All running text, table cells, buttons, form inputs, nav items |
| Data / mono | **IBM Plex Mono** (400/500/600) | PO numbers, currency, dates in tables, tracking numbers, SKUs |

Loaded via Google Fonts:
```
Space Grotesk: wght 400;500;600;700
Inter: wght 400;500;600;700
IBM Plex Mono: wght 400;500;600
```

**Why mono matters here:** this is a numbers-and-codes product. PO numbers, costs, and quantities should visually read as *data* — fixed-width, right-aligned in tables — distinct from the prose around them. `.po-number` and `.mono` are load-bearing classes; use them anywhere a PO #, SKU, cost, tracking number, or timestamp appears in a table or list.

### Scale (as implemented)

| Use | Size | Weight | Family |
|---|---|---|---|
| Page title (`h1`) | 19px | 600 | Display, letter-spacing -0.01em |
| Card header (`h3`) | 14.5px | 600 | Display |
| Body / table cells | 13.5–14px | 400–500 | Body |
| Small / metadata | 12–12.5px | 400–500 | Body |
| Nav label (section eyebrow) | 10.5px | 600, uppercase, 0.08em tracking | Body |
| Chip / status text | 11.5px | 600 | Body |
| Mono data | 11–13px | 400–600 | Mono |

Base body size is 14px at 1.5 line-height. Don't go below 11px anywhere — this is a work tool used all day, not a marketing page.

---

## 3. Layout

- **Shell:** fixed 232px dark sidebar (`--ink` background) + fluid content area. Sidebar is `position: sticky; top: 0; height: 100vh`.
- **Topbar:** sticky, white, border-bottom `--line`, page title + primary action, 16px/32px padding.
- **Content:** 28px top, 32px sides, 60px bottom padding.
- **Cards:** white, 1px `--line` border, 8px radius, `--shadow-sm`. Card header and body are visually separated by a hairline, not spacing alone.
- **Radius:** 4px (`--radius-sm`) for buttons, inputs, chips-that-aren't-pills; 8px (`--radius-md`) for cards.
- **Shadows:** `--shadow-sm` for resting cards, `--shadow-md` for hover/raised, `--shadow-lg` only for modals and the supplier-link/onboarding standalone pages that float on a dark backdrop.
- **Two-column detail pattern:** primary content `1fr`, right rail fixed `300–320px`, gap 20px. Used on PO Detail, Receive, Supplier Detail, Create PO.

---

## 4. The Timeline — signature component

This is the one element the product should be recognized by. It is **not** a progress bar or a status badge — it's a horizontal strip of connected nodes, each representing a real state in the golden workflow (`Created → Sent → Viewed → Confirmed → Production → Shipped → In Transit → Partially Received → Received → Closed`).

Rules:
- **Done** steps: filled accent circle with a checkmark, connecting track behind them turned accent-colored.
- **Current** step: hollow circle with an accent ring/glow (`box-shadow: 0 0 0 4px var(--accent-wash)`) and a solid accent dot inside — it's "in progress," not "done."
- **Future** steps: hollow grey circle, grey track, grey label.
- **Skippable** steps (Production, In Transit — per the product spec, a merchant can skip these if their supplier doesn't report at that granularity): dashed circle border, 50% opacity, rather than disappearing entirely. The state should still be visible as "not tracked" rather than removed from the timeline — removing it would misrepresent the workflow.
- Every node carries a label and a mono-set date (or `—` if not yet reached).
- Horizontally scrollable on narrow viewports rather than wrapping — the sequence should never break across lines.

This component belongs on every PO Detail screen, full width, near the top. Don't shrink it into a sidebar widget.

---

## 5. Components

### Buttons
- `.btn-primary`: accent fill, white text — one per view for the single most important action.
- `.btn-secondary`: white fill, `--line-strong` border — default for everything else.
- `.btn-ghost`: transparent, `--ink-faint` text, fills `--paper-sunk` on hover — for low-emphasis inline actions (View, Duplicate icon-only, etc).
- `.btn-sm`: tighter padding for in-table or in-row actions.
- All buttons: 600 weight, 13px, 4px radius, 6px icon-to-label gap.

### Chips (status pills)
Pill-shaped (20px radius), 3px/9px padding, a 6px colored dot + label, always wash-background/solid-text pairing from the status table above. Used for PO status, supplier link engagement, anything binary-ish.

### Stamp badge
Reserved for a small set of *moments*, not routine status — currently used once, for "Confirmed" on PO Detail. Bordered (not filled), `currentColor` border matching text color, slight `-2deg` rotation, uppercase Display type. This is deliberately rare — if it starts appearing more than once or twice per screen, it's being overused and should revert to a chip.

### Tables
Uppercase 11px letter-spaced headers in `--ink-faint`, hairline row dividers, no zebra striping, no vertical borders. Rows that navigate somewhere get `.row-link` (pointer cursor + `--paper` hover fill) — reserve this for rows that go to a detail view, not for rows with inline actions only.

### Forms
Single `.field` style for all inputs/selects/textareas: 1px `--line-strong` border, 4px radius, white fill. Focus state is always accent border + `0 0 0 3px var(--accent-wash)` — no other focus treatment anywhere in the product. Labels are 12px/600/`--ink-faint`, always above the field, never inline or floating.

### Avatars
Circle (people) or rounded-square (suppliers/brand mark), initials in Display 700, background = a wash color, text = the matching solid. Same pattern whether it's a person, a supplier, or the app's own brand mark — one visual language for "an entity, abbreviated to initials."

---

## 6. Voice, in the UI

Match the docx skill / product philosophy: name things by what people control, active voice, no filler. A few concrete patterns already in use:

- Buttons say the action and its object: "Mark Shipped," "Complete this receipt," "Send to supplier," never "Submit" or "Confirm."
- Empty states explain what's missing and offer the one next action — see `empty-workspace.html`'s checklist pattern (connect store → add supplier → send first PO) rather than a generic "No data."
- Metadata is always relative and human: "20 min ago," "Sent 4 days ago," not raw timestamps, except in mono-set table columns where exact dates belong.
- Errors/reason codes (Receiving) are plain nouns — "Damaged," "Wrong item," "Backorder" — not system-speak.

---

## 7. What Cursor should NOT do

- Don't swap in a different accent color per feature area — one accent, everywhere.
- Don't introduce a second display typeface or a second monospace face.
- Don't turn the timeline into a generic linear progress bar — the node-and-label pattern is the point.
- Don't add drop shadows or gradients beyond the three defined shadow tokens — flat surfaces, hairline borders do the separating.
- Don't use the emoji/unicode glyphs in the prototype (📦 ✚ ▤ etc.) as final icons — they're placeholders. Swap in a proper icon set (e.g. Lucide, since it's already available in this stack) at matching stroke weight, sized to the same 16px nav / 20px inline slots.
- Don't round corners beyond 8px anywhere, or use fully circular buttons/cards — the only full circles in the system are avatars and timeline nodes.
