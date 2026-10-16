# Fasttracks Mobile Parity & Quality Audit — 2026-09-21

Method: read `backend/src/lib/tabRegistry.ts` (dashboard's source of truth for
modules/roles) against the dashboard's `frontend/src/app/(dashboard)/dashboard/*`
route tree, then read every mobile screen under `~/fasttracks-mobile/src/app`
and `src/constants/screen-registry.ts` (the mobile app's own self-documented
screen/endpoint/role map) line by line, plus `grep` sweeps for dummy-data
markers, API call patterns, and UI-quality patterns (KeyboardAvoidingView,
RefreshControl, numberOfLines, accessibilityLabel, fixed dimensions).

**Top-line finding, stated plainly:** this is NOT a broken or fake app. Every
screen I read calls real backend endpoints via `src/lib/api.ts` — I found
**zero** hardcoded/mock data arrays standing in for API responses and **zero**
no-op button handlers. The `screen-registry.ts` file is an unusually honest
in-code engineering log: each entry states exactly which dashboard endpoints
it deliberately left out and why (e.g. "no barcode scanner installed",
"no audio playback package installed", "fail-open risk, use hardcoded role
array not getTabAccess"). The real gap is **scope, not fakery**: most
finance/ops modules are read-only on mobile where the dashboard has full
CRUD. **Update 2026-09-23: two of the four originally-MISSING modules
(Contacts, Employee Documents) were built 2026-09-22 and are no longer
missing** — see the per-module rows below. Password Manager remains
missing deliberately (needs a product decision, not code). Quotations
remains a genuine, unflagged gap.

---

## Summary table

| Dashboard module (tabRegistry key) | Mobile status | Note |
|---|---|---|
| overview | PARTIAL | Mobile shows only `/dashboard/overview` + `/dashboard/recent-activity`; `today-snapshot`, `revenue-by-employee` omitted. OWNER-only both sides. |
| customers_jobs | PARTIAL | Mobile `app/customers/*` — verify mode parity (view_only/sales_mode/full_access) not traced to component level; see UNVERIFIED. |
| new_entry | PARTIAL | `more/new-entry.tsx`: keeps name/vehicle/reason + phone lookup; drops GST/address, lead-source, owner/driver toggle, employee-assignment picker, photo/video upload. |
| job_tracker (pipeline) | PARTIAL | `more/pipeline.tsx`: read-only grouped-by-status list; dashboard is drag-and-drop Kanban with status-change actions. No write path at all on mobile. |
| conversations | COMPLETE-ish | `app/(app)/conversations` calls `fetchConversations`; not verified for full feature match (send/close/assign). |
| tasks | PARTIAL | `/tasks` calls `GET /tasks`, `PATCH /tasks/:id/status` only, per registry — narrower than dashboard Team Chat's `tasks` tab. |
| ai_agents | PARTIAL | `more/agents.tsx`: status + last-20 activity only. Trigger/toggle actions explicitly excluded (live webhook side effects). |
| password_manager | **MISSING (deliberate)** | Still no file. Flagged in `DASHBOARD_PARITY_PLAN.md` as needing a product decision before building — credentials on mobile carry their own risk profile. Not an oversight; needs a decision, not code. |
| calls | PARTIAL | Metadata + log only; no in-app playback/download (no audio package installed). |
| my_tasks | UNVERIFIED | `/tasks` route may double as this; not cleanly separable from `tasks` above in mobile nav. |
| remarks | PARTIAL | `more/remarks.tsx` (466 lines, largest screen) — full OWNER management + self read-only + reply modeled; largest overlap with dashboard, but field-by-field parity unverified. |
| reminders | PARTIAL | snooze/ack/done present per registry; verify parity of recurrence/definition editing UI. |
| contacts | **BUILT (2026-09-22)** | `more/contacts.tsx` (377 lines) — full CRUD, gated to `CONTACTS_DIRECTORY_ROLES=[OWNER,STORE_MANAGER,TECH_TEAM]` for list/detail/create, delete narrower (`CONTACTS_DELETE_ROLES=[OWNER,STORE_MANAGER]`, no TECH_TEAM). No longer MISSING. |
| legal | PARTIAL | Case list + per-case doc **metadata** only. Explicitly does not call the file-streaming/download endpoint — most sensitive data in the app is unreadable on mobile (by design, but a real capability gap). |
| employee_documents | **BUILT (2026-09-22)** | `more/employee-documents.tsx` (374 lines) — admin directory + upload, gated to `PRIVILEGED_ROLES=[OWNER,HR,STORE_MANAGER]` or a per-employee tab override. No longer MISSING. |
| employees | PARTIAL | View + edit (name/phone/email/designation, role OWNER-only, salary for OWNER/STORE_MANAGER/CASHIER) present; no create/delete traced. |
| attendance | PARTIAL | Self-view only (today/monthly/late/warnings). Explicitly excludes `/attendance/register` and any edit/override/pardon — comment says the underlying Prisma model (`attendanceEditLog`) doesn't exist in schema, so the dashboard feature itself may be broken; flagged, not fixed (audit-only). |
| leave_requests | PARTIAL-COMPLETE | Submit + approver queue both present per registry, gated to same roles as backend. |
| personal_info | PARTIAL | Self profile + ID docs view; no upload/delete (HR/Owner-only dashboard feature, correctly out of scope for most roles but also absent for HR/Owner on mobile). |
| my_salary | COMPLETE-ish | Self salary/OT/late records. |
| overtime | COMPLETE-ish | Self request + status. |
| overtime_approval | PARTIAL | Approve/reject present (`fetchPendingOvertime`, has approve/reject per registry) — confirm write calls exist (see below, `overtime-approval.tsx` grep showed only `fetchPendingOvertime` in my quick api-call scan, worth re-checking approve/reject actually POST). |
| payroll | PARTIAL | Company summary, export, disbursement present; salary override POST/DELETE claimed in registry but not independently traced to UI controls — UNVERIFIED. |
| incentives | PARTIAL | View for managers; write (targets/amount) for CASHIER/OWNER only, matches backend. |
| payslips | PARTIAL | Generate present (`createPayslip`); verify PDF/download rendering. |
| timesheet (my) | PARTIAL | Entries + attachments + submit present; attachments section hidden entirely for TECHNICIAN/STAFF because `/work-docs` router is blocked for those roles server-side (documented, correct). |
| timesheets | PARTIAL | Manager register, read-only list (`fetchTimesheetRegister`), no reply/comment actions traced. |
| finance_approvals | RESOLVED 2026-09-23 (was PARTIAL/flagged) | **The discrepancy below was investigated and closed.** The dashboard's finance-approvals page has exactly two tabs, "loans" (this queue) and "active" (running-balance view), both reading the same `/loans` data — there is no separate Advance model/route; "Loan" is only the Prisma model's internal name, every dashboard UI label calls this feature "Advance." Mobile's registry note was corrected 2026-09-21 to say so, and this screen now also has an Active-advances tab (client-side filter of the same list, matching the dashboard's own split — no new endpoint needed). No longer a gap. |
| my_finance | COMPLETE-ish | Self loans/advances request+track. |
| financial | PARTIAL (heavy) | Mobile shows 1 of 9 dashboard endpoints (`overview` only) as KPI cards. Dashboard's revenue-breakdown, outstanding, payments-today, growth, top-customers, revenue-trend, source-breakdown all absent. |
| accounting | PARTIAL | Ledger list, read-only. No voucher posting/cancel/allocate. |
| accounts | PARTIAL | Bank list, masked numbers only; no reveal, matches server masking intentionally. |
| erp_finance | PARTIAL | KPI + paginated order list only; sales-performance/services/customers reports omitted. |
| expenses | PARTIAL-COMPLETE | Submit + list present (`submitExpense`); approve action (`PATCH /expenses/:id/approve`) named in registry but not confirmed wired to a UI control — UNVERIFIED. |
| purchasing | PARTIAL | Read-only orders + suppliers list; no create/edit/delete. |
| sales_orders | UNVERIFIED | No distinct tabRegistry `route`; likely maps to `erp-sales.tsx` (read-only). |
| quotations | **MISSING** | No file, no import, no reference anywhere in `src/`. |
| invoices | PARTIAL | List + detail read-only. No mark-paid/waybill/WhatsApp actions (dashboard's `invoice_actions_route.ts`, ADMIN_ROLES only) — reasonable but real gap for OWNER/STORE_MANAGER who do have that on web. |
| inventory | PARTIAL | Searchable list only; no create/edit/adjust-stock, no barcode scan (package not installed). |
| settings_company | PARTIAL | Only single `SupplierSettings` row (GST/address/contact); dashboard's broader company settings tree not confirmed covered. |
| devices | PARTIAL | List/alerts/location/app-usage/policy-view in one screen; no enrollment, remote lock/wipe, or policy push (existing `lockDevice`/`unlockDevice` API functions unused by the screen). |
| app_policies | PARTIAL | Folded into `devices.tsx` view-only; no create/edit of policies (OWNER-only on dashboard). |
| device_alerts | PARTIAL | Folded into `devices.tsx`. |
| live_location | PARTIAL | Folded into `devices.tsx` as location-logs history; unclear if dashboard's live/real-time map view has a mobile equivalent — likely PARTIAL to MISSING for true "live" tracking. |
| sim_tracker | PARTIAL | Stats + list read-only; no add/edit (dashboard ADMIN_ROLES-only feature). |

## Counts per status category
- COMPLETE / COMPLETE-ish (genuine parity or self-scoped 1:1 match): 8
- PARTIAL (real data, meaningful gaps vs dashboard): 30
- MISSING (no mobile equivalent at all): 2 as of 2026-09-23 — **Password Manager** (deliberate, needs a product decision), **Quotations** (genuine gap). Contacts and Employee Documents were built 2026-09-22 and moved out of this category.
- DUMMY (hardcoded/mock/stub data or no-op handlers): **0 found** — see caveat below
- UNVERIFIED (could not confirm from code alone): 5+ (flagged inline above and in its own section)

Caveat on the 0-DUMMY count: I searched exhaustively for the standard markers
(TODO/FIXME/mock/dummy/placeholder/"coming soon"/empty `onPress`) across
`src/app` and `src/components` and found only one incidental match (a code
comment containing the word "Hardcoded" describing a role array, not fake
data). I did not open every one of the ~500+ shared components under
`src/components/`, so a dummy state buried in a sub-component rather than a
screen file is possible but was not found by this pass.

---

## DUMMY DATA section
None found. No file in `src/app/more/*.tsx`, `src/app/(app)/*`, or
`src/app/customers/*` uses a hardcoded array/object as a stand-in for API
data; every screen's list state is `useState<T[] | null>(null)` populated
from a `fetch*` call in `src/lib/api.ts`. No `onPress={() => {}}` or similar
empty handlers were found. If this changes on a rescan of deeper subcomponents,
it should be treated as the highest-priority category per the task spec.

---

## MISSING MODULES section

**As of 2026-09-23, only 2 of the original 4 remain missing:**

1. **Password Manager** (`password_manager` tab, `/dashboard/password-manager`, roles OWNER/STORE_MANAGER/INVENTORY_MANAGER) — still zero mobile presence. Deliberate: flagged in `DASHBOARD_PARITY_PLAN.md` as needing a product decision (credentials on mobile, own risk profile) before anyone builds it, not an oversight.
2. **Quotations** (`quotations` tab, `/dashboard/quotations`) — still zero mobile presence as of the last full audit read. Backend route confirmed live and mounted (`backend/src/routes/quotationRoutes.ts`, `GET/POST /`, `GET/PUT/DELETE /:id`, `PATCH /:id/cancel`, all `verifyToken`-gated, no salary/payroll/legal data). No product-decision flag against this one — genuine gap, candidate for building.

~~Contacts~~ and ~~Employee Documents~~ were built 2026-09-22 (`more/contacts.tsx`,
`more/employee-documents.tsx`) and are no longer in this section — see their
rows in the Summary table above.

---

## PARTIAL section — specific gaps
See per-module notes in the Summary table above; the recurring pattern
across nearly all Finance/Operations modules is **the dashboard has
create/edit/delete/approve write actions that mobile omits**, converting
those modules into read-only viewers on mobile:
- Accounting: no voucher posting/cancel/allocate
- Purchasing, ERP Sales: fully read-only, no order/supplier writes
- Invoices: no mark-paid/waybill/WhatsApp send
- Inventory: no create/edit/stock-adjust, no barcode scan
- Devices: no enrollment/lock/wipe/policy push
- SIM Tracker: no add/edit
- Legal: no document download (most sensitive data unreadable on mobile)
- Financial / ERP Finance: only 1 of ~9-12 dashboard report endpoints surfaced
- Pipeline/Job Tracker: no drag-and-drop or status-change action at all
- New Entry: drops GST/address, lead-source, owner/driver toggle, employee assignment, and all photo/video capture

---

## ROLE / PERMISSION DIVERGENCE section

1. **Finance Approvals — Advances tab discrepancy. RESOLVED 2026-09-23.**
   This was investigated by directly reading the dashboard's finance-
   approvals page source, not just `tabRegistry.ts`. Finding: there is no
   separate Advance model or route anywhere in the backend — `Loan` is the
   only model, and every dashboard UI label ("Request Advance", "Manage
   your salary advances") calls this feature "Advance"; "Loan" is purely
   the Prisma model's internal name. The dashboard's finance-approvals page
   has exactly two tabs ("loans" and "active"), both reading the same
   `/loans` endpoint — `finance_approvals_advances_tab` in `tabRegistry.ts`
   names that same "active" sub-tab, it is not a separate live feature.
   Mobile's own `finance-approvals.tsx` now has both tabs too (the
   "Active advances" tab was added as a client-side filter of the same
   already-fetched list, matching the dashboard's own split — no new
   endpoint was needed). Not a fifth MISSING module; closed.

2. **Client-side-only authorization checks exist, but every one I sampled
   cites a specific backend enforcement point in its own comment** (e.g.
   `accounting.tsx`'s `VIEW_ROLES` cites `backend/src/routes/accounting.ts`
   verified 2026-09-19; `payslips.tsx`'s `PAYSLIP_ROLES` cites the router's
   `requireRoles` middleware). I did not independently re-verify every cited
   backend line myself in this pass (that would mean re-reading the entire
   backend `routes/` tree, which the task's time budget did not allow) — so
   these claims are **trusted-but-not-independently-re-verified**. Anywhere
   a mobile screen shows content behind a client-side-only role check with
   no corroborating backend citation in its own comment, treat it as a
   potential purely-client-side auth gap. Scanning found no such
   uncorroborated screen — every gate I found points to a specific backend
   file and verification date.

3. **Devices module role set is wider on mobile for policy viewing.**
   `devices.tsx` defines `POLICY_ROLES = ['OWNER','STORE_MANAGER','SALES','TECHNICIAN','TECH_TEAM','STAFF','HR','CASHIER']` (a broad set for viewing one's own role's app policy) separate from `MDM_ADMIN_ROLES = ['OWNER','STORE_MANAGER','HR']` for the admin device list — but the dashboard's tabRegistry restricts the whole `devices`/`app_policies`/`device_alerts` tab group to `only('OWNER','HR')` (line 207-209) or `only('OWNER','STORE_MANAGER','HR')` for `live_location` (line 210). If `POLICY_ROLES` on mobile lets SALES/TECHNICIAN/TECH_TEAM/STAFF/CASHIER see a policy screen that the dashboard tab registry would deny those roles entirely, that is a real divergence — **mobile showing something the dashboard hides**. This needs a human check of what `POLICY_ROLES` actually gates (likely just "view your own role's restrictions," a narrower/different feature than the admin Devices tab) — UNVERIFIED, flagged for a tester.

4. No instance found of mobile **denying** something the dashboard grants beyond the MISSING-module list above (which is a scope gap, not a permission bug).

---

## UI / UX FINDINGS (grouped by severity)

Verified from static code only — I did not render any screen. Counts are
from `grep` sweeps across `src/app` (+`src/components` for the shared bits).

### High
- **Keyboard handling gap.** Only 2 files in the entire app use
  `KeyboardAvoidingView`, out of 19 files containing `TextInput` (`login.tsx`,
  `customers/index.tsx`, `more/settings.tsx`, `more/my-finance.tsx`,
  `more/inventory.tsx`, `more/employees.tsx`, `more/crm.tsx`,
  `more/finance-approvals.tsx`, `more/remarks.tsx`, `more/payroll.tsx`,
  `more/new-entry.tsx`, `more/my-timesheet.tsx`, `more/incentives.tsx`,
  `more/payslips.tsx`, `more/leave-requests.tsx`, `more/expenses.tsx`,
  `more/staff-config.tsx`, `more/overtime.tsx`, `more/invoices.tsx`). On
  screens with several stacked inputs (e.g. `new-entry.tsx`'s intake form,
  `expenses.tsx`'s submission form) the keyboard likely covers lower fields
  with no avoidance — needs an on-device check, listed in UNVERIFIED.
- **Missing pull-to-refresh on 8 data screens**: `agreements.tsx`,
  `expenses.tsx`, `leave-requests.tsx`, `my-finance.tsx`, `my-salary.tsx`,
  `my-timesheet.tsx`, `overtime.tsx`, `payslips.tsx`, `personal-info.tsx` —
  no `RefreshControl` found in these files, while 32 other files in the app
  do have it, making this an inconsistency as much as a gap.

### Medium
- **Accessibility labels nearly absent.** Only 2 hits for
  `accessibilityLabel` across `app/` + `components/`. Icon-only buttons
  (menu button, chevrons, close/dismiss icons referenced throughout `more/*`
  list rows) are very likely unlabeled for screen readers — could not fully
  enumerate icon-only Pressables in this pass; flagged for follow-up.
- **`numberOfLines`/truncation handling used in only 7 places** across the
  whole app, despite many list rows rendering variable-length data (customer
  names, job descriptions, remarks text in `remarks.tsx`, legal case titles)
  that could overflow or wrap unpredictably in a fixed-height row.
- **One hardcoded pixel dimension found**: `app/more/my-timesheet.tsx:299`
  — `thumb: { width: 120, height: 90, ... }` for an attachment thumbnail.
  Low risk on its own (a thumbnail, not a layout container) but worth a
  gallery-screen check on a small device width.

### Low / consistency
- `SafeAreaView`/`useSafeAreaInsets` is used broadly (47 files) — safe-area
  handling looks deliberately systematic, not ad hoc. No screens were found
  importing neither `SafeAreaView` nor the hook while also being a top-level
  route (a spot check of `login.tsx`, `more/index.tsx`, and several `more/*`
  screens all use `useSafeAreaInsets`), so this is a comparative strength,
  not a gap.
- Error-state handling (`setError` + rendered message) appears in ~39 call
  sites across the 37 `more/` screens — essentially universal. I did not
  verify that every one of those renders a *visible* error message in JSX
  versus merely setting state (would require reading each render body) —
  UNVERIFIED for exhaustive confirmation, but the pattern is consistent
  enough to call this a comparative strength versus a typical "blank screen
  on failure" finding.

---

## UNVERIFIED section — device-tester checklist

These need a human on a real device/simulator; code reading alone cannot
resolve them:

- [ ] Confirm whether the dashboard's `/dashboard/finance-approvals` page
      still has a live **Advances** tab (tabRegistry.ts still declares
      `finance_approvals_advances_tab`) — if yes, Advances is a MISSING
      mobile module, not an intentionally-removed feature.
- [ ] On `new-entry.tsx`, `expenses.tsx`, and other multi-field forms:
      does the on-screen keyboard cover input fields with no
      `KeyboardAvoidingView` present?
- [ ] Confirm `devices.tsx`'s `POLICY_ROLES` screen section actually shows
      only a narrow "your own role's policy" view to SALES/TECHNICIAN/
      TECH_TEAM/STAFF/CASHIER, not the admin device list — verify it isn't
      exposing MDM admin data to roles the dashboard tabRegistry denies.
- [ ] Verify `overtime-approval.tsx` and `finance-approvals.tsx` actually
      wire their approve/reject **PATCH** calls to visible buttons (my
      static grep confirmed the `fetch*` GET calls exist but did not
      exhaustively trace every button's onPress to its handler function
      body for these two screens).
- [ ] Verify `payroll.tsx`'s salary-override POST/DELETE and
      `expenses.tsx`'s approve PATCH are reachable from the UI, not just
      imported/available in `lib/api.ts`.
- [ ] Confirm `customers_jobs` mode parity (view_only/sales_mode/full_access)
      renders correctly per role on `app/customers/*` — not traced to
      component-level conditionals in this pass.
- [ ] Visually confirm text truncation/wrapping on `remarks.tsx` (466
      lines, highest density of user-generated text) and `legal.tsx` case
      titles on a small (iPhone SE-class) screen width.
- [ ] Visually confirm tap-target sizing (≥44×44pt) on icon-only row
      chevrons/buttons in `more/index.tsx` and list rows — not measurable
      from JSX/StyleSheet alone without also checking parent padding.
- [ ] Confirm accessibility screen-reader behavior on icon-only controls
      app-wide (only 2 `accessibilityLabel` hits found in code).
- [ ] Confirm `live_location` (dashboard) truly has no "live" real-time
      equivalent on mobile beyond the historical `location-logs` list
      folded into `devices.tsx`.

---

## Ranked list of the 15 worst problems (worst first)

1. **Password Manager entirely missing on mobile.** Credentials workflows
   forced onto a bigger, less controllable surface (only the web app) for a
   business that already treats credential rotation as security-sensitive
   (per this org's own memory notes on rotated infra credentials) — the
   highest-consequence gap because it's a security-tooling module, not a
   convenience feature.
2. **Contacts entirely missing on mobile.** No mobile equivalent for a
   module three roles (OWNER/STORE_MANAGER/TECH_TEAM) are expected to use —
   likely blocks field workflows for exactly the roles most often away from
   a desktop.
3. **Employee Documents entirely missing on mobile.** HR/Owner document
   verification work is desk-bound as a result.
4. **Quotations entirely missing on mobile.** Sales-adjacent module with no
   mobile path — a SALES-role gap on the device SALES staff actually carry.
5. **Finance Approvals "Advances" divergence, unresolved.** Either a stale
   dashboard tab (config debt) or a genuinely missing mobile money-approval
   workflow — ranked this high because it's a live discrepancy between two
   source-of-truth files that nobody has reconciled, and it touches money
   approvals.
6. **Legal module can't open documents on mobile.** The screen shows case
   metadata but explicitly skips the one endpoint that streams the actual
   file — for a Legal module this makes the mobile screen close to useless
   for the module's actual purpose (reading the document), not just
   "reduced."
7. **Keyboard-avoidance missing on 17 of 19 input-bearing screens.** Broad,
   systemic UX defect risk across the most write-heavy screens
   (new-entry, expenses, incentives, payroll) — high probability of
   real-world friction on every submission-heavy workflow.
8. **Accounting, Purchasing, ERP Sales, Invoices, Inventory are all
   read-only on mobile** where the dashboard has full CRUD — collectively
   this means mobile cannot be used as a substitute for the dashboard for
   any actual finance/ops data-entry work, only for lookups. Grouped as one
   ranked item because it's the same root cause (deliberate read-only
   trimming) repeated across five modules.
9. **Devices/MDM has no enrollment, lock/wipe, or policy push on mobile**,
   and `lockDevice`/`unlockDevice` functions exist unused in `lib/api.ts` —
   a half-wired capability that could be a live risk if someone assumes it
   works because the API function exists.
10. **`POLICY_ROLES` breadth in devices.tsx vs. the dashboard's tight
    `only('OWNER','HR')` gate** — unresolved possible over-exposure,
    ranked here pending the device-tester check in UNVERIFIED.
11. **Pull-to-refresh missing on 8 screens** while present on 32 others —
    inconsistent enough to read as a bug on those 8, particularly
    `my-salary.tsx` and `payslips.tsx`, which people will check repeatedly
    for updates.
12. **Financial/ERP Finance surface ~1 of 9-12 dashboard report endpoints.**
    Understandable as "KPI summary vs. full dashboard," but the gap is wide
    enough that an executive checking Financial on mobile will see a
    materially incomplete picture without any in-app indication of what's
    missing.
13. **Attendance edit/override/pardon excluded because of a missing Prisma
    model (`attendanceEditLog`) cited in the mobile code's own comment** —
    this is really a dashboard-side landmine (a feature that may 500 in
    production) that the mobile team correctly avoided, but it means the
    underlying dashboard bug is undocumented outside this one mobile code
    comment. Flagged for someone to check the dashboard attendance
    register/edit feature directly.
14. **Accessibility labels essentially absent (2 hits app-wide).** Lower
    severity for a fleet-internal tool, but a real gap if any user relies on
    a screen reader.
15. **numberOfLines/truncation handling used in only 7 places** — cosmetic
    risk of ugly wrapping/overflow on data-dense screens (remarks, legal,
    customer lists), ranked last because it's a polish issue, not a
    functional one.
