# Plan — IMAP mailboxes (Hostinger and every other host)

Put the conversation on the record for people whose mail is not Gmail or Outlook.
The trigger is a Hostinger mailbox, but nothing here is Hostinger-specific: the
same code serves Zoho, Fastmail, cPanel hosts, Dovecot, iCloud custom domains — any
server that speaks IMAP over TLS.

Two things are missing today, and both have to land for a Hostinger rep to use the
CRM at all:

1. **They cannot sign in.** `emailAndPassword` is off, and the only doors are Google,
   Microsoft and SSO (`packages/auth/src/auth.ts`).
2. **Their mail cannot sync.** `SYNC_SOURCES` is `calendar | gmail | outlook`
   (`apps/api/src/mailbox/mailbox.constants.ts`), and every source assumes an OAuth
   token.

Read it with [`gmail-calendar-plan.md`](gmail-calendar-plan.md) — every decision
there about relevance, auto-creation, identity and forward-only sync is assumed
here, not repeated — and with [`connections.md`](../connections.md),
[`environment.md`](../environment.md) and [`api.md`](../api.md).

---

## 1. The decisions that carry the design

1. **IMAP is a fourth sync source, not a new pipeline.** `MailboxSync`,
   `SyncStateService`, `ThreadWriterService`, `MailboxMatchService` and the cron
   tick are already provider-agnostic. Outlook proved it: `OutlookSyncService` is
   only Graph's problems on top of the shared writer. IMAP adds only IMAP's
   problems. §4.
2. **Sign-in is a magic link, sent over SMTP.** No passwords stored for sign-in, no
   new identity system, and the same `user.create` allow-list hook guards it. The
   CRM needs an outbound SMTP account for this — which a Hostinger customer already
   has. §2.
3. **Mailbox credentials are a separate table, encrypted, never an `Account` row.**
   `Account` is Better Auth's sign-in table; `signInAccounts`, `mailboxGrantsNeeded`
   and account linking all read it. An IMAP password in there would be read as a
   sign-in method. §3.
4. **We store an app password, not the user's login password, where the host
   offers one** — and we encrypt whatever we store with the existing `SecretBox`
   (AES-256-GCM, per-purpose AAD). Hostinger has no app passwords, so for Hostinger
   it is the mailbox password; the UI says so plainly. §3.2.
5. **We read INBOX and Sent, nothing else.** IMAP has no "all mail" view and no
   single change feed. Two folders gives both directions — and two-way engagement
   is what auto-creation needs. Spam and Trash are excluded by not being read. §4.2.
6. **We never change the mailbox.** `BODY.PEEK[]`, read-only `EXAMINE`, no flags
   written. A rep's unread mail stays unread. §4.3.
7. **Forward-only, same as Gmail and Outlook.** The first pass records each folder's
   `UIDNEXT` and imports nothing. No backfill variable. §4.1.

### Choice table

| Decision | Choice | Why |
| --- | --- | --- |
| Sign-in for non-Google/Microsoft reps | Better Auth `magicLink` plugin over SMTP | §2. No password storage; reuses the allow-list hook. |
| Sign-in mail transport | `nodemailer`, `SMTP_*` env vars | One workspace sender (e.g. `crm@growmatiq.com`). |
| Sync source id | `imap` | Joins `SYNC_SOURCES`; `PROVIDER_FOR_SOURCE.imap = "imap"`. |
| Credential storage | New `ImapMailbox` table, password via `SecretBox` | §3. Not an `Account` row. |
| Encryption key | `MAILBOX_ENCRYPTION_KEY` (32 bytes, base64) | Same shape as `MCP_ENCRYPTION_KEY`; separate key, separate blast radius. |
| IMAP library | `imapflow` | Maintained, promise-based, handles `SPECIAL-USE`, `CONDSTORE`, TLS. |
| MIME parsing | `mailparser` (`simpleParser`) | Then the existing `stripHtml` / `stripQuotedHistory`. |
| Folders | INBOX + the `\Sent` special-use folder | §4.2. Fallback names: `Sent`, `INBOX.Sent`, `Sent Items`, `Sent Messages`. |
| Cursor | JSON in `MailboxSync.cursor`: `{ folder: { uidValidity, lastUid } }` | §4.1. No schema change to `MailboxSync`. |
| `UIDVALIDITY` changed | Reset that folder to current `UIDNEXT`, log it | Forward-only; we never re-scan a mailbox. |
| Email identity | RFC 822 `Message-ID`, as today | Dedupes against Gmail/Outlook copies of the same thread. |
| No `Message-ID` | Synthesize `imap:<sha256(from,date,subject,uid)>` | Rare; keeps the unique index honest. |
| Transport security | TLS on 993 only, or STARTTLS on 143 — never plaintext | §3.3. |
| Host safety | Reject private/loopback/link-local IPs after DNS resolve | §3.3. User-supplied host = SSRF surface. |
| Auth failure | `NEEDS_RECONNECT` | Password changed; the same banner Outlook uses. |
| Calendar | Out of scope | IMAP has no calendar. §8. |

### Judgment calls worth your veto

- **Magic-link reps are walled until IMAP is connected.** Same rule as Google: a
  rep with an account and no mailbox is a half-configured account nobody notices.
  `mailboxGrantsNeeded` learns that a magic-link-only user needs `imap`. SSO reps
  stay ungated, exactly as today. If you'd rather make IMAP optional for them, it
  is one line in `scopes.ts` — say so.
- **The connected address must be the rep's own CRM email.** `ThreadWriter` decides
  direction by `parsed.from.email === options.mailbox`; a rep connecting a shared
  `sales@` inbox would file every reply as outbound from them. Shared inboxes are a
  separate feature.
- **Sync runs every 5 minutes, on the same cron, one connection per tick.** IMAP
  `IDLE` would be near-real-time, but it needs a long-lived process and the API is
  serverless. Five minutes is what Gmail and Outlook get.
- **Mail moved by server-side filters into other folders is missed.** The fix is a
  folder picker, which is v2. Most reps file nothing.

---

## 2. Sign-in by magic link

### 2.1 What changes

- `packages/auth/src/auth.ts`: add the `magicLink` plugin. `sendMagicLink` refuses
  any address `isWorkspaceEmail` rejects **before sending** — otherwise the sign-in
  page is a way to make our SMTP account mail anyone. The existing `user.create`
  hook still runs as the second check.
- `packages/auth/src/mailer.ts` (new): one `nodemailer` transport built from
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. The four are
  set together or not at all (`env.ts` throws on a partial set, like the Google pair).
- `packages/auth/src/env.ts` and the root `turbo.json` `globalPassThroughEnv`: add
  the five `SMTP_*` names. **`passThroughEnv`, never `env`** — see `environment.md`
  on how `MICROSOFT_CLIENT_ID` shipped invisible.
- Sign-in page: an "Email me a link" field, rendered only when SMTP is configured.
  With no Google, Microsoft, SSO *or* SMTP, the page already says so by name; add
  SMTP to that sentence.
- Link lifetime 10 minutes, single use (plugin defaults), rate-limited by the
  existing database rate limiter.

### 2.2 Hostinger values

```sh
SMTP_HOST="smtp.hostinger.com"
SMTP_PORT="465"                      # implicit TLS
SMTP_USER="crm@growmatiq.com"
SMTP_PASSWORD="…"
SMTP_FROM="Growmatiq CRM <crm@growmatiq.com>"
```

Check SPF and DKIM on the domain in hPanel, or the link lands in spam.

---

## 3. Connecting a mailbox

### 3.1 Schema

```prisma
model ImapMailbox {
  id                String   @id @default(cuid())
  userId            String   @unique
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  address           String            // lower-cased; must equal user.email
  host              String
  port              Int      @default(993)
  security          ImapSecurity @default(TLS)
  username          String
  passwordEncrypted String            // SecretBox, purpose "imap-password:<userId>"
  sentFolder        String?           // resolved at connect time, re-resolved on failure

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@map("imapMailbox")
}

enum ImapSecurity {
  TLS
  STARTTLS
}
```

`EmailMessage` gets nothing new: `syncedByUserId` and `rfcMessageId` are enough, and
there is no web link to store. `IncomingMessage` gets no IMAP-specific field.

The AAD purpose includes the `userId`, so a ciphertext copied onto another row will
not decrypt.

### 3.2 The connect form

Settings → Connections → **Email (IMAP)**, and the same form on `/grant-access` for a
walled magic-link rep. Built from `/packages/ui` per `design.md`.

- **Address** — prefilled with the rep's email, read-only.
- **Provider** — presets fill host/port/security: Hostinger
  (`imap.hostinger.com`, 993, TLS), Zoho, Fastmail, iCloud, Yahoo, *Other*.
  Preset list lives in `packages/auth/src/imap-presets.ts`, not in the component.
- **Password** — labelled "App password" when the preset supports one, with the
  link to create it; "Mailbox password" for Hostinger, with one line saying it is
  stored encrypted and only used to read INBOX and Sent.
- **Test & connect** — the API logs in, lists folders, resolves Sent, logs out,
  and only then writes the row. Errors are mapped to sentences: wrong password,
  host unreachable, certificate invalid, no Sent folder found (offer a picker).

Following `connections.md`: the page shows **Brings in** — "Mail in INBOX and Sent
that involves a company you track" — and **Sends** — "Nothing. Your mailbox is
never changed; unread mail stays unread."

### 3.3 Safety

- **Host.** Resolve DNS, reject loopback, RFC 1918, link-local, CGNAT and metadata
  addresses, and connect to the resolved IP with SNI set to the hostname (so a
  re-resolve can't swap targets). Ports 993 and 143 only.
- **TLS.** Certificate verification always on. No "allow insecure" toggle.
- **Secrets.** The password is decrypted inside `ImapClient.connect` and nowhere
  else; never logged, never returned by any procedure, never in telemetry. The
  tRPC status output exposes `address`, `host`, `connectedAt`, `status` only.
- **Who.** Connecting, testing and revoking are self-service on your own row. Unlike
  Slack, an IMAP connection is personal, not shared, so no `canManageConnections`.

### 3.4 Disconnect

Parity with Outlook (`microsoft-connection.service.ts`): **revoke** deletes the
`ImapMailbox` row and the `MailboxSync` row; **purge** reuses the thread-rebuild
path to remove what this mailbox synced. There is no remote token to revoke — tell
the rep to change the password if they want the credential dead everywhere.

---

## 4. Sync

### 4.1 Cursor and first pass

`MailboxSync.cursor` holds JSON:

```json
{ "INBOX": { "v": 1700000000, "uid": 4182 }, "Sent": { "v": 1700000001, "uid": 913 } }
```

- **No cursor** → `EXAMINE` each folder, store `{ v: UIDVALIDITY, uid: UIDNEXT - 1 }`,
  import nothing. Mirrors `OutlookSyncService.start`.
- **Unparseable cursor** → `clearCursor`, resume from now (as Outlook does).
- **`UIDVALIDITY` differs** → that folder restarts from its current `UIDNEXT`. The
  server renumbered; re-scanning would import the whole mailbox.

### 4.2 Each tick

`ImapSyncService.sync(row)`, called from `MailboxSyncService.runOne` when
`source === "imap"`:

1. Load `ImapMailbox`; missing → `skipped`.
2. Connect (15 s timeout), `EXAMINE INBOX`.
3. `UID FETCH <uid+1>:*` with `ENVELOPE`, `BODYSTRUCTURE`, `RFC822.SIZE`. Skip
   anything over 2 MB for body fetch (store headers + a "too large to show" body).
4. For the rest, `BODY.PEEK[]`, `simpleParser`, then the existing `message-text`
   helpers: `normaliseMessageId`, `rootMessageIdFrom`, `stripHtml`,
   `stripQuotedHistory`; participants via `parseAddress`.
5. Hand each to `ThreadWriterService.store(row, { mailbox: address, origin: "imap" }, …)`.
   Relevance, suppression, auto-create and direction are all already there.
6. Repeat for the Sent folder.
7. `settle` with the furthest UID per folder. Cap at `MAX_MESSAGES_PER_TICK = 120`
   across both folders, like Outlook; the rest waits for the next tick.
8. `LOGOUT` in a `finally`.

### 4.3 Read-only, for real

`EXAMINE`, not `SELECT`, so the server will refuse a flag change even if a bug tries
one. `BODY.PEEK[]`, never `BODY[]`. A test asserts no `STORE` command is ever sent.

### 4.4 Failure mapping

`ImapClient` returns the same `MailboxResult<T>` union as `MailboxApiClient`, so
`handleFailure` is shared shape:

| IMAP condition | Outcome | State |
| --- | --- | --- |
| `AUTHENTICATIONFAILED`, `NO [AUTH…]` | `unauthorized` | `markNeedsReconnect` |
| Connection refused / DNS / timeout | `failed`, retryable | `markFailed`, backoff via `retryAfter` |
| `Too many connections`, `[LIMIT]`, `[UNAVAILABLE]` | `rate-limited` | `markRateLimited` (5 min) |
| Sent folder gone | re-resolve once; still gone → sync INBOX only, log | — |
| `UIDVALIDITY` change | handled in §4.1 | — |

### 4.5 Serverless fit

Vercel Node functions can open outbound TCP, so `imapflow` works. Login costs one to
two seconds; with the 60 s `TICK_BUDGET_MS` that is room for a few dozen IMAP
mailboxes per tick before the budget defers the rest — fine for an internal team,
and the existing claim/budget logic already handles overflow.

---

## 5. Where it touches existing code

| File | Change |
| --- | --- |
| `packages/auth/src/scopes.ts` | `IMAP_PROVIDER_ID`; `mailboxGrantsNeeded` returns `["imap"]` for a magic-link-only user with no `ImapMailbox` |
| `packages/auth/src/auth.ts` | `magicLink` plugin + guarded `sendMagicLink` |
| `packages/auth/src/mailer.ts`, `imap-presets.ts`, `mailbox-crypto.ts` | new |
| `packages/db/prisma/schema.prisma` | `ImapMailbox`, `ImapSecurity` |
| `apps/api/src/mailbox/mailbox.constants.ts` | `imap` in `SYNC_SOURCES`, `IMAP_SYNC_SOURCES`, `isImapSyncSource` |
| `apps/api/src/imap/` | `imap.client.ts`, `imap-sync.service.ts`, `imap-connection.service.ts`, `imap.router.ts`, `imap.contracts.ts`, `imap.module.ts` |
| `apps/api/src/sync/mailbox-sync.service.ts` | dispatch `imap`; `imapConnections.reconcileAll()` ensures a `MailboxSync` row per `ImapMailbox` |
| `apps/app/lib/session.ts` | `requireMailboxAccess` passes the IMAP connection state into the gate |
| `apps/app/app/(landing)/grant-access/page.tsx` | renders the IMAP form when `imap` is outstanding |
| `apps/app/app/(app)/[slug]/settings/connections/` | `imap-connection.tsx`; entry in the add-connection picker |
| `apps/app/lib/trpc/cache.ts` | `cache.imap()` |
| `packages/telemetry/src/allowlist.ts` | `imap` as a sync source value |
| `docs/environment.md`, `docs/setup.md`, `docs/connections.md` | `SMTP_*`, `MAILBOX_ENCRYPTION_KEY`, the IMAP connection page rules |

The agent builder's taggable ids (`google:gmail`) get `imap:mail` only if an agent
needs to read mail directly — not part of this plan.

---

## 6. Phases

| Phase | Ships | Size |
| --- | --- | --- |
| **0. Magic-link sign-in** | `SMTP_*`, mailer, plugin, sign-in field. A Hostinger rep can sign in (ungated until Phase 3). | ~1–2 days |
| **1. Connect** | Schema, encryption, `ImapClient` with SSRF/TLS rules, test-and-connect form, status, revoke. No sync yet. | ~3 days |
| **2. Sync** | `ImapSyncService`, cursor, dispatch, failure mapping, purge. Threads appear on timelines. | ~4–5 days |
| **3. Gate & docs** | `mailboxGrantsNeeded` learns `imap`, `/grant-access` form, docs. | ~1 day |

Phase 0 is useful on its own and lowest risk — ship it first.

---

## 7. Tests

Mirror `apps/api/test/outlook-sync.spec.ts` with a fake `ImapClient` (the service
depends on the interface, never on `imapflow` directly):

- First pass records `UIDNEXT` and writes nothing.
- Incremental pass writes only new UIDs, across INBOX and Sent, capped at 120.
- `UIDVALIDITY` change resets that folder, not the other.
- Outbound detection from Sent; a thread replied to from Sent qualifies for auto-create.
- Same `Message-ID` already synced via Gmail by a colleague → one `EmailMessage`.
- Auth failure → `NEEDS_RECONNECT`; `[LIMIT]` → rate-limited with `retryAfter`.
- **No `STORE` / `SELECT` is ever issued.**
- Host validation rejects `127.0.0.1`, `10.x`, `169.254.169.254`, `::1`, and a
  hostname that resolves to any of them.
- `SecretBox` round-trip with the per-user purpose; a swapped ciphertext fails.
- `sendMagicLink` refuses a non-allow-listed address without calling the mailer.
- `mailboxGrantsNeeded`: magic-link-only + no IMAP → `["imap"]`; SSO → `[]`.

One manual end-to-end against a real Hostinger mailbox before calling Phase 2 done.

---

## 8. Not in this plan

- **Calendar for IMAP users.** IMAP has none. Meetings could later come from
  `.ics` invitations found in synced mail, or from CalDAV where a host offers it.
- **Sending mail** from the CRM. Read-only, as with Gmail and Outlook.
- **Shared inboxes** (`sales@`), **folder picker**, **IMAP IDLE push**, **backfill**.
- **OAuth for IMAP** (XOAUTH2) — only matters for Gmail/Outlook, which already have
  native sync.
