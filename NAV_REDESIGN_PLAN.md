# Nav / Home Redesign — Planning Note

Branch: `feat/nav-home-redesign` off `fix/release-build-4-issues` @ 7a34c07.

## Touched / replaced

- `src/app/(app)/_layout.tsx` — NativeTabs cut from 5 triggers to 2 (`attendance`
  relabeled "Home", `conversations` relabeled "Calls"). `tasks` and `customers`
  triggers removed (routes kept, reached via side menu + Home widgets). `more`
  trigger removed. Wrapped in `DrawerProvider` + renders `<SideMenu>` as an
  overlay sibling.
- `src/constants/screen-registry.ts` — added optional `route` field (defaults
  to `/more/:id` if unset) so entries can point at a first-class route
  (`tasks`, `customers`) instead of the generic stub. Added `tasks` and
  `customers` entries with no `visibleToRoles` (matches today: both tabs were
  open to every role, unchanged). **`visibleToRoles` values and the
  Payslips role list are untouched.**
- `src/app/(app)/more/index.tsx` — no longer reachable from a tab (dead code,
  left in place rather than deleted — nothing else routes to `/more` as an
  index; only `/more/:id` is used, by both the drawer and Home widget links).
- `src/app/(app)/attendance.tsx` — rebuilt as the Home screen: collapsing hero
  (logo + live status strip) + widget grid (attendance, timesheet, reminders,
  tasks). Same data source (`fetchTodayAttendance`, `fetchMyMonthlyAttendance`,
  `fetchMyMonthTimesheets`, `fetchMyReminders`, `fetchMyTasks`), same
  clock-in-only control, same `attendanceStatusColor/Label`. No manual
  clock-out anywhere.
- New: `src/lib/drawer-context.tsx`, `src/components/side-menu.tsx`,
  `src/components/home/*` (hero-header, glass-card, widgets).

## Confirmed NOT broken

- `src/lib/push-notifications.ts` — deep-link targets (`/(app)/tasks`,
  `/(app)/more/reminders`, `/(app)/conversations[/:id]`) are unchanged route
  paths; removing a route from the tab bar doesn't remove the route itself in
  Expo Router, so these still resolve. Re-tested by pushing each type at
  runtime (see report).
- No other `Link href="/..."` in the app pointed at `/more` or `/customers`/`/tasks`
  as tab roots specifically — the two in `attendance.tsx` (`/more/my-timesheet`,
  `/more/reminders`) and `/tasks` in the reminders/tasks widgets keep working
  since those routes are untouched.

## Ambiguities flagged (proceeded per green light, noted here)

- "Calls" vs "Conversations": no separate Exotel-call-log screen exists —
  `conversations/index.tsx` is the one and only screen for this concept (WhatsApp +
  call threads together). Decision: relabel the existing tab "Calls" rather than
  fork a new screen, since Part 2 explicitly names this as a judgment call.
- 3D icons: no 3D/neumorphic icon package was added (see report) — using
  `@expo/vector-icons` (already a dependency) with a layered
  highlight+shadow treatment for a cheap pseudo-3D look, flagged as a
  compromise, not a real 3D asset pipeline.
