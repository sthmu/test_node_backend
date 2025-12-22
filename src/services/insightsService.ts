import { Insight } from '../types';

/**
 * AI Insights Service
 * Generates intelligent alerts and recommendations based on energy usage patterns
 */
class InsightsService {

    /**
     * Generate insights based on current and historical data
     */
    async generateInsights(deviceId: string, data: {
        currentEnergy: number;
        yesterdayEnergy: number;
        averageVoltage: number;
        minVoltage: number;
        maxVoltage: number;
        nightTimeLoad: number;
        peakPower: number;
        powerFactor: number;
    }): Promise<Insight[]> {
        const insights: Insight[] = [];

        // Energy usage comparison
        const energyDiff = data.currentEnergy - data.yesterdayEnergy;
        const energyDiffPercent = (energyDiff / data.yesterdayEnergy) * 100;

        if (Math.abs(energyDiffPercent) > 15) {
            if (energyDiffPercent > 0) {
                insights.push({
                    message: `Energy usage is ${energyDiffPercent.toFixed(0)}% higher than yesterday`,
                    severity: 'warning',
                    icon: '📈'
                });
            } else {
                insights.push({
                    message: `Great! Energy usage is ${Math.abs(energyDiffPercent).toFixed(0)}% lower than yesterday`,
                    severity: 'info',
                    icon: '📉'
                });
            }
        }

        // Night-time base load detection
        if (data.nightTimeLoad > 1.5) {
            insights.push({
                message: `High night-time base load detected (2-6 AM): ${data.nightTimeLoad.toFixed(1)} kW`,
                severity: 'info',
                icon: '🌙'
            });
        }

        // Voltage monitoring
        const safeVoltageMin = 207; // 90% of 230V
        const safeVoltageMax = 253; // 110% of 230V

        if (data.minVoltage < safeVoltageMin) {
            insights.push({
                message: `Voltage dropped below safe range (${data.minVoltage.toFixed(1)}V). Check electrical connections.`,
                severity: 'critical',
                icon: '⚡'
            });
        }

        if (data.maxVoltage > safeVoltageMax) {
            insights.push({
                message: `Voltage spike detected (${data.maxVoltage.toFixed(1)}V). Risk of equipment damage.`,
                severity: 'critical',
                icon: '⚠️'
            });
        }

        // Power factor insights (for non-domestic users)
        if (data.powerFactor < 0.85) {
            insights.push({
                message: `Low power factor (${data.powerFactor.toFixed(2)}). You're incurring penalty charges. Consider installing capacitors.`,
                severity: 'warning',
                icon: '💡'
            });
        } else if (data.powerFactor > 0.95) {
            insights.push({
                message: `Excellent power factor (${data.powerFactor.toFixed(2)})! You may be eligible for incentives.`,
                severity: 'info',
                icon: '⭐'
            });
        }

        // Peak demand alert
        if (data.peakPower > 5000) {
            insights.push({
                message: `High peak demand detected: ${(data.peakPower / 1000).toFixed(1)} kW. Consider load shifting to reduce demand charges.`,
                severity: 'warning',
                icon: '📊'
            });
        }

        // Voltage stability
        const voltageRange = data.maxVoltage - data.minVoltage;
        if (voltageRange > 15) {
            insights.push({
                message: `Unstable voltage detected (±${(voltageRange / 2).toFixed(1)}V variation). May affect sensitive equipment.`,
                severity: 'warning',
                icon: '🔌'
            });
        }

        // Energy efficiency tip
        if (insights.length === 0) {
            insights.push({
                message: 'All systems operating normally. Energy consumption is stable.',
                severity: 'info',
                icon: '✅'
            });
        }

        return insights;
    }

    /**
     * Detect phase imbalance
     */
    detectPhaseImbalance(phase1: number, phase2: number, phase3: number): Insight | null {
        const average = (phase1 + phase2 + phase3) / 3;
        const maxDeviation = Math.max(
            Math.abs(phase1 - average),
            Math.abs(phase2 - average),
            Math.abs(phase3 - average)
        );

        const deviationPercent = (maxDeviation / average) * 100;

        if (deviationPercent > 15) {
            return {
                message: `Phase imbalance detected: ${deviationPercent.toFixed(0)}% deviation. Balance loads across phases for optimal efficiency.`,
                severity: 'warning',
                icon: '⚖️'
            };
        }

        return null;
    }

    /**
     * Budget monitoring
     */
    checkBudgetStatus(currentCost: number, monthlyBudget: number, dayOfMonth: number): Insight | null {
        const daysInMonth = 30;
        const expectedSpend = (monthlyBudget / daysInMonth) * dayOfMonth;
        const variance = ((currentCost - expectedSpend) / expectedSpend) * 100;

        if (variance > 20) {
            return {
                message: `You're ${variance.toFixed(0)}% over budget for this point in the month. Current: Rs ${currentCost.toFixed(2)}, Expected: Rs ${expectedSpend.toFixed(2)}`,
                severity: 'warning',
                icon: '💰'
            };
        } else if (variance < -20) {
            return {
                message: `Great job! You're ${Math.abs(variance).toFixed(0)}% under budget this month.`,
                severity: 'info',
                icon: '💵'
            };
        }

        return null;
    }
}

export default new InsightsService();
