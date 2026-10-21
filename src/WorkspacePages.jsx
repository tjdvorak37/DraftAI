import { useEffect, useState } from "react";
import UserProfileForm, { UserProfileFields } from './UserProfileForm.jsx';
import { LocationsPanel } from './OperationsPages.jsx';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FilePlus2,
  FolderOpen,
  LifeBuoy,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { api } from "./client.js";
import { IconButton, Modal } from "./ui.jsx";
import {
  roles,
  designRoles,
  projectRoles,
  supportRoles,
  projectStatuses,
  ticketStatuses,
  ticketPriorities,
} from "../shared/access.js";
import { defaultBuilding, buildingSchema } from "../shared/model.js";

const date = (value) =>
  value
    ? new Date(
        value.length === 10 ? `${value}T12:00:00` : value,
      ).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not set";
const formatNumber = (value) => new Intl.NumberFormat("en-US").format(value);
const messageOf = (error) =>
  error.message || "Unable to complete this request.";
const roleDescriptions = {
  admin: "Full workspace administration",
  manager: "Project portfolio, designs & costs",
  engineer: "Building designs & projects",
  estimator: "Inventory & costs",
  purchasing: "Purchasing, incoming orders & costs",
  receiving: "Count arrivals, approve stock & stage orders",
  technician: "Support queue & ticket assignment",
  viewer: "Read-only projects; no costs",
};

function SignInState({ title, onSignIn }) {
  return (
    <div className="projects-empty">
      <LockKeyhole size={36} strokeWidth={1.2} />
      <h2>{title}</h2>
      <p>Sign in with your workspace account to continue.</p>
      <button className="button primary" onClick={onSignIn}>
        Sign in <ArrowRight size={15} />
      </button>
    </div>
  );
}

function PageHeading({ eyebrow, title, subtitle, children }) {
  return (
    <>
      <div className="page-eyebrow">WORKSPACE / {eyebrow}</div>
      <div className="page-title">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="button-group">{children}</div>
      </div>
    </>
  );
}

function RoleSelect({ ...props }) {
  return (
    <select
      aria-label={props.name === "role" ? "Workspace role" : undefined}
      {...props}
    >
      {roles.map((role) => (
        <option key={role} value={role}>
          {role[0].toUpperCase() + role.slice(1)} · {roleDescriptions[role]}
        </option>
      ))}
    </select>
  );
}

function TeamMember({ member, selfId, onSaved, notify, onEdit }) {
  const [role, setRole] = useState(member.role);
  const [disabled, setDisabled] = useState(member.disabled);
  const [busy, setBusy] = useState(false);
  const self = member.id === selfId;
  const dirty = role !== member.role || disabled !== member.disabled;
  async function save() {
    setBusy(true);
    try {
      await api(`/users/${member.id}/access`, { role, disabled });
      await onSaved();
      notify("Account access updated. Existing sessions were revoked.");
    } catch (error) {
      notify(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <tr>
      <td>
        <strong>
          {member.name}
          {self && <span className="self-label">you</span>}
        </strong>
        <small>{member.email}</small>
      </td>
      <td>
        <RoleSelect
          aria-label={`Role for ${member.name}`}
          value={role}
          onChange={(event) => setRole(event.target.value)}
          disabled={self || busy}
        />
      </td>
      <td>
        <span className={`status-pill ${member.twoFactor ? "success" : ""}`}>
          {member.twoFactor ? "Enabled" : "Not enabled"}
        </span>
      </td>
      <td>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={!disabled}
            onChange={(event) => setDisabled(!event.target.checked)}
            disabled={self || busy}
            aria-label={`Account active for ${member.name}`}
          />{" "}
          Active
        </label>
      </td>
      <td>
        <button className="button compact" onClick={() => onEdit(member)} aria-label={`Edit profile for ${member.name}`}>Profile</button>{" "}
        <button
          className="button compact"
          disabled={!dirty || busy || self}
          onClick={save}
        >
          <Save size={13} /> Save
        </button>
      </td>
    </tr>
  );
}

export function AdminCenter({
  user,
  notify,
  onWorkspaceChange,
  onSecurity,
  onSupport,
  onSignIn,
  onLocationsChanged,
}) {
  const [section, setSection] = useState("overview");
  const [data, setData] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [integrationKey, setIntegrationKey] = useState("");
  const [connectionResult, setConnectionResult] = useState("");
  async function load() {
    try {
      const [settings, users] = await Promise.all([
        api("/admin"),
        api("/users"),
      ]);
      setData(settings);
      setMembers(users);
      setError("");
    } catch (error) {
      setError(messageOf(error));
    }
  }
  useEffect(() => {
    if (user?.role === "admin") load();
  }, [user?.id, user?.role]);
  async function run(operation) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  async function saveGeneral(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await run(async () => {
      const settings = await api("/admin/settings", values);
      onWorkspaceChange(settings);
      await load();
      notify("Workspace settings saved.");
    });
  }
  async function createMember(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await run(async () => {
      await api("/users", values);
      await load();
      setInvite(false);
      notify(
        "Team member created. Share the initial password through a secure channel.",
      );
    });
  }
  async function saveIntegration(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await run(async () => {
      const result = await api("/admin/integrations/openai", {
        model: values.get("model"),
        enabled: values.has("enabled"),
        ...(integrationKey ? { apiKey: integrationKey } : {}),
      });
      setIntegrationKey("");
      setConnectionResult("");
      onWorkspaceChange({ aiConnected: result.aiConnected });
      await load();
      notify("OpenAI integration settings saved.");
    });
  }
  return (
    <main className="management-page admin-center">
      <PageHeading
        eyebrow="ADMINISTRATION"
        title="Admin Center"
        subtitle="Workspace settings, people, connections, and accountability."
      >
        <button className="button" onClick={onSecurity}>
          <ShieldCheck size={15} /> My security
        </button>
        <IconButton
          icon={RefreshCw}
          label="Refresh administration"
          onClick={load}
          disabled={user?.role !== "admin"}
        />
      </PageHeading>
      {!user ? (
        <SignInState
          title="Your workspace, under control."
          onSignIn={onSignIn}
        />
      ) : user.role !== "admin" ? (
        <div className="notice">
          <LockKeyhole size={22} />
          <p>
            <strong>Administrator access required.</strong>Your current role is{" "}
            {user.role}. Ask a workspace administrator to update your access.
          </p>
        </div>
      ) : (
        <>
          <div
            className="management-tabs"
            role="tablist"
            aria-label="Administration sections"
          >
            {[
              { id: "overview", icon: Settings2, name: "Workspace" },
              { id: "people", icon: Users, name: "People & access" },
              { id: "locations", icon: Box, name: "Locations" },
              { id: "integrations", icon: Plug, name: "Integrations" },
              { id: "activity", icon: Activity, name: "Activity log" },
            ].map(({ id, icon: Icon, name }) => (
              <button
                role="tab"
                aria-selected={section === id}
                key={id}
                className={section === id ? "selected" : ""}
                onClick={() => {
                  setSection(id);
                  setError("");
                }}
              >
                <Icon size={16} />
                {name}
              </button>
            ))}
          </div>
          {error && (
            <p className="form-error page-error" role="alert">
              {error}
            </p>
          )}
          {!data ? (
            <div className="loading-state">
              <LoaderCircle size={20} className="spin" /> Loading workspace…
            </div>
          ) : (
            <>
              {section === 'locations' && <LocationsPanel notify={notify} onChanged={onLocationsChanged} />}
              {section === "overview" && (
                <>
                  <div className="inventory-metrics admin-metrics">
                    <div>
                      <span>Active people</span>
                      <strong>
                        {data.counts.users}
                        <small>across {roles.length} access roles</small>
                      </strong>
                    </div>
                    <div>
                      <span>Saved projects</span>
                      <strong>
                        {data.counts.projects}
                        <small>shared project portfolio</small>
                      </strong>
                    </div>
                    <div>
                      <span>Unresolved support</span>
                      <strong>
                        {data.counts.tickets}
                        <small>
                          <button className="inline-link" onClick={onSupport}>
                            Open support queue <ArrowUpRight size={11} />
                          </button>
                        </small>
                      </strong>
                    </div>
                    <div>
                      <span>Connected AI</span>
                      <strong className="metric-text">
                        {data.aiConnected ? "Configured" : "Not configured"}
                        <small>OpenAI design integration</small>
                      </strong>
                    </div>
                  </div>
                  <div className="settings-layout">
                    <section className="settings-section">
                      <h2>Workspace identity</h2>
                      <form
                        key={`${data.name}-${data.supportEmail}`}
                        className="form-stack"
                        onSubmit={saveGeneral}
                      >
                        <label>
                          Workspace name
                          <input
                            name="name"
                            required
                            minLength={2}
                            maxLength={80}
                            defaultValue={data.name}
                          />
                        </label>
                        <label>
                          Support email
                          <input
                            name="supportEmail"
                            type="email"
                            defaultValue={data.supportEmail}
                            placeholder="support@accusteel.com"
                          />
                        </label>
                        <div>
                          <button className="button primary" disabled={busy}>
                            <Save size={15} /> Save settings
                          </button>
                        </div>
                      </form>
                    </section>
                    <section className="settings-section security-summary">
                      <h2>Security posture</h2>
                      <div>
                        <ShieldCheck size={20} />
                        <span>
                          Two-factor enabled
                          <strong>
                            {
                              members.filter(
                                (member) =>
                                  member.twoFactor && !member.disabled,
                              ).length
                            }{" "}
                            /{" "}
                            {
                              members.filter((member) => !member.disabled)
                                .length
                            }{" "}
                            active accounts
                          </strong>
                        </span>
                      </div>
                      <div>
                        <Users size={20} />
                        <span>
                          Access changes
                          <strong>
                            Sessions revoked on role change or disable
                          </strong>
                        </span>
                      </div>
                      <div>
                        <LockKeyhole size={20} />
                        <span>
                          Two-factor policy
                          <strong>
                            Optional per account · not enforced globally
                          </strong>
                        </span>
                      </div>
                      <p className="muted">
                        Password recovery, SSO, and enforced MFA require a
                        production identity integration.
                      </p>
                    </section>
                  </div>
                </>
              )}
              {section === "people" && (
                <>
                  <div className="section-title-row">
                    <div>
                      <h2>People & permissions</h2>
                      <p>
                        {members.length} accounts · disabled accounts cannot
                        sign in
                      </p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => {
                        setInvite(true);
                        setError("");
                      }}
                    >
                      <Plus size={15} /> Add member
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table className="inventory-table people-table">
                      <thead>
                        <tr>
                          <th>PERSON</th>
                          <th>WORKSPACE ROLE</th>
                          <th>TWO-FACTOR</th>
                          <th>ACCOUNT</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((member) => (
                          <TeamMember
                            key={`${member.id}-${member.role}-${member.disabled}`}
                            member={member}
                            selfId={user.id}
                            onSaved={load}
                            notify={notify}
                            onEdit={setEditingUser}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="permission-legend">
                    {roles.map((role) => (
                      <div key={role}>
                        <strong>{role}</strong>
                        <span>{roleDescriptions[role]}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {section === "integrations" && (
                <div className="settings-layout integrations-layout">
                  <section className="settings-section">
                    <div className="section-title-row">
                      <div className="integration-title">
                        <span className="integration-symbol">
                          <Sparkles size={23} />
                        </span>
                        <div>
                          <h2>OpenAI</h2>
                          <p>Design conversation provider</p>
                        </div>
                      </div>
                      <span
                        className={`status-pill ${data.aiConnected ? "success" : ""}`}
                      >
                        {data.aiConnected ? "Configured" : "Not connected"}
                      </span>
                    </div>
                    <form
                      key={`${data.integrations.openai.model}-${data.integrations.openai.enabled}`}
                      className="form-stack"
                      onSubmit={saveIntegration}
                    >
                      <label>
                        API key
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={integrationKey}
                          onChange={(event) =>
                            setIntegrationKey(event.target.value)
                          }
                          placeholder={
                            data.integrations.openai.configured
                              ? "Key stored securely · leave blank to keep"
                              : "Enter your OpenAI API key"
                          }
                          minLength={10}
                          maxLength={500}
                        />
                      </label>
                      <label>
                        Model
                        <input
                          name="model"
                          required
                          pattern="[a-zA-Z0-9._:-]{1,100}"
                          defaultValue={data.integrations.openai.model}
                        />
                      </label>
                      <label className="checkbox-label">
                        <input
                          name="enabled"
                          type="checkbox"
                          defaultChecked={data.integrations.openai.enabled}
                        />{" "}
                        Enable AI design requests
                      </label>
                      <p className="muted">
                        Key source: {data.integrations.openai.source}. Keys are
                        encrypted on the server and never returned to the
                        browser. Design prompts are sent to OpenAI; provider
                        charges apply.
                      </p>
                      <div className="button-group wrap">
                        <button className="button primary" disabled={busy}>
                          <Save size={14} /> Save connection
                        </button>
                        <button
                          type="button"
                          className="button"
                          disabled={busy || !data.aiConnected}
                          onClick={() =>
                            run(async () => {
                              const result = await api(
                                "/admin/integrations/openai/test",
                                {},
                              );
                              setConnectionResult(result.message);
                            })
                          }
                        >
                          <Plug size={14} /> Test connection
                        </button>
                        {data.integrations.openai.source === "workspace" && (
                          <button
                            type="button"
                            className="button danger-text"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  "Remove the stored OpenAI key and disable AI requests?",
                                )
                              )
                                run(async () => {
                                  await api("/admin/integrations/openai", {
                                    model: data.integrations.openai.model,
                                    enabled: false,
                                    removeKey: true,
                                  });
                                  onWorkspaceChange({ aiConnected: false });
                                  setConnectionResult("");
                                  await load();
                                  notify(
                                    "Stored key removed; integration disabled.",
                                  );
                                });
                            }}
                          >
                            Remove stored key
                          </button>
                        )}
                      </div>
                      {connectionResult && (
                        <p className="connection-success" role="status">
                          <CheckCircle2 size={16} />
                          {connectionResult}
                        </p>
                      )}
                    </form>
                  </section>
                </div>
              )}
              {section === "activity" && (
                <>
                  <div className="section-title-row">
                    <div>
                      <h2>Workspace activity</h2>
                      <p>Most recent 60 recorded changes · UTC</p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="inventory-table activity-table">
                      <thead>
                        <tr>
                          <th>WHEN</th>
                          <th>PERSON</th>
                          <th>ACTION</th>
                          <th>DETAIL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.audit.map((event) => (
                          <tr key={event.id}>
                            <td>{event.created}</td>
                            <td>{event.actor_name || "System"}</td>
                            <td>
                              <code>{event.action}</code>
                            </td>
                            <td>
                              <code>{event.detail}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.audit.length && (
                      <div className="empty-state">
                        <Activity size={25} />
                        <h3>No recorded changes yet.</h3>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
          {invite && (
            <Modal
              title="Add team member"
              subtitle="Choose the access this person needs."
              onClose={() => setInvite(false)}
            >
              <form className="form-stack" onSubmit={createMember}>
                <label>
                  Full name
                  <input name="name" minLength={2} maxLength={80} required />
                </label>
                <label>
                  Work email
                  <input name="email" type="email" required />
                </label>
                <label>
                  Initial password
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={72}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <label>
                  Workspace role
                  <RoleSelect name="role" defaultValue="engineer" />
                </label>
                <UserProfileFields />
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="button primary" disabled={busy}>
                  <Plus size={15} /> Create account
                </button>
              </form>
            </Modal>
          )}
          {editingUser && <UserProfileForm user={editingUser} onClose={() => setEditingUser(null)} onSaved={async result => { setEditingUser(null); if (result.requiresSignIn) { window.dispatchEvent(new Event('studio:unauthorized')); return; } await load(); notify('User profile updated.'); }} />}
        </>
      )}
    </main>
  );
}

function ProjectDetailsDialog({ project, owners, onClose, onSaved }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/projects/${project.id}/details`, {
        ...values,
        owner: values.owner ? /^\d+$/.test(values.owner) ? Number(values.owner) : values.owner : null,
        revision: project.revision,
      });
      await onSaved();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Project details"
      subtitle={`AS-${String(project.id).padStart(4, "0")} · ${project.name}`}
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={save}>
        <label>
          Client / organization
          <input
            name="client"
            maxLength={120}
            defaultValue={project.client}
            placeholder="Customer or internal project"
          />
        </label>
        <label>
          Site location
          <input
            name="location"
            maxLength={200}
            defaultValue={project.location}
            placeholder="City, state or jobsite address"
          />
        </label>
        <div className="form-grid">
          <label>
            Project status
            <select aria-label="Project status" name="status" defaultValue={project.status}>
              {projectStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            Target date
            <input
              name="due_date"
              type="date"
              defaultValue={project.due_date}
            />
          </label>
        </div>
        <label>
          Project owner
          <select aria-label="Project owner" name="owner" defaultValue={project.owner ?? ""}>
            <option value="">Unassigned</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name} · {owner.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project notes
          <textarea
            name="notes"
            rows={4}
            maxLength={5000}
            defaultValue={project.notes}
            placeholder="Scope, coordination notes, and next steps"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          <Save size={15} /> Save project details
        </button>
      </form>
    </Modal>
  );
}

function CreateProjectDialog({ onClose, onCreated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const building = buildingSchema.parse({
        ...defaultBuilding,
        name: values.name,
        width: Number(values.width),
        length: Number(values.length),
      });
      const result = await api("/projects", { building });
      await onCreated(result.id);
    } catch (error) {
      setError(error.issues?.[0]?.message || messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Create project"
      subtitle="Start a saved project without leaving the project center."
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={submit}>
        <label>
          Project name
          <input
            name="name"
            minLength={1}
            maxLength={100}
            required
            placeholder="North site equipment storage"
          />
        </label>
        <div className="form-grid">
          <label>
            Building width (ft)
            <input
              name="width"
              type="number"
              min={20}
              max={160}
              defaultValue={60}
              required
            />
          </label>
          <label>
            Building length (ft)
            <input
              name="length"
              type="number"
              min={24}
              max={400}
              defaultValue={96}
              required
            />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          <FilePlus2 size={15} /> Create project
        </button>
      </form>
    </Modal>
  );
}

export function ProjectCenter({
  user,
  projects,
  onReload,
  onOpen,
  onSignIn,
  notify,
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [owner, setOwner] = useState("All owners");
  const [owners, setOwners] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const canEdit = projectRoles.includes(user?.role);
  useEffect(() => {
    if (user)
      api("/project-owners")
        .then(setOwners)
        .catch((error) => setError(messageOf(error)));
  }, [user?.id]);
  const visible = projects.filter(
    (project) =>
      `${project.name} ${project.client} ${project.location} AS-${String(project.id).padStart(4, "0")}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "All statuses" || project.status === status) &&
      (owner === "All owners" || String(project.owner ?? "") === owner),
  );
  const active = projects.filter(
    (project) => !["Completed", "Archived"].includes(project.status),
  );
  const overdue = active.filter(
    (project) =>
      project.due_date &&
      project.due_date < new Date().toLocaleDateString("en-CA"),
  );
  async function refresh() {
    try {
      await onReload();
      setError("");
    } catch (error) {
      setError(messageOf(error));
    }
  }
  return (
    <main className="management-page project-center">
      <PageHeading
        eyebrow="PROJECT CENTER"
        title="Project Center"
        subtitle="A shared view of every building, owner, and next milestone."
      >
        <button className="button" onClick={refresh} disabled={!user}>
          <RefreshCw size={15} /> Refresh
        </button>
        <button
          className="button primary"
          onClick={() => (user ? setCreating(true) : onSignIn())}
          disabled={Boolean(user && !canEdit)}
        >
          <Plus size={17} /> New project
        </button>
      </PageHeading>
      {!user ? (
        <SignInState title="A place for all your plans." onSignIn={onSignIn} />
      ) : (
        <>
          {error && (
            <p className="form-error page-error" role="alert">
              {error}
            </p>
          )}
          <div className="inventory-metrics">
            <div>
              <span>Portfolio projects</span>
              <strong>
                {projects.length}
                <small>saved building designs</small>
              </strong>
            </div>
            <div>
              <span>Active projects</span>
              <strong>
                {active.length}
                <small>planning through review</small>
              </strong>
            </div>
            <div>
              <span>Awaiting review</span>
              <strong>
                {
                  projects.filter((project) => project.status === "Review")
                    .length
                }
                <small>internal design review only</small>
              </strong>
            </div>
            <div>
              <span>Past target date</span>
              <strong className="amber-text">
                {overdue.length}
                <small>active projects need attention</small>
              </strong>
            </div>
          </div>
          <div className="table-toolbar project-filters">
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Search projects"
                placeholder="Search project, client, or location…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              aria-label="Filter project status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option>All statuses</option>
              {projectStatuses.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              aria-label="Filter project owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
            >
              <option>All owners</option>
              <option value="">Unassigned</option>
              {owners.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span>{visible.length} projects</span>
          </div>
          <div className="table-scroll">
            <table className="inventory-table projects-table">
              <thead>
                <tr>
                  <th>PROJECT / CLIENT</th>
                  <th>STATUS</th>
                  <th>OWNER</th>
                  <th>TARGET DATE</th>
                  <th>BUILDING</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <strong>{project.name}</strong>
                      <small>
                        AS-{String(project.id).padStart(4, "0")} ·{" "}
                        {project.client || "No client set"}
                      </small>
                      {project.location && <small>{project.location}</small>}
                    </td>
                    <td>
                      <span
                        className={`status-pill ${project.status === "Completed" ? "success" : project.status === "On hold" ? "warning" : ""}`}
                      >
                        {project.status}
                      </span>
                    </td>
                    <td>
                      {owners.find((owner) => owner.id === project.owner)
                        ?.name || "Unassigned"}
                    </td>
                    <td
                      className={
                        overdue.some((item) => item.id === project.id)
                          ? "danger-text"
                          : ""
                      }
                    >
                      {date(project.due_date)}
                    </td>
                    <td>
                      {project.building.width}′ × {project.building.length}′
                      <small>
                        {formatNumber(
                          project.building.width * project.building.length,
                        )}{" "}
                        sq ft · Rev {project.revision}
                      </small>
                    </td>
                    <td>
                      <div className="button-group">
                        <button
                          className="button compact"
                          onClick={() => onOpen(project)}
                        >
                          <Box size={13} /> Open building
                        </button>
                        <IconButton
                          icon={Pencil}
                          label={`Edit details for ${project.name}`}
                          disabled={!canEdit}
                          onClick={() => setEditing(project)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <div className="empty-state">
                <FolderOpen size={31} />
                <h3>
                  {projects.length
                    ? "No matching projects"
                    : "Your first project starts here."}
                </h3>
                <p>
                  {projects.length
                    ? "Try another search or filter."
                    : "Create a project to add it to the shared portfolio."}
                </p>
                {canEdit && !projects.length && (
                  <button
                    className="button primary"
                    onClick={() => setCreating(true)}
                  >
                    <Plus size={15} /> New project
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="table-footnote">
            Project statuses are workflow labels, not engineering approvals or
            certifications. Use “Open building” to edit geometry.
          </p>
        </>
      )}
      {editing && (
        <ProjectDetailsDialog
          project={editing}
          owners={owners}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await onReload();
            setEditing(null);
            notify("Project details updated.");
          }}
        />
      )}
      {creating && (
        <CreateProjectDialog
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            const fresh = await onReload();
            setCreating(false);
            const created = fresh.find((project) => project.id === id);
            if (created) setEditing(created);
            notify("Project created. Add its owner, client, and target date.");
          }}
        />
      )}
    </main>
  );
}

function TicketCreateDialog({ projects, onClose, onCreated }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api("/tickets", {
        ...values,
        project_id: values.project_id ? Number(values.project_id) : null,
      });
      await onCreated(result.id);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="New support ticket"
      subtitle="Include what happened and what you expected instead."
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={submit}>
        <label>
          Subject
          <input
            name="title"
            minLength={4}
            maxLength={140}
            required
            placeholder="A short summary of the issue"
          />
        </label>
        <div className="form-grid">
          <label>
            Category
            <select aria-label="Category" name="category">
              {["Design", "Inventory", "Account", "Integration", "Other"].map(
                (category) => (
                  <option key={category}>{category}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Priority
            <select aria-label="Priority" name="priority" defaultValue="Normal">
              {ticketPriorities.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Linked project
          <select aria-label="Linked project" name="project_id">
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Issue details
          <textarea
            name="description"
            rows={5}
            minLength={10}
            maxLength={10000}
            required
            placeholder="What were you doing? What happened? Include steps to reproduce. Do not include passwords or API keys."
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          <Ticket size={15} /> Submit ticket
        </button>
      </form>
    </Modal>
  );
}

function TicketDetail({ id, summary, user, agents, onClose, onChanged }) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const staff = supportRoles.includes(user.role);
  async function load() {
    setTicket(await api(`/tickets/${id}`));
  }
  useEffect(() => {
    load().catch((error) => setError(messageOf(error)));
  }, [id]);
  async function reply(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    try {
      await api(`/tickets/${id}/replies`, {
        body: new FormData(form).get("body"),
      });
      form.reset();
      await load();
      await onChanged();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  async function triage(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/tickets/${id}/triage`, {
        ...values,
        assignee: values.assignee ? /^\d+$/.test(values.assignee) ? Number(values.assignee) : values.assignee : null,
      });
      await load();
      await onChanged();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={`Ticket #${String(id).padStart(4, "0")}`}
      subtitle={summary?.title || "Support conversation"}
      onClose={onClose}
    >
      <div className="form-stack">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!ticket ? (
          <div className="loading-state">
            <LoaderCircle size={18} className="spin" /> Loading ticket…
          </div>
        ) : (
          <>
            <div className="ticket-detail-meta">
              <span className="status-pill">{ticket.status}</span>
              <span
                className={`priority-label ${ticket.priority.toLowerCase()}`}
              >
                {ticket.priority} priority
              </span>
              <span>
                {ticket.category} · {date(ticket.created)}
              </span>
            </div>
            <article className="ticket-original">
              <strong>{ticket.title}</strong>
              <p>{ticket.description}</p>
              <small>
                Reported by {summary?.reporter_name || user.name}
                {summary?.project_name ? ` · ${summary.project_name}` : ""}
              </small>
            </article>
            {staff && (
              <form
                className="ticket-triage form-grid"
                onSubmit={triage}
                key={`${ticket.status}-${ticket.priority}-${ticket.assignee}`}
              >
                <label>
                  Status
                  <select aria-label="Status" name="status" defaultValue={ticket.status}>
                    {ticketStatuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select aria-label="Priority" name="priority" defaultValue={ticket.priority}>
                    {ticketPriorities.map((priority) => (
                      <option key={priority}>{priority}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Assigned technician
                  <select aria-label="Assigned technician" name="assignee" defaultValue={ticket.assignee ?? ""}>
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option value={agent.id} key={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="triage-save">
                  <button className="button" disabled={busy}>
                    <Save size={14} /> Update ticket
                  </button>
                </div>
              </form>
            )}
            <div className="ticket-thread">
              <h3>
                Conversation <span>{ticket.messages.length}</span>
              </h3>
              {ticket.messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    supportRoles.includes(message.author_role)
                      ? "staff-reply"
                      : ""
                  }
                >
                  <div>
                    <strong>{message.author_name}</strong>
                    <span>
                      {supportRoles.includes(message.author_role)
                        ? "Support"
                        : "Requester"}{" "}
                      · {date(message.created)}
                    </span>
                  </div>
                  <p>{message.body}</p>
                </article>
              ))}
              {!ticket.messages.length && (
                <p className="muted">No replies yet.</p>
              )}
            </div>
            <form className="form-stack ticket-reply" onSubmit={reply}>
              <label>
                Reply
                <textarea
                  name="body"
                  rows={3}
                  required
                  maxLength={5000}
                  placeholder="Add a reply. Never include passwords or API keys."
                />
              </label>
              <button className="button primary" disabled={busy}>
                <Send size={14} /> Send reply
              </button>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}

export function SupportCenter({
  user,
  projects,
  supportEmail,
  onSignIn,
  notify,
}) {
  const [tickets, setTickets] = useState([]);
  const [agents, setAgents] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Active tickets");
  const [priority, setPriority] = useState("All priorities");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const staff = supportRoles.includes(user?.role);
  async function load() {
    const [items, people] = await Promise.all([
      api("/tickets"),
      api("/support/agents"),
    ]);
    setTickets(items);
    setAgents(people);
    setError("");
    return items;
  }
  useEffect(() => {
    if (user) load().catch((error) => setError(messageOf(error)));
    else {
      setTickets([]);
      setAgents([]);
    }
  }, [user?.id, user?.role]);
  const visible = tickets.filter(
    (ticket) =>
      `${ticket.title} ${ticket.id} ${ticket.reporter_name} ${ticket.project_name || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "All tickets" || status === "Active tickets"
        ? status === "All tickets" ||
          !["Resolved", "Closed"].includes(ticket.status)
        : ticket.status === status) &&
      (priority === "All priorities" || ticket.priority === priority),
  );
  return (
    <main className="management-page support-center">
      <PageHeading
        eyebrow="SUPPORT"
        title={staff ? "Support Center" : "My support tickets"}
        subtitle={
          staff
            ? "Triage issues, coordinate technicians, and keep work moving."
            : "Track an issue from the first report to resolution."
        }
      >
        <IconButton
          icon={RefreshCw}
          label="Refresh support tickets"
          disabled={!user}
          onClick={() => load().catch((error) => setError(messageOf(error)))}
        />
        <button
          className="button primary"
          onClick={() => (user ? setCreating(true) : onSignIn())}
        >
          <Plus size={16} /> New ticket
        </button>
      </PageHeading>
      {!user ? (
        <SignInState title="Let’s get it sorted." onSignIn={onSignIn} />
      ) : (
        <>
          {error && (
            <p className="form-error page-error" role="alert">
              {error}
            </p>
          )}
          <div className="inventory-metrics">
            <div>
              <span>Open tickets</span>
              <strong>
                {tickets.filter((ticket) => ticket.status === "Open").length}
                <small>awaiting triage</small>
              </strong>
            </div>
            <div>
              <span>In progress</span>
              <strong>
                {
                  tickets.filter((ticket) => ticket.status === "In progress")
                    .length
                }
                <small>work underway</small>
              </strong>
            </div>
            <div>
              <span>Waiting on user</span>
              <strong>
                {
                  tickets.filter(
                    (ticket) => ticket.status === "Waiting on user",
                  ).length
                }
                <small>follow-up requested</small>
              </strong>
            </div>
            <div>
              <span>Resolved / closed</span>
              <strong>
                {
                  tickets.filter((ticket) =>
                    ["Resolved", "Closed"].includes(ticket.status),
                  ).length
                }
                <small>completed conversations</small>
              </strong>
            </div>
          </div>
          <div className="table-toolbar ticket-filters">
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Search tickets"
                placeholder="Search subject, project, or ticket number…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              aria-label="Filter ticket status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option>Active tickets</option>
              <option>All tickets</option>
              {ticketStatuses.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              aria-label="Filter ticket priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option>All priorities</option>
              {ticketPriorities.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <span>{visible.length} tickets</span>
          </div>
          <div className="table-scroll">
            <table className="inventory-table tickets-table">
              <thead>
                <tr>
                  <th>TICKET / SUBJECT</th>
                  <th>PRIORITY</th>
                  <th>STATUS</th>
                  {staff && <th>REPORTED BY</th>}
                  <th>ASSIGNED TO</th>
                  <th>UPDATED</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <button
                        className="table-title-button"
                        onClick={() => setSelected(ticket.id)}
                      >
                        <strong>{ticket.title}</strong>
                      </button>
                      <small>
                        #{String(ticket.id).padStart(4, "0")} ·{" "}
                        {ticket.category}
                        {ticket.project_name ? ` · ${ticket.project_name}` : ""}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`priority-label ${ticket.priority.toLowerCase()}`}
                      >
                        {ticket.priority}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${["Resolved", "Closed"].includes(ticket.status) ? "success" : ""}`}
                      >
                        {ticket.status}
                      </span>
                    </td>
                    {staff && <td>{ticket.reporter_name}</td>}
                    <td>{ticket.assignee_name || "Unassigned"}</td>
                    <td>{date(ticket.updated)}</td>
                    <td>
                      <IconButton
                        icon={ArrowUpRight}
                        label={`Open ticket ${ticket.id}`}
                        onClick={() => setSelected(ticket.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <div className="empty-state">
                <LifeBuoy size={34} strokeWidth={1.2} />
                <h3>
                  {tickets.length
                    ? "No tickets match these filters."
                    : "No support tickets yet."}
                </h3>
                <p>
                  {tickets.length
                    ? "Try another search or ticket status."
                    : "New issues and their replies will appear here."}
                </p>
              </div>
            )}
          </div>
          <div className="support-footer">
            <span>
              {staff
                ? "Administrators and technicians can see and triage all tickets."
                : "Only you, administrators, and technicians can read your tickets."}
            </span>
            {supportEmail && (
              <a href={`mailto:${supportEmail}`}>
                <Mail size={12} />
                {supportEmail}
              </a>
            )}
          </div>
        </>
      )}
      {creating && (
        <TicketCreateDialog
          projects={projects}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            await load();
            setCreating(false);
            setSelected(id);
            notify("Support ticket submitted.");
          }}
        />
      )}
      {selected && (
        <TicketDetail
          id={selected}
          summary={tickets.find((ticket) => ticket.id === selected)}
          user={user}
          agents={agents}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </main>
  );
}
