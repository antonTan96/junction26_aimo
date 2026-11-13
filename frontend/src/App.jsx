import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Sliders,
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
  Sparkles
} from 'lucide-react';

const API_BASE = '/api/v1';

export default function App() {
  // Global App State
  const [role, setRole] = useState('human'); // 'agent' | 'human' | 'admin'
  const [tokens, setTokens] = useState({});
  const [stock, setStock] = useState([]);
  const [orders, setOrders] = useState([]);
  const [policy, setPolicy] = useState({
    max_auto_approve_eur: 800.0,
    max_auto_approve_litres: 600.0,
    allowed_categories: ['dairy', 'plant-based'],
  });
  const [auditLogs, setAuditLogs] = useState([]);
  const [zeroTrustData, setZeroTrustData] = useState(null);

  // Agent Run State
  const [prompt, setPrompt] = useState(
    'I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.'
  );
  const [agentMode, setAgentMode] = useState('deterministic'); // 'deterministic' | 'live'
  const [isRunningAgent, setIsRunningAgent] = useState(false);
  const [agentResponse, setAgentResponse] = useState(null);
  const [expandedTrace, setExpandedTrace] = useState({});

  // Center Pane Tabs
  const [centerTab, setCenterTab] = useState('diff'); // 'diff' | 'policy'

  // UI Toast / Alerts
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

  // Load Initial Data
  const refreshAllData = async () => {
    try {
      // 1. Fetch tokens
      const tRes = await fetch(`${API_BASE}/demo/tokens`);
      if (tRes.ok) {
        const tData = await tRes.json();
        setTokens(tData);
      }

      // 2. Fetch stock
      const sRes = await fetch(`${API_BASE}/demo/stock`);
      if (sRes.ok) setStock(await sRes.json());

      // 3. Fetch policy
      const pRes = await fetch(`${API_BASE}/policies`);
      if (pRes.ok) setPolicy(await pRes.json());

      // 4. Fetch orders
      const oRes = await fetch(`${API_BASE}/orders`);
      if (oRes.ok) setOrders(await oRes.json());

      // 5. Fetch audit logs
      const aRes = await fetch(`${API_BASE}/orders/audit/logs`);
      if (aRes.ok) setAuditLogs(await aRes.json());

      // 6. Fetch zero-trust inspector data
      const zRes = await fetch(`${API_BASE}/demo/inspect`);
      if (zRes.ok) setZeroTrustData(await zRes.json());
    } catch (err) {
      console.error('Error refreshing data:', err);
    }
  };

  useEffect(() => {
    refreshAllData();
    const interval = setInterval(refreshAllData, 6000);
    return () => clearInterval(interval);
  }, []);

  // 1-Click Demo Reset
  const handleResetDemo = async () => {
    try {
      const res = await fetch(`${API_BASE}/demo/reset`, { method: 'POST' });
      if (res.ok) {
        showToast('Demo state reset successfully in 32ms!', 'success');
        setAgentResponse(null);
        await refreshAllData();
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
      const res = await authFetch(`${API_BASE}/policies`, {
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
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAgentResponse(data);
        // Expand all traces by default
        const exp = {};
        data.traces?.forEach((_, i) => (exp[i] = true));
        setExpandedTrace(exp);
        await refreshAllData();
        if (data.final_status === 'CONFIRMED') {
          showToast('Order Auto-Approved within spend limits!', 'success');
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
        showToast(`Order ${orderId} CONFIRMED by ${role}!`, 'success');
        await refreshAllData();
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
        showToast(`Order ${orderId} REJECTED. Stock released.`, 'info');
        await refreshAllData();
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

      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Brand & North Star Scenario */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                    AimoGate
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    Valio Aimo
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Zero-Trust Protocol
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Deterministic Trade & Governance Gateway for Autonomous Agentic Commerce
                </p>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-2 text-xs bg-slate-800/60 border border-slate-700/60 px-3 py-1.5 rounded-lg">
              <span className="text-slate-400">Buyer Tenant:</span>
              <span className="font-medium text-slate-200">Nordic Crown Hotels (hotel_nordic_group)</span>
            </div>
          </div>

          {/* Warehouse Stock Ticker & Quick Actions */}
          <div className="flex items-center gap-3">
            {/* Stock Pills */}
            <div className="hidden md:flex items-center gap-2 text-xs">
              {stock.slice(0, 2).map((s) => (
                <div
                  key={s.sku}
                  className="bg-slate-800/80 border border-slate-700/80 px-2.5 py-1.5 rounded-md flex items-center gap-2"
                >
                  <Package className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-mono text-slate-300">{s.sku}:</span>
                  <span className="text-emerald-400 font-bold">{s.available_packs} avail</span>
                  {s.reserved_packs > 0 && (
                    <span className="text-amber-400 font-bold">({s.reserved_packs} locked)</span>
                  )}
                </div>
              ))}
            </div>

            {/* Role Switcher Pill */}
            <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => {
                  setRole('agent');
                  showToast('Switched to Buyer Agent (Forbidden from /approve)', 'info');
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition ${
                  role === 'agent'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Bot className="w-3.5 h-3.5" />
                <span>Buyer Agent</span>
              </button>
              <button
                onClick={() => {
                  setRole('human');
                  showToast('Switched to Human F&B Manager (Authorized Approver)', 'info');
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-medium transition ${
                  role === 'human'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Human Approver</span>
              </button>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleResetDemo}
              title="Restore demo stock and clear test orders (<50ms)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset Demo</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main 3-Pane Body */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 lg:p-6 overflow-hidden">
        {/* ========================================================= */}
        {/* PANE 1: Buyer Agent Execution Trace (Cols 1-4)           */}
        {/* ========================================================= */}
        <section className="lg:col-span-4 flex flex-col bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-100">Buyer Agent Execution Trace</h2>
            </div>
            {/* Mode Toggle */}
            <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700/80 rounded-md p-0.5 text-xs">
              <button
                onClick={() => setAgentMode('deterministic')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                  agentMode === 'deterministic'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Deterministic Replay: 100% reliable offline demo"
              >
                Deterministic
              </button>
              <button
                onClick={() => setAgentMode('live')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                  agentMode === 'live'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Live Cloud LLM via Verda Nemotron"
              >
                Live Cloud
              </button>
            </div>
          </div>

          <div className="p-4 flex flex-col gap-3 flex-1 overflow-y-auto">
            {/* Prompt Input Box */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Autonomous Procurement Goal</span>
                <span className="text-[11px] text-slate-500 font-normal">Hotel Procurement Bot</span>
              </label>
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter purchasing requirement..."
                className="w-full bg-slate-950 border border-slate-700/80 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono resize-none leading-relaxed"
              />

              {/* Quick Demo Scenario Chips */}
              <div className="flex flex-wrap gap-1.5 text-xs">
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
                  <span>400L Demo (Auto-Approved &lt; €800)</span>
                </button>
              </div>

              {/* Run Agent CTA */}
              <button
                onClick={() => handleRunAgent()}
                disabled={isRunningAgent}
                className="w-full mt-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition disabled:opacity-50"
              >
                {isRunningAgent ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>Executing Protocol Sequence...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-amber-300" />
                    <span>Trigger Autonomous Buyer Agent</span>
                  </>
                )}
              </button>
            </div>

            {/* Trace Step Timeline */}
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>REASONING & TOOL TRACE</span>
                {agentResponse && (
                  <span className="text-[11px] font-mono text-emerald-400">
                    {agentResponse.execution_time_ms}ms • {agentResponse.mode_used}
                  </span>
                )}
              </div>

              {!agentResponse && !isRunningAgent && (
                <div className="border border-dashed border-slate-800 rounded-lg p-6 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                  <Bot className="w-8 h-8 text-slate-600" />
                  <p>Click a demo prompt chip or enter a goal above to start the agent workflow.</p>
                </div>
              )}

              {isRunningAgent && (
                <div className="border border-blue-500/30 bg-blue-950/20 rounded-lg p-4 flex flex-col items-center justify-center gap-2 text-xs text-blue-300 animate-pulse">
                  <Cpu className="w-6 h-6 animate-spin text-blue-400" />
                  <span>Agent querying AimoGate protocol gateway...</span>
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
                      {trace.tool_input && (
                        <div className="bg-slate-900/90 rounded p-2 text-[10px] font-mono text-slate-300 border border-slate-800 overflow-x-auto">
                          <span className="text-slate-500 block mb-1 font-sans font-semibold">
                            INPUT:
                          </span>
                          <pre>{JSON.stringify(trace.tool_input, null, 2)}</pre>
                        </div>
                      )}
                      {trace.tool_output && (
                        <div className="bg-slate-900/90 rounded p-2 text-[10px] font-mono text-slate-300 border border-slate-800 overflow-x-auto">
                          <span className="text-slate-500 block mb-1 font-sans font-semibold">
                            OUTPUT:
                          </span>
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

        {/* ========================================================= */}
        {/* PANE 2: Zero-Trust Payload & Policy Firewall (Cols 5-8)   */}
        {/* ========================================================= */}
        <section className="lg:col-span-4 flex flex-col bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          {/* Header & Tabs */}
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">Zero-Trust & Policy Firewall</h2>
            </div>
            <div className="flex items-center bg-slate-800 rounded-md p-0.5 text-xs">
              <button
                onClick={() => setCenterTab('diff')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                  centerTab === 'diff' ? 'bg-slate-700 text-white' : 'text-slate-400'
                }`}
              >
                Payload Diff
              </button>
              <button
                onClick={() => setCenterTab('policy')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                  centerTab === 'policy' ? 'bg-slate-700 text-white' : 'text-slate-400'
                }`}
              >
                Policy Rules
              </button>
            </div>
          </div>

          <div className="p-4 flex flex-col gap-4 flex-1 overflow-y-auto">
            {centerTab === 'diff' ? (
              /* TAB 1: Zero-Trust Projection Diff */
              <div className="flex flex-col gap-3">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5 text-xs text-blue-200 flex items-start gap-2">
                  <Shield className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] leading-relaxed">
                    <strong>Zero-Trust Projection (NFR-1 / M2):</strong> Internal ERP wholesale margins and
                    unreleased Q4 roadmaps are stripped physically before any agent payload leaves the server.
                  </p>
                </div>

                {/* Raw Database Record (Confidential View) */}
                <div className="border border-rose-500/30 bg-rose-950/10 rounded-lg p-3 text-xs flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-rose-300 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5" />
                      Internal MariaDB Record (Raw ERP)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono font-bold uppercase">
                      Confidential
                    </span>
                  </div>
                  <div className="bg-slate-950/80 rounded p-2.5 text-[11px] font-mono text-slate-300 border border-slate-800">
                    <div className="text-slate-400">SKU: "VA-LF-MILK-10L"</div>
                    <div className="text-slate-400">pack_format: "10L Bag-in-Box"</div>
                    <div className="text-rose-400 font-bold bg-rose-950/40 px-1 py-0.5 rounded my-1">
                      ⚠️ internal_margin_pct: 18.50% (STRIPPED)
                    </div>
                    <div className="text-rose-400 font-bold bg-rose-950/40 px-1 py-0.5 rounded my-1">
                      ⚠️ internal_cost_eur: 9.62 (STRIPPED)
                    </div>
                    <div className="text-rose-400 font-bold bg-rose-950/40 px-1 py-0.5 rounded my-1">
                      ⚠️ VA-ROADMAP-Q4-PRO: UNRELEASED (BLOCKED)
                    </div>
                  </div>
                </div>

                {/* Arrow Transition */}
                <div className="flex items-center justify-center text-slate-500 gap-2 text-xs">
                  <ArrowRight className="w-4 h-4 rotate-90 text-blue-400" />
                  <span className="font-mono text-[11px] text-blue-300">
                    AimoGate Zero-Trust DTO Serialization
                  </span>
                </div>

                {/* Sanitized Public DTO Record */}
                <div className="border border-emerald-500/30 bg-emerald-950/10 rounded-lg p-3 text-xs flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Sanitized PublicOfferDTO (Agent Exposed)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold uppercase">
                      Clean
                    </span>
                  </div>
                  <div className="bg-slate-950/80 rounded p-2.5 text-[11px] font-mono text-slate-300 border border-slate-800">
                    <div>sku: "VA-LF-MILK-10L"</div>
                    <div>unit_contract_price_eur: €11.80</div>
                    <div>price_per_litre_eur: €1.18/L</div>
                    <div>available_packs: 250</div>
                    <div>lead_time_feasible: true</div>
                    <div className="text-emerald-400 font-medium mt-1">
                      ✓ Margins, supplier costs, & roadmaps zeroed out
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* TAB 2: Deterministic Policy Firewall */
              <div className="flex flex-col gap-4">
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3 text-xs flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Sliders className="w-4 h-4 text-blue-400" />
                      Interactive Spend Cap Slider (S2 / AC-5)
                    </span>
                    <span className="font-mono text-sm font-bold text-blue-400">
                      €{policy.max_auto_approve_eur?.toLocaleString()}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Adjust the autonomous spend threshold. Any order total higher than this cap requires
                    human sign-off.
                  </p>

                  <input
                    type="range"
                    min="400"
                    max="2000"
                    step="50"
                    value={policy.max_auto_approve_eur}
                    onChange={(e) => handlePolicyChange(e.target.value)}
                    className="w-full accent-blue-500 cursor-pointer"
                  />

                  <div className="flex justify-between text-[10px] font-mono text-slate-500">
                    <span>€400 (Strict)</span>
                    <span className="text-amber-400 font-bold">€800 (Default Demo)</span>
                    <span>€1,500 (Permissive)</span>
                    <span>€2,000</span>
                  </div>
                </div>

                {/* Firewall Checklist */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Deterministic Firewall Rules
                  </span>

                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col gap-2 text-xs">
                    {/* Rule 1 */}
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div>
                        <div className="font-medium text-slate-200">Category Whitelist Check</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          Allowed: {policy.allowed_categories?.join(', ')}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                        PASS
                      </span>
                    </div>

                    {/* Rule 2 */}
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div>
                        <div className="font-medium text-slate-200">Volume Threshold Cap</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          Max: {policy.max_auto_approve_litres}L
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                        EVALUATED PER ORDER
                      </span>
                    </div>

                    {/* Rule 3 */}
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-slate-200">Spend Limit Cap</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          Max: €{policy.max_auto_approve_eur}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400">
                        ACTIVE
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ========================================================= */}
        {/* PANE 3: Manager Approval Inbox & Order Ledger (Cols 9-12) */}
        {/* ========================================================= */}
        <section className="lg:col-span-4 flex flex-col bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">Human Approval Inbox & Ledger</h2>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
              {orders.filter((o) => o.status === 'PENDING_APPROVAL').length} Pending
            </span>
          </div>

          <div className="p-4 flex flex-col gap-4 flex-1 overflow-y-auto">
            {/* Pending Approvals Inbox */}
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                Orders Held by Policy Firewall (M5)
              </span>

              {orders.filter((o) => o.status === 'PENDING_APPROVAL').length === 0 ? (
                <div className="border border-slate-800 bg-slate-950/40 rounded-lg p-5 text-center text-xs text-slate-500">
                  No orders currently held for human approval.
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

                      {/* Violation Reasons */}
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

                      {/* Approval Actions */}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleApproveOrder(order.order_id)}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-1.5 px-3 rounded text-xs flex items-center justify-center gap-1.5 shadow transition"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Approve Order</span>
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

            {/* Confirmed Orders Ledger */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Confirmed Order Ledger
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
                    {orders.slice(0, 5).map((o) => (
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
                        <td colSpan={4} className="p-3 text-center text-slate-500">
                          No orders recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Real-time Audit Trail */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Immutable Audit Trail
              </span>
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 max-h-44 overflow-y-auto text-[11px] font-mono flex flex-col gap-1.5">
                {auditLogs.slice(0, 8).map((log) => (
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
    </div>
  );
}
