const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const dns = require('dns');
// Use public DNS to avoid ECONNREFUSED on local ISP/routers when resolving MongoDB SRV records
dns.setServers(['8.8.8.8', '8.8.4.4']);

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'smart_subsidence';

const path = require('path');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Client
let db;
let client;

async function connectToDatabase() {
  if (!MONGODB_URI || MONGODB_URI.includes('<') || MONGODB_URI.includes('>')) {
    console.warn('⚠️  MongoDB URI contains placeholder values (<db_username> / <db_password>) in .env. Please replace them with your actual Atlas database user credentials.');
    return null;
  }

  try {
    client = new MongoClient(MONGODB_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      }
    });

    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log('✅ Successfully connected to MongoDB Atlas!');
    db = client.db(DB_NAME);
    return db;
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
  }
}

// Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    dbConnected: Boolean(db),
    uptime: process.uptime(),
  });
});

// Helper function to calculate alert status based on user thresholds
function calculateStatus(tensionValue) {
  const val = Number(tensionValue) || 0;
  if (val > 150) {
    return 'CRITICAL';
  } else if (val >= 75) {
    return 'MODERATE';
  }
  return 'NORMAL';
}

// POST /api/readings - Ingest data from ESP32 / IoT nodes
app.post('/api/readings', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database not connected yet.',
      });
    }

    const payload = req.body || {};
    
    // Auto-detect and fix Arduino C++ Base-2 Binary trap (e.g. String(longVar, 2) creates "10111000110" for 1478)
    let rawDiff = payload.loadDifference ?? payload.difference ?? payload.tension ?? payload.displacement ?? 0;
    if (typeof rawDiff === 'number' && String(rawDiff).length > 6 && /^[01]+$/.test(String(rawDiff))) {
      rawDiff = parseInt(String(rawDiff), 2);
    }

    // Support all ESP32 sensor naming keys
    const tensionVal = Number(
      rawDiff ??
      payload.subsidence ?? 
      payload.rawChange ??
      payload.value ?? 
      0
    );

    // Determine alert status based on rules:
    // 0 - 75: NORMAL
    // 75 - 150: MODERATE (Yellow)
    // 150+: CRITICAL (Red)
    const alertStatus = payload.alertStatus || calculateStatus(tensionVal);

    const rawNode = String(payload.nodeId || payload.sensorId || 'NodeB');
    const normalizedNode = rawNode.toUpperCase().replace(/[^A-Z0-9]/g, '_');

    // Dynamic document: preserves ALL incoming sensor keys from Arduino IDE while adding metadata
    const readingDocument = {
      nodeId: rawNode,
      normalizedNodeId: normalizedNode,
      sensorId: rawNode,
      tension: tensionVal,
      displacement: tensionVal,
      loadDifference: tensionVal,
      rawADC: payload.rawADC ?? null,
      rawChange: payload.rawChange ?? null,
      zeroOffset: payload.zeroOffset ?? payload.zeroADC ?? null,
      loadLevel: payload.loadLevel ?? (alertStatus === 'CRITICAL' ? 2 : alertStatus === 'MODERATE' ? 1 : 0),
      vibrationCount: payload.vibrationCount ?? payload.pulses ?? 0,
      vibrationLevel: payload.vibrationLevel ?? (payload.vibration ? 1 : 0),
      vibration: Boolean(payload.vibration || (payload.vibrationCount > 0) || (payload.vibrationLevel > 0)),
      accelX: Number(payload.accelX ?? 0),
      accelY: Number(payload.accelY ?? 0),
      accelZ: Number(payload.accelZ ?? 0.98),
      gyroX: Number(payload.gyroX ?? 0),
      gyroY: Number(payload.gyroY ?? 0),
      gyroZ: Number(payload.gyroZ ?? 0),
      tiltX: Number(payload.tiltX ?? 0),
      tiltY: Number(payload.tiltY ?? 0),
      temperatureC: payload.temperatureC ?? null,
      temperatureF: payload.temperatureF ?? null,
      soilMoisture: payload.soilMoisture ?? payload.soil ?? 15,
      wifiRSSI: payload.wifiRSSI ?? -55,
      uptime: payload.uptime ?? null,
      ...payload,
      alertStatus,
      receivedAt: new Date(),
    };

    const collection = db.collection('readings');
    const result = await collection.insertOne(readingDocument);

    console.log(`📥 [${readingDocument.receivedAt.toLocaleTimeString()}] ESP32 Payload Saved (${readingDocument.nodeId}): Load=${tensionVal} N, ADC=${readingDocument.rawADC}, Temp=${readingDocument.temperatureC}°C, Vib=${readingDocument.vibrationCount} [${alertStatus}]`);

    return res.status(201).json({
      success: true,
      message: 'Reading recorded and synced to MongoDB Atlas successfully',
      insertedId: result.insertedId,
      alertStatus,
      nodeId: rawNode,
    });
  } catch (error) {
    console.error('Error saving reading:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/readings - Fetch historical readings
app.get('/api/readings', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected.' });
    }
    const limit = parseInt(req.query.limit) || 100;
    const nodeId = req.query.nodeId || req.query.sensorId;
    
    let query = {};
    if (nodeId && nodeId !== 'ALL') {
      const cleanNode = nodeId.replace(/[^a-zA-Z0-9]/g, '');
      const regex = new RegExp(cleanNode, 'i');
      query = {
        $or: [
          { nodeId: regex },
          { sensorId: regex },
          { normalizedNodeId: regex }
        ]
      };
    }

    const collection = db.collection('readings');
    let readings = await collection
      .find(query)
      .sort({ receivedAt: -1 })
      .limit(limit)
      .toArray();

    // Ensure all returned readings have proper decimal numbers for tension & loadDifference
    readings = readings.map(r => {
      let cleanTension = Number(r.tension || 0);
      if (cleanTension > 0 && !/^[01]{6,}$/.test(String(cleanTension))) {
        r.loadDifference = cleanTension;
      } else if (r.loadDifference != null && /^[01]{6,}$/.test(String(r.loadDifference))) {
        const decoded = parseInt(String(r.loadDifference), 2);
        r.loadDifference = decoded;
        r.tension = decoded;
      }
      return r;
    });

    return res.json({
      success: true,
      count: readings.length,
      readings,
    });
  } catch (error) {
    console.error('Error fetching readings:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/alerts - Fetch all moderate and critical hazard events from MongoDB
app.get('/api/alerts', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected.' });
    }
    const collection = db.collection('readings');
    const alerts = await collection
      .find({
        $or: [
          { alertStatus: { $in: ['MODERATE', 'CRITICAL'] } },
          { vibration: true },
          { tension: { $gte: 75 } }
        ]
      })
      .sort({ receivedAt: -1 })
      .limit(100)
      .toArray();

    res.json({ success: true, count: alerts.length, alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/nodes - Fetch all registered nodes and their placement simulation metadata
app.get('/api/nodes', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected.' });
    }

    const defaultNodes = [
      {
        nodeId: 'NODE_A',
        name: 'Surface Crown Anchor',
        location: 'Surface Overburden - Sector 01',
        depth: '0 m (Surface Level)',
        coordinates: { x: 18, y: 15 },
        sensorType: 'Surface GPS & Extensometer',
        status: 'NORMAL',
        battery: 98,
        signalDbm: -54,
        installDate: '2026-03-12'
      },
      {
        nodeId: 'NODE_B',
        name: 'Mid-Strata Pillar Anchor',
        location: 'Shaft 2 Upper Gallery - Sector 02',
        depth: '-45 m Sub-surface',
        coordinates: { x: 45, y: 48 },
        sensorType: 'Pillar Load Cell & Pore Pressure',
        status: 'NORMAL',
        battery: 91,
        signalDbm: -62,
        installDate: '2026-04-05'
      },
      {
        nodeId: 'NODE_C',
        name: 'Active Gallery Roof Crown',
        location: 'Mine Gallery 4B - Active Face',
        depth: '-120 m Deep Gallery',
        coordinates: { x: 78, y: 82 },
        sensorType: 'Roof Bolt Tension (HX711) + Tilt (MPU6050)',
        status: 'ACTIVE',
        battery: 94,
        signalDbm: -64,
        installDate: '2026-06-18'
      }
    ];

    const collection = db.collection('readings');
    const latestC = await collection.find({}).sort({ receivedAt: -1 }).limit(1).toArray();

    if (latestC.length > 0) {
      defaultNodes[2].latestReading = latestC[0];
      defaultNodes[2].status = latestC[0].alertStatus || 'NORMAL';
    }

    res.json({ success: true, nodes: defaultNodes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/stats - Aggregated stats for the dashboard
app.get('/api/stats', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected.' });
    }
    const collection = db.collection('readings');
    const totalCount = await collection.countDocuments();
    
    // Get last reading
    const lastReading = await collection.find({}).sort({ receivedAt: -1 }).limit(1).toArray();
    
    // Get count of moderate and critical alerts in the last 24h
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const criticalCount = await collection.countDocuments({
      receivedAt: { $gte: dayAgo },
      alertStatus: 'CRITICAL'
    });
    const moderateCount = await collection.countDocuments({
      receivedAt: { $gte: dayAgo },
      alertStatus: 'MODERATE'
    });

    res.json({
      success: true,
      totalReadings: totalCount,
      criticalAlerts24h: criticalCount,
      moderateAlerts24h: moderateCount,
      latest: lastReading[0] || null,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/simulate - Trigger a test reading for instant UI demonstration
app.post('/api/simulate', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected.' });
    }
    const scenario = req.body.scenario || 'random'; // 'normal', 'moderate', 'critical', 'random'
    let tension = 35.0;

    if (scenario === 'normal') {
      tension = parseFloat((Math.random() * 65 + 5).toFixed(2)); // 5 - 70 N
    } else if (scenario === 'moderate') {
      tension = parseFloat((Math.random() * 60 + 80).toFixed(2)); // 80 - 140 N
    } else if (scenario === 'critical') {
      tension = parseFloat((Math.random() * 150 + 160).toFixed(2)); // 160 - 310 N
    } else {
      // 70% normal, 20% moderate, 10% critical
      const r = Math.random();
      if (r < 0.7) tension = parseFloat((Math.random() * 65 + 5).toFixed(2));
      else if (r < 0.9) tension = parseFloat((Math.random() * 60 + 80).toFixed(2));
      else tension = parseFloat((Math.random() * 150 + 160).toFixed(2));
    }

    const alertStatus = calculateStatus(tension);
    const simulatedDoc = {
      nodeId: 'NODE_C',
      sensorId: 'NODE_C',
      tension,
      displacement: tension,
      accelX: parseFloat((Math.random() * 2 - 1).toFixed(2)),
      accelY: parseFloat((Math.random() * 2 - 1).toFixed(2)),
      accelZ: parseFloat((9.8 + (Math.random() * 0.4 - 0.2)).toFixed(2)),
      gyroX: parseFloat((Math.random() * 0.1 - 0.05).toFixed(2)),
      gyroY: parseFloat((Math.random() * 0.1 - 0.05).toFixed(2)),
      gyroZ: parseFloat((Math.random() * 0.1 - 0.05).toFixed(2)),
      tiltX: parseFloat((Math.random() * 8 - 4).toFixed(2)),
      tiltY: parseFloat((Math.random() * 8 - 4).toFixed(2)),
      vibration: tension > 100 ? (Math.random() > 0.4) : false,
      soilMoisture: Math.floor(Math.random() * 40 + 40),
      nodeStatus: alertStatus,
      alertStatus,
      isSimulated: true,
      receivedAt: new Date(),
    };

    const collection = db.collection('readings');
    const result = await collection.insertOne(simulatedDoc);

    res.status(201).json({
      success: true,
      message: 'Simulation reading generated successfully',
      insertedId: result.insertedId,
      data: simulatedDoc,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Server
app.listen(PORT, async () => {
  console.log(`🌐 Server running on http://localhost:${PORT}`);
  await connectToDatabase();
});

// Graceful Shutdown
process.on('SIGINT', async () => {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed.');
  }
  process.exit(0);
});
