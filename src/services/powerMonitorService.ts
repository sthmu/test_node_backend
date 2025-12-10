import { Point } from '@influxdata/influxdb3-client';
import { influxClient, database } from '../db';

export interface PowerData {
    voltage: number;      // Average voltage in Volts (V) over the measurement period
    charge: number;       // Charge in Coulombs (C) accumulated over the measurement period (typically 1 minute)
    timestamp?: string;   // ISO timestamp (e.g. 2025-12-02T10:15:30Z) - server time used if not provided
}

class PowerMonitorService {

    /**
     * Calculate energy from voltage and charge
     * Energy (Wh) = Voltage (V) × Charge (C) / 3600
     * (1 Wh = 3600 joules, and V×C = joules)
     */
    private calculateEnergy(voltage: number, charge: number): number {
        return (voltage * charge) / 3600; // Convert joules to watt-hours
    }

    /**
     * Send power data to InfluxDB
     * Stores voltage (V), charge (C), and calculated energy (Wh)
     */
    async sendPowerData(data: PowerData): Promise<void> {
        try {
            const energyWh = this.calculateEnergy(data.voltage, data.charge);
            
            const point = Point.measurement('power_usage')
                .setFloatField('voltage', data.voltage)
                .setFloatField('charge', data.charge)
                .setFloatField('energy_wh', energyWh);

            // Always use server time for consistency (as per requirement)
            point.setTimestamp(new Date());

            await influxClient.write(point, database);
            console.log(`Energy data sent: ${energyWh.toFixed(4)}Wh (${data.voltage}V × ${data.charge}C)`);
        } catch (error) {
            console.error('Error sending power data:', error);
            throw error;
        }
    }

    /**
     * Send multiple power readings at once
     */
    async sendBatchPowerData(dataArray: PowerData[]): Promise<void> {
        try {
            const points = dataArray.map(data => {
                const energyWh = this.calculateEnergy(data.voltage, data.charge);
                const point = Point.measurement('power_usage')
                    .setFloatField('voltage', data.voltage)
                    .setFloatField('charge', data.charge)
                    .setFloatField('energy_wh', energyWh);

                // Always use server time
                point.setTimestamp(new Date());

                return point;
            });

            await influxClient.write(points, database);
            console.log(`Batch of ${dataArray.length} energy readings sent`);
        } catch (error) {
            console.error('Error sending batch power data:', error);
            throw error;
        }
    }

    /**
     * Query power usage data (returns energy readings)
     */
    async getPowerUsage(timeRange: string = '1h'): Promise<any[]> {
        try {
            const query = `SELECT time, voltage, charge, energy_wh 
                          FROM power_usage 
                          WHERE time >= now() - INTERVAL '${timeRange}'
                          ORDER BY time DESC`;

            const result = await influxClient.query(query, database);
            const data = [];
            
            for await (const row of result) {
                data.push(row);
            }
            
            return data;
        } catch (error) {
            console.error('Error querying power usage:', error);
            throw error;
        }
    }

    /**
     * Query power usage data between explicit from/to datetimes (ISO strings)
     */
    async getPowerUsageRange(fromIso: string, toIso: string): Promise<any[]> {
        try {
            const query = `SELECT time, voltage, charge, energy_wh
                           FROM power_usage
                           WHERE time >= '${fromIso}'
                             AND time <= '${toIso}'
                           ORDER BY time ASC`;

            const result = await influxClient.query(query, database);
            const data = [];

            for await (const row of result) {
                data.push(row);
            }

            return data;
        } catch (error) {
            console.error('Error querying power usage range:', error);
            throw error;
        }
    }

    /**
     * Get total energy consumption (in kWh)
     * Sums all energy_wh readings in the time range and converts to kWh
     */
    async getTotalEnergyConsumption(timeRange: string = '24h'): Promise<number> {
        try {
            const query = `SELECT SUM(energy_wh) as total_wh 
                          FROM power_usage 
                          WHERE time >= now() - INTERVAL '${timeRange}'`;

            const result = await influxClient.query(query, database);
            
            for await (const row of result) {
                const totalWh = row.total_wh || 0;
                return totalWh / 1000; // Convert Wh to kWh
            }
            
            return 0;
        } catch (error) {
            console.error('Error calculating energy consumption:', error);
            throw error;
        }
    }

}

export default new PowerMonitorService();
