# Ray Game Save Protocol v2

This is the client/server contract for the local-first Arcade and Starfall saves.
The default slot is `default`. Frontier uses the `arcade` app and its shared stats.

## Identity and Private Reads

- Authentication: `GET /v2/auth/me`, with the existing authenticated response shape
  `{ok:true,user:{id,...}}`. No game calls legacy `/auth/me`.
- Every request uses the session cookie. The server obtains its user ID only from
  that session.
- GET saves carries `?ownerId=<expected stable user ID>`; PUT/POST carries a string
  `ownerId` in the body. The server compares it with the session ID and returns
  `409 {ok:false,error:"owner_changed"}` on mismatch. It must not use this field
  to select another user's record. This protects the auth-check/request Cookie race.
- A controller must answer the `RAY_GAME_CACHE_PROTOCOL` MessageChannel handshake
  with `{rayGameCacheProtocol:2}` before the client makes ANY private request.
  An unsafe or unknown controller pauses cloud access and triggers an update.
- Authentication changes use BroadcastChannel/localStorage key
  `ray-auth-state-v2`. Startup, focus, visibility and foreground writes also
  recheck authentication. An unknown/offline identity starts in the guest space.
- `ray-auth-local-lock-v2=true` blocks authentication and all private requests,
  including a logout whose server-side Cookie invalidation has not been confirmed.
- In-flight work is bound to owner and identity epoch. Switching owner stops the
  old run before swapping state and ignores its late replies. This is application
  isolation, not encryption from someone controlling the browser profile.

## GET

`GET /v2/game-saves/:appId?ownerId=...`

```json
{
  "ok": true,
  "protocol": 2,
  "save": {
    "gameId": "starfall",
    "slot": "default",
    "protocol": 2,
    "schema": 2,
    "revision": 7,
    "updatedAt": 1788840000000,
    "deviceId": "ray-device-example",
    "checksum": "server-or-client-checksum",
    "payload": {}
  }
}
```

No save: `{ok:true,protocol:2,save:null}`.

`save.schema` may be 1 or 2 and must agree with `payload.schema`. Owned schema1
remote payloads are validated, archived in original form, filled with missing
app defaults and converted to schema2 with `resetGeneration:"initial"`. Invalid
boards or economics are retained as invalid copies, not silently repaired.
The GET checksum is not interpreted as a write ACK checksum.

## PUT and POST

`PUT /v2/game-saves/:appId` uses JSON. `POST` accepts the identical JSON body as
`text/plain;charset=UTF-8` for best-effort keepalive. Origin/CORS and session
checks are identical for both methods.

```json
{
  "protocol": 2,
  "schema": 2,
  "ownerId": "expected-user-id",
  "baseRevision": 7,
  "requestId": "fbcb32d5-4f02-46d5-aa74-7a297b56379f",
  "deviceId": "ray-device-example",
  "checksum": "1234abcd",
  "payload": {}
}
```

- `requestId`: 8-128 characters in `[A-Za-z0-9_-]`; clients generate UUIDs.
- `deviceId`: a string of at most 128 characters.
- Payload JSON budget: 60 KiB UTF-8. Whole request: 64 KiB UTF-8. Client keepalive
  is more conservative: it declines bodies of 60,000 bytes or more.
- `baseRevision` is the last acknowledged/downloaded revision, initially zero.
- CAS must insert only if absent at base zero or update only the matching current
  revision. One successful mutation increments revision by exactly one.
- The server stores the mutation and idempotency receipt atomically. An identical
  request retry returns its original ACK, even if the head has subsequently
  advanced. Same ID with different contents is rejected using the server's own
  SHA256 fingerprint. Client checksum is not a security primitive.
- Legacy writes return `409 client_upgrade_required`. The v2 table is separate
  from the legacy table; migration copies existing records only once and retains
  the original table. Old clients cannot overwrite the v2 head.

### Exact ACK

```json
{
  "ok": true,
  "protocol": 2,
  "requestId": "fbcb32d5-4f02-46d5-aa74-7a297b56379f",
  "gameId": "starfall",
  "slot": "default",
  "revision": 8,
  "checksum": "1234abcd",
  "updatedAt": 1788840000000
}
```

ACK checksum echoes the request checksum. The client requires protocol, app,
slot, exact request ID, `revision === baseRevision + 1` and exact checksum.
Checksum algorithm: sort object keys recursively, preserve array order, JSON
serialize, then FNV-1a over JavaScript UTF-16 code units; output eight lowercase
hex digits. The server independently fingerprints content for idempotency.

Conflict: `409 {ok:false,error:"revision_conflict",revision:<current>}`.
The client fetches the head, keeps the rejected immutable request as a copy and
either uses the typed safe merge or enters explicit conflict resolution.

## Payload Schema

The pure shared validator is `arcade/js/save-schema.js`:
browser `RaySaveSchema.validate(payload, appId)`; CommonJS
`require("./save-schema.js").validate(payload, appId)`. Backends may vendor the
same versioned source rather than reimplement its field rules.

### Arcade

```text
{
  schema: 2,
  appId: "arcade",
  resetGeneration: "initial" | UUID,
  buckets: {
    stats: {
      catJump: {bestHeight, bestScore, plays},
      rayHop: {bestScore, bestCombo, plays},
      merge2048: {bestScore, bestLevel, unlocked: [level], plays},
      dungeon: {bestFloor, bestGold, titles: [string], plays},
      neonBalls: {bestRound, bestScore, plays},
      reaction: {bestScore, bestCombo, plays},
      dailyCard: {totalDraws, rarest: string, plays},
      frontier: {bestScore, bestWave, bestLevel, bestChips, plays},
      totalPlays
    },
    settings: {sound: boolean, vibrate: boolean},
    cards: {date: string, draws, collection: {cardId: count}, history: [...]},
    sessions: {
      merge2048?: {
        active: boolean, board: [[level,level,level,level], ...4 rows],
        score, bestLevel, celebrated: {...}, updatedAt
      }
    },
    helpSeen: {gameId: boolean},
    achievements: [string]
  }
}
```

The board contains integer tile *levels*, not arbitrary sets or powers of two.
A cleared session is absent; a stale local session writer cannot recreate it
without a local conflict copy.

### Starfall

```text
{
  schema: 2,
  appId: "starfall",
  resetGeneration: "initial" | UUID,
  save: {
    version: 1, createdAt, updatedAt,
    stats: {
      bestScore, bestWave, bestTime, bestKills, bossKills,
      totalRuns, totalScore, totalKills, totalCoins, totalCollected, totalTime
    },
    wallet: {coins},
    upgrades: {hull, fireRate, magnet, dash, coin, nova},
    achievements: {achievementId: timestamp},
    settings: {sound: boolean, vibrate: boolean, calm: boolean},
    helpSeen: boolean
  }
}
```

`save.version:1` is retained gameplay metadata, not the envelope/payload schema.
Coins are nonnegative safe integers. Upgrade levels are integers from zero to
five. The original defaults are in each app's storage module.

## Generation and Merge Rules

`resetGeneration` is a required string, 1-128 ASCII letters/digits/underscore/
hyphen. Initial and migrated legacy data use `"initial"`; a reset or explicit
restoration generates a fresh UUID. It is an opaque identity, never a timestamp
or ordered counter.

Owner, app, schema and generation must agree before any typed merge. Different
generations preserve both snapshots and require an explicit choice. A known
base revision can CAS an intentional new reset generation; stale devices cannot
blindly overwrite that revision. Reset history is not automatically expired.

Only explicitly named best records take a numeric maximum; named achievement,
unlock and title sets may union. Boards, active sessions, cards, cumulative
counters and the complete Starfall economic snapshot are not recursively
combined. Any mutable-state disagreement preserves the local and remote copies.
A conflict result is never a partially combined wallet/upgrade snapshot.

## Local Persistence and Queue

IndexedDB database: `ray-game-saves-v2`, object store: `saves`.
Keys are `JSON.stringify(["user",ownerId,appId,2])` or
`JSON.stringify(["guest",null,appId,2])`.

Each record contains active payload, localRevision, cloud revision, dirty flag,
immutable pending request, optional send lease and retained conflict copies.
All mutations read the latest record inside an IndexedDB read/write transaction.
BroadcastChannel `ray-game-saves-v2` only signals reloads; it is not a lock.

- Gameplay reads an optimistic memory snapshot. Durable commit happens before
  upload; failed persistence is shown as unpersisted, not synced.
- Purchases debit coins and raise upgrades in one transaction. Run reward and
  cumulative run stats are one transaction. Settings reducers touch settings only.
- Daily card quota, collection and draw totals also commit together.
- One immutable pending request remains until its exact ACK. Newer edits advance
  localRevision without changing that request. An ACK clears dirty only if the
  acknowledged localRevision is still the current one.
- A transaction lease serializes tabs; it expires after 30 seconds. Fetch timeout
  is 12 seconds. If a stalled tab outlives the lease, duplicate transmissions still
  use the same immutable ID and are safe under backend idempotency.
- Network/protocol failures preserve pending and use bounded exponential backoff.
  Authentication failures lock cloud access; conflicts pause automatic merging.
- A pending request from a prior session is retried before pulling newer remote
  data. After that ACK the client downloads the current head again.
- Failed in-memory changes are retained during subsequent local play. Automatic
  persistence/cloud sync stays paused until explicit recovery succeeds; switching
  accounts does not display that failed memory to another owner.
- Recovery is opened from the save status. It supports export, explicit local/
  remote choice, retained-copy restore, and explicit guest/legacy import. Originals
  and unchosen snapshots are kept. No automatic deletion of backups occurs.
- All `rayArcade.*`, `rayStarfall.save.v1`, old cloud metadata and old pending keys
  remain untouched. No-owner legacy data is neither displayed nor uploaded on
  login. Its explicit recovery first requires confirmation of ownership.

## Service Worker Upgrade

All historical URLs (`sw.js`, `sw-cloudsave-2.js`,
`sw-cloudsave-3.js?v=heavy-1`, including unqueried variants) now import the same
`sw-runtime-v2.js`. Registration keeps the old URL and requests
`updateViaCache:"none"` plus an explicit update.

The runtime caches only exact, same-origin static asset URLs. It does not
intercept auth/save/API traffic, including errors. Activation and the safety
handshake remove non-whitelisted entries from known `ray-cat-starfall-*`
caches and delete superseded caches. Other projects' caches and IndexedDB are
not removed. Only a navigation request can receive the offline HTML shell.
A failed script/JSON/image fetch never gets an HTML fallback.

Publish HTML, schema/core/storage/client scripts, runtime and all historical SW
URLs together, and invalidate the changed original SW/HTML URLs at the CDN.
Do not roll back to the unsafe worker. The client never forces a mid-game page
reload. Already-open offline legacy HTML cannot be remotely repaired instantly;
the release gate must cover the old HTML/SW to new controller transition.

## Verification and Remaining Gates

Local command after the main agent supplies `fake-indexeddb@6.2.4`:

```sh
node --test tests/game-save.test.cjs tests/game-timestep.test.cjs tests/storage-transactions.test.cjs tests/cloud-queue.test.cjs tests/sw-cache.test.cjs
```

These are VM/Node tests with synthetic identities and fake IndexedDB, not a claim
of full browser or production validation. The main agent owns real client/Worker
integration, independent browser checks across desktop/mobile, nine-game play
smoke tests, old SW upgrade, offline PWA behavior and available WebKit/device
checks. No production writes, deployment, commit or push were performed here.
