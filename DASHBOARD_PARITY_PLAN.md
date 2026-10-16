# Fasttracks Mobile — Dashboard Parity Plan

> **Known gap, not fixed as part of this work:** `permissions_route.ts`'s PUT endpoint checks role (OWNER/STORE_MANAGER) rather than specific userIds, so any Store Manager — not just Himanshu — can currently change employee permissions. Documented per Sushruta's decision on 2026-09-18, left as-is.

Generated 2026-09-18 by reading the actual source trees of both repos (no assumptions carried over from any prior list). Dashboard module count found: **42** directories under `frontend/src/app/(dashboard)/dashboard/` (excluding the bare `page.tsx`). Backend route files found: **58** under `backend/src/routes/`.

## Mobile app today (verified by opening files, not just the registry)

Tabs (outside the registry): `attendance.tsx`, `tasks.tsx`, `conversations/`, `customers/` — all real, working screens (100–290 lines each), not stubs.

`More` list (`src/constants/screen-registry.ts`, 4 entries, each with a real screen file): My Timesheet, Reminders, My Salary, Payslips. Payslips already carries a `visibleToRoles: ['OWNER','STORE_MANAGER','CASHIER']` client-side gate mirroring the backend's `requireRoles(...PAYSLIP_ROLES)` — this is the pattern to reuse everywhere else a role gate is needed.

Everything else below (38 modules) has no mobile screen at all today.

## Per-module table

| Module (dashboard path) | Backend route file(s) | Backend access gate (verified from source) | Mobile status | Effort |
|---|---|---|---|---|
| attendance | attendance.ts | Self sees own; `MANAGER_ROLES=[OWNER,STORE_MANAGER,ACCOUNTING,CASHIER]` see all; leave approval uses separate `LEAVE_APPROVER_ROLES` | **Live** (tab) | — |
| tasks / my-tasks | tasks.ts, recurring-tasks.ts | `ADMIN_ROLES=[OWNER,STORE_MANAGER]` full; others see/act on own | **Live** (tab, self-scope only — admin recurring-task mgmt not built) | S to add admin view |
| conversations | conversations.ts | `MANAGER_ROLES=[OWNER,STORE_MANAGER,HR,ACCOUNTING,CASHIER]` see all; others own only | **Live** (tab) | — |
| customers | customers.ts, job_cards.ts, jobs.ts | no explicit role gate found in customers.ts (all authenticated) | **Live** (tab) | — |
| timesheet (self) | timesheets.ts | self or `MANAGER_ROLES=[OWNER,STORE_MANAGER]` | **Live** (My Timesheet) | — |
| reminders | reminders.ts | self-scoped, no role gate | **Live** | — |
| my-salary | payroll.ts | self-view; full breakdown needs `SALARY_ADMIN_ROLES=[OWNER,STORE_MANAGER,CASHIER]` | **Live** | — |
| payslips | payslips.ts | router-level `requireRoles(OWNER,STORE_MANAGER,CASHIER)` | **Live**, gated correctly | — |
| expenses | expenses.ts | self submits; approvers see all (role check inline, `expense.userId` compare for notification routing) | **Live** | — |
| timesheets (manager view) | timesheets.ts | `MANAGER_ROLES=[OWNER,STORE_MANAGER]` | Not built | M |
| overtime | overtime.ts | self views own; `MANAGER_ROLES=[OWNER,STORE_MANAGER]` manage all | Not built | S |
| overtime-approval | overtime.ts (approval endpoints) | `MANAGER_ROLES=[OWNER,STORE_MANAGER]` | Not built | S |
| leave-requests | attendance.ts (leave endpoints) | `LEAVE_APPROVER_ROLES` (see lib/leaveRoles.ts — distinct from MANAGER_ROLES) | Not built | S |
| finance-approvals | loans.ts, advances.ts | `ADMIN_ROLES=[OWNER,STORE_MANAGER,CASHIER]` approve; requester sees own; approver cannot self-approve (`userId===approverId` blocked) | Not built | M |
| my-finance | loans.ts, advances.ts (self-view) | self-scoped | Not built | S |
| financial | financial.ts | not individually re-verified this pass — role check present, name suggests exec-level dashboard | Not built | M — likely desktop-shaped, see Step 5 |
| finance | finance.ts | `MANAGER_ROLES=[OWNER,STORE_MANAGER,ACCOUNTING]` | Not built | M |
| accounting | accounting.ts | `ACC_ROLES=[OWNER,STORE_MANAGER,ACCOUNTING,CASHIER,INVENTORY_MANAGER]` | Not built | M |
| accounts | accounts_route.ts | `canAccess=requireRoles(OWNER,ACCOUNTING)`; `/email-check/all` OWNER-only | Not built | M |
| wallet | wallet_route.ts | top-up: `MANAGER_ROLES=[OWNER,STORE_MANAGER,ACCOUNTING]`; spend: manager OR per-user `walletAccess` flag | Not built | S |
| inventory | inventory.ts, inventory_items_route.ts, erp-items.ts, erp-media.ts, erp-stock.ts | `[OWNER,STORE_MANAGER,INVENTORY_MANAGER]` for nearly all read/write | Not built | L (barcode/media upload heavy) |
| purchasing | erp-purchases.ts, erp-suppliers.ts | read: `[OWNER,STORE_MANAGER,ACCOUNTING,CASHIER,INVENTORY_MANAGER]`; write narrower; delete OWNER/STORE_MANAGER (suppliers: OWNER only) | Not built | M |
| sales (ERP) | erp-sales.ts | read `[OWNER,STORE_MANAGER,SALES,ACCOUNTING,CASHIER]`; write `[OWNER,STORE_MANAGER,SALES]` | Not built | M |
| invoices | invoiceRoutes.ts, invoice_actions_route.ts, payments_route.ts | `ADMIN_ROLES=[OWNER,STORE_MANAGER,ACCOUNTING]` full access; invoice_actions narrower `[OWNER,STORE_MANAGER]` | Not built | L |
| customers & jobs (entry) | job_cards.ts, jobs.ts | no explicit gate found at file top; likely inherits verifyToken only | Not built (entry point exists, but "entry" module itself does) | M |
| crm | crm.ts | not deep-dived this pass; treat as needing explicit re-check before build | Not built | M |
| pipeline | crm.ts / conversations.ts (sales pipeline board) | same caveat as crm.ts | Not built | M — likely desktop-board-shaped |
| calls | calls.ts, callRecordings.ts | `CALL_ROLES=[OWNER,STORE_MANAGER,SALES]`; `/my-summary` also allows SALES | Not built | M |
| employees | employees.ts | role field changes: OWNER only; salary-touching edits: `[OWNER,STORE_MANAGER,CASHIER]`; general edit: broader admin | Not built | M |
| staff-config | staffConfig.ts | `ADMIN_ROLES=[OWNER,STORE_MANAGER]`; salary PUT also allows CASHIER | Not built | M |
| payroll (admin) | payroll.ts | `SALARY_ADMIN_ROLES=[OWNER,STORE_MANAGER,CASHIER]` via `requirePayrollAccess` | Not built (self-view exists; admin view doesn't) | M |
| incentives | incentives.ts | mixed: `requireCashierOrOwner` (CASHIER,OWNER) on some routes, `requireManagerOrOwner` on others — verify per-route before building | Not built | S–M |
| agreements | agreements.ts | `ADMIN_ROLES=[OWNER,STORE_MANAGER,HR]` | Not built | S |
| personal-info | identity-documents.ts | self OR `PRIVILEGED_ROLES=[OWNER,HR,STORE_MANAGER]` | Not built | S |
| remarks | remarks.ts, customer_remarks_route.ts | `hasCustomerRemarksAccess`: role in `CUSTOMER_REMARKS_ADMIN_ROLES` **or** an explicit per-user `employeePermissions.tabs.customer_remarks===true` grant — config-driven, not plain roles | Not built | S–M (needs per-user override support like Legal/Ads) |
| legal | legal_route.ts | **`requireLegalAccess`** — see Discrepancies section; userId-based via `LegalAccessConfig` (owner + optional single granted seat), not a role list | Not built | S (small surface) but **needs product decision** on mobile exposure of most-sensitive data |
| settings | settings_route.ts | `ADMIN_ROLES=[OWNER,STORE_MANAGER]` | Not built | S — likely desktop-shaped (system config) |
| password-manager | passwords.ts | no router-level gate found; inline visibility rule: STORE_MANAGER can't see entries added by OWNER | Not built | M — **flag for product decision**: credentials on mobile raise their own risk profile |
| devices (MDM) | devices.ts | `MDM_ADMIN_ROLES=[OWNER,STORE_MANAGER,HR]`; policy create/delete OWNER only | Not built | **Exclude/flag** — admin-console shaped, see Step 5 |
| sim-tracker | simRoutes.ts | `ADMIN_ROLES=[OWNER,STORE_MANAGER]` | Not built | S — narrow admin utility |
| ads | ads.ts, adLeads.ts | `requireAdsAccess`: OWNER always; others need explicit `employeePermissions.tabs.ads===true` grant (config-driven, same pattern as remarks) | Not built | M |
| agents | agents.ts | not deep-dived this pass — re-verify before build | Not built | S–M |
| chat (Team Chat) | team_chat_route.ts | authenticated members only, self-membership scoped (no elevated role gate found) | Not built | M — good mobile fit (real-time chat) |
| work-docs (referenced by timesheet/timesheets UI) | work-docs.ts | `BLOCKED_ROLES=[TECHNICIAN,STAFF]`; else `MANAGER_ROLES=[OWNER,STORE_MANAGER]` or own doc | Not built (attachments partially covered by My Timesheet) | S |

Note: `entry` in the dashboard tree is a job-card creation entry point (backed by job_cards.ts/jobs.ts), not a distinct backend-gated module — grouped with "customers & jobs" above rather than double-counted.

## Access-control parity notes (Step 3 continued)

- **Config-driven, not role-list, gates exist in three places**: Legal (`LegalAccessConfig` — owner + one optional granted seat), Ads (`employeePermissions.tabs.ads`), and Customer Remarks (`employeePermissions.tabs.customer_remarks`). Any mobile screen for these three must fetch the effective permission from the backend at runtime (e.g. reuse `GET /permissions/:employeeId`) rather than hard-coding a role array — a static `visibleToRoles` list (the Payslips pattern) is **not sufficient** for these three modules.
- **Self-vs-manager split** (own record readable by the owning user regardless of role, full list only to managers) is the dominant pattern: attendance, tasks, timesheets, expenses, overtime, loans/advances, personal-info documents, wallet spend. Mobile should default every such screen to self-scope first and add the manager list view as a separate, explicitly-gated screen.
- Mobile currently has exactly one working example of a static role gate mirrored client-side: Payslips' `visibleToRoles`. This pattern is safe to reuse only for the plain `requireRoles(...)` modules above (payroll, staff-config, settings, sim-tracker, agreements, finance, accounting, accounts, devices, invoice_actions, calls, sales, purchasing, inventory). It must NOT be reused as-is for Legal, Ads, or Customer Remarks.

## Discrepancies found vs the two stated claims

**(a) "Legal Documents access is locked to one specific person's userId" — PARTIALLY WRONG.**
`backend/src/middleware/auth.ts` (`hasLegalAccess`) checks against a `LegalAccessConfig` DB row with **two** possible fields: `legalOwnerUserId` and an optional `grantedUserId`. Access is granted if the caller's userId matches either one. So today it could be exactly one person (if `grantedUserId` is unset) but the mechanism itself supports **up to two** named people, and it is config-driven (admin can change who holds the granted seat) rather than a hardcoded single ID in code. Not a role check either way — the "userId-based, not role-based" part of the claim is correct; the "locked to one person" part is an oversimplification of a 1-or-2-seat config model.

**(b) "role-allocation / permission-changing itself is restricted to two specific named people" — WRONG.**
`backend/src/routes/permissions_route.ts` (`PUT /permissions/:employeeId`) checks `['OWNER', 'STORE_MANAGER'].includes(caller.role)` — a plain **role** check, not a check against two specific userIds. Any current or future user holding either role can change any employee's tab permissions. There is no name- or ID-specific allowlist anywhere in this route. This claim is false as stated; the real gate is role-based and could apply to more than two individuals depending on how many people currently hold OWNER/STORE_MANAGER.

No other discrepancies of this magnitude were found, though `crm.ts`, `pipeline`, `financial.ts`, and `agents.ts` were not exhaustively re-verified line-by-line this pass (noted in the table) and should get the same treatment before any build work starts on those specific modules.

## Net-new backend work vs reuse (Step 4)

Reuse-as-is (existing endpoints are self-scoping or already return manageable shapes): attendance, tasks, conversations, customers, timesheets (self), reminders, payroll (self), payslips, expenses, overtime (self), personal-info (self), wallet (self/spend), agreements, sim-tracker, settings.

Needs mobile-specific backend work:
- **Inventory / Invoices / ERP-sales / Purchasing**: desktop list/table endpoints return large unpaginated payloads with heavy joins (bill images, line items) — need paginated, mobile-shaped responses before a usable list screen.
- **Legal, Ads, Remarks**: need a single "am I allowed" check exposed cleanly (partially covered by `/permissions/:employeeId`) so mobile doesn't have to special-case three different permission mechanisms.
- **Timesheet/Timesheets attachments, work-docs, identity-documents**: multipart upload from a phone camera/gallery needs testing against existing multer configs (already flagged in memory re: iOS `capture="environment"`).
- **Devices/MDM**: would need a companion mobile MDM SDK integration, not just an API client — effectively a different engineering effort, not just a screen.
- **Password Manager**: needs explicit product sign-off before any backend reuse, given the sensitivity of exposing stored credentials on a mobile device.

## Phased build order (Step 5)

**Phase 1 — Self-service, low-risk, mostly reuse (highest value/effort ratio)**
Overtime (self), Leave Requests (self + approve for LEAVE_APPROVER_ROLES), My-Finance (loans/advances self-view), Agreements (view), Personal-Info (self documents), Work-docs attachment support for existing Timesheet screen. ~7 screens, mostly S effort, minimal new backend work.

**Phase 2 — Manager/admin views layered on existing self-service screens**
Timesheets (manager list), Payroll (admin), Overtime-approval, Finance-approvals (loans/advances approve), Employees (view + limited edit), Staff-config, Incentives, Wallet (manager top-up), Team Chat. Requires the config-aware permission check work from Step 4 before Remarks/Ads specifically. ~9 screens, S–M effort each.

**Phase 3 — Complex, high-backend-cost, or higher-risk modules**
Inventory, Purchasing, ERP-Sales, Invoices, CRM/Pipeline, Calls/Call-recordings, Accounting, Accounts, Finance, Financial. All need new paginated/mobile-shaped backend endpoints or significant list-UI investment (barcode scan, media upload, invoice PDF rendering). ~10 screens, M–L effort each.

**Phase 4 — Exclude, or hold for explicit product decision**
- **Devices/MDM**: fundamentally an admin console + device-management SDK problem; recommend excluding from mobile entirely unless there's a specific "enroll this phone" use case, which would be a different feature, not a port of the dashboard screen.
- **Settings, Sim-tracker**: narrow, infrequent admin utilities; low value on mobile, recommend deprioritizing indefinitely rather than building.
- **Legal**: technically small (a handful of endpoints) but holds "the most sensitive data in the app" per its own code comment — recommend a product decision on whether it should ever be mobile-accessible at all before scoping a screen, independent of build effort.
- **Password Manager**: same reasoning — recommend a product decision before backend reuse, given credential exposure risk on a phone.
- **Financial / CRM / Pipeline**: dashboard-style aggregate views and Kanban-style boards are inherently desktop-shaped; recommend a simplified read-only mobile summary (if any) rather than a 1:1 port, pending product input.

## Confirmation

No git, build, deploy, or database commands were run against either repo. Only read-only `ls`/`grep`/`cat`/`find` and file reads were used for investigation. This file is the only file written, to `/Users/aisusrustha/fasttracks-mobile/DASHBOARD_PARITY_PLAN.md`.
