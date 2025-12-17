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
            stats: 'GET /api/power/stats?timeRange=24h',
            latest: 'GET /api/power/latest',
            energyRange: 'GET /api/power/energy/range?from=...&to=...'
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
