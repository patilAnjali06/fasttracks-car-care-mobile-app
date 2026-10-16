# Mobile unwired/unbuilt API surface — discovery report

> **Status update 2026-10-15 (re-checked against the current dashboard code):**
> - Agreements router **is mounted again** (`app.use('/api/v1/agreements', ...)` in `backend/src/index.ts`). The "router not mounted" section below is outdated.
> - `recordInvoicePayment` already calls `POST /payments/record` (not the retired 410 route). That endpoint returns only `{ status, paidAmount, balanceDue, isFullyPaid }`, so `invoices.tsx` now re-fetches the invoice after recording a payment / marking paid.
> - All 340 `api.ts` calls were matched against the backend's mounted routes — every one resolves to a real route.

Discovery only. No feature code was written or changed as part of this report.

## Step 3 answer first, because it decides the next task

**No new "Advances approval" screen is needed. There is no such feature to build.**

- `backend/src/lib/tabRegistry.ts` declares `finance_approvals_advances_tab` (line 157-158) alongside `finance_approvals_loans_tab` and `finance_approvals_active_tab`.
- The dashboard's `frontend/src/app/(dashboard)/dashboard/finance-approvals/page.tsx` has exactly **two** real tabs in its actual UI state: `const [tab, setTab] = useState<'active' | 'loans'>('active')` (line 324). Both consume the *same* `GET /loans` call (`fetchLoans`, line 361-365) — `'loans'` renders the PENDING approval queue (approve/reject), `'active'` renders APPROVED loans with an outstanding balance (repayment tracking: paid back, owes, monthly cut, months left, inline edit, CSV export). There is no field on the Loan model distinguishing "loan" from "advance" — the whole feature is one thing, labelled "Advance" everywhere in the UI copy (buttons, toasts: "Add New Advance", "Advance approved") while the backend model and route file are just named `Loan`/`loans.ts`.
- `finance_approvals_advances_tab` is **checked nowhere** in that page (only `finance_approvals_active_tab` → `canSeeActiveTab` and `finance_approvals_loans_tab` → `canSeeLoansTab` are read). It is a dead/orphaned permission key — same category as the already-documented decorative `legal` tab entry (see `MOBILE_PERMISSIONS_PATTERN.md`). Toggling it in Configure has zero effect on the real dashboard.
- Mobile's `finance-approvals.tsx` already covers the real `'loans'` tab equivalent (PENDING queue, approve/reject with a typed reason). It does **not** have an `'active'`-tab equivalent — a view of already-approved advances with running balances, search, and edit. That is a real, narrow gap, but it is **a second tab/filter on the screen that already exists**, not a new screen, and not related to "Advances" as a separate concept at all.

If a later task wants parity here, the work item is: "add an Active-advances tab to `finance-approvals.tsx`, matching `finance_approvals_active_tab`'s role gate (`OWNER,STORE_MANAGER,ACCOUNTING,HR`, same as the parent `finance_approvals` default — re-check the dashboard's actual per-employee resolution before hardcoding, since `finance_approvals_active_tab`/`finance_approvals_loans_tab` differ per role and use the dashboard's real per-tab permission blob, not a static array)." It is not "build Advances approval."

## The one finding that changes everything else's risk level: Agreements' backend router is not mounted

Before trusting any "is this endpoint live" answer elsewhere in this report, this needs to be said plainly:

**`backend/src/routes/agreements.ts` is never imported or registered in `backend/src/index.ts`.** Grepping the entire backend source for `routes/agreements` or `agreementsRoutes` returns nothing, in both the local working tree and `origin/main` (checked via `git show origin/main:backend/src/index.ts`, same result — this is not a local-clone-lag artifact per the project's known deploy-drift risk). Every other route file in `backend/src/routes/` is imported and `app.use()`'d in `index.ts`; `agreements.ts` is the sole exception among files with real routes.

- Git history shows the mount **did exist**: commit `83a7bfc` ("Add Employee Agreements...") added both `import agreementsRoutes from './routes/agreements'` and `app.use('/api/v1/agreements', agreementsRoutes)` to `index.ts`, and it was still present as of commit `69e5e877` (2026-07-12). Somewhere in the ~50 index.ts-touching commits since, those two lines were dropped — the exact commit wasn't bisected here (out of scope for a discovery report), but the route file, its Prisma model (`EmployeeAgreement`, `schema.prisma:1630`), and the dashboard frontend page all still exist untouched.
- Net effect: **every** `/api/v1/agreements*` request — from the dashboard *and* from mobile — currently 404s at the Express routing layer (no matching route registered), not a permission 403 and not the app's own JSON error shape. That includes the reads (`GET /agreements`, `GET /agreements/:id`) that `agreements.tsx` already calls and that a prior audit reported as "working, view-only."
- **This was not verified against the live deployed server** — only against this git working tree and `origin/main`. Given this project's standing note that local clones can lag behind what's actually deployed, treat this as "very likely broken in production" pending a live check, not as instantly-actionable without confirming. If it turns out mounted in production by some path not visible in this repo, ignore this section; if confirmed, it is a two-line backend fix (re-add the import + `app.use`), not a mobile problem at all, and every mobile Agreements build item in the last two tasks (list, detail, create, void, PDF view) is currently pointed at a route that cannot answer.

This finding sits outside Steps 1/2/3 as asked for but is reported first among the substance because it invalidates any assumption that "Agreements endpoints exist and are reachable" made by earlier tasks and by this report's own Step 1 table below unless flagged per-row.

---

## STEP 1 — Dead/unwired API surface in `src/lib/api.ts`

Method: every `export async function`/`export function` in `api.ts` (156 total) checked for a real call site (`functionName(`, not just a bare word match — an earlier pass over just word-boundaries produced false negatives, e.g. `lockDevice`/`unlockDevice` are *mentioned in a comment* in `devices.tsx` but never called, which a naive text search would have missed) anywhere else under `src/`. **38 functions have zero real call sites.**

| Function | HTTP + endpoint | Dashboard module | User-facing action it would enable | Backend route reachable? |
|---|---|---|---|---|
| `createAgreement` | POST /agreements | Agreements | Draft a new employee agreement | **NOT REACHABLE — router unmounted, see above** |
| `voidAgreement` | PATCH /agreements/:id/void | Agreements | Void an agreement | **NOT REACHABLE — router unmounted** |
| `signAgreementOwner` | PATCH /agreements/:id/sign-owner | Agreements | Owner signs (drawn signature) | **NOT REACHABLE — router unmounted**; also blocked separately by no signature-capture UI dependency in the app |
| `signAgreementEmployee` | PATCH /agreements/:id/sign-employee | Agreements | Employee signs (drawn signature) | **NOT REACHABLE — router unmounted**; same signature-capture blocker |
| `fetchAgreementPdfDataUri` | GET /agreements/:id/pdf | Agreements | View/download the signed PDF | **NOT REACHABLE — router unmounted** |
| `recordInvoicePayment` | PATCH /invoices/:id/payment | Invoices | Record a payment against an invoice | **Dead — route explicitly retired, returns 410 Gone.** Backend comment: "RETIRED as part of the invoice-payment merge... Confirmed unused before retiring: no frontend call site." Correct replacement is `POST /payments/record`, which has **no api.ts wrapper at all** (Step 2 gap). |
| `clockOut` | POST /attendance/clock-out | Attendance | Manual clock-out | Live. **Not a real gap** — `attendance.tsx`'s own comment says "clock-in-only control" deliberately; clock-out is driven by the device-punch reconciliation system (see prior session's Attendance Punch Reconciliation work), not a manual button. Included here for completeness, not as a finding to act on. |
| `lockDevice` | PATCH /devices/:id/lock | Devices (MDM) | Remotely lock a device | Live. `devices.tsx`'s own comment documents this as deliberately deferred — needs real MDM SDK integration, out of scope by design. |
| `unlockDevice` | PATCH /devices/:id/unlock | Devices (MDM) | Remotely unlock a device | Live. Same as above. |
| `fetchDevice` | GET /devices/:id | Devices (MDM) | Device detail view | Live |
| `markDeviceAlertRead` | PATCH /devices/alerts/:id/read | Devices (MDM) | Dismiss a device alert | Live |
| `deactivateEmployee` | PATCH /employees/:id/deactivate | Employees | Soft-deactivate an employee account | Live |
| `fetchAllTimesheets` | GET /timesheets?page= | All Timesheets (admin) | Paginated cross-employee timesheet list | Live |
| `approveTimesheet` | PATCH /timesheets/:id/approve | All Timesheets (admin) | Approve a submitted timesheet | Live |
| `rejectTimesheet` | PATCH /timesheets/:id/reject | All Timesheets (admin) | Reject a submitted timesheet | Live |
| `fetchCalls` | GET /calls | Calls | Call log list | Live (mobile's Calls screen apparently uses a different fetch path or hasn't shipped list view — not traced further here, out of scope for this report) |
| `fetchDashboardTodaySnapshot` | GET /dashboard/today-snapshot | Overview | Today's jobs/staff/follow-ups snapshot | Live, `requireOwner`-gated |
| `fetchDashboardRevenueByEmployee` | GET /dashboard/revenue-by-employee | Overview | Revenue-by-employee chart | Live, `requireOwner`-gated |
| `fetchEmis` | GET /accounts/emis | Accounts | EMI tracker list | Live |
| `fetchPaymentReminders` | GET /accounts/reminders | Accounts | Payment reminders list | Live |
| `fetchEmployeePayroll` | GET /payroll/calculate | Payroll | Single-employee payroll calculation | Live |
| `recordSalaryPayment` | POST /payroll/salary-payment | Payroll | Mark a salary as paid | Live |
| `fetchSalaryPayments` | GET /payroll/salary-payments | Payroll / My Finance | Per-employee salary payment history | Live (mobile's My Finance screen calls `fetchSalaryPayments`-equivalent via a different path on the dashboard side, per prior task's read of `my-finance/page.tsx`; not wired on mobile) |
| `fetchEmployeePermissions` | GET /permissions/:employeeId | Configure/Permissions (admin) | View one employee's resolved permissions | Live |
| `updateEmployeePermissions` | PUT /permissions/:employeeId | Configure/Permissions (admin) | Change one employee's per-tab overrides | Live |
| `fetchErpFinanceCustomers` | GET /erp/finance/customers | ERP Finance | Customer-level ERP finance breakdown | Live |
| `fetchErpFinanceSalesPerformance` | GET /erp/finance/sales-performance | ERP Finance | Sales-performance-by-employee | Live |
| `fetchErpFinanceServices` | GET /erp/finance/services | ERP Finance | Service-line ERP finance breakdown | Live |
| `fetchFinancialKpis` | GET /financial/kpis | Financial | KPI summary | Live, `requireManagerOrOwner` |
| `fetchFinancialOutstanding` | GET /financial/outstanding | Financial | Outstanding-balance report | Live, `requireManagerOrOwner` |
| `fetchFinancialPaymentsToday` | GET /financial/payments-today | Financial | Today's payments report | Live, `requireManagerOrOwner` |
| `fetchFinancialRevenueBreakdown` | GET /financial/revenue-breakdown | Financial | Revenue breakdown report | Live, `requireManagerOrOwner` |
| `addIncentiveTarget` | POST /incentives/targets | Incentives | Set an incentive target for an employee | Live, `requireCashierOrOwner` |
| `fetchIncentiveHistory` | GET /incentives/:userId/history | Incentives | One employee's incentive history | Live |
| `fetchPayslip` | GET /payslips/:id | Payslips | Single payslip detail/reprint | Live |
| `fetchSalaryHistory` | GET /staff-config/:userId/salary-history | Personal Info / Staff Config | Salary change log for one employee | Live |
| `fetchTrackerJobs` | GET /jobs | Job Tracker | Job list (paginated, generic) | Live — mobile's Job Tracker screen likely uses a more specific/filtered fetch; this generic one is unused |
| `updateTrackerJobStatus` | PUT /jobs/:id/status | Job Tracker | Quick job-status change | Live, `requireJobAccess` |
| `toggleAgent` | PATCH /agents/:agentName/toggle | AI Agents | Enable/disable an AI agent | Live, `requireManagerOrOwner` |
| `updatePurchaseOrderStatus` | PATCH /erp/purchases/:id/status | ERP Purchasing | Change a purchase order's status | Live |
| `updateSalesOrderStatus` | PATCH /erp/sales/:id/status | ERP Sales Orders | Change a sales order's status | Live |

**Summary: 38 uncalled functions.** Of those, 2 (`clockOut`, `lockDevice`+`unlockDevice` as a pair) are **deliberate, already-documented** deferrals, not real gaps. 1 (`recordInvoicePayment`) is **dead code pointing at a retired backend route** — delete it, don't wire it; the real replacement endpoint has no client function at all. 5 (the Agreements sign/void/create/pdf functions) are **currently unreachable** because the backend router isn't mounted — wiring UI to them would be wasted work until that's fixed. The remaining ~30 are genuinely live, wire-only opportunities.

---

## STEP 2 — The reverse gap: backend routes with no api.ts function at all

Method: mechanically extracted every `router.<method>('path', ...)` from all 67 files in `backend/src/routes/`, matched against every mounted prefix in `index.ts`, and diffed against every literal path passed to `api.<method>(...)` in `api.ts` (normalizing `:param`/template-literal segments). This is a coarse, path-shape match — it will not catch a route that's semantically covered by a differently-shaped client call, and it does not judge whether a missing endpoint is something a *staff mobile app* should ever expose (many are CSV export, device-agent-only, or admin-diagnostic routes never meant for a phone UI). Treat the counts as an upper bound on real product gaps, not a punch list by itself.

Per-file coverage (routes with a mounted prefix only; files not in `index.ts` at all are called out separately below):

| Backend file | Total routes | Covered by some api.ts call | Uncovered |
|---|--:|--:|--:|
| accounts_route.ts | 30 | 3 | 27 |
| inventory_items_route.ts | 25 | 1 | 24 |
| attendance.ts | 28 | 8 | 20 |
| job_cards.ts | 21 | 2 | 19 |
| inventory.ts | 16 | 0 | 16 |
| leadsConfig.ts | 12 | 0 | 12 |
| expenses.ts | 14 | 3 | 11 |
| accounting.ts | 12 | 1 | 11 |
| timesheets.ts | 17 | 7 | 10 |
| recurring-tasks.ts | 10 | 0 | 10 |
| devices.ts | 18 | 8 | 10 |
| payments_route.ts | 9 | 0 | 9 |
| employees.ts | 12 | 4 | 8 |
| crm.ts | 10 | 2 | 8 |
| invoice_actions_route.ts | 8 | 0 | 8 |
| conversations.ts | 10 | 3 | 7 |
| invoiceRoutes.ts | 10 | 3 | 7 |
| erp-items.ts | 7 | 0 | 7 |
| notifications.ts | 6 | 0 | 6 |
| incoming.ts | 6 | 0 | 6 |
| cards.ts | 6 | 0 | 6 |
| quotationRoutes.ts | 6 | 0 | 6 |
| callRecordings.ts | 7 | 1 | 6 |
| push.ts | 6 | 0 | 6 |
| work-docs.ts | 9 | 3 | 6 |
| *(28 more files, each 1-5 uncovered — device/ERP/misc long tail)* | — | — | ~90 |
| dashboard.ts / payslips.ts / settings_route.ts / calls.ts | fully covered | — | 0 |

**Notable, product-relevant gaps worth naming individually** (as opposed to the long diagnostic/admin tail):

- **`POST /payments/record`** (`payments_route.ts`) — no client function at all. This is the *documented correct replacement* for the retired `recordInvoicePayment` (see Step 1). If invoice-payment recording is ever wanted on mobile, this is the endpoint to wrap, not the dead one.
- **Expenses**: `POST /extract`, `POST /extract-statement`, `POST /bulk` (AI-assisted / bulk-statement expense entry) and `POST /:id/attachments`, `POST /:id/replies` (the conversation/attachment thread per expense) have no mobile client function — mobile's expense flow (built two tasks ago) covers submit/list/approve/reject only, not the bill-attachment or in-thread reply features the dashboard has.
- **Timesheets**: `POST /:id/entries/:entryId/reply`, `.../assign-task`, `.../attachments`, `.../contacts` — the per-entry collaboration features (reply/assign/attach/link-contact) have no client function, despite `my-timesheet`-style screens existing.
- **Employees**: `POST /:id/reset-password`, `DELETE /:id/permanent`, `GET /:id/analytics`, `GET /:id/performance-chart` — admin employee-management actions with no client function.
- **Crm.ts / conversations.ts / invoiceRoutes.ts / erp-items.ts**: each has a real 6-8-endpoint gap; not enumerated line-by-line here to keep this report proportionate — a future per-module audit (in the shape of the four-module task two sessions ago) is the right format to size these properly.

**Files with real routes that are not mounted in `index.ts` at all** (separate from — but same *category of finding* as — the Agreements discovery above; every one of these is 100% unreachable regardless of what any client calls):

| File | Route count | Notes |
|---|--:|---|
| `agreements.ts` | 8 | **Confirmed above** — was mounted, isn't anymore. |
| `wallet_route.ts` | 4 | Mount line is present in `index.ts` but **commented out**, with an explicit comment: `// app.use('/api/v1/wallet', walletRouter); — unmounted, see import comment above` (self-documented dead code — not a discovery, already known and intentional per commit `ea15a85`/`14f0777` "fix: unmount live-crashing Wallet route"). |
| `advance_receipts_route.ts` | 4 | No import, no mount found anywhere in `backend/src/`. Not referenced by any dashboard page found in a quick check either — likely genuinely orphaned/abandoned, not a live-but-unmounted case like Agreements. Flagging for someone with backend context to confirm before assuming it's safe to delete. |
| `staffPhoneNumbers.ts` | 5 | Same — no import/mount found. Possibly superseded by the StaffPhoneNumber logic folded into `conversations.ts` (per that file's July 2026 commit message referencing "StaffPhoneNumber mapping"). Not investigated further — out of scope for this report. |

---

## STEP 4 — Rough sizing estimate

Grouped by what kind of work closes the gap, counting only items judged plausibly real product surface (excludes the ~90-endpoint long tail of clearly internal/diagnostic/device-agent routes from Step 2, and excludes the 2 deliberate Step-1 deferrals):

| Group | What it means | Rough count | Notes |
|---|---|--:|---|
| **(a) Wire-only** — client function exists, just needs a UI control | From Step 1's 38, minus the 2 deliberate deferrals (clockOut, lockDevice/unlockDevice) minus the 1 dead one (recordInvoicePayment) minus the 5 currently-unreachable Agreements ones | **~30** | Straightforward, same shape as the last three tasks (find the button, wire the existing call, add role gate/UI polish). Includes real product value: All Timesheets approve/reject, Employee deactivate, Financial/ERP Finance report screens, Incentive targets, device alert-read, etc. |
| **(a′) Wire-only, blocked on a backend fix first** | The 5 Agreements functions | **5** | Zero mobile work is safe to do here until the router-mount question is resolved and confirmed live — otherwise it's wiring UI to a guaranteed 404, repeating the same mistake at a bigger scale. |
| **(b) Needs a new api.ts function, backend route already exists** | The "notable, product-relevant" Step 2 items called out by name (expenses attachments/replies/bulk, timesheet entry collaboration, employee admin actions, payments/record) plus the untouched remainder of crm/conversations/invoiceRoutes/erp-items | **~25-35** | Genuinely bigger than (a) per item — each needs request/response typing decided, not just a UI, but no backend design work. |
| **(c) Needs new backend work** | None identified in this pass | **0 confirmed** | Nothing found in Steps 1-3 required a schema change or new backend route — the Advances "gap" turned out to be a UI filter on existing data (Step 3), and the Agreements gap is a *restore*, not new backend work (the code already exists, just isn't mounted). A full Step-2 sweep of the long diagnostic tail could turn up something in this category, but nothing did in the product-relevant items actually inspected. |

**Bottom line on scale:** this is not "a handful of loose ends." At minimum ~30 wire-only items across roughly a dozen modules, before counting the larger reverse-gap surface in Step 2's per-module table. The single highest-leverage next action, though, isn't wiring any of them — it's resolving whether `agreements.ts` is actually reachable in production, since that either unblocks 5 already-built client functions for free or means the last task's mobile Agreements work (and the dashboard's own Agreements page) has been non-functional since whatever commit dropped the mount.
