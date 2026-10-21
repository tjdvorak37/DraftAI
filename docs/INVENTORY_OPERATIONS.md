# Locations, Yard Staging, Purchasing, And Shipping

**Release status:** the `202610210001_yard_purchasing.sql` migration and matching authenticated function are deployed to DraftAI and passed hosted smoke checks with temporary records removed. Amplify serves a JavaScript bundle containing the matching yard-tag, Ordering, Receiving, and purchase screens.

## Inventory Locations

Administrators manage sites in **Admin → Locations**. Each site has a stable code, display name, address, phone number, and active status. Codes cannot be renamed through the UI because staff, balances, and movement history reference them. Rename the display name instead.

Existing inventory is preserved in the automatically created **Primary location** (`MAIN`). Rename it to your actual initial facility before adding other sites. No stock is duplicated across new sites. A location cannot be deactivated while it has active employees, stock, holds, open shipments, or outstanding purchases.

Managed sites are different from storage-bin details. A part can be stocked at multiple sites, each with its own on-hand count, reorder point, and bin. The part description, category, unit, supplier, and unit cost are shared catalog values. This release does not implement lot-specific or location-specific purchase costing, accounting COGS, FIFO/LIFO, or automatic unit conversion.

## Employee Work Location

In **Admin → People & access**, create or edit a user and choose **Work location**. New and existing users default to `MAIN` until management assigns another active site. After signing in, employees see their assigned site's inventory by default.

The Inventory location selector can show another site or **All locations**. This is a default-view feature, not a restriction preventing staff from reading other sites. Combined totals are read-only for count edits and imports; select a specific site before changing stock. Viewer/technician cost restrictions still apply.

An administrator who changes their own location should sign out and back in to test the default. A different employee's new assignment takes effect on their next sign-in.

## Counts And Imports

- **On hand** is all physical stock at the selected site, including held and yard-staged materials.
- **Held** is reserved stock not currently marked staged, including partially received special-order allocations.
- **Staged** is reserved stock assigned to a staged delivery/transfer order in the yard.
- **Available** is on hand minus held minus staged. Staging never deducts physical stock; dispatch does.
- Manual counts and imported counts replace on-hand balances; they are not added to them.
- Counts cannot be set below existing holds. Release/cancel the relevant order or investigate the discrepancy first.
- Imports target one selected managed site. An unmapped bin is preserved on an existing balance; new-site balances start without a bin unless supplied.
- Catalog descriptions, units, categories, suppliers, and costs are shared across sites. Review mapped fields before applying an import. A blank mapped price makes that catalog cost unknown.
- A unit cannot be changed while stock exists. A reviewed unit-conversion workflow is needed instead.
- Exporting All locations includes separate site rows, location codes, holds, and availability. Imports still target one site at a time; split/filter a multi-site export by site before reimporting repeated SKUs.

The stock ledger records opening quantities, count adjustments, holds, dispatches, cancellations, and receipts. Source/destination mutations are transactional, not client-side number changes. Import conflict checks use the selected site balance. Part creation, count updates, and imports do not create customer orders automatically.

## Customer Accounts

Administrators, managers, and estimators can open **Customers** to add and maintain:

- Customer/company name and account number.
- Primary contact, email, phone, and website.
- Billing address and shipping address, including country and postal information.
- Delivery instructions, additional named contacts with title/email/phone, and detailed account notes.
- Active/inactive status.

Updates are revision-checked; an outdated editor must refresh instead of overwriting another user's change. Deactivation prevents creating new customer shipments, but does not erase or cancel existing orders. Customer information is not available to viewer, technician, or engineer roles in this release. Management assigns an appropriate operations-capable role where required.

## Customer Delivery Workflow

1. In **Shipping**, choose **New shipment**, then **Customer shipment**.
2. Select the shipping site and customer. The customer's ship-to address is copied to the order and may be adjusted for that delivery.
3. Add material lines and quantities, reference/order number, planned delivery date, carrier, tracking/bill-of-lading reference, and notes. Save a draft.
4. Open the order and choose **Hold materials**. The full order must be available. If any line cannot be reserved, no lines are reserved.
5. When finished goods move outside, enter **Yard area / row / position**, then choose **Stage in yard**. Open **Print yard tag** to preview and print/save a sheet with customer, contact, order number, material quantities, ship-to address, and yard position. Printing alone does not stage or change stock. Store sheets containing customer information securely.
6. To relocate staged materials, choose **Return to held**, enter the new yard position, stage again, and replace the old sheet. All movement actions remain in history.
7. Enter carrier/tracking details as needed and **Dispatch shipment** from held or staged. Stock and its reservation leave the source in one transaction.
8. **Confirm delivered** records completion. It does not remove stock a second time.

Customer/contact details, ship-to addresses, and material descriptions/units are snapshots. Later customer/catalog edits do not silently rewrite a saved order or yard tag. The tag shows its status and revision; an unassigned or non-staged tag is explicitly labeled. A downloadable text packing list is also available; neither sheet is a carrier label or tax invoice.

## Low Stock And Purchasing

The bell badge shows unacknowledged shortages for the selected Inventory location. **Ordering** defaults to the employee's work site; its location selector can show another site or all sites. Warnings compare **available**, not physical on-hand, against the site's reorder point. They clear when available reaches the minimum and reopen as a new unacknowledged episode if it drops again. Acknowledgment does not change stock or suppress the ordering row.

1. Review **Ordering → Needs ordering**. It shows available, minimum, outstanding general-inventory purchases, and the remaining suggested replenishment quantity. Incoming special orders are excluded from general replenishment coverage because the customer needs that material.
2. Choose **Prepare order** or **New purchase**. Set supplier, reference, receiving location, expected date, notes, and material quantities. A saved draft does not add stock or count as incoming.
3. Place the order with the supplier using your normal purchasing process. Then open the draft and **Mark as ordered**. This records the action; the app does not send a vendor order, payment, or email.
4. Track **Ordered / incoming** until approved receipts complete it. **Cancel outstanding** closes the remainder without removing material previously accepted.

Warnings are persisted in-app notifications, not email, SMS, push, or external-system connections. No notification delivery provider is configured by this feature.

## Counted Receiving And Special Orders

1. Open **Receiving → Ordered / incoming**, select a purchase, then **Count received materials**.
2. Enter the physically counted **accepted** and **rejected** quantities, receiving bin/yard, delivery reference, and discrepancy notes. Accepted counts start blank, not automatically at the expected quantity. Accepted plus rejected cannot exceed the currently outstanding line quantity.
3. Check the explicit counted-quantity approval and choose **Approve and add to inventory**. Accepted units post to the receiving site's stock and ledger in one transaction. Rejected units are recorded but never stocked; they remain outstanding until replacement acceptance or cancellation. Partial receipts leave the purchase incoming.
4. Receipt history records quantities, rejects, bins, and customer-order allocations. Replaying the same approval cannot add stock twice; stale revisions must be refreshed.

For special materials, create the customer shipment draft first, then select it in **Allocate to customer order** on a purchase at the same site. Purchase lines must belong to that customer order. Marking ordered changes the shipment to **awaiting materials**. Accepted units needed by that order are immediately held for it; once all lines are reserved, the shipment becomes **held** and can be staged. Excess units, or units received after the customer order is cancelled/completed, go to available general inventory. Management can cancel/release an open shipment without erasing purchase receipts.

Only catalog materials can be ordered. Create a new special part in Inventory first. Purchase/receiving records track unit quantities and references, not supplier invoices, landed costs, tax, accounting entries, or automatic unit conversions.

## Supply Permissions

Administrators, managers, and estimators can purchase, approve counted receipts, and manage shipping. The **Purchasing** role can prepare/mark/cancel purchase orders, acknowledge warnings, and view costs, but cannot approve receipts or dispatch customer goods. The **Receiving** role can count/approve arrivals, stage/unstage orders, print tags, and receive transfers; it cannot place purchases, dispatch customer goods, or see costs. Both can read shipment snapshots and supply queues. Full customer-account editing remains limited to administrators, managers, and estimators.

## Transfers Between Sites

Create an order with type **Location transfer**, source site, different active receiving site, and material quantities. Hold and dispatch it like a delivery.

Dispatched goods are in transit: they are no longer source-site on-hand stock and are not yet destination-site on-hand stock. At the receiving site, choose **Receive transfer** after physically checking receipt. The full quantity is added exactly once. Replayed/stale actions are rejected, and a completed order cannot be received twice.

## Order States And Stock Effects

| State/action | Source on hand | Source held | Destination on hand |
| --- | --- | --- | --- |
| Create draft | Unchanged | Unchanged | Unchanged |
| Hold materials | Unchanged | Increased | Unchanged |
| Stage held goods | Unchanged | Reservation unchanged; shown as staged | Unchanged |
| Unstage goods | Unchanged | Reservation unchanged; shown as held | Unchanged |
| Cancel a held order | Unchanged | Released | Unchanged |
| Dispatch held order | Decreased | Released | Unchanged |
| Receive dispatched transfer | Unchanged | Unchanged | Increased |
| Confirm customer delivery | Unchanged | Unchanged | Not a company stock location |
| Approve accepted purchase receipt | Increased at receiving site | Increased only for needed special-order allocations | Receiving site is the stock location |
| Record rejected purchase quantity | Unchanged | Unchanged | Unchanged |

Draft, awaiting-materials, held, and staged orders can be cancelled; their existing reservations are released, not their physical stock. Dispatched or completed orders cannot be cancelled as though the goods never moved. Returns and corrections need a separately designed process; do not use a fake receipt or arbitrary count adjustment to disguise a physical discrepancy.

The Shipping location filter defaults to the employee's site and includes orders shipped from or received into that site. The dashboard counts follow the selected site. **Stock movement history** shows the latest 500 ledger events. Ledger records are not editable through the app.

## Supported Scope And Limits

This release supports whole-order/full-line outbound dispatch and transfer receipt, plus partial counted **purchase** receipts and rejects. Partial outbound shipments/transfer receipts, returns/RMAs, multi-stop routes, carrier API synchronization, purchased shipping labels, freight rates, customs, invoicing, payment processing, and accounting COGS remain unimplemented. Scheduled dates are recorded, not automatically dispatched or released. Yard positions are free-text order locations, not a capacity-controlled map, lot/serial system, or per-bundle label scheme.

Role checks and database row-level security protect the operational data. Location defaults are not per-location authorization boundaries. Granular location-specific write permissions, purchase spending limits, and independent two-person approval policies remain to be defined with management.

## Verification And Deployment

Migration `202610200002_inventory_operations.sql` adds locations, balances, customers, shipment lines, and movement history, preserving existing stock at `MAIN`. The authenticated `workspace-api` routes and local development API use the same state rules. The hosted smoke test creates and removes isolated temporary sites, customers, inventory, shipments, profiles, and ledger entries; it does not create real business records or permanent administrators.

The new migration extends those records with staging, customer snapshots, purchase orders, counted receipts, and warning episodes without replacing existing stock. Automated PostgreSQL and local API tests cover physical stock, role checks, special allocations, receipt replay, partial acceptance/rejects, and warning recovery. The browser supply workflow checks printable PDF output, print-only visibility, staged quantities, manual ordering, explicit count approval, replay protection, and mobile layout. Deploy the matching frontend and backend together; local verification is not proof that the hosted release has been deployed.