import express, {Request,Response} from 'express';
import cors from 'cors';
import powerMonitorService from './services/powerMonitorService';
import threePhasePowerService from './services/threePhasePowerService';
import billingService from './services/billingService';
import insightsService from './services/insightsService';
import { validateDeviceId, getCurrentUser, updateUserProfile, getDeviceById } from './middleware/auth';
import { BillCalculationRequest, ThreePhaseReadings } from './types';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.text({ type: '*/*' }));

// In-memory store for GSM testing logs (last 100 entries)
const gsmLogs: { receivedAt: string; ip: string; data: any }[] = [];

app.get('/', (req: Request, res: Response) => {
    res.json({
        status: 'online',
        message: '3-Phase Energy Monitoring API - Sri Lankan CEB Tariff System',
        version: '2.0.0',
        endpoints: {
            // System endpoints
            health: 'GET /api/health',
            debug: 'GET /debug',
            
            // Legacy single-phase endpoints
            gsmTest: 'POST /api/gsm-test',
            gsmLogs: 'GET /api/gsm-logs',
            power: 'POST /api/power',
            powerBatch: 'POST /api/power/batch',
            energyMeasurement: 'POST /api/energy-measurement',
            powerUsage: 'GET /api/power?timeRange=24h',
            powerStats: 'GET /api/power/stats?timeRange=24h',
            powerLatest: 'GET /api/power/latest',
            powerEnergy: 'GET /api/power/energy?timeRange=24h',
            powerRange: 'GET /api/power/range?from=...&to=...',
            powerEnergyRange: 'GET /api/power/energy/range?from=...&to=...',
            voltageCharge: 'GET /api/power/voltage-charge?limit=...',
            
            // 3-Phase Dashboard endpoints (v2)
            '1_readings': 'GET /api/dashboard/readings?phases=[1,2,3]&deviceId=ESP32-A1B2C3',
            '2_hourlyUsage': 'GET /api/dashboard/hourly-usage?date=2025-12-23&phases=[1,2,3]&deviceId=...',
            '3_deviceInfo': 'GET /api/dashboard/device-info?deviceId=...',
            '4_userProfile': 'GET /api/dashboard/user-profile',
            '5_calculateBill': 'POST /api/dashboard/calculate-bill',
            '6_analytics': 'GET /api/dashboard/analytics?type=energy&period=24h&deviceId=...',
            '7_statistics': 'GET /api/dashboard/statistics?deviceId=...&period=today',
            '8_insights': 'GET /api/dashboard/insights?deviceId=...',
            '9_updateProfile': 'PUT /api/dashboard/user-profile',
            '10_phaseData': 'GET /api/dashboard/phase-data?deviceId=...',
            
            // Data ingestion
            storeReadings: 'POST /api/dashboard/readings'
        },
        features: [
            '3-Phase Energy Monitoring',
            'Sri Lankan CEB Tariff Calculation (Domestic/GP/Industrial)',
            'Real-time Phase Imbalance Detection',
            'Maximum Demand Tracking (30-min rolling average)',
            'Power Factor Penalties & Incentives',
            'AI-Powered Insights & Alerts',
            'Device Health Monitoring',
            'Hourly/Daily/Monthly Analytics'
        ]
    });
});

// API Health Check Endpoint
app.get('/api/health', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    const endpoints = [
        { name: 'GSM Test', method: 'POST', path: '/api/gsm-test', critical: false },
        { name: 'GSM Logs', method: 'GET', path: '/api/gsm-logs', critical: false },
        { name: 'Power Data', method: 'POST', path: '/api/power', critical: true },
        { name: 'Energy Measurement', method: 'POST', path: '/api/energy-measurement', critical: true },
        { name: 'Power Usage', method: 'GET', path: '/api/power?timeRange=1h', critical: true },
        { name: 'Power Latest', method: 'GET', path: '/api/power/latest', critical: false },
        { name: 'Dashboard Readings', method: 'GET', path: '/api/dashboard/readings', critical: false }
    ];

    const checks = await Promise.all(
        endpoints.map(async (endpoint) => {
            const checkStart = Date.now();
            try {
                // For GET endpoints, we can actually test them
                if (endpoint.method === 'GET') {
                    await powerMonitorService.getPowerUsage('1h');
                }
                return {
                    endpoint: endpoint.name,
                    method: endpoint.method,
                    path: endpoint.path,
                    status: 'healthy',
                    critical: endpoint.critical,
                    responseTime: Date.now() - checkStart
                };
            } catch (error) {
                return {
                    endpoint: endpoint.name,
                    method: endpoint.method,
                    path: endpoint.path,
                    status: 'unhealthy',
                    critical: endpoint.critical,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    responseTime: Date.now() - checkStart
                };
            }
        })
    );

    const healthyCount = checks.filter(c => c.status === 'healthy').length;
    const unhealthyCount = checks.filter(c => c.status === 'unhealthy').length;
    const criticalUnhealthy = checks.filter(c => c.status === 'unhealthy' && c.critical).length;

    const overallStatus = criticalUnhealthy > 0 ? 'critical' : unhealthyCount > 0 ? 'degraded' : 'healthy';

    res.status(overallStatus === 'critical' ? 503 : 200).json({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        responseTime: Date.now() - startTime,
        endpoints: checks,
        summary: {
            total: checks.length,
            healthy: healthyCount,
            unhealthy: unhealthyCount,
            criticalUnhealthy
        },
        database: {
            influxDB: 'connected',
            database: process.env.INFLUXDB_DATABASE || 'unknown'
        },
        server: {
            port: PORT,
            nodeVersion: process.version,
            platform: process.platform
        }
    });
});

// Debug Page HTML
app.get('/debug', (req: Request, res: Response) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Debug Dashboard - Energy Monitoring</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 { font-size: 2em; margin-bottom: 10px; }
        .header p { opacity: 0.9; }
        .status-card {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8f9fa;
        }
        .stat {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .stat-label { color: #666; font-size: 0.9em; }
        .healthy { color: #10b981; }
        .degraded { color: #f59e0b; }
        .critical { color: #ef4444; }
        .endpoints {
            padding: 30px;
        }
        .endpoint-card {
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 15px;
            transition: all 0.3s;
        }
        .endpoint-card:hover {
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            transform: translateY(-2px);
        }
        .endpoint-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .endpoint-name {
            font-weight: bold;
            font-size: 1.1em;
        }
        .method {
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 0.85em;
            font-weight: bold;
        }
        .method-get { background: #dbeafe; color: #1e40af; }
        .method-post { background: #dcfce7; color: #166534; }
        .status-badge {
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: bold;
        }
        .status-healthy { background: #d1fae5; color: #065f46; }
        .status-unhealthy { background: #fee2e2; color: #991b1b; }
        .endpoint-path {
            color: #6b7280;
            font-family: monospace;
            margin-top: 8px;
        }
        .response-time {
            color: #6b7280;
            font-size: 0.9em;
            margin-top: 8px;
        }
        .refresh-btn {
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 50px;
            font-size: 1em;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            transition: all 0.3s;
        }
        .refresh-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0,0,0,0.3);
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #6b7280;
        }
        .spinner {
            border: 3px solid #f3f4f6;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .last-updated {
            text-align: center;
            padding: 20px;
            color: #6b7280;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 API Debug Dashboard</h1>
            <p>Energy Monitoring System - Real-time Status</p>
        </div>
        
        <div id="content">
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading API health status...</p>
            </div>
        </div>
    </div>

    <button class="refresh-btn" onclick="loadHealth()">🔄 Refresh</button>

    <script>
        async function loadHealth() {
            const contentDiv = document.getElementById('content');
            contentDiv.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';

            try {
                const response = await fetch('/api/health');
                const data = await response.json();

                const statusClass = data.status === 'healthy' ? 'healthy' : 
                                  data.status === 'degraded' ? 'degraded' : 'critical';

                let html = \`
                    <div class="status-card">
                        <div class="stat">
                            <div class="stat-value \${statusClass}">\${data.status.toUpperCase()}</div>
                            <div class="stat-label">Overall Status</div>
                        </div>
                        <div class="stat">
                            <div class="stat-value healthy">\${data.summary.healthy}</div>
                            <div class="stat-label">Healthy Endpoints</div>
                        </div>
                        <div class="stat">
                            <div class="stat-value degraded">\${data.summary.unhealthy}</div>
                            <div class="stat-label">Unhealthy Endpoints</div>
                        </div>
                        <div class="stat">
                            <div class="stat-value">\${data.responseTime}ms</div>
                            <div class="stat-label">Response Time</div>
                        </div>
                        <div class="stat">
                            <div class="stat-value">\${Math.floor(data.uptime)}s</div>
                            <div class="stat-label">Server Uptime</div>
                        </div>
                    </div>

                    <div class="endpoints">
                        <h2 style="margin-bottom: 20px;">API Endpoints Status</h2>
                \`;

                data.endpoints.forEach(endpoint => {
                    const statusClass = endpoint.status === 'healthy' ? 'status-healthy' : 'status-unhealthy';
                    const methodClass = endpoint.method.toLowerCase() === 'get' ? 'method-get' : 'method-post';
                    
                    html += \`
                        <div class="endpoint-card">
                            <div class="endpoint-header">
                                <div class="endpoint-name">\${endpoint.endpoint}</div>
                                <div>
                                    <span class="method \${methodClass}">\${endpoint.method}</span>
                                    <span class="status-badge \${statusClass}">\${endpoint.status}</span>
                                </div>
                            </div>
                            <div class="endpoint-path">\${endpoint.path}</div>
                            <div class="response-time">Response Time: \${endpoint.responseTime}ms\${endpoint.critical ? ' • Critical Endpoint' : ''}</div>
                            \${endpoint.error ? \`<div style="color: #ef4444; margin-top: 8px;">Error: \${endpoint.error}</div>\` : ''}
                        </div>
                    \`;
                });

                html += \`
                    </div>
                    <div class="last-updated">
                        Last updated: \${new Date().toLocaleString()}<br>
                        Server: \${data.server.platform} | Node \${data.server.nodeVersion} | Port \${data.server.port}<br>
                        Database: \${data.database.influxDB} (\${data.database.database})
                    </div>
                \`;

                contentDiv.innerHTML = html;
            } catch (error) {
                contentDiv.innerHTML = \`
                    <div class="loading">
                        <p style="color: #ef4444;">❌ Failed to load API health status</p>
                        <p style="margin-top: 10px;">\${error.message}</p>
                    </div>
                \`;
            }
        }

        // Auto-refresh every 30 seconds
        setInterval(loadHealth, 30000);
        
        // Load on page load
        loadHealth();
    </script>
</body>
</html>
    `);
});

/**
 * GSM Testing Endpoint - Simple endpoint to test GSM module connectivity
 * Accepts any format (JSON, text, form data) and logs everything
 */
app.post('/api/gsm-test', (req: Request, res: Response) => {
    try {
        const entry = {
            receivedAt: new Date().toISOString(),
            ip: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown',
            data: req.body
        };

        // Add to logs and keep only last 100 entries
        gsmLogs.push(entry);
        if (gsmLogs.length > 100) {
            gsmLogs.shift();
        }

        console.log('GSM TEST RECEIVED:', entry);

        // SUCCESS RESPONSE for Arduino to verify
        res.status(200).json({
            status: 'SUCCESS',
            serverTime: entry.receivedAt,
            totalLogs: gsmLogs.length,
            receivedData: req.body
        });
    } catch (error) {
        console.error('GSM test error:', error);
        res.status(500).json({
            status: 'ERROR',
            message: 'Server error'
        });
    }
});

/**
 * View all GSM test logs
 */
app.get('/api/gsm-logs', (req: Request, res: Response) => {
    res.json({
        totalLogs: gsmLogs.length,
        logs: gsmLogs
    });
});

// POST endpoint to send power data to InfluxDB
app.post('/api/power', async (req: Request, res: Response) => {
    try {
        let body;
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } catch {
            return res.status(400).json({ error: 'Invalid JSON format' });
        }

        const { voltage, charge, timestamp } = body;

        if (typeof voltage !== 'number' || typeof charge !== 'number') {
            return res.status(400).json({ 
                error: 'Missing or invalid fields: voltage (number) and charge (number) are required' 
            });
        }

        await powerMonitorService.sendPowerData({ voltage, charge, timestamp });

        const energyWh = (voltage * charge) / 3600;
        res.status(201).json({ 
            message: 'Energy data stored successfully',
            data: { voltage, charge, energy_wh: energyWh }
        });
    } catch (error) {
        console.error('Error storing power data:', error);
        res.status(500).json({ error: 'Failed to store power data' });
    }
});

// POST endpoint to send multiple power readings
app.post('/api/power/batch', async (req: Request, res: Response) => {
    try {
        let body;
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } catch {
            return res.status(400).json({ error: 'Invalid JSON format' });
        }

        const { readings } = body;

        if (!readings || !Array.isArray(readings)) {
            return res.status(400).json({ 
                error: 'Missing required field: readings (array)' 
            });
        }

        // Basic validation of each reading
        const sanitized = readings.filter((r: any) => 
            r && typeof r.voltage === 'number' && typeof r.charge === 'number'
        );

        if (sanitized.length === 0) {
            return res.status(400).json({ 
                error: 'No valid readings provided (voltage/charge must be numbers)' 
            });
        }

        await powerMonitorService.sendBatchPowerData(sanitized);

        res.status(201).json({ 
            message: `${sanitized.length} energy readings stored successfully`
        });
    } catch (error) {
        console.error('Error storing batch power data:', error);
        res.status(500).json({ error: 'Failed to store power data' });
    }
});

// GET endpoint to retrieve power usage data
app.get('/api/power', async (req: Request, res: Response) => {
    try {
        const timeRange = (req.query.timeRange as string) || '1h';
        
        const data = await powerMonitorService.getPowerUsage(timeRange);

        res.status(200).json({ 
            timeRange,
            count: data.length,
            data 
        });
    } catch (error) {
        console.error('Error retrieving power data:', error);
        res.status(500).json({ error: 'Failed to retrieve power data' });
    }
});

// GET endpoint to get total energy consumption
app.get('/api/power/energy', async (req: Request, res: Response) => {
    try {
        const timeRange = (req.query.timeRange as string) || '24h';
        
        const totalEnergy = await powerMonitorService.getTotalEnergyConsumption(timeRange);

        res.status(200).json({ 
            timeRange,
            totalEnergyKWh: totalEnergy
        });
    } catch (error) {
        console.error('Error calculating energy consumption:', error);
        res.status(500).json({ error: 'Failed to calculate energy consumption' });
    }
});

// GET endpoint to retrieve power usage data for a specific from/to range
// Expects query params: from, to as ISO strings (e.g. 2025-12-03T10:00:00Z)
app.get('/api/power/range', async (req: Request, res: Response) => {
    try {
        const from = req.query.from as string | undefined;
        const to = req.query.to as string | undefined;

        if (!from || !to) {
            return res.status(400).json({
                error: "Missing required query params: 'from' and 'to' (ISO datetime strings)"
            });
        }

        const fromDate = new Date(from);
        const toDate = new Date(to);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            return res.status(400).json({
                error: "Invalid 'from' or 'to' datetime format. Use ISO format like 2025-12-03T10:00:00Z"
            });
        }

        if (fromDate > toDate) {
            return res.status(400).json({
                error: "'from' must be earlier than or equal to 'to'"
            });
        }

        // Use exact strings so timezone info is preserved as sent by client
        const data = await powerMonitorService.getPowerUsageRange(from, to);

        res.status(200).json({
            from,
            to,
            count: data.length,
            data
        });
    } catch (error) {
        console.error('Error retrieving power data range:', error);
        res.status(500).json({ error: 'Failed to retrieve power data range' });
    }
});

// GET endpoint for latest reading
app.get('/api/power/latest', async (req: Request, res: Response) => {
    try {
        const data = await powerMonitorService.getPowerUsage('1h');
        
        if (data.length === 0) {
            return res.status(200).json({
                message: 'No readings available yet'
            });
        }

        // Return the most recent reading
        res.status(200).json(data[0]);
    } catch (error) {
        console.error('Error retrieving latest reading:', error);
        res.status(500).json({ error: 'Failed to retrieve latest reading' });
    }
});

// GET endpoint for statistics summary
app.get('/api/power/stats', async (req: Request, res: Response) => {
    try {
        const timeRange = (req.query.timeRange as string) || '24h';
        const data = await powerMonitorService.getPowerUsage(timeRange);

        if (data.length === 0) {
            return res.status(200).json({
                timeRange,
                message: 'No data available for this time range'
            });
        }

        // Calculate statistics
        const voltages = data.map((r: any) => r.voltage).filter((v: number) => v != null);
        const charges = data.map((r: any) => r.charge).filter((c: number) => c != null);
        const energies = data.map((r: any) => r.energy_wh).filter((e: number) => e != null);

        const stats = {
            timeRange,
            readingsCount: data.length,
            voltage: {
                avg: voltages.reduce((a: number, b: number) => a + b, 0) / voltages.length || 0,
                min: Math.min(...voltages) || 0,
                max: Math.max(...voltages) || 0
            },
            charge: {
                avg: charges.reduce((a: number, b: number) => a + b, 0) / charges.length || 0,
                min: Math.min(...charges) || 0,
                max: Math.max(...charges) || 0,
                total: charges.reduce((a: number, b: number) => a + b, 0) || 0
            },
            energy: {
                totalWh: energies.reduce((a: number, b: number) => a + b, 0) || 0,
                totalKWh: (energies.reduce((a: number, b: number) => a + b, 0) || 0) / 1000,
                avgPerReading: energies.reduce((a: number, b: number) => a + b, 0) / energies.length || 0
            }
        };

        res.status(200).json(stats);
    } catch (error) {
        console.error('Error calculating statistics:', error);
        res.status(500).json({ error: 'Failed to calculate statistics' });
    }
});

// GET endpoint for energy consumed in a custom date range
app.get('/api/power/energy/range', async (req: Request, res: Response) => {
    try {
        const from = req.query.from as string | undefined;
        const to = req.query.to as string | undefined;

        if (!from || !to) {
            return res.status(400).json({
                error: "Missing required query params: 'from' and 'to' (ISO datetime strings)"
            });
        }

        const data = await powerMonitorService.getPowerUsageRange(from, to);

        if (data.length === 0) {
            return res.status(200).json({
                from,
                to,
                totalEnergyKWh: 0,
                readingsCount: 0
            });
        }

        // Sum all energy readings
        const totalWh = data.reduce((sum: number, r: any) => sum + (r.energy_wh || 0), 0);

        res.status(200).json({
            from,
            to,
            totalEnergyKWh: totalWh / 1000,
            totalEnergyWh: totalWh,
            readingsCount: data.length
        });
    } catch (error) {
        console.error('Error calculating energy for range:', error);
        res.status(500).json({ error: 'Failed to calculate energy consumption' });
    }
});

// GET endpoint to retrieve all voltage and charge readings with timestamps
app.get('/api/power/voltage-charge', async (req: Request, res: Response) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        
        if (limit && (isNaN(limit) || limit <= 0)) {
            return res.status(400).json({ 
                error: 'Invalid limit parameter. Must be a positive number.' 
            });
        }

        const data = await powerMonitorService.getAllVoltageAndCharge(limit);

        res.status(200).json({ 
            count: data.length,
            data 
        });
    } catch (error) {
        console.error('Error retrieving voltage and charge data:', error);
        res.status(500).json({ error: 'Failed to retrieve voltage and charge data' });
    }
});

// POST endpoint for detailed energy measurements
// Accepts both JSON body AND query parameters (for GSM modules)
app.post('/api/energy-measurement', async (req: Request, res: Response) => {
    try {
        let data: any = {};
        
        // Check if data is in query parameters (simpler for GSM modules)
        if (Object.keys(req.query).length > 0) {
            // Convert query params to numbers
            data = {
                ts: req.query.ts ? parseFloat(req.query.ts as string) : undefined,
                e_Wh: req.query.e_Wh ? parseFloat(req.query.e_Wh as string) : undefined,
                p_W: req.query.p_W ? parseFloat(req.query.p_W as string) : undefined,
                v_rms: req.query.v_rms ? parseFloat(req.query.v_rms as string) : undefined,
                i_rms: req.query.i_rms ? parseFloat(req.query.i_rms as string) : undefined,
                pf: req.query.pf ? parseFloat(req.query.pf as string) : undefined,
                v_min: req.query.v_min ? parseFloat(req.query.v_min as string) : undefined,
                v_max: req.query.v_max ? parseFloat(req.query.v_max as string) : undefined,
                p_peak: req.query.p_peak ? parseFloat(req.query.p_peak as string) : undefined
            };
        } else {
            // Fall back to JSON body
            try {
                data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            } catch {
                return res.status(400).json({ status: 'ERROR', message: 'Invalid JSON' });
            }
        }

        const { ts, e_Wh, p_W, v_rms, i_rms, pf, v_min, v_max, p_peak } = data;

        // Generate missing fields where possible
        const currentTime = Math.floor(Date.now() / 1000); // Current UNIX timestamp
        
        // Validate timestamp - must be within last 30 days and not in future
        const thirtyDaysAgo = currentTime - (30 * 24 * 60 * 60);
        let generatedTs = ts || currentTime;
        
        // If timestamp is too old or in future, use current server time
        if (generatedTs < thirtyDaysAgo || generatedTs > currentTime + 300) {
            console.warn(`Invalid timestamp ${generatedTs} (${new Date(generatedTs * 1000).toISOString()}), using server time`);
            generatedTs = currentTime;
        }

        // Assuming 1-minute measurement intervals for calculations
        const timeIntervalHours = 1 / 60; // 1 minute = 1/60 hour

        let generatedE_Wh = e_Wh;
        let generatedP_W = p_W;
        let generatedV_rms = v_rms;
        let generatedI_rms = i_rms;
        let generatedPf = pf;
        let generatedV_min = v_min;
        let generatedV_max = v_max;
        let generatedP_peak = p_peak;

        // Generate power factor if missing (default to 0.95 for typical residential)
        if (generatedPf === undefined) {
            generatedPf = 0.95;
        }

        // Generate RMS voltage if missing (default to 230V for standard mains)
        if (generatedV_rms === undefined) {
            generatedV_rms = 230.0;
        }

        // Generate RMS current if missing but power and voltage are available
        if (generatedI_rms === undefined && generatedP_W !== undefined && generatedV_rms !== undefined && generatedPf !== undefined) {
            generatedI_rms = generatedP_W / (generatedV_rms * generatedPf);
        }

        // Generate average power if missing but current and voltage are available
        if (generatedP_W === undefined && generatedI_rms !== undefined && generatedV_rms !== undefined && generatedPf !== undefined) {
            generatedP_W = generatedV_rms * generatedI_rms * generatedPf;
        }

        // Generate energy if missing but power is available
        if (generatedE_Wh === undefined && generatedP_W !== undefined) {
            generatedE_Wh = generatedP_W * timeIntervalHours;
        }

        // Generate power if missing but energy is available
        if (generatedP_W === undefined && generatedE_Wh !== undefined) {
            generatedP_W = generatedE_Wh / timeIntervalHours;
        }

        // Generate voltage min/max if missing (assume some variation around RMS)
        if (generatedV_min === undefined && generatedV_rms !== undefined) {
            generatedV_min = generatedV_rms * 0.95; // 5% below RMS
        }
        if (generatedV_max === undefined && generatedV_rms !== undefined) {
            generatedV_max = generatedV_rms * 1.05; // 5% above RMS
        }

        // Generate peak power if missing (assume 20% above average power)
        if (generatedP_peak === undefined && generatedP_W !== undefined) {
            generatedP_peak = generatedP_W * 1.2;
        }

        // Validate that we have the essential fields
        if (generatedE_Wh === undefined || generatedP_W === undefined || generatedV_rms === undefined ||
            generatedI_rms === undefined || generatedPf === undefined || generatedV_min === undefined ||
            generatedV_max === undefined || generatedP_peak === undefined) {
            return res.status(400).json({ status: 'ERROR', message: 'Missing data' });
        }

        // Validate ranges
        if (generatedPf < 0 || generatedPf > 1) {
            return res.status(400).json({ status: 'ERROR', message: 'Invalid power factor' });
        }

        if (generatedTs <= 0) {
            return res.status(400).json({ status: 'ERROR', message: 'Invalid timestamp' });
        }

        const measurement = {
            ts: generatedTs,
            e_Wh: generatedE_Wh,
            p_W: generatedP_W,
            v_rms: generatedV_rms,
            i_rms: generatedI_rms,
            pf: generatedPf,
            v_min: generatedV_min,
            v_max: generatedV_max,
            p_peak: generatedP_peak
        };

        await powerMonitorService.sendEnergyMeasurement(measurement);

        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('Error storing energy measurement:', error);
        res.status(500).json({ status: 'ERROR', message: 'Server error' });
    }
});

// ===== DASHBOARD ENDPOINTS =====

// 1. GET /dashboard/readings - Real-time 3-phase energy readings
app.get('/api/dashboard/readings', validateDeviceId, async (req: Request, res: Response) => {
    try {
        const { phases: phasesParam, deviceId } = req.query;
        const requestedPhases = phasesParam ? JSON.parse(phasesParam as string) : [1, 2, 3];

        const readings = await threePhasePowerService.getLatestReadings(deviceId as string, requestedPhases);

        if (!readings) {
            return res.status(200).json({
                success: false,
                error: {
                    code: 'NO_DATA_AVAILABLE',
                    message: 'No recent readings available for this device'
                }
            });
        }

        res.status(200).json({
            success: true,
            data: readings
        });
    } catch (error) {
        console.error('Error getting dashboard readings:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to retrieve readings'
            }
        });
    }
});

// 2. GET /dashboard/hourly-usage - Hourly energy usage by phase
app.get('/api/dashboard/hourly-usage', validateDeviceId, async (req: Request, res: Response) => {
    try {
        const { date, phases: phasesParam, deviceId } = req.query;
        const requestedPhases = phasesParam ? JSON.parse(phasesParam as string) : [1, 2, 3];
        const targetDate = date ? date as string : new Date().toISOString().split('T')[0];

        const hourlyData = await threePhasePowerService.getHourlyUsage(
            deviceId as string,
            targetDate,
            requestedPhases
        );

        res.status(200).json({
            success: true,
            data: hourlyData
        });
    } catch (error) {
        console.error('Error getting hourly usage:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to retrieve hourly usage'
            }
        });
    }
});

// 3. GET /dashboard/device-info - Device information and health
app.get('/api/dashboard/device-info', validateDeviceId, async (req: Request, res: Response) => {
    try {
        const { deviceId } = req.query;
        
        const deviceData = getDeviceById(deviceId as string);
        if (!deviceData) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'DEVICE_NOT_FOUND',
                    message: 'Device not found'
                }
            });
        }

        const healthStatus = await threePhasePowerService.getDeviceHealthStatus(deviceId as string);
        const energy24h = await threePhasePowerService.get24HourEnergy(deviceId as string);

        // Get latest reading for timestamp
        const latestReading = await threePhasePowerService.getLatestReadings(deviceId as string);

        res.status(200).json({
            success: true,
            data: {
                name: deviceData.name,
                location: deviceData.location,
                deviceId: deviceId as string,
                status: healthStatus === 'ok' ? 'online' : healthStatus === 'warning' ? 'warning' : 'offline',
                lastDataReceived: latestReading?.timestamp || new Date().toISOString(),
                healthStatus,
                energy24h
            }
        });
    } catch (error) {
        console.error('Error getting device info:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to retrieve device information'
            }
        });
    }
});

// 4. GET /dashboard/user-profile - User profile and preferences
app.get('/api/dashboard/user-profile', async (req: Request, res: Response) => {
    try {
        const userProfile = getCurrentUser();

        if (!userProfile) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'USER_NOT_FOUND',
                    message: 'User not found'
                }
            });
        }

        res.status(200).json({
            success: true,
            data: userProfile
        });
    } catch (error) {
        console.error('Error getting user profile:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to retrieve user profile'
            }
        });
    }
});

// 5. POST /dashboard/calculate-bill - Calculate electricity bill
app.post('/api/dashboard/calculate-bill', validateDeviceId, async (req: Request, res: Response) => {
    try {
        const requestData: BillCalculationRequest = req.body;

        if (!requestData.totalEnergy || typeof requestData.totalEnergy !== 'number') {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMETERS',
                    message: 'totalEnergy is required and must be a number'
                }
            });
        }

        if (!requestData.connectionCategory) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMETERS',
                    message: 'connectionCategory is required'
                }
            });
        }

        const billData = billingService.calculateBill(requestData);

        res.status(200).json({
            success: true,
            data: billData
        });
    } catch (error) {
        console.error('Error calculating bill:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'CALCULATION_ERROR',
                message: error instanceof Error ? error.message : 'Failed to calculate electricity bill'
            }
        });
    }
});

// 6. GET /dashboard/analytics - Analytics data for charts
app.get('/api/dashboard/analytics', validateDeviceId, async (req: Request, res: Response) => {
    try {
        const { type, period, phases: phasesParam, deviceId } = req.query;
        
        const analyticsType = (type as 'energy' | 'voltage' | 'power') || 'energy';
        const analyticsPeriod = (period as '24h' | '7d' | '30d') || '24h';

        const analyticsData = await threePhasePowerService.getAnalyticsData(
            deviceId as string,
            analyticsType,
            analyticsPeriod
        );

        // Add daily consumption for chart
        const dailyConsumption = [];
        const days = analyticsPeriod === '7d' ? 7 : analyticsPeriod === '30d' ? 30 : 7;
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            dailyConsumption.push({
                day: dayNames[date.getDay()],
                consumption: Math.random() * 50 + 20 // Mock data - replace with actual
            });
        }

        res.status(200).json({
            success: true,
            data: {
                ...analyticsData,
                dailyConsumption
            }
        });
    } catch (error) {
        console.error('Error getting analytics:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to retrieve analytics data'
            }
        });
    }
});

// 7. GET /dashboard/statistics - Aggregated statistics
app.get('/api/dashboard/statistics', validateDeviceId, async (req: Request, res: Response) => {
    try {
        const { deviceId, period } = req.query;
        const statsPeriod = (period as 'today' | 'week' | 'month') || 'today';

        const stats = await threePhasePowerService.getStatistics(
            deviceId as string,
            statsPeriod
        );

        res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error getting statistics:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to retrieve statistics'
            }
        });
    }
});

// 8. GET /dashboard/insights - AI-generated insights and alerts
app.get('/api/dashboard/insights', validateDeviceId, async (req: Request, res: Response) => {
    try {
        const { deviceId } = req.query;

        // Get current and historical data for insights
        const stats = await threePhasePowerService.getStatistics(deviceId as string, 'today');
        const yesterdayStats = await threePhasePowerService.getStatistics(deviceId as string, 'week');

        const insightsData = {
            currentEnergy: stats.totalEnergy,
            yesterdayEnergy: yesterdayStats.totalEnergy / 7, // Approximate
            averageVoltage: stats.averageVoltage,
            minVoltage: stats.averageVoltage - 5, // Mock
            maxVoltage: stats.averageVoltage + 5, // Mock
            nightTimeLoad: 1.2, // Mock - would come from actual night-time query
            peakPower: stats.peakPower,
            powerFactor: 0.92 // Mock - would come from actual data
        };

        const insights = await insightsService.generateInsights(deviceId as string, insightsData);

        // Check for phase imbalance
        const phaseData = await threePhasePowerService.getPhaseContributions(deviceId as string);
        const phaseContributions = Object.values(phaseData).map((p: any) => p.contribution);
        
        if (phaseContributions.length === 3) {
            const imbalanceInsight = insightsService.detectPhaseImbalance(
                phaseContributions[0],
                phaseContributions[1],
                phaseContributions[2]
            );
            if (imbalanceInsight) {
                insights.push(imbalanceInsight);
            }
        }

        res.status(200).json({
            success: true,
            data: insights
        });
    } catch (error) {
        console.error('Error generating insights:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to generate insights'
            }
        });
    }
});

// 9. PUT /dashboard/user-profile - Update user profile
app.put('/api/dashboard/user-profile', async (req: Request, res: Response) => {
    try {
        const { connectionCategory, monthlyBudget } = req.body;

        const updates: any = {};
        if (connectionCategory) updates.connectionCategory = connectionCategory;
        if (monthlyBudget !== undefined) updates.monthlyBudget = monthlyBudget;

        const updatedProfile = updateUserProfile('user-1', updates); // Default user

        if (!updatedProfile) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'USER_NOT_FOUND',
                    message: 'User not found'
                }
            });
        }

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully'
        });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to update user profile'
            }
        });
    }
});

// 10. GET /dashboard/phase-data - Phase-wise detailed data
app.get('/api/dashboard/phase-data', validateDeviceId, async (req: Request, res: Response) => {
    try {
        const { deviceId } = req.query;

        const phaseData = await threePhasePowerService.getPhaseContributions(deviceId as string);

        res.status(200).json({
            success: true,
            data: phaseData
        });
    } catch (error) {
        console.error('Error getting phase data:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to retrieve phase data'
            }
        });
    }
});

// POST endpoint to store 3-phase readings (for ESP32 devices)
app.post('/api/dashboard/readings', async (req: Request, res: Response) => {
    try {
        const { deviceId, readings } = req.body as { deviceId: string; readings: ThreePhaseReadings };

        if (!deviceId || !readings) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMETERS',
                    message: 'deviceId and readings are required'
                }
            });
        }

        await threePhasePowerService.store3PhaseReading(deviceId, readings);

        res.status(200).json({
            success: true,
            message: 'Readings stored successfully'
        });
    } catch (error) {
        console.error('Error storing 3-phase reading:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to store readings'
            }
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
