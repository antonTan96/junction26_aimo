import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Sliders,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Eye,
  FileText,
  UserCheck,
  Bot,
  Zap,
  ArrowRight,
  Database,
  Clock,
  ChevronDown,
  ChevronRight,
  Package,
  Layers,
  Sparkles,
  Building2,
  Activity,
  DollarSign,
  TrendingUp,
  Cpu,
  Lock,
  Unlock,
  ExternalLink,
  Repeat,
  Calendar,
  Check,
  SlidersHorizontal,
  AlertCircle,
  Ban,
  Play
} from 'lucide-react';

const API_BASE = '/api/v1';

export default function App() {
  // Port Detection: Port 3000 = Buyer Portal, Port 8000 = AimoGate Wholesaler Tower
  const currentPort = typeof window !== 'undefined' ? window.location.port : '3000';
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const portalParam = urlParams?.get('portal');
  const tenantParam = urlParams?.get('tenant');

  // Dedicated Port Isolation: Port 8000 is Wholesaler Tower, Port 3000 is Buyer Portal
  const activePortal = portalParam || (currentPort === '8000' ? 'aimogate' : 'buyer');

  // Customer / Tenant Selection
  const [selectedTenant, setSelectedTenant] = useState(tenantParam || 'hotel_nordic_group');
  const [customers, setCustomers] = useState([]);
  const [networkOverview, setNetworkOverview] = useState(null);

  // Active Role in Buyer Portal ('human' | 'agent')
  const [role, setRole] = useState('human');
  const [tokens, setTokens] = useState({});
  const [stock, setStock] = useState([]);
  const [orders, setOrders] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [policy, setPolicy] = useState({
    max_auto_approve_eur: 800.0,
    max_auto_approve_litres: 600.0,
    allowed_categories: ['dairy', 'plant-based'],
  });
  const [guardrails, setGuardrails] = useState(null);
  const [recurrentGrants, setRecurrentGrants] = useState([]);
  const [allRecurrentGrants, setAllRecurrentGrants] = useState([]);
  const [systemCategories, setSystemCategories] = useState([
    'dairy',
    'plant-based',
    'bakery',
    'beverages',
    'cleaning',
    'meat',
    'alcohol',
  ]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [globalAuditLogs, setGlobalAuditLogs] = useState([]);
  const [zeroTrustData, setZeroTrustData] = useState(null);

  // Approval Options State
  const [selectedApprovalType, setSelectedApprovalType] = useState('ONE_TIME'); // 'ONE_TIME' | 'RECURRENT_WINDOW'
  const [approvalWindowDays, setApprovalWindowDays] = useState(7);
  const [recurrentBudgetCap, setRecurrentBudgetCap] = useState(3000);

  // Agent Run State
  const [prompt, setPrompt] = useState(
    'I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.'
  );
  const [agentMode, setAgentMode] = useState('deterministic'); // 'deterministic' | 'live'
  const [isRunningAgent, setIsRunningAgent] = useState(false);
  const [agentResponse, setAgentResponse] = useState(null);
  const [expandedTrace, setExpandedTrace] = useState({});

  // UI Toast
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  // Helper to fetch with current role's token
  const authFetch = async (url, options = {}) => {
    const activeToken = tokens[role]?.token;
    const headers = {
      'Content-Type': 'application/json',
      ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
      ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
  };

  // Refresh data for selected tenant and network
  const refreshAllData = async (tenantId = selectedTenant) => {
    try {
      // 1. Fetch tokens
      const tRes = await fetch(`${API_BASE}/demo/tokens`);
      if (tRes.ok) setTokens(await tRes.json());

      // 2. Fetch customers roster
      const cRes = await fetch(`${API_BASE}/admin/customers`);
      if (cRes.ok) {
        const cData = await cRes.json();
        setCustomers(cData);
      }

      // 3. Fetch network overview KPIs
      const noRes = await fetch(`${API_BASE}/admin/overview`);
      if (noRes.ok) setNetworkOverview(await noRes.json());

      // 4. Fetch stock
      const sRes = await fetch(`${API_BASE}/demo/stock`);
      if (sRes.ok) setStock(await sRes.json());

      // 5. Fetch policy for selected customer
      const pRes = await fetch(`${API_BASE}/policies?tenant_id=${tenantId}`);
      if (pRes.ok) setPolicy(await pRes.json());

      // 6. Fetch client guardrail category whitelist
      const gRes = await fetch(`${API_BASE}/policies/guardrails?tenant_id=${tenantId}`);
      if (gRes.ok) setGuardrails(await gRes.json());

      // 7. Fetch system categories
      const scRes = await fetch(`${API_BASE}/admin/categories`);
      if (scRes.ok) setSystemCategories(await scRes.json());

      // 8. Fetch recurrent grants for this buyer
      const rgRes = await fetch(`${API_BASE}/orders/recurrent-grants`);
      if (rgRes.ok) setRecurrentGrants(await rgRes.json());

      // 9. Fetch all recurrent grants for Tower
      const argRes = await fetch(`${API_BASE}/admin/recurrent-grants`);
      if (argRes.ok) setAllRecurrentGrants(await argRes.json());

      // 10. Fetch orders for selected customer
      const oRes = await fetch(`${API_BASE}/orders?tenant_id=${tenantId}`);
      if (oRes.ok) setOrders(await oRes.json());

      // 11. Fetch all cross-customer orders for admin
      const aoRes = await fetch(`${API_BASE}/admin/orders`);
      if (aoRes.ok) setAllOrders(await aoRes.json());

      // 12. Fetch audit logs
      const aRes = await fetch(`${API_BASE}/orders/audit/logs`);
      if (aRes.ok) setAuditLogs(await aRes.json());

      const gaRes = await fetch(`${API_BASE}/admin/audit_logs`);
      if (gaRes.ok) setGlobalAuditLogs(await gaRes.json());

      // 13. Zero-trust comparison
      const zRes = await fetch(`${API_BASE}/demo/inspect`);
      if (zRes.ok) setZeroTrustData(await zRes.json());
    } catch (err) {
      console.error('Error refreshing data:', err);
    }
  };

  useEffect(() => {
    refreshAllData(selectedTenant);
    const interval = setInterval(() => refreshAllData(selectedTenant), 5000);
    return () => clearInterval(interval);
  }, [selectedTenant]);

  // Handle Tenant Switch
  const handleTenantChange = (tenantId) => {
    setSelectedTenant(tenantId);
    setAgentResponse(null);
    refreshAllData(tenantId);
    const cust = customers.find((c) => c.tenant_id === tenantId);
    showToast(`Switched view to ${cust?.tenant_name || tenantId}`, 'info');
  };

  // 1-Click Demo Reset
  const handleResetDemo = async () => {
    try {
      const res = await fetch(`${API_BASE}/demo/reset`, { method: 'POST' });
      if (res.ok) {
        showToast('Demo state reset successfully in <50ms!', 'success');
        setAgentResponse(null);
        await refreshAllData(selectedTenant);
      }
    } catch (err) {
      showToast('Reset failed: ' + err.message, 'error');
    }
  };

  // Update Policy Spend Cap via Slider
  const handlePolicyChange = async (newCapEur) => {
    const updated = { ...policy, max_auto_approve_eur: Number(newCapEur) };
    setPolicy(updated);
    try {
      const res = await authFetch(`${API_BASE}/policies?tenant_id=${selectedTenant}`, {
        method: 'PATCH',
        body: JSON.stringify({ max_auto_approve_eur: Number(newCapEur) }),
      });
      if (res.ok) {
        const data = await res.json();
        setPolicy(data);
        showToast(`Spend limit updated to €${Number(newCapEur).toLocaleString()}`, 'info');
      } else if (res.status === 403) {
        showToast('403 Forbidden: Only Human Managers can adjust spend policies!', 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Update Guardrail Category Whitelist (Admin/Tower Action)
  const handleToggleCategory = async (tenantId, category) => {
    const cust = customers.find((c) => c.tenant_id === tenantId);
    const currentAllowed = cust?.allowed_categories || ['dairy'];
    let updated;
    if (currentAllowed.includes(category)) {
      if (currentAllowed.length === 1) {
        showToast('Client must have at least 1 whitelisted category', 'warning');
        return;
      }
      updated = currentAllowed.filter((c) => c !== category);
    } else {
      updated = [...currentAllowed, category];
    }

    try {
      const res = await fetch(`${API_BASE}/admin/customers/${tenantId}/guardrails`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_categories: updated }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`Updated whitelist for ${cust?.tenant_name}: [${data.allowed_categories.join(', ')}]`, 'success');
        await refreshAllData(selectedTenant);
      }
    } catch (err) {
      showToast('Failed to update guardrails: ' + err.message, 'error');
    }
  };

  // Revoke Recurrent Grant
  const handleRevokeGrant = async (grantId) => {
    try {
      const res = await fetch(`${API_BASE}/admin/recurrent-grants/${grantId}/revoke`, {
        method: 'POST',
      });
      if (res.ok) {
        showToast(`Recurrent grant ${grantId} REVOKED! Subsequent orders will require approval.`, 'warning');
        await refreshAllData(selectedTenant);
      }
    } catch (err) {
      showToast('Failed to revoke grant: ' + err.message, 'error');
    }
  };

  // Run Autonomous Agent
  const handleRunAgent = async (overridePrompt) => {
    const promptToUse = overridePrompt || prompt;
    setIsRunningAgent(true);
    setAgentResponse(null);
    try {
      const res = await fetch(`${API_BASE}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptToUse,
          mode: agentMode,
          tenant_id: selectedTenant,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAgentResponse(data);
        const exp = {};
        data.traces?.forEach((_, i) => (exp[i] = true));
        setExpandedTrace(exp);
        await refreshAllData(selectedTenant);
        if (data.final_status === 'CONFIRMED') {
          showToast('Order Auto-Approved and Executed!', 'success');
        } else {
          showToast('Order held by Policy Firewall: routed to Human Sign-Off.', 'warning');
        }
      } else {
        showToast('Agent execution error: ' + res.statusText, 'error');
      }
    } catch (err) {
      showToast('Failed to trigger agent: ' + err.message, 'error');
    } finally {
      setIsRunningAgent(false);
    }
  };

  // Approve Order with Choice of ONE_TIME or RECURRENT_WINDOW
  const handleApproveOrder = async (orderId, approvalType = 'ONE_TIME', windowDays = 7, budget = 3000) => {
    try {
      const payload = {
        approval_type: approvalType,
        window_days: windowDays,
        frequency: 'WEEKLY',
        recurrent_budget_eur: budget,
        notes:
          approvalType === 'RECURRENT_WINDOW'
            ? `Standing ${windowDays}-day recurrent approval window`
            : 'One-time transaction sign-off',
      };

      const res = await authFetch(`${API_BASE}/orders/${orderId}/approve`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        if (approvalType === 'RECURRENT_WINDOW') {
          showToast(
            `Order ${orderId} CONFIRMED with ${windowDays}-Day Standing Recurrent Grant! Next orders will auto-confirm.`,
            'success'
          );
        } else {
          showToast(`Order ${orderId} CONFIRMED (One-Time Sign-Off). Future orders still require approval.`, 'success');
        }
        await refreshAllData(selectedTenant);
      } else if (res.status === 403) {
        const errJson = await res.json();
        showToast(`SECURITY BLOCK (403 Forbidden): ${errJson.detail}`, 'error');
      } else {
        const errJson = await res.json();
        showToast(`Approval failed: ${errJson.detail}`, 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  };

  // Reject Order (HITL)
  const handleRejectOrder = async (orderId) => {
    try {
      const res = await authFetch(`${API_BASE}/orders/${orderId}/reject`, {
        method: 'POST',
      });
      if (res.ok) {
        showToast(`Order ${orderId} REJECTED. Reserved stock released.`, 'warning');
        await refreshAllData(selectedTenant);
      } else if (res.status === 403) {
        showToast('403 Forbidden: Only Human Managers can reject orders!', 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  };

  // Feature Scenarios Showcase Presets
  const runScenario = async (scenarioNumber) => {
    if (scenarioNumber === 1) {
      // Scenario 1: Whitelist Guardrail Category Block (e.g. Croissants when client only allows Dairy)
      const p = 'I need 20 boxes of artisanal butter croissants by Monday. Find an option based on price and availability.';
      setPrompt(p);
      showToast('Running Scenario 1: Non-whitelisted category (Bakery) triggers Guardrail Firewall...', 'info');
      await handleRunAgent(p);
    } else if (scenarioNumber === 2) {
      // Scenario 2: One-Time Approval Flow
      const p = 'I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements.';
      setPrompt(p);
      showToast('Running Scenario 2: High-value order (€1,180 > €800) held for One-Time sign-off...', 'info');
      await handleRunAgent(p);
    } else if (scenarioNumber === 3) {
      // Scenario 3: Recurrent Windowed Transaction Flow
      const p = 'I need 1,000 litres of lactose-free milk by Monday.';
      setPrompt(p);
      showToast('Running Scenario 3: Testing standing recurrent window flow...', 'info');
      await handleRunAgent(p);
    }
  };

  const currentCustomer = customers.find((c) => c.tenant_id === selectedTenant) || {
    tenant_id: selectedTenant,
    tenant_name: 'Nordic Crown Hotels (Helsinki)',
    max_auto_approve_eur: 800.0,
    allowed_categories: ['dairy', 'plant-based'],
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg shadow-2xl border text-sm font-medium flex items-center gap-2.5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
              : toast.type === 'warning'
              ? 'bg-amber-950/90 border-amber-500/50 text-amber-200'
              : 'bg-blue-950/90 border-blue-500/50 text-blue-200'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <XCircle className="w-5 h-5 text-rose-400 shrink-0" />}
          {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />}
          {toast.type === 'info' && <Shield className="w-5 h-5 text-blue-400 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-4 lg:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-blue-700 to-indigo-500 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight text-base text-slate-50">AimoGate</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-semibold">
                {activePortal === 'buyer' ? 'Buyer Procurement Desk (Port 3000)' : 'Wholesaler Governance Tower (Port 8000)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              {activePortal === 'buyer'
                ? 'External Buyer Agent Configuration & Human Approval Inbox'
                : 'Valio Aimo Wholesale Network Monitor, Client Guardrails & Recurrent Governance'}
            </p>
          </div>
        </div>

        {/* Global Demo Controls */}
        <div className="flex items-center gap-3">
          {activePortal === 'buyer' && (
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-lg p-1 text-xs">
              <span className="text-[11px] font-mono text-slate-400 pl-2">Customer:</span>
              <select
                value={selectedTenant}
                onChange={(e) => handleTenantChange(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1 font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {customers.map((c) => (
                  <option key={c.tenant_id} value={c.tenant_id}>
                    {c.tenant_name} (€{c.max_auto_approve_eur} cap)
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleResetDemo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Reset warehouse stock, test orders and policies to default"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Demo</span>
          </button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* FEATURE SCENARIOS SHOWCASE BANNER (Visible on Buyer Desk & Tower)         */}
      {/* ========================================================================= */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950/40 to-slate-900 border-b border-slate-800/80 px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-300 font-semibold">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>Interactive Feature Scenarios:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Scenario 1: Category Whitelist Guardrail */}
          <button
            onClick={() => runScenario(1)}
            disabled={isRunningAgent}
            className="px-3 py-1.5 rounded-md font-semibold text-[11px] bg-slate-800/90 hover:bg-amber-950/70 hover:text-amber-200 text-amber-300 border border-amber-500/30 flex items-center gap-1.5 transition shadow"
          >
            <Ban className="w-3.5 h-3.5 text-amber-400" />
            <span>Scenario 1: Category Whitelist Guardrail Block</span>
          </button>

          {/* Scenario 2: One-Time Approval Flow */}
          <button
            onClick={() => runScenario(2)}
            disabled={isRunningAgent}
            className="px-3 py-1.5 rounded-md font-semibold text-[11px] bg-slate-800/90 hover:bg-blue-950/70 hover:text-blue-200 text-blue-300 border border-blue-500/30 flex items-center gap-1.5 transition shadow"
          >
            <UserCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>Scenario 2: One-Time Approval Flow</span>
          </button>

          {/* Scenario 3: Time-Windowed Recurrent Grant */}
          <button
            onClick={() => runScenario(3)}
            disabled={isRunningAgent}
            className="px-3 py-1.5 rounded-md font-semibold text-[11px] bg-slate-800/90 hover:bg-emerald-950/70 hover:text-emerald-200 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 transition shadow"
          >
            <Repeat className="w-3.5 h-3.5 text-emerald-400" />
            <span>Scenario 3: Time-Windowed Recurrent Flow</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: BUYER PORTAL (Configuring Agent & Confirming Orders - Port 3000)  */}
      {/* ========================================================================= */}
      {activePortal === 'buyer' && (
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 p-4 lg:p-6 overflow-y-auto">
          {/* LEFT COLUMN: Agent Configuration & Guardrail Rules (col-span-5) */}
          <section className="lg:col-span-5 flex flex-col gap-4">
            {/* Card 1: Agent & Role Identity */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Buyer Agent Profile & Role</h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  TENANT: {selectedTenant}
                </span>
              </div>

              {/* Role Toggle: Human Manager vs Agent */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-medium flex items-center justify-between">
                  <span>Current Web Session Role:</span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Token: {tokens[role]?.principal_type}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => {
                      setRole('human');
                      showToast('Switched session to Human F&B Manager (can approve/reject orders)', 'info');
                    }}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded text-xs font-semibold transition ${
                      role === 'human'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Human F&B Signer</span>
                  </button>

                  <button
                    onClick={() => {
                      setRole('agent');
                      showToast('Switched session to Buyer Agent (Forbidden from /approve)', 'warning');
                    }}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded text-xs font-semibold transition ${
                      role === 'agent'
                        ? 'bg-amber-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>Purchasing Agent</span>
                  </button>
                </div>
              </div>

              {/* Token Scope Explainer */}
              <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80 text-[11px] flex flex-col gap-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Authorized Principal Scopes:</span>
                  <span className="font-mono text-emerald-400">
                    {tokens[role]?.scopes?.join(', ') || 'offers:read, quotes:lock'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500">
                  {role === 'agent'
                    ? '⚠️ External agents CANNOT call /approve. AimoGate strictly rejects agent sign-offs with 403 Forbidden.'
                    : '✓ Human managers hold exclusive cryptographic authority to sign off on held orders and establish recurrent windows.'}
                </p>
              </div>
            </div>

            {/* Card 2: Whitelisted Guardrail Categories */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Guardrail Category Whitelist</h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  TOWER ENFORCED
                </span>
              </div>

              <p className="text-[11px] text-slate-400">
                The Wholesaler Tower maintains an immutable category whitelist for{' '}
                <span className="text-slate-200 font-semibold">{currentCustomer.tenant_name}</span>. Agent requests outside
                these categories are intercepted by the policy firewall.
              </p>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-semibold mr-1">Whitelisted:</span>
                  {(currentCustomer.allowed_categories || ['dairy']).map((cat) => (
                    <span
                      key={cat}
                      className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"
                    >
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>{cat}</span>
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-semibold mr-1">Restricted:</span>
                  {systemCategories
                    .filter((c) => !(currentCustomer.allowed_categories || []).includes(c))
                    .map((cat) => (
                      <span
                        key={cat}
                        className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800/80 text-slate-400 border border-slate-700/80 flex items-center gap-1"
                      >
                        <Lock className="w-2.5 h-2.5 text-rose-400" />
                        <span>{cat}</span>
                      </span>
                    ))}
                </div>
              </div>
            </div>

            {/* Card 3: Active Standing Recurrent Grants */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Active Recurrent Approval Windows</h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold">
                  {recurrentGrants.filter((g) => g.status === 'ACTIVE').length} Active
                </span>
              </div>

              {recurrentGrants.filter((g) => g.status === 'ACTIVE').length === 0 ? (
                <div className="border border-slate-800/80 bg-slate-950/40 rounded-lg p-3 text-center text-xs text-slate-500">
                  No active standing recurrent windows for this client. High-value transactions will require one-time approval.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {recurrentGrants
                    .filter((g) => g.status === 'ACTIVE')
                    .map((grant) => (
                      <div
                        key={grant.grant_id}
                        className="border border-indigo-500/40 bg-indigo-950/20 rounded-lg p-3 text-xs flex flex-col gap-2 shadow"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-indigo-300">{grant.grant_id}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                            EXPIRES IN {grant.days_remaining}D
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-300 flex flex-col gap-1">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Authorized Scope:</span>
                            <span className="font-semibold text-slate-200">
                              {grant.category.toUpperCase()} {grant.sku ? `(${grant.sku})` : ''}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Window Frequency:</span>
                            <span className="font-mono text-slate-300">{grant.frequency} Standing Order</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Budget Progress:</span>
                            <span className="font-mono font-bold text-emerald-400">
                              €{grant.current_period_spent_eur.toLocaleString()} / €
                              {grant.max_budget_per_period_eur.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(
                                100,
                                (grant.current_period_spent_eur / grant.max_budget_per_period_eur) * 100
                              )}%`,
                            }}
                          ></div>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-indigo-950">
                          <span className="text-[10px] text-slate-500 truncate">{grant.notes}</span>
                          <button
                            onClick={() => handleRevokeGrant(grant.grant_id)}
                            className="text-[10px] font-semibold text-rose-400 hover:text-rose-300 transition"
                          >
                            Revoke Window
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Card 4: Spend Cap Slider */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Autonomous Spend Cap</h3>
                </div>
                <span className="text-sm font-mono font-bold text-indigo-400">
                  €{policy.max_auto_approve_eur.toLocaleString()}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <input
                  type="range"
                  min="300"
                  max="2000"
                  step="50"
                  value={policy.max_auto_approve_eur}
                  onChange={(e) => handlePolicyChange(e.target.value)}
                  className="w-full accent-blue-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[11px] font-mono text-slate-500">
                  <span>€300 (Strict)</span>
                  <span>€800 (Default)</span>
                  <span>€1,500 (Auto-1000L)</span>
                  <span>€2,000 (Bulk)</span>
                </div>
              </div>
            </div>

            {/* Card 5: Autonomous Procurement Prompt */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Agent Order Prompt</h3>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400 text-[11px]">Mode:</span>
                  <button
                    onClick={() => setAgentMode(agentMode === 'deterministic' ? 'live' : 'deterministic')}
                    className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition"
                  >
                    {agentMode.toUpperCase()}
                  </button>
                </div>
              </div>

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-sans"
                placeholder="Enter procurement instructions for the agent..."
              />

              <button
                onClick={() => handleRunAgent()}
                disabled={isRunningAgent}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-semibold py-2 px-4 rounded-lg text-xs flex items-center justify-center gap-2 shadow-lg transition"
              >
                {isRunningAgent ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Executing Protocol Workflow...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Dispatch Agent to AimoGate</span>
                  </>
                )}
              </button>
            </div>
          </section>

          {/* RIGHT COLUMN: Execution Trace, Approvals & Ledger (col-span-7) */}
          <section className="lg:col-span-7 flex flex-col gap-4">
            {/* Step Trace (When agent runs) */}
            {agentResponse && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-semibold text-slate-100">Autonomous Agent Execution Trace</h3>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      agentResponse.final_status === 'CONFIRMED'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {agentResponse.final_status} ({agentResponse.execution_time_ms}ms)
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  {agentResponse.traces?.map((trace, idx) => (
                    <div
                      key={idx}
                      className="border border-slate-800/80 bg-slate-950/60 rounded-lg p-2.5 text-xs flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-mono">
                            {trace.step_number}
                          </span>
                          <span>{trace.title}</span>
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">{trace.action_type}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed pl-5.5">{trace.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Approvals Inbox (Orders Held by Policy Firewall) */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Orders Awaiting Human Sign-Off</h3>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                  {orders.filter((o) => o.status === 'PENDING_APPROVAL').length} Held
                </span>
              </div>

              {orders.filter((o) => o.status === 'PENDING_APPROVAL').length === 0 ? (
                <div className="border border-slate-800/80 bg-slate-950/40 rounded-lg p-5 text-center text-xs text-slate-500 flex flex-col items-center gap-1">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500/60" />
                  <span>All orders for this customer are confirmed or within autonomous limits.</span>
                </div>
              ) : (
                orders
                  .filter((o) => o.status === 'PENDING_APPROVAL')
                  .map((order) => (
                    <div
                      key={order.order_id}
                      className="border border-amber-500/40 bg-amber-950/10 rounded-lg p-3 text-xs flex flex-col gap-3 shadow-md"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-amber-300">{order.order_id}</span>
                        <span className="font-mono font-bold text-slate-100 text-sm">
                          €{order.total_eur?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-300 flex flex-col gap-1">
                        <div className="flex justify-between">
                          <span className="text-slate-400">PO Reference:</span>
                          <span className="font-mono">{order.po_reference}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Reserved Product:</span>
                          <span className="font-mono">
                            {order.sku} ({order.pack_quantity} packs / {order.total_litres}L)
                          </span>
                        </div>
                      </div>

                      {/* Policy Violations Held */}
                      {order.violation_reasons && (
                        <div className="bg-amber-950/40 border border-amber-500/30 rounded p-2 text-[11px] text-amber-200">
                          {order.violation_reasons.map((vr, i) => (
                            <div key={i} className="flex items-start gap-1.5">
                              <span className="text-amber-400">•</span>
                              <span>{vr}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Recurrent Window Parameters Selector */}
                      <div className="bg-slate-950/80 border border-slate-800/80 rounded p-2 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-semibold">Select Approval Mechanism:</span>
                          <div className="flex items-center gap-1 font-mono text-[10px]">
                            <span>Window:</span>
                            <select
                              value={approvalWindowDays}
                              onChange={(e) => setApprovalWindowDays(Number(e.target.value))}
                              className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5"
                            >
                              <option value={7}>7 Days (1 Week)</option>
                              <option value={14}>14 Days (2 Weeks)</option>
                              <option value={30}>30 Days (1 Month)</option>
                            </select>
                          </div>
                        </div>

                        {/* Action Buttons: One-Time vs Recurrent Window */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          <button
                            onClick={() => handleApproveOrder(order.order_id, 'ONE_TIME')}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-1.5 px-3 rounded text-xs flex items-center justify-center gap-1.5 shadow transition"
                            title="Approve this single order only. Subsequent orders will still require approval."
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>One-Time Approval</span>
                          </button>

                          <button
                            onClick={() =>
                              handleApproveOrder(
                                order.order_id,
                                'RECURRENT_WINDOW',
                                approvalWindowDays,
                                recurrentBudgetCap
                              )
                            }
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-1.5 px-3 rounded text-xs flex items-center justify-center gap-1.5 shadow transition"
                            title="Approve standing recurrent window. Future agent runs within window auto-confirm."
                          >
                            <Repeat className="w-3.5 h-3.5" />
                            <span>Recurrent Window ({approvalWindowDays}d)</span>
                          </button>
                        </div>

                        <div className="flex justify-end">
                          <button
                            onClick={() => handleRejectOrder(order.order_id)}
                            className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 transition"
                          >
                            Reject & Release Stock
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Order Ledger */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-100">
                    Order Ledger ({currentCustomer.tenant_name})
                  </h3>
                </div>
                <span className="text-xs text-slate-400 font-mono">{orders.length} Records</span>
              </div>

              <div className="border border-slate-800 rounded-lg overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-800/80 text-slate-400 font-mono text-[10px]">
                    <tr>
                      <th className="p-2.5">Order ID</th>
                      <th className="p-2.5">PO Ref</th>
                      <th className="p-2.5">Product</th>
                      <th className="p-2.5">Total EUR</th>
                      <th className="p-2.5">Approval Mode</th>
                      <th className="p-2.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-950/60 font-mono text-[11px]">
                    {orders.map((o) => (
                      <tr key={o.order_id} className="hover:bg-slate-800/40">
                        <td className="p-2.5 text-slate-200">{o.order_id}</td>
                        <td className="p-2.5 text-slate-400">{o.po_reference}</td>
                        <td className="p-2.5 text-slate-300">
                          {o.sku} ({o.total_litres}L)
                        </td>
                        <td className="p-2.5 font-bold text-slate-100">
                          €{o.total_eur?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              o.approval_type === 'RECURRENT_WINDOW'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : o.approval_type === 'ONE_TIME'
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {o.approval_type || 'AUTO'}
                          </span>
                        </td>
                        <td className="p-2.5 text-right">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              o.status === 'CONFIRMED'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : o.status === 'PENDING_APPROVAL'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {o.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-500">
                          No orders executed yet. Run the agent above!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: AIMOGATE WHOLESALER TOWER (Network Monitor - Port 8000)          */}
      {/* ========================================================================= */}
      {activePortal === 'aimogate' && (
        <main className="flex-1 flex flex-col gap-5 p-4 lg:p-6 overflow-y-auto">
          {/* Top Network KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-1 shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Active Customer Agents</span>
                <Building2 className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-2xl font-extrabold text-slate-100 font-mono">
                {networkOverview?.total_customers || customers.length}
              </div>
              <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>Guardrail Whitelists Active</span>
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-1 shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Total Wholesale GMV</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-extrabold text-slate-100 font-mono">
                €
                {networkOverview?.total_confirmed_gmv_eur?.toLocaleString(undefined, { minimumFractionDigits: 2 }) ||
                  '0.00'}
              </div>
              <span className="text-[11px] text-slate-400">
                Pending: €{networkOverview?.pending_approval_gmv_eur?.toLocaleString() || '0.00'}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-1 shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Standing Recurrent Grants</span>
                <Repeat className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-extrabold text-slate-100 font-mono">
                {networkOverview?.active_recurrent_grants_count || allRecurrentGrants.filter((g) => g.status === 'ACTIVE').length}
              </div>
              <span className="text-[11px] text-indigo-400">Time-Windowed Standing Authority</span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-1 shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Active 15-Min Stock Locks</span>
                <Package className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-extrabold text-slate-100 font-mono">
                {networkOverview?.stock_metrics?.reserved_packs_in_ttl || 0} packs
              </div>
              <span className="text-[11px] text-slate-400">
                Available: {networkOverview?.stock_metrics?.available_packs_total || 250} packs
              </span>
            </div>
          </div>

          {/* Section 1: Customer Fleet & Guardrail Category Whitelist Governance */}
          <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-100">Customer Fleet & Category Whitelist Guardrails</h3>
              </div>
              <span className="text-xs text-slate-400">
                Click any category pill to toggle/whitelist in real time
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {customers.map((c) => (
                <div key={c.tenant_id} className="border border-slate-800 rounded-lg p-3.5 flex flex-col gap-2.5 bg-slate-950/60">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-xs text-slate-100">{c.tenant_name}</div>
                      <div className="text-[10px] font-mono text-slate-400">{c.tenant_id}</div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        c.pending_approvals > 0
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {c.pending_approvals > 0 ? `${c.pending_approvals} HELD` : 'HEALTHY'}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-300 flex flex-col gap-1 border-t border-slate-800/80 pt-2 font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Autonomous Cap:</span>
                      <span className="font-bold text-blue-400">€{c.max_auto_approve_eur}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Standing Grants:</span>
                      <span className="text-indigo-400 font-bold">{c.active_grants_count || 0} active</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Confirmed Spend:</span>
                      <span className="text-emerald-400 font-bold">€{c.total_confirmed_spend_eur?.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Guardrail Whitelist Categories Management */}
                  <div className="flex flex-col gap-1.5 border-t border-slate-800/80 pt-2">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Guardrail Whitelist:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {systemCategories.map((cat) => {
                        const isAllowed = (c.allowed_categories || []).includes(cat);
                        return (
                          <button
                            key={cat}
                            onClick={() => handleToggleCategory(c.tenant_id, cat)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition flex items-center gap-0.5 ${
                              isAllowed
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                                : 'bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300'
                            }`}
                            title={`Click to ${isAllowed ? 'remove from' : 'add to'} whitelist`}
                          >
                            {isAllowed ? <Check className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5 text-slate-600" />}
                            <span>{cat}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <a
                    href={`http://localhost:3000?tenant=${c.tenant_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full mt-1 bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white text-[11px] font-medium py-1.5 px-2 rounded flex items-center justify-center gap-1 transition text-center"
                  >
                    <span>Open in Buyer Portal (Port 3000)</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
          </section>

          {/* Section 2: Time-Windowed Recurrent Grants Network Governance */}
          <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Repeat className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-slate-100">
                  Standing Recurrent Approval Windows Governance
                </h3>
              </div>
              <span className="text-xs text-slate-400">
                Network-wide standing grants authorizing recurring agent transactions without human latency
              </span>
            </div>

            <div className="border border-slate-800 rounded-lg overflow-hidden text-xs">
              <table className="w-full text-left">
                <thead className="bg-slate-800/80 text-slate-400 font-mono text-[10px]">
                  <tr>
                    <th className="p-2.5">Grant ID</th>
                    <th className="p-2.5">Customer Tenant</th>
                    <th className="p-2.5">Scope (Category / SKU)</th>
                    <th className="p-2.5">Recurrence Window</th>
                    <th className="p-2.5">Budget Consumed / Cap</th>
                    <th className="p-2.5">Approved By</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950/60 font-mono text-[11px]">
                  {allRecurrentGrants.map((g) => (
                    <tr key={g.grant_id} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-bold text-indigo-300">{g.grant_id}</td>
                      <td className="p-2.5 font-sans font-medium text-slate-200">{g.tenant_id}</td>
                      <td className="p-2.5 text-slate-300">
                        {g.category.toUpperCase()} {g.sku ? `(${g.sku})` : ''}
                      </td>
                      <td className="p-2.5 text-slate-300">
                        {g.frequency} ({g.window_days}d window, {g.days_remaining}d left)
                      </td>
                      <td className="p-2.5 text-slate-200">
                        €{g.current_period_spent_eur.toLocaleString()} / €{g.max_budget_per_period_eur.toLocaleString()}
                      </td>
                      <td className="p-2.5 text-slate-400">{g.approved_by}</td>
                      <td className="p-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            g.status === 'ACTIVE'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {g.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-right">
                        {g.status === 'ACTIVE' ? (
                          <button
                            onClick={() => handleRevokeGrant(g.grant_id)}
                            className="px-2 py-1 rounded text-[10px] font-semibold bg-rose-950/40 hover:bg-rose-900 text-rose-300 border border-rose-800/60 transition"
                          >
                            Revoke Grant
                          </button>
                        ) : (
                          <span className="text-slate-600 text-[10px]">REVOKED</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {allRecurrentGrants.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-slate-500">
                        No standing recurrent grants established yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: Global Cross-Customer Live Order Ledger */}
          <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-100">Cross-Customer Order Ledger</h3>
              </div>
              <span className="text-xs text-slate-400">Live feed across all connected purchasing bots</span>
            </div>

            <div className="border border-slate-800 rounded-lg overflow-hidden text-xs">
              <table className="w-full text-left">
                <thead className="bg-slate-800/80 text-slate-400 font-mono text-[10px]">
                  <tr>
                    <th className="p-2.5">Customer Tenant</th>
                    <th className="p-2.5">Order ID</th>
                    <th className="p-2.5">PO Ref</th>
                    <th className="p-2.5">Product SKU</th>
                    <th className="p-2.5">Volume</th>
                    <th className="p-2.5">Total EUR</th>
                    <th className="p-2.5">Approval Type</th>
                    <th className="p-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950/60 font-mono text-[11px]">
                  {allOrders.map((o) => (
                    <tr key={o.order_id} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-sans font-medium text-slate-200">{o.tenant_name}</td>
                      <td className="p-2.5 text-slate-300">{o.order_id}</td>
                      <td className="p-2.5 text-slate-400">{o.po_reference}</td>
                      <td className="p-2.5 text-slate-300">{o.sku}</td>
                      <td className="p-2.5 text-slate-400">{o.total_litres}L</td>
                      <td className="p-2.5 font-bold text-slate-100">
                        €{o.total_eur?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            o.approval_type === 'RECURRENT_WINDOW'
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : o.approval_type === 'ONE_TIME'
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {o.approval_type || 'AUTO'}
                        </span>
                      </td>
                      <td className="p-2.5 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            o.status === 'CONFIRMED'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : o.status === 'PENDING_APPROVAL'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-rose-500/20 text-rose-400'
                          }`}
                        >
                          {o.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {allOrders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-slate-500">
                        No orders recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 4: Zero-Trust Isolation & Global Audit Trail */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Zero-Trust Isolation Proof */}
            <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Zero-Trust ERP Isolation Proof</h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  SHIELD ACTIVE
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                {/* Raw Database */}
                <div className="border border-rose-500/30 bg-rose-950/10 rounded-lg p-3 flex flex-col gap-1.5">
                  <div className="font-semibold text-rose-300 text-[11px] flex items-center gap-1">
                    <Database className="w-3.5 h-3.5" />
                    Internal MariaDB (Confidential)
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 bg-slate-950/90 rounded p-2 border border-slate-800">
                    <div>internal_cost_eur: 9.62</div>
                    <div className="text-rose-400 font-bold">internal_margin_pct: 18.5%</div>
                    <div className="text-rose-400 font-bold">roadmap_status: UNRELEASED</div>
                  </div>
                </div>

                {/* Sanitized Public Payload */}
                <div className="border border-emerald-500/30 bg-emerald-950/10 rounded-lg p-3 flex flex-col gap-1.5">
                  <div className="font-semibold text-emerald-300 text-[11px] flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Agent Payload (Sanitized DTO)
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 bg-slate-950/90 rounded p-2 border border-slate-800">
                    <div>unit_contract_price_eur: 11.80</div>
                    <div className="text-emerald-400 font-bold">✓ Margins completely stripped</div>
                    <div className="text-emerald-400 font-bold">✓ Unreleased SKUs blocked</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Global Audit Trail */}
            <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Global Network Audit Trail</h3>
                </div>
                <span className="text-xs text-slate-400">All tenants</span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 max-h-48 overflow-y-auto text-[11px] font-mono flex flex-col gap-1.5">
                {globalAuditLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="text-slate-400 leading-tight border-b border-slate-900 pb-1">
                    <span className="text-slate-600 mr-2">{log.timestamp.slice(11, 19)}</span>
                    <span className="text-blue-400 font-semibold mr-1.5">[{log.tenant_name || log.tenant_id}]</span>
                    <span className="text-slate-200">{log.action}: </span>
                    <span className="text-slate-500">
                      {log.payload_summary?.order_id || JSON.stringify(log.payload_summary).slice(0, 35)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
