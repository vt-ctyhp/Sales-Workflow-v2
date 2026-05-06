# Sales Workflow PRD

**Status:** Build spec
**Scope:** A Google Sheets workbook with an Apps Script project that runs a sales appointment workflow dashboard. The system is built fresh with no preexisting data. Active customers only.

---

## 1. Purpose

A sales appointment workflow system that:

- Ingests appointment bookings from Acuity through a Google Form bridge.
- Generates and routes role-specific tasks for Client Advisors, JOC users, Diamond Order Admins, Diamond Order Assistants, and Admins.
- Powers a web-based dashboard for task completion, customer search, calendar, admin pipeline, diamond inventory and tracking, schedules, and user management.
- Stores customer, appointment, status, 3D order, diamond viewing, wax, task, and artifact data in domain-specific tabs keyed by `RootApptID`.
- Integrates with external workbooks for diamond inventory (200 stones), payment ledger, 3D tracker, and quotation; with Drive for folders and uploads; and with AssemblyAI and OpenAI for appointment recording transcription and summary generation.

The system is built to keep dashboard reads under target latencies, keep user-facing writes free of contention with background jobs, and prevent data drift by giving every fact exactly one home.

---

## 2. Goals And Non-Goals

### 2.1 Goals

- Stand up a Google Spreadsheet with an Apps Script project bound to it.
- Ship the full dashboard surface: My Queue, Calendar, Customer Search, Customer Pipeline (Admin Dashboard), In-Stock Diamonds, Diamond Tracking, Bulk Returns, JOC Coverage, Admin Review, Cleanup, Schedules, Manage Users.
- Store every canonical fact in exactly one domain tab keyed by `RootApptID` or `APPT_ID`.
- Define an explicit lock model with short, scoped locks for user writes and separate locks for background work.
- Build all sheets, columns, named ranges, dropdowns, and protections from versioned setup functions. No manual sheet edits are permitted.
- Bridge Acuity bookings through a single, simple intake path with no synthesized UIDs.
- Wire the AssemblyAI and OpenAI artifact pipeline through a clear adapter so the workflow can use AI summaries without owning the model interactions.

### 2.2 Non-Goals

- No customer history is loaded at launch. The system starts empty.
- The 200 stones workbook, payment ledger workbook, 3D tracker workbook, quotation workbooks, and client report workbooks remain external sources, accessed through adapters.
- Acuity, Google Form, AssemblyAI, OpenAI, and Drive are external services accessed through adapters; their internals are not rebuilt here.
- No reminders subsystem at launch.
- No legacy sheet menus, bound dialogs, or `onEdit` writers. The dashboard is the only write surface.
- No new dashboard features beyond what is specified here. Feature additions wait until after the system is operating.

---

## 3. Architectural Principles

Eight principles. Every decision in this PRD descends from these.

1. **One fact, one home.** Every canonical fact lives in exactly one tab and one column. Caches are explicitly labeled and never written by user actions.

2. **Dashboard is the only write surface.** No sheet menus. No bound dialogs. No `onEdit` writers. Writes go through server functions called from the dashboard, the orchestrator, or the form-submit trigger.

3. **Setup is code, not clicks.** Tabs, headers, named ranges, dropdowns, protections, conditional formatting, and triggers are created by versioned setup functions. The workbook can be reconstructed from an empty spreadsheet by running a single setup function.

4. **Locks are short and scoped.** User-facing writes hold the document lock under 500ms. Background jobs use named script locks per job and acquire the document lock only for individual `setValues` calls.

5. **Read directly from canonical tabs, with cache in front.** No separate read model tabs. Dashboard endpoints serve from CacheService where possible, fall through to direct canonical reads. Read model tabs are a future optimization, not a launch requirement.

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
| `02_Util_` | Pure utilities, no sheet I/O | `02_Util_Time.gs`, `02_Util_Strings.gs`, `02_Util_Hashing.gs` |
| `03_Lock_` | Lock primitives | `03_Lock_DocLock.gs`, `03_Lock_NamedLock.gs` |
| `04_Repo_` | Domain repositories — only files that read/write canonical tabs | `04_Repo_Appointments.gs`, `04_Repo_RootAppointments.gs`, `04_Repo_CustomerInfo.gs`, `04_Repo_ClientStatus.gs`, `04_Repo_Order3D.gs`, `04_Repo_DiamondViewing.gs`, `04_Repo_Wax.gs`, `04_Repo_Tasks.gs`, `04_Repo_Artifacts.gs`, `04_Repo_Users.gs`, `04_Repo_Schedules.gs` |
| `05_Ext_` | External workbook and service adapters | `05_Ext_StonesWorkbook.gs`, `05_Ext_PaymentLedger.gs`, `05_Ext_TrackerWorkbook.gs`, `05_Ext_QuoteWorkbook.gs`, `05_Ext_Drive.gs`, `05_Ext_Acuity.gs`, `05_Ext_AssemblyAI.gs`, `05_Ext_OpenAI.gs` |
| `06_Service_` | Business logic — orchestrates repos and adapters, no direct sheet I/O | `06_Service_Intake.gs`, `06_Service_TaskGeneration.gs`, `06_Service_TaskCompletion.gs`, `06_Service_Diamonds.gs`, `06_Service_Payments.gs`, `06_Service_Artifacts.gs` |
| `07_Cache_` | CacheService wrappers, slice builders, TTL policies | `07_Cache_Slices.gs`, `07_Cache_CustomerDetail.gs`, `07_Cache_TaskList.gs` |
| `08_Api_` | Dashboard-callable functions | `08_Api_Bootstrap.gs`, `08_Api_Tasks.gs`, `08_Api_Customers.gs`, `08_Api_Calendar.gs`, `08_Api_Admin.gs`, `08_Api_Diamonds.gs`, `08_Api_Payments.gs` |
| `09_Web_` | HtmlService entry, client bundle | `09_Web_App.gs`, `Index.html` |
| `10_Trigger_` | Time-driven and event triggers | `10_Trigger_Acuity.gs`, `10_Trigger_FormSubmit.gs`, `10_Trigger_TaskGen.gs`, `10_Trigger_Artifacts.gs` |
| `11_Diag_` | Diagnostics, benchmarks, drift checks, architecture rule check | `11_Diag_Benchmarks.gs`, `11_Diag_ArchitectureRules.gs`, `11_Diag_DriftCheck.gs` |

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
| `_TaskQueue` | Canonical | `TaskID` | Task state, owner, snooze, completion |
| `_TaskLog` | Canonical, append-only | Auto-id | Task lifecycle events |
| `_AppointmentArtifacts` | Canonical | `ArtifactID` | Recording, transcript, summary, AI brief metadata |
| `_Users` | Canonical | Email | Workflow users, roles, active state, hashed password |
| `_RosterSchedule` | Canonical | Email + week | Recurring schedule rows |
| `_ScheduleChanges` | Canonical, append-only | Auto-id | One-off availability overrides |
| `_Config` | Canonical | Section + Key | Feature flags, config values, role definitions, dropdown values |
| `_Templates` | Canonical | Template Key | Task templates, copyable messages |
| `_DataCleanup` | Canonical | Case ID | Cleanup campaign cases |
| `_DataFlowRef` | Generated reference | Column ref | Every column, its owner repo, its read sources, its invalidation rules. Built by code, read by humans. |
| `_SchemaVersion` | Self-managed | Single row | Current schema version, last setup run, migration history |
| `_OpsLog` | Append-only | Auto-id | Lock waits, lock holds, write events, errors. Trimmed to last N days. |

There are no `_RM_*` read model tabs at launch. Read serving uses CacheService in front of direct canonical reads. Read model tabs may be added later if benchmarks require, governed by the same setup-as-code rules.

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
| Per-stone diamond facts | 200 stones workbook | External, accessed through adapter. |
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
- Acuity poll
- Form-submit drain coordination
- Task generation
- URL repair
- Cache prewarm
- Drift check
- Artifact processing tick (poll AssemblyAI, run summary generation)

Each Tier B job:
- Acquires its named lock.
- Does prep work outside any sheet lock.
- Acquires document lock only for individual `setValues` writes, holding under 200ms each, releasing between writes.
- Releases its named lock.

**Tier C — Admin / Setup Lock.**
Held by `00_Setup_*` functions and admin repair scripts. Acquires document lock for the duration. Blocks everything. Run manually by an admin during low-activity periods. Logs a banner to `_OpsLog` before and after.

### 6.3 Form Submit

The form-submit trigger acquires Tier A behavior for its writes (short, scoped). The orchestrator checks a "form-submit drain" flag in `_Config` and skips dependent jobs for 30 seconds after a form submit completes. This prevents task generation from running while intake is still landing.

### 6.4 Optimistic Concurrency

Every domain row has a `Version` integer column. Every Tier A write reads the current version, compares to the version the client sent, and rejects with `{ ok: false, conflict: true, latest: <slice> }` if they differ. The dashboard surfaces the latest values to the user and prompts them to redo the change.

Reads outside locks return both data and version. Writes inside locks check version.

---

## 7. Cache Layer

### 7.1 Two Tiers

1. CacheService entry per slice + key. TTL 5 minutes for hot slices, 1 minute for fast-changing.
2. Direct canonical repo read.

Writes invalidate CacheService entries via the invalidation list returned by every mutation. There is no third tier and no rebuild queue at launch.

### 7.2 Cached Slices

| Slice | Used By | Built From |
|---|---|---|
| `TaskListSlice` | My Queue, Cleanup, Coverage, Admin Review | `_TaskQueue` filtered by owner + `03_CustomerInfo` mini |
| `TaskDetailSlice` | Task drawer | `_TaskQueue` row + task-type-specific mini |
| `CustomerCardSlice` | Customer Search list, Kanban, Admin Pipeline cards | `02`–`06` mini |
| `CustomerRootDetailSlice` | Customer detail drawer (and shared by Calendar expanded detail, Admin Pipeline detail, task customer panel) | `02`–`06` full + `_TaskQueue` filtered + payment summary + artifacts |
| `CalendarMonthSlice` | Calendar | `01_AppointmentEvents` filtered by month |
| `AppointmentBriefSlice` | Calendar event detail, AI brief | `01_AppointmentEvents` + `_AppointmentArtifacts` |
| `AdminHealthSlice` | Admin Dashboard | All domain + payment summary + task summary |
| `DiamondInventorySlice` | In-Stock Diamonds | 200 stones workbook |
| `DiamondTrackingSlice` | Diamond Tracking, Bulk Returns | 200 stones workbook |
| `PaymentSummarySlice` | Payment dialog, customer detail finance, admin receivables | Payment ledger workbook |
| `FormOptionsSlice` | All forms and dialogs | `_Config` + `_Templates` |

### 7.3 Shared Customer Detail

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
| `diamondViewing` | `06_DiamondViewing` + 200 root summary |
| `wax` | `05_WaxRequests` (latest by root) |
| `finance` | Payment ledger summary |
| `artifacts` | `_AppointmentArtifacts` |
| `tasks` | `_TaskQueue` filtered by root |
| `recentActivity` | `_TaskLog` + domain history tabs (last 30 days) |

### 7.4 Cache Prewarming

A 5-minute Tier B job prewarms CacheService entries for:
- Active task queue slices for active users.
- The current calendar month.
- The admin dashboard slice.

Keeps hot reads sub-second after CacheService eviction.

---

## 8. Intake Flow

Intake is the most complex single subsystem because it creates roots and appointments — the foundation everything else depends on. This section specifies its behavior precisely.

### 8.1 Sources

- **Acuity API** (primary). New bookings, edits, reschedules, cancellations.
- **Google Form** (bridge). Acuity submissions arrive via a Google Form bound to the workbook.
- **Manual entry** (admin only). Admin dashboard form for offline bookings.

### 8.2 ID Strategy

Two identity layers:

1. **External booking identity:** `(BookingSource, ExternalBookingId)` stored on every `01_AppointmentEvents` row. `BookingSource` is `acuity` or `manual` at launch. `ExternalBookingId` is the booking source's native ID for that appointment (Acuity appointment ID for Acuity, blank for manual).
2. **Internal identity:** `APPT_ID` is a generated v3 ID for each event row. `RootApptID` groups events for the same customer journey.

The system **does not synthesize** UIDs. Reschedules do not create synthetic UIDs that link to originals. Reschedule chains are tracked by `APPT_ID` and `RescheduledFrom` / `RescheduledTo` pointers on `01_AppointmentEvents`. Each event row stores the actual booking source ID for that specific appointment, never a derived ID.

### 8.3 Acuity Poll Flow

A Tier B job, `acuityPoll`, runs every 5 minutes. Steps:

1. Read Acuity credentials from Script Properties.
2. Fetch active and canceled appointments from Acuity for the configured window (default last N days plus future).
3. For each Acuity appointment, find the matching event in `01_AppointmentEvents` by `(BookingSource='acuity', ExternalBookingId=acuityId)`.
4. Decide what kind of action this represents:
   - **New booking** — no event with this `ExternalBookingId` exists. Submit the Google Form to land a new event row.
   - **Field edit** — event exists, no date/time change. Update fields in place via `04_Repo_Appointments`.
   - **Reschedule** — event exists, date or time changed. Mark old event row as rescheduled, submit Google Form for the new appointment, link rows by `RescheduledTo` / `RescheduledFrom`.
   - **Cancellation** — appointment appears in canceled list. Mark event as canceled.
   - **Label/status change** — Acuity status label changed. Update event status.
5. Write a poll-completion entry to `_OpsLog`.

The matching and decision logic lives in `06_Service_Intake.gs` as named, testable functions:

- `Intake.matchExistingByExternalId(source, externalId)` → returns existing event or null.
- `Intake.detectReschedule(existingEvent, acuityPayload)` → pure function, returns `{ isReschedule, newDateTime }`.
- `Intake.classifyAcuityChange(existingEvent, acuityPayload)` → returns `'new' | 'edit' | 'reschedule' | 'cancel' | 'noop'`.

### 8.4 Form-Submit Trigger

Google Form bound to the workbook fires `Trigger.onFormSubmit(e)`. Steps:

1. Parse named values from the form payload.
2. Acquire Tier A lock.
3. Resolve or create the root via `Intake.resolveOrCreateRoot(payload)`:
   - Match by `(BookingSource, ExternalBookingId)` first.
   - Match by `RescheduledFrom` pointer second (when the form payload includes the source's prior appointment ID for a reschedule).
   - Match by `(EmailLower, PhoneNorm, BrandNormalized)` triple as fallback.
   - Otherwise create a new root.
4. Generate a new `APPT_ID` and create the appointment event in `01_AppointmentEvents`.
5. Update `02_RootAppointments` with the new active appointment pointer.
6. Create `03_CustomerInfo` row if root is new; update contact fields if changed.
7. Initialize `04_ClientStatus` row if root is new.
8. Inherit owner assignment from previous appointment if this is a reschedule.
9. Release Tier A lock.
10. Outside the lock: enqueue Drive folder creation, Chat notification, and DV initialization to deferred work.
11. Set the form-submit drain flag in `_Config` for 30 seconds.
12. Invalidate cache entries for the root.

### 8.5 Intake Test Cases

The dedupe and matching logic must pass these test cases before the system goes live. These are the gate for Phase 4:

- New Acuity booking, no prior root → creates root, customer info, status, single event.
- Reschedule of existing booking, same root → marks old event rescheduled, creates new event with same `RootApptID`, both rows linked.
- Reschedule chain (A → B → C), all share root → three events linked, only C is active.
- Two appointments same email but different phones (business decision encoded in test).
- Two appointments same Acuity ID submitted twice → idempotent, second submission updates fields rather than duplicating.
- Cancellation of a rescheduled appointment → only the active event is canceled, prior rescheduled events remain marked rescheduled.
- Field edit on a confirmed appointment → fields updated in place, no new event row.
- Manual admin booking → root and event created with `BookingSource='manual'`, no `ExternalBookingId`.

---

## 9. Task System

### 9.1 Task Generation

A Tier B job, runs every 5 minutes, named lock `taskgen`. Steps:

1. Read all active appointments from `01_AppointmentEvents` joined with `02_RootAppointments`, `03_CustomerInfo`, `04_ClientStatus`, `05_Order3D`, `05_WaxRequests`, `06_DiamondViewing`. Read outside any sheet lock.
2. Read current task state from `_TaskQueue`.
3. Read users, roster, schedule changes for owner resolution.
4. For each appointment, evaluate task generation rules and produce a desired task set.
5. Diff desired vs current task state, producing a list of upserts and blocks.
6. Acquire document lock briefly per upsert/block, release between writes.
7. Append to `_TaskLog` and invalidate caches.

Generation logic in `06_Service_TaskGeneration.gs` as testable pure functions:

- `TaskGen.coreAppointmentTasks(appointment, status, artifacts)` → desired tasks
- `TaskGen.postConsultTasks(appointment, status, order3d)` → desired tasks
- `TaskGen.diamondTasks(appointment, dv, stones)` → desired tasks
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

| Task | Owner | Created When |
|---|---|---|
| `PROPOSE_DIAMONDS` | Client Advisor | diamond viewing workflow active |
| `PREPARE_DV_QUOTATION` | JOC | diamond viewing workflow active |
| `ORDER_DIAMONDS` | Diamond Order Admin | proposed/orderable stones need order review |
| `TRACK_DIAMONDS` | Diamond Order Assistant | ordered stones need tracking |
| `CONFIRM_DIAMOND_DELIVERY` | Diamond Order Admin | delivered confirmation needed |
| `ACK_DIAMONDS_ORDERED_ASSIGNED_REP` | Client Advisor | ordered acknowledgement needed |
| `ACK_DIAMONDS_ORDERED_JOC` | JOC | ordered acknowledgement needed |
| `RECORD_DIAMOND_DECISIONS` | JOC | decisions due |
| `RETURN_DIAMONDS` | Diamond Order Assistant | return due |
| `REVIEW_DIAMOND_ETA_ASSIGNED_REP` | Client Advisor | ETA risk exists |
| `REVIEW_DIAMOND_ETA_JOC` | JOC | ETA risk exists |

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
   - Client status task → `04_Repo_ClientStatus.update(...)` + `04_Repo_ClientStatus.appendHistory(...)`.
   - Start 3D task → `04_Repo_Order3D.update(...)` + `04_Repo_Order3D.appendHistory(...)`.
   - 3D deadline task → `04_Repo_ClientStatus.updateDeadline(...)` + history.
   - Wax request task → `04_Repo_Wax.create(...)`.
   - Diamond proposal/order/etc. → `05_Ext_StonesWorkbook.update(...)` + `04_Repo_DiamondViewing.update(...)`.
   - Appointment checklist → `04_Repo_Appointments.recordOutcome(...)` + `04_Repo_Artifacts.markRequirement(...)`.
   - Approve recap → `04_Repo_Artifacts.markApproved(...)`.
   - Send final recap → `04_Repo_Artifacts.markHandoff(...)`.
6. Mark task `Completed` in `_TaskQueue`.
7. Append `COMPLETE` event to `_TaskLog`.
8. Invalidate affected cache entries.
9. Release Tier A lock.
10. Return refreshed `TaskListSlice` and `CustomerRootDetailSlice` for the affected root.

User does not wait for task generation to refresh. The next Tier B task-gen run reconciles new tasks within 5 minutes; meanwhile, the dashboard already reflects the completed task.

### 9.4 Task Snooze

Independent of any deadline. Updates `_TaskQueue` snooze fields only. Does not update `04_ClientStatus`. Does not change task generation behavior; the next task-gen run sees the snooze and respects it.

---

## 10. Dashboard API Surface

The complete list of `Api.*` functions exposed to the web app. Every interaction from the client goes through one of these.

### 10.1 Auth And Bootstrap

- `Api.auth.login(email, password)` → session + initial bootstrap
- `Api.auth.logout()`
- `Api.bootstrap.get()` → user, visible views, initial My Queue counts

### 10.2 Tasks

- `Api.tasks.list(view)` → `view` ∈ `mine`, `cleanup`, `coverage`, `admin`
- `Api.tasks.detail(taskId)` → task + rendered template + customer mini
- `Api.tasks.complete(taskId, payload, version)`
- `Api.tasks.snooze(taskId, until, reason, version)`
- `Api.tasks.claim(taskId, version)`
- `Api.tasks.acknowledge(taskId, version)`
- `Api.tasks.logTemplateCopied(taskId)`

### 10.3 Customers

- `Api.customers.search(filters)` → list + Kanban
- `Api.customers.getDetail(rootApptId, mode)` → shared detail slice
- `Api.customers.updateStatus(rootApptId, fields, version)`
- `Api.customers.updateDeadline(rootApptId, fields, version)`
- `Api.customers.submit3DRevision(rootApptId, payload, version)`
- `Api.customers.requestWax(rootApptId, payload, version)`
- `Api.customers.startOrder(rootApptId, payload, version)`

### 10.4 Calendar

- `Api.calendar.getMonth(monthKey)` → calendar slice
- `Api.calendar.getAiBrief(rootApptId)` → AI brief

### 10.5 Admin

- `Api.admin.dashboard(filters)` → admin slice
- `Api.admin.assignOwners(rootApptId, advisor, joc, version)`
- `Api.admin.reassignTask(taskId, toUser, version)`
- `Api.admin.blockTask(taskId, reason, version)`
- `Api.admin.unblockTask(taskId, version)`

### 10.6 Schedules And Users

- `Api.schedules.list()`
- `Api.schedules.save(rows)`
- `Api.schedules.upsertChange(row)`
- `Api.schedules.deleteChange(id)`
- `Api.users.list()`
- `Api.users.upsert(user)`

### 10.7 Diamonds

- `Api.diamonds.inStock(filters)`
- `Api.diamonds.tracking()`
- `Api.diamonds.bulkReturnCandidates()`
- `Api.diamonds.bulkMarkReturnInProgress(stoneIds, version)`
- `Api.diamonds.assignInStock(stoneId, rootApptId, version)`
- `Api.diamonds.submitProposal(rootApptId, payload, version)`
- `Api.diamonds.submitOrderApproval(stoneIds, version)`
- `Api.diamonds.submitConfirmDelivery(stoneIds, version)`
- `Api.diamonds.submitDecisions(rootApptId, decisions, version)`
- `Api.diamonds.previewLoupe360Sync(fileId)`
- `Api.diamonds.applyLoupe360Sync(fileId, plan)`

### 10.8 Payments

- `Api.payments.init(rootApptId)` → context for payment dialog
- `Api.payments.submit(rootApptId, payload, version)`
- `Api.payments.history(rootApptId)`
- `Api.payments.exportPdf(paymentId)`
- `Api.payments.reset(rootApptId, version)`

### 10.9 Artifacts

- `Api.artifacts.uploadFolder(taskId, artifactType)` → Drive folder for upload
- `Api.artifacts.syncDriveUploads(taskId)` → register dropped files
- `Api.artifacts.getBrief(rootApptId)` → AI brief

### 10.10 Diagnostics (Admin Only)

- `Api.diag.benchmarks()` → run benchmark suite
- `Api.diag.driftReport()` → run drift reconciliation
- `Api.diag.opsLog(filters)` → operational log

---

## 11. Dashboard UI

The dashboard is a single HtmlService web app. The visual design and information architecture are specified here so the build is consistent.

### 11.1 Visual Design

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

### 11.2 Layout

Two main shells:

- **Default shell:** masthead, toolbar with navigation tabs and primary action, status line, two-column layout (main content + detail panel sidebar).
- **Workspace mode:** full-width single column. Used for task workspaces that need more space (proposal workspace, customer detail when accessed from Customer Search).

The shell switches to workspace mode by toggling a class on the root element (`proposal-workspace-mode`, `customer-search-wide`, `admin-dashboard-wide`, `employee-schedule-wide`, `user-admin-wide`).

### 11.3 Navigation

Top-level navigation grouped into four nav groups, each rendering a dropdown:

| Group | Items |
|---|---|
| Work | My Queue, Calendar, JOC Coverage |
| Customers | Customer Search, Customer Pipeline (Admin Dashboard) |
| Diamonds | Diamond Inventory, Diamond Tracking, Bulk Returns |
| Admin | Schedules, Admin Review, Manage Users, Cleanup |

Visibility of items and groups is driven by user role. Empty groups are hidden.

### 11.4 Customer Detail Surface

Single most important UI pattern. Used in Customer Search detail, Calendar expanded detail, Admin Pipeline detail, task customer panel.

Layout, top to bottom:

1. **Hero:** customer name, sales stage chip, advisors, JOC, brand, SO#, RootApptID, last touch indicator.
2. **AI Brief** (when present): review flags, sales brief, links to summary doc and transcript.
3. **Next Steps:** vertical rule, label, current next steps text, Edit button.
4. **Take Action:** action panels for Update Client Status, Update 3D Deadline, Submit 3D Revision Request, Request Wax. Each is a `<details>` element that expands inline.
5. **Info grid (3 columns):** Order Status (key/value list), Payment History, References (link grid).
6. **Footer grid (3 columns):** Related Appointments, Open Workflow Tasks, Recent Activity.

### 11.5 Task Detail Surface

Shown in the right-hand detail panel for most tasks. Workspace mode for `PROPOSE_DIAMONDS` (3-step proposal flow).

Common sections:
- Panel header with eyebrow lifecycle stage and task title.
- Customer/appointment metadata.
- Instructions block.
- Task-type-specific completion controls (appointment outcome selector + Drive upload, AI review panel, message template box with copy button, attachment list, post-consult form, diamond decisions, etc.).
- Checklist with required-asterisk markers.
- Snooze panel (collapsed `<details>` element).
- Actions row: Claim (when applicable), primary Complete button.
- Admin assignment block (when admin).

### 11.6 Proposal Workspace

3-step workflow for `PROPOSE_DIAMONDS`. Renders in workspace mode.

| Step | Purpose |
|---|---|
| 1. Customer requirements | Buying brief, stone type, shape, carat range, color range, clarity range, primary deciding factor, ratio preference, budget note, variety to show, internal notes. Blocks advance until required fields filled. |
| 2. Find or add stones | Match against in-stock 200_ inventory using requirements; sort by best match / carat / return date; select inventory stones to add to proposal; manual stone entry for stones not in inventory. |
| 3. Review and submit | Customer summary, requirement summary, stone summary, pre-flight checklist, submit. |

Stepper at top with clickable steps. Footer with Back / Continue / Submit.

### 11.7 Calendar

Month grid, 7×6, with weekday headers. Each day cell shows up to 4 appointments, with overflow indicator. Today is visually distinguished. Day click navigates to event detail in the right panel. Previous/Next month buttons.

### 11.8 Admin Dashboard

Single-column wide layout. Sections:

1. Filter panel (window preset, dates, brand, advisor, JOC, include closed toggle).
2. At-risk snapshot (3 cards: tone-coded danger/warn/info).
3. Weekly pulse (4 cards).
4. Pipeline by stage (6 stage cards).
5. Trend chart (12-week bookings + first deposits).
6. Lead sources (90-day source breakdown with bars).
7. Advisor scorecard (table).
8. Top deals + receivables (two columns).

### 11.9 Diamonds

**In-Stock:** stat cards row, filter panel (shape, carat min/max, color, clarity), filterable list. Detail panel shows assignment form when selected.

**Tracking:** stat cards row, list of issue rows, missing-columns warning when 200_ headers are out of date.

**Bulk Returns:** stat cards, bulk action buttons (Select Overdue / Due Soon / All / Clear), checkbox list of candidates, detail panel with shipment notes textarea and submit-with-confirm button.

### 11.10 Schedules

Single-column wide layout. Hero with Add User and Save Changes. Auto-assign toggle card. Summary cards (Advisors, JOC, Working Today, Linked Pairs). Roster table with role chips, skill chips, day-of-week chips, JOC routing dropdowns. Schedule override grid (form on left, list of overrides on right).

### 11.11 Manage Users

Single-column wide layout. Form for add/update with email, name, password (with generate button), role checkboxes with descriptions, active toggle, notes. List of existing users with role display.

### 11.12 Interaction Patterns

- **Optimistic UI:** mutations return the refreshed slice; UI updates immediately on success.
- **Version conflicts:** API rejection with conflict surfaces the latest values to the user.
- **Drive upload polling:** when a Drive folder is opened for appointment artifacts, the dashboard polls `Api.artifacts.syncDriveUploads` every 20 seconds for up to 10 minutes to register and rename newly dropped files.
- **Copy to clipboard:** template messages and manufacturing messages have copy buttons; copy actions log via `Api.tasks.logTemplateCopied`.
- **Delete confirmations:** destructive actions (delete schedule override, bulk return submit) require a second click within 4 seconds to confirm.
- **Auto-clearing status:** the status line clears on the next successful action.
- **Session timing logging:** the dashboard records load timing marks (login screen DOM ready, login paint, bootstrap request, first task DOM, first task paint) and posts them to a server logging function for performance tracking.

### 11.13 Auth UI

Single login screen before the dashboard mounts. Email + password. Sign In button shows loading state. Error messages render below the form. On success, session token stored in `sessionStorage` under `salesWorkflowToken`; bootstrap response renders the dashboard.

---

## 12. Setup, Schema Versioning, And Triggers

### 12.1 No Manual Edits

Tabs, headers, named ranges, dropdowns (data validation), conditional formatting, frozen rows, column widths, sheet protections, and document properties are all created by code. A spreadsheet that has been hand-edited cannot be promoted to production. The setup function detects manual deviations and refuses to run, surfacing diffs in the run log.

### 12.2 Schema Version

`_SchemaVersion` tracks current schema version (semver), last setup run timestamp, setup function git/script revision, and migration history.

Every `00_Setup_*` function is associated with a target version. Running setup on a workbook at version N migrates it to N+1 in idempotent steps.

### 12.3 Idempotent Setup

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

### 12.4 Headers As Code Constants

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

### 12.5 Dropdowns And Validation Rules

`00_Setup_Dropdowns.gs` defines every dropdown by name and applies it to ranges. `_Config` exposes editable dropdown values (e.g., custom order status options); setup reads `_Config` during validation rule construction. Dropdown rules are recreated from scratch on every setup run.

### 12.6 Triggers

`00_Setup_Triggers.gs` installs all triggers. An admin runs `Setup.installTriggers()` after `Setup.runAll()` succeeds. `Setup.removeTriggers()` removes them for maintenance.

| Trigger | Frequency | Function | Tier |
|---|---|---|---|
| Acuity poll | every 5 min | `Trigger.acuityPoll` | B |
| Acuity label sync | every 15 min | `Trigger.acuityLabelSync` | B |
| Form submit | on form submit | `Trigger.onFormSubmit` | A |
| Task generation | every 5 min | `Trigger.taskGen` | B |
| Cache prewarm | every 5 min | `Trigger.cachePrewarm` | B |
| URL repair | hourly | `Trigger.urlRepair` | B |
| Drift check | nightly | `Trigger.driftCheck` | B |
| Artifact processing | every 5 min | `Trigger.artifacts` | B |

### 12.7 Drive Folders

Drive folder creation (customer folder, appointment folder, order folder, wax folder, payments folder) is handled by `06_Service_Artifacts.gs` and called by intake and order services. Folder IDs are stored in `03_CustomerInfo` (customer-level) and `01_AppointmentEvents` (appointment-level). Folder creation is idempotent: the service checks for existing folder ID first.

---

## 13. External Integrations

All external workbooks and services are accessed through adapters in `05_Ext_*`. Every external read and write is wrapped, throttled, and logged.

### 13.1 200 Stones Workbook

`05_Ext_StonesWorkbook.gs`:

- `Stones.getInStock(filters)` — read in-stock stones
- `Stones.getByRoot(rootApptId)` — read stones assigned to a root
- `Stones.assign(stoneId, rootApptId, fields)` — assign a stone
- `Stones.markOrdered(stoneIds, fields)`
- `Stones.markReturnInProgress(stoneIds)`
- `Stones.markDelivered(stoneIds)`
- `Stones.recordDecisions(rootApptId, decisions)`
- `Stones.previewLoupe360Sync(fileId)`
- `Stones.applyLoupe360Sync(fileId, plan)`

Workbook-specific named lock coordinates concurrent access. Reads cached for 60 seconds.

### 13.2 Payment Ledger Workbook

`05_Ext_PaymentLedger.gs`:

- `Ledger.getByRoot(rootApptId)` — all payments for a root
- `Ledger.append(rootApptId, payment)` — append a payment row
- `Ledger.linkDocs(paymentId, invoiceUrl, receiptUrl)` — after doc generation
- `Ledger.summary(rootApptId)` — paid-to-date, balance, last payment date

Summary feeds the `PaymentSummarySlice` cache. Reads cached for 60 seconds.

### 13.3 3D Tracker Workbook

`05_Ext_TrackerWorkbook.gs`:

- `Tracker.appendLog(rootApptId, entry)`
- `Tracker.getEntries(rootApptId)`

### 13.4 Quote Workbook

`05_Ext_QuoteWorkbook.gs`:

- `Quote.getSavedLines(rootApptId)`
- `Quote.refreshFromTracking(rootApptId)`
- `Quote.refreshFrom3D(rootApptId)`

### 13.5 Drive

`05_Ext_Drive.gs` — thin wrapper consolidating DriveApp calls, caching folder IDs, ensuring every Drive call has a clear caller and purpose for `_OpsLog`.

### 13.6 Acuity API

`05_Ext_Acuity.gs`:

- `Acuity.fetchActiveAppointments(window)`
- `Acuity.fetchCanceledAppointments(window)`
- `Acuity.fetchAppointmentDetail(acuityId)`
- `Acuity.fetchLabels()`

Credentials read from Script Properties. All calls go through a single `UrlFetchApp` wrapper that handles auth, retry, and rate limiting.

### 13.7 AssemblyAI

`05_Ext_AssemblyAI.gs`:

- `AssemblyAI.startTranscription(driveFileId)` → returns transcript ID
- `AssemblyAI.pollTranscription(transcriptId)` → returns status + text when ready

Used by the artifact processing pipeline.

### 13.8 OpenAI

`05_Ext_OpenAI.gs`:

- `OpenAI.summarizeTranscript(transcript, customerContext)` → returns sales brief, client follow-up draft, review flags

Prompts and model selection live in `_Config`.

---

## 14. Artifact Processing Pipeline

Appointment recordings are processed through this pipeline:

1. Rep opens task drawer, clicks "Open Drive Folder" for the appointment.
2. Dashboard calls `Api.artifacts.uploadFolder(taskId, artifactType)` which ensures the Drive folder exists and returns the URL.
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

## 15. Security And Auth

### 15.1 Login

`_Users` stores email, name, roles (multiple), active flag, password salt, password hash, last login. Login validates against `_Users` and creates a session token stored in CacheService keyed by token, value is the user object, TTL 8 hours.

### 15.2 Authorization

Every API function takes the session token, resolves the user, and checks role-based permissions before doing anything else. Roles:

- Admin
- Client Advisor
- JOC
- Diamond Order Admin
- Diamond Order Assistant
- Read-Only Viewer

Permissions per API function are defined in `01_Const_Permissions.gs` as a single map.

### 15.3 Audit

Every write API function appends to `_OpsLog`: timestamp, user email, function called, target root or task, result, lock wait time, lock hold time, version delta.

---

## 16. Code Architecture Rules

Enforced by code review and by `11_Diag.checkArchitectureRules()` which scans the codebase for violations.

1. **Layering:** A file may only call functions from same-or-lower prefix. Service files cannot call other service files (use shared utility or repo). Repo files cannot call service files. API files cannot call repos directly (must go through services).

2. **No direct sheet I/O outside repos and setup.** `SpreadsheetApp.getActive().getSheetByName(...).getRange(...)` is forbidden outside `04_Repo_*` and `00_Setup_*`. Service files calling `getRange` fails review.

3. **No hardcoded tab names.** Tab names live in `01_Const_Tabs.gs` only. Any string literal matching a tab name elsewhere is a violation.

4. **No hardcoded column letters or numbers in service files.** Use the column constants from `01_Const_Columns.gs`. Repo files convert constants to ranges.

5. **Every mutation function returns `{ ok, version, slice, invalidated }`.** No mutation function returns `void` or `boolean`. The slice returned is the refreshed data the caller's UI needs.

6. **Every read function returns `{ data, version, source, ageMs }`.** The `source` field is `cache` or `domain` — making the fallback chain visible.

7. **No `try/catch` swallowing in repos.** Repos let errors propagate. Services may catch and translate to user-facing error responses. APIs always return structured error responses, never throw.

8. **No `Utilities.sleep` anywhere.** If a flow needs to wait for something, it returns and the caller polls or the orchestrator handles it.

9. **No global state.** No `let`-declared module-level mutable state. Read state from sheets or pass it explicitly.

10. **One writer per fact.** If two functions in different files write the same column, one is wrong.

---

## 17. Phased Implementation Plan

The plan is structured to defer user exposure as long as possible. Each phase has a test gate.

### Phase 0 — Foundations

**Build:**
- New workbook created.
- New Apps Script project bound.
- File structure set up with empty stubs in every prefix.
- `01_Const_Tabs.gs`, `01_Const_Columns.gs`, `01_Const_Enums.gs`, `01_Const_Permissions.gs` populated with full schema.
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
- All `04_Repo_*` files with full read/write APIs against domain tabs.
- Optimistic concurrency (version checks).
- Repo unit tests.

**Test gate:**
- 100% of repo functions have unit tests.
- Concurrency test: two simulated writers updating the same row produce one success and one version-conflict response.
- Lock metrics logged to `_OpsLog`.

### Phase 2 — Cache Layer

**Build:**
- `07_Cache_*.gs` files with all slice builders.
- Shared `CustomerRootDetailSlice` builder used by all four detail surfaces (verified by file structure).
- TTL and invalidation logic.

**Test gate:**
- All slice modes (`card`, `standard`, `full`, `taskMini`) return correct shapes for sample data.
- Cache hits/misses logged.
- Invalidating an entry forces rebuild on next read.

### Phase 3 — Services Without Intake

**Build:**
- `06_Service_TaskGeneration.gs` with all rules from Section 9.2.
- `06_Service_TaskCompletion.gs` with adapter dispatch.
- `06_Service_Diamonds.gs`.
- `06_Service_Payments.gs` (wired to ledger workbook).
- `06_Service_Artifacts.gs`.
- `13_Ext_*` adapters for stones, ledger, tracker, quote, Drive.
- `05_Ext_AssemblyAI.gs` and `05_Ext_OpenAI.gs`.

**Test gate:**
- Task generation produces correct desired tasks for hand-built test scenarios covering every task type.
- Task completion runs every adapter against test data without errors.
- Diamond proposal/order/track/return flows update sample 200 workbook rows correctly.
- Payment submission appends to test ledger.
- Artifact pipeline runs end-to-end against a sample audio file.

### Phase 4 — Intake (the critical phase)

**Build:**
- `06_Service_Intake.gs` with `resolveOrCreateRoot`, `matchExistingByExternalId`, `detectReschedule`, `classifyAcuityChange` as pure functions.
- `10_Trigger_Acuity.gs` Acuity poll and label sync.
- `10_Trigger_FormSubmit.gs` form-submit handler.
- Form-submit drain coordination.

**Test gate:**
- All scenarios in Section 8.5 pass against test data.
- Acuity label sync correctly updates statuses.
- Form-submit drain prevents task gen from running during intake.

### Phase 5 — Dashboard API

**Build:**
- All `08_Api_*` functions per Section 10.
- Authentication, session management, role checks.
- Structured error responses.
- Benchmarks in `11_Diag_Benchmarks.gs`.

**Test gate:**
- Every API function has a happy-path and an auth-failure test.
- Benchmark suite produces baseline.
- API response shapes match documented contracts.

### Phase 6 — Web App Client

**Build:**
- HtmlService entry, client bundle.
- All views per Section 11.
- Login screen.
- Optimistic UI with version conflict handling.
- Drive upload polling.
- Client load timing instrumentation.

**Test gate:**
- A test user can log in and use every view against the test workbook.
- Concurrency: two browsers updating the same row demonstrate proper conflict handling.
- All detail surfaces render the shared `CustomerRootDetailSlice` consistently.
- Performance targets met (Section 18).

### Phase 7 — Hardening And Launch Prep

**Build:**
- Operational runbooks: Acuity outage, Drive quota, AI pipeline failure, lock contention, schema corruption.
- User training material.
- Final benchmark suite run.
- All triggers installed.

**Test gate:**
- Benchmarks meet targets.
- All triggers fire correctly.
- Sample appointments can flow end-to-end: Acuity booking → form submit → root creation → task generation → task completion → artifact processing.

### Phase 8 — Launch

**Activities:**
- Announce launch window to users.
- Switch Acuity to point at the production form.
- Send users the dashboard URL.
- On-call engineer monitors `_OpsLog` and dashboard for 24 hours.

### Phase 9 — Post-Launch

**Activities:**
- Daily drift check between system state and external workbooks.
- Weekly review of `_OpsLog` for unexpected errors.
- Performance tuning based on observed benchmarks.
- Add read model tabs only if direct cache + canonical reads can't hit targets.

---

## 18. Performance Targets

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
| Tier A user write | lock held under 200ms; total under 1.0s |
| Tier B background job | does not block any Tier A write for more than 200ms |

Benchmarks record source path used (cache or canonical), cache age, and slowest step. Regressions surface in the admin diagnostics view.

---

## 19. Acceptance Criteria

The system is accepted when:

1. All API functions in Section 10 are implemented and pass tests.
2. Every canonical fact has exactly one home tab as defined in Section 5.
3. Setup is fully idempotent and the workbook is reproducible from empty by code.
4. Architecture rules in Section 16 pass the static check with zero violations.
5. Performance targets in Section 18 are met for warm reads.
6. Lock metrics show Tier A writes never block on Tier B jobs for more than 200ms.
7. End-to-end test passes: Acuity booking → form submit → root creation → task generation → completion → artifact processing → recap approval.
8. Users have been trained.

---

## 20. Open Decisions

These need a sign-off before Phase 0 begins:

1. **Workbook name and Drive location.**
2. **Acuity polling window.** Default proposed: last 14 days plus future 90 days.
3. **Form-submit drain duration.** Plan says 30s; confirm against Acuity webhook timing.
4. **Same-email-different-phones edge case.** Business decision: separate roots or merge? Encoded in test cases for Phase 4.
5. **Dropdown values that admins can self-edit vs. config-controlled.** Need a list per dropdown.
6. **Initial admin user(s).** Bootstrap requires at least one admin in `_Users` before the dashboard is usable.

---

*End of PRD.*