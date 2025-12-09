import { Point } from '@influxdata/influxdb3-client';
import { influxClient, database } from '../db';

export interface PowerData {
    voltage: number;      // in Volts (V)
    current: number;      // in Amperes (A)
    // Optional ISO timestamp string (e.g. 2025-12-02T10:15:30Z)
    // If not provided, server time will be used
    timestamp?: string;
}

class PowerMonitorService {

    /**
     * Calculate power from voltage and current
     * Power (W) = Voltage (V) × Current (A)
     */
    private calculatePower(voltage: number, current: number): number {
        return voltage * current;
    }

    /**
     * Send power data to InfluxDB
     */
    async sendPowerData(data: PowerData): Promise<void> {
        try {
            const power = this.calculatePower(data.voltage, data.current);
            
            const point = Point.measurement('power_usage')
                .setFloatField('voltage', data.voltage)
                .setFloatField('current', data.current)
                .setFloatField('power', power);

            // Use device-provided timestamp if valid, otherwise now()
            if (data.timestamp) {
                const ts = new Date(data.timestamp);
                if (!isNaN(ts.getTime())) {
                    point.setTimestamp(ts);
                } else {
                    console.warn('Invalid timestamp provided, falling back to server time:', data.timestamp);
                    point.setTimestamp(new Date());
                }
            } else {
                point.setTimestamp(new Date());
            }

            await influxClient.write(point, database);
            console.log(`Power data sent: ${power}W (${data.voltage}V × ${data.current}A)`);
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
                const power = this.calculatePower(data.voltage, data.current);
                const point = Point.measurement('power_usage')
                    .setFloatField('voltage', data.voltage)
                    .setFloatField('current', data.current)
                    .setFloatField('power', power);

                if (data.timestamp) {
                    const ts = new Date(data.timestamp);
                    if (!isNaN(ts.getTime())) {
                        point.setTimestamp(ts);
                    } else {
                        console.warn('Invalid timestamp in batch item, falling back to server time:', data.timestamp);
                        point.setTimestamp(new Date());
                    }
                } else {
                    point.setTimestamp(new Date());
                }

                return point;
            });

            await influxClient.write(points, database);
            console.log(`Batch of ${dataArray.length} power readings sent`);
        } catch (error) {
            console.error('Error sending batch power data:', error);
            throw error;
        }
    }

    /**
     * Query power usage data
     */
    async getPowerUsage(timeRange: string = '1h'): Promise<any[]> {
        try {
            const query = `SELECT time, voltage, current, power 
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
            const query = `SELECT time, voltage, current, power
                           FROM power_usage
                           WHERE time >= TIMESTAMP '${fromIso}'
                             AND time <= TIMESTAMP '${toIso}'
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
     */
    async getTotalEnergyConsumption(timeRange: string = '24h'): Promise<number> {
        try {
            const query = `SELECT AVG(power) as avg_power 
                          FROM power_usage 
                          WHERE time >= now() - INTERVAL '${timeRange}'`;

            const result = await influxClient.query(query, database);
            
            for await (const row of result) {
                const avgPower = row.avg_power || 0;
                const hours = parseInt(timeRange.replace('h', ''));
                return (avgPower * hours) / 1000; // Convert to kWh
            }
            
            return 0;
        } catch (error) {
            console.error('Error calculating energy consumption:', error);
            throw error;
        }
    }

}

export default new PowerMonitorService();
