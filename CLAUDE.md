# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Seefmed Accounting — a full-stack accounting application for a healthcare/pharmacy business with Indian GST/TDS compliance and multi-location support. It syncs data from a shared inventory system and generates double-entry journal entries automatically.

## Development Commands

### Start both servers
```bash
./start.sh   # Backend on :8001, Frontend on :5174
```

### Backend (Django)
```bash
cd backend
DJANGO_SETTINGS_MODULE=accounting_project.settings.dev .venv/bin/python manage.py runserver 8001
.venv/bin/python manage.py migrate
.venv/bin/python manage.py makemigrations <app_name>
.venv/bin/python manage.py shell
```
Python venv is at `backend/.venv/`. Use `.venv/bin/python` directly (no activation needed).

### Frontend (React + Vite)
```bash
cd frontend
npm run dev        # Dev server on :5174
npm run build      # TypeScript check + production build
```

## Architecture

### Backend: Django REST Framework + JWT Auth

**Settings:** `accounting_project/settings/` — `base.py` (shared), `dev.py`, `prod.py`. Use `DJANGO_SETTINGS_MODULE=accounting_project.settings.dev` for local dev.

**Database:** SQLite, shared with inventory system at `/home/sahee/biloop/healthcare-inventory-management/backend/db.sqlite3`. The `inventory_reader` app uses unmanaged (`managed=False`) read-only proxy models pointing at inventory tables — never write to these.

**JWT Auth:** Shared SECRET_KEY with inventory app for cross-system token compatibility. Tokens: 8h access, 7d refresh with rotation.

**Django Apps:**

| App | Purpose |
|-----|---------|
| `core` | Chart of Accounts (hierarchical), company settings, dashboard KPIs |
| `journals` | Double-entry journal entries with post/reverse workflow |
| `gst_returns` | GSTR-1 and GSTR-3B generation from sales data |
| `tds` | TDS deductions and challan management |
| `reports` | Trial balance, P&L, balance sheet, ledger, aging reports |
| `sync` | Incremental sync from inventory DB → journal entries |
| `inventory_reader` | Read-only proxy models for inventory DB tables |
| `audit` | Immutable audit log of all mutations |

**Data Flow:**
Inventory DB → `inventory_reader` (proxy models) → `sync` service → `journals` (auto-generated entries via `JournalAutoGenerationService`) → `reports` / `gst_returns` / `tds` aggregate from journal data. `audit` logs all actions.

**Key Patterns:**
- Service layer for business logic (e.g., `journals/services.py`, `gst_returns/services.py`, `sync/services.py`)
- Posted journal entries are immutable — must be reversed, not edited
- Incremental sync uses `SyncLog.last_synced_id` to avoid reprocessing
- Indian fiscal year starts in April (configured in `AccountingSettings`)
- `audit.utils.log_action()` called on all mutations

**API prefix:** All endpoints under `/api/` — accounts, journals, gst, tds, reports, sync, audit.

### Frontend: React 18 + TypeScript + Vite

**Styling:** Tailwind CSS v4 + Radix UI primitives. Icons from lucide-react. Charts via Recharts. Toasts via Sonner.

**State Management:** Local component state only (useState/useEffect). No global state library. Each page fetches its own data.

**API Client:** `src/lib/api.ts` — Axios instance with `/api` base URL, auto-injects JWT Bearer token from localStorage. 401 responses trigger redirect to `/login`.

**Structure:**
- `src/pages/` — feature-based page components (self-contained with inline subcomponents)
- `src/components/Layout.tsx` — sidebar navigation + route outlet
- `src/lib/api.ts` — all API functions and TypeScript interfaces
- `src/lib/utils.ts` — formatting helpers (currency, dates, FY calc)

**Routing:** React Router v6 in `App.tsx`. `ProtectedRoute` checks localStorage for token. Vite proxies `/api` requests to backend on `:8001`.

## Important Conventions

- Account codes are standardized: 5100=Purchases, 1130=Receivable, 1140/1150/1160=CGST/SGST/IGST Input, 2110=Payable
- Journal entry numbers follow `JV-YYYY-XXXXXX` format
- GST periods use `YYYY-MM` format
- All monetary fields use Python `Decimal` / `DecimalField`
- Fiscal year and timezone are India-specific (Asia/Kolkata, April start)
