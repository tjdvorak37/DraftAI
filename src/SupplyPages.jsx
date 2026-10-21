import { useEffect, useState } from "react";
import {
  Bell,
  Check,
  ClipboardCheck,
  Package,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
  X,
} from "lucide-react";
import { api } from "./client.js";
import { Modal, IconButton } from "./ui.jsx";
import { purchasingRoles, receivingRoles } from "../shared/purchasing.js";

const number = (value) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(
    value || 0,
  );
function PurchaseForm({
  locations,
  parts,
  shipments,
  site,
  initial,
  onClose,
  onSaved,
}) {
  const [lines, setLines] = useState(
    initial
      ? [{ partId: initial.id, quantity: Math.max(initial.suggested, 1) }]
      : [{ partId: "", quantity: 1 }],
  );
  const [location, setLocation] = useState(
    initial?.location_id || (site === "all" ? "MAIN" : site),
  );
  const [linked, setLinked] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/purchases", {
        requestKey,
        supplier: form.get("supplier"),
        supplierReference: form.get("supplierReference"),
        locationId: location,
        linkedOrderId: linked || null,
        expectedDate: form.get("expectedDate"),
        notes: form.get("notes"),
        lines: lines.map((line) => ({
          ...line,
          quantity: Number(line.quantity),
        })),
      });
      await onSaved();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title="Prepare purchase order"
      subtitle="Saving creates a draft. Mark it ordered after placing the supplier order."
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={save}>
        <div className="form-grid">
          <label>
            Supplier
            <input
              name="supplier"
              required
              maxLength={160}
              defaultValue={initial?.supplier || ""}
            />
          </label>
          <label>
            Supplier / PO reference
            <input name="supplierReference" maxLength={120} />
          </label>
          <label>
            Receiving location
            <select
              aria-label="Purchase receiving location"
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
                setLinked("");
              }}
            >
              {locations
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Expected arrival
            <input name="expectedDate" type="date" />
          </label>
        </div>
        <label>
          Allocate to customer order
          <select
            aria-label="Purchase customer order"
            value={linked}
            onChange={(event) => setLinked(event.target.value)}
          >
            <option value="">General inventory replenishment</option>
            {shipments
              .filter(
                (order) =>
                  order.kind === "customer" &&
                  order.source_location === location &&
                  ["draft", "awaiting_materials"].includes(order.status),
              )
              .map((order) => (
                <option key={order.id} value={order.id}>
                  {order.reference || order.id.slice(0, 8)} -{" "}
                  {order.customer_name}
                </option>
              ))}
          </select>
        </label>
        <p className="muted">
          Accepted special-order materials are held for that open customer
          order. Remaining or unallocated material stays available in inventory.
        </p>
        <div className="section-title-row compact-section">
          <h3>Materials to order</h3>
          <button
            className="button compact"
            type="button"
            onClick={() =>
              setLines((current) => [...current, { partId: "", quantity: 1 }])
            }
            disabled={lines.length >= 100}
          >
            <Plus size={13} /> Add material
          </button>
        </div>
        {lines.map((line, index) => (
          <div className="shipment-line" key={index}>
            <label>
              Part
              <select
                aria-label={`Purchase part ${index + 1}`}
                required
                value={line.partId}
                onChange={(event) =>
                  setLines((current) =>
                    current.map((item, position) =>
                      position === index
                        ? { ...item, partId: event.target.value }
                        : item,
                    ),
                  )
                }
              >
                <option value="">Choose catalog material</option>
                {parts.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.id} - {part.name} ({part.unit})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input
                aria-label={`Purchase quantity ${index + 1}`}
                type="number"
                step="any"
                min="0.001"
                required
                value={line.quantity}
                onChange={(event) =>
                  setLines((current) =>
                    current.map((item, position) =>
                      position === index
                        ? { ...item, quantity: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <IconButton
              icon={X}
              label={`Remove purchase line ${index + 1}`}
              type="button"
              disabled={lines.length === 1}
              onClick={() =>
                setLines((current) =>
                  current.filter((item, position) => position !== index),
                )
              }
            />
          </div>
        ))}
        <label>
          Purchase notes
          <textarea name="notes" rows={3} maxLength={5000} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          <ShoppingCart size={15} /> Save purchase draft
        </button>
      </form>
    </Modal>
  );
}
function CountReceipt({ order, onClose, onSaved }) {
  const [lines, setLines] = useState(
    order.lines
      .filter((line) => line.received < line.quantity)
      .map((line) => ({
        partId: line.part_id,
        accepted: "",
        rejected: 0,
        bin: "",
      })),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function change(index, field, value) {
    setLines((current) =>
      current.map((item, position) =>
        position === index ? { ...item, [field]: value } : item,
      ),
    );
    setConfirmed(false);
  }
  async function approve(event) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api(`/purchases/${order.id}/receive`, {
        requestKey,
        revision: order.revision,
        deliveryReference: form.get("deliveryReference"),
        notes: form.get("notes"),
        lines: lines.map((line) => ({
          ...line,
          accepted: line.accepted === "" ? 0 : Number(line.accepted),
          rejected: Number(line.rejected || 0),
        })),
      });
      await onSaved();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title="Count and approve received materials"
      subtitle={`${order.supplier} - ${order.supplier_reference || order.id.slice(0, 8)} - receiving at ${order.location_id}`}
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={approve}>
        <label>
          Delivery / packing slip reference
          <input name="deliveryReference" maxLength={120} />
        </label>
        <div className="table-scroll">
          <table className="inventory-table receipt-count-table">
            <thead>
              <tr>
                <th>MATERIAL / OUTSTANDING</th>
                <th>ACCEPTED</th>
                <th>REJECTED</th>
                <th>BIN / YARD</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const original = order.lines.find(
                  (item) => item.part_id === line.partId,
                );
                return (
                  <tr key={line.partId}>
                    <td>
                      <strong>{original.description}</strong>
                      <small>
                        {line.partId} -{" "}
                        {number(original.quantity - original.received)}{" "}
                        {original.unit} due
                      </small>
                    </td>
                    <td>
                      <input
                        aria-label={`Accepted ${line.partId}`}
                        type="number"
                        min="0"
                        step="any"
                        max={original.quantity - original.received}
                        value={line.accepted}
                        onChange={(event) =>
                          change(index, "accepted", event.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Rejected ${line.partId}`}
                        type="number"
                        min="0"
                        step="any"
                        value={line.rejected}
                        onChange={(event) =>
                          change(index, "rejected", event.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Receiving bin ${line.partId}`}
                        maxLength={160}
                        value={line.bin}
                        onChange={(event) =>
                          change(index, "bin", event.target.value)
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="notice">
          <ClipboardCheck size={19} />
          <p>
            Enter quantities physically counted, not the expected quantity. Only
            accepted material enters stock. Rejected material is recorded, not
            stocked, and remains outstanding until a replacement is accepted or
            the purchase remainder is cancelled.
          </p>
        </div>
        {order.linked_order_id && (
          <p className="muted">
            Linked customer order: {order.linked_order_id}. Needed accepted
            units will be reserved automatically if the order is still open;
            completed/cancelled orders receive no new allocation.
          </p>
        )}
        <label>
          Receiving / discrepancy notes
          <textarea name="notes" rows={3} maxLength={5000} />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            aria-label="Approve counted materials"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{" "}
          I counted and approve these accepted quantities.
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={!confirmed || busy}>
          <Check size={15} /> Approve and add to inventory
        </button>
      </form>
    </Modal>
  );
}
function PurchaseDetail({ order, user, onClose, onChanged, onReceive }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canBuy = purchasingRoles.includes(user.role);
  const canReceive = receivingRoles.includes(user.role);
  async function act(action) {
    if (
      !confirm(
        action === "order"
          ? "Confirm this order has been placed with the supplier?"
          : "Cancel the outstanding purchase remainder? Accepted stock will remain.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/purchases/${order.id}/action`, {
        action,
        revision: order.revision,
      });
      await onChanged();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={order.supplier_reference || `Purchase ${order.id.slice(0, 8)}`}
      subtitle={`${order.supplier} - ${order.location_id} - ${order.status.replaceAll("_", " ")}`}
      onClose={onClose}
    >
      <div className="form-stack">
        <p className="muted">
          Expected: {order.expected_date || "Not set"}
          {order.linked_order_id
            ? ` - Special order for ${order.linked_order_id}`
            : ""}
        </p>
        <div className="table-scroll">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>MATERIAL</th>
                <th>ORDERED</th>
                <th>ACCEPTED</th>
                <th>OUTSTANDING</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.part_id}>
                  <td>
                    <strong>{line.description}</strong>
                    <small>
                      {line.part_id} - {line.unit}
                    </small>
                  </td>
                  <td>{number(line.quantity)}</td>
                  <td>{number(line.received)}</td>
                  <td>{number(line.quantity - line.received)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {order.notes && <p className="muted preserve-lines">{order.notes}</p>}
        {order.receipts.length > 0 && (
          <div className="receipt-history">
            <h3>Receipt history</h3>
            {order.receipts.map((receipt) => (
              <article key={receipt.id}>
                <strong>
                  {receipt.delivery_reference || "Counted delivery"} -{" "}
                  {new Date(receipt.created).toLocaleString()}
                </strong>
                {receipt.lines.map((line) => (
                  <p key={line.part_id}>
                    {line.part_id}: accepted {number(line.accepted)}, rejected{" "}
                    {number(line.rejected)}, held for order{" "}
                    {number(line.allocated)}
                    {line.bin ? ` - ${line.bin}` : ""}
                  </p>
                ))}
                {receipt.notes && <p>{receipt.notes}</p>}
              </article>
            ))}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="button-group wrap">
          {canBuy && order.status === "draft" && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => act("order")}
            >
              <Send size={15} /> Mark as ordered
            </button>
          )}
          {canReceive &&
            ["ordered", "partially_received"].includes(order.status) && (
              <button className="button primary" onClick={onReceive}>
                <ClipboardCheck size={15} /> Count received materials
              </button>
            )}
          {canBuy &&
            ["draft", "ordered", "partially_received"].includes(
              order.status,
            ) && (
              <button
                className="button"
                disabled={busy}
                onClick={() => act("cancel")}
              >
                Cancel outstanding
              </button>
            )}
        </div>
      </div>
    </Modal>
  );
}
export default function SupplyPages({ user, mode, notify, onStockChanged }) {
  const [orders, setOrders] = useState([]);
  const [board, setBoard] = useState([]);
  const [locations, setLocations] = useState([]);
  const [parts, setParts] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [site, setSite] = useState(user.locationId || "MAIN");
  const [view, setView] = useState(mode === "receiving" ? "incoming" : "needs");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [receiving, setReceiving] = useState(null);
  const [error, setError] = useState("");
  const canBuy = purchasingRoles.includes(user.role);
  async function load() {
    const [purchases, needs, sites, catalog, shipping] = await Promise.all([
      api("/purchases"),
      api(`/ordering-board?location=${encodeURIComponent(site)}`),
      api("/locations"),
      api("/inventory?location=all"),
      api("/shipments"),
    ]);
    setOrders(purchases);
    setBoard(needs);
    setLocations(sites);
    setParts(catalog);
    setShipments(shipping);
    setError("");
  }
  useEffect(() => {
    load().catch((error) => setError(error.message));
  }, [site, mode]);
  const filtered = orders.filter(
    (order) =>
      (site === "all" || order.location_id === site) &&
      `${order.supplier} ${order.supplier_reference} ${order.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visible = filtered.filter((order) =>
    view === "drafts"
      ? order.status === "draft"
      : view === "incoming"
        ? ["ordered", "partially_received"].includes(order.status)
        : view === "history"
          ? ["received", "cancelled"].includes(order.status)
          : true,
  );
  const current = orders.find((order) => order.id === selected);
  const counted = orders.find((order) => order.id === receiving);
  return (
    <main className="management-page supply-page">
      <div className="page-eyebrow">
        WORKSPACE / {mode === "receiving" ? "RECEIVING" : "ORDERING"}
      </div>
      <div className="page-title">
        <div>
          <h1>{mode === "receiving" ? "Receiving queue" : "Ordering board"}</h1>
          <p>
            {mode === "receiving"
              ? "Count arrivals, record discrepancies, and approve stock once."
              : "Review stock warnings, prepare orders, and track what is incoming."}
          </p>
        </div>
        <div className="button-group">
          <IconButton
            icon={RefreshCw}
            label="Refresh supply queues"
            onClick={() => load().catch((error) => setError(error.message))}
          />
          {canBuy && (
            <button className="button primary" onClick={() => setEditing({})}>
              <Plus size={15} /> New purchase
            </button>
          )}
        </div>
      </div>
      <div className="supply-summary">
        <span>
          <Bell size={15} />
          {board.filter((row) => !row.acknowledged).length} unacknowledged
          low-stock warnings
        </span>
        <span>
          {
            filtered.filter((order) =>
              ["ordered", "partially_received"].includes(order.status),
            ).length
          }{" "}
          incoming purchases
        </span>
      </div>
      <div className="management-tabs">
        {[
          ...(mode === "ordering"
            ? [
                ["needs", "Needs ordering"],
                ["drafts", "Purchase drafts"],
              ]
            : []),
          ["incoming", "Ordered / incoming"],
          ["history", "Completed / cancelled"],
        ].map(([id, label]) => (
          <button
            className={view === id ? "selected" : ""}
            key={id}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="table-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search supply orders"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search part, supplier, or purchase reference..."
          />
        </div>
        <select
          aria-label="Supply location"
          value={site}
          onChange={(event) => setSite(event.target.value)}
        >
          <option value="all">All sites</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-scroll">
        {view === "needs" ? (
          <table className="inventory-table">
            <thead>
              <tr>
                <th>MATERIAL / SITE</th>
                <th>AVAILABLE</th>
                <th>MINIMUM</th>
                <th>ON ORDER</th>
                <th>NEEDS ORDERING</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {board
                .filter((row) =>
                  `${row.name} ${row.id} ${row.supplier}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((row) => (
                  <tr key={`${row.location_id}:${row.id}`}>
                    <td>
                      <strong>{row.name}</strong>
                      <small>
                        {row.id} - {row.location_id} -{" "}
                        {row.supplier || "No supplier set"}
                      </small>
                    </td>
                    <td>{number(row.available)}</td>
                    <td>{number(row.minimum)}</td>
                    <td>{number(row.incoming)}</td>
                    <td>
                      <strong>
                        {number(row.suggested)} {row.unit}
                      </strong>
                    </td>
                    <td>
                      <div className="button-group">
                        {canBuy && (
                          <button
                            className="button compact"
                            disabled={row.suggested <= 0}
                            onClick={() => setEditing(row)}
                          >
                            Prepare order
                          </button>
                        )}
                        {canBuy && !row.acknowledged && (
                          <button
                            className="button compact"
                            onClick={async () => {
                              try {
                                await api(
                                  `/stock-alerts/${row.alert_id}/acknowledge`,
                                  { episode: row.episode },
                                );
                                await load();
                              } catch (error) {
                                setError(error.message);
                              }
                            }}
                          >
                            Acknowledge
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <table className="inventory-table">
            <thead>
              <tr>
                <th>SUPPLIER / REFERENCE</th>
                <th>SITE</th>
                <th>STATUS</th>
                <th>EXPECTED</th>
                <th>OUTSTANDING</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.supplier}</strong>
                    <small>
                      {order.supplier_reference || order.id.slice(0, 8)}
                      {order.linked_order_id ? " - special order" : ""}
                    </small>
                  </td>
                  <td>{order.location_id}</td>
                  <td>
                    <span className="status-pill">
                      {order.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>{order.expected_date || "Not set"}</td>
                  <td>
                    {
                      order.lines.filter(
                        (line) => line.received < line.quantity,
                      ).length
                    }{" "}
                    material lines
                  </td>
                  <td>
                    <button
                      className="button compact"
                      onClick={() => setSelected(order.id)}
                    >
                      Open purchase
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(view === "needs" ? !board.length : !visible.length) && (
          <div className="empty-state">
            <Package size={32} />
            <h3>
              {view === "needs"
                ? "No materials below their reorder point."
                : "No purchases in this queue."}
            </h3>
          </div>
        )}
      </div>
      <p className="table-footnote">
        Low-stock warnings are in-app notifications based on available quantity
        and each site’s reorder point. Marking ordered records your supplier
        action; it does not send an order to the supplier. Receipts are unit
        quantities, not accounting cost postings.
      </p>
      {editing && (
        <PurchaseForm
          locations={locations}
          parts={parts}
          shipments={shipments}
          site={site}
          initial={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await load();
            setEditing(null);
            notify(
              "Purchase draft prepared. Mark it ordered after placing the supplier order.",
            );
          }}
        />
      )}
      {current && !counted && (
        <PurchaseDetail
          order={current}
          user={user}
          onClose={() => setSelected(null)}
          onChanged={load}
          onReceive={() => setReceiving(current.id)}
        />
      )}
      {counted && (
        <CountReceipt
          key={`${counted.id}-${counted.revision}`}
          order={counted}
          onClose={() => setReceiving(null)}
          onSaved={async () => {
            await load();
            await onStockChanged();
            setReceiving(null);
            notify("Count approved and accepted materials added to inventory.");
          }}
        />
      )}
    </main>
  );
}
