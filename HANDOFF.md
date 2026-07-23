# CalmFeed — Handoff (2026-07-24)

Continue work from this file. Repo is live and pushed.

---

## What this is

**CalmFeed** — open-source browser extension (Chrome/Edge, Manifest V3) that makes X less miserable for builders.

- Filters hostile / doomscroll-y posts with **Gemini Embedding 2**
- Timed sessions that block X when time is up
- **No backend** — key + settings in `chrome.storage.local`, text/media go straight to Google
- **MIT** license

**Positioning (launch tweet draft):**

> I’m building an open-source browser extension that makes X less miserable to use.  
> For builders that want to use X but want to avoid doomscrolling and toxicity but want to still connect with people and stay informed.  
> Coming soon............................................... :P

---

## Repo & paths

| Item | Value |
|------|--------|
| Local path | `C:\Users\vstal\calmfeed` |
| GitHub | https://github.com/vstalingrady/CalmFeed |
| Remote | `git@github.com:vstalingrady/CalmFeed.git` |
| Branch | `main` |
| Owner | `vstalingrady` |
| License | MIT (`LICENSE`) |
| Current version | **0.5.6** (`manifest.json`) |

**Do not load the extension from** `Downloads\calm-x-v0.5-extract\` — always load unpacked from `C:\Users\vstal\calmfeed`.

### Edge install / reload

1. `edge://extensions` → Developer mode
2. **Load unpacked** → `C:\Users\vstal\calmfeed`
3. After code changes: **Reload** extension
4. **Close all X tabs**, open a fresh `https://x.com` (content scripts do not update until page reload)
5. Popup footer should show **v0.5.6**

### Gemini key

- Free: https://aistudio.google.com/apikey
- Stored only in browser; guide is in the popup

---

## Architecture (no build step)

Plain MV3 JS/CSS. No bundler, no npm, no TypeScript.

```
calmfeed/
  manifest.json       # MV3, permissions, icons, web_accessible_resources (fonts)
  background.js       # Service worker: Gemini embeddings, session alarms, classifyBatch
  content.js          # DOM scan, hide/show cards, decision cache, scroll anchor, style inject
  content.css         # Fallback styles (primary styles also injected from content.js)
  popup.html/js/css   # Settings UI
  fonts/              # Fraunces + Bricolage Grotesque (woff2)
  icons/              # PNG + SVG logo
  PRIVACY.md
  README.md
  LICENSE
  HANDOFF.md          # this file
```

### Data flow

1. User pastes Gemini API key → `saveSettings` embeds prototype vectors → stored in `chrome.storage.local`
2. User **Start session** → alarm + `sessionEndsAt`
3. On x.com, `content.js` finds `article[data-testid="tweet"]`
4. Uncached posts: height-stable **pending** overlay → batch classify via background
5. Background: text embeddings first; media only if uncertain (compressed images / video frames, not full video)
6. Result: show tweet or collapse to “Post hidden” shell
7. Timer ends → full-screen session overlay

### Permissions

- `storage`, `alarms`, `tabs`
- Hosts: `x.com`, `twitter.com`, `pbs.twimg.com`, `generativelanguage.googleapis.com`

### Model

- `gemini-embedding-2`, 768 dims
- Sensitivity thresholds: gentle / balanced / strict (see `getThreshold` in `background.js`)

---

## What we did this session (chronological)

### 1. Bootstrap open source repo
- Unpacked original zip `calm-x-v0.5-hd-low-bitrate.zip` → source
- Copied into `C:\Users\vstal\calmfeed`
- Rebranded **Calm X → CalmFeed**
- `git init`, public GitHub repo, MIT, topics, pushed `main`

### 2. Popup UX
- Brand: **CalmFeed** only (removed “Use X. Then leave.” / CALMFEED FOR X)
- Gemini API key guide (collapsible + “Get free key” link)
- Rounded panels, system-then niche fonts
- Version stamp in fine print (`v0.5.x`)

### 3. Typography
- Bundled **Fraunces** (display) + **Bricolage Grotesque** (UI) as local woff2
- `@font-face` in popup; content fonts via `chrome.runtime.getURL` + `web_accessible_resources`

### 4. Icon
- AI-generated vector-style bird/wave mark, transparent background
- `icons/icon-16|32|48|128.png`, `icon.png`, `logo.png`, `icon.svg`
- Wired in `manifest.json` `icons` + `action.default_icon`
- README shows logo

### 5. Design taste pass
- Editorial warm paper → then **Cursor/Grok-like warm stone gray**
  - bg `#f3f2f0`, surface `#fafafa`, ink `#141413`, muted `#73736e`, line `#e4e3e0`
- On-page hide cards, timer, session end match palette
- Dark `prefers-color-scheme` variants for feed chrome

### 6. Hide cards reliability
- Old cream/serif cards were X CSS + stale content scripts
- Force paint: **inline styles on cards** + **full CSS injected from `content.js`**
- Structure: mark “C”, kicker “CalmFeed”, title, note, optional “Show anyway”
- User must hard-refresh X after extension reload (popup updates without it)

### 7. Scroll thrash / no-cache bug (v0.5.6) — important
**Symptom:** Scrolling up fast yanked the feed down; posts re-checked constantly.

**Cause:**
- X virtualizes tweets (destroy/remount DOM)
- Every remount did “Checking post” and **collapsed** tall tweets to short cards
- Height change → scroll jump → X infinite-scroll thought you were near bottom → loaded more → worse thrash
- Service worker in-memory cache didn’t prevent the pending UI flash

**Fix:**
- **Decision cache by postId** in content script + `sessionStorage` (`calmfeed-decisions-v1`)
- Remounts reapply hide/show **instantly** (no re-classify, no checking flash)
- **Pending is height-stable** (absolute overlay; visibility hidden on children — not `display:none`)
- **Scroll anchoring** when height changes above the viewport (`withScrollAnchor`)
- Smaller IO `rootMargin` (480px, was 1200px)
- Background cache key prefers `id:${postId}`

---

## Key code anchors

| Concern | Where |
|---------|--------|
| Classify + Gemini | `background.js` — `classifyPosts`, `embedTextBatch`, `embedPost` |
| Session timer | `background.js` alarms + `content.js` `runTimer` / overlay |
| Tweet observe / queue | `content.js` — `observe`, `enqueue`, `flushBatches` |
| Decision cache | `content.js` — `decisionCache`, `rememberDecision`, `loadDecisionCache` |
| Scroll stability | `content.js` — `withScrollAnchor`, pending CSS (absolute overlay) |
| Popup settings | `popup.js` + `popup.html` |
| Prototypes (neg/safe) | `background.js` `PROTOTYPES` |

### Content states on `article`

- `data-calm-x-state="pending"` — checking (overlay, keep height)
- `data-calm-x-state="hidden"` — collapsed shell
- `data-calm-x-state="shown"` — normal tweet
- `data-calm-x-queued="true"` — already queued or decided

### Console verify

On x.com after reload:

```text
[CalmFeed] content script v0.5.6 active — decision cache N
```

---

## Git history (main)

```
c4bc9d9 fix: stop scroll thrash with decision cache and stable pending
0cbe354 fix: force feed card styles via inline + injected CSS
593f698 style: warm stone gray palette like Cursor and Grok
384b6de fix: harden on-page hide cards against X styles
edf6a10 style: editorial CalmFeed UI with bundled niche type
d1bdad8 feat: polish CalmFeed UI and ship extension icon
0fad2ae feat: open-source CalmFeed for X v0.5
```

---

## Known limitations / open risks

1. **Classification mistakes** — intentional fail-open (show post on error)
2. **X DOM can break selectors** — relies on `article[data-testid="tweet"]`, `tweetText`, status links
3. **Service worker sleep** — in-memory Gemini cache clears; content `sessionStorage` survives tab session
4. **Video frame capture** may fail (CORS / readyState) — falls back to poster/text
5. **Session end** blocks all of X until new session
6. **Two style sources** — `content.css` (manifest) + injected styles in `content.js`; keep them in sync or drop file CSS later
7. **Duplicate extensions** — if both Downloads extract and `calmfeed` are loaded, chaos
8. **Dark X theme** — hide cards use `prefers-color-scheme`; may not match X’s own theme toggle perfectly
9. Not on Chrome Web Store / Edge Add-ons yet (sideload only)

---

## Product / design preferences (user)

- Audience: **builders** on X
- UI: **not** generic Inter/Segoe; niche fonts (Fraunces + Bricolage)
- Colors: **warm stone gray** like cursor.com / grok.com — not cream/beige paper
- Rounded corners, clean product UI
- Open source, MIT, no CalmFeed servers
- Popup brand name: **CalmFeed** only

---

## Sensible next steps (for Cursor)

Pick as needed; not ordered as a mandate.

### Reliability
- [ ] Persist decision cache beyond tab (`chrome.storage.session` or local with TTL)
- [ ] Cap concurrent classifications / backoff when Gemini rate-limits
- [ ] Soft-nav / SPA route changes on X (re-scan without full reload)
- [ ] Unit tests for cache key + scroll delta math (optional tiny node harness)

### UX
- [ ] Settings: “re-check” / clear cache button
- [ ] Per-account mute vs global filter
- [ ] Smoother pending (shimmer) without height change
- [ ] Match X dark theme more accurately (detect X dark classes, not only OS)

### Ship
- [ ] Store icons all sizes verified; screenshots for Edge/Chrome listing
- [ ] Privacy policy page URL for store
- [ ] Landing page + launch tweet with repo link
- [ ] GitHub release + zip of unpacked extension for non-git users
- [ ] CONTRIBUTING.md / issue templates

### Cleanup
- [ ] Remove redundant `content.css` if injection is sole source of truth
- [ ] Rename residual `calm-x-*` class names → `calmfeed-*` (careful: CSS + JS)
- [ ] Stop logging version every load if noisy

---

## Commands cheat sheet

```powershell
cd C:\Users\vstal\calmfeed
git status
git pull
git add -A
git commit -m "type: message"
git push origin main
```

Reload extension after every content/background change; hard-refresh or re-open X.

---

## Privacy summary (for store / users)

- No CalmFeed backend, accounts, analytics, or DB
- Local: API key, minutes, sensitivity, prototype vectors, session end
- Gemini may receive post text and compressed media when needed
- Full videos never uploaded
- See `PRIVACY.md`

---

## Handoff complete

**Working tree should be clean on `main` @ `0.5.6` after last push.**

If continuing in Cursor:

1. Open `C:\Users\vstal\calmfeed`
2. Read this file + `README.md`
3. Reload extension + fresh X tab before testing scroll/filter
4. Prefer small commits; keep MIT; no secrets in repo

Good luck shipping CalmFeed.
