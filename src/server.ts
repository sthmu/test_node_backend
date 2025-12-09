import express, {Request,Response} from 'express';
import cors from 'cors';
import powerMonitorService from './services/powerMonitorService';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.text({ type: '*/*' }));

// Simple in-memory store for test calls
const testCalls: { ip: string; time: string; data?: string }[] = [];

app.get('/', (req: Request, res: Response) => {
    res.send('Hello, World!');
});

// POST endpoint: store custom data with IP and time
app.post('/api/test', (req: Request, res: Response) => {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const time = new Date().toISOString();

    let data;
    try {
        const parsed = JSON.parse(req.body);
        data = parsed.data;
    } catch {
        data = req.body;
    }

    const entry = { ip, time, data: data || undefined };
    testCalls.push(entry);

    res.json({
        message: 'Test data stored',
        ...entry,
        totalCalls: testCalls.length
    });
});

// Test endpoint: record caller IP and time
app.get('/api/test', (req: Request, res: Response) => {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const time = new Date().toISOString();

    testCalls.push({ ip, time });

    res.json({
        message: 'Test endpoint called',
        ip,
        time,
        totalCalls: testCalls.length
    });
});

// Get last test call info
app.get('/api/test/last', (req: Request, res: Response) => {
    if (testCalls.length === 0) {
        return res.status(200).json({
            message: 'Test endpoint has not been called yet'
        });
    }

    const last = testCalls[testCalls.length - 1];
    res.status(200).json(last);
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
