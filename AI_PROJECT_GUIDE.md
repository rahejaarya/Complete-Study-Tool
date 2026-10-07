# Complete Study Tool — Project Guide for AI Assistants

This document is a code-grounded guide to the current repository. Treat the source
code as authoritative if it disagrees with this guide. The site is an evolving
student study-support web app, not a finished product specification. Confirm
current behavior in the relevant route, template, stylesheet, or JavaScript
before changing it.

## 1. Product summary

The Complete Study Tool is a Flask web app for students. It combines:

- A signed-in dashboard with links to study resources, the AI helper, sounds,
  time management, student support, and an account/theme settings page.
- “Sammy,” a conversational study assistant with saved conversations, streaming
  responses, local Ollama inference, web search, and limited study-related
  user memory.
- A resource-search page that combines optional web results with resource cards.
- A weekly calendar and configurable study timer.
- A browser-generated sound mixer.
- Wellbeing, focus, and peer-boundary guidance.
- A dashboard notebook card with quick notes and multiple named notebooks.

The app uses server-rendered Jinja templates and normal navigation between
pages. Small features use JavaScript and JSON APIs; there is no frontend
framework or client-side router.

## 1.1 Is this only a wireframe, or does it have a backend?

It is **both a frontend and a backend**. It is not only a static wireframe:

- **Frontend:** the HTML/Jinja templates provide page structure and controls;
  `static/style.css` provides styling and responsive layouts; JavaScript files
  and inline page scripts respond to user actions.
- **Backend:** `app.py` runs a Flask server, renders pages, signs users in,
  validates requests, serves JSON APIs, calls AI/search helpers, and reads or
  writes account data.
- **Persistence:** SQLite holds accounts and compatibility preference fields;
  JSON files hold active settings, schedule data, notebooks, conversations, and
  AI memory. Some small preferences are only in browser `localStorage`.

Some parts are complete interactions connected to server persistence, some are
working client-side but reset when the page/session ends, and some are still
presentation-only. In particular, schedule events, theme selection, notebooks,
and saved Sammy chats have backend persistence. The sound mixer and timer run in
the browser. Some resource-category cards, AI tool cards, and support-topic
cards are informational placeholders and are not complete workflows.

## 1.2 Project directory and file inventory

This inventory covers the app's source, tests, configuration, and known runtime
storage locations. It does **not** enumerate the individual contents of
installed dependency directories (`node_modules`, `venv`, `.venv`), Python
bytecode caches (`__pycache__`), or user-data file contents. Those are not
application source files.

```text
complete-study-tool/
├── app.py
├── requirements.txt
├── AUTH_SETUP.md
├── AI_PROJECT_GUIDE.md
├── .gitignore
├── .DS_Store                         # macOS folder metadata; not app logic
├── .vscode/
│   └── settings.json                 # workspace/editor configuration
├── templates/
│   ├── _ai_nav.html                  # shared AI/chat navigation snippet
│   ├── _appearance_settings.html     # theme picker snippet
│   ├── ai.html                       # AI chat page and browser-side chat logic
│   ├── index.html                    # dashboard, search shell, quote/deadline UI
│   ├── login.html                    # sign-in form
│   ├── noise_songs.html              # sound studio page
│   ├── peerPreshAndBoundaries.html   # peer-pressure guidance page
│   ├── procrastination_focus.html    # focus guidance page
│   ├── resources.html                # resource search and category page
│   ├── settings.html                 # account + appearance settings page
│   ├── signup.html                   # account creation form
│   ├── support.html                  # support resources page
│   └── time_management.html          # calendar and timer page
├── static/
│   ├── ai.py                         # model/search prompts and helpers
│   ├── ai_chats.js                   # shared saved-chat dropdown/actions
│   ├── appearance.js                 # theme preview/apply behavior
│   ├── dashboard_notebooks.js        # dashboard notebook UI and API client
│   ├── global_search.js              # dashboard page/feature search overlay
│   ├── noise.js                      # sound generation, controls, mixes
│   ├── style.css                     # palettes, layout, components, breakpoints
│   ├── theme.js                      # early theme application/account sync
│   └── SaveData/                     # per-account JSON/chat data; private runtime data
├── tests/
│   ├── test_ai.py                    # AI, persistence, route, chat, schedule tests
│   └── test_auth.py                  # login/signup and route tests
├── studytool.db                      # local SQLite database and account records
├── saveData/                         # legacy/runtime data directory; verify use
├── __pycache__/                      # generated Python bytecode
├── static/__pycache__/               # generated Python bytecode
├── venv/                             # Python virtual environment, if present
├── .venv/                            # alternate Python virtual environment, if present
└── node_modules/                     # installed Node dependencies, if present
```

`venv/`, `.venv/`, `node_modules/`, `__pycache__/`, `.DS_Store`, `studytool.db`,
`static/SaveData/`, and `saveData/` are not source-code modules. Runtime storage
folders and local databases may contain real account data; do not inspect or
share their contents as part of unrelated coding work. `data/resources.json` is
looked up by the app but is not present in the project inventory at the time of
this guide.

The main code-file responsibilities are described in the source map below.
This list is the source-focused inventory, not a list of every installed
third-party package inside the dependency directories.

## 2. Instructions for an AI working on this repository

1. Inspect the current source and `git status` before editing. This worktree may
   contain unrelated user changes and user data; preserve them.
2. Make focused changes in the existing Flask/Jinja/CSS/vanilla-JS patterns.
   Do not introduce a framework or dependency for a small feature.
3. Keep the desktop sidebar, compact mobile bottom navigation, theme variables,
   accessibility labels, and current user-scoped persistence behavior consistent
   across every affected page.
4. A visible card is not necessarily a working feature. Check for an actual
   destination, event handler, API, and persistence before claiming it works.
5. Do not treat the built-in demo account or development `SECRET_KEY` as safe
   production credentials. Consult `AUTH_SETUP.md` for local/deployment setup.
6. Prefer runtime/API tests for behavior changes, syntax checks for scripts, and
   `git diff --check`. The repository currently has Python `unittest` tests under
   `tests/`; no JavaScript test runner or package manifest was found.
7. Never read, publish, overwrite, or commit user-specific files under
   `static/SaveData/` or the local `studytool.db` unless the task explicitly
   requires it. These contain account data.
8. Report unfinished work and error cases honestly; do not describe an
   informational placeholder as implemented functionality.

## 3. Technology and startup

- Backend: Python, Flask, Jinja, SQLite, filesystem JSON persistence.
- Frontend: HTML templates, one shared CSS file, plain JavaScript.
- AI inference: the `ollama` Python package calls model `qwen3.5:2b` from
  `static/ai.py`; Ollama must be available separately at runtime with that model
  installed. The requirements file installs the Python client, not the model
  server/model.
- Web discovery: `ddgs` is used for text/video search. `requests` is also in
  `requirements.txt`.
- The app initializes its SQLite schema on import and starts on `PORT`, default
  `8000`, when run directly with `python app.py`.
- `AUTH_SETUP.md` documents installation and the development account warning.
- There is no project README, JS package manifest, or `data/` resource catalog
  in the current tracked project file inventory. `app.py` looks for
  `data/resources.json`; if it is absent, the local catalog is empty.

## 4. Source map

| Path | Responsibility |
|---|---|
| `app.py` | Flask configuration, authentication, database initialization, file persistence, API endpoints, and page routes. |
| `templates/` | Jinja page markup; most pages duplicate their own sidebar, top bar, and mobile navigation. |
| `templates/_ai_nav.html` | Shared Sammy navigation row and saved-chat dropdown markup. |
| `templates/_appearance_settings.html` | Light/dark theme chooser and apply control included by Settings. |
| `static/style.css` | Theme palettes, shared layout, cards, responsive rules, and page-specific styles. |
| `static/theme.js` | Applies cached theme immediately, loads/saves the signed-in account theme, migrates legacy theme names. |
| `static/appearance.js` | Theme selection preview and Apply button behavior. |
| `static/ai.py` | AI prompt, conversational short-circuits, search decision/query helpers, Ollama calls, memory update, resource search. |
| `static/ai_chats.js` | Shared Sammy conversation dropdown, chat list, and rename/delete dialogs. |
| `static/global_search.js` | Dashboard search overlay; indexes same-origin pages and interactive features. |
| `static/dashboard_notebooks.js` | Loads, renders, opens, adds, renames, and autosaves dashboard notebooks. |
| `static/noise.js` | Audio generation/playback, per-sound and master volume, activity recommendations. |
| `templates/time_management.html` | Calendar/timer markup and most calendar/timer JavaScript (large inline script). |
| `templates/ai.html` | Sammy UI, message renderer, streaming client, chat loading/management wiring (large inline script). |
| `templates/index.html` | Dashboard, global-search shell, deadline display, notebook card, quote slideshow. |
| `tests/test_auth.py` | Authentication and selected route/page behavior tests. |
| `tests/test_ai.py` | AI helpers, persistence, schedule/theme, chat, and selected rendered-page behavior tests. |
| `studytool.db` | Local SQLite database; runtime data, do not treat as source or commit new user data. |
| `static/SaveData/<username>/` | Runtime per-user JSON and AI chat files; contains private user data. |

## 5. Page routes and purpose

All routes below require a signed-in session except `/login`, `/signup`, and
`/logout`. The APIs also use the login guard.

| URL | Flask endpoint | Current behavior |
|---|---|---|
| `/` | `home` | Dashboard; injects username and a list of page routes for global search. |
| `/login` | `login` | Username/password form; checks password hashes stored in SQLite. |
| `/signup` | `signup` | Creates a username/password account, logs it in, and redirects. |
| `/logout` | `logout` | Clears session and redirects to login. |
| `/resources` | `resources` | Filters the optional local catalog; for a non-empty query also calls web search; renders results. |
| `/ai` | `ai_help` | Sammy chat interface and four AI-feature information cards. |
| `/noise-songs` | `noise_songs` | Focus activity selection and sound mixer. |
| `/time-management` | `time_management` | Timer and weekly scheduler. |
| `/schedule` | `schedule` | Redirects to `/time-management`. |
| `/timeManagement.html` | `legacy_time_management` | Permanent redirect to `/time-management`. |
| `/support` | `support` | Crisis helplines, links to guidance, and grounding exercise. |
| `/procrastination-focus` | `procrastination_focus` | Static focus/procrastination guidance and checklist-style exercises. |
| `/focus` | `focus` | Redirects to `/procrastination-focus`. |
| `/peer-pressure-boundaries` | `peer_pressure_boundaries` | Static peer-pressure and boundary-setting guidance. |
| `/settings` | `settings` | Settings page with account status/logout and appearance controls. |
| `/appearance` | `appearance` | Same Settings template as `/settings`. |
| `/notes` | `notes` | Redirects to `/#notes-card`; there is not a separate notes page. |

The mobile links and desktop links are handwritten in several templates, so
labels/icons/active states are not perfectly uniform. Check every affected
template when changing navigation.

## 6. Wireframes and behavior by page

### 6.1 Dashboard (`/`)

Desktop page frame:

```text
┌──────────────────┬────────────────────────────────────────────────────┐
│ Fixed sidebar    │ Welcome + global search + logout                    │
│ StudyTool logo   ├────────────────────────────────────────────────────┤
│ Dashboard        │ STUDY TODAY card                                    │
│ Resources        │  └─ Study Resources shortcut                        │
│ Noise & Songs    ├────────────────────────────────────────────────────┤
│ Time Management  │ QUICK START                                         │
│ Student Support  │  AI Study Help | Noise & Songs                      │
│ Sammy + chats    │  Time Management | Student Support                  │
│                  ├────────────────────────────────────────────────────┤
│ Settings         │ NOTEBOOK & NOTES              | Quote slideshow     │
│ Help             ├────────────────────────────────────────────────────┤
│                  │ Recent Activity / next upcoming schedule item       │
└──────────────────┴────────────────────────────────────────────────────┘
```

The main content column is capped at 1200px. The lower grid is currently a
notebook card beside the quote card; **My Progress is not in this row**. The
Notes card was deliberately moved into the former Progress position. Recent
Activity is below the lower grid.

- The welcome header includes the signed-in username, global-search trigger,
  and logout.
- Quick Start has four linked cards: AI Study Help, Noise & Songs, Time
  Management, Student Support.
- The notebook starts collapsed. It has a quick-note field and opens its full
  in-card notebook editor when the user types or presses the open button.
- Initial data is one notebook named “My Notebook.” Users can add and rename
  notebooks. Each notebook has a quick note and a larger plain-text body.
- Notebook API data is stored per user in
  `static/SaveData/<username>/Notebooks/notebooks.json`.
- There is no delete/reorder/page hierarchy/search/formatting function in the
  notebook editor currently.
- The quote card advances automatically every 9 seconds, can be paused/resumed,
  and supports click/keyboard to advance. The quote selection/order state is
  stored in browser `localStorage`, not the user account.
- Recent Activity is not an activity log: its current behavior is to fetch the
  saved schedule and display the next unfinished, non-rest event.
- Global search is a dashboard overlay, opened by click or `Ctrl+K`/`Cmd+K`.
  It builds an index by fetching eligible same-origin HTML pages and scanning
  headings, links, sound cards, timers, and settings. Results can be navigated
  with keyboard.

### 6.2 Study Resources (`/resources`)

Order:

1. Header: “What do you want to learn?”
2. Search form (`GET /resources?query=...`).
3. Browse by Subject chips: Math, Science, English, History, Computer Science,
   Languages.
4. Recent Searches, held in browser storage.
5. Search results and fixed category sections for Videos, Notes & Guides,
   Practice, and Other Resources.

For a typed query, the Flask route filters `data/resources.json` if present and
also asks `search_web` for live web results. The recent-search list is stored under `recent_study_searches` and retains up to
five terms in that browser. The local resource cards in the
template are mostly static descriptive cards rather than subject-specific
working destinations. The current project inventory has no `data/` catalog, so
do not assume curated local search results exist. Query-free page rendering
shows the category copy and default “Newton’s Laws” result heading.

### 6.3 Sammy / AI Study Help (`/ai`)

- Main workspace has a centered AI assistant heading, chat history area,
  prompt input, and Send button.
- The first message creates a chat ID and title based on that message. The user
  can create new chats, load saved chats, rename, and delete conversations.
- Requests stream from `/api/ai` as newline-delimited JSON events:
  `chat`, zero or more `resource`, `token`, optional `memory_error`, and `done`.
- Chat history and metadata are saved in JSON files under the user's
  `static/SaveData/<username>/chats/`.
- The last 20 role/content entries are considered for context, then bounded by
  per-entry and total-character limits; history is kept in complete pairs.
- `static/ai.py` uses `MODEL = "qwen3.5:2b"`. Simple greetings, farewells,
  thanks, and known personal questions are answered without calling Ollama.
- Request text matching can trigger search/recommendations via `ddgs`; web
  result cards are streamed separately from the answer.
- Study-related user memory is stored in a file named `memory` in the user's
  data directory. Memory update prompt limits facts and excludes sensitive
  traits, health, finances, identity attributes, and secrets.
- AI response formatting escapes HTML before translating basic headings, bold,
  italic, inline code, and bullet lists to safe display markup.
- The four “AI Features” cards (Text Summarizer, Flashcard Generator, Problem
  Solver, Practice Quizzer) are currently presentation-only cards; no working
  actions were found attached to them.
- Operational dependencies: Ollama server/model available at runtime and
  network access for web search. If search returns nothing, server code tells
  the model results were unavailable rather than treating an answer as
  web-verified.

### 6.4 Noise & Songs (`/noise-songs`)

- Hero followed by ten activity chips: learning, reviewing, coding, writing,
  reading, problem-solving, homework, creative work, memorization, break.
- “Load mix” selects recommended sounds for the current activity.
- Sound library offers 14 sounds: Brown Noise, Pink Noise, 852 Hz, Ocean Waves,
  Lo-Fi Glow, Calm Piano, Rain on Window, Acoustic Guitar & Piano, Warm Cello,
  Soft Ambient Synth, Gentle Creek, 432 Hz Solfeggio Tuning, Theta Binaural
  Beats (6 Hz), and 174 Hz Foundation Frequency.
- Web Audio API generates noise, tone, and music-loop sounds; ocean audio uses
  an external MP3 asset.
- Individual sound controls and master volume exist; Stop all stops playback.
- Playback/volume persistence across sessions was not found. Browser audio may
  require a user gesture; external audio requires network access.

### 6.5 Time Management (`/time-management`)

Landing wireframe:

```text
┌─────────────────────────────────────────────────────────────┐
│ Time Management & Schedule                                 │
├───────────────────────────────┬─────────────────────────────┤
│ Scheduler launcher            │ Study Timer launcher        │
├───────────────────────────────┴─────────────────────────────┤
│ Study rhythm guide (expandable details)                     │
└─────────────────────────────────────────────────────────────┘
```

Selecting one launcher expands that tool in the top panel and hides the other;
Close returns to the landing state.

**Scheduler**

- Week starts Monday and displays Monday–Sunday with date labels. The current
  date is highlighted; previous/next week and Today controls navigate.
- The visible calendar is a 24-hour weekly grid, midnight-to-midnight, with
  hour labels, event blocks, and a current-time indicator.
- Selecting a time/grid cell opens an event editor. Existing events can be
  edited/deleted. The editor includes title, type, date, start, and end time.
- Types allowed by the backend: `to-do`, `homework`, `event`, `exam`, `rest`;
  the UI presents `exam` as “Quiz/Exam.”
- Event data is read/written through `/api/preferences/schedule` and saved
  per-user in `Schedule/schedule.json`. API validation caps schedules at 500
  events and validates IDs, types, dates, and 24-hour times.
- Deadline items entered here feed the Dashboard's next-deadline card. There is
  no independently implemented notifications/reminders service.

**Timer**

- Presets: Power Session 15/3, Pomodoro 25/5, School Block 45/15, Deep Focus
  50/10, Peak Productivity 52/17, Ultradian Cycle 90/20 (work/break minutes).
- Custom study/break lengths are allowed within the form's limits.
- Start, Pause, Reset and selected-session status/readout are present.
- The timer is client-side. Persistent timer sessions across reloads were not
  found.

### 6.6 Student Support (`/support`)

Order: crisis helpline panel; help-topic cards; 5-4-3-2-1 grounding checklist.
Helplines link to phone/text handlers. Procrastination and Peer Pressure cards
lead to their guidance pages; other cards such as Bullying, Mental Health,
Substance Awareness, and Academic Burnout are currently informational cards
without dedicated destinations.

The page is educational, not a crisis-response service. Crisis details and
regional availability should be reviewed before public deployment.

### 6.7 Procrastination & Focus (`/procrastination-focus`)

Static guidance page: “start small” hero, four strategy cards, 10-minute start
checklist, and reminder checklist. Checkboxes are page controls only; persistence
was not found. The `/focus` route redirects here.

### 6.8 Peer Pressure & Boundaries (`/peer-pressure-boundaries`)

Static two-column grid of guidance tiles: refusal scripts, types of pressure,
boundary frameworks, interactive-tools descriptions, healthy friendships and
getting help. The “scenario simulator,” “script cards,” and “friendship
check-in” descriptions are not currently interactive tools. On small screens
the grid collapses to one column.

### 6.9 Settings and appearance (`/settings`, `/appearance`)

- Standalone account page: username, logout action, appearance panel.
- Sixteen theme choices: eight light and eight dark. Theme classes live in
  `static/style.css`; displayed theme cards/previews live in
  `templates/_appearance_settings.html`.
- Theme IDs:
  - Light: `light-lavender`, `light-blue`, `light-coral`, `light-cobalt`,
    `light-emerald`, `light-orchid`, `light-citrus`, `light-slate`.
  - Dark: `dark-purple`, `dark-blue`, `dark-green`, `dark-citrus`, `dark-neon`,
    `dark-ember`, `dark-jade`, `dark-mocha`.
- User previews by selecting a card and applies with “Apply selected theme.”
  The apply row is fixed at the viewport bottom so it stays available.
- `theme.js` puts the cached theme on `<html data-theme="...">` immediately to
  reduce flashes, then loads the account preference. `appearance.js` applies
  the chosen theme and saves it to the account via `/api/preferences/theme`.
- The same theme is cached in browser `localStorage`; the server's canonical
  account setting is a JSON file in the user's Settings folder.
- Palette details are implementation tokens, not separate layout variants:

| Theme | Page background | Card surface | Text | Main accent |
|---|---|---|---|---|
| light-lavender | `#f7f5fb` | `#ffffff` | `#29273a` | `#7665d8` |
| light-blue | `#f1f7fb` | `#ffffff` | `#203445` | `#367da3` |
| light-coral | `#ffe8e3` | `#ffffff` | `#3e201c` | `#e6372b` |
| light-cobalt | `#e0ebff` | `#ffffff` | `#14274d` | `#1555df` |
| light-emerald | `#dcf5e6` | `#ffffff` | `#123b2b` | `#087a40` |
| light-orchid | `#f0ddff` | `#ffffff` | `#35164f` | `#9126d4` |
| light-citrus | `#fff0bf` | `#ffffff` | `#40320b` | `#a96500` |
| light-slate | `#f0f3f7` | `#ffffff` | `#293442` | `#647c98` |
| dark-purple | `#0b0b0e` | `#17171c` | `#e7e3f5` | `#b79bf7` |
| dark-blue | `#0a0d10` | `#171d22` | `#e3edf9` | `#7edaf2` |
| dark-green | `#0a0f0d` | `#171d1b` | `#e2f0e8` | `#8ae0ad` |
| dark-citrus | `#0d0a08` | `#1b1712` | `#f5ead0` | `#f4c35d` |
| dark-neon | `#0a0c0e` | `#171a1d` | `#ebeeff` | `#c0ff52` |
| dark-ember | `#0d0908` | `#1a1412` | `#f7eae1` | `#ff8a5a` |
| dark-jade | `#0a100f` | `#181f1d` | `#eafef3` | `#48eb9d` |
| dark-mocha | `#0d0b0a` | `#1b1715` | `#f0e9e4` | `#d0a98d` |

## 7. Common visual system and responsive layout

- Main font stack: native system UI (`-apple-system`, BlinkMacSystemFont,
  Segoe UI, sans-serif); no custom web font was found.
- Global CSS variables provide background, card surface, text, muted text,
  border, accent, soft surface, control surface, and semantic icon colors.
- Desktop sidebar: fixed left, 245px wide; StudyTool logo at top; vertical
  navigation; settings/help pinned to the bottom.
- Main content: width `calc(100% - 245px)`, left margin 245px, padding
  `35px 55px 70px`. Standard content/dashboard max width is 1200px.
- Standard card: theme card surface, 1px theme border, 21px radius, subtle
  theme shadow. Feature cards use a 18px radius and a small hover lift.
- Welcome icon: 44px; page title: 30px, semibold, slightly tight tracking.
- Main card headings: 22px semibold; section headings: 20px. Eyebrows are
  11px, uppercase, 1.7px letter spacing, muted.
- Dashboard feature grid uses auto-fit columns (normally two columns); lower
  grid is `1.25fr 0.75fr` with an 18px gap.
- At max-width 950px the sidebar/main column shrink to 210px and the lower grid
  becomes a single column.
- At max-width 700px the sidebar is hidden; content becomes full width with
  `20px 17px 30px` padding; fixed bottom navigation appears with 70px body
  bottom padding; feature and lower grids stack. The `.mobile-menu` button
  appears on several pages but no menu-opening JavaScript handler was found.
- More specific breakpoints exist for timer/calendar (1000px, 700px), support
  (900px, 950px, 700px), resources (800px, 420px), appearance (800px, 420px),
  and sound studio (950px, 700px). Consult the relevant CSS section before
  changing a page.
- Some older templates still use inline style attributes or hard-coded colors.
  New/updated shared components should use CSS classes and theme variables.

## 8. Persistence and data flow

```text
Browser request
  ├─ Flask session cookie → user_id / username
  ├─ SQLite studytool.db → users + password hashes + legacy preference fields
  └─ static/SaveData/<username>/
       ├─ Settings/settings.json → account appearance
       ├─ Schedule/schedule.json → calendar events
       ├─ Notebooks/notebooks.json → notebook list/current selection/content
       ├─ chats/*.json → Sammy conversations
       └─ memory → bounded study-related AI memory
```

- Passwords are stored as Werkzeug hashes, not plaintext.
- First database initialization seeds a demo account for development. The login
  page exposes the demo credentials and `app.py` has a fallback development
  secret; do not deploy without configuring a unique environment `SECRET_KEY`
  and removing/changing the demo account.
- `user_save_directory` derives a per-user directory from the DB username,
  validates its allowed characters, and creates expected directories/files.
- Writes use a temporary file and `os.replace` for atomic replacement.
- Theme and schedule JSON files are the active persistence path; database
  preference fields remain for compatibility/migration.
- Some preferences are browser-local only: recent resource searches, theme
  cache/migration flag, and quote slideshow state.
- Account data is stored under `static/SaveData`, which is under the static
  directory. Treat that storage placement as a deployment/security concern:
  verify web-server/static serving rules and move private persistent data
  outside the public static directory before hosting real user accounts.

## 9. HTTP API

| Method + path | Auth | Role / important behavior |
|---|---|---|
| `GET /api/preferences/theme` | Yes | Return saved theme or null. |
| `PUT /api/preferences/theme` | Yes | Validate against 16 theme IDs and save. |
| `GET /api/preferences/schedule` | Yes | Return saved `events` array. |
| `PUT /api/preferences/schedule` | Yes | Validate and save up to 500 schedule events. |
| `GET /api/notebooks` | Yes | Return notebooks; create default “My Notebook” if no file exists. |
| `PUT /api/notebooks` | Yes | Validate active notebook, IDs, names and text lengths; atomically save. |
| `POST /api/ai` | Yes | Stream chat events as `application/x-ndjson`; optional `chat_id` continues an existing chat. |
| `GET /api/ai/chats` | Yes | List current user's chats newest-updated first. |
| `GET /api/ai/chats/<chat_id>` | Yes | Load a chat belonging to the signed-in user. |
| `POST /api/ai/chats/<chat_id>/rename` | Yes | Rename a user's conversation. |
| `DELETE /api/ai/chats/<chat_id>` | Yes | Delete a user's conversation. |

Notebook object shape:

```json
{
  "active_id": "stable-notebook-id",
  "notebooks": [
    {
      "id": "stable-notebook-id",
      "name": "My Notebook",
      "content": "Longer freeform note",
      "quick_note": "Compact quick note"
    }
  ]
}
```

Notebook limits: at least one notebook; ID 1–36 ASCII letters/digits/underscore/
hyphen and unique; non-empty name up to 80 characters; `content` up to 200,000
characters; `quick_note` up to 20,000 characters. There is no maximum number of
notebooks enforced by the API currently.

Schedule event shape is `{id,title,type,date,time,end_time,done}`. Dates are
`YYYY-MM-DD`, times are 24-hour `HH:MM`, title max 120 chars, valid type is
`to-do|homework|event|exam|rest`, done must be boolean, and end must follow
start. The frontend supports legacy duration data when loading/migrating.

## 10. Known gaps and practical next work

These are code-observed gaps, not assumptions about the desired product:

### Highest priority before wider deployment

1. **Protect account files.** Per-user JSON is currently stored inside
   `static/SaveData`; private chats, memory, schedules and notes must not be
   directly served as public assets. Move it to a non-static data directory and
   verify access controls/backup behavior.
2. **Production authentication configuration.** Replace the fallback Flask
   secret, remove/change the development demo account, configure secure cookie
   settings/HTTPS, and review rate limiting/password policy before public use.
3. **Test notebook and API behavior in the suite.** Existing tests cover auth,
   AI, theme, schedule and chat, but no dedicated notebook API/browser tests
   were found.
4. **Resolve mobile navigation.** Mobile bottom navigation exists, but visible
   hamburger buttons have no JavaScript handler; either wire them to a menu or
   remove them if redundant.

### Product completeness

5. **Finish notebook management if intended:** currently add/rename and
   per-notebook quick/full text only. There is no delete, duplicate, reorder,
   page/section hierarchy, rich text, export, search, or standalone notebook
   page. `/notes` only jumps to the dashboard anchor.
6. **Make resource catalog intentional.** `data/resources.json` is not present
   in the project inventory; add and maintain one if curated results are
   expected. Replace static category-description cards with real resource
   links/actions or label them as informational.
7. **Wire the advertised AI tools.** Summarizer, flashcards, problem solver,
   and quizzer are UI-only cards; implement workflows or identify them as
   coming later.
8. **Complete support-topic destinations.** Several support tiles have no
   action. The peer-pressure page itself describes interactive downloads and
   simulators that are not implemented. Grounding/focus checkboxes are not
   persisted.
9. **Clarify the dashboard progress/activities model.** Progress is replaced
   by notebooks. Recent Activity currently shows only the next upcoming
   non-rest schedule event; it is not a history or progress metric.
10. **Review audio claims and resilience.** One sound description says an
    852 Hz tone is “proven” to get rid of overthinking; that claim needs
    evidence or softer wording. Add graceful UX for unavailable external audio.
11. **Unify duplicated navigation/templates.** Standalone templates repeat
    sidebar/mobile markup, creating inconsistent icons/labels and active
    states. A shared Jinja base/layout would reduce drift, but is a broader
    refactor, not a prerequisite for a focused bug fix.
12. **Centralize inline styles and test themes page-by-page.** Resource/login/
    other templates contain hard-coded colors, which can undermine theme
    contrast. Audit dark and light variants, keyboard states, and narrow mobile
    layouts.
13. **Add deployment/data operations docs.** Document Ollama installation/model
    pull, web-search network requirements, deployment process, DB/file backups,
    data deletion/export, and privacy/retention policy.

## 11. Validation commands and test scope

The test files use Python `unittest`. Typical focused invocations:

```sh
python -m unittest discover -s tests
node --check static/dashboard_notebooks.js
git diff --check
```

Use the selected workspace Python environment rather than assuming shell
`python` is the right interpreter. The frontend has substantial inline scripts
in `templates/ai.html`, `templates/index.html`, and
`templates/time_management.html`; Python tests alone do not validate browser
interactions or visual layout. Prefer a browser check for meaningful UI changes.
