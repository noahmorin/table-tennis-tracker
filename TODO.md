# TODO

## Supabase (later)
- Add Supabase client setup using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Create a typed data layer for `profiles`, `matches`, `games`, `competitions`, `audit_log`.
- Wire match mutations to DB functions (`match_create`, `match_update`, `match_void`, `profile_link_auth`).
- Add deterministic Elo/stat computation module (ordered by match_date, created_at, match_id).

## Authentication flow (later)
- Replace the static login form with Supabase Auth sign-in and error handling.
- Add an auth/session store (Pinia or composable) with restore-on-refresh.
- Fetch/link the current profile (`profile_link_auth`) and persist `profile_id`.
- Add route guards for auth-only pages (submit match, my matches, player profile if required).
- Gate match mutations on authenticated profile id and surface clear auth errors.
- Add sign-out and session-expired handling (redirect to `/login`).
- Update UI to show auth state (loading, user identity, disabled actions when logged out).

## App shell / navigation (later)
- Move BottomNav into an authenticated layout or hide it on `/login`.
- Decide which routes are public vs authenticated and adjust nav visibility accordingly.
