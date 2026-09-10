import React, { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { Role } from "../../types";
import {
  Building,
  Users,
  Shield,
  Sliders,
  Bell,
  Cpu,
  Save,
  Check,
  Plus,
  Lock,
  Mail,
  Trash2,
  Database,
  Radio,
  SlidersHorizontal
} from "lucide-react";

export const SettingsPage: React.FC = () => {
  const { user, can } = useAuth();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<"org" | "team" | "rbac" | "ai" | "notifications">("org");

  // Organization state
  const [orgName, setOrgName] = useState("Acme Technologies Inc.");
  const [tenantId, setTenantId] = useState("tenant_default");
  const [gstNumber, setGstNumber] = useState("29AABCU9603R1ZM");
  const [currency, setCurrency] = useState("INR");
  const [address, setAddress] = useState("450 Silicon Avenue, Tech Park Phase 2, Bengaluru, KA 560100");

  // AI & RAG configuration
  const [extractionModel, setExtractionModel] = useState("gemini-1.5-pro");
  const [confidenceThreshold, setConfidenceThreshold] = useState(90);
  const [qdrantHost, setQdrantHost] = useState("http://localhost:6333");
  const [collectionName, setCollectionName] = useState("p2i_contracts");

  // Team users list
  const [teamMembers, setTeamMembers] = useState([
    { id: "usr_1", name: "Admin", email: "admin@flowinvoice.ai", role: "ADMIN" as Role, status: "Active" },
    { id: "usr_2", name: "Finance", email: "finance@flowinvoice.ai", role: "FINANCE" as Role, status: "Active" },
    { id: "usr_3", name: "Reviewer", email: "reviewer@flowinvoice.ai", role: "REVIEWER" as Role, status: "Active" }
  ]);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("REVIEWER");

  const handleSaveOrg = (e: React.FormEvent) => {
    e.preventDefault();
    addToast({
      type: "success",
      title: "Organization Updated",
      message: "Enterprise settings saved successfully."
    });
  };

  const handleSaveAI = (e: React.FormEvent) => {
    e.preventDefault();
    addToast({
      type: "success",
      title: "AI Engine Parameters Updated",
      message: `Confidence threshold set to ${confidenceThreshold}%. Qdrant collection configured.`
    });
  };

  const handleInviteUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    const newMember = {
      id: `usr_${Date.now()}`,
      name: inviteEmail.split("@")[0],
      email: inviteEmail.trim(),
      role: inviteRole,
      status: "Invited"
    };
    setTeamMembers([...teamMembers, newMember]);
    setShowInviteModal(false);
    setInviteEmail("");
    addToast({
      type: "success",
      title: "Invitation Sent",
      message: `Invited ${inviteEmail} with role ${inviteRole}.`
    });
  };

  const rbacMatrix = [
    { permission: "Upload Purchase Orders", admin: true, finance: true, ops: true, reviewer: false, viewer: false },
    { permission: "Retry Processing Pipeline", admin: true, finance: false, ops: true, reviewer: false, viewer: false },
    { permission: "Resolve Review Exceptions", admin: true, finance: true, ops: false, reviewer: true, viewer: false },
    { permission: "Approve High-Value Invoices", admin: true, finance: true, ops: false, reviewer: false, viewer: false },
    { permission: "Ingest Customer MSA Contracts", admin: true, finance: true, ops: false, reviewer: false, viewer: false },
    { permission: "Manage Secret API Keys", admin: true, finance: false, ops: false, reviewer: false, viewer: false },
    { permission: "View Audit Trail & Traces", admin: true, finance: true, ops: true, reviewer: true, viewer: true }
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-workspace-text tracking-tight">
          Enterprise Settings
        </h1>
        <p className="text-xs text-workspace-muted mt-1">
          Configure multi-tenant organization metadata, RBAC permissions matrix, and autonomous AI engine parameters.
        </p>
      </div>

      {/* Tabs Bar */}
      <div className="workspace-card p-2 flex items-center space-x-1 overflow-x-auto text-xs font-semibold">
        {[
          { key: "org", label: "Organization & Tax", icon: Building },
          { key: "team", label: "Team & Members", icon: Users },
          { key: "rbac", label: "RBAC Permissions Matrix", icon: Shield },
          { key: "ai", label: "AI Engine & RAG (Qdrant)", icon: Cpu },
          { key: "notifications", label: "Alerts & Notifications", icon: Bell }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg whitespace-nowrap transition ${
                isActive
                  ? "bg-accent-primary text-white shadow-sm"
                  : "text-workspace-muted hover:text-workspace-text hover:bg-slate-100"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: ORGANIZATION & TAX */}
      {activeTab === "org" && (
        <form onSubmit={handleSaveOrg} className="workspace-card p-6 space-y-6 text-xs">
          <div>
            <h3 className="text-sm font-bold text-workspace-text">Organization Legal Identity</h3>
            <p className="text-workspace-muted text-[11px] mt-0.5">
              This information appears on all verified canonical invoices and regulatory tax reports.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-workspace-text font-semibold mb-1">Company Legal Name</label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>

            <div>
              <label className="block text-workspace-text font-semibold mb-1">Tenant ID</label>
              <input
                type="text"
                disabled
                value={tenantId}
                className="w-full p-2.5 bg-slate-100 border border-workspace-border rounded-lg text-workspace-muted font-mono"
              />
            </div>

            <div>
              <label className="block text-workspace-text font-semibold mb-1">Registered GSTIN / Tax ID</label>
              <input
                type="text"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text font-mono font-bold focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>

            <div>
              <label className="block text-workspace-text font-semibold mb-1">Default Base Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
              >
                <option value="INR">INR (₹) - Indian Rupee</option>
                <option value="USD">USD ($) - US Dollar</option>
                <option value="EUR">EUR (€) - Euro</option>
                <option value="GBP">GBP (£) - British Pound</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-workspace-text font-semibold mb-1">Registered Corporate Address</label>
            <textarea
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg font-bold transition shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Organization</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: TEAM & MEMBERS */}
      {activeTab === "team" && (
        <div className="workspace-card p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-workspace-border">
            <div>
              <h3 className="text-sm font-bold text-workspace-text">Workspace Users & Roles</h3>
              <p className="text-xs text-workspace-muted mt-0.5">
                Manage accounts and role assignments across your finance and compliance teams.
              </p>
            </div>

            <button
              onClick={() => setShowInviteModal(true)}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-bold transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Invite Member</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Member Name</th>
                  <th>Work Email</th>
                  <th>Assigned Role</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map((member) => (
                  <tr key={member.id}>
                    <td className="font-bold text-workspace-text">{member.name}</td>
                    <td className="font-mono text-xs text-workspace-muted">{member.email}</td>
                    <td>
                      <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold">
                        {member.role}
                      </span>
                    </td>
                    <td>
                      <span className="text-xs text-emerald-700 font-semibold">{member.status}</span>
                    </td>
                    <td className="text-right">
                      {member.role !== "ADMIN" && (
                        <button
                          onClick={() => setTeamMembers(teamMembers.filter((m) => m.id !== member.id))}
                          className="text-red-500 hover:text-red-700 transition"
                          title="Remove user"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: RBAC PERMISSIONS MATRIX */}
      {activeTab === "rbac" && (
        <div className="workspace-card p-6 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-workspace-text">Role-Based Access Control (RBAC)</h3>
            <p className="text-xs text-workspace-muted mt-0.5">
              Strict multi-tenant privilege separation enforced by backend middleware and UI gates.
            </p>
          </div>

          <div className="overflow-x-auto border border-workspace-border rounded-xl">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Capability / Action</th>
                  <th className="text-center">ADMIN</th>
                  <th className="text-center">FINANCE</th>
                  <th className="text-center">OPERATIONS</th>
                  <th className="text-center">REVIEWER</th>
                  <th className="text-center">VIEWER</th>
                </tr>
              </thead>
              <tbody>
                {rbacMatrix.map((row, idx) => (
                  <tr key={idx}>
                    <td className="font-medium text-workspace-text">{row.permission}</td>
                    <td className="text-center">
                      {row.admin ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {row.finance ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {row.ops ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {row.reviewer ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {row.viewer ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: AI ENGINE & RAG (QDRANT) */}
      {activeTab === "ai" && (
        <form onSubmit={handleSaveAI} className="workspace-card p-6 space-y-6 text-xs">
          <div>
            <h3 className="text-sm font-bold text-workspace-text">Autonomous AI & Vector Parameters</h3>
            <p className="text-workspace-muted text-[11px] mt-0.5">
              Tune confidence gates and Qdrant vector retrieval endpoints.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-workspace-text font-semibold mb-1">
                Multimodal Extraction Model
              </label>
              <select
                value={extractionModel}
                onChange={(e) => setExtractionModel(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
              >
                <option value="gemini-1.5-pro">Google Gemini 1.5 Pro (Recommended)</option>
                <option value="gemini-1.5-flash">Google Gemini 1.5 Flash (High Speed)</option>
                <option value="gpt-4o">OpenAI GPT-4o (Vision Multimodal)</option>
              </select>
            </div>

            <div>
              <label className="block text-workspace-text font-semibold mb-1">
                Human Review Confidence Gate ({confidenceThreshold}%)
              </label>
              <div className="flex items-center space-x-3 pt-2">
                <input
                  type="range"
                  min="70"
                  max="99"
                  value={confidenceThreshold}
                  onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                  className="w-full accent-accent-primary cursor-pointer"
                />
                <span className="font-mono font-bold text-accent-primary text-sm w-12 text-right">
                  {confidenceThreshold}%
                </span>
              </div>
              <span className="text-[10px] text-workspace-muted mt-1 block">
                POs with extraction score below {confidenceThreshold}% trigger Human Review exception.
              </span>
            </div>

            <div>
              <label className="block text-workspace-text font-semibold mb-1">
                Qdrant Vector Database Host
              </label>
              <input
                type="text"
                value={qdrantHost}
                onChange={(e) => setQdrantHost(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>

            <div>
              <label className="block text-workspace-text font-semibold mb-1">
                Target Vector Collection
              </label>
              <input
                type="text"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg font-bold transition shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save AI Parameters</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 5: NOTIFICATIONS */}
      {activeTab === "notifications" && (
        <div className="workspace-card p-6 space-y-4 text-xs">
          <div>
            <h3 className="text-sm font-bold text-workspace-text">Alerting & Notification Rules</h3>
            <p className="text-workspace-muted text-[11px] mt-0.5">
              Control when human reviewers and finance admins receive real-time notifications.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <label className="flex items-start space-x-3 p-3.5 rounded-lg border border-workspace-border bg-slate-50 hover:bg-slate-100/60 cursor-pointer transition">
              <input type="checkbox" defaultChecked className="mt-0.5 accent-accent-primary" />
              <div>
                <span className="font-bold text-workspace-text block">High & Critical Priority Exceptions</span>
                <span className="text-workspace-muted text-[11px]">
                  Send immediate email notification when a pricing mismatch or compliance error halts pipeline.
                </span>
              </div>
            </label>

            <label className="flex items-start space-x-3 p-3.5 rounded-lg border border-workspace-border bg-slate-50 hover:bg-slate-100/60 cursor-pointer transition">
              <input type="checkbox" defaultChecked className="mt-0.5 accent-accent-primary" />
              <div>
                <span className="font-bold text-workspace-text block">Daily Operations Digest</span>
                <span className="text-workspace-muted text-[11px]">
                  Daily summary email of total POs processed, invoices issued, and mean turnaround time.
                </span>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-workspace-border space-y-4">
            <h3 className="text-base font-bold text-workspace-text">Invite Team Member</h3>

            <form onSubmit={handleInviteUser} className="space-y-4 text-xs">
              <div>
                <label className="block text-workspace-text font-semibold mb-1">Work Email</label>
                <input
                  type="email"
                  required
                  placeholder="colleague@acme.corp"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
              </div>

              <div>
                <label className="block text-workspace-text font-semibold mb-1">Role Assignment</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                  className="w-full p-2.5 bg-slate-50 border border-workspace-border rounded-lg text-workspace-text focus:outline-none focus:ring-1 focus:ring-accent-primary"
                >
                  <option value="REVIEWER">Reviewer (Resolve Exceptions)</option>
                  <option value="FINANCE">Finance (Invoicing & Terms)</option>
                  <option value="OPERATIONS">Operations (Upload & Ingestion)</option>
                  <option value="ADMIN">Admin (Full Access)</option>
                  <option value="VIEWER">Viewer (Read-Only)</option>
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 border border-workspace-border rounded-lg text-workspace-text hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white font-bold rounded-lg transition shadow-sm"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
