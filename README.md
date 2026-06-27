# Taskboard

A real-time collaborative kanban board. Multiple users can work on the same board simultaneously and see each other's changes instantly — no page refresh required.

## Features

- **Google OAuth** sign-in — no passwords to manage
- **Kanban columns**: Todo, In Progress, Done
- **Drag-and-drop** reordering within and between columns (SortableJS)
- **Real-time sync** across all connected users via Server-Sent Events
- **Board sharing** — invite collaborators by email; owners can remove members
- **Task details** — title, notes, due date, priority, overdue highlighting
- **Role-based controls** — owners can rename/delete boards and manage members; collaborators can create and edit tasks

## Architecture

```
taskboard/
├── src/
│   ├── app.ts               # Express app factory — middleware, sessions, routes
│   ├── index.ts             # Entry point — starts the HTTP server
│   ├── db.ts                # SQLite setup via better-sqlite3, schema, migrations
│   ├── auth.ts              # Passport.js Google OAuth strategy
│   ├── sse.ts               # In-process SSE broadcast (connected clients registry)
│   ├── session-store.ts     # SQLite-backed express-session store
│   ├── types.ts             # Shared TypeScript types
│   ├── middleware/
│   │   └── require-auth.ts  # Auth guard; saves returnTo for post-login redirect
│   └── routes/
│       ├── auth.ts          # /login, /auth/google, /auth/google/callback, /auth/logout
│       ├── boards.ts        # Board CRUD, search, rename, delete confirmation flow
│       ├── tasks.ts         # Task CRUD, move between columns, drag-and-drop reorder
│       ├── members.ts       # Invitations, member removal, leave board
│       └── sse.ts           # GET /sse — persistent SSE connection per board
├── views/
│   ├── layout.njk           # Base HTML layout
│   ├── home.njk             # Board list page
│   ├── board.njk            # Kanban board page
│   └── partials/            # HTMX fragment templates (board header, task cards, forms…)
├── public/
│   ├── style.css            # All styles (no framework)
│   └── favicon.ico
└── tests/
    ├── http/                # Vitest integration tests (supertest against real DB)
    └── e2e/                 # Playwright end-to-end tests
```

### How it works

**Server-side rendering with HTMX.** Pages are rendered by Nunjucks templates on the server. Interactive fragments (task cards, forms, confirmation prompts) are fetched and swapped in-place by HTMX without full page reloads.

**Real-time updates via SSE.** When any user changes a task — creates, edits, moves, or deletes — the server broadcasts an HTML fragment to all other users watching the same board over a persistent Server-Sent Events connection. HTMX's `hx-swap-oob` then patches the DOM out-of-band. There is no client-side state management.

**SQLite as the database.** `better-sqlite3` is used synchronously, keeping the code straightforward. WAL mode is enabled for concurrent reads. Sessions are also stored in SQLite via a custom `express-session` store, so no external services are required to run the app.

**Role model.** Every board has an owner (the creator) and zero or more collaborators added by invitation. Owners control board settings and membership; collaborators can manage tasks. All role checks happen server-side.

### Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Web framework | Express 5 |
| Templating | Nunjucks (autoescape on) |
| Frontend interaction | HTMX 2 |
| Drag and drop | SortableJS |
| Real-time | Server-Sent Events |
| Database | SQLite via better-sqlite3 |
| Auth | Passport.js + Google OAuth 2.0 |
| Email | Resend (optional) |
| HTTP tests | Vitest + supertest |
| E2E tests | Playwright |

## Getting started

### Prerequisites

- Node.js 18+
- A Google Cloud project with OAuth 2.0 credentials (see [Configuration](#configuration))

### Clone and install

```bash
git clone https://github.com/your-username/taskboard.git
cd taskboard
npm install
```

### Configuration

Copy the example env file and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Long random string for signing session cookies. Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` | Yes | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | From Google Cloud Console |
| `APP_URL` | Yes | Base URL of the app (`http://localhost:3000` locally) |
| `DB_PATH` | No | Path to the SQLite file (default: `./data.db`) |
| `RESEND_API_KEY` | No | If omitted, invitation links are printed to the console |
| `INVITE_FROM_EMAIL` | No | Sender address for invitation emails |
| `PORT` | No | Port to listen on (default: `3000`) |

#### Setting up Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a project.
2. Navigate to **APIs & Services → OAuth consent screen**. Choose **External**, fill in the app name and contact email, and add your Google account as a test user.
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**. Set type to **Web application** and add the redirect URI:
   ```
   http://localhost:3000/auth/google/callback
   ```
4. Copy the Client ID and Client Secret into your `.env`.

For production, add your production callback URL as a second redirect URI and set `APP_URL` accordingly. See [SETUP.md](SETUP.md) for more detail.

### Run in development

```bash
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000). The server restarts automatically on file changes (`tsx watch`).

### Build for production

```bash
npm run build   # compiles TypeScript to dist/
npm start       # runs dist/index.js
```

## Running tests

### HTTP integration tests

```bash
npm run test:http
```

Runs Vitest against a real in-memory SQLite database. Tests cover authentication, board and task CRUD, role-based access control, and the invitation flow.

### End-to-end tests

```bash
# The app must be running first
npm run dev

# In a second terminal
npm run test:e2e
```

Playwright drives a real Chrome browser through the full user journey. Set `BASE_URL` to point at a non-local environment if needed.

## Database

The schema is created automatically on first run. Subsequent starts apply incremental migrations (wrapped in `try/catch` so a fresh database safely skips them).

Tables: `users`, `sessions`, `boards`, `board_members`, `invitations`, `tasks`.

To reset the database, delete `data.db` (and its `-shm`/`-wal` siblings) and restart.
