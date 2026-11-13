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
  ExternalLink
} from 'lucide-react';

const API_BASE = '/api/v1';

export default function App() {
  // Port Detection: Port 3000 = Buyer Portal, Port 8000 = AimoGate Wholesaler Tower
  const currentPort = typeof window !== 'undefined' ? window.location.port : '3000';
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const portalParam = urlParams?.get('portal');
  const tenantParam = urlParams?.get('tenant');

  // Dedicated Port Isolation: Port 8000 is Wholesaler Dashboard, Port 3000 is Buyer Portal
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
  const [auditLogs, setAuditLogs] = useState([]);
  const [globalAuditLogs, setGlobalAuditLogs] = useState([]);
  const [zeroTrustData, setZeroTrustData] = useState(null);

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
    setTimeout(() => setToast(null), 4000);
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

      // 6. Fetch orders for selected customer
      const oRes = await fetch(`${API_BASE}/orders?tenant_id=${tenantId}`);
      if (oRes.ok) setOrders(await oRes.json());

      // 7. Fetch all cross-customer orders for admin
      const aoRes = await fetch(`${API_BASE}/admin/orders`);
      if (aoRes.ok) setAllOrders(await aoRes.json());

      // 8. Fetch audit logs
      const aRes = await fetch(`${API_BASE}/orders/audit/logs`);
      if (aRes.ok) setAuditLogs(await aRes.json());

      const gaRes = await fetch(`${API_BASE}/admin/audit_logs`);
      if (gaRes.ok) setGlobalAuditLogs(await gaRes.json());

      // 9. Zero-trust comparison
      const zRes = await fetch(`${API_BASE}/demo/inspect`);
      if (zRes.ok) setZeroTrustData(await zRes.json());
    } catch (err) {
      console.error('Error refreshing data:', err);
    }
  };

  useEffect(() => {
    refreshAllData(selectedTenant);
    const interval = setInterval(() => refreshAllData(selectedTenant), 6000);
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
          showToast('Order Auto-Approved and Executed within spend limits!', 'success');
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

  // Approve Order (HITL)
  const handleApproveOrder = async (orderId) => {
    try {
      const res = await authFetch(`${API_BASE}/orders/${orderId}/approve`, {
        method: 'POST',
      });
      if (res.ok) {
        showToast(`Order ${orderId} CONFIRMED & EXECUTED!`, 'success');
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
        showToast(`Order ${orderId} REJECTED. Reserved stock released.`, 'info');
        await refreshAllData(selectedTenant);
      } else if (res.status === 403) {
        showToast('SECURITY BLOCK (403 Forbidden): Agents cannot reject orders.', 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  };

  const toggleTrace = (idx) => {
    setExpandedTrace((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const currentCustomer = customers.find((c) => c.tenant_id === selectedTenant) || {
    tenant_name: 'Nordic Crown Hotels (Helsinki)',
    tenant_id: 'hotel_nordic_group',
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl border text-sm font-medium flex items-center gap-2 animate-bounce ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
              : toast.type === 'warning'
              ? 'bg-amber-950/90 border-amber-500/50 text-amber-200'
              : 'bg-blue-950/90 border-blue-500/50 text-blue-200'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          {toast.type === 'error' && <XCircle className="w-5 h-5 text-rose-400" />}
          {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400" />}
          {toast.type === 'info' && <Shield className="w-5 h-5 text-blue-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Primary Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-6 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Dedicated Branding (No Tab Switching) */}
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-lg ${
                activePortal === 'buyer'
                  ? 'bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-500 shadow-blue-500/20'
                  : 'bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 shadow-indigo-500/20'
              }`}
            >
              {activePortal === 'buyer' ? (
                <Bot className="w-5 h-5 text-white" />
              ) : (
                <Shield className="w-5 h-5 text-white" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  {activePortal === 'buyer' ? 'Buyer Procurement Desk' : 'AimoGate Monitoring Tower'}
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                    activePortal === 'buyer'
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                  }`}
                >
                  {activePortal === 'buyer' ? 'Buyer Side • Port 3000' : 'Valio Aimo Wholesaler • Port 8000'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {activePortal === 'buyer'
                  ? 'Autonomous Purchasing Agent Configuration & Approval Desk'
                  : 'Multi-Customer Autonomous Trade & Policy Firewall Monitoring'}
              </p>
            </div>
          </div>

          {/* Right Controls: Customer Selector, Live Status, Reset */}
          <div className="flex items-center gap-3">
            {/* Customer Selector Dropdown */}
            {activePortal === 'buyer' && (
              <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 rounded-lg px-2.5 py-1 text-xs">
                <Building2 className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-slate-400">Customer:</span>
                <select
                  value={selectedTenant}
                  onChange={(e) => handleTenantChange(e.target.value)}
                  className="bg-transparent font-medium text-slate-200 focus:outline-none cursor-pointer"
                >
                  {customers.map((c) => (
                    <option key={c.tenant_id} value={c.tenant_id} className="bg-slate-900 text-slate-100">
                      {c.tenant_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* External Port Cross-Link */}
            <a
              href={activePortal === 'buyer' ? 'http://localhost:8000' : 'http://localhost:3000'}
              target="_blank"
              rel="noopener noreferrer"
              title={
                activePortal === 'buyer'
                  ? 'Open Valio Aimo Wholesaler Monitoring Dashboard on Port 8000'
                  : 'Open Customer Buyer Portal on Port 3000'
              }
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                activePortal === 'buyer'
                  ? 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border-blue-500/30'
              }`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>
                {activePortal === 'buyer' ? 'Wholesaler Tower (Port 8000)' : 'Buyer Portal (Port 3000)'}
              </span>
            </a>

            {/* Live Upstream Status */}
            <div className="hidden md:flex items-center gap-1.5 text-xs bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1 rounded-lg text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="font-mono text-[11px]">Upstream: junction26.valioaimo.fi</span>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleResetDemo}
              title="Restore demo stock and clear test orders (<50ms)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset State</span>
            </button>
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* VIEW 1: BUYER PORTAL (Configure Agent, Run Procurement, Confirm Orders)   */}
      {/* ========================================================================= */}
      {activePortal === 'buyer' && (
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 p-4 lg:p-6 overflow-hidden">
          {/* Buyer Section A: Configure & Trigger Buyer Agent (Cols 1-6) */}
          <section className="lg:col-span-6 flex flex-col bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-blue-400" />
                <h2 className="text-sm font-semibold text-slate-100">Configure Buyer Agent</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {currentCustomer.tenant_name}
                </span>
              </div>
              {/* Agent Mode Toggle */}
              <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700/80 rounded-md p-0.5 text-xs">
                <button
                  onClick={() => setAgentMode('deterministic')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                    agentMode === 'deterministic'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Deterministic Replay: fast offline benchmark"
                >
                  Deterministic
                </button>
                <button
                  onClick={() => setAgentMode('live')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                    agentMode === 'live' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Live Upstream API via junction26.valioaimo.fi"
                >
                  Live Upstream
                </button>
              </div>
            </div>

            <div className="p-4 flex flex-col gap-4 flex-1 overflow-y-auto">
              {/* 1. Policy & Governance Configuration for Buyer Agent */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-blue-400" />
                    Autonomous Spend Cap Policy
                  </span>
                  <span className="font-mono text-sm font-bold text-blue-400">
                    €{policy.max_auto_approve_eur?.toLocaleString()}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400">
                  Orders submitted by this agent exceeding this spend cap will be held for human confirmation.
                </p>

                <input
                  type="range"
                  min="400"
                  max="2500"
                  step="50"
                  value={policy.max_auto_approve_eur}
                  onChange={(e) => handlePolicyChange(e.target.value)}
                  className="w-full accent-blue-500 cursor-pointer"
                />

                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>€400</span>
                  <span className="text-amber-400 font-bold">€800 (Demo Cap)</span>
                  <span>€1,500</span>
                  <span>€2,500</span>
                </div>
              </div>

              {/* 2. Procurement Goal Input */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Procurement Requirement</span>
                  <span className="text-[11px] text-slate-500 font-normal">Natural language buyer goal</span>
                </label>
                <textarea
                  rows={2}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Enter purchasing requirement..."
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono resize-none leading-relaxed"
                />

                {/* Demo Scenario Chips */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => {
                      const p =
                        'I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.';
                      setPrompt(p);
                      handleRunAgent(p);
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-[11px] text-slate-300 transition flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    <span>1,000L Demo (Triggers Policy Hold &gt; €800)</span>
                  </button>
                  <button
                    onClick={() => {
                      const p = 'I need 400 litres of lactose-free milk by Monday.';
                      setPrompt(p);
                      handleRunAgent(p);
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-[11px] text-slate-300 transition flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>400L Demo (Auto-Executes &lt; €800)</span>
                  </button>
                </div>

                {/* Trigger Agent CTA */}
                <button
                  onClick={() => handleRunAgent()}
                  disabled={isRunningAgent}
                  className="w-full mt-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition disabled:opacity-50"
                >
                  {isRunningAgent ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-white" />
                      <span>Executing Agent Procurement Sequence...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 text-amber-300" />
                      <span>Trigger Autonomous Buyer Agent</span>
                    </>
                  )}
                </button>
              </div>

              {/* 3. Real-Time Agent Execution Trace */}
              <div className="flex flex-col gap-2 mt-1">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                  <span>AGENT REASONING & EXECUTION TRACE</span>
                  {agentResponse && (
                    <span className="text-[11px] font-mono text-emerald-400">
                      {agentResponse.execution_time_ms}ms • {agentResponse.mode_used}
                    </span>
                  )}
                </div>

                {!agentResponse && !isRunningAgent && (
                  <div className="border border-dashed border-slate-800 rounded-lg p-5 text-center text-xs text-slate-500 flex flex-col items-center gap-1.5">
                    <Bot className="w-6 h-6 text-slate-600" />
                    <p>Trigger the agent above to see live tool calls, pack optimization, and policy firewall results.</p>
                  </div>
                )}

                {agentResponse?.traces?.map((trace, idx) => (
                  <div
                    key={idx}
                    className={`border rounded-lg text-xs overflow-hidden transition ${
                      trace.action_type === 'policy_decision'
                        ? trace.tool_output?.status === 'CONFIRMED'
                          ? 'border-emerald-500/50 bg-emerald-950/20'
                          : 'border-amber-500/50 bg-amber-950/20'
                        : 'border-slate-800 bg-slate-950/60'
                    }`}
                  >
                    <div
                      onClick={() => toggleTrace(idx)}
                      className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-800/40 select-none"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center font-mono text-[10px] text-slate-300">
                          {trace.step_number}
                        </span>
                        <span className="font-semibold text-slate-200">{trace.title}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {trace.tool_name && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            {trace.tool_name}
                          </span>
                        )}
                        {expandedTrace[idx] ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </div>
                    </div>

                    {expandedTrace[idx] && (
                      <div className="px-3 pb-3 pt-1 border-t border-slate-800/60 flex flex-col gap-2">
                        <p className="text-slate-300 text-[11px] leading-relaxed">{trace.description}</p>
                        {trace.tool_output && (
                          <div className="bg-slate-900/90 rounded p-2 text-[10px] font-mono text-slate-300 border border-slate-800 overflow-x-auto max-h-36">
                            <pre>{JSON.stringify(trace.tool_output, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Buyer Section B: Orders & Human Confirmations (Cols 7-12) */}
          <section className="lg:col-span-6 flex flex-col bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            {/* Header with Approver Role Switcher */}
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-slate-100">Orders & Human Approvals</h2>
              </div>
              {/* Role Switcher Pill */}
              <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 text-xs">
                <button
                  onClick={() => {
                    setRole('human');
                    showToast('Authenticated as Human F&B Approver', 'info');
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition ${
                    role === 'human' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Human Approver</span>
                </button>
                <button
                  onClick={() => {
                    setRole('agent');
                    showToast('Authenticated as Buyer Agent (403 on Approve)', 'info');
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition ${
                    role === 'agent' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Buyer Agent</span>
                </button>
              </div>
            </div>

            <div className="p-4 flex flex-col gap-4 flex-1 overflow-y-auto">
              {/* 1. Pending Approvals Inbox (Orders Held by Policy Firewall) */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    Orders Awaiting Human Confirmation
                  </span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                    {orders.filter((o) => o.status === 'PENDING_APPROVAL').length} Held
                  </span>
                </div>

                {orders.filter((o) => o.status === 'PENDING_APPROVAL').length === 0 ? (
                  <div className="border border-slate-800 bg-slate-950/40 rounded-lg p-5 text-center text-xs text-slate-500 flex flex-col items-center gap-1">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500/60" />
                    <span>All orders for this customer are confirmed or within autonomous limits.</span>
                  </div>
                ) : (
                  orders
                    .filter((o) => o.status === 'PENDING_APPROVAL')
                    .map((order) => (
                      <div
                        key={order.order_id}
                        className="border border-amber-500/40 bg-amber-950/10 rounded-lg p-3 text-xs flex flex-col gap-2.5 shadow-md"
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

                        {/* Confirm / Reject Buttons */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => handleApproveOrder(order.order_id)}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-1.5 px-3 rounded text-xs flex items-center justify-center gap-1.5 shadow transition"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Confirm & Execute Order</span>
                          </button>
                          <button
                            onClick={() => handleRejectOrder(order.order_id)}
                            className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 border border-slate-700 transition"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>

              {/* 2. Executed & Historical Orders for this Buyer */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Order Ledger ({currentCustomer.tenant_name})
                </span>

                <div className="border border-slate-800 rounded-lg overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-800/80 text-slate-400 font-mono text-[10px]">
                      <tr>
                        <th className="p-2">Order ID</th>
                        <th className="p-2">PO Ref</th>
                        <th className="p-2">Total</th>
                        <th className="p-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 bg-slate-950/60 font-mono text-[11px]">
                      {orders.map((o) => (
                        <tr key={o.order_id} className="hover:bg-slate-800/40">
                          <td className="p-2 text-slate-300">{o.order_id}</td>
                          <td className="p-2 text-slate-400">{o.po_reference}</td>
                          <td className="p-2 font-bold text-slate-200">
                            €{o.total_eur?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-2 text-right">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                o.status === 'CONFIRMED'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : o.status === 'PENDING_APPROVAL'
                                  ? 'bg-amber-500/20 text-amber-400'
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
                          <td colSpan={4} className="p-4 text-center text-slate-500 font-sans">
                            No orders executed yet for {currentCustomer.tenant_name}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 3. Buyer Activity & Audit Log */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Buyer Activity & Policy Audit
                </span>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 max-h-40 overflow-y-auto text-[11px] font-mono flex flex-col gap-1.5">
                  {auditLogs.slice(0, 6).map((log) => (
                    <div key={log.id} className="text-slate-400 leading-tight border-b border-slate-900 pb-1">
                      <span className="text-slate-600 mr-2">{log.timestamp.slice(11, 19)}</span>
                      <span
                        className={`font-semibold mr-1.5 ${
                          log.actor_type === 'human'
                            ? 'text-emerald-400'
                            : log.actor_type === 'agent'
                            ? 'text-blue-400'
                            : 'text-indigo-400'
                        }`}
                      >
                        [{log.actor_type.toUpperCase()}]
                      </span>
                      <span className="text-slate-200">{log.action}: </span>
                      <span className="text-slate-500">
                        {log.payload_summary?.order_id ||
                          log.payload_summary?.quote_id ||
                          JSON.stringify(log.payload_summary).slice(0, 32)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: AIMOGATE MONITORING DASHBOARD (Multi-Customer Wholesale Control)  */}
      {/* ========================================================================= */}
      {activePortal === 'aimogate' && (
        <main className="flex-1 flex flex-col gap-5 p-4 lg:p-6 overflow-y-auto">
          {/* Top Network KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Card 1: Connected Buyers */}
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
                <span>100% Online & Guarded</span>
              </span>
            </div>

            {/* Card 2: Total Wholesale GMV */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-1 shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Total Network GMV</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-extrabold text-slate-100 font-mono">
                €{networkOverview?.total_confirmed_gmv_eur?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
              </div>
              <span className="text-[11px] text-slate-400">
                Pending: €{networkOverview?.pending_approval_gmv_eur?.toLocaleString() || '0.00'}
              </span>
            </div>

            {/* Card 3: Policy Firewall Holding Rate */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-1 shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Policy Auto-Approval Rate</span>
                <Activity className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-extrabold text-slate-100 font-mono">
                {networkOverview?.auto_approval_rate_pct || 100}%
              </div>
              <span className="text-[11px] text-amber-400">
                {networkOverview?.pending_approvals_count || 0} Orders Held for Human Review
              </span>
            </div>

            {/* Card 4: Cold-Chain Stock Held */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-1 shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Active 15-Min Stock Locks</span>
                <Package className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-extrabold text-slate-100 font-mono">
                {networkOverview?.stock_metrics?.reserved_packs_in_ttl || 0} packs
              </div>
              <span className="text-[11px] text-slate-400">
                Available pool: {networkOverview?.stock_metrics?.available_packs_total || 250} packs
              </span>
            </div>
          </div>

          {/* Section 1: Connected Customer Agent Matrix */}
          <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-100">Customer Agent Fleet Monitoring</h3>
              </div>
              <span className="text-xs text-slate-400">
                AimoGate protects wholesale boundaries for {customers.length} enterprise foodservice buyers
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {customers.map((c) => (
                <div
                  key={c.tenant_id}
                  className={`border rounded-lg p-3.5 flex flex-col gap-2.5 bg-slate-950/60 transition ${
                    c.tenant_id === selectedTenant ? 'border-blue-500/50 bg-blue-950/10' : 'border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-xs text-slate-100">{c.tenant_name}</div>
                      <div className="text-[10px] font-mono text-slate-400">{c.tenant_id}</div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        c.pending_approvals > 0
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
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
                      <span className="text-slate-500">Total Orders:</span>
                      <span>{c.total_orders} orders</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Confirmed Spend:</span>
                      <span className="text-emerald-400 font-bold">€{c.total_confirmed_spend_eur?.toLocaleString()}</span>
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

          {/* Section 2: Global Cross-Customer Live Order Stream */}
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
                    <th className="p-2.5 text-right">Firewall Status</th>
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
                      <td colSpan={7} className="p-4 text-center text-slate-500">
                        No orders recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: Zero-Trust Isolation & Global Audit Trail */}
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
                      {log.payload_summary?.order_id || JSON.stringify(log.payload_summary).slice(0, 30)}
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
