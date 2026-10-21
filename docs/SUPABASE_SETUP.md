# Deploy Draft Studio With Supabase And Amplify

## Status And Scope

This repository now contains a Supabase backend option: Auth with optional authenticator MFA, management-created staff profiles, Postgres row-level security, an authenticated Edge Function for privileged operations, and transactional inventory imports. The frontend's production default is Supabase. Express/SQLite remains available for local development and automated tests only.

**Deployment status for this workspace:** the DraftAI project `vheobwhpufrubdfantex` is linked; migrations `202610200001_workspace.sql`, `202610200002_inventory_operations.sql`, and `202610210001_yard_purchasing.sql` are applied; the matching `workspace-api` is deployed; email/password login is enabled and global public signup is disabled. The AWS frontend origin https://main.d1dq7mzpn9g8pz.amplifyapp.com is authorized. Hosted smoke checks verify staging, shortages, purchasing/receiving roles, partial counted receipts/rejects, replay protection, special-order allocation, concrete-floor persistence, authentication, and privacy with temporary records removed. PR #4 is merged to `main`, but Amplify still served the prior frontend bundle at last check; its new build must complete before the hosted UI is available. Permanent administrator credentials remain private/operator-managed. The steps below remain the reference for a new installation.

This guide assumes the new Supabase project is empty, as confirmed by the project owner. Do not run the initial migration against another application's database. Review the SQL before applying it. The migration deliberately does not seed illustrative inventory: real inventory starts empty and can be imported.

## 1. Prepare Supabase Authentication

In the Supabase dashboard:

1. Open the correct DraftAI project. Copy its Project URL and **publishable** key from its connection/API settings. These two values are frontend configuration, not privileged database credentials.
2. In Authentication settings, **disable public user sign-ups** while leaving email/password sign-in enabled. The CLI uses global `[auth].enable_signup=false` to block registration and `[auth.email].enable_signup=true` to keep the email provider usable. Disabling both prevents legitimate email login. A config file alone does not change hosted settings until it is pushed; the DraftAI project's reviewed settings have been pushed and tested.
3. Set the Site URL to your final Amplify HTTPS URL. Add only your specific production and approved development URLs to allowed redirects. This version uses password login, not public registration or email invitation links.
4. Keep provider authentication rate limits enabled. Configure password policy, session lifetime, and authenticator MFA according to management's requirements. MFA is optional per account in this version; once enrolled, both database and function access require an MFA-verified session.

An Auth account alone cannot enter the app: it also needs an active, management-provisioned `profiles` row. Users cannot create or promote their own staff profile.

## 2. Apply The Database Migration

For a new, empty project, open Supabase **SQL Editor** and run the complete migrations in this order:

[supabase/migrations/202610200001_workspace.sql](../supabase/migrations/202610200001_workspace.sql)

[supabase/migrations/202610200002_inventory_operations.sql](../supabase/migrations/202610200002_inventory_operations.sql)

[supabase/migrations/202610210001_yard_purchasing.sql](../supabase/migrations/202610210001_yard_purchasing.sql)

Run it once. It creates tables, policies, and functions inside a transaction; it is not a destructive reset or an idempotent script. On an error the transaction must roll back; fix the cause instead of dropping existing data.

Alternatively, with the Supabase CLI authenticated on your machine:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Enter CLI authentication/database credentials directly into the terminal if prompted. Do not paste tokens or passwords into chat, source files, commit messages, or tickets. Do not apply the same migration again through the CLI after manually applying it unless you reconcile CLI migration history first.

The schema separates inventory costs from quantities and puts row-level security on every application table. Viewers and technicians cannot read costs. Private profile contacts are visible only to that person and administrators. Staff directory data is limited to name, ID, and role. Ticket records and replies are visible only to the reporter and support staff. Direct browser writes are blocked; validated mutations go through the function or authorized transactional inventory RPCs. This is one company workspace, not a multi-tenant system or per-project ACL system.

## 3. Create The First Administrator Privately

In **Authentication → Users**, use the dashboard's administrator action to create your own email/password account. Confirm the email through the administrator workflow. Do not invent a shared account or commit credentials.

After the migration, run this SQL in the same project's SQL Editor, replacing the name and email with your own. It does not contain a password and only works while the staff table is empty:

```sql
insert into public.profiles (id, name, email, role)
select id, 'YOUR FULL NAME', lower(email), 'admin'
from auth.users
where lower(email) = lower('YOUR_ADMIN_EMAIL')
  and not exists (select 1 from public.profiles)
returning id, name, email, role;
```

It must return exactly one row. Zero rows means the Auth user/email was not found or a staff profile already exists; investigate instead of bypassing the guard.

After sign-in, use **Admin → People & access** to create the remaining staff accounts with name, email, initial password, role, address, phone, department, and job title. Only administrators can maintain those details and access levels. Initial credentials must be delivered privately. Self-service password recovery, password-change workflows, SSO, and enforced organization-wide MFA are not implemented yet.

## 4. Deploy The Edge Function

Authenticate and link the Supabase CLI as above, then configure secrets using the Supabase function-secrets dashboard or secure CLI input. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions. Never expose the service-role key in Amplify frontend variables or any `VITE_` value.

Required custom secret:

| Name | Value |
| --- | --- |
| `ALLOWED_ORIGINS` | Exact frontend origins separated by commas, such as `https://main.YOUR_APP.amplifyapp.com,http://localhost:5173`. No paths, trailing slashes, or wildcards. |

Optional AI secrets:

| Name | Purpose |
| --- | --- |
| `WORKSPACE_ENCRYPTION_KEY` | Stable 64-character hexadecimal AES key, required to save an OpenAI key in Admin Center. Back it up securely; changing/losing it makes saved keys unreadable. |
| `OPENAI_API_KEY` | Optional server-side provider credential instead of storing one through Admin Center. |
| `OPENAI_MODEL` | Optional model default; otherwise `gpt-4o-mini`. |

Generate an encryption key locally using a secret-management tool or `openssl rand -hex 32` and place it directly into Supabase secrets, not chat. AI is optional: local supported design commands work without any provider key.

Deploy:

```sh
npx supabase functions deploy workspace-api --no-verify-jwt
```

The function deliberately performs its own verification using Supabase Auth `getUser(token)`, the active staff profile, and the database's MFA-aware `workspace_role()` result. `--no-verify-jwt` disables the older gateway verifier, **not** application authentication. Requests without a valid user session or appropriate role are rejected. CORS allows only the configured exact origins; it is not a substitute for authorization.

Function imports are declared in [deno.json](../supabase/functions/workspace-api/deno.json). Deploy from this repository's root so shared model/validation modules are available to the dependency bundler.

## 5. Configure Amplify

Push the reviewed application changes to the GitHub branch Amplify builds. Local uncommitted changes are not deployed automatically.

In Amplify build environment variables, set:

```text
VITE_BACKEND=supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

For an older project, `VITE_SUPABASE_ANON_KEY` is accepted instead of the publishable-key variable. Do not use a secret/service-role key in either field. Frontend environment variables are embedded in the public JavaScript build; changing them requires rebuilding/redeploying.

The included [amplify.yml](../amplify.yml) installs Node.js 24, runs `npm ci` and `npm run build`, and publishes `dist`. Use the repository root as the app root. A standard frontend build instance should be sufficient; an XLarge instance is not required by the architecture. Configure a standard SPA fallback to `/index.html` if you later add path-based client routing; the current app uses in-page navigation.

Amplify hosts static frontend assets. Supabase hosts Auth, database, and functions; the Express process is not needed in that deployment. A missing Supabase configuration leaves production access locked instead of falling back to an unauthenticated draft or a broken local API.

## 6. Live Acceptance Before Staff Access

1. Open the Amplify URL in a private browser window. The first screen must be Sign in, with no signup or guest drafting route.
2. Confirm public signup is disabled in Supabase. An Auth user without a staff profile must not enter the workspace.
3. Sign in as the provisioned administrator. Create a staff account and confirm its address/phone/department/job title remain correct after editing/reopening.
4. Create, save, and reopen a project. Assign a manager/engineer as owner; Supabase UUID assignments must persist.
5. Import a small CSV into empty inventory, then a counts-only XLSX update. Preview must make no changes; apply must be atomic. Check custom categories, units, unknown costs, and storage locations. Keep an export before importing real business data.
6. Sign in as a viewer/technician. Costs and other people's contact information must not be readable. Attempt an unauthorized update and confirm it fails server-side.
7. Create a support ticket as one staff member. Other ordinary staff must not see it; administrator/technician assignment and replies must work.
8. Enroll TOTP on a test account, sign out, and confirm that password-only sign-in cannot access functions or database data. Check disabled-account access with an already-issued token as well as a new login.
9. If using OpenAI, test it with an approved non-confidential design. Live provider billing/network access is not covered by local tests.
10. Set up database backups/restore procedures, secret backups, auth recovery, monitoring, incident response, and provider spending/rate controls before production company data. Verify the actual plan's backup/retention features; a free project's dashboard does not imply a backup policy.

Backend deployment and temporary-record hosted checks have been performed for the linked DraftAI project. Full acceptance through the actual AWS frontend URL remains pending until that URL exists and is added to the function's allowed origins. Do not label the installation production-ready solely because a frontend build succeeds. Structural engineering/fabrication limitations remain documented separately.

## Local Development And Tests

Local API mode:

```sh
npm install
npm run provision-admin
npm run dev
```

Use `VITE_BACKEND=local` for an explicit local configuration. The initial-admin command uses masked terminal prompts; do not provide its password through chat. Existing local accounts remain intact. It refuses to provision another initial account once any user exists.

Cloud-backed development: put only the public variables from [.env.example](../.env.example) in an ignored `.env.local`, add the exact localhost origin to function secrets, and restart Vite. This uses real Supabase data, not the isolated test database.

Verification:

```sh
npm test
npm run build
npm run test:e2e
npx deno check --config supabase/functions/workspace-api/deno.json supabase/functions/workspace-api/index.ts
```

An authenticated operator can run `node scripts/smoke-supabase.mjs --project-ref YOUR_REF --allow-temporary-data` for hosted checks. It retrieves credentials from the logged-in CLI into process memory, creates clearly marked temporary fixtures, and removes them afterward. Set `SMOKE_APP_ORIGIN` to an allowed app origin when running outside this Codespace. Do not interrupt it during cleanup. It never creates a lasting administrator or prints credentials.

SQL/RLS/MFA/transaction tests use PGlite (embedded PostgreSQL) with a small Auth test schema. Edge authorization tests use injected clients. Browser tests provision an administrator only inside a separate in-memory development API. These provide local evidence, not a substitute for live Supabase Auth/function verification.