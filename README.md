# Voterlist System

A private voter-record management application built with Node.js, serverless API routes, and MongoDB. Administrators can enter and edit records, check unfinished NIN records against Nepal's Election Commission voter portal, review unique response and edit histories, print QR sheets, and share public QR verification links.

> **Sensitive information:** Records include personally identifiable information. The management APIs require an administrator session, but QR verification pages are intentionally public and display record information. Restrict access to printed QR sheets, use a trusted device, and secure the MongoDB account and deployment environment.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Environment configuration](#environment-configuration)
- [MongoDB setup](#mongodb-setup)
- [Run locally](#run-locally)
- [Deploy to Vercel](#deploy-to-vercel)
- [How status checks work](#how-status-checks-work)
- [Data storage](#data-storage)
- [API routes](#api-routes)
- [Validation and tests](#validation-and-tests)
- [Troubleshooting](#troubleshooting)

## Features

- **Record entry and editing:** Enter NIN, name, AD/BS date of birth, mobile number, status, and optional notes. NIN and mobile numbers must contain exactly 10 digits. Names accept letters, spaces, and periods. AD and BS dates convert automatically.
- **Status management:** Records can be `NOT ONLINE`, `PENDING`, or `DONE`. Search responses can set the status and voter-list/Abedan number.
- **Voter portal checks:** Check or recheck any record, including `DONE` records. Multiple individual checks can run at once; each active row button animates until its response arrives, then shows **Checked**. Clicking an active or completed row button opens a 90%-screen dialog showing the status of every check in the group in a responsive multi-column layout, including checks still running. Retry individual eligible checks or retry all checks with the exact NID/NIN server-unavailable response without closing the dialog. The combined dialog also opens when the whole group finishes. Temporary server errors and missing responses are automatically retried using the configured retry count (1–15 additional attempts per record), shared by individual checks and Check All. Change the retry count from Settings → Retry count after unlocking admin settings. Check All processes records concurrently using a configurable limit of 1–15 requests; set it from Settings → Request limit. Closing the response dialog leaves checks running in the background; Check All shows live results, can be closed while checks continue, and reopens its results when complete. Ctrl/Cmd+R stops active individual or Check All checks after their current request/retry completes, then syncs records.
- **Record history:** A single consolidated history document per record retains the number of checks, unique full response entries, and record edits. Status changes caused by individual checks or Check All are recorded as record updates with before/after values. Identical responses do not create duplicate response entries. Older check-history entries are consolidated when that record's history is next accessed or updated.
- **Records table:** Filter by status, search by name/NIN/mobile/number, filter by registration and update date, and sort newest-first or oldest-first by registration date. Active date and sort filters are highlighted light green. Clicking date or sort controls opens a dialog with one Nepali (BS) date field that supports typing or selecting a date from the Nepali calendar, plus responsive multi-column date-range/sort choices; selecting an option applies it and closes the dialog. Date filters show matching counts at the right edge of their buttons. Clear filters is an icon button with an accessible label. Configure visible columns from Settings → Table display. Each row has Check, Print, and Delete actions; deleting one or multiple records requires the admin password every time and removes associated history. Bulk print and delete dialogs use 90% of the screen and provide responsive multi-column record selection, search, and registration-date filters with counts for all records, today, yesterday, this week, this month, and this year. Bulk deletion asks for the admin password in a separate confirmation dialog after records are selected. Check All keeps pulsing while checks run. The JSON backup download is available at the top of Settings and downloads a timestamped file of all records after syncing them from MongoDB. A Registered today card opens analytics with per-day totals for the last seven calendar days, counts for this month and the prior three months, and counts for this year and the prior year; choosing a period lists its records with Check, Print, and Delete actions, plus buttons to check all records in the period or only unfinished records. Table data and column preferences are cached in the browser; use Ctrl/Cmd+R to sync the records list from MongoDB.
- **QR verification and printing:** Print one compact A4 QR sheet per record, or select multiple records and print them in one print job with one full-size A4 page per record using Print multiple beside Check All. Individual rows and record details also provide print/QR actions. QR URLs use `https://voterlist.sujalmehta.com.np/verify/<code>`. Public verification displays the record's status and relevant details.
- **Workspace settings:** Settings opens with Backup and directly editable table-column checkboxes. Enter the admin password below the columns to unlock workspace visibility, retry-count, and password settings for the current Settings session; closing Settings locks them again. Settings dialogs use a 90%-screen layout. Hide or show the Entry, Old entry, and Database (Records & Status) tabs; at least one must stay visible. You can also hide Print multiple, Delete multiple, and the per-record Delete button. Workspace settings are saved to the `voterlistconfig` MongoDB collection and cached in local storage. On each authenticated page load, the app fetches the database settings and updates the local cache to match.
- **Old entry:** Create a record using the same fields and storage format as a regular entry, with a required registered date. The entered date is stored as the record's registration date (`createdAt`) in the shared `VoterlistData` collection.
- **Keyboard shortcuts:** Ctrl/Cmd+R stops active individual or Check All status checks after the current request completes, then syncs records; Ctrl/Cmd+S opens Entry and focuses the NIN field; Ctrl/Cmd+F opens Records & Status and focuses its search box. Repeating either tab shortcut while already on that tab toggles fullscreen.
- **Admin security:** Management routes require an HttpOnly, SameSite=Strict signed persistent session cookie. Active sessions are renewed as the application is used and invalidated when the admin password changes. The session signing secret must be at least 32 characters.

## Requirements

- Node.js 20 LTS or newer.
- npm (installed with Node.js).
- A MongoDB database reachable from the local machine and/or Vercel deployment. MongoDB Atlas is suitable.
- A Vercel account for Vercel hosting and the `vercel` CLI for local development (the local npm script invokes the CLI through `npm exec`).

## Quick start

```bash
git clone <repository-url>
cd voterlist-system
npm ci
cp .env.example .env
```

Edit `.env` with your MongoDB connection string and a strong session secret, then start the local Vercel development server:

```bash
npm run local
```

Open the local URL printed by Vercel, commonly `http://localhost:3000`.

If this directory is part of a larger repository rather than a standalone Git repository, use the repository's actual clone URL and change into the directory containing this `package.json`.

## Environment configuration

Copy `.env.example` to `.env`. The template is:

```dotenv
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>/<database>
VOTERLIST_SESSION_SECRET=replace-with-a-long-random-secret
# Used only if the shared Config collection does not have adminUnlockPassword.
VOTERLIST_ADMIN_PASSWORD=
```

### Variables

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection URI for the database containing the application records and shared configuration. |
| `VOTERLIST_SESSION_SECRET` | Yes | Secret used to sign admin session cookies. Must contain at least 32 characters. Use a unique, random value and keep it private. |
| `VOTERLIST_ADMIN_PASSWORD` | Conditional | Fallback initial admin password when `configs` has no `key: "default"` document with `adminUnlockPassword`. It is not used if the database password is present. |

Generate a session secret on macOS/Linux with:

```bash
openssl rand -base64 48
```

Use the resulting value for `VOTERLIST_SESSION_SECRET`. Do not reuse the MongoDB password or the admin password as the session secret.

For Atlas URIs, replace the placeholders with your cluster and database details. If the database username or password contains reserved URI characters (such as `@`, `:`, `/`, `#`, or `%`), percent-encode those credentials. Do not add spaces around the `=` sign. Keep `.env` out of Git; it is ignored by the included `.gitignore`. Never paste real credentials into issues, logs, screenshots, or source files.

Vercel's local development CLI reads local environment files. For deployed environments, add each variable separately under the Vercel project's **Settings → Environment Variables** for the relevant Development, Preview, and/or Production environments. Do not upload or commit `.env`.

## MongoDB setup

1. Create a MongoDB database and a dedicated application user with the minimum required read/write permissions for that database.
2. Configure the database network access list to allow the machine running local development and the Vercel deployment to connect. Atlas deployments may require an appropriate Vercel network access strategy; avoid opening the database broadly unless you understand the risk.
3. Set `MONGODB_URI` to the connection URI and include the intended database name.
4. Configure the initial admin password in the shared `configs` collection as the document with `key: "default"` and an `adminUnlockPassword` value, or use `VOTERLIST_ADMIN_PASSWORD` as a fallback if that database value is absent.
5. Sign in to the app with the configured password.

The app uses the following MongoDB collections:

- `VoterlistData` — voter records and QR tokens.
- `VoterlistHistory` — consolidated check-response and edit histories.
- `configs` — shared configuration, including the administrator password.
- `voterlistconfig` — shared workspace tab visibility preferences.

The password-change dialog updates the `adminUnlockPassword` field in the existing default `configs` document. If authentication is using only the environment fallback and that database field/document is absent, create/populate the config record first; the UI cannot persist a changed password to an absent database setting. Workspace tab preferences are stored in the default record in `voterlistconfig`.

## Run locally

Install packages and copy the environment template once:

```bash
npm ci
cp .env.example .env
```

Set the environment values in `.env`, then run:

```bash
npm run local
```

`npm run local` runs `npm exec --yes --package=vercel@latest -- vercel dev --yes`. It obtains the Vercel CLI through npm without adding it to the application's runtime dependencies. On first use, Vercel may require CLI authentication or project linking. The app is served with Vercel's local function routing so the files under `api/` work as serverless endpoints.

Stop the development server with Ctrl+C.

## Deploy to Vercel

1. Push the project to a Git repository that Vercel can access. If this app is in a subdirectory of a larger repository, set that subdirectory as the Vercel project's **Root Directory**.
2. In Vercel, create/import a project for this application and select the correct framework/build settings. The repository includes `vercel.json`; the app is served from the project root with functions in `api/`.
3. Add `MONGODB_URI`, `VOTERLIST_SESSION_SECRET`, and the initial `VOTERLIST_ADMIN_PASSWORD` if needed in **Settings → Environment Variables**. Add them to Production and any Preview environment where the app should work.
4. Ensure MongoDB network access permits the deployment to connect.
5. In **Settings → Git**, set the **Production Branch** to the branch you deploy (usually `main`). Pushes to that branch should create a new production deployment.
6. After each push, open **Deployments** and verify the deployment's source commit matches the latest commit on the production branch. A deployment for an older commit does not include later changes.
7. Deploy and verify that the login screen, admin login, records list, and a QR verification link work.
8. Add `voterlist.sujalmehta.com.np` under the Vercel project's **Settings → Domains**. Apply the DNS record Vercel specifies at your DNS provider, then wait for Vercel to confirm the domain and HTTPS certificate.

After changing Vercel environment variables, redeploy for the changes to take effect.

### If a Git push does not create a deployment

- Confirm **Settings → Git** connects the intended GitHub repository and that GitHub access to the repository is still authorized.
- Confirm **Settings → Git** lists the branch you pushed as the **Production Branch**.
- Check **Deployments** for the pushed commit. If no deployment was created, use **Deploy** to create one from the latest production-branch commit; do not redeploy an older deployment if you need the newest code.
- If a new deployment fails, open its build logs and resolve the reported build error before retrying.

The app's QR links are currently configured to use `https://voterlist.sujalmehta.com.np`. If you deploy under a different domain, update the `verificationUrl` function in `app.js` before deployment.

`vercel.json` rewrites `/verify/<code>` to the frontend. The page reads the code and requests the public verification API. Do not remove this rewrite unless an equivalent route is configured.

The QR generator and Nepali date converter are loaded from public CDNs by `index.html`; printing and automatic date conversion need those resources to load.

## How status checks work

1. The browser sends a signed-in request to `POST /api/check-status` with NIN, date of birth, and first name.
2. The app validates those values against the saved record.
3. The server creates a voter-portal session by requesting `https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo`.
4. It posts the NIN, DOB, and first name to the portal's `https://applyvr.election.gov.np/Login/GetFromNIN` endpoint.
5. For already-registered responses or incomplete profile payloads, it may request `https://applyvr.election.gov.np/Dashboard/NewEnrollment` and parse the returned page.
6. The response is interpreted and the local record's status/identifiers are updated. The sanitized response is saved to the record's consolidated history. Portrait image payloads are not retained.

The actual voter-portal requests run on the server; browser users call the app's own `/api/check-status` route. The portal is an external service, so its availability and response format can change independently of this project.

Status rules:

- `DONE`: a voter-list number or Abedan number is found.
- `PENDING`: the search succeeds but no such number is returned, including profile/portrait responses.
- `NOT ONLINE`: the search indicates that no matching online record was found.
- A recognized portal outage preserves the record's existing status and remains eligible for retry.

Check All runs eligible records concurrently up to the configured request limit. Closing its modal does not cancel the run; use the Check All button again to reopen progress and results. Checks run only while the current page remains loaded. Refreshing or closing the page stops the in-memory batch.

## Data storage

- Records and history are stored in MongoDB.
- Record-list data and visible-table column preferences are cached in browser local storage. The cached records are personal data; use only trusted browser profiles/devices and clear browser storage when appropriate.
- On initial page load or sign-in, cached records are shown immediately when available, then the records list is fetched from MongoDB and the local cache is updated. A browser refresh loads the latest records the same way. Ctrl/Cmd+R explicitly syncs records and clears the current forms, searches, and filters. Individual record writes and status checks also contact the server.
- QR verification is public by design. Anyone with a valid QR link can view the information returned by `/api/public-record`, including NIN, mobile, dates of birth, status, notes, and any available voter-list/Abedan number. Share links/printouts only with authorized recipients.
- Back up MongoDB regularly and restrict database-user permissions and network access. This app does not provide a database backup/restore interface.

## API routes

| Route | Methods | Purpose | Access |
| --- | --- | --- | --- |
| `/api/auth` | `GET`, `POST`, `PUT`, `DELETE` | Check session, sign in, change admin password, and sign out. | Password/session protected as appropriate. |
| `/api/workspace-settings` | `GET`, `POST`, `PUT` | Read and update Entry/Old entry/Database tab visibility in `voterlistconfig`; `POST` verifies the admin password before opening workspace settings. | Admin session required. |
| `/api/records` | `GET`, `POST`, `PUT`, `DELETE` | List, create, update, and delete voter records. Deletion requires the admin password and removes associated record history. | Admin session required; password required for deletion. |
| `/api/check-status` | `POST` | Check one saved record against the voter portal and save its status/history. | Admin session required. |
| `/api/record-history?recordId=<id>` | `GET` | Read unique response and edit histories for one record. | Admin session required. |
| `/api/public-record?code=<token>` | `GET` | Return the public-safe fields for a QR verification token. | Public by design. |
| `/api/voter-search` | `POST` | Server-side voter portal search/proxy route. | Admin session required. |
| `/verify/<code>` | `GET` | Public QR verification page. | Public by design. |

## Validation and tests

Run the project's checks:

```bash
npm run build
npm test
```

`npm run build` performs Node.js syntax checks on the application and API files; it is not a bundling or production build step. `npm test` runs the automated tests using Node's built-in test runner.

## Troubleshooting

| Problem | Things to check |
| --- | --- |
| `MONGODB_URI is required` | Ensure `.env` exists locally, has a non-empty `MONGODB_URI`, and is in the app's project root. On Vercel, set it in project environment variables and redeploy. |
| MongoDB connection times out | Verify the URI, database credentials, encoded special characters, cluster status, and MongoDB network access list. |
| No admin password is configured | Add `adminUnlockPassword` to the default document in `configs`, or set `VOTERLIST_ADMIN_PASSWORD`. A database value takes precedence. |
| Session secret error | Set `VOTERLIST_SESSION_SECRET` to a random value of at least 32 characters and restart/redeploy. |
| Login works locally but not on Vercel | Confirm all production environment variables are configured and that the latest deployment includes them. |
| QR route returns a not-found page | Verify `/verify/<code>` rewrite configuration, deployed `vercel.json`, domain routing, and that the record still exists. |
| QR page cannot find a record | Verify the complete token in the link and that the corresponding MongoDB record exists. |
| Voter status check fails or retries | The external portal may be unavailable or have changed. Retry later and inspect the server/function logs for the exact upstream failure. |
| Date conversion or printing does not work | Check connectivity to the public CDN scripts included in `index.html`. |
| Browser shows old records | Reload the page to fetch the latest records from MongoDB; cached records display immediately while the sync runs. |

## License

No license is currently specified. All rights remain with the project owner unless a license is added to this repository.
