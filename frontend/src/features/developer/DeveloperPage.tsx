import React, { useState } from "react";
import { useToast } from "../../contexts/ToastContext";
import {
  Code2,
  Key,
  Webhook,
  Terminal,
  Copy,
  Check,
  Plus,
  Trash2,
  ExternalLink,
  ShieldAlert,
  Zap,
  Play,
  Send,
  Radio,
  FileCode,
  Activity,
  Layers,
  ChevronRight
} from "lucide-react";

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  created: string;
  lastUsed: string;
  scopes: string[];
}

interface ApiLogItem {
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  status: number;
  duration: number;
  timestamp: string;
  ip: string;
}

export const DeveloperPage: React.FC = () => {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<"overview" | "keys" | "docs" | "webhooks" | "logs">("overview");
  const [activeLang, setActiveLang] = useState<"curl" | "node" | "python">("curl");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([
    {
      id: "key_1",
      name: "Production Integration Gateway",
      prefix: "flw_live_8f39a0...c29b",
      created: "2026-08-15",
      lastUsed: "2 mins ago",
      scopes: ["pos.read", "pos.write", "invoices.read", "reviews.resolve"]
    },
    {
      id: "key_2",
      name: "Staging Pipeline Test Runner",
      prefix: "flw_test_41b712...99e1",
      created: "2026-08-28",
      lastUsed: "1 day ago",
      scopes: ["pos.read", "pos.write"]
    }
  ]);

  const [testEndpoint, setTestEndpoint] = useState("/pos");
  const [testMethod, setTestMethod] = useState("GET");
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [isExecutingTest, setIsExecutingTest] = useState(false);

  const logs: ApiLogItem[] = [
    {
      id: "req_019",
      method: "POST",
      path: "/v1/pos/upload",
      status: 201,
      duration: 382,
      timestamp: "12:34:10",
      ip: "192.0.2.45"
    },
    {
      id: "req_018",
      method: "GET",
      path: "/v1/pos/po_88291038",
      status: 200,
      duration: 48,
      timestamp: "12:33:55",
      ip: "192.0.2.45"
    },
    {
      id: "req_017",
      method: "POST",
      path: "/v1/reviews/rev_9921/approve",
      status: 200,
      duration: 184,
      timestamp: "12:31:02",
      ip: "198.51.100.12"
    },
    {
      id: "req_016",
      method: "GET",
      path: "/v1/invoices/inv_2026_001/download",
      status: 200,
      duration: 76,
      timestamp: "12:28:44",
      ip: "192.0.2.45"
    }
  ];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    addToast({
      type: "info",
      title: "Copied",
      message: "Copied snippet to clipboard."
    });
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    const newKey: ApiKeyItem = {
      id: `key_${Date.now()}`,
      name: newKeyName.trim(),
      prefix: `flw_live_${Math.random().toString(36).substring(2, 8)}...${Math.random().toString(36).substring(2, 6)}`,
      created: new Date().toISOString().split("T")[0],
      lastUsed: "Never",
      scopes: ["pos.read", "pos.write", "invoices.read"]
    };
    setApiKeys([newKey, ...apiKeys]);
    setShowNewKeyModal(false);
    setNewKeyName("");
    addToast({
      type: "success",
      title: "API Key Created",
      message: "New secret key generated. Ensure you copy the key secret safely."
    });
  };

  const handleRevokeKey = (id: string) => {
    setApiKeys(apiKeys.filter((k) => k.id !== id));
    addToast({
      type: "info",
      title: "Key Revoked",
      message: "API key has been revoked and can no longer access endpoints."
    });
  };

  const handleRunTestCall = () => {
    setIsExecutingTest(true);
    setTimeout(() => {
      setIsExecutingTest(false);
      setTestResponse(
        JSON.stringify(
          {
            status: 200,
            message: "Request successfully authenticated against FlowInvoice AI Gateway",
            tenantId: "tenant_default",
            timestamp: new Date().toISOString(),
            rateLimit: {
              remaining: 998,
              resetInSeconds: 58
            },
            data: [
              { id: "po_1042", poNumber: "PO-2026-1042", status: "COMPLETED", amount: 4820.0 }
            ]
          },
          null,
          2
        )
      );
    }, 600);
  };

  return (
    <div className="space-y-6">
      {/* Developer Center Header (Dark Technical Surface) */}
      <div className="bg-[#0A0D14] border border-[#1D2430] rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-accent-primary to-transparent" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center">
                <Code2 className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-2xl font-black font-mono tracking-tight text-white">
                Developer Center
              </h1>
              <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>v1.0.4-prod</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-xl font-sans">
              Programmatic REST APIs, Webhooks, Vector DB indexing webhooks, and SDK tooling for embedding autonomous PO-to-Invoice workflows into your enterprise stack.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 font-mono text-xs">
              <span className="text-slate-400 block text-[10px]">Gateway Base URL</span>
              <span className="text-accent-secondary font-bold">https://api.flowinvoice.ai/v1</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-2 mt-6 pt-4 border-t border-[#1D2430] overflow-x-auto text-xs font-mono">
          {[
            { key: "overview", label: "Overview", icon: Activity },
            { key: "keys", label: "API Keys", icon: Key },
            { key: "docs", label: "Documentation & Snippets", icon: FileCode },
            { key: "webhooks", label: "Webhooks", icon: Webhook },
            { key: "logs", label: "Live Telemetry Logs", icon: Terminal }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition ${
                  isActive
                    ? "bg-accent-primary text-white font-bold shadow-md"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB CONTENT */}

      {/* 1. OVERVIEW & INTERACTIVE REQUEST RUNNER */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Summary & Specs (7 Cols) */}
          <div className="lg:col-span-7 space-y-5">
            {/* System Status & Rate Limits Card */}
            <div className="bg-[#0A0D14] border border-[#1D2430] rounded-xl p-6 text-white space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                API Environment & Quota
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="p-3.5 rounded-lg bg-dark-card border border-dark-border">
                  <span className="text-slate-400 block text-[10px]">API Status</span>
                  <span className="text-emerald-400 font-bold font-mono text-sm block mt-1">
                    99.99% Operational
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-dark-card border border-dark-border">
                  <span className="text-slate-400 block text-[10px]">Rate Limit</span>
                  <span className="text-white font-bold font-mono text-sm block mt-1">
                    1,000 req / min
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-dark-card border border-dark-border">
                  <span className="text-slate-400 block text-[10px]">Max Payload Size</span>
                  <span className="text-accent-secondary font-bold font-mono text-sm block mt-1">
                    25 MB per PDF
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-300 font-mono pt-2">
                <div className="flex items-center justify-between p-2 rounded bg-dark-card">
                  <span className="text-slate-400">Authentication Header:</span>
                  <code className="text-accent-secondary">Authorization: Bearer &lt;SECRET_KEY&gt;</code>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-dark-card">
                  <span className="text-slate-400">Tenant Scoping Header:</span>
                  <code className="text-accent-secondary">X-Tenant-Id: &lt;TENANT_ID&gt;</code>
                </div>
              </div>
            </div>

            {/* Core Capabilities */}
            <div className="bg-[#0A0D14] border border-[#1D2430] rounded-xl p-6 text-white space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                Agentic SaaS Endpoints
              </h3>
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-lg bg-dark-card border border-dark-border flex items-center justify-between">
                  <div className="flex items-center space-x-2 font-mono">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                      POST
                    </span>
                    <span className="text-white font-bold">/pos/upload</span>
                  </div>
                  <span className="text-slate-400 text-[11px]">Uploads PDF & starts agent workflow</span>
                </div>

                <div className="p-3 rounded-lg bg-dark-card border border-dark-border flex items-center justify-between">
                  <div className="flex items-center space-x-2 font-mono">
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold text-[10px]">
                      GET
                    </span>
                    <span className="text-white font-bold">/pos/:id</span>
                  </div>
                  <span className="text-slate-400 text-[11px]">Returns 13-stage state & extracted line items</span>
                </div>

                <div className="p-3 rounded-lg bg-dark-card border border-dark-border flex items-center justify-between">
                  <div className="flex items-center space-x-2 font-mono">
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold text-[10px]">
                      POST
                    </span>
                    <span className="text-white font-bold">/reviews/:id/approve</span>
                  </div>
                  <span className="text-slate-400 text-[11px]">Resolves exception and resumes pipeline</span>
                </div>

                <div className="p-3 rounded-lg bg-dark-card border border-dark-border flex items-center justify-between">
                  <div className="flex items-center space-x-2 font-mono">
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold text-[10px]">
                      GET
                    </span>
                    <span className="text-white font-bold">/invoices/:id/download</span>
                  </div>
                  <span className="text-slate-400 text-[11px]">Generates short-lived presigned S3 URL</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Interactive Request Explorer (5 Cols) */}
          <div className="lg:col-span-5 bg-[#0A0D14] border border-[#1D2430] rounded-xl p-6 text-white space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#1D2430]">
              <div className="flex items-center space-x-2">
                <Play className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white font-mono">
                  Interactive Request Explorer
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">Live Browser Runner</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <select
                  value={testMethod}
                  onChange={(e) => setTestMethod(e.target.value)}
                  className="bg-dark-card border border-dark-border rounded-lg px-2.5 py-2 text-white font-mono text-xs focus:outline-none"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>

                <input
                  type="text"
                  value={testEndpoint}
                  onChange={(e) => setTestEndpoint(e.target.value)}
                  className="flex-1 bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-accent-primary"
                />

                <button
                  onClick={handleRunTestCall}
                  disabled={isExecutingTest}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold flex items-center space-x-1.5 transition disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${isExecutingTest ? "animate-spin" : ""}`} />
                  <span>Send</span>
                </button>
              </div>

              <div>
                <span className="text-[11px] font-mono text-slate-400 block mb-1">Response Payload</span>
                <pre className="p-3 bg-black/80 rounded-lg border border-dark-border font-mono text-[11px] text-emerald-400 overflow-x-auto max-h-72">
                  {testResponse || `Click "Send" to execute request against gateway...`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. API KEYS TAB */}
      {activeTab === "keys" && (
        <div className="bg-[#0A0D14] border border-[#1D2430] rounded-xl p-6 text-white space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-3 border-b border-[#1D2430]">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white font-mono">
                Active Secret API Keys
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Secret tokens carry full authorization for your organization. Never expose them client-side.
              </p>
            </div>

            <button
              onClick={() => setShowNewKeyModal(true)}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-bold transition shadow-md"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create New Key</span>
            </button>
          </div>

          <div className="space-y-3">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="p-4 rounded-xl bg-dark-card border border-dark-border hover:border-slate-700 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center space-x-3">
                    <span className="font-bold text-white font-mono text-sm">{key.name}</span>
                    <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 font-mono text-[10px]">
                      Created {key.created}
                    </span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <code className="px-2.5 py-1 rounded bg-black/60 font-mono text-accent-secondary border border-white/5">
                      {key.prefix}
                    </code>
                    <button
                      onClick={() => handleCopy(key.prefix, key.id)}
                      className="text-slate-400 hover:text-white transition"
                      title="Copy Key Prefix"
                    >
                      {copiedKey === key.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {key.scopes.map((sc) => (
                      <span
                        key={sc}
                        className="px-2 py-0.5 rounded bg-accent-primary/10 text-accent-secondary border border-accent-primary/20 font-mono text-[10px]"
                      >
                        {sc}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center space-x-4 flex-shrink-0">
                  <div className="text-right text-[11px] text-slate-400 font-mono">
                    <span>Last used: {key.lastUsed}</span>
                  </div>

                  <button
                    onClick={() => handleRevokeKey(key.id)}
                    className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition"
                    title="Revoke API Key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. DOCUMENTATION & CODE SNIPPETS TAB */}
      {activeTab === "docs" && (
        <div className="bg-[#0A0D14] border border-[#1D2430] rounded-xl p-6 text-white space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-[#1D2430]">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white font-mono">
                API Integration Examples
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Ready-to-run examples in cURL, TypeScript, and Python.
              </p>
            </div>

            <div className="flex items-center space-x-1 bg-white/5 border border-white/10 rounded-lg p-1 text-xs font-mono">
              {(["curl", "node", "python"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={`px-3 py-1 rounded capitalize transition ${
                    activeLang === lang
                      ? "bg-accent-primary text-white font-bold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {lang === "curl" ? "cURL" : lang === "node" ? "Node / TS" : "Python"}
                </button>
              ))}
            </div>
          </div>

          {/* Snippet Block */}
          <div className="relative">
            <pre className="p-5 bg-black/90 rounded-xl border border-dark-border font-mono text-xs text-slate-200 overflow-x-auto leading-relaxed">
              {activeLang === "curl" &&
                `# 1. Upload Purchase Order PDF to start autonomous agent pipeline
curl -X POST https://api.flowinvoice.ai/v1/pos/upload \\
  -H "Authorization: Bearer flw_live_your_secret_key" \\
  -F "file=@purchase_order_8829.pdf"

# 2. Check extraction & autonomous state graph progress
curl -X GET https://api.flowinvoice.ai/v1/pos/po_88291038 \\
  -H "Authorization: Bearer flw_live_your_secret_key"

# 3. Retrieve generated canonical invoice
curl -X GET https://api.flowinvoice.ai/v1/invoices/inv_2026_001/download \\
  -H "Authorization: Bearer flw_live_your_secret_key"`}

              {activeLang === "node" &&
                `import axios from "axios";
import fs from "fs";
import FormData from "form-data";

const client = axios.create({
  baseURL: "https://api.flowinvoice.ai/v1",
  headers: {
    Authorization: \`Bearer \${process.env.FLOWINVOICE_API_KEY}\`,
  },
});

// Upload PO PDF
async function processPurchaseOrder(filePath: string) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));

  const { data } = await client.post("/pos/upload", form, {
    headers: form.getHeaders(),
  });

  console.log("Autonomous workflow initiated:", data.workflowId);
  return data;
}`}

              {activeLang === "python" &&
                `import os
import requests

API_URL = "https://api.flowinvoice.ai/v1"
HEADERS = {"Authorization": f"Bearer {os.getenv('FLOWINVOICE_API_KEY')}"}

# Ingest PO into FlowInvoice AI pipeline
def upload_purchase_order(file_path: str):
    with open(file_path, "rb") as f:
        files = {"file": f}
        res = requests.post(f"{API_URL}/pos/upload", headers=HEADERS, files=files)
        res.raise_for_status()
        return res.json()

print(upload_purchase_order("PO_2026_Enterprise.pdf"))`}
            </pre>
          </div>
        </div>
      )}

      {/* 4. WEBHOOKS TAB */}
      {activeTab === "webhooks" && (
        <div className="bg-[#0A0D14] border border-[#1D2430] rounded-xl p-6 text-white space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#1D2430]">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white font-mono">
                Event Webhooks
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Receive instant HTTP POST callbacks when POs finish processing, exceptions are raised, or invoices are issued.
              </p>
            </div>
            <button className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg text-xs font-semibold">
              Add Endpoint
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-4 rounded-xl bg-dark-card border border-dark-border space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-bold text-white">https://erp.enterprise.com/webhooks/flowinvoice</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                  Active
                </span>
              </div>
              <div className="flex items-center space-x-3 text-slate-400 text-[11px] font-mono">
                <span>Secret: whsec_8849...10f</span>
                <span>•</span>
                <span>Events: po.extracted, invoice.issued, review.required</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. LIVE TELEMETRY LOGS */}
      {activeTab === "logs" && (
        <div className="bg-[#0A0D14] border border-[#1D2430] rounded-xl p-6 text-white space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#1D2430]">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-accent-secondary" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white font-mono">
                Live API Telemetry Stream
              </h3>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Streaming</span>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[#1D2430] text-slate-400 text-[11px]">
                  <th className="py-2.5 px-3">Method</th>
                  <th className="py-2.5 px-3">Endpoint</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3">Client IP</th>
                  <th className="py-2.5 px-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D2430]/60">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/5 transition">
                    <td className="py-2.5 px-3 font-bold">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          log.method === "POST"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-blue-500/20 text-blue-400"
                        }`}
                      >
                        {log.method}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-white">{log.path}</td>
                    <td className="py-2.5 px-3">
                      <span className="text-emerald-400 font-bold">{log.status} OK</span>
                    </td>
                    <td className="py-2.5 px-3 text-accent-secondary">{log.duration}ms</td>
                    <td className="py-2.5 px-3 text-slate-400">{log.ip}</td>
                    <td className="py-2.5 px-3 text-right text-slate-400">{log.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New API Key Modal */}
      {showNewKeyModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0A0D14] border border-[#1D2430] rounded-2xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl">
            <h3 className="text-base font-bold font-mono">Generate Secret API Key</h3>
            <p className="text-xs text-slate-400">
              Give your new key a descriptive label indicating which microservice or agent script will consume it.
            </p>

            <form onSubmit={handleCreateKey} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Key Description / Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ERP NetSuite Sync Daemon"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full p-2.5 bg-dark-card border border-dark-border rounded-lg text-white focus:outline-none focus:border-accent-primary"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewKeyModal(false)}
                  className="px-4 py-2 border border-dark-border rounded-lg text-slate-300 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white font-bold rounded-lg transition"
                >
                  Generate Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
