import { Point } from '@influxdata/influxdb3-client';
import { influxClient, database } from '../db';
import { ThreePhaseReadings, PhaseReading, HourlyUsageData, PhaseData } from '../types';

/**
 * Three-Phase Power Monitoring Service
 * Handles 3-phase energy meter data storage and retrieval
 */
class ThreePhasePowerService {

    /**
     * Store 3-phase energy reading
     */
    async store3PhaseReading(deviceId: string, readings: ThreePhaseReadings): Promise<void> {
        try {
            const points: any[] = [];

            // Store each phase reading
            for (const [phaseNum, phaseData] of Object.entries(readings.phases)) {
                const point = Point.measurement('three_phase_energy')
                    .setTag('device_id', deviceId)
                    .setTag('phase', phaseNum)
                    .setFloatField('voltage', phaseData.voltage)
                    .setFloatField('current', phaseData.current)
                    .setFloatField('power', phaseData.power)
                    .setFloatField('energy_wh', phaseData.energy_wh)
                    .setFloatField('power_factor', phaseData.powerFactor)
                    .setTimestamp(new Date(readings.timestamp));
                
                points.push(point);
            }

            // Store total/aggregate reading
            const totalPoint = Point.measurement('three_phase_total')
                .setTag('device_id', deviceId)
                .setFloatField('total_energy_wh', readings.total.energy_wh)
                .setFloatField('avg_voltage', readings.total.voltage)
                .setFloatField('total_current', readings.total.current)
                .setFloatField('total_power', readings.total.power)
                .setTimestamp(new Date(readings.timestamp));
            
            points.push(totalPoint);

            await influxClient.write(points, database);
            console.log(`3-phase reading stored for device ${deviceId}`);
        } catch (error) {
            console.error('Error storing 3-phase reading:', error);
            throw error;
        }
    }

    /**
     * Get latest 3-phase readings for a device
     */
    async getLatestReadings(deviceId: string, phases: number[] = [1, 2, 3]): Promise<ThreePhaseReadings | null> {
        try {
            const phaseCondition = phases.map(p => `'${p}'`).join(', ');
            
            const query = `
                SELECT time, phase, voltage, current, power, energy_wh, power_factor
                FROM three_phase_energy
                WHERE device_id = '${deviceId}'
                  AND phase IN (${phaseCondition})
                ORDER BY time DESC
                LIMIT ${phases.length}
            `;

            const result = await influxClient.query(query, database);
            const phaseReadings: any = {};
            let latestTime: string | null = null;

            for await (const row of result) {
                if (!latestTime) latestTime = row.time;
                
                phaseReadings[row.phase] = {
                    voltage: row.voltage,
                    current: row.current,
                    power: row.power,
                    energy_wh: row.energy_wh,
                    powerFactor: row.power_factor
                };
            }

            if (Object.keys(phaseReadings).length === 0) {
                return null;
            }

            // Get total data
            const totalQuery = `
                SELECT time, total_energy_wh, avg_voltage, total_current, total_power
                FROM three_phase_total
                WHERE device_id = '${deviceId}'
                ORDER BY time DESC
                LIMIT 1
            `;

            const totalResult = await influxClient.query(totalQuery, database);
            let totalData = {
                energy_wh: 0,
                voltage: 230,
                current: 0,
                power: 0
            };

            for await (const row of totalResult) {
                totalData = {
                    energy_wh: row.total_energy_wh,
                    voltage: row.avg_voltage,
                    current: row.total_current,
                    power: row.total_power
                };
            }

            return {
                phases: phaseReadings,
                total: totalData,
                timestamp: latestTime ? new Date(latestTime).toISOString() : new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting latest readings:', error);
            throw error;
        }
    }

    /**
     * Get hourly usage data for a specific date
     */
    async getHourlyUsage(deviceId: string, date: string, phases: number[] = [1, 2, 3]): Promise<HourlyUsageData[]> {
        try {
            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            
            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);

            const hourlyData: HourlyUsageData[] = [];

            // Generate 24 hours
            for (let hour = 0; hour < 24; hour++) {
                const hourStart = new Date(startDate);
                hourStart.setHours(hour);
                
                const hourEnd = new Date(startDate);
                hourEnd.setHours(hour + 1);

                const phaseEnergy: any = { hour: hour.toString().padStart(2, '0') + ':00' };

                // Query energy for each phase in this hour
                for (const phase of phases) {
                    const query = `
                        SELECT SUM(energy_wh) as total_wh
                        FROM three_phase_energy
                        WHERE device_id = '${deviceId}'
                          AND phase = '${phase}'
                          AND time >= '${hourStart.toISOString()}'
                          AND time < '${hourEnd.toISOString()}'
                    `;

                    const result = await influxClient.query(query, database);
                    
                    for await (const row of result) {
                        phaseEnergy[`phase${phase}`] = parseFloat(((row.total_wh || 0) / 1000).toFixed(3)); // Convert to kWh
                    }

                    // Set to 0 if no data
                    if (!phaseEnergy[`phase${phase}`]) {
                        phaseEnergy[`phase${phase}`] = 0;
                    }
                }

                hourlyData.push(phaseEnergy);
            }

            return hourlyData;
        } catch (error) {
            console.error('Error getting hourly usage:', error);
            throw error;
        }
    }

    /**
     * Get device health status
     */
    async getDeviceHealthStatus(deviceId: string): Promise<'ok' | 'warning' | 'offline'> {
        try {
            const query = `
                SELECT time
                FROM three_phase_total
                WHERE device_id = '${deviceId}'
                ORDER BY time DESC
                LIMIT 1
            `;

            const result = await influxClient.query(query, database);
            
            for await (const row of result) {
                const lastTime = new Date(row.time);
                const now = new Date();
                const minutesSinceLastData = (now.getTime() - lastTime.getTime()) / (1000 * 60);

                if (minutesSinceLastData <= 5) {
                    return 'ok';
                } else if (minutesSinceLastData <= 10) {
                    return 'warning';
                } else {
                    return 'offline';
                }
            }

            return 'offline';
        } catch (error) {
            console.error('Error checking device health:', error);
            return 'offline';
        }
    }

    /**
     * Get 24-hour energy consumption for a device
     */
    async get24HourEnergy(deviceId: string): Promise<number> {
        try {
            const query = `
                SELECT SUM(total_energy_wh) as total_wh
                FROM three_phase_total
                WHERE device_id = '${deviceId}'
                  AND time >= now() - INTERVAL '24 hours'
            `;

            const result = await influxClient.query(query, database);
            
            for await (const row of result) {
                return parseFloat(((row.total_wh || 0) / 1000).toFixed(2)); // Convert to kWh
            }

            return 0;
        } catch (error) {
            console.error('Error getting 24h energy:', error);
            return 0;
        }
    }

    /**
     * Get phase-wise contribution percentages
     */
    async getPhaseContributions(deviceId: string): Promise<{ [key: string]: PhaseData }> {
        try {
            const query = `
                SELECT phase, 
                       AVG(voltage) as avg_voltage,
                       AVG(current) as avg_current,
                       AVG(power) as avg_power,
                       SUM(energy_wh) as total_energy
                FROM three_phase_energy
                WHERE device_id = '${deviceId}'
                  AND time >= now() - INTERVAL '24 hours'
                GROUP BY phase
            `;

            const result = await influxClient.query(query, database);
            const phaseData: any = {};
            let totalEnergy = 0;

            // First pass: collect data and calculate total
            interface TempPhaseData {
                voltage: number;
                current: number;
                power: number;
                energy: number;
            }
            const tempData: Record<string, TempPhaseData> = {};
            
            for await (const row of result) {
                tempData[row.phase] = {
                    voltage: row.avg_voltage,
                    current: row.avg_current,
                    power: row.avg_power,
                    energy: row.total_energy
                };
                totalEnergy += row.total_energy;
            }

            // Second pass: calculate percentages
            for (const [phase, data] of Object.entries(tempData)) {
                const contribution = totalEnergy > 0 ? ((data.energy / totalEnergy) * 100) : 0;
                phaseData[phase] = {
                    contribution: parseFloat(contribution.toFixed(1)),
                    voltage: parseFloat(data.voltage.toFixed(1)),
                    current: parseFloat(data.current.toFixed(2)),
                    power: parseFloat(data.power.toFixed(1))
                };
            }

            return phaseData;
        } catch (error) {
            console.error('Error getting phase contributions:', error);
            throw error;
        }
    }

    /**
     * Get statistics for a time period
     */
    async getStatistics(deviceId: string, period: 'today' | 'week' | 'month'): Promise<any> {
        try {
            let interval = '24 hours';
            if (period === 'week') interval = '7 days';
            if (period === 'month') interval = '30 days';

            const query = `
                SELECT 
                    SUM(total_energy_wh) as total_energy,
                    AVG(avg_voltage) as avg_voltage,
                    MAX(total_power) as peak_power
                FROM three_phase_total
                WHERE device_id = '${deviceId}'
                  AND time >= now() - INTERVAL '${interval}'
            `;

            const result = await influxClient.query(query, database);
            
            for await (const row of result) {
                // Get latest reading for timestamp
                const latestQuery = `
                    SELECT time, total_energy_wh, avg_voltage, total_current
                    FROM three_phase_total
                    WHERE device_id = '${deviceId}'
                    ORDER BY time DESC
                    LIMIT 1
                `;

                const latestResult = await influxClient.query(latestQuery, database);
                let latestReading: any = null;

                for await (const latest of latestResult) {
                    latestReading = {
                        timestamp: latest.time,
                        energy: parseFloat(((latest.total_energy_wh || 0) / 1000).toFixed(2)),
                        voltage: parseFloat((latest.avg_voltage || 230).toFixed(1)),
                        current: parseFloat((latest.total_current || 0).toFixed(2))
                    };
                }

                return {
                    totalEnergy: parseFloat(((row.total_energy || 0) / 1000).toFixed(2)),
                    averageVoltage: parseFloat((row.avg_voltage || 230).toFixed(1)),
                    peakPower: parseFloat((row.peak_power || 0).toFixed(0)),
                    latestReading
                };
            }

            return {
                totalEnergy: 0,
                averageVoltage: 230,
                peakPower: 0,
                latestReading: null
            };
        } catch (error) {
            console.error('Error getting statistics:', error);
            throw error;
        }
    }

    /**
     * Get analytics data for charts
     */
    async getAnalyticsData(
        deviceId: string,
        type: 'energy' | 'voltage' | 'power',
        period: '24h' | '7d' | '30d'
    ): Promise<any> {
        try {
            let interval = '24 hours';
            let groupBy = '1 hour';
            
            if (period === '7d') {
                interval = '7 days';
                groupBy = '6 hours';
            } else if (period === '30d') {
                interval = '30 days';
                groupBy = '1 day';
            }

            const query = `
                SELECT 
                    DATE_BIN(INTERVAL '${groupBy}', time) as time_bucket,
                    AVG(total_energy_wh) as avg_energy,
                    AVG(avg_voltage) as avg_voltage,
                    AVG(total_power) as avg_power
                FROM three_phase_total
                WHERE device_id = '${deviceId}'
                  AND time >= now() - INTERVAL '${interval}'
                GROUP BY time_bucket
                ORDER BY time_bucket ASC
            `;

            const result = await influxClient.query(query, database);
            const energyTrend: any[] = [];

            for await (const row of result) {
                energyTrend.push({
                    time: row.time_bucket,
                    energy: parseFloat(((row.avg_energy || 0) / 1000).toFixed(2)),
                    voltage: parseFloat((row.avg_voltage || 230).toFixed(1)),
                    charge: 0 // Deprecated but kept for compatibility
                });
            }

            return { energyTrend };
        } catch (error) {
            console.error('Error getting analytics data:', error);
            throw error;
        }
    }
}

export default new ThreePhasePowerService();
