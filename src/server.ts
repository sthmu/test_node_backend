import express, {Request,Response} from 'express';
import cors from 'cors';
import powerMonitorService from './services/powerMonitorService';

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
        message: 'Energy Monitoring API',
        endpoints: {
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
            // Dashboard endpoints
            dashboardReadings: 'GET /api/dashboard/readings?phases=[1,2,3]&deviceId=...',
            dashboardHourlyUsage: 'GET /api/dashboard/hourly-usage?date=...&phases=[1,2,3]&deviceId=...',
            dashboardDeviceInfo: 'GET /api/dashboard/device-info?deviceId=...',
            dashboardUserProfile: 'GET /api/dashboard/user-profile',
            dashboardCalculateBill: 'POST /api/dashboard/calculate-bill',
            dashboardAnalytics: 'GET /api/dashboard/analytics?type=...&period=...&phases=[1,2,3]&deviceId=...'
        }
    });
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
app.post('/api/energy-measurement', async (req: Request, res: Response) => {
    try {
        let body;
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } catch {
            return res.status(400).json({ status: 'ERROR', message: 'Invalid JSON' });
        }

        const { ts, e_Wh, p_W, v_rms, i_rms, pf, v_min, v_max, p_peak } = body;

        // Generate missing fields where possible
        const currentTime = Math.floor(Date.now() / 1000); // Current UNIX timestamp
        const generatedTs = ts || currentTime;

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

// GET Real-Time Energy Readings
app.get('/api/dashboard/readings', async (req: Request, res: Response) => {
    try {
        const { phases, deviceId } = req.query;

        // For now, return mock data based on existing power data
        const latestData = await powerMonitorService.getPowerUsage('1h');

        if (latestData.length === 0) {
            return res.status(200).json({
                success: false,
                error: {
                    code: 'NO_DATA',
                    message: 'No recent readings available'
                }
            });
        }

        // Use the most recent reading as base
        const recentReading = latestData[0];

        // Mock multi-phase data based on single reading
        const mockPhases: any = {};
        const requestedPhases = phases ? JSON.parse(phases as string) : [1, 2, 3];

        requestedPhases.forEach((phase: number) => {
            // Add some variation for different phases
            const variation = (phase - 2) * 2; // Phase 1: -2, Phase 2: 0, Phase 3: +2
            mockPhases[phase] = {
                voltage: recentReading.voltage + variation,
                charge: recentReading.charge + (variation * 0.1),
                energy_wh: recentReading.energy_wh * (1 + variation * 0.01)
            };
        });

        const totalEnergy = Object.values(mockPhases).reduce((sum: number, phase: any) => sum + phase.energy_wh, 0);

        res.status(200).json({
            success: true,
            data: {
                timestamp: new Date().toISOString(),
                phases: mockPhases,
                total: {
                    energy_wh: totalEnergy
                }
            }
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

// GET Hourly Energy Usage by Phase
app.get('/api/dashboard/hourly-usage', async (req: Request, res: Response) => {
    try {
        const { date, phases, deviceId } = req.query;

        // Get data for the last 24 hours
        const data = await powerMonitorService.getPowerUsage('24h');

        // Group by hour and create mock phase data
        const hourlyData: any[] = [];
        const hours = Array.from({ length: 24 }, (_, i) => {
            const hour = i.toString().padStart(2, '0') + ':00';
            const hourData: any = {
                hour,
                phase1: Math.random() * 5 + 1, // Mock data
                phase2: Math.random() * 5 + 1,
                phase3: Math.random() * 5 + 1
            };
            hourData.total = hourData.phase1 + hourData.phase2 + hourData.phase3;
            return hourData;
        });

        res.status(200).json({
            success: true,
            data: hours
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

// GET Device Information
app.get('/api/dashboard/device-info', async (req: Request, res: Response) => {
    try {
        const { deviceId } = req.query;

        // Mock device info - in real implementation, this would come from database
        const deviceInfo = {
            name: 'University of Kelaniya - A7 Building',
            location: 'A7 Building, University of Kelaniya',
            deviceId: deviceId || 'ESP32-A1B2C3',
            status: 'Online',
            lastUpdate: new Date().toISOString(),
            phases: [
                {
                    id: 1,
                    status: 'Active',
                    currentVoltage: 230.5
                },
                {
                    id: 2,
                    status: 'Active',
                    currentVoltage: 228.3
                },
                {
                    id: 3,
                    status: 'Active',
                    currentVoltage: 231.2
                }
            ]
        };

        res.status(200).json({
            success: true,
            data: deviceInfo
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

// GET User Profile
app.get('/api/dashboard/user-profile', async (req: Request, res: Response) => {
    try {
        // Mock user profile - in real implementation, this would use authentication
        const userProfile = {
            name: 'Nuwan Perera',
            email: 'nuwan.perera@kln.ac.lk',
            role: 'Admin',
            avatar: 'NP'
        };

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

// POST Calculate Electricity Bill (Sri Lankan rates)
app.post('/api/dashboard/calculate-bill', async (req: Request, res: Response) => {
    try {
        const { totalEnergy, deviceId } = req.body;

        if (!totalEnergy || typeof totalEnergy !== 'number') {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_INPUT',
                    message: 'totalEnergy is required and must be a number'
                }
            });
        }

        // Convert Wh to kWh
        const energyKWh = totalEnergy / 1000;

        // Sri Lankan electricity tariff slabs (as of 2024)
        const slabs = [
            { name: 'Slab A', limit: 30, rate: 8.00 },
            { name: 'Slab B', limit: 30, rate: 15.00 },
            { name: 'Slab C', limit: 30, rate: 20.00 },
            { name: 'Slab D', limit: 30, rate: 30.00 },
            { name: 'Slab E', limit: Infinity, rate: 50.00 }
        ];

        let remainingEnergy = energyKWh;
        let totalCharge = 0;
        const breakdown = [];
        let highestSlab = 'Slab A';

        for (const slab of slabs) {
            if (remainingEnergy <= 0) break;

            const unitsInSlab = Math.min(remainingEnergy, slab.limit);
            const charge = unitsInSlab * slab.rate;
            totalCharge += charge;

            breakdown.push({
                slab: slab.name,
                units: unitsInSlab,
                rate: slab.rate,
                charge: Math.round(charge * 100) / 100
            });

            remainingEnergy -= unitsInSlab;
            highestSlab = slab.name;
        }

        const fixedCharge = 1000.00; // Monthly fixed charge
        const totalBill = totalCharge + fixedCharge;

        res.status(200).json({
            success: true,
            data: {
                energyCharge: Math.round(totalCharge * 100) / 100,
                fixedCharge: fixedCharge,
                discount: 0,
                penalty: 0,
                totalBill: Math.round(totalBill * 100) / 100,
                highestSlab: highestSlab,
                breakdown: breakdown
            }
        });
    } catch (error) {
        console.error('Error calculating bill:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to calculate electricity bill'
            }
        });
    }
});

// GET Analytics Data
app.get('/api/dashboard/analytics', async (req: Request, res: Response) => {
    try {
        const { type, period, phases, deviceId } = req.query;

        // Get data based on period
        const timeRange = period === '7d' ? '168h' : period === '30d' ? '720h' : '24h';
        const data = await powerMonitorService.getPowerUsage(timeRange);

        // Create mock analytics data
        const chartData = data.slice(0, 24).map((reading, index) => ({
            time: new Date(reading.time).toISOString().slice(11, 16), // HH:MM format
            energy: reading.energy_wh,
            voltage: reading.voltage,
            charge: reading.charge
        }));

        res.status(200).json({
            success: true,
            data: {
                type: type || 'energy-trend',
                period: period || '24h',
                chartData: chartData
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
