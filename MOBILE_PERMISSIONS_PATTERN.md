# Mobile permissions pattern

Foundation for how mobile screens gate access. This does not add a new
feature screen — it is the mechanism later screens should use.

## Step 1 findings (investigation)

### Access modes

`getTabAccess` (`backend/src/lib/defaultPermissions.ts`) resolves each tab to
`{ enabled: boolean, mode: string }`:

- `enabled` — whether the tab is visible/usable at all.
- `mode` — only meaningful for "mode tabs" (those with a `mode` block in
  `tabRegistry.ts`, e.g. `expenses`, `customers_jobs`, `invoices`,
  `attendance`, `employees`, `financial`, `inventory`, `payroll`). Each mode
  tab defines its own option set, narrowest first — e.g. expenses:
  `'add' | 'verify' | 'both'`; customers_jobs: `'view_only' | 'sales_mode' |
  'full_access'`. There is no single universal meaning across tabs; a
  screen must know its own tab's option semantics.

Resolution order: an explicit per-employee `EmployeePermissions.permissions
.tabs.<key>` override (new `{enabled,mode}` shape or legacy boolean) wins;
otherwise it falls back to that role's default (`tabRegistry.ts`
`roleDefaults` / `mode.roleDefaults`), and if a mode tab's registry entry
somehow omits a role, to that tab's own least-permissive option
(`options[0]`) — a deliberate fail-safe, not fail-open, flip.

### Is there already a self-scoped resolved-permissions endpoint?

**Yes — two, and the one already in use is the better fit.**

- `GET /api/v1/permissions/:employeeId` (`permissions_route.ts`) allows a
  non-admin caller when `req.params.employeeId === caller.userId`, and
  returns `resolvePermissionsWithModes(role, storedOverrides)` — the
  resolved shape, plus the raw `overrides` separately for reference. Suitable
  for self-calls, but mobile would need to know its own `employeeId` param
  (= `user.id`) and this is a call mobile didn't already make.
- **`GET /auth/me`** (`backend/src/routes/auth.ts`), which the mobile app
  **already calls** as `fetchProfile()` on every app start, independently
  computes and returns `{ ...user, permissions, permissionModes,
  hasLegalAccess }` on every response:
  - `permissions`: `mergePermissions(role, overrides)` — boolean "enabled"
    per tab, for every tab in `TAB_REGISTRY`.
  - `permissionModes`: `getTabAccess(overrides, role, key).mode` for every
    `MODE_TABS` key.
  - `hasLegalAccess`: the real, correctly-resolved `hasLegalAccess()` check
    (see below — this is not the decorative `legal` tab-registry entry).

  This is the resolved result, not raw deltas, and it is already the
  production call path (login and `/me` both compute it identically). No new
  endpoint was needed — **Step 2 (add a backend endpoint) was skipped.** No
  backend file was modified.

### How many distinct gating mechanisms actually exist?

**At least four, genuinely not reducible to one shape**, confirmed by
reading each mechanism's implementation, not assumed from the task brief:

1. **Plain static `requireRoles` / hardcoded role arrays**, scattered per
   route, with no relationship to `EmployeePermissions` at all — no
   per-employee override is possible for these no matter what Configure
   shows. Confirmed for: `overtime.ts`'s `requireManagerOrOwner`
   (`OWNER,STORE_MANAGER,HR,ACCOUNTING,CASHIER`), `loans.ts`'s
   `ADMIN_ROLES`/approve-reject inline checks, `payroll.ts`'s
   `SALARY_ADMIN_ROLES`/`requirePayrollAccess`, `payslips.ts`'s
   `PAYSLIP_ROLES`, `CONTACTS_DIRECTORY_ROLES`/`CONTACTS_DELETE_ROLES`. For
   these, **`tabRegistry.ts`'s matching entry can be decorative** — e.g.
   `payroll`'s registry entry has a `mode` block, but the actual route
   (`requirePayrollAccess`) never calls `getTabAccess`; the two happen to
   agree today only because someone kept them in sync by hand.
2. **`getTabAccess` tab modes**, backed by `EmployeePermissions.permissions
   .tabs.<key>` and genuinely overridable per employee. Confirmed live for
   `expenses` (`getExpenseAccess` in `expenses.ts`). Screens on this
   mechanism are exactly the ones this task's new hook is for.
3. **`LegalAccessConfig`** — a single DB row, `userId`-based, up to two seats
   (`legalOwnerUserId` + optional `grantedUserId`). Completely independent
   of `EmployeePermissions`/`tabRegistry`. The `legal` entry in
   `TAB_REGISTRY` exists only so Configure renders a checkbox; per the code
   comment in `auth.ts` (hasLegalAccess docblock), toggling it "can neither
   grant nor revoke real access." `hasLegalAccess` is, however, computed
   correctly and returned by `/auth/me` — see above.
4. **Bespoke per-tab boolean with an admin-role bypass, read directly, not
   through `getTabAccess`.** Confirmed for `customer_remarks`
   (`hasCustomerRemarksAccess` in `auth.ts`): `OWNER`/`STORE_MANAGER` always
   pass; anyone else needs `permissions.tabs.customer_remarks === true`
   stored explicitly. **This key is not in `TAB_REGISTRY` at all**, so
   `mergePermissions`/`resolvePermissionsWithModes` only reports `true` for
   it when an explicit override is stored — for an `OWNER`/`STORE_MANAGER`
   with no stored override, the resolved-permissions endpoints report
   `false` while the real backend check returns `true`. **This is a genuine
   divergence between the resolved-permissions response and actual
   enforcement, not something this task's endpoint choice can paper over.**
   The `requireAdsAccess`/"ads" mechanism named in the task brief does not
   exist anywhere in this codebase (searched `backend/src/`) — best guess is
   the brief conflated it with `customer_remarks` or referred to a feature
   already removed; treat it as not present rather than guessing at one.

**Conclusion: not reducible to one shape.** The new hook below is a correct,
complete source of truth for mechanism (2) — the actual `getTabAccess`
universe — and, incidentally, for mechanism (3) via its own `hasLegalAccess`
field (real value, not the decorative tab entry). It must **not** be used for
mechanism (1) (nothing to resolve — mirror the route's static array, as
existing screens already correctly do) or for `customer_remarks` under
mechanism (4) (its resolved value can be wrong for admin roles with no
stored override — a future screen needs either a dedicated endpoint field
that models the bypass, or a hybrid client check; out of scope here).

## The resolved shape

```ts
interface ResolvedPermissions {
  tabs: Record<string, boolean>;      // enabled, per tabRegistry key
  tabModes: Record<string, string>;   // mode, per MODE_TABS key only
  hasLegalAccess: boolean;            // real per-userId check, not tabs.legal
}
```

Fetched by `fetchMyPermissions()` (`src/lib/api.ts`) from `GET /auth/me` —
the same call `fetchProfile()` already makes; no new network endpoint hit
by count, just a second typed reader of the same response.

## The mobile mechanism (Step 3)

- **`PermissionsProvider` / `usePermissions()`**
  (`src/lib/permissions-context.tsx`), mounted in `_layout.tsx` inside
  `AuthProvider`. Fetches once when `isAuthenticated` becomes true, caches
  for the session, exposes `refresh()`.
- **Fails closed.** Status is one of `idle | loading | ready | error`.
  `hasTab(key)` and `hasLegalAccess` only ever return `true` when status is
  `'ready'` — on `'error'` (or before the first fetch resolves), every
  answer is `false`/`null`. A failed refresh also **clears** any
  previously-resolved data rather than leaving a stale grant in place. There
  is no hardcoded role-array fallback anywhere in this file.
- **`PermissionGate`** (`src/components/permission-gate.tsx`) — a reusable
  full-screen gate for a mode-tab screen: spinner while loading, "Couldn't
  load your permissions" + Retry on error, a denial message when resolved
  but disabled, and only renders children when ready + enabled. Use it for a
  whole-screen gate; for a gate on part of a screen (as in `expenses.tsx`),
  inline the same three states rather than wrapping the section in the
  component, since `PermissionGate` replaces its entire children tree.

## Step 4 — retrofit and verification

### `expenses.tsx`

Converted from `DEFAULT_VERIFY_ROLES` (a hardcoded `['OWNER',
'STORE_MANAGER']` approximation of the tab's *default* mode) to
`usePermissions()`: `canVerify = status === 'ready' && hasTab('expenses') &&
(tabMode('expenses') === 'verify' || tabMode('expenses') === 'both')`. This
now reflects a real per-employee override, not just the default, closing the
exact gap the previous task's caveat comment described. That caveat comment
is deleted. The review section itself now shows a loading spinner, a
"Couldn't load your permissions" + Retry state, or the review list —  never
silently vanishes on a fetch failure the way the plain `canVerify && (...)`
render used to for a denied-vs-not-yet-loaded distinction.

### `fetchExpensesForReview` — does it hit a real endpoint or filter client-side?

**Real endpoint, server-side filtering both ways.** It calls `GET
/expenses?status=PENDING` — the *same* `GET /expenses` handler
(`backend/src/routes/expenses.ts`) `submitExpense`'s sibling `fetchMyExpenses`
already used. That handler:
- Applies `where.status = status` server-side from the query param (not a
  broad fetch filtered in the client).
- Applies its own scoping server-side: `isAdmin = expenseAccess.canVerify`
  (itself `getTabAccess`-derived) determines whether `where.userId` gets
  fixed to the caller or left open to everyone. A verifier gets everyone's
  pending rows in one paginated query; a non-verifier calling the same
  function would just get their own PENDING rows back — no data ever
  crosses the wire that the caller shouldn't see, and there's no
  client-side list-then-filter happening anywhere in `api.ts`.

No payload-scaling problem here; nothing to flag.

### Which pattern should each screen use going forward

| Screen / feature | Backend mechanism | Mobile pattern |
|---|---|---|
| `expenses.tsx` review section | `getTabAccess` (mode tab) | `usePermissions()` — done |
| `overtime-approval.tsx` | static `requireManagerOrOwner` array | Static role array — **leave as-is** (already correct, verified byte-for-byte against `requireManagerOrOwner`) |
| `finance-approvals.tsx` (loans) | static `ADMIN_ROLES` / inline role checks | Static role array — **leave as-is** (verified against `loans.ts`) |
| `payroll.tsx` | static `SALARY_ADMIN_ROLES` / `requirePayrollAccess` | Static role array — **leave as-is**, even though `tabRegistry.ts`'s `payroll` entry has a `mode` block; that block is decorative for this route |
| `payslips.tsx` | static `PAYSLIP_ROLES` / `requireRoles` | Static role array — **leave as-is** |
| Any future screen backed by a **mode tab** the route actually calls `getTabAccess`/`resolvePermissionsWithModes`/`mergePermissions` for (confirm by reading the route body, not assuming from `tabRegistry.ts`) | `getTabAccess` | Use `usePermissions()` / `PermissionGate` |
| Any future screen backed by a **plain hardcoded role list** in its route (confirm by reading the route) | static `requireRoles` | Mirror that exact array client-side, as today's screens do |
| A future Legal Documents screen | `hasLegalAccess` (per-userId, two seats) | `usePermissions().hasLegalAccess` — already correctly resolved, do **not** use `hasTab('legal')` |
| A future Customer Remarks / "ads" screen | bespoke boolean + admin bypass, not in `TAB_REGISTRY` | **Do not use `usePermissions()`** — its resolved value can be wrong for OWNER/STORE_MANAGER with no stored override (see divergence above). Needs either a dedicated backend field that models the bypass, or a documented hybrid: `ADMIN_BYPASS_ROLES.includes(role) \|\| explicit-override-check`. Flag for a backend decision before building. |

**Rule for a new screen:** open the actual backend route handler body for
the action being gated (not the tab registry, not this table alone) and
determine which of the four mechanisms it uses. Only tabs confirmed to call
`getTabAccess`/`mergePermissions`/`resolvePermissionsWithModes` may use
`usePermissions()`. Everything else mirrors its backend's real check
exactly — never invent a role list, never assume `tabRegistry.ts` reflects
live enforcement.

## Whether the fail-closed path was tested at runtime

**No — verified by code reading, `tsc --noEmit`, and `eslint` only, not by
running the app.** Exercising the failure branch for real would need either
a live login (this task avoided touching any credentials, per this repo's
standing rule against using the production owner account, and no synthetic
test account was set up as part of this foundation task) or a way to force
`GET /auth/me` to fail while authenticated, neither of which this task did.
Recommended for the on-device tester pass: sign in, then disable network
mid-session and open a permission-gated screen — it should show "Couldn't
load your permissions" with a working Retry, never the gated feature itself
and never a blank screen.
