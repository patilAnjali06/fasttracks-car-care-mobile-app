# Fasttracks Mobile

Native React Native app (Expo, one codebase for Android + iOS) for the Fasttracks Car Care
dashboard. Reuses the existing Node/Express + Supabase backend — this repo has no backend of
its own. v1 scope: **Leads/Calls + Attendance**.

This is a separate repo from `fasttracks-dashboard`; it never touches that repo's working tree,
staging, or production.

## Stack

- Expo (managed workflow + prebuild/CNG, not Expo Go for the long run — see the plan doc)
- Expo Router (file-based navigation, `src/app`)
- `axios` for the API client, `expo-secure-store` for the JWT (Keychain/Keystore — never
  plain storage)

## Configuring the API target

The API base URL is **never hardcoded** — it comes from `EXPO_PUBLIC_API_URL`:

- `.env` — committed default, points at production (`https://dashboard.fasttrackscarcare.in/api/v1`)
- `.env.local` — gitignored, overrides for local dev. Not present right now — a "staging"
  backend was assumed to be listening on the VM's port 4001, but that's unconfirmed (as of
  2026-09-05 nobody was sure staging is actually deployed/running there), so local dev
  currently just runs against production via `.env`'s default, same as everyone else testing
  against it. **Use a synthetic test account, never a real employee's login, for anything you
  test locally.**

If a staging environment gets confirmed later, point `.env.local` at it through an SSH tunnel to
the VM (ask a team member with access for the host details — not documented here):

```bash
ssh -N -L 4001:127.0.0.1:4001 <ssh-user>@<vm-host>
```

then set `EXPO_PUBLIC_API_URL=http://10.0.2.2:4001/api/v1` in `.env.local` (`10.0.2.2` is the
Android emulator's alias for the host Mac's localhost; on a physical device via Expo Go, use
your Mac's LAN IP instead — the emulator alias only works in the emulator).

## Running

```bash
npm install
npm run android   # launches Metro + builds/runs on a connected emulator or device
```

## Auth

Login posts `{ username, password }` to `/auth/login` (same endpoint the web dashboard uses),
stores the returned JWT via `expo-secure-store`, and attaches it as `Authorization: Bearer …`
on every request (`src/lib/api.ts`). A 401 clears the token and drops back to the login screen.
On cold start, a stored token is revalidated against `/auth/me` before the session is trusted.
