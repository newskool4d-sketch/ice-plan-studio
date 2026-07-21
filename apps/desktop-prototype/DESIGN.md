# ICE Plan Studio Design System

## 1. Atmosphere & Identity

ICE Plan Studio is a calm administrative document workbench. Its signature is a paper-first review surface: a restrained navy-and-green application frame makes the real A4 composition legible without competing with it.

## 2. Color

### Palette

| Role | Token | Value | Usage |
|---|---|---|---|
| Application background | `--app-background` | `#dfe4e8` | Canvas and workspace surround |
| Surface | `--surface` | `#ffffff` | Panels and controls |
| Paper | `--paper` | `#fffdf9` | A4 composition preview |
| Ink | `--ink` | `#17202b` | Primary text |
| Muted | `--muted` | `#657382` | Metadata and secondary controls |
| Line | `--line` | `#d6dce0` | Structural boundaries |
| Navy | `--navy` | `#12263c` | Application identity and status bar |
| Accent | `--green` | `#168866` | Selection, progress, primary action |
| Accent dark | `--green-dark` | `#116b51` | Active and hover states |
| Error | `--danger` | `#c93636` | Rule failures |
| Warning | `--warning` | `#b96810` | Incomplete checks |

### Rules

- Green communicates an actionable or selected document state; it is never decorative.
- The document surface uses the paper token and neutral document ink, distinct from application chrome.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
|---|---:|---:|---:|---|
| App title | 15px | 700 | 1.4 | Product identity |
| Panel title | 19px | 700 | 1.3 | Inspector heading |
| Document H1 | 24px | 700 | 1.35 | Preview document title |
| Document H2 | 13px | 700 | 1.45 | Preview section heading |
| Body | 12px | 400 | 1.6 | Application copy |
| Document body | 10.5px | 400 | 1.6 | Preview text |
| Caption | 10px | 500 | 1.4 | Metadata and labels |

- Primary stack: `Malgun Gothic`, `Noto Sans KR`, `Pretendard`, system UI, sans-serif.
- Document typography is derived from `scripts/layout-tokens.json`; this design file governs the application shell only.

## 4. Spacing & Layout

All application spacing uses a 4px base. The app shell is a 56px top bar, 30px status bar, workflow rail, page rail, composition stage, and inspector. The A4 preview keeps its physical 210:297 aspect ratio and a bounded paper width.

## 5. Components

### Workflow step

- Structure: button, numbered state mark, label, detail.
- States: current, complete, available, focus-visible.
- Accessibility: native button and visible focus ring.

### Page thumbnail

- Structure: button, scaled composition paper, page caption, optional rule count.
- States: selected, default, empty.
- Accessibility: native button with current-page state.

### Composition page

- Structure: semantic article, document header, typed blocks, page number.
- Variants: cover, inner-cover, preflight, toc, summary, body, task, schedule, appendix.
- Source: typed Plan IR plus `scripts/layout-tokens.json`.

### Rule finding

- Structure: severity label, code, title, message.
- States: error, warning, empty.

## 6. Motion & Interaction

- Selection and zoom transitions use 180ms ease-out and respect reduced-motion settings.
- Buttons expose hover, active, disabled, and focus-visible states; no decorative motion is used.

## 7. Depth & Surface

Mixed depth strategy: panel separation uses one-pixel structural lines; the composition page uses the existing soft shadow to establish physical paper above the canvas.

## 8. Accessibility Constraints & Accepted Debt

- Target: WCAG 2.2 AA. All controls are keyboard reachable, use visible focus, and honor reduced motion.
- Long document content must wrap without creating primary horizontal overflow.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Pixel-identical Hancom rendering | Real-composition preview | Browser typography cannot be the Hancom renderer; structural and numeric equivalence is automatic, with HWPX output retained as the authoritative export. | Stage 6 corpus rendering review |
