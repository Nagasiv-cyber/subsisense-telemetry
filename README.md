# ⛏️ MinePulse Telemetry OS & MineGuard Subsidence Rescue System

A real-time geotechnical structural monitoring and IoT telemetry platform designed for underground mines, tunnels, and subsidence hazard zones.

---

## 🌟 Key Features

* **Mechanical String Tension Monitoring**: Prevents false alarms caused by underground mining dust, moisture, and rock blasting smoke.
* **Multi-Sensor ESP32 Telemetry**: Ingests load cell tension (HX711 in Newtons), 6-axis kinematics & tilt (MPU6050 accelerometer/gyro), seismic vibration triggers (SW-420), and soil pore saturation.
* **ASTM Dynamic Thresholds**:
  * 🟢 **Normal (0 – 75 N)**: Nominal structural stability.
  * 🟡 **Moderate (75 – 150 N)**: Elevated load warning range.
  * 🔴 **Critical Hazard (> 150 N)**: Immediate evacuation trigger & audio buzzer alarm.
* **Dual-Axis Engineering Oscilloscope**: Real-time high-speed graphing of Tension ($N$) and Angular Deflection ($^\circ$).
* **MineGuard Top-Down Rescue Simulator**: Interactive canvas with 8 strata nodes (`N1` to `N8`), draggable anchor simulation, rock shift modeling, and automated emergency evacuation routing.
* **MongoDB Atlas Integration**: Live persistent time-series telemetry storage, queryable analytics table, and CSV dataset export.

---

## 🚀 Quick Start

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v16 or higher)
* A [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster connection string

### 2. Installation
```bash
git clone https://github.com/Nagasiv-cyber/subsisense-telemetry.git
cd subsisense-telemetry
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory:
```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.p710d.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
DB_NAME=smart_subsidence
```

### 4. Run Locally
```bash
npm start
```
Open **`http://localhost:5000`** in your browser.

---

## 📡 ESP32 / Arduino Integration

Set your ESP32 HTTP POST target endpoint:
```cpp
const char* serverUrl = "http://<YOUR_SERVER_IP>:5000/api/readings";
```

### Ingestion Payload Example
```json
{
  "nodeId": "NODE_C",
  "tension": 112.5,
  "tiltX": 2.4,
  "tiltY": -1.1,
  "accelX": 0.02,
  "accelY": -0.01,
  "accelZ": 0.98,
  "gyroX": 0.5,
  "gyroY": -0.2,
  "gyroZ": 0.1,
  "vibration": false,
  "soilMoisture": 38
}
```

---

## 🏗️ Project Architecture

```
subsisense-telemetry/
├── public/
│   ├── index.html       # Single-page multi-view SCADA dashboard
│   ├── css/
│   │   └── style.css    # Responsive theme styling & layout
│   └── js/
│       └── app.js       # Real-time WebSocket/polling, Chart.js oscilloscope & MineGuard canvas
├── server.js            # Express API, MongoDB Atlas ingestion & simulation endpoints
├── package.json
└── README.md
```

---

## 📜 License
MIT License. Built for the Smart Subsidence Hackathon.
