# AimoGate: Zero-Trust B2B Trade & Governance Gateway

> **Target Challenge:** Valio Aimo Agentic Commerce (Junction 2026)  
> **Protocol Objective:** Wholesaler-owned protocol boundary and deterministic policy firewall enabling external autonomous purchasing agents to discover contract pricing, verify cold-chain stock, lock fixed-price quotes, and submit orders—without exposing underlying ERP databases, internal margins, or unreleased product roadmaps.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL BUYER AGENTS                           │
│     (Hotel Procurement Bot / MCP Agents / Claude / Cursor / REST)      │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ JWT (principal_type: "agent")
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                               AIMOGATE                                 │
│                   Deterministic Policy Firewall                        │
│                                                                        │
│  [1. Zero-Trust DTO Projection]  ─── Strips margins, costs & roadmaps   │
│  [2. Two-Phase Stock Locking]    ─── 15-min atomic soft stock lock     │
│  [3. Policy Firewall Engine]     ─── Auto-Approve vs Hold for HITL     │
│  [4. Cryptographic RBAC Guard]   ─── Blocks agents from /approve (403) │
└─────────────────┬──────────────────────────────────────┬───────────────┘
                  │                                      │
                  ▼                                      ▼
┌───────────────────────────────────┐  ┌─────────────────────────────────┐
│     VALIO AIMO ERP & INVENTORY    │  │       HUMAN F&B MANAGER         │
│         (Isolated Schema)         │  │     (Approval Inbox & UI)       │
│  - Warehouse Stock Pools          │  │  - One-Click Sign-Off / Reject  │
│  - Contract Pricing Tiers         │  │  - Interactive Spend Slider     │
│  - Confidential Margins & Roadmap │  │  - Real-Time Audit Ledger       │
└───────────────────────────────────┘  └─────────────────────────────────┘
```

---

## 2. Acceptance Criteria (AC-1 to AC-5 Verification)

All 5 core Acceptance Criteria from the Requirements Document are verified by an automated test suite (`backend/tests/`):

| Criteria | Scenario | Expected Behavior | Status |
| :--- | :--- | :--- | :--- |
| **AC-1** | Query `1,000L lactose-free milk by Monday` | Returns `VA-LF-MILK-10L` (100 packs = €1,180.00) & `VA-LF-MILK-12X1L` (84 packs = €1,300.32). Hides `VA-ROADMAP-Q4-PRO` & `internal_margin_pct`. | **PASSED** |
| **AC-2** | Submitting €1,180.00 quote | Transitions order to `PENDING_APPROVAL`, holds 100 reserved packs in DB without overselling. | **PASSED** |
| **AC-3** | Agent calling `POST /api/v1/orders/{id}/approve` | Rejected with **`403 Forbidden`** (only `principal_type: "human"` authorized). | **PASSED** |
| **AC-4** | Manager approves in HITL Inbox | Order status becomes `CONFIRMED`, reserved stock permanently finalized, immutable audit entry written. | **PASSED** |
| **AC-5** | Spend cap set to €1,500 or 400L order (€472) | Exact same agent workflow results in immediate **`CONFIRMED` (`AUTO_APPROVED`)** status. | **PASSED** |

Run tests anytime:
```bash
source .venv/bin/activate
PYTHONPATH=. pytest backend/tests/ -v
```

---

## 3. Quickstart & Demo Setup

### Prerequisites
- Python 3.10+
- Node.js 18+ (Node 26 installed)

### 1. Install & Activate Backend Environment
```bash
source .venv/bin/activate
pip install -r <(pip freeze)
```

### 2. Start the Gateway & Control Plane UI
```bash
# Starts both the FastAPI REST/MCP backend and the built React Control Plane on port 8000
python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```
Open **[http://localhost:8000](http://localhost:8000)** in your browser.

*(Optional: For live frontend development with Hot-Module-Reload)*
```bash
cd frontend
npm run dev
# Vite runs at http://localhost:3000 and proxies /api to http://localhost:8000
```

---

## 4. Key Endpoints & Protocol APIs

### External Agent Tools
- `POST /api/v1/tools/search_offers` — Unit-normalized pack lookup with Zero-Trust field stripping.
- `POST /api/v1/tools/lock_quote` — Two-Phase atomic 15-minute stock reservation.
- `POST /api/v1/tools/commit_order` — Idempotent order submission evaluated by the Policy Firewall.

### Human Governance & Policy Control Plane
- `GET /api/v1/orders/pending` — Inbox of orders held for human review.
- `POST /api/v1/orders/{order_id}/approve` — Human manager sign-off (Role-guarded).
- `POST /api/v1/orders/{order_id}/reject` — Human manager rejection (releases reserved stock).
- `PATCH /api/v1/policies` — Live interactive spend cap slider (`max_auto_approve_eur`).
- `POST /api/v1/demo/reset` — One-click demo state reset (<50ms).
- `GET /api/v1/demo/inspect` — Side-by-side comparison of Raw MariaDB ERP records vs. Sanitized Gateway DTOs.
- `POST /api/v1/agent/run` — Autonomous Buyer Agent execution driver (Deterministic & Live Cloud modes).

### Model Context Protocol (MCP) Integration
AimoGate provides a native MCP server (`backend/app/mcp_server.py`) exposing:
1. `search_wholesale_offers`
2. `lock_wholesale_quote`
3. `commit_wholesale_order`

Run stdio MCP server for agentic IDEs / Cursor / Claude Desktop:
```bash
source .venv/bin/activate
python3 -m backend.app.mcp_server
```

---

## 5. Live Demo Walkthrough (For Hackathon Judges)

1. **Trigger High-Value Order (> €800 Cap):**
   - Click the chip `"1,000L Demo (Triggers Policy Hold > €800)"` and click **Trigger Autonomous Buyer Agent**.
   - Watch Pane 1 execute the 6-step reasoning sequence in <50ms.
   - Notice the order is **HELD by Policy Firewall** because €1,180.00 > €800.00.
   - Check Pane 3: The order appears in the **Human Approval Inbox** with 100 packs held.
2. **Demonstrate 403 Security Guard:**
   - Switch active role to **Buyer Agent** in the top bar.
   - Click **Approve Order** in the inbox.
   - Observe the security alert: **`403 Forbidden`** — autonomous agents cannot approve their own spend violations!
3. **Approve via Human Sign-Off:**
   - Switch active role back to **Human Approver**.
   - Click **Approve Order**.
   - Order transitions to **CONFIRMED**, stock is permanently finalized, and audit log is recorded.
4. **Test Dynamic Policy Threshold Slider (AC-5):**
   - In Center Pane, switch to **Policy Rules** tab.
   - Slide `max_auto_approve_eur` from €800 to **€1,500**.
   - Re-run the 1,000L agent workflow: It is now **IMMEDIATELY AUTO-APPROVED** without requiring human intervention!
5. **Inspect Zero-Trust Protection:**
   - In Center Pane, open **Payload Diff** tab to see raw database secrets (18.5% margin, unreleased barista protein milk) side-by-side with the sanitized public payload where confidential data is physically scrubbed.
