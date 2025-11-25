import express, {Request,Response} from 'express';
import cors from 'cors';
import powerMonitorService from './services/powerMonitorService';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
    res.send('Hello, World!');
});

// POST endpoint to send power data to InfluxDB
app.post('/api/power', async (req: Request, res: Response) => {
    try {
        const { voltage, current } = req.body;

        if (!voltage || !current) {
            return res.status(400).json({ 
                error: 'Missing required fields: voltage and current' 
            });
        }

        await powerMonitorService.sendPowerData({ voltage, current });

        res.status(201).json({ 
            message: 'Power data stored successfully',
            data: { voltage, current, power: voltage * current }
        });
    } catch (error) {
        console.error('Error storing power data:', error);
        res.status(500).json({ error: 'Failed to store power data' });
    }
});

// POST endpoint to send multiple power readings
app.post('/api/power/batch', async (req: Request, res: Response) => {
    try {
        const { readings } = req.body;

        if (!readings || !Array.isArray(readings)) {
            return res.status(400).json({ 
                error: 'Missing required field: readings (array)' 
            });
        }

        await powerMonitorService.sendBatchPowerData(readings);

        res.status(201).json({ 
            message: `${readings.length} power readings stored successfully`
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
