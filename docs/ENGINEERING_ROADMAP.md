# From Draft Studio To Permit-Ready Engineering

## What "Certification" Means

There is no universal "AutoCAD-level building certification" obtained by matching a CAD application's features. Distinguish these outcomes before defining acceptance:

- **CAD compatibility:** correct import/export of agreed drawing formats, units, geometry, layers, blocks, dimensions, references, and metadata.
- **Validated engineering software:** documented evidence that calculations and generated drawings behave correctly for a defined, limited range of supported structures and configurations.
- **Project engineering approval:** a licensed professional engineer takes responsibility for the site-specific design and, where required, signs/seals the released drawings and calculations. A software role named "engineer" does not establish professional licensure.
- **Permit acceptance:** the authority having jurisdiction accepts the submittal under the locally adopted codes and any other requirements. Software cannot guarantee this acceptance.
- **Personnel certification:** AutoCAD proficiency credentials certify a person's skills, not a building's safety or this application's calculations.

**Recommended product goal:** an engineer-controlled Accu-Steel configuration and detailing system with validated product rules and a licensed CAD interoperability layer. Recreating every AutoCAD feature is not a prerequisite for producing controlled, reviewed drawings for a narrow product family.

The current application is a preliminary design and workflow prototype. Nothing added to the management screens constitutes structural validation, a professional seal, or approval for fabrication.

## Gate 1: Define The Supported Engineering Envelope

Appoint an Accu-Steel engineering owner and a licensed engineer responsible for validation. Select the first supported building family, rather than promising arbitrary steel or pole buildings.

Collect:

- Representative source CAD files, external references, fonts, blocks, sheets, dimension styles, and existing issued drawings, with permission to use them.
- Approved product families; member sections, materials, grades, coatings, connections, bolts, welds, bases, bracing, foundations, doors, and membrane systems.
- Authoritative part and assembly IDs, quantity rules, fabrication lengths, cutting/waste allowances, unit conversions, and pricing ownership.
- Reviewed calculation packages, governing load cases, failure cases, and boundary configurations for independent benchmarks.
- Site inputs and design criteria: jurisdiction, adopted code editions, occupancy/risk category, geotechnical parameters, exposure, wind, snow, seismic, temperature, equipment and other loads as applicable.
- Intended deliverables: plans, elevations, sections, connection and foundation details, assembly drawings, schedules, material lists, revision history, and calculation reports.

**Acceptance:** a signed requirements matrix specifying supported configurations, prohibited combinations, units, tolerances, responsible reviewers, and required evidence. Unsupported configurations must fail explicitly rather than produce plausible geometry.

## Gate 2: Prove CAD Migration And Precision

Evaluate a licensed drawing SDK such as ODA Drawings SDK or Autodesk RealDWG against real project files. Verify current licensing, hosting, supported platforms, distribution rights, and file-version support before committing to an architecture. A browser renderer is not a CAD database or a precision modeling kernel.

For solid/parametric modeling, evaluate an established geometry kernel and constraint system. Three.js remains appropriate for visualization, but visual vertices cannot be the authoritative engineering model.

Implement the required subset of:

- Precision geometry, explicit units and tolerances, coordinates/transforms, snapping, constraints, selection, measurements, layers, blocks/assemblies, and stable object identifiers.
- Section/member definitions, feature/assembly history, custom part placement, connection points, and reproducible geometry regeneration.
- Paper/model space, viewports, lineweights, dimension styles, text/fonts, title blocks, external references, and controlled PDF/plot output.
- Semantic import where possible; distinguish exact conversion, visual reference, unsupported entities, and data that cannot be reconstructed.

**Acceptance:** versioned source files and golden expected outputs; independent checks of geometry, dimensions, annotations, and schedules; round-trip tests in the originating CAD tool; explicit loss/unsupported-entity reports. No silent dropping of essential engineering information.

## Gate 3: Validate Structural Calculations And Product Rules

Use an established engineering solver or a rigorously validated engineering service with approved APIs and licenses. Possible products to evaluate with the engineering team include RISA, RFEM, or SAP2000; suitability for Accu-Steel's frames, connections, and membrane behavior must be demonstrated rather than assumed.

The responsible engineer determines applicable requirements and editions. Depending on the building, materials, and jurisdiction, these may include the adopted IBC, ASCE 7 load provisions, AISC 360 for structural steel, AISI S100 for cold-formed steel, and ASCE 55 for tensile membrane structures. Fabric fire-performance and other testing requirements, potentially including NFPA 701 where applicable, must also be established by the engineer and authority having jurisdiction. This is not an exhaustive or universally applicable list.

Required checks may include load paths and combinations, member strength and stability, serviceability/deflection, second-order effects, bracing, connections, anchorage, foundations, membrane behavior and prestress, openings, durability, and fabrication/erection constraints.

**Acceptance:** calculation-by-calculation benchmark evidence against independently reviewed examples, numerical tolerances approved by the engineering owner, documented assumptions/limitations, adverse-case tests, and independent professional review. A rendered building or passing UI tests is not evidence of structural adequacy.

## Gate 4: Create A Controlled Engineering Release

Separate **project workflow status** from **engineering release status**. The current Planning/Design/Review/Completed labels are management labels only.

Add a dedicated review/release process with:

- Immutable model revisions, authoritative part/rule versions, site criteria, calculation inputs/outputs, CAD files, sheet sets, and cost/quantity snapshots.
- Content hashes and provenance linking every output to its model and rules; traceable, timestamped change records and reviewer decisions.
- Checker and approver identities, verified jurisdiction-specific professional credentials, segregation of duties, and recorded review comments.
- Integration with an approved professional signing/sealing process. Do not generate or attach a professional seal just because an app account has an engineer role.
- Automatic invalidation of approvals when geometry, site criteria, engineering rules, or referenced parts change. Prevent obsolete drawings from being presented as current.
- Explicit draft watermarks and blocked fabrication export until all applicable checks and required reviews pass.

**Acceptance:** a complete example package traced from original inputs through revision, calculation, independent check, professional approval, and controlled issue. The engineer and receiving authority define required signatures and documentation.

## Gate 5: Constrain AI To Auditable Operations

**No AI provider is currently connected.** Provider selection is deferred pending research. If a provider is selected later, AI may interpret intent into a typed proposal or summarize validation failures; it must not be the source of engineering truth. The existing local command parser remains deterministic and limited.

- Limit AI tools to typed, authorized, versioned operations against the authoritative model.
- Validate units, supported envelopes, permissions, geometric constraints, product rules, and structural checks independently of the language model.
- Record proposals, differences, validation results, model/provider version where available, and the human decision.
- Never treat a natural-language claim of safety or compliance as a passed engineering check.
- Keep structural parameters distinct: primary frame/truss station spacing is not purlin spacing. Both need approved product-family rules, geometry, supported bounds, quantity reconciliation, and independent calculation checks before natural-language editing is enabled.
- Require review and invalidate affected approvals after changes. Plan for outages, malformed output, prompt injection from imported material, and provider/data-retention policy.

**Acceptance:** tests that demonstrate unsupported, unsafe, unauthorized, ambiguous, and adversarial requests cannot bypass the validated engineering/release path.

## Gate 6: Production Operations And Business Integration

Complete production identity and access management, enforced MFA/SSO as required, recovery flows, session controls, tested backups, encryption/key management, monitoring, incident response, and a security review.

For SMS management, EchoAIPro, and other third-party systems, agree the system of record and obtain API documentation, authentication details, sandbox access, event schemas, webhook signing/retry rules, and data-retention requirements. Do not share credentials through support tickets or chat.

Add granular project access where needed, stock movements/reservations, inventory reconciliation, purchasing, cost snapshots, historical accounting COGS, and approved accounting integrations. The current on-hand balance and live material estimate are not a COGS ledger.

Support tickets are an operational record, not a safety-incident or engineering change-control substitute. Define escalation and engineering-impact handling separately. Add attachments, notifications, SLAs, and external helpdesk synchronization only with the needed security and retention controls.

**Acceptance:** successful restore and release rollback exercises, permission/privacy tests, integration sandbox acceptance, operational ownership, and end-user acceptance by engineering, fabrication, management, and support.

## Immediate Inputs Needed

1. Two or three representative editable source drawings plus their complete referenced assets and corresponding issued PDFs.
2. One approved building family with a reviewed calculation package and authoritative assembly/material schedule.
3. The intended states/jurisdictions and the engineering team responsible for approved rules and project seals.
4. Access to the SMS management and EchoAIPro repositories or screenshots/workflow specifications, plus API documentation for actual integration.
5. A written definition of the first release's supported operations and sign-off criteria.