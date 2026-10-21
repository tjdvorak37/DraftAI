# Accu-Steel Draft Studio

A working full-stack application for configuring fabric-covered steel buildings, reviewing dimensional material takeoffs, and managing inventory and costs. React + Three.js, with Supabase Auth/Postgres/Edge Functions for hosted deployments and Express/SQLite for local development. Requires Node.js 24 or later. Structural engineering and fabrication-release limitations still apply.

**Hosted setup:** follow [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) for setup and acceptance. DraftAI's Supabase schema and operations migration are applied, the authenticated function is deployed, public signup is disabled, and hosted smoke checks pass with temporary records removed afterward. The AWS frontend is at https://main.d1dq7mzpn9g8pz.amplifyapp.com and its exact origin is authorized. Permanent administrator credentials are provisioned privately; optional AI credentials/encryption setup are separate from core login and inventory operation.

**Inventory operations:** managed sites, employee-default inventory views, per-site balances/holds, customer accounts, delivery shipments, transfers, and stock movement history are implemented. See [docs/INVENTORY_OPERATIONS.md](docs/INVENTORY_OPERATIONS.md) for workflows, permissions, count/import conventions, and limitations. Existing stock is preserved in `MAIN` (Primary location).

**Yard and supply update:** yard staging and printable customer/order/location sheets; separate on-hand, held, staged, and available quantities; persistent in-app shortages; Ordering and Receiving queues; partial counted purchase receipts/rejects; and customer special-order allocation. The DraftAI migration and function are deployed and hosted smoke-tested; Amplify now serves a bundle containing the new yard-tag, Ordering, Receiving, and purchase screens. Supplier ordering and notification delivery are not automated.

**New functional slice:** terrain-aware concrete wall layouts now change column-leg lengths, side-girt lengths, covering areas, and geometric cut/fill quantities. Open **Site & openings** to configure the layout and **Construction schedule** to inspect/export the calculated lengths and wall sections. Follow [the construction test guide](docs/CONSTRUCTION_TESTING.md) for an exact repeatable hillside case. These dimensional calculations do not constitute structural approval or a complete fabrication list.

## Run

```sh
npm install
npm run provision-admin
npm run dev
```

Open http://localhost:5173. The API runs on port 3001. Vite automatically chooses another frontend port when 5173 is occupied.

The first screen is **Sign in**, with no public signup or guest workspace. Management provisions all accounts. The local initial-admin command uses masked terminal prompts and refuses to run once accounts exist. For Supabase, the first admin is created privately using the dashboard and guarded profile SQL in the setup guide. Drafts are stored under the authenticated user's identity in this browser; they are not shown before login. They remain on the device after sign-out, so avoid shared browsers for confidential designs. SQLite development data stays in the ignored `data/` directory. Production defaults to Supabase and locks access when its public configuration is missing.

## Included

- Parametric width, length, eave height, equal bay spacing, arched/gable roof, fabric colors, end walls, and front opening.
- Manual **Site & openings** controls for an east-wall window, terrain profile, finished-floor elevation, concrete-wall dimensions, column-base treatment, and explicit fill material/factor. Inputs are saved with projects and JSON exports. Geometry drives dimensional takeoffs; structural suitability and survey accuracy are not established.
- Shared concrete wall/covering profiles, location-specific column-leg schedules, clipped/interrupted girt layouts, concrete and cut/fill volumes, and a downloadable construction CSV. Adapted assemblies remain unpriced until entered in Inventory, including cubic-yard unit costs. These are not fabrication-released schedules or full structural/member/stock optimization.
- Orbit, zoom, pan, plan/elevation cameras, cutaway, wireframe, dimensions, grid, component inspection, and undo/redo.
- Optional full-footprint concrete floor with explicit thickness and waste allowance, 3D slab selection, and editable component-group properties through **Components** or a selected assembly. Typed examples include `add a concrete floor` and `add a 4-inch concrete floor`. The bare command proposes a clearly labeled draft 6-inch thickness and 5% allowance. Floor quantities are geometric, not reinforcement/foundation engineering; component editing is supported assembly parameters, not arbitrary member/bolt CAD.
- Preliminary catalog-driven material quantities, extended costs, unpriced custom door line, and CSV export. Unknown costs remain `null`, not zero. Unit costs retain cents.
- Workspace inventory with search, categories, stock/reorder thresholds, editable unit costs, custom parts, stock valuation, and CSV export. Custom catalog parts are inventory entries, not automatically included in a building or modeled in 3D.
- CSV/XLSX bulk inventory import with worksheet selection, automatic/custom column mapping, add/update modes, custom categories/units, counts, costs, reorder points, locations, and suppliers. Preview performs no inventory writes; apply is explicit, transactional, audited, conflict-checked, and non-replayable. Duplicate/invalid rows block import. Up to 5,000 rows per sheet, 100 columns, and 8 MB source file. Imported parts do not automatically become modeled building assemblies.
- Editable Draft Studio JSON import/export, plus ASCII DXF reference import and 2D footprint/bay-layout DXF export.
- Project Center with direct project creation, building editing, client/site metadata, ownership, target dates, notes, workflow status, search/filtering, and revision-checked metadata updates, backed by SQLite.
- Dedicated Admin Center for workspace identity, support email, account creation, role changes, account disabling, encrypted OpenAI connection settings/testing, and recent audit history.
- Support Center with private requester tickets, priorities/categories, linked projects, technician assignment, workflow status, and threaded replies. Administrators and technicians see the full queue; other users see only their own tickets. Attachments, email notifications, SLAs, and external helpdesk sync are not yet implemented.
- Private administrator provisioning and management-created accounts with name, address, phone, department, job title, email, and access level. Personal contact details are visible only to administrators and the account holder. Local mode uses bcrypt/HTTP-only sessions; hosted mode uses Supabase Auth and row-level policies, including MFA assurance checks. Public registration is disabled in the app and must also be disabled in hosted Supabase settings.
- Optional authenticator-app TOTP enrollment with QR code, AES-256-GCM encrypted secrets, verification, and used-code rejection. Each user enables two-factor authentication in workspace settings.
- Typed design requests with a review/apply step. Local commands work without credentials or a network AI provider. Optional OpenAI integration runs only on the server and validates returned models before applying them.

## Accounts And Permissions

Provision the initial administrator privately as described above. Open **Admin → People & access** to create accounts, edit contact/employment profiles, assign roles, and disable access. Use the avatar menu for personal two-factor settings. The workspace, its navigation, projects, and inventory are not available before sign-in. Only administrators can see and use the Admin Center.

| Role | Read projects | Edit/save designs | View costs | Manage inventory/costs | Create accounts |
| --- | --- | --- | --- | --- | --- |
| Administrator | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | No | No |
| Engineer | Yes | Yes | Yes | No | No |
| Estimator | Yes | No | Yes | Yes | No |
| Purchasing | Yes | No | Yes | No | No |
| Receiving | Yes | No | No | No | No |
| Technician | Yes | No | No | No | No |
| Viewer | Yes | No | No | No | No |

Viewer and technician costs are protected server-side (separate RLS-protected cost records in Supabase), not just hidden in the UI. Managers, engineers, and administrators can manage project metadata. Only technicians and administrators can triage all support tickets. Local access changes revoke sessions; Supabase rights/disabled status are checked on each request and by database policies, rather than trusting stale client role claims. Administrators cannot disable or demote their own account. Accounts currently share one workspace. Object-level project permissions and multi-tenancy are not implemented.

Two-factor authentication is optional, not organization-enforced. Password changes, account recovery, TOTP recovery codes, user removal, and self-service resets are not yet implemented. Back up your authenticator. Administrators should distribute initial team passwords through a secure channel.

## Design Commands And AI

Local command examples:

```text
Make it 80 ft wide and 120 ft long with 10 ft bays
Switch to a gable roof
Use green fabric
Add a 24 x 14 overhead door
Set the garage door to 20 feet by 14 feet
Set the garage door to 20' 6" x 14' 3"
Raise the building height by 2 foot
Add 5 feet to the north end of the building
Move the window on the east wall, near edge 20 ft from the southeast corner
Grade rises from 0 to 6 ft toward north, starting halfway along the building
Remove end walls
```

Local mode is a deterministic, intentionally limited command parser, not a large language model. Supported dimensions accept decimal feet, feet/foot/ft, apostrophes, and inches. A bare pair such as `20' x 14'` needs a subject: the last successfully interpreted door/window/building request or a selected opening supplies conversational context; otherwise the assistant asks what is being sized. Ambiguous setbacks/extensions, corner offsets without a wall and near-edge reference, and grades without travel direction/start position ask for clarification and apply no partial changes. Do not assume arbitrary descriptions or misspellings are comprehensively understood.

The building-local length direction is south to north, with the south-end datum used for north extensions. Rendering is centered for display; these are not georeferenced coordinates. Window offsets are to the nearest opening edge along the east wall, measured from the selected south/north corner. Only one east-wall window is currently modeled. Terrain stays at its start elevation until the selected percentage along its travel direction, then changes linearly to its end elevation. With wall adaptation disabled it remains a reference. With concrete adaptation enabled, wall tops follow ground plus the user-specified clearance above a level floor; concrete, columns, girts, covering, and net footprint cut/fill quantities update together. Fill enters the estimate only when a material is explicitly selected. Foundation strength, retaining capacity, drainage, reinforcement, connections, steel member sizing, and window procurement/detailing remain **uncalculated**. See the construction test guide for conventions, exclusions, and expected outputs.

All supported AI-proposed fields also have manual controls, and both paths use the same schema and undo history. This does not mean users can manually edit arbitrary CAD geometry, individual connection assemblies, custom part fabrication, or every real construction condition yet. A manually changed model invalidates any pending proposal; a response prepared for an outdated model is rejected. Parameters persist in local drafts, saved projects, and JSON exports. The current 2D DXF export remains a footprint/bay layout only; it does not include terrain or window detailing.

Standard production builds and unrestricted customization require an authoritative template/assembly catalog, exact connection/opening rules, and the CAD/engineering stages below. The current starter model is not such an approved catalog.

To enable real language-model requests, use **Admin → Integrations → OpenAI**. Save the model and key, enable the integration, then use **Test connection**. Connection testing verifies provider/model access, not full completion/billing availability. Stored keys are encrypted and never returned by the API; settings/audit responses do not expose the secret. Removing a workspace key can expose an existing environment fallback, so removal also disables the integration until explicitly re-enabled. Do not place secrets in support tickets.

Environment configuration remains supported:

```sh
export OPENAI_API_KEY="<your key>"
export OPENAI_MODEL="gpt-4o-mini"
npm run dev
```

Sign in as an engineer, manager, or administrator. The assistant shows **AI CONNECTED** when enabled credentials are configured, not a guarantee that the provider is currently healthy. The server first derives a supported deterministic change or requests clarification, then calls OpenAI with the current and validated candidate building plus your prompt. In this version the provider explains the validated operation; its returned model must exactly match the validated candidate or the request fails. Broader autonomous CAD/tool operations are not implemented. This integration incurs provider usage charges and sends design parameters to the provider; obtain company approval before using proprietary designs. Live provider calls are not exercised by automated tests without credentials. Provider failure or schema validation failure cannot silently change the building. Do not put keys in Vite client environment variables or commit them.

No external business-system connectors are planned or displayed. Support tickets are managed within this application. OpenAI is an optional, separately configured design integration.

## Drawing Interoperability

**Draft Studio JSON:** versioned parameter model; fully editable inside this prototype. It is not an AutoCAD drawing.

**DXF import:** uses `dxf-parser`, accepts ASCII DXF up to 8 MB and 50,000 rendered segments. Supports LINE, straight LWPOLYLINE/POLYLINE, ARC, and CIRCLE as a centered XY-plane reference. Declared feet, inches, millimeters, centimeters, or meters are converted to feet; when units are missing or unsupported, the user selects source units. Bulged polylines, INSERT/blocks, dimensions, text, solids, and other unsupported entities are skipped and counted. References are session-only and are not saved to projects or included in material quantities. This is a visual migration aid, not semantic CAD conversion or lossless round-tripping.

**DXF export:** a 2D footprint and frame/bay layout in feet on named layers, not a full construction drawing or 3D model.

**Not yet supported:** native DWG, IFC, STEP, Revit, arbitrary CAD solids, AutoCAD blocks/layers editing, snaps, constraints, arbitrary drafting tools, fabrication details, or conversion of imported geometry to engineered components. Export DWG to ASCII DXF in the originating CAD tool to use the supported reference geometry. Real migration fidelity must be established against representative Accu-Steel files before selecting a licensed CAD/ODA/Autodesk SDK.

## Engineering And Cost Limits

**This prototype is not an AutoCAD replacement, structural engineering system, or construction-ready deliverable. Do not fabricate or construct from it.** The company identity is a project-specific concept, not a claim of endorsement.

Model validation checks parameter ranges, simple door clearances, and window bounds only. It does not establish structural safety, loading, member sizing, stability, connections, foundations, material strength, tolerances, wind/snow/seismic design, fire performance, or local code compliance. A licensed engineer must review designs and approve actual product configurations. Project status "Review" or "Completed" is an internal management label, not an engineering approval or professional seal.

See [the engineering roadmap](docs/ENGINEERING_ROADMAP.md) for the distinction between CAD fidelity, software validation, project-specific professional approval, and permit acceptance, including concrete acceptance gates.

The demonstration catalog, frame topology, fixed purlin rule, cable kits, and prices are illustrative. Bay counts are rounded up and spacing is distributed equally. Fabric quantities use an idealized roof profile plus walls and 5% allowance, not a manufacturable membrane cutting pattern. Quantities omit numerous real fasteners, connectors, reinforcement, door mechanisms, waste rules, and custom fabrication details. The estimate excludes unknown-price items, foundations, labor, tax, and freight. Inventory updates do not represent purchasing, reservations, stock movement transactions, or accounting COGS. Saving a project does not reserve or consume inventory. Saved designs use current catalog costs, not historical quote snapshots.

## Verification

```sh
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

All 33 automated tests and 10 browser workflows pass, along with production build, Deno validation, and a zero-finding production dependency audit. Coverage includes dimensional construction takeoffs, slab/component editing, imports, authentication, locations, customer privacy, reservations/staging/dispatch/receipts, purchasing/allocation, and Supabase policies/MFA/authorization. Browser tests use an isolated in-memory database and ports 3002/5174, including real slab selection, yard-tag PDF/print visibility, counted receiving, desktop/mobile layouts, and management/authenticator workflows. The deployed backend also passed hosted yard/supply/floor smoke checks with temporary fixtures removed. Software rendering can make the full browser suite take several minutes in containers.

## Deployment

**Amplify + Supabase is the hosted deployment path:** use the setup guide above. Configure `VITE_BACKEND=supabase`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` in Amplify, apply the migration and deploy `workspace-api` in Supabase, and restrict `ALLOWED_ORIGINS` to the actual frontend URLs. Service-role keys, database passwords, encryption keys, and OpenAI credentials must never appear in frontend variables. The included Amplify build publishes `dist` without an Express server.

The commands below describe the alternative single-server SQLite/local backend. Its frontend must be built explicitly with `VITE_BACKEND=local`; it is not the Amplify deployment:

```sh
VITE_BACKEND=local npm run build
SESSION_SECURE=true npm start
```

The production process serves both the compiled frontend and API on `API_PORT` (default 3001). Terminate HTTPS at a same-origin reverse proxy that preserves `Host`. `SESSION_SECURE=true` requires HTTPS and prevents cookies being sent over plain HTTP. Development leaves this disabled for localhost. Set `DATABASE_PATH` to a persistent SQLite path. A random encryption key is generated beside the database with mode `0600`; back up the database and key together, or configure a stable `ENCRYPTION_KEY` containing exactly 64 hexadecimal characters. Losing the key makes enrolled TOTP secrets unreadable. Never check either file into source control.

Before company deployment, add a formal threat model and security review, enforced MFA policy, recovery and lifecycle flows, controlled first-account provisioning, backup/restore tests, monitoring, transactional inventory/stock history, authoritative product data, and signed-off engineering rules. The included rate limiter is process-local; multi-instance deployment requires shared session/database and rate-limit infrastructure. This is a single-company prototype, not a hardened production SaaS deployment.

## Suggested Product Stages

1. Validate real Accu-Steel drawings, product families, parts, material schedules, units, and engineering ownership with the team.
2. Select the CAD/import kernel using representative DWG/DXF files and explicit fidelity/round-trip acceptance tests.
3. Replace illustrative geometry and takeoff rules with versioned engineer-approved components, connections, assemblies, and load cases.
4. Add fabrication drawings, custom assembly modeling, quote snapshots, inventory movement ledgers, purchasing, reservation, and accounting integration.
5. Integrate AI tools against constrained, auditable CAD/engineering operations with approval workflows, rather than unrestricted geometry generation.
6. Complete production identity, enforced MFA, recovery, granular object permissions, audit visibility, deployment hardening, and acceptance testing.