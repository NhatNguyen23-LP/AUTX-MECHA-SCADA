Mecha SCADA — Node.js IoT API

Overview
- Lightweight Express service to ingest IoT telemetry into the existing SQL Server schema used by the Flask app.
- Endpoints protected by a simple API key (header `x-api-key`).

Quick start
1. Copy `.env.example` to `.env` and fill your SQL Server credentials, `API_KEY`, and optional `PORT`.
2. From `node_api/`:

```bash
npm install
npm run start
```

Environment variables
- `DB_SERVER` (eg. `MinhNhat\\\\SQLNHATTD`)
- `DB_USER` (SQL login)
- `DB_PASSWORD`
- `DB_NAME` (MechaSCADA_V2)
- `DB_ENCRYPT` (true/false)
- `API_KEY` (shared secret)
- `PORT` (default 4000)

Endpoints
- `POST /iot/ingest` — body: `{ machineId, temperature, noise, timestamp? }` inserts into `Production_Logs`.
- `POST /iot/status` — body: `{ machineId, statusName }` inserts into `Machine_Status`.
- `GET /iot/chart` — returns `{ labels, temp, noise }` similar to Flask `/api/production-data`.
- `GET /iot/machines` — returns machines with latest status similar to Flask `/api/system-status`.

Simulator
- `npm run simulate` runs `src/simulator.js` which posts random telemetry every 5s. Set `SIM_MACHINE_ID` in `.env` to target a real machine.

Notes
- Use parameterized queries; do not expose this API publicly without stronger auth (JWT, mTLS, or network restrictions).
- If running Node on Linux while SQL Server is Windows-authenticated, prefer SQL auth or configure Kerberos.

Flask proxy (recommended)
- To avoid exposing the Node API key in browser JS, the Flask app includes proxy endpoints that call Node on the server-side.
- Set the following env vars for the Flask process (where `app.py` runs):
	- `NODE_API_URL` (e.g. `http://localhost:4000`)
	- `NODE_API_KEY` (the same API key used by this Node service)

Examples
- Health check:
```bash
curl http://localhost:4000/health
```

- Ingest sample data (direct to Node):
```bash
curl -X POST http://localhost:4000/iot/ingest -H "Content-Type: application/json" -H "x-api-key: your_key" -d '{"machineId":"<GUID>","temperature":72.5,"noise":60.1}'
```

- Use Flask proxy (no API key in browser):
```bash
# From the browser UI the app will call: /api/node/production-data
curl http://localhost:5000/api/node/production-data
```
