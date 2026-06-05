/*************************************************
 Simple simulator that posts random telemetry to /iot/ingest
 Usage: set .env with API_KEY and PORT, then `node src/simulator.js`
*************************************************/
require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.API_KEY || 'dev-key';
const HOST = process.env.SIM_HOST || `http://localhost:${process.env.PORT || 4000}`;
let MACHINE_ID = process.env.SIM_MACHINE_ID || null; // set to a valid MachineID to target a specific machine

async function pickMachineIfNeeded() {
  if (MACHINE_ID) return MACHINE_ID;
  try {
    const res = await axios.get(`${HOST}/iot/machines`, { headers: { 'x-api-key': API_KEY } });
    const list = res.data || [];
    if (list.length > 0) {
      const choice = list[Math.floor(Math.random() * list.length)];
      MACHINE_ID = choice.id;
      console.log('Auto picked machineId for simulator:', MACHINE_ID);
      return MACHINE_ID;
    }
  } catch (e) {
    console.error('Could not fetch machines for simulator:', e.response ? e.response.data : e.message);
  }
  return null;
}

async function send() {
  try {
    const mid = await pickMachineIfNeeded();
    if (!mid) {
      console.warn('Simulator: no MachineID available, skipping send');
      return;
    }

    const payload = {
      machineId: mid,
      temperature: parseFloat((Math.random()*40 + 30).toFixed(2)),
      noise: parseFloat((Math.random()*50 + 40).toFixed(2))
    };

    const res = await axios.post(`${HOST}/iot/ingest`, payload, { headers: { 'x-api-key': API_KEY } });
    console.log(new Date().toISOString(), 'sent', payload, '->', res.data);
  } catch (err) {
    console.error('Send error:', err.response ? err.response.data : err.message);
  }
}

setInterval(send, 5000);
send();
