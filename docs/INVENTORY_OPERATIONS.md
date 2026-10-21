# Locations, Customers, And Shipping

## Inventory Locations

Administrators manage sites in **Admin → Locations**. Each site has a stable code, display name, address, phone number, and active status. Codes cannot be renamed through the UI because staff, balances, and movement history reference them. Rename the display name instead.

Existing inventory is preserved in the automatically created **Primary location** (`MAIN`). Rename it to your actual initial facility before adding other sites. No stock is duplicated across new sites. A location cannot be deactivated while it has active employees, stock, holds, or open shipments.

Managed sites are different from storage-bin details. A part can be stocked at multiple sites, each with its own on-hand count, reorder point, and bin. The part description, category, unit, supplier, and unit cost are shared catalog values. This release does not implement lot-specific or location-specific purchase costing, accounting COGS, FIFO/LIFO, or automatic unit conversion.

## Employee Work Location

In **Admin → People & access**, create or edit a user and choose **Work location**. New and existing users default to `MAIN` until management assigns another active site. After signing in, employees see their assigned site's inventory by default.

The Inventory location selector can show another site or **All locations**. This is a default-view feature, not a restriction preventing staff from reading other sites. Combined totals are read-only for count edits and imports; select a specific site before changing stock. Viewer/technician cost restrictions still apply.

An administrator who changes their own location should sign out and back in to test the default. A different employee's new assignment takes effect on their next sign-in.

## Counts And Imports

- **On hand** is physical stock at the selected site, including held materials.
- **Held** is stock reserved by delivery/transfer orders.
- **Available** is on hand minus held.
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
5. Enter carrier/tracking details as needed and **Dispatch shipment**. Stock and the associated hold are removed from the source in one transaction.
6. **Confirm delivered** records completion. It does not remove stock a second time.

Ship-to addresses and material descriptions/units are snapshots. Editing a customer address or catalog description later does not silently rewrite an existing delivery's saved address or material list. A downloadable text packing list is available from the order; it is not a carrier label or tax invoice.

## Transfers Between Sites

Create an order with type **Location transfer**, source site, different active receiving site, and material quantities. Hold and dispatch it like a delivery.

Dispatched goods are in transit: they are no longer source-site on-hand stock and are not yet destination-site on-hand stock. At the receiving site, choose **Receive transfer** after physically checking receipt. The full quantity is added exactly once. Replayed/stale actions are rejected, and a completed order cannot be received twice.

## Order States And Stock Effects

| State/action | Source on hand | Source held | Destination on hand |
| --- | --- | --- | --- |
| Create draft | Unchanged | Unchanged | Unchanged |
| Hold materials | Unchanged | Increased | Unchanged |
| Cancel a held order | Unchanged | Released | Unchanged |
| Dispatch held order | Decreased | Released | Unchanged |
| Receive dispatched transfer | Unchanged | Unchanged | Increased |
| Confirm customer delivery | Unchanged | Unchanged | Not a company stock location |

Draft/held orders can be cancelled. Dispatched or completed orders cannot be cancelled as though the goods never moved. Returns and corrections need a separately designed process; do not use a fake receipt or arbitrary count adjustment to disguise a physical discrepancy.

The Shipping location filter defaults to the employee's site and includes orders shipped from or received into that site. The dashboard counts follow the selected site. **Stock movement history** shows the latest 500 ledger events. Ledger records are not editable through the app.

## Supported Scope And Limits

This release supports whole-order/full-line reservations, dispatch, customer-delivery completion, and transfer receipt. It does not yet implement partial shipments/receipts, damaged/short receipts, returns/RMAs, multi-stop routes, carrier API synchronization, purchased shipping labels, automatic freight rates, customs, invoicing, payment processing, purchasing/receiving POs, or accounting COGS. Scheduled dates are recorded, not automatically dispatched or released. Carrier/tracking values are manual records, not live tracking integrations.

Role checks and database row-level security protect the operational data. Location defaults are not per-location authorization boundaries. Further granular location-specific write permissions, dedicated warehouse roles, and approval workflows should be defined with management before expanding that policy.

## Verification And Deployment

Migration `202610200002_inventory_operations.sql` adds locations, balances, customers, shipment lines, and movement history, preserving existing stock at `MAIN`. The authenticated `workspace-api` routes and local development API use the same state rules. The hosted smoke test creates and removes isolated temporary sites, customers, inventory, shipments, profiles, and ledger entries; it does not create real business records or permanent administrators.

Verification for this release: 26 automated tests, 7 desktop/mobile browser workflows, production build, Deno function validation, zero dependency audit findings, and hosted operations smoke checks. Deploy the matching frontend and backend together; after the frontend release, refresh the AWS site to see the new navigation.