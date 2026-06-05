const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../db');

// POST /iot/ingest
router.post('/ingest', async (req, res) => {
  const { machineId, temperature, noise, timestamp } = req.body;
  if (!machineId || temperature == null || noise == null) return res.status(400).json({ error: 'machineId, temperature and noise required' });
  try {
    const pool = await poolPromise;
    const reqDb = pool.request();
    reqDb.input('machineId', sql.UniqueIdentifier, machineId);
    reqDb.input('temperature', sql.Decimal(9,2), temperature);
    reqDb.input('noise', sql.Decimal(9,2), noise);
    if (timestamp) reqDb.input('ts', sql.DateTime, new Date(timestamp));

    const q = timestamp
      ? `INSERT INTO Production_Logs (MachineID, Temperature, NoiseLevel, Timestamp) VALUES (@machineId, @temperature, @noise, @ts)`
      : `INSERT INTO Production_Logs (MachineID, Temperature, NoiseLevel, Timestamp) VALUES (@machineId, @temperature, @noise, GETDATE())`;

    await reqDb.query(q);
    res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /iot/status
router.post('/status', async (req, res) => {
  const { machineId, statusName } = req.body;
  if (!machineId || !statusName) return res.status(400).json({ error: 'machineId and statusName required' });
  try {
    const pool = await poolPromise;
    const reqDb = pool.request();
    reqDb.input('machineId', sql.UniqueIdentifier, machineId);
    reqDb.input('statusName', sql.NVarChar(100), statusName);
    await reqDb.query(`INSERT INTO Machine_Status (MachineID, StatusName) VALUES (@machineId, @statusName)`);
    res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /iot/chart  -> mirror Flask /api/production-data
router.get('/chart', async (req, res) => {
  try {
    const pool = await poolPromise;
    const rows = await pool.request()
      .query("SELECT TOP 20 Temperature, NoiseLevel, FORMAT(Timestamp, 'HH:mm') as Time FROM Production_Logs ORDER BY Timestamp DESC");
    if (!rows.recordset || rows.recordset.length === 0) return res.json({ labels: ['...'], temp: [0], noise: [0] });
    const labels = rows.recordset.map(r => r.Time).reverse();
    const temp = rows.recordset.map(r => r.Temperature).reverse();
    const noise = rows.recordset.map(r => r.NoiseLevel).reverse();
    res.json({ labels, temp, noise });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /iot/machines -> mirror /api/system-status
router.get('/machines', async (req, res) => {
  try {
    const pool = await poolPromise;
    const rows = await pool.request().query("SELECT CAST(m.MachineID AS VARCHAR(36)) as id, m.MachineName as name, ISNULL(s.StatusName, 'Running') as status FROM Machines m OUTER APPLY (SELECT TOP 1 StatusName FROM Machine_Status WHERE MachineID = m.MachineID ORDER BY Timestamp DESC) s");
    res.json(rows.recordset.map(r => ({ id: r.id, name: r.name, status: r.status })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
