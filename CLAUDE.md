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

**Database:** Postgres, shared with the healthcare-inventory and dashboard apps (same `healthcare_inv` DB). Connection resolution order: `DATABASE_URL` → `POSTGRES_*` env vars → defaults. On WSL2 the host is auto-derived from the default-route gateway (the Windows host IP changes per session), so don't hardcode it. `CONN_MAX_AGE` is intentionally 0 in dev — long-lived connections exhaust `max_connections` when runserver, shells, and pipelines share the DB. The `inventory_reader` app uses unmanaged (`managed=False`) read-only proxy models pointing at inventory tables — never write to these.

**JWT Auth:** Shared SECRET_KEY with inventory app for cross-system token compatibility. Tokens: 8h access, 7d refresh with rotation.

**Multi-location:** Requests carry an `X-Location-Id` header. `core.middleware.ActiveLocationMiddleware` resolves it (eagerly for session auth, lazily via `core.mixins.get_active_location` for JWT) and stashes `request.active_location` / `request.active_location_id`. `core.mixins.LocationFilterMixin` is the standard way to scope a viewset's queryset and auto-fill `location_id` on create. Admin/superusers can see all locations when no header is sent; regular users without a valid header get an empty queryset. Journal entries and vouchers require `location_id` end-to-end — do not bypass this.

**Django Apps:**

| App | Purpose |
|-----|---------|
| `core` | Chart of Accounts (hierarchical), company settings, dashboard KPIs, active-location middleware/mixin |
| `journals` | Double-entry journal entries (post/reverse workflow) + recurring journals |
| `gst_returns` | GSTR-1 and GSTR-3B generation from sales data |
| `tds` | TDS deductions and challan management |
| `reports` | Trial balance, P&L, balance sheet, ledger, aging reports |
| `sync` | Incremental sync from inventory DB → journal entries |
| `inventory_reader` | Read-only proxy models for inventory DB tables |
| `audit` | Immutable audit log of all mutations |
| `parties` | Customer/supplier master (separate from inventory's party records) |
| `bills` | Vendor bills and bill-payment vouchers |
| `banking` | Bank accounts, transactions, reconciliation |
| `expenses` | Direct expense vouchers |
| `payroll` | Employees, salary structures, payroll runs |

**Data Flow:**
Inventory DB → `inventory_reader` (proxy models) → `sync` service → `journals` (auto-generated entries via `JournalAutoGenerationService`) → `reports` / `gst_returns` / `tds` aggregate from journal data. Manual vouchers from `bills` / `banking` / `expenses` / `payroll` also post into `journals`. `audit` logs all mutations.

**Key Patterns:**
- Service layer for business logic (e.g., `journals/services.py`, `gst_returns/services.py`, `sync/services.py`, and each new app's `services.py`)
- Posted journal entries are immutable — must be reversed, not edited
- Incremental sync uses `SyncLog.last_synced_id` to avoid reprocessing
- Indian fiscal year starts in April (`ACCOUNTING_FY_START_MONTH = 4` in `base.py`; per-tenant overrides in `AccountingSettings`)
- `audit.utils.log_action()` called on all mutations
- **Inventory is perpetual-only**: every purchase debits `1190 Closing Stock` (ASSET); every sale credits `1190` and debits `5560 Cost of Goods Sold` at weighted-avg cost via `JournalAutoGenerationService._post_cogs`. Account `5100 Purchases` exists for non-inventory expense routing but is never touched by the sync flow. There is no periodic-mode toggle and no period-end closing-stock JV.

**API prefix:** All endpoints under `/api/` — `auth/token/`, `accounts/`, `journals/`, `gst/`, `tds/`, `reports/`, `sync/`, `audit/`, `payroll/`, `parties/`, `bills/`, `banking/`, `expenses/`. JWT obtain/refresh/verify live at `/api/auth/token[/refresh|/verify]/`.

### Frontend: React 18 + TypeScript + Vite

**Styling:** Tailwind CSS v4 + Radix UI primitives. Icons from lucide-react. Charts via Recharts. Toasts via Sonner.

**State Management:** Local component state only (useState/useEffect). The one exception is `LocationContext` (`src/contexts/LocationContext.tsx`) — wraps the app, loads the user's locations from `/api/accounts/locations/`, persists the active selection in `localStorage` under `accounting_active_location`, and is read via the `useLocation()` hook. The Axios client reads from the same localStorage key and sends it as `X-Location-Id` on every request — so any page hitting a location-scoped endpoint just needs the provider in the tree, not explicit header plumbing.

**API Client:** `src/lib/api.ts` — Axios instance with `/api` base URL, auto-injects JWT Bearer token and `X-Location-Id` from localStorage. 401 responses trigger redirect to `/login`.

**Structure:**
- `src/pages/` — feature-based page components. Top-level files are single-page features; subdirectories (`banking/`, `bills/`, `expenses/`, `gst/`, `journals/`, `parties/`, `reports/`) hold multi-screen feature modules.
- `src/components/Layout.tsx` — sidebar navigation + route outlet (location switcher lives here)
- `src/contexts/LocationContext.tsx` — active-location provider/hook
- `src/lib/api.ts` — all API functions and TypeScript interfaces
- `src/lib/utils.ts` — formatting helpers (currency, dates, FY calc)

**Routing:** React Router v6 in `App.tsx`. `ProtectedRoute` checks localStorage for token. Vite proxies `/api` requests to backend on `:8001`.

## Important Conventions

- Account codes are standardized: 5100=Purchases, 1130=Receivable, 1140/1150/1160=CGST/SGST/IGST Input, 2110=Payable
- Journal entry numbers follow `JV-YYYY-XXXXXX` format
- GST periods use `YYYY-MM` format
- All monetary fields use Python `Decimal` / `DecimalField`
- Fiscal year and timezone are India-specific (Asia/Kolkata, April start)
