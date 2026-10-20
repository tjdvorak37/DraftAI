# Test The Terrain-Aware Construction Workflow

## Start Here

Run `npm run dev` and open http://localhost:5173. Local drafting does not require an account. Sign in to persist a project to the shared workspace or edit inventory prices. First-account setup creates an administrator; existing users need an administrator-created account.

This implementation replaces the former terrain-only visualization with a shared dimensional construction model. Concrete wall profiles, shortened column legs, interrupted girts, covering deductions, and geometric cut/fill volumes now drive both the 3D model and material takeoff. It is not a complete engineering system, full AutoCAD editor, or fabrication-approved drawing package.

## Repeatable Hillside Case

Use these building values:

| Parameter | Value |
| --- | --- |
| Width | 60 ft |
| Length | 96 ft |
| Eave height | 16 ft |
| Bay spacing | 12 ft |
| Roof | Arch |
| End walls | Enclosed |
| South/front door | 20 ft wide × 14 ft high |
| East-wall window | Disabled |

Open **Site & openings** and enter:

| Parameter | Value |
| --- | --- |
| Ground start elevation | 0 ft |
| Ground end elevation | 6 ft |
| Slope start | 50% |
| Travel direction | South → north |
| Wall treatment | Concrete wall |
| Column base treatment | Start column legs at wall tops |
| Finished floor elevation | 0 ft |
| Concrete wall thickness | 8 in |
| Wall clearance above grade | 1 ft |
| Fill material | Not specified |
| Fill volume factor | 1 |

Click **Apply site & opening changes**. Inspect the 3D model with cutaway enabled and disabled, orbit it, and open **Construction schedule**.

Expected results:

| Output | Expected |
| --- | --- |
| South wall top | 1 ft above floor |
| Wall top at halfway | 1 ft above floor |
| North wall top | 7 ft above floor |
| South column leg | 15 ft |
| North column leg | 9 ft |
| Main column legs | 18 |
| Combined main column leg length | 240 ft |
| Reduction against 18 × 16 ft legs | 48 ft |
| Concrete walls | About 23.078 cu yd net |
| Excavation inside footprint | 320 cu yd net |
| Fill inside footprint | 0 cu yd |
| Replacement of above-floor covering by concrete | 940 sq ft before fabric allowance |
| Covering with 5% allowance | 12,629 sq ft |
| Roof purlin + side-girt scheduled length | 1,392 ft |

These are geometric lengths and volumes, not steel weight, an engineered section selection, or guaranteed savings. Concrete end panels butt between side walls; their takeoff width is the frame-axis building width minus one wall thickness. The south door opening is deducted. Covering deductions use the frame-axis envelope. Quantities do not include footings, below-floor foundation walls, reinforcement, formwork, coatings, drainage, or waste.

The ground surface is displayed outside the adapted side walls; the footprint cut quantity represents removal of the existing ground above the level floor within the building. This is not a complete proposed-grading surface, excavation slope, or geotechnical solution.

## Use Typed Requests Instead

Enter and apply these requests separately:

```text
Grade rises from 0 to 6 ft toward north, starting halfway along the building
Use concrete walls, wall thickness 8 inches, wall clearance 1 ft above grade, and start the columns at wall tops
```

The resulting model should match the manual case. Review the before/after proposal before applying it. Use undo/redo to compare layouts. Unknown or ambiguous foundation/strength instructions still request clarification rather than invent an engineering solution.

Other supported examples:

```text
Keep original column lengths
Set finished floor elevation to 6 ft
Use stone fill with fill factor 1.15
Remove concrete walls
```

Floor elevation is absolute relative to the project's existing elevation datum, not a request to raise the floor by that amount. Negative elevations can be entered manually; the current local text grammar does not comprehensively support signed measurements.

## Test Floor Elevation And Fill

Starting with the hillside case, change the finished floor elevation to 6 ft and choose stone fill with a factor of 1.15. Expected net fill is 960 cu yd, the explicit material allowance is 1,104 cu yd, and net footprint excavation is zero. The wall/column/covering model updates accordingly.

The factor is a user-entered allowance. It is not automatically derived from stone density, compaction, moisture, soil type, settlement, or construction specifications. Selecting stone does not establish its suitability.

## Test Openings And Invalid Conditions

- Enable a 4 × 3 ft east-wall window at an 8-ft sill, near edge 20 ft from the southeast corner. Covering decreases by the opening area; the girt passing through the window is interrupted. Headers, reinforcement, jamb members, custom membrane edges, and window procurement are not generated.
- Lower the sill so it intersects concrete. Applying the layout must fail with a clear error and leave the current building unchanged.
- Increase the wall top to within 1 ft of the eave. Applying the layout must fail.
- Reverse the hillside toward the south while keeping a zero finished-floor elevation and the front door. Applying must fail because the front opening intersects existing ground. Resolve this by specifying a valid floor/site layout; the application does not invent a driveway, retaining solution, or entrance excavation.
- Keep original column lengths. The reported column-leg reduction must become zero; the app must not claim the same steel savings while keeping the same members.
- Choose a non-bay-aligned slope start or length. Girting remains continuous within a bay unless a real wall/opening intersection requires a cut; terrain breakpoints do not introduce artificial splices.

## Prices, Saving, And Exports

Adapted frame assemblies, concrete, excavation, fill, and custom longitudinal steel are separate catalog entries. They start unpriced. The unchanged standard frame price is not automatically applied to a different assembly. The current estimate excludes unpriced items and remains an incomplete priced subtotal until they are entered.

Administrators/estimators can edit these entries in Inventory. Concrete, excavation, and fill use **cu yd**; longitudinal steel uses **ft**; custom frame assemblies use **ea**. Prices and stock balances are workspace data, not manufacturer-verified costs. Entering a price does not complete engineering or procurement planning.

**Construction schedule → Export schedule** downloads a CSV with main column marks/lengths, purlin/girt marks/lengths, wall stations/elevations, and geometric quantities. It is marked **not released for fabrication**. It does not optimize stock, select standard bar lengths, add kerf, calculate bends, or infer allowable splices.

Project saves and JSON exports retain terrain, floor, wall, support, fill, and window inputs. Reopen/reload to confirm persistence. Existing version-1 JSON files without the new construction fields still import with wall adaptation disabled. The current DXF export remains a 2D footprint/bay layout and does not contain the full construction geometry or schedule.

## What Still Blocks Production Engineering

An engineer must resolve member sections and strength, retaining capacity, lateral loads, soil/frost conditions, drainage/waterproofing, footings, reinforcement, connections/anchorage, stability, and code compliance. Column support on a concrete wall is a user-selected layout assumption, not an automatically approved structural detail.

The current frame, hardware, bracing, and covering rules remain illustrative outside the explicit dimensional calculations described above. The schedule is not a complete fabrication or procurement list. A licensed engineer's release process, authoritative Accu-Steel assemblies, precision CAD import/editing, and validated calculations remain required before fabrication or construction.

See [ENGINEERING_ROADMAP.md](ENGINEERING_ROADMAP.md) for the engineering and production acceptance gates.