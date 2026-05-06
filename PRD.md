# Sales Workflow PRD

**Status:** Build spec
**Scope:** A Google Sheets workbook with an Apps Script project that runs a sales appointment workflow dashboard. The system is built fresh with no preexisting data. Active customers only.

---

## 1. Purpose

A sales appointment workflow system that:

- Ingests appointment bookings from external sources through a normalized intake pipeline.
- Generates and routes role-specific tasks for Client Advisors, JOC users, Diamond Order Admins, Diamond Order Assistants, and Admins.
- Powers a web-based dashboard for task completion, customer search, calendar, admin pipeline, diamond inventory and tracking, schedules, and user management.
- Stores customer, appointment, status, 3D order, diamond viewing, wax, task, artifact, and per-stone diamond data in domain-specific tabs.
- Integrates with external workbooks for the payment ledger, 3D tracker, and quotation; with Drive for folders and uploads; and with AssemblyAI and OpenAI for appointment recording transcription and summary generation.

The system is built to keep dashboard reads under target latencies, keep user-facing writes free of contention with background jobs, and prevent data drift by giving every fact exactly one home.

---

## 2. Goals And Non-Goals

### 2.1 Goals

- Stand up a Google Spreadsheet with an Apps Script project bound to it.
- Ship the full dashboard surface: My Queue, Calendar, Customer Search, Customer Pipeline (Admin Dashboard), In-Stock Diamonds, Diamond Tracking, Bulk Returns, JOC Coverage, Admin Review, Cleanup, Schedules, Manage Users.
- Store every canonical fact in exactly one domain tab keyed by `RootApptID`, `APPT_ID`, or `CertNo` for stones.
- Define an explicit lock model with short, scoped locks for user writes and separate locks for background work.
- Build all sheets, columns, named ranges, dropdowns, and protections from versioned setup functions. No manual sheet edits are permitted.
- Build a normalized intake pipeline that is decoupled from any specific booking source, with test injection support from day one.
- Wire the AssemblyAI and OpenAI artifact pipeline through a clear adapter so the workflow can use AI summaries without owning the model interactions.

### 2.2 Non-Goals

- No customer history is loaded at launch. The system starts empty.
- The payment ledger workbook, 3D tracker workbook, quotation workbooks, and client report workbooks remain external sources, accessed through adapters.
- Acuity, Calendly, AssemblyAI, OpenAI, and Drive are external services accessed through adapters; their internals are not rebuilt here.
- Live booking-source integrations (Acuity poller, Calendly webhook handler) are deferred to a later phase. Initial build uses test-injected bookings against the normalized intake API.
- No reminders subsystem at launch.
- No legacy sheet menus, bound dialogs, or `onEdit` writers. The dashboard is the only write surface.
- No new dashboard features beyond what is specified here. Feature additions wait until after the system is operating.

---

## 3. Architectural Principles

Eight principles. Every decision in this PRD descends from these.

1. **One fact, one home.** Every canonical fact lives in exactly one tab and one column. Caches are explicitly labeled and never written by user actions.

2. **Dashboard is the only write surface.** No sheet menus. No bound dialogs. No `onEdit` writers. Writes go through server functions called from the dashboard, the orchestrator, or the intake pipeline.

3. **Setup is code, not clicks.** Tabs, headers, named ranges, dropdowns, protections, conditional formatting, and triggers are created by versioned setup functions. The workbook can be reconstructed from an empty spreadsheet by running a single setup function.

4. **Locks are short and scoped.** User-facing writes hold the document lock under 500ms. Background jobs use named script locks per job and acquire the document lock only for individual `setValues` calls.

5. **Read directly from canonical tabs, with cache in front.** No separate read model tabs at launch. Dashboard endpoints serve from CacheService where possible, fall through to direct canonical reads. Slice builders are designed so read model tabs can be added later as a non-breaking optimization.

6. **Resolve through helpers, never directly.** Code reads facts via domain repositories (`Appointments.getCurrent(rootId)`, `Status.get(rootId)`, etc.), never via `getRange().getValues()` on canonical tabs. Schema changes become one-file refactors.

7. **Append-only history is sacred.** History tabs are written but never updated or deleted by application code. Repair scripts that touch history are admin-only and require explicit confirmation.

8. **Every write declares what it invalidates.** A write returns a structured invalidation list. Cache layer consumes that list. There is no "rebuild everything" path on the hot write path.

---

## 4. Workbook And Project Layout

### 4.1 Spreadsheet

A Google Spreadsheet shared with the operations Drive group.

### 4.2 Apps Script Project

A standalone Apps Script project bound to the workbook. All triggers installed by setup functions.

### 4.3 File Organization

Files grouped by responsibility, with strict numbered prefixes. A file may only call functions defined in lower-numbered prefixes or its own prefix. API files call services, services call repos, repos read and write canonical tabs. A repo may not call a service. A service may not write to a tab directly. This is enforced by code review and by a static check function.

| Prefix | Purpose | Example Files |
|---|---|---|
| `00_Setup_` | Workbook construction, schema versioning, trigger installation | `00_Setup_Schema.gs`, `00_Setup_Triggers.gs`, `00_Setup_Dropdowns.gs` |
| `01_Const_` | Tab names, column maps, enums, role permissions | `01_Const_Tabs.gs`, `01_Const_Columns.gs`, `01_Const_Enums.gs`, `01_Const_Permissions.gs` |
| `02_Util_` | Pure utilities, no sheet I/O | `02_Util_Time.gs`, `02_Util_Strings.gs`, `02_Util_Hashing.gs`, `02_Util_IntakeNormalize.gs` |
| `03_Lock_` | Lock primitives | `03_Lock_DocLock.gs`, `03_Lock_NamedLock.gs` |
| `04_Repo_` | Domain repositories — only files that read/write canonical tabs | `04_Repo_Appointments.gs`, `04_Repo_RootAppointments.gs`, `04_Repo_CustomerInfo.gs`, `04_Repo_ClientStatus.gs`, `04_Repo_Order3D.gs`, `04_Repo_DiamondViewing.gs`, `04_Repo_Wax.gs`, `04_Repo_Tasks.gs`, `04_Repo_Stones.gs`, `04_Repo_Artifacts.gs`, `04_Repo_Users.gs`, `04_Repo_Schedules.gs` |
| `05_Ext_` | External workbook and service adapters | `05_Ext_PaymentLedger.gs`, `05_Ext_TrackerWorkbook.gs`, `05_Ext_QuoteWorkbook.gs`, `05_Ext_Drive.gs`, `05_Ext_AssemblyAI.gs`, `05_Ext_OpenAI.gs`, future: `05_Ext_Acuity.gs`, `05_Ext_Calendly.gs` |
| `06_Service_` | Business logic — orchestrates repos and adapters, no direct sheet I/O | `06_Service_Intake.gs`, `06_Service_TaskGeneration.gs`, `06_Service_TaskCompletion.gs`, `06_Service_Diamonds.gs`, `06_Service_Payments.gs`, `06_Service_Artifacts.gs` |
| `07_Cache_` | CacheService wrappers, slice builders, TTL policies | `07_Cache_Slices.gs`, `07_Cache_CustomerDetail.gs`, `07_Cache_TaskList.gs`, `07_Cache_Diamonds.gs` |
| `08_Api_` | Dashboard-callable functions | `08_Api_Bootstrap.gs`, `08_Api_Tasks.gs`, `08_Api_Customers.gs`, `08_Api_Calendar.gs`, `08_Api_Admin.gs`, `08_Api_Diamonds.gs`, `08_Api_Payments.gs`, `08_Api_Intake.gs` |
| `09_Web_` | HtmlService entry, client bundle | `09_Web_App.gs`, `Index.html` |
| `10_Trigger_` | Time-driven and event triggers | `10_Trigger_TaskGen.gs`, `10_Trigger_Artifacts.gs`, `10_Trigger_CachePrewarm.gs`, future: `10_Trigger_Acuity.gs`, `10_Trigger_Calendly.gs` |
| `11_Diag_` | Diagnostics, benchmarks, drift checks, architecture rule check, test injection | `11_Diag_Benchmarks.gs`, `11_Diag_ArchitectureRules.gs`, `11_Diag_DriftCheck.gs`, `11_Diag_TestIntake.gs` |

---

## 5. Canonical Domain Model

### 5.1 Tab Inventory

| Tab Name | Type | Key | Owns |
|---|---|---|---|
| `01_AppointmentEvents` | Canonical, append-only per event | `APPT_ID` | Appointment date/time, visit type, active/canceled/rescheduled state, booked/canceled/rescheduled timestamps, `BookingSource`, `ExternalBookingId`, source metadata |
| `02_RootAppointments` | Canonical, one row per root | `RootApptID` | Current active `APPT_ID`, latest appointment pointer, root lifecycle state, root version |
| `03_CustomerInfo` | Canonical, one row per root | `RootApptID` | Customer name, phone, email, brand, Client Advisor and JOC owner names and emails, customer folder URLs, lead identity |
| `04_ClientStatus` | Canonical, one row per root | `RootApptID` | Sales stage, conversion status, custom order status, in-production status, center stone status, next steps, order date, 3D deadline, deadline move count, deadline metadata |
| `04_ClientStatusHistory` | Canonical, append-only | History row ID + `RootApptID` | Status field changes, deadline changes, actor, timestamp, source |
| `05_Order3D` | Canonical, one row per root | `RootApptID` | SO number, Odoo URL, design request, 3D tracker URL, order folder links, current 3D workflow state |
| `05_Order3DHistory` | Canonical, append-only | History row ID + `RootApptID` | Revision submissions, tracker/order field changes, actor, timestamp |
| `05_WaxRequests` | Canonical | `WaxRequestID` | Wax request rows, status, admin deadline, request URL |
| `06_DiamondViewing` | Canonical, one row per root | `RootApptID` | DV customer requirements, variety strategy, looking-for summary, root-level DV workflow state |
| `_Stones` | Canonical | `CertNo` | Per-stone facts: vendor, lab, certificate, shape, carat, color, clarity, cut, polish, symmetry, fluorescence, measurements, ratio, stone status, order status, decision, return due date, tracking ETA, tracking status, carrier, tracking number, tracking URL, memo/invoice date, ordered by, purchased/ordered date, last tracking check, JOC handoff, assignment to root, holder, return notes |
| `_StonesSync` | Canonical, append-only | Sync ID | Loupe360 sync history: sync ID, file ID, applied at, applied by, source rows, matched, updated, appended, skipped, conflicts, sync notes |
| `_TaskQueue` | Canonical | `TaskID` | Task state, owner, snooze, completion |
| `_TaskLog` | Canonical, append-only | Auto-id | Task lifecycle events |
| `_AppointmentArtifacts` | Canonical | `ArtifactID` | Recording, transcript, summary, AI brief metadata |
| `_Users` | Canonical | Email | Workflow users, roles, active state, hashed password |
| `_RosterSchedule` | Canonical | Email + week | Recurring schedule rows |
| `_ScheduleChanges` | Canonical, append-only | Auto-id | One-off availability overrides |
| `_Config` | Canonical | Section + Key | Feature flags, config values, role definitions, dropdown values |
| `_Templates` | Canonical | Template Key | Task templates, copyable messages |
| `_DataCleanup` | Canonical | Case ID | Cleanup campaign cases |
| `_IntakeQueue` | Canonical | `IntakeID` | Normalized intake payloads queued for processing, with status, error, processed-at |
| `_DataFlowRef` | Generated reference | Column ref | Every column, its owner repo, its read sources, its invalidation rules. Built by code, read by humans. |
| `_SchemaVersion` | Self-managed | Single row | Current schema version, last setup run, migration history |
| `_OpsLog` | Append-only | Auto-id | Lock waits, lock holds, write events, errors. Trimmed to last N days. |

There are no `_RM_*` read model tabs at launch. Read serving uses CacheService in front of direct canonical reads. Read model tabs may be added later as a non-breaking optimization (see Section 7.4).

### 5.2 Field-Level Ownership

Every column in every tab is assigned to exactly one repo. `01_Const_Columns.gs` defines headers as code constants. `_DataFlowRef` is regenerated on every setup run from those constants.

Non-obvious ownership decisions:

| Fact | Lives In | Notes |
|---|---|---|
| 3D deadline (current value) | `04_ClientStatus` | Sole canonical home. |
| 3D deadline change history | `04_ClientStatusHistory` | Every change appended. |
| Task snooze (rep waiting on data) | `_TaskQueue` | Independent of deadline. Moves task due date, not the deadline. |
| Customer folder URL | `03_CustomerInfo` | Single home. Repaired by URL repair service if missing. |
| Appointment outcome (no-show, completed) | `01_AppointmentEvents` | Event-level fact. |
| Order total (from quote) | Computed at read time | Derived from saved quote subtotal in quote workbook. Cached in CacheService. Not stored in v3 tabs. |
| Paid-to-date / balance | Computed at read time | Derived from payment ledger workbook. Cached in CacheService. Not stored in v3 tabs. |
| Sales stage at payment time | `04_ClientStatus` | Payment service updates `04_ClientStatus` if a payment triggers a stage change. |
| Wax status (current) | `05_WaxRequests` | Sole home. No mirror to any other tab. |
| Owner assignment | `03_CustomerInfo` | Single home. Task queue reads from here on every generation. |
| Per-stone diamond facts | `_Stones` | Internal canonical tab. Diamond Order Admin and Assistant write here through the dashboard. |
| Stone-to-root assignment | `_Stones.AssignedRootApptID` | Single home. Diamond Viewing reads from here. |
| Loupe360 sync history | `_StonesSync` | Append-only audit. Each apply produces one row. |
| Individual payment rows | Payment ledger workbook | External, accessed through adapter. |

---

## 6. Lock Model

This section is the most important technical contract in the system. Every engineer must understand it before writing a repo or service.

### 6.1 What Sheets Locks Actually Provides

Apps Script offers `LockService.getDocumentLock()`, `LockService.getScriptLock()`, and `LockService.getUserLock()`. None are per-tab. Document and script locks both serialize across the entire workbook or project. The architecture treats this as a hard constraint.

### 6.2 Three Lock Tiers

**Tier A — User Write Lock (document lock).**
Acquired by user-initiated mutations from the dashboard. Target hold time: under 200ms. Hard timeout: 500ms. If the lock cannot be acquired in 500ms, the API function returns `{ ok: false, retry: true, reason: 'busy' }` and the client retries once after one second. After two failed attempts the user sees a "system busy, try again" message.

Inside a Tier A lock the function may only:
- Read the target row(s) by direct range access.
- Compare version numbers.
- Write the target range.
- Append history rows.

It must not:
- Iterate over a full tab.
- Call external workbooks.
- Call `UrlFetchApp`.
- Call Drive operations beyond reading a stable file ID.
- Run task generation.

**Tier B — Background Job Lock (named script lock).**
Each background job has its own named lock implemented via `_Config` rows or PropertiesService. Tier B locks coordinate background jobs with each other but do not block Tier A user writes. Tier B jobs briefly acquire the document lock for individual `setValues` calls (because they have to), but never hold the document lock across job phases.

Tier B jobs:
- Intake queue drain
- Task generation
- URL repair
- Cache prewarm
- Drift check
- Artifact processing tick (poll AssemblyAI, run summary generation)
- Future: Acuity poll, Calendly webhook intake landing

Each Tier B job:
- Acquires its named lock.
- Does prep work outside any sheet lock.
- Acquires document lock only for individual `setValues` writes, holding under 200ms each, releasing between writes.
- Releases its named lock.

**Tier C — Admin / Setup Lock.**
Held by `00_Setup_*` functions and admin repair scripts. Acquires document lock for the duration. Blocks everything. Run manually by an admin during low-activity periods. Logs a banner to `_OpsLog` before and after.

### 6.3 Intake Drain

The intake queue drain trigger checks an "intake drain" flag in `_Config` and skips dependent jobs (specifically task generation) for 30 seconds after intake processing completes. This prevents task generation from running while a fresh appointment is still landing.

### 6.4 Optimistic Concurrency

Every domain row has a `Version` integer column. Every Tier A write reads the current version, compares to the version the client sent, and rejects with `{ ok: false, conflict: true, latest: <slice> }` if they differ. The dashboard surfaces the latest values to the user and prompts them to redo the change.

Reads outside locks return both data and version. Writes inside locks check version.

---

## 7. Cache Layer And Slice Builders

### 7.1 Two Tiers At Launch

1. CacheService entry per slice + key. TTL 5 minutes for hot slices, 1 minute for fast-changing.
2. Direct canonical repo read.

Writes invalidate CacheService entries via the invalidation list returned by every mutation. There is no third tier at launch.

### 7.2 Cached Slices

| Slice | Used By | Built From |
|---|---|---|
| `TaskListSlice` | My Queue, Cleanup, Coverage, Admin Review | `_TaskQueue` filtered by owner + `03_CustomerInfo` mini |
| `TaskDetailSlice` | Task drawer | `_TaskQueue` row + task-type-specific mini |
| `CustomerCardSlice` | Customer Search list, Kanban, Admin Pipeline cards | `02`–`06` mini |
| `CustomerRootDetailSlice` | Customer detail drawer (and shared by Calendar expanded detail, Admin Pipeline detail, task customer panel) | `02`–`06` full + `_TaskQueue` filtered + `_Stones` by root + payment summary + artifacts |
| `CalendarMonthSlice` | Calendar | `01_AppointmentEvents` filtered by month |
| `AppointmentBriefSlice` | Calendar event detail, AI brief | `01_AppointmentEvents` + `_AppointmentArtifacts` |
| `AdminHealthSlice` | Admin Dashboard | All domain + payment summary + task summary |
| `DiamondInventorySlice` | In-Stock Diamonds | `_Stones` filtered to in-stock |
| `DiamondTrackingSlice` | Diamond Tracking, Bulk Returns | `_Stones` filtered to active orders/returns |
| `DiamondRootSlice` | Customer detail diamond section, proposal workspace | `_Stones` filtered by `AssignedRootApptID` |
| `PaymentSummarySlice` | Payment dialog, customer detail finance, admin receivables | Payment ledger workbook |
| `FormOptionsSlice` | All forms and dialogs | `_Config` + `_Templates` |

### 7.3 Slice Builder Pattern

Every dashboard read goes through a slice builder. Slice builder signatures are stable across implementations so adding a read model tab later does not require changes to API or web code.

Pattern:

```javascript
// 07_Cache_CustomerDetail.gs
function buildCustomerCardSlice(rootApptId) {
  return cacheGetOrSet(`card:${rootApptId}`, 300, () => {
    return assembleCustomerCardFromCanonical(rootApptId);
  });
}

function assembleCustomerCardFromCanonical(rootApptId) {
  return {
    identity: Repos.CustomerInfo.get(rootApptId),
    currentAppointment: Repos.RootAppointments.getCurrent(rootApptId),
    status: Repos.ClientStatus.get(rootApptId),
    order3d: Repos.Order3D.get(rootApptId),
    wax: Repos.Wax.latestForRoot(rootApptId),
    diamondViewing: Repos.DiamondViewing.get(rootApptId),
    stones: Repos.Stones.summaryByRoot(rootApptId),
    finance: Cache.paymentSummary(rootApptId)
  };
}
```

If a read model tab is added later, only `buildCustomerCardSlice` changes — it tries the read model first, falls back to canonical assembly. Callers never see the change.

This pattern is mandatory for every slice. Even if a slice today only assembles from one source, it goes through a builder so the future optimization path is clean.

### 7.4 Read Model Tabs (Future)

Read model tabs are deferred. They are added when benchmarks for cross-root reads (Customer Search, Admin Dashboard, Diamond Tracking lists) exceed targets. Single-customer reads stay on CacheService + canonical because they are already fast enough.

When added, read model tabs follow the same setup-as-code rules. They are derived projections, never written by user actions, rebuilt by a Tier B dirty consumer that reads dirty roots from a small queue tab.

The most likely future read model tabs, in order of likelihood:

1. `_RM_CustomerCard` — for Customer Search list and Admin Pipeline cards.
2. `_RM_Admin` — for Admin Dashboard cross-cutting metrics.
3. `_RM_DiamondTracking` — for the diamond tracking list view.

Do not build these at launch. Verify benchmarks first.

### 7.5 Shared Customer Detail

The shared `CustomerRootDetailSlice` is the most important contract. **Every "show me the customer" view in the dashboard reads from this single slice through one builder.** Customer Search detail, Calendar's expanded customer detail, Admin Pipeline detail, and the customer panel inside the task drawer all call the same builder. Only `07_Cache_CustomerDetail.gs` is allowed to assemble customer detail payloads.

Modes:

| Mode | Surfaces | Sections Included |
|---|---|---|
| `card` | Customer Search list/Kanban cards, Admin Pipeline cards | identity, owners, current appointment summary, status badges, SO, 3D deadline, wax badge, balance |
| `standard` | Calendar expanded customer detail | `card` + appointment links, AI brief snippet |
| `full` | Customer detail drawer | all sections + form options for actions |
| `taskMini` | Task drawer customer panel | only fields the task type needs |

Sections and their canonical sources:

| Section | Source |
|---|---|
| `identity` | `03_CustomerInfo` |
| `currentAppointment` | `02_RootAppointments` + `01_AppointmentEvents` |
| `status` | `04_ClientStatus` |
| `statusHistory` | `04_ClientStatusHistory` |
| `order3d` | `05_Order3D` |
| `order3dHistory` | `05_Order3DHistory` |
| `diamondViewing` | `06_DiamondViewing` + `_Stones` by root |
| `wax` | `05_WaxRequests` (latest by root) |
| `finance` | Payment ledger summary |
| `artifacts` | `_AppointmentArtifacts` |
| `tasks` | `_TaskQueue` filtered by root |
| `recentActivity` | `_TaskLog` + domain history tabs (last 30 days) |

### 7.6 Cache Prewarming

A 5-minute Tier B job prewarms CacheService entries for:
- Active task queue slices for active users.
- The current calendar month.
- The admin dashboard slice.
- Diamond inventory and tracking slices.

Keeps hot reads sub-second after CacheService eviction.

---

## 8. Intake Pipeline

Intake creates roots and appointments — the foundation everything else depends on. The pipeline is designed to be source-agnostic so booking source integrations can be added incrementally without changing core logic.

### 8.1 Architecture

Three layers:

```
[Source adapter] → [Normalized IntakePayload] → [Intake service] → [Domain repos]
```

- **Source adapters** translate booking source payloads into the normalized shape. Each source has its own adapter; adapters are added as sources come online.
- **Normalized IntakePayload** is a single shape that the intake service consumes. The intake service does not know or care which source produced it.
- **Intake service** handles dedup, root resolution, reschedule detection, event creation, owner inheritance, and downstream invalidation.

This decoupling means the intake service can be built and fully tested before any source adapter exists. Test injection (Section 8.5) drives the pipeline with synthetic payloads.

### 8.2 Normalized IntakePayload Shape

```javascript
{
  // Identity
  bookingSource: 'acuity' | 'calendly' | 'manual' | 'test',
  externalBookingId: string,                  // source's native ID; required for non-manual
  externalRescheduledFromId: string | null,   // when the source reports a reschedule chain

  // Action signal
  action: 'create' | 'edit' | 'reschedule' | 'cancel' | 'status_change',

  // Customer
  customerName: string,
  firstName: string,
  lastName: string,
  email: string,
  phone: string,
  brand: string,                              // 'HPUSA' | 'VVS' | other

  // Appointment
  visitDateTime: string,                      // ISO 8601 with timezone
  visitType: string,
  duration: number,
  location: string,
  source: string,                             // marketing source attribution

  // Status (optional, for status_change action)
  status: 'active' | 'canceled' | 'rescheduled' | 'completed' | 'no_show' | null,

  // Lead context (optional, captured at booking)
  budgetRange: string,
  diamondType: string,
  styleNotes: string,
  referenceLinks: string,

  // Audit
  receivedAt: string,                         // ISO timestamp when the adapter received this
  rawPayload: object                          // original payload for audit; stored on event row
}
```

Every adapter outputs this shape. Every intake call accepts this shape.

### 8.3 ID Strategy

Two identity layers:

1. **External booking identity:** `(BookingSource, ExternalBookingId)` stored on every `01_AppointmentEvents` row. Each source's native ID is stored as-is.
2. **Internal identity:** `APPT_ID` is a generated v3 ID for each event row. `RootApptID` groups events for the same customer journey.

The system **does not synthesize** UIDs. Reschedules do not create synthetic UIDs. Reschedule chains are tracked by `RescheduledFrom` / `RescheduledTo` pointers between `APPT_ID` values. Each event row stores the actual booking source ID for that specific appointment.

`(BookingSource, ExternalBookingId)` is unique. Calendly and Acuity can independently issue identical-looking IDs without collision because they live in different rows distinguished by `BookingSource`.

### 8.4 Intake Service

`06_Service_Intake.gs` exposes one entry point and several pure-function helpers.

**Entry point:**

```javascript
Intake.process(payload) → { ok, action, rootApptId, apptId, invalidated, version }
```

Behavior depends on `payload.action`:

| Action | Behavior |
|---|---|
| `create` | Resolve or create root → create new event row → update root pointer → init customer info if new → init client status if new |
| `edit` | Find event by `(BookingSource, ExternalBookingId)` → update fields in place |
| `reschedule` | Find prior event by `(BookingSource, externalRescheduledFromId)` → mark prior rescheduled → create new event with same root → set `RescheduledFrom`/`RescheduledTo` pointers → inherit owner |
| `cancel` | Find event by `(BookingSource, ExternalBookingId)` → mark canceled |
| `status_change` | Find event by `(BookingSource, ExternalBookingId)` → update status field only |

**Helpers (all pure, all individually testable):**

- `Intake.matchExistingByExternalId(source, externalId)` → returns event or null
- `Intake.matchByContact(email, phone, brand)` → returns root or null (fallback for `create` when no external id match)
- `Intake.resolveOrCreateRoot(payload)` → returns `{ rootApptId, isNew }`
- `Intake.classifyChange(existingEvent, payload)` → returns the action that should be applied (used to validate adapter-supplied action against actual diff)
- `Intake.shouldInheritOwners(payload, priorEvent)` → boolean

### 8.5 Test Injection

`08_Api_Intake.gs` exposes admin-only test injection:

```
Api.intake.injectTest(payload)
```

This calls `Intake.process(payload)` directly with `bookingSource: 'test'`. Used during build to drive the entire downstream pipeline (root creation, task generation, customer detail rendering, status updates) without any external integration.

`11_Diag_TestIntake.gs` provides scripted test scenarios:

- New booking, fresh customer
- New booking, existing customer (matched by email + phone + brand)
- Reschedule chain A → B → C
- Cancellation of an active appointment
- Cancellation of a rescheduled appointment (only the active one cancels)
- Field edit on a confirmed appointment
- Status change to no-show
- Status change to completed
- Edge: same email different phone (configurable: separate roots vs. merge)
- Edge: idempotent duplicate `ExternalBookingId` submission
- Edge: very fast reschedule (two reschedules within seconds)

These scenarios run automatically and report pass/fail. They are the gate for marking intake complete.

### 8.6 Source Adapters (Future Work)

Source adapters are added when ready. Each adapter provides:

- A function that fetches or receives source events.
- A function that translates source payloads to `IntakePayload`.
- A trigger or webhook handler that orchestrates fetch → translate → `Intake.process`.

**Acuity (planned):** Tier B poll trigger every 5 minutes calls `Acuity.fetchActiveAndCanceled(window)`, translates each result, calls `Intake.process` for each.

**Calendly (planned):** webhook handler if the Calendly account tier supports them; otherwise a Tier B poll trigger. Either way, the adapter translates Calendly events to `IntakePayload` and calls `Intake.process`.

**Manual entry:** an admin form on the dashboard that submits an `IntakePayload` with `bookingSource: 'manual'`.

The intake service is ready before any of these are built. Adding a new source is a self-contained adapter file plus its trigger.

### 8.7 Drive Folder Creation

After intake creates a new root, downstream work (Drive folders, Chat notifications, DV initialization) is enqueued for processing outside the intake transaction. Folder creation is idempotent: the service checks for existing folder ID first.

---

## 9. Task System

### 9.1 Task Generation

A Tier B job, runs every 5 minutes, named lock `taskgen`. Steps:

1. Read all active appointments from `01_AppointmentEvents` joined with `02_RootAppointments`, `03_CustomerInfo`, `04_ClientStatus`, `05_Order3D`, `05_WaxRequests`, `06_DiamondViewing`, `_Stones` (by root). Read outside any sheet lock.
2. Read current task state from `_TaskQueue`.
3. Read users, roster, schedule changes for owner resolution.
4. For each appointment, evaluate task generation rules and produce a desired task set.
5. Diff desired vs current task state, producing a list of upserts and blocks.
6. Acquire document lock briefly per upsert/block, release between writes.
7. Append to `_TaskLog` and invalidate caches.

Generation logic in `06_Service_TaskGeneration.gs` as testable pure functions:

- `TaskGen.coreAppointmentTasks(appointment, status, artifacts)` → desired tasks
- `TaskGen.postConsultTasks(appointment, status, order3d)` → desired tasks
- `TaskGen.diamondTasks(appointment, dv, stonesByRoot)` → desired tasks
- `TaskGen.dataCleanupTasks(root, customerInfo, status)` → desired tasks
- `TaskGen.diff(desired, current)` → `{ upserts, blocks }`

### 9.2 Task Types

**Core appointment sequence:**

| Task | Owner | Created When |
|---|---|---|
| `ASSIGN_APPOINTMENT` | System | every relevant appointment; auto-completed |
| `SEND_HYBRID_WELCOME` | JOC | appointment is within hybrid window |
| `SEND_WELCOME` | JOC | appointment is farther out |
| `SEND_MAP_INSTRUCTIONS` | JOC | appointment has visit time, due 48h before |
| `REVIEW_APPOINTMENT` | Client Advisor | appointment has visit time, due 24h before |
| `APPOINTMENT_DAY_CHECKLIST` | Client Advisor | appointment day |
| `APPROVE_RECAP_MESSAGE` | Client Advisor | checklist complete, not no-show, AI summary ready |
| `SEND_FINAL_RECAP` | JOC | recap approved |

**Post-consult sequence:**

| Task | Owner | Created When |
|---|---|---|
| `POST_CONSULT_CLIENT_STATUS` | JOC | appointment day checklist completed |
| `START_3D_DESIGN` | JOC | status complete, 3D needed, SO not present |
| `RECORD_3D_DEADLINE` | JOC | 3D started and no deadline present |
| `REQUEST_WAX_PRINT` | JOC | wax needed and no active wax request |
| `UPDATE_WAX_REQUEST` | JOC | wax request needs update |

**Diamond sequence:**

| Task | Owner | Created When | Reads From |
|---|---|---|---|
| `PROPOSE_DIAMONDS` | Client Advisor | DV workflow active | `06_DiamondViewing` |
| `PREPARE_DV_QUOTATION` | JOC | DV workflow active | `_Stones` by root |
| `ORDER_DIAMONDS` | Diamond Order Admin (role queue) | any stone has `OrderStatus = Proposing` for the root | `_Stones` |
| `TRACK_DIAMONDS` | Diamond Order Assistant (role queue) | any stone has `OrderStatus = On the Way` for the root | `_Stones` |
| `CONFIRM_DIAMOND_DELIVERY` | Diamond Order Admin (role queue) | any stone has `OrderStatus = On the Way` and arrived | `_Stones` |
| `ACK_DIAMONDS_ORDERED_ASSIGNED_REP` | Client Advisor | ordered acknowledgement needed | `_Stones` |
| `ACK_DIAMONDS_ORDERED_JOC` | JOC | ordered acknowledgement needed | `_Stones` |
| `RECORD_DIAMOND_DECISIONS` | JOC | stones delivered/in stock, decisions due | `_Stones` |
| `RETURN_DIAMONDS` | Diamond Order Assistant (role queue, also actionable by Admin) | stones marked Return are due soon or overdue | `_Stones` |
| `REVIEW_DIAMOND_ETA_ASSIGNED_REP` | Client Advisor | ETA risk: tracking delayed/concerning/unavailable/canceled or later than appointment | `_Stones` |
| `REVIEW_DIAMOND_ETA_JOC` | JOC | ETA risk same as above | `_Stones` |

Diamond tasks are **role queue tasks** — visible to anyone with the role rather than assigned to a specific person. Diamond Order Admin can also act on `RETURN_DIAMONDS` even though that task is owned by the Assistant role.

**Data cleanup sequence:**

| Task | Owner | Purpose |
|---|---|---|
| `CUSTOMER_DATA_CLEANUP_REVIEW` | Client Advisor or JOC | review stale customer record |
| `CUSTOMER_DATA_CLEANUP_CONFIRM` | Admin | confirm or return cleanup proposal |
| `CUSTOMER_DATA_CLEANUP_REVISE` | Client Advisor or JOC | revise returned cleanup proposal |

### 9.3 Task Completion

Called from the dashboard via `Api.tasks.complete(taskId, payload, version)`. Steps:

1. Authenticate user, check `Tasks.canActOn(taskId, user)`.
2. Validate completion via task-type-specific validator.
3. Acquire Tier A lock.
4. Re-read task row, check version.
5. Run task-type-specific writeback through the appropriate domain repo:
   - Client status task → `04_Repo_ClientStatus.update(...)` + `04_Repo_ClientStatus.appendHistory(...)`
   - Start 3D task → `04_Repo_Order3D.update(...)` + `04_Repo_Order3D.appendHistory(...)`
   - 3D deadline task → `04_Repo_ClientStatus.updateDeadline(...)` + history
   - Wax request task → `04_Repo_Wax.create(...)`
   - `PROPOSE_DIAMONDS` → `04_Repo_Stones.upsertProposed(...)` + `04_Repo_DiamondViewing.update(...)`
   - `ORDER_DIAMONDS` → `04_Repo_Stones.markOrdered(stoneIds, { orderedDate, orderedBy })` for each approved stone
   - `TRACK_DIAMONDS` → `04_Repo_Stones.updateTracking(stoneIds, { eta, status, carrier, trackingNumber, url, notes })` + stamp last tracking check
   - `CONFIRM_DIAMOND_DELIVERY` → `04_Repo_Stones.markDelivered(stoneIds, { memoDate })` (sets delivered, merges in stock, computes return due date = ordered + 30d)
   - `RECORD_DIAMOND_DECISIONS` → `04_Repo_Stones.recordDecisions(rootApptId, decisions)`
   - `RETURN_DIAMONDS` → `04_Repo_Stones.markReturnInProgress(stoneIds, notes)`
   - Appointment checklist → `04_Repo_Appointments.recordOutcome(...)` + `04_Repo_Artifacts.markRequirement(...)`
   - Approve recap → `04_Repo_Artifacts.markApproved(...)`
   - Send final recap → `04_Repo_Artifacts.markHandoff(...)`
6. Mark task `Completed` in `_TaskQueue`.
7. Append `COMPLETE` event to `_TaskLog`.
8. Invalidate affected cache entries (including `DiamondInventorySlice`, `DiamondTrackingSlice`, `DiamondRootSlice` for diamond writes).
9. Release Tier A lock.
10. Return refreshed `TaskListSlice` and `CustomerRootDetailSlice` for the affected root.

User does not wait for task generation to refresh. The next Tier B task-gen run reconciles new tasks within 5 minutes; meanwhile, the dashboard already reflects the completed task.

### 9.4 Task Snooze

Independent of any deadline. Updates `_TaskQueue` snooze fields only. Does not update `04_ClientStatus`. Does not change task generation behavior; the next task-gen run sees the snooze and respects it.

---

## 10. Diamond Order Workflow

The diamond order workflow has its own section because it is the most complex domain in the system. The full lifecycle runs through `_Stones` as the canonical source.

### 10.1 Stone Lifecycle States

`_Stones.OrderStatus` values: `Proposing`, `On the Way`, `Delivered`, `Not Approved`, `Returned`, `Sold`.

`_Stones.StoneStatus` values: `In Stock`, `Out`, `Returned`, `Sold`, with combinations like `In Stock + Delivered` after delivery confirmation.

State transitions:

| From | Event | To | Triggered By |
|---|---|---|---|
| (none) | proposal submitted | `OrderStatus=Proposing` | `PROPOSE_DIAMONDS` task completion |
| `Proposing` | admin approves | `OrderStatus=On the Way` | `ORDER_DIAMONDS` task completion |
| `Proposing` | admin rejects | `OrderStatus=Not Approved` | `ORDER_DIAMONDS` task completion |
| `On the Way` | delivery confirmed | `OrderStatus=Delivered`, `StoneStatus=In Stock`, `ReturnDueDate=ordered+30d` | `CONFIRM_DIAMOND_DELIVERY` task completion |
| `Delivered` | customer decision: purchase | `OrderStatus=Sold`, `StoneStatus=Sold` | `RECORD_DIAMOND_DECISIONS` task completion |
| `Delivered` | customer decision: return | marked for return; `RETURN_DIAMONDS` task created when return due | `RECORD_DIAMOND_DECISIONS` task completion |
| return marked | return shipment | `OrderStatus=Returned`, `StoneStatus=Returned` | `RETURN_DIAMONDS` task completion or Bulk Returns |

### 10.2 Role Access

`DIAMOND_ORDER_ADMIN` and `DIAMOND_ORDER_ASSISTANT` are **role queues**, not person assignments. Tasks are visible to anyone with the role.

| Role | Can Complete Tasks | Dashboard Access |
|---|---|---|
| Diamond Order Admin | `ORDER_DIAMONDS`, `CONFIRM_DIAMOND_DELIVERY`, `RETURN_DIAMONDS` (override) | Diamond Inventory (with assignment + Loupe360 sync), Diamond Tracking, Bulk Returns |
| Diamond Order Assistant | `TRACK_DIAMONDS`, `RETURN_DIAMONDS` | Diamond Inventory (read-only), Diamond Tracking |

Permissions defined in `01_Const_Permissions.gs`.

### 10.3 Loupe360 Sync

Loupe360 is the diamond inventory data source. The dashboard supports preview-and-apply sync from a Loupe360 spreadsheet:

1. Diamond Order Admin uploads a Loupe360 spreadsheet via the dashboard.
2. `Api.diamonds.previewLoupe360Sync(fileId)` returns:
   - Source row count
   - Matched (by `CertNo`)
   - Will update count and field-level diffs
   - Will append count
   - Skipped count and reasons
   - Conflict detection (status overwrites, duplicate certs)
3. Admin reviews preview and approves.
4. `Api.diamonds.applyLoupe360Sync(syncId)` applies changes to `_Stones`, appends a row to `_StonesSync` for audit.

Sync rules:
- Match by `CertNo` exact case.
- Source treated as authoritative for shipment, status, and spec facts.
- Conflicts (e.g., source says On the Way but our row is Delivered) flagged for review, not auto-resolved.

### 10.4 Bulk Returns

Diamond Order Admin only. Lists return-eligible stones (Delivered + In Stock + not purchased + not already returning + with return due date soon or overdue). Admin selects stones, enters shipment notes, submits.

`Api.diamonds.bulkMarkReturnInProgress(stoneIds, note)` marks all selected stones `Return in Progress` in one transaction, appends individual entries to `_TaskLog`.

### 10.5 In-Stock Diamond Assignment

When a stone is held for a specific customer:

1. Admin opens the stone detail in In-Stock Diamonds view.
2. Enters customer name, RootApptID, advisor, JOC.
3. `Api.diamonds.assignInStock(stoneId, rootApptId, fields)` writes `_Stones.AssignedRootApptID` and customer context fields.
4. The stone now appears in that customer's diamond viewing context.

---

## 11. Payments And Document Generation

Payments and their accompanying invoice/receipt documents are a critical financial workflow. The system records every financial event in an external payment ledger workbook and generates brand-specific Google Docs and PDFs for each payment. All payment activity flows through the dashboard. There are no on-sheet dialogs or menu items for payments.

### 11.1 Document Types

Four document types are supported. Each maps to a short code used in template lookups and ledger rows.

| Document Type | Code | Purpose |
|---|---|---|
| Deposit Invoice | `DI` | Issued before deposit collection |
| Deposit Receipt | `DR` | Issued after deposit collection |
| Sales Invoice | `SI` | Final invoice for completed sale |
| Sales Receipt | `SR` | Issued after final payment |

### 11.2 Brands And Tax Modes

Two brands, each with its own template family.

**HPUSA:** four templates, one per doc type. Tax mode does not affect template selection for HPUSA; tax handling is encoded in the ledger calculation, not in the template.

**VVS:** eight templates — one tax variant and one no-tax variant per doc type. Template selection picks the tax or no-tax variant based on the line items' tax flags.

Template Drive file IDs are stored in `_Config` under a deterministic property naming scheme. The template lookup function tries properties in order of specificity and falls through to fallbacks. Template IDs are never hardcoded in service code. Templates are real Google Docs; the generation step calls `DriveApp.getFileById(templateId).makeCopy(...)`.

### 11.3 Template Property Naming

Template IDs live in `_Config` (or Script Properties as fallback) under these property keys:

**HPUSA:**

```
HPUSA_DI_TEMPLATE_ID
HPUSA_DR_TEMPLATE_ID
HPUSA_SI_TEMPLATE_ID
HPUSA_SR_TEMPLATE_ID
```

**VVS (preferred, tax-aware):**

```
VVS_DI_TAX_TEMPLATE_ID
VVS_DI_NOTAX_TEMPLATE_ID
VVS_DR_TAX_TEMPLATE_ID
VVS_DR_NOTAX_TEMPLATE_ID
VVS_SI_TAX_TEMPLATE_ID
VVS_SI_NOTAX_TEMPLATE_ID
VVS_SR_TAX_TEMPLATE_ID
VVS_SR_NOTAX_TEMPLATE_ID
```

**VVS unsuffixed fallbacks:** if no tax-specific template is configured, `VVS_${code}_TEMPLATE_ID` is used.

The `Templates.getId(brand, docType, taxEnabled)` helper in `06_Service_Payments.gs` performs the lookup with this fallback chain:

1. `${brand}_${code}_${TAX|NOTAX}_TEMPLATE_ID` (VVS only)
2. `${brand}_${code}_TEMPLATE_ID`
3. Throws a structured error with the missing key, surfaced to the dashboard.

There are no other fallbacks. If a template is missing, the error names the missing property exactly so the admin can configure it.

### 11.4 Payment Ledger Workbook

The payment ledger remains an external workbook accessed through `05_Ext_PaymentLedger.gs`. Each row represents one financial event: invoice issued, receipt issued, void, or adjustment.

Required columns on the ledger:

| Column | Owner | Notes |
|---|---|---|
| `PaymentId` | Service | Generated UUID-style ID |
| `RootApptID` | Service | Always set |
| `APPT_ID` | Service | Set when the payment is appointment-linked |
| `Brand` | Service | `HPUSA` or `VVS` |
| `DocType` | Service | `DI`, `DR`, `SI`, or `SR` |
| `DocNumber` | Service | Brand- and doc-type-specific incrementing number |
| `IssuedAt` | Service | Timestamp |
| `IssuedBy` | Service | User email |
| `SO` | Service | Sales order number, when applicable |
| `Subtotal` | Service | Computed from line items |
| `ReferralDiscount` | Service | If applicable |
| `TaxRate` | Service | Effective rate |
| `TaxAmount` | Service | Computed |
| `InvoiceTotal` | Service | Subtotal − discount + tax |
| `AmountReceived` | Service | For receipts |
| `Fees` | Service | Processing/wire fees |
| `NetAmount` | Service | After fees |
| `BalanceDue` | Service | Computed against prior balance |
| `Method` | Service | Cash, check, card, wire, etc. |
| `LineItemsJSON` | Service | Stored as JSON for replay |
| `DocFileId` | Service | Drive file ID of generated Google Doc |
| `DocURL` | Service | Drive URL of Google Doc |
| `DocPDFId` | Service | Drive file ID of exported PDF |
| `PDFURL` | Service | Drive URL of PDF |
| `ARShortcutId` | Service | ID of the AR monthly folder shortcut, if created |
| `Status` | Service | `Active`, `Voided`, `Draft` |
| `VoidedAt` | Service | Set on void |
| `VoidedBy` | Service | User email on void |
| `VoidReason` | Service | Free text |

The ledger is the canonical source for individual payments. v3 tabs do not duplicate payment rows.

### 11.5 Submission Flow

The dashboard payment dialog drives this single API call:

```
Api.payments.submit(rootApptId, payload, version)
```

The service implements submission in two internal phases that the API wraps as one operation. The user sees a single submit action.

**Phase 1 — Ledger write (`Payments.submitLedger`):**

1. Authenticate, role-check (Client Advisor, JOC, Admin).
2. Validate payload: required fields, at least one line item, valid doc type, receipt amount present for receipt types.
3. For `Sales Receipt`: call `Payments.checkSalesReceiptPrerequisite(rootApptId)` which scans the ledger for a non-draft, non-void `Sales Invoice` matching the same `(RootApptID, SO)`. Reject if absent.
4. Compute subtotal, referral discount, tax, invoice total, balance due, fees, net amount.
5. Acquire Tier A lock (for v3 tab writes; ledger workbook has its own named lock acquired separately).
6. Generate `PaymentId` and the next `DocNumber` for `(brand, docType)`.
7. Append the row to the ledger workbook through `Ledger.append(...)`.
8. For receipt types, write back to v3 tabs:
   - `04_Repo_ClientStatus.update`: paid-to-date, last payment date, remaining balance, possibly sales stage transition.
   - `04_Repo_RootAppointments.update`: cash-in-gross summary if needed.
9. Append history rows.
10. Release Tier A lock.

**Phase 2 — Document generation (`Payments.generateDoc`):**

1. Re-read the ledger row to confirm `PaymentId` and `Brand`.
2. Resolve destination Drive folder (Section 11.7).
3. Look up template ID via `Templates.getId(brand, docType, taxEnabled)`.
4. Copy template into destination folder via `DriveApp.getFileById(templateId).makeCopy(name, destFolder)`.
5. Open the copied Doc, fill placeholders using the merge data built from the ledger row and payload.
6. Export the Doc to PDF in the same folder.
7. Update the ledger row with `DocFileId`, `DocURL`, `DocPDFId`, `PDFURL`.
8. If AR root folders are configured for the brand, create a shortcut to the PDF in the AR monthly folder. Store `ARShortcutId` on the ledger row.
9. Return the refreshed slice including doc and PDF URLs.

If Phase 2 fails after Phase 1 succeeds, the ledger row exists without doc links. `Api.payments.regenerateDoc(paymentId)` re-runs Phase 2 idempotently. The dashboard surfaces the failure with a regenerate action.

### 11.6 Doc Number Sequencing

Doc numbers are brand- and doc-type-specific incrementing integers. Format example: `HPUSA-DI-002145`, `VVS-SR-000789`.

Sequence state lives in `_Config` under keys `docnumber.${brand}.${code}.next`. The submit flow:

1. Acquires a named script lock `docnumber:${brand}:${code}`.
2. Reads current next value.
3. Writes incremented value back.
4. Releases lock.
5. Uses the value just read for the new doc number.

This guarantees no duplicate doc numbers even under concurrent submits. The lock is separate from the document lock and is held only for the increment operation.

### 11.7 Destination Folder Resolution

`Payments.resolveDestinationFolder(rootApptId, payload)` returns the folder where the new Doc and PDF land.

Resolution order:

1. **Explicit override:** if `payload.paymentsFolderURL` is set, use that folder.
2. **Appointment-linked payment:** find or create `04-Deposit/` under the customer folder identified by `03_CustomerInfo.ClientFolderId`.
3. **SO-linked payment:** for HPUSA, use `Config.get('drive.parent.so.hpusa')`; for VVS, use `Config.get('drive.parent.so.vvs')`. Find or create a brand/SO subfolder, then find or create `04-Deposit/` inside it.

Folder creation is idempotent: the service searches by name within the parent before creating.

### 11.8 AR Monthly Shortcuts

When `Config.get('drive.parent.ar.${brand}')` is set, the service creates a shortcut to the generated PDF in the AR root's monthly folder (`YYYY-MM/`). The monthly folder is created on first use of that month. The shortcut name is `${docNumber} - ${customerName}.pdf.lnk`.

Shortcut creation failures do not fail the submit. They surface as a non-blocking warning logged to `_OpsLog` and shown in the dashboard.

### 11.9 Webhook For iPad Combo Submissions

Some payment submissions need to issue a Sales Invoice immediately followed by a Sales Receipt (the iPad app workflow uses this pattern). The system supports this through `Api.payments.submitCombo(rootApptId, payload, version)`:

1. Build a `Sales Invoice` payload from the input.
2. Call `Payments.submit` for the invoice.
3. Build a `Sales Receipt` payload using the now-existing invoice's number to satisfy the prerequisite check.
4. Call `Payments.submit` for the receipt.
5. Return both ledger rows and both sets of doc links.

If step 4 fails, step 2's invoice remains. The dashboard surfaces a "complete the receipt" action that retries step 3–4.

### 11.10 Document Placeholder Merge

Templates use placeholder tokens like `{{CustomerName}}`, `{{DocNumber}}`, `{{IssuedDate}}`, `{{Subtotal}}`, `{{LineItems}}`. The merge function `Payments.fillPlaceholders(doc, mergeData)` runs in `06_Service_Payments.gs` and replaces tokens via `Document` API calls. Line items render as a table; the template contains a one-row template table with placeholder cells, and the merge function clones rows for each line item.

Placeholder reference (full list lives in `_Config` under `payments.placeholders` so admins can extend without code changes):

| Token | Source |
|---|---|
| `{{CustomerName}}` | `03_CustomerInfo.CustomerName` |
| `{{CustomerAddress}}` | `03_CustomerInfo.Address` (if collected) |
| `{{CustomerEmail}}` | `03_CustomerInfo.Email` |
| `{{Brand}}` | Ledger row |
| `{{DocType}}` | Ledger row, formatted as full name |
| `{{DocNumber}}` | Ledger row |
| `{{IssuedDate}}` | Ledger row |
| `{{SO}}` | Ledger row |
| `{{Subtotal}}` | Ledger row, formatted as currency |
| `{{ReferralDiscount}}` | Ledger row |
| `{{TaxRate}}` | Ledger row, formatted as percentage |
| `{{TaxAmount}}` | Ledger row |
| `{{InvoiceTotal}}` | Ledger row |
| `{{AmountReceived}}` | Ledger row (receipts) |
| `{{BalanceDue}}` | Ledger row |
| `{{Method}}` | Ledger row |
| `{{LineItems}}` | Table merge from `LineItemsJSON` |

### 11.11 Validation And Guardrails

Before any ledger write or doc generation:

- Doc type is one of the four supported values.
- Line items array is non-empty.
- For receipt types, `AmountReceived` is positive and ≤ remaining balance plus a tolerance.
- For `Sales Receipt`, prerequisite check passes.
- Brand is set and matches a configured template family.
- For VVS: tax mode is determinable from line items. If line items mix taxable and non-taxable in a way the template can't handle, the dashboard requires the user to split into separate documents.

The validation function returns structured errors that the dashboard renders inline. Submit is blocked until validation passes.

### 11.12 Voiding And Corrections

`Api.payments.adminVoid(paymentId, reason, version)`:

1. Admin-only.
2. Acquires Tier A lock.
3. Reads ledger row.
4. Sets `Status='Voided'`, `VoidedAt`, `VoidedBy`, `VoidReason`.
5. Reverses receipt-side writebacks: `04_Repo_ClientStatus` paid-to-date and balance recomputed.
6. Does **not** delete the Doc or PDF files.
7. Optionally creates a "VOID" stamped PDF using a void template (configurable).
8. Appends to history.
9. Releases lock.

Corrections (e.g., wrong amount) are handled by voiding the original and creating a new document. There is no edit-in-place for issued documents.

### 11.13 Ledger Read Caching

`Ledger.summary(rootApptId)` returns paid-to-date, balance, last payment date, and the current receipt list. Cached in CacheService for 60 seconds. Invalidated immediately on any payment submit, regenerate, or void for that root.

`Ledger.getByRoot(rootApptId)` returns full payment history. Cached for 60 seconds. Same invalidation rules.

### 11.14 Payment Dialog UI

The payment dialog is a workspace-mode view in the dashboard, accessible from the Customer Detail surface and from a `Process Payment` action on appointment day tasks.

Layout:

1. **Header:** customer, SO, brand, current balance, prior receipts.
2. **Doc type selector:** four cards with eligibility indicators (Sales Receipt grayed out if prerequisite not met, with a tooltip explaining why).
3. **Line items editor:** add/remove rows, each with description, quantity, unit price, taxable flag.
4. **Totals panel:** live-computed subtotal, discount, tax, total, amount received, balance due.
5. **Method and reference:** payment method, check number / wire reference / card last 4 / etc.
6. **Validation messages:** inline.
7. **Submit:** primary button. On success, shows generated Doc and PDF links and `Open Doc` / `Download PDF` actions.

Optimistic UI: the totals panel updates as the user edits. Submit shows loading state while ledger and doc generation happen. On error during doc generation (Phase 2), the UI shows the ledger was saved and offers a `Regenerate Document` button.

---

## 12. Dashboard API Surface

Complete list of `Api.*` functions exposed to the web app.

### 12.1 Auth And Bootstrap

- `Api.auth.login(email, password)` → session + initial bootstrap
- `Api.auth.logout()`
- `Api.bootstrap.get()` → user, visible views, initial My Queue counts

### 12.2 Tasks

- `Api.tasks.list(view)` → `view` ∈ `mine`, `cleanup`, `coverage`, `admin`
- `Api.tasks.detail(taskId)` → task + rendered template + customer mini
- `Api.tasks.complete(taskId, payload, version)`
- `Api.tasks.snooze(taskId, until, reason, version)`
- `Api.tasks.claim(taskId, version)`
- `Api.tasks.acknowledge(taskId, version)`
- `Api.tasks.logTemplateCopied(taskId)`

### 12.3 Customers

- `Api.customers.search(filters)` → list + Kanban
- `Api.customers.getDetail(rootApptId, mode)` → shared detail slice
- `Api.customers.updateStatus(rootApptId, fields, version)`
- `Api.customers.updateDeadline(rootApptId, fields, version)`
- `Api.customers.submit3DRevision(rootApptId, payload, version)`
- `Api.customers.requestWax(rootApptId, payload, version)`
- `Api.customers.startOrder(rootApptId, payload, version)`

### 12.4 Calendar

- `Api.calendar.getMonth(monthKey)` → calendar slice
- `Api.calendar.getAiBrief(rootApptId)` → AI brief

### 12.5 Admin

- `Api.admin.dashboard(filters)` → admin slice
- `Api.admin.assignOwners(rootApptId, advisor, joc, version)`
- `Api.admin.reassignTask(taskId, toUser, version)`
- `Api.admin.blockTask(taskId, reason, version)`
- `Api.admin.unblockTask(taskId, version)`

### 12.6 Schedules And Users

- `Api.schedules.list()`
- `Api.schedules.save(rows)`
- `Api.schedules.upsertChange(row)`
- `Api.schedules.deleteChange(id)`
- `Api.users.list()`
- `Api.users.upsert(user)`

### 12.7 Diamonds

- `Api.diamonds.inStock(filters)` → in-stock list with shape, carat range, color, clarity filters
- `Api.diamonds.tracking()` → tracking dashboard
- `Api.diamonds.bulkReturnCandidates()` → return-eligible stones
- `Api.diamonds.bulkMarkReturnInProgress(stoneIds, notes, version)`
- `Api.diamonds.assignInStock(stoneId, rootApptId, fields, version)`
- `Api.diamonds.byRoot(rootApptId)` → stones for a specific customer
- `Api.diamonds.previewLoupe360Sync(fileId)` → preview of changes
- `Api.diamonds.applyLoupe360Sync(syncId)` → applies preview, returns counts

### 12.8 Payments And Documents

- `Api.payments.init(rootApptId)` → context for payment dialog: SO, brand, tax rate, doc number sequences, saved quote lines, paid-to-date, balance, prior receipts/invoices, eligible doc types
- `Api.payments.validatePrerequisites(rootApptId, docType)` → for `Sales Receipt`, confirms a non-draft non-void Sales Invoice already exists for the same SO/appointment
- `Api.payments.submit(rootApptId, payload, version)` → writes ledger row, generates Doc and PDF, updates ledger with doc IDs, creates AR shortcut. Single atomic-as-possible operation from the user's perspective
- `Api.payments.regenerateDoc(paymentId, version)` → regenerate Doc and PDF from existing ledger row (used when template changed or doc was deleted)
- `Api.payments.history(rootApptId)`
- `Api.payments.getDocLinks(paymentId)` → returns Doc URL and PDF URL
- `Api.payments.exportPdf(paymentId)` → returns PDF blob
- `Api.payments.reset(rootApptId, version)` → admin-only: clear in-progress payment dialog state
- `Api.payments.adminVoid(paymentId, reason, version)` → admin-only: marks ledger row voided, does not delete docs

### 12.9 Artifacts

- `Api.artifacts.uploadFolder(taskId, artifactType)` → Drive folder for upload
- `Api.artifacts.syncDriveUploads(taskId)` → register dropped files
- `Api.artifacts.getBrief(rootApptId)` → AI brief

### 12.10 Intake (Admin/Test Only)

- `Api.intake.injectTest(payload)` → run a test `IntakePayload` through the intake service
- `Api.intake.manualBooking(payload)` → admin manual booking entry
- `Api.intake.runTestScenarios()` → run all scripted intake test scenarios, return results

### 12.11 Diagnostics (Admin Only)

- `Api.diag.benchmarks()` → run benchmark suite
- `Api.diag.driftReport()` → run drift reconciliation
- `Api.diag.opsLog(filters)` → operational log

---

## 13. Dashboard UI

The dashboard is a single HtmlService web app.

### 13.1 Visual Design

| Element | Specification |
|---|---|
| Foundation | warm beige background `#F7F1EB`, surface `#FBF7F1`, inset `#EFE8DD` |
| Ink | primary `#2A2725`, body `#4A4540`, muted `#8A8178` |
| Rule | `#D4CFC4` |
| Accent | magenta `#E91D79` |
| Headings | Cormorant Garamond serif, weight 400 |
| Body | Inter sans-serif |
| Eyebrow labels | uppercase, letter-spacing 0.14em, font size 10px, muted color |
| Buttons | uppercase 11px, letter-spacing 0.12em, 1px border, 2px radius, primary fills with ink and inverts on hover |

### 13.2 Layout

Two main shells:

- **Default shell:** masthead, toolbar with navigation tabs and primary action, status line, two-column layout (main content + detail panel sidebar).
- **Workspace mode:** full-width single column. Used for task workspaces that need more space (proposal workspace, customer detail when accessed from Customer Search, admin dashboard, employee schedule, user admin).

The shell switches to workspace mode by toggling a class on the root element (`proposal-workspace-mode`, `customer-search-wide`, `admin-dashboard-wide`, `employee-schedule-wide`, `user-admin-wide`).

### 13.3 Navigation

Top-level navigation grouped into four nav groups, each rendering a dropdown:

| Group | Items |
|---|---|
| Work | My Queue, Calendar, JOC Coverage |
| Customers | Customer Search, Customer Pipeline (Admin Dashboard) |
| Diamonds | Diamond Inventory, Diamond Tracking, Bulk Returns |
| Admin | Schedules, Admin Review, Manage Users, Cleanup |

Visibility of items and groups is driven by user role. Empty groups are hidden.

### 13.4 Customer Detail Surface

The single most important UI pattern. Used in Customer Search detail, Calendar expanded detail, Admin Pipeline detail, task customer panel.

Layout, top to bottom:

1. **Hero:** customer name, sales stage chip, advisors, JOC, brand, SO#, RootApptID, last touch indicator.
2. **AI Brief** (when present): review flags, sales brief, links to summary doc and transcript.
3. **Next Steps:** vertical rule, label, current next steps text, Edit button.
4. **Take Action:** action panels for Update Client Status, Update 3D Deadline, Submit 3D Revision Request, Request Wax. Each is a `<details>` element that expands inline.
5. **Info grid (3 columns):** Order Status (key/value list), Payment History, References (link grid).
6. **Footer grid (3 columns):** Related Appointments, Open Workflow Tasks, Recent Activity.

### 13.5 Task Detail Surface

Right-hand detail panel for most tasks. Workspace mode for `PROPOSE_DIAMONDS` (3-step proposal flow).

Common sections:
- Panel header with eyebrow lifecycle stage and task title.
- Customer/appointment metadata.
- Instructions block.
- Task-type-specific completion controls.
- Checklist with required-asterisk markers.
- Snooze panel (collapsed `<details>` element).
- Actions row: Claim (when applicable), primary Complete button.
- Admin assignment block (when admin).

### 13.6 Proposal Workspace

3-step workflow for `PROPOSE_DIAMONDS`. Renders in workspace mode.

| Step | Purpose |
|---|---|
| 1. Customer requirements | Buying brief, stone type, shape, carat range, color range, clarity range, primary deciding factor, ratio preference, budget note, variety to show, internal notes. Blocks advance until required fields filled. |
| 2. Find or add stones | Match against in-stock `_Stones` using requirements; sort by best match / carat / return date; select inventory stones to add to proposal; manual stone entry for stones not in inventory. |
| 3. Review and submit | Customer summary, requirement summary, stone summary, pre-flight checklist, submit. |

Stepper at top with clickable steps. Footer with Back / Continue / Submit.

### 13.7 Calendar

Month grid, 7×6, with weekday headers. Each day cell shows up to 4 appointments, with overflow indicator. Today is visually distinguished. Day click navigates to event detail in the right panel. Previous/Next month buttons.

### 13.8 Admin Dashboard

Single-column wide layout. Sections:

1. Filter panel (window preset, dates, brand, advisor, JOC, include closed toggle).
2. At-risk snapshot (3 cards: tone-coded danger/warn/info).
3. Weekly pulse (4 cards).
4. Pipeline by stage (6 stage cards).
5. Trend chart (12-week bookings + first deposits).
6. Lead sources (90-day source breakdown with bars).
7. Advisor scorecard (table).
8. Top deals + receivables (two columns).

### 13.9 Diamonds

**In-Stock Diamonds:** stat cards row, filter panel (shape, carat min/max, color, clarity), filterable list. Detail panel shows assignment form when selected (Diamond Order Admin only). Loupe360 Sync button visible to Diamond Order Admin only.

**Diamond Tracking:** stat cards row (Issues, On The Way, Missing ETA, Returns), list of issue rows. Visible to both Diamond Order Admin and Assistant.

**Bulk Returns:** stat cards (Candidates, Overdue, Due Soon, No Return Date), bulk action buttons (Select Overdue / Due Soon / All / Clear), checkbox list of candidates, detail panel with shipment notes textarea and submit-with-confirm button. Diamond Order Admin only.

### 13.10 Schedules

Single-column wide layout. Hero with Add User and Save Changes. Auto-assign toggle card. Summary cards (Advisors, JOC, Working Today, Linked Pairs). Roster table with role chips, skill chips, day-of-week chips, JOC routing dropdowns. Schedule override grid (form on left, list of overrides on right).

### 13.11 Manage Users

Single-column wide layout. Form for add/update with email, name, password (with generate button), role checkboxes with descriptions, active toggle, notes. List of existing users with role display.

### 13.12 Interaction Patterns

- **Optimistic UI:** mutations return the refreshed slice; UI updates immediately on success.
- **Version conflicts:** API rejection with conflict surfaces the latest values to the user.
- **Drive upload polling:** when a Drive folder is opened for appointment artifacts, the dashboard polls `Api.artifacts.syncDriveUploads` every 20 seconds for up to 10 minutes to register and rename newly dropped files.
- **Copy to clipboard:** template messages and manufacturing messages have copy buttons; copy actions log via `Api.tasks.logTemplateCopied`.
- **Delete confirmations:** destructive actions (delete schedule override, bulk return submit) require a second click within 4 seconds to confirm.
- **Auto-clearing status:** the status line clears on the next successful action.
- **Session timing logging:** the dashboard records load timing marks and posts them to a server logging function for performance tracking.

### 13.13 Auth UI

Single login screen before the dashboard mounts. Email + password. Sign In button shows loading state. Error messages render below the form. On success, session token stored in `sessionStorage` under `salesWorkflowToken`.

---

## 14. Setup, Schema Versioning, And Triggers

### 14.1 No Manual Edits

Tabs, headers, named ranges, dropdowns (data validation), conditional formatting, frozen rows, column widths, sheet protections, and document properties are all created by code. A spreadsheet that has been hand-edited cannot be promoted to production. The setup function detects manual deviations and refuses to run, surfacing diffs in the run log.

### 14.2 Schema Version

`_SchemaVersion` tracks current schema version (semver), last setup run timestamp, setup function git/script revision, and migration history.

Every `00_Setup_*` function is associated with a target version. Running setup on a workbook at version N migrates it to N+1 in idempotent steps.

### 14.3 Idempotent Setup

`Setup.runAll()`:

1. Acquires Tier C lock.
2. Reads `_SchemaVersion`.
3. For each pending migration step, in order:
   - Validates preconditions.
   - Applies the migration.
   - Updates `_SchemaVersion` after success.
4. Regenerates `_DataFlowRef` from code constants.
5. Verifies all expected tabs, headers, dropdowns, named ranges, and protections.
6. Releases Tier C lock.
7. Logs results to `_OpsLog`.

Running `Setup.runAll()` on a fully-up-to-date workbook is a no-op except for verification logging.

### 14.4 Headers As Code Constants

`01_Const_Columns.gs` exports an object per tab:

```javascript
const COL_03_CustomerInfo = Object.freeze({
  RootApptID:          { col: 1,  type: 'string',   required: true,  width: 140 },
  Version:             { col: 2,  type: 'integer',  required: true,  width: 60  },
  UpdatedAt:           { col: 3,  type: 'datetime', required: true,  width: 140 },
  UpdatedBy:           { col: 4,  type: 'string',   required: false, width: 140 },
  UpdatedByEmail:      { col: 5,  type: 'string',   required: false, width: 200 },
  CustomerName:        { col: 6,  type: 'string',   required: true,  width: 200 },
  // ...
});
```

Adding a column means: edit the constant, increment schema version, write a migration step, run setup. There is no other path.

### 14.5 Dropdowns And Validation Rules

`00_Setup_Dropdowns.gs` defines every dropdown by name and applies it to ranges. `_Config` exposes editable dropdown values; setup reads `_Config` during validation rule construction. Dropdown rules are recreated from scratch on every setup run.

### 14.6 Triggers

`00_Setup_Triggers.gs` installs all triggers. An admin runs `Setup.installTriggers()` after `Setup.runAll()` succeeds. `Setup.removeTriggers()` removes them for maintenance.

| Trigger | Frequency | Function | Tier | Phase |
|---|---|---|---|---|
| Task generation | every 5 min | `Trigger.taskGen` | B | Launch |
| Cache prewarm | every 5 min | `Trigger.cachePrewarm` | B | Launch |
| Artifact processing | every 5 min | `Trigger.artifacts` | B | Launch |
| URL repair | hourly | `Trigger.urlRepair` | B | Launch |
| Drift check | nightly | `Trigger.driftCheck` | B | Launch |
| Acuity poll | every 5 min | `Trigger.acuityPoll` | B | Future |
| Calendly poll/webhook | every 5 min or on-demand | `Trigger.calendlyHandler` | B | Future |

### 14.7 Drive Folders

Drive folder creation is handled by `06_Service_Artifacts.gs`. Folder IDs are stored in `03_CustomerInfo` (customer-level) and `01_AppointmentEvents` (appointment-level). Folder creation is idempotent.

---

## 15. External Integrations

All external workbooks and services are accessed through adapters in `05_Ext_*`. Every external read and write is wrapped, throttled, and logged.

### 15.1 Payment Ledger Workbook (External)

`05_Ext_PaymentLedger.gs` provides a thin adapter to the external ledger workbook. The workbook ID is configured in `_Config` under `payments.ledger.workbookId`.

API surface:

- `Ledger.getByRoot(rootApptId)` → all rows for a root, ordered by `IssuedAt`
- `Ledger.getById(paymentId)` → single row by `PaymentId`
- `Ledger.findSalesInvoiceForSO(rootApptId, so)` → returns the latest non-draft non-void Sales Invoice row, used by Sales Receipt prerequisite check
- `Ledger.append(row)` → append a new row; returns the appended row with confirmed `PaymentId`
- `Ledger.updateDocLinks(paymentId, { docFileId, docURL, docPDFId, pdfURL, arShortcutId })` → set generated doc fields after Phase 2
- `Ledger.markVoided(paymentId, { voidedAt, voidedBy, voidReason })` → set void fields
- `Ledger.summary(rootApptId)` → `{ paidToDate, balance, lastPaymentDate, openInvoiceTotal, receiptsCount }`

Reads cached for 60 seconds. The adapter holds a workbook-specific named lock for any write to coordinate with other writers (e.g., manual edits during accounting reconciliation).

The adapter does not generate documents; doc generation lives in `06_Service_Payments.gs`. The adapter does not enforce business rules like the Sales Receipt prerequisite; that lives in the service layer. The adapter is purely the data plane for the ledger workbook.

### 15.2 3D Tracker Workbook (External)

`05_Ext_TrackerWorkbook.gs`:

- `Tracker.appendLog(rootApptId, entry)`
- `Tracker.getEntries(rootApptId)`

### 15.3 Quote Workbook (External)

`05_Ext_QuoteWorkbook.gs`:

- `Quote.getSavedLines(rootApptId)`
- `Quote.refreshFromTracking(rootApptId)`
- `Quote.refreshFrom3D(rootApptId)`

### 15.4 Drive

`05_Ext_Drive.gs` — thin wrapper consolidating DriveApp calls, caching folder IDs, ensuring every Drive call has a clear caller and purpose for `_OpsLog`.

### 15.5 AssemblyAI

`05_Ext_AssemblyAI.gs`:

- `AssemblyAI.startTranscription(driveFileId)`
- `AssemblyAI.pollTranscription(transcriptId)`

### 15.6 OpenAI

`05_Ext_OpenAI.gs`:

- `OpenAI.summarizeTranscript(transcript, customerContext)` → sales brief, client follow-up draft, review flags

Prompts and model selection live in `_Config`.

### 15.7 Acuity (Future)

`05_Ext_Acuity.gs`:

- `Acuity.fetchActiveAppointments(window)`
- `Acuity.fetchCanceledAppointments(window)`
- `Acuity.fetchAppointmentDetail(acuityId)`
- `Acuity.translateToIntakePayload(acuityAppointment)` → normalized `IntakePayload`

### 15.8 Calendly (Future)

`05_Ext_Calendly.gs`:

- `Calendly.fetchEvents(window)` (poll mode) or `Calendly.handleWebhook(payload)` (webhook mode)
- `Calendly.translateToIntakePayload(calendlyEvent)` → normalized `IntakePayload`

---

## 16. Artifact Processing Pipeline

Appointment recordings are processed through this pipeline:

1. Rep opens task drawer, clicks "Open Drive Folder" for the appointment.
2. Dashboard calls `Api.artifacts.uploadFolder(taskId, artifactType)` which ensures the Drive folder exists.
3. Rep drops files in Drive.
4. Dashboard polls `Api.artifacts.syncDriveUploads(taskId)` every 20 seconds while the task drawer is open.
5. Sync registers each file in `_AppointmentArtifacts` with `workflowStage='UPLOADED'`.
6. The `Trigger.artifacts` Tier B job processes ready artifacts:
   - `UPLOADED` → start AssemblyAI transcription, set `TRANSCRIPTION_QUEUED`.
   - `TRANSCRIPTION_QUEUED` → poll AssemblyAI, advance to `TRANSCRIBING`, then `TRANSCRIPT_READY` when text returned. Save transcript Doc to Drive.
   - `TRANSCRIPT_READY` → call OpenAI summarize, save summary JSON and Doc, set `SUMMARY_READY`.
7. When `SUMMARY_READY` and the corresponding appointment checklist is complete, `TaskGen` creates the `APPROVE_RECAP_MESSAGE` task.
8. Approve recap task completion sets artifact `Approved`.
9. Send final recap completion sets artifact `JOC Handoff At`.

Errors set `lastError` and increment `attempts`. After max attempts, the artifact moves to a manual review state.

---

## 17. Security And Auth

### 17.1 Login

`_Users` stores email, name, roles (multiple), active flag, password salt, password hash, last login. Login validates against `_Users` and creates a session token stored in CacheService keyed by token, value is the user object, TTL 8 hours.

### 17.2 Authorization

Every API function takes the session token, resolves the user, and checks role-based permissions before doing anything else. Roles:

- Admin
- Client Advisor
- JOC
- Diamond Order Admin
- Diamond Order Assistant
- Read-Only Viewer

Permissions per API function are defined in `01_Const_Permissions.gs`.

### 17.3 Audit

Every write API function appends to `_OpsLog`: timestamp, user email, function called, target root or task, result, lock wait time, lock hold time, version delta.

---

## 18. Code Architecture Rules

Enforced by code review and by `11_Diag.checkArchitectureRules()` which scans the codebase for violations.

1. **Layering:** A file may only call functions from same-or-lower prefix. Service files cannot call other service files (use shared utility or repo). Repo files cannot call service files. API files cannot call repos directly (must go through services).

2. **No direct sheet I/O outside repos and setup.** `SpreadsheetApp.getActive().getSheetByName(...).getRange(...)` is forbidden outside `04_Repo_*` and `00_Setup_*`. Service files calling `getRange` fails review.

3. **No hardcoded tab names.** Tab names live in `01_Const_Tabs.gs` only. Any string literal matching a tab name elsewhere is a violation.

4. **No hardcoded column letters or numbers in service files.** Use the column constants from `01_Const_Columns.gs`. Repo files convert constants to ranges.

5. **Every mutation function returns `{ ok, version, slice, invalidated }`.** No mutation function returns `void` or `boolean`.

6. **Every read function returns `{ data, version, source, ageMs }`.** The `source` field is `cache` or `domain` — making the fallback chain visible.

7. **Every dashboard read goes through a slice builder.** Slice builder signatures are stable across implementations. This preserves the option to add read model tabs later without changing API or web code.

8. **No `try/catch` swallowing in repos.** Repos let errors propagate. Services may catch and translate to user-facing error responses. APIs always return structured error responses, never throw.

9. **No `Utilities.sleep` anywhere.** If a flow needs to wait for something, it returns and the caller polls or the orchestrator handles it.

10. **No global state.** No `let`-declared module-level mutable state. Read state from sheets or pass it explicitly.

11. **One writer per fact.** If two functions in different files write the same column, one is wrong.

---

## 19. Phased Implementation Plan

The plan is structured to defer user exposure as long as possible. Each phase has a test gate.

### Phase 0 — Foundations

**Build:**
- New workbook created.
- New Apps Script project bound.
- File structure set up with empty stubs in every prefix.
- `01_Const_Tabs.gs`, `01_Const_Columns.gs`, `01_Const_Enums.gs`, `01_Const_Permissions.gs` populated with full schema including `_Stones`, `_StonesSync`, `_IntakeQueue`.
- `00_Setup_Schema.gs` runs to v0.1 and creates every tab with headers, frozen rows, column widths.
- `_DataFlowRef` regenerator works.
- `_SchemaVersion` tracking works.
- `11_Diag.checkArchitectureRules()` runs on the empty stubs and passes.

**Test gate:**
- `Setup.runAll()` runs twice without errors and produces identical sheet structure.
- Every tab in Section 5.1 exists with correct headers.
- `_DataFlowRef` lists every column with its owner.
- Architecture check passes.

### Phase 1 — Lock Layer And Repos

**Build:**
- `03_Lock_DocLock.gs` and `03_Lock_NamedLock.gs` with timeout, retry, and metrics.
- All `04_Repo_*` files including `04_Repo_Stones.gs` with full CRUD.
- Optimistic concurrency (version checks).
- Repo unit tests.

**Test gate:**
- 100% of repo functions have unit tests.
- Concurrency test: two simulated writers updating the same row produce one success and one version-conflict response.
- `_Stones` repo round-trips full lifecycle (proposed → ordered → tracking → delivered → returned).
- Lock metrics logged to `_OpsLog`.

### Phase 2 — Cache Layer And Slice Builders

**Build:**
- `07_Cache_*.gs` files with all slice builders per Section 7.2.
- Shared `CustomerRootDetailSlice` builder used by all four detail surfaces.
- Slice builder pattern (Section 7.3) for every slice.
- TTL and invalidation logic.

**Test gate:**
- All slice modes (`card`, `standard`, `full`, `taskMini`) return correct shapes for sample data.
- Cache hits/misses logged.
- Invalidating an entry forces rebuild on next read.
- Slice builder signatures verified to be stable (mock test that swaps internal implementation does not break callers).

### Phase 3 — Intake Service (Source-Independent)

**Build:**
- `06_Service_Intake.gs` with `Intake.process` and helper functions per Section 8.4.
- `_IntakeQueue` write/drain flow.
- `08_Api_Intake.gs` with `injectTest`, `manualBooking`, `runTestScenarios`.
- `11_Diag_TestIntake.gs` with all scenarios from Section 8.5.

**Test gate:**
- All scenarios in Section 8.5 pass.
- Test injection drives full pipeline: root creation, customer info, client status init.
- Idempotency confirmed (re-running same payload doesn't duplicate).
- Reschedule chain test verifies pointer linking.

### Phase 4 — Services

**Build:**
- `06_Service_TaskGeneration.gs` with all rules from Section 9.2.
- `06_Service_TaskCompletion.gs` with adapter dispatch including all `_Stones` writes.
- `06_Service_Diamonds.gs` for proposal flow, Loupe360 sync.
- `06_Service_Payments.gs` with full ledger + doc generation per Section 11, including:
  - `Templates.getId(brand, docType, taxEnabled)` lookup with fallback chain
  - `Payments.submitLedger` and `Payments.generateDoc` two-phase submit
  - `Payments.checkSalesReceiptPrerequisite`
  - Doc number sequencing with named lock
  - `Payments.resolveDestinationFolder` for appointment- and SO-linked payments
  - AR monthly shortcut creation
  - Placeholder merge with table cloning for line items
  - `Payments.submitCombo` for Sales Invoice + Sales Receipt back-to-back
  - `Payments.adminVoid` with paid-to-date reversal
- `06_Service_Artifacts.gs`.
- `05_Ext_*` adapters for ledger, tracker, quote, Drive, AssemblyAI, OpenAI.

**Test gate:**
- Task generation produces correct desired tasks for hand-built scenarios covering every task type.
- Diamond lifecycle test: propose → order → track → deliver → decision → return runs end-to-end against `_Stones`.
- Loupe360 sync preview and apply work against test fixture.
- Bulk returns transaction marks multiple stones in one operation.
- Payment doc generation tests (one per brand/doc-type combination, 12 total):
  - HPUSA: Deposit Invoice, Deposit Receipt, Sales Invoice, Sales Receipt → correct template selected, doc generated, PDF exported, ledger updated, AR shortcut created when configured.
  - VVS taxable: same 4 doc types with tax variant template selected.
  - VVS non-taxable: same 4 doc types with no-tax variant template selected.
- Sales Receipt prerequisite test: blocked when no Sales Invoice exists, succeeds when one exists.
- Doc number sequencing test: 50 concurrent submits produce 50 distinct sequential numbers per brand/doc-type.
- Combo submit test: Sales Invoice + Sales Receipt back-to-back, both succeed, Sales Receipt prerequisite passes against the just-created invoice.
- Void test: voiding a receipt reverses paid-to-date and balance correctly; doc files remain in Drive.
- Regenerate test: Phase 1 succeeds, Phase 2 fails (template missing), `regenerateDoc` succeeds after template configured.
- Artifact pipeline runs end-to-end against a sample audio file.

### Phase 5 — Dashboard API

**Build:**
- All `08_Api_*` functions per Section 12.
- Authentication, session management, role checks per Section 17.
- Structured error responses.
- Benchmarks in `11_Diag_Benchmarks.gs`.

**Test gate:**
- Every API function has a happy-path and an auth-failure test.
- Role tests: Diamond Order Admin can call `assignInStock`, Assistant cannot. Admin can call `applyLoupe360Sync`, Assistant cannot. Admin can call `payments.adminVoid`, Client Advisor cannot.
- Payment API tests: `init`, `validatePrerequisites`, `submit`, `regenerateDoc`, `submitCombo`, `adminVoid` each have happy-path and failure-path tests.
- Benchmark suite produces baseline.
- API response shapes match documented contracts.

### Phase 6 — Web App Client

**Build:**
- HtmlService entry, client bundle.
- All views per Section 13.
- Login screen.
- Optimistic UI with version conflict handling.
- Drive upload polling.
- Payment dialog with live totals computation and Phase-1/Phase-2 error handling per Section 11.14.
- Client load timing instrumentation.

**Test gate:**
- A test user can log in and use every view against the test workbook driven by `injectTest`.
- Concurrency: two browsers updating the same row demonstrate proper conflict handling.
- All detail surfaces render the shared `CustomerRootDetailSlice` consistently.
- Diamond order workflow: a Diamond Order Admin can complete the full proposal → order → confirm delivery → record decisions → return cycle through the dashboard.
- Payment workflow: a user can issue all 4 doc types for both brands with both tax modes (where applicable), see correct doc/PDF links after submit, regenerate a doc when Phase 2 fails, and process a combo invoice + receipt successfully.
- Performance targets met (Section 20).

### Phase 7 — Hardening And Internal Launch

**Build:**
- Operational runbooks.
- User training material.
- Final benchmark suite run.
- All Phase-Launch triggers installed (task gen, cache prewarm, artifacts, URL repair, drift check).

**Test gate:**
- Benchmarks meet targets.
- Triggers fire correctly.
- Internal team uses the dashboard with `injectTest` and manual entry to drive realistic appointment volume for one week.
- All workflows including diamond order team workflows work end-to-end.

### Phase 8 — Source Adapter: Acuity

**Build:**
- `05_Ext_Acuity.gs` adapter.
- `Acuity.translateToIntakePayload` for create, edit, reschedule, cancel.
- `10_Trigger_Acuity.gs` poll trigger.

**Test gate:**
- Acuity poll fetches and translates real bookings into `IntakePayload`.
- Live appointments flow end-to-end through `Intake.process`.
- Reschedule and cancellation handling validated against real Acuity data.

### Phase 9 — Source Adapter: Calendly

**Build:**
- `05_Ext_Calendly.gs` adapter.
- `Calendly.translateToIntakePayload`.
- Either webhook handler (preferred if account tier supports) or poll trigger.

**Test gate:**
- Calendly bookings flow through intake correctly.
- Both Acuity and Calendly bookings coexist without collisions.

### Phase 10 — Production Launch

**Activities:**
- Switch booking sources to point at the production system.
- Send users the dashboard URL.
- On-call engineer monitors `_OpsLog` for 24 hours.

### Phase 11 — Post-Launch Optimization

**Activities:**
- Daily drift check between system state and external workbooks.
- Weekly review of `_OpsLog`.
- Performance tuning based on observed benchmarks.
- Add read model tabs only if direct cache + canonical reads can't hit targets. Most likely candidates: `_RM_CustomerCard`, `_RM_Admin`.

---

## 20. Performance Targets

Targets for warm cache path:

| Operation | Target |
|---|---|
| `Api.bootstrap.get` | under 1.5s |
| `Api.tasks.list` | under 800ms |
| `Api.tasks.detail` | under 1.0s |
| `Api.customers.search` | under 1.2s |
| `Api.customers.getDetail` (full) | under 1.2s |
| `Api.calendar.getMonth` | under 800ms |
| `Api.admin.dashboard` | under 1.5s |
| `Api.diamonds.inStock` | under 1.0s |
| `Api.diamonds.tracking` | under 1.0s |
| `Api.payments.init` | under 1.5s |
| `Api.payments.submit` (Phase 1 ledger) | under 2.0s |
| `Api.payments.submit` (Phase 2 doc generation) | under 8.0s |
| `Api.payments.history` | under 1.0s |
| Tier A user write | lock held under 200ms; total under 1.0s |
| Tier B background job | does not block any Tier A write for more than 200ms |

Note: payment doc generation is bounded by Drive's `makeCopy` and PDF export operations, both of which routinely take 2–5 seconds. The dashboard shows a clear loading indicator during this phase. The 8.0s target is for the doc generation phase only; the user sees both phases combined.

Benchmarks record source path used (cache or canonical), cache age, and slowest step. Regressions surface in the admin diagnostics view.

---

## 21. Acceptance Criteria

The system is accepted when:

1. All API functions in Section 12 are implemented and pass tests.
2. Every canonical fact has exactly one home tab as defined in Section 5.
3. Setup is fully idempotent and the workbook is reproducible from empty by code.
4. Architecture rules in Section 18 pass the static check with zero violations.
5. Performance targets in Section 20 are met for warm reads.
6. Lock metrics show Tier A writes never block on Tier B jobs for more than 200ms.
7. All intake test scenarios in Section 8.5 pass.
8. Diamond order workflow end-to-end works through the dashboard for both Admin and Assistant roles.
9. Payment doc generation works end-to-end through the dashboard for all 12 brand/doc-type combinations: HPUSA × {DI, DR, SI, SR}, VVS taxable × {DI, DR, SI, SR}, VVS non-taxable × {DI, DR, SI, SR}.
10. Sales Receipt prerequisite check correctly blocks/allows based on prior Sales Invoice presence.
11. Live source adapters (Acuity, Calendly) are wired in subsequent phases and pass their own end-to-end tests.
12. Users have been trained.

---

## 22. Open Decisions

These need a sign-off before Phase 0 begins:

1. **Workbook name and Drive location.**
2. **Bootstrap admin user(s).** At least one admin must exist in `_Users` before the dashboard is usable.
3. **Same-email-different-phones edge case.** Business decision: separate roots or merge? Encoded in test scenarios for Phase 3.
4. **Dropdown values that admins can self-edit vs. config-controlled.** Need a list per dropdown.
5. **Loupe360 sync conflict policy.** When source says one status and our row has a different status, do we always flag, always overwrite, or apply a per-field rule?
6. **Calendly webhook vs. poll.** Confirm whether the Calendly account tier supports webhooks before Phase 9.
7. **Stone return window.** Default is 30 days from purchased/ordered date. Confirm.
8. **Payment template Drive file IDs.** Configure all 12 template properties (Section 11.3) before Phase 4 testing. List of properties:
   - HPUSA: `HPUSA_DI_TEMPLATE_ID`, `HPUSA_DR_TEMPLATE_ID`, `HPUSA_SI_TEMPLATE_ID`, `HPUSA_SR_TEMPLATE_ID`
   - VVS tax: `VVS_DI_TAX_TEMPLATE_ID`, `VVS_DR_TAX_TEMPLATE_ID`, `VVS_SI_TAX_TEMPLATE_ID`, `VVS_SR_TAX_TEMPLATE_ID`
   - VVS no-tax: `VVS_DI_NOTAX_TEMPLATE_ID`, `VVS_DR_NOTAX_TEMPLATE_ID`, `VVS_SI_NOTAX_TEMPLATE_ID`, `VVS_SR_NOTAX_TEMPLATE_ID`
9. **Payment ledger workbook ID.** Confirm Drive ID and ensure the Apps Script project has access.
10. **Brand-level Drive parents for payments:** `drive.parent.so.hpusa`, `drive.parent.so.vvs` for SO-rooted payments; `drive.parent.ar.hpusa`, `drive.parent.ar.vvs` for AR monthly shortcuts. Confirm folder IDs or that AR shortcuts are skipped if not configured.
11. **Doc number starting values.** For each `(brand, docType)` combination, set the starting value of `docnumber.${brand}.${code}.next` in `_Config` to continue from the existing sequence (or start at 1 if launching fresh sequences).
12. **Combo submit usage.** Confirm whether the dashboard's payment dialog needs an explicit "Combo: Invoice + Receipt" option, or whether `Api.payments.submitCombo` is only used by the iPad app integration.
13. **Void document behavior.** When voiding, do we also generate a "VOID" stamped PDF on top of the original, or just mark the ledger row?

---

*End of PRD.*