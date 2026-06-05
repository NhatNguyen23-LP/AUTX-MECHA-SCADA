require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const iotRoutes = require('./routes/iot');

const API_KEY = process.env.API_KEY || 'dev-key';
const PORT = process.env.PORT || 4000;

const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());

// Simple API key middleware
app.use((req, res, next) => {
  // Allow health check without key
  if (req.path === '/health') return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key || key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/iot', iotRoutes);

app.listen(PORT, () => console.log(`Node IoT API listening on port ${PORT}`));
