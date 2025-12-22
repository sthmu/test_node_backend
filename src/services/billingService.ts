import { BillCalculationRequest, BillCalculationResponse, SlabBreakdown, DailyCost } from '../types';

/**
 * Sri Lankan CEB Electricity Billing Service
 * Supports: Domestic 3-Phase, General Purpose 3-Phase, Industrial 3-Phase
 */
class BillingService {

    /**
     * DOMESTIC - 3 PHASE Tariff Calculation
     * Slab-based rates with fixed monthly charges
     * NO demand charges, NO power factor penalties
     */
    private calculateDomestic3Phase(totalEnergyKWh: number): { breakdown: SlabBreakdown[], fixedCharge: number, totalAmount: number } {
        // Sri Lankan CEB Domestic 3-Phase Slabs (2024 rates)
        const slabs = [
            { name: '0-30 kWh', limit: 30, rate: 7.85 },
            { name: '31-60 kWh', limit: 30, rate: 15.00 },
            { name: '61-90 kWh', limit: 30, rate: 20.00 },
            { name: '91-120 kWh', limit: 30, rate: 30.00 },
            { name: '121-180 kWh', limit: 60, rate: 42.00 },
            { name: '181+ kWh', limit: Infinity, rate: 50.00 }
        ];

        let remainingEnergy = totalEnergyKWh;
        const breakdown: SlabBreakdown[] = [];
        let energyCharge = 0;

        for (const slab of slabs) {
            if (remainingEnergy <= 0) break;

            const unitsInSlab = Math.min(remainingEnergy, slab.limit);
            const amount = unitsInSlab * slab.rate;
            energyCharge += amount;

            breakdown.push({
                slab: slab.name,
                units: parseFloat(unitsInSlab.toFixed(2)),
                rate: slab.rate,
                amount: parseFloat(amount.toFixed(2))
            });

            remainingEnergy -= unitsInSlab;
        }

        // Fixed charge based on consumption
        let fixedCharge = 0;
        if (totalEnergyKWh <= 60) {
            fixedCharge = 150.00;
        } else if (totalEnergyKWh <= 90) {
            fixedCharge = 350.00;
        } else if (totalEnergyKWh <= 120) {
            fixedCharge = 600.00;
        } else if (totalEnergyKWh <= 180) {
            fixedCharge = 750.00;
        } else {
            fixedCharge = 1000.00;
        }

        const totalAmount = energyCharge + fixedCharge;

        return { breakdown, fixedCharge, totalAmount };
    }

    /**
     * GENERAL PURPOSE - 3 PHASE Tariff Calculation
     * Flat energy rate + Maximum Demand charges + Power Factor penalty
     */
    private calculateGeneralPurpose3Phase(
        totalEnergyKWh: number, 
        maxDemandKVA: number, 
        powerFactor: number
    ): { breakdown: SlabBreakdown[], fixedCharge: number, demandCharges: number, pfAdjustment: number, totalAmount: number } {
        
        // Flat rate per kWh for GP connections
        const energyRate = 28.50;
        const energyCharge = totalEnergyKWh * energyRate;

        const breakdown: SlabBreakdown[] = [{
            slab: 'General Purpose Rate',
            units: parseFloat(totalEnergyKWh.toFixed(2)),
            rate: energyRate,
            amount: parseFloat(energyCharge.toFixed(2))
        }];

        // Fixed monthly charge
        const fixedCharge = 500.00;

        // Maximum Demand charge (Rs per kVA)
        const demandRate = 450.00; // Rs per kVA
        const demandCharges = maxDemandKVA * demandRate;

        // Power Factor penalty if PF < 0.85
        let pfAdjustment = 0;
        if (powerFactor < 0.85) {
            // 1% penalty for each 0.01 below 0.85
            const pfDeficit = 0.85 - powerFactor;
            const penaltyPercent = pfDeficit * 100;
            pfAdjustment = (energyCharge + demandCharges) * (penaltyPercent / 100);
        }

        const totalAmount = energyCharge + fixedCharge + demandCharges + pfAdjustment;

        return { breakdown, fixedCharge, demandCharges, pfAdjustment, totalAmount };
    }

    /**
     * INDUSTRIAL - 3 PHASE Tariff Calculation
     * Flat energy rate + MANDATORY Maximum Demand charges + PF penalty/incentive
     */
    private calculateIndustrial3Phase(
        totalEnergyKWh: number,
        maxDemandKVA: number,
        powerFactor: number
    ): { breakdown: SlabBreakdown[], fixedCharge: number, demandCharges: number, pfAdjustment: number, totalAmount: number } {
        
        // Flat rate for industrial connections
        const energyRate = 24.50;
        const energyCharge = totalEnergyKWh * energyRate;

        const breakdown: SlabBreakdown[] = [{
            slab: 'Industrial Rate',
            units: parseFloat(totalEnergyKWh.toFixed(2)),
            rate: energyRate,
            amount: parseFloat(energyCharge.toFixed(2))
        }];

        // Fixed monthly charge for industrial
        const fixedCharge = 1500.00;

        // MANDATORY Maximum Demand charges
        const demandRate = 550.00; // Rs per kVA (higher than GP)
        const demandCharges = maxDemandKVA * demandRate;

        // Power Factor adjustment (penalty OR incentive)
        let pfAdjustment = 0;
        if (powerFactor < 0.85) {
            // Penalty: 1.5% for each 0.01 below 0.85
            const pfDeficit = 0.85 - powerFactor;
            const penaltyPercent = pfDeficit * 150; // 1.5% per 0.01
            pfAdjustment = (energyCharge + demandCharges) * (penaltyPercent / 100);
        } else if (powerFactor > 0.90) {
            // Incentive: 0.5% discount for each 0.01 above 0.90
            const pfBonus = powerFactor - 0.90;
            const discountPercent = pfBonus * 50; // 0.5% per 0.01
            pfAdjustment = -(energyCharge + demandCharges) * (discountPercent / 100);
        }

        const totalAmount = energyCharge + fixedCharge + demandCharges + pfAdjustment;

        return { breakdown, fixedCharge, demandCharges, pfAdjustment, totalAmount };
    }

    /**
     * Main bill calculation function
     * Routes to appropriate tariff category
     */
    calculateBill(request: BillCalculationRequest): BillCalculationResponse {
        const totalEnergyKWh = request.totalEnergy;
        const maxDemandKVA = request.maxDemandKVA || 0;
        const powerFactor = request.averagePowerFactor || 0.90;

        let result;

        switch (request.connectionCategory) {
            case 'domestic-3phase':
                result = this.calculateDomestic3Phase(totalEnergyKWh);
                return {
                    totalAmount: parseFloat(result.totalAmount.toFixed(2)),
                    category: request.connectionCategory,
                    breakdown: result.breakdown,
                    fixedCharges: result.fixedCharge,
                    demandCharges: 0, // No demand charges for domestic
                    powerFactorAdjustment: 0, // No PF penalty for domestic
                    maxDemandKVA: 0,
                    powerFactor: powerFactor,
                    dailyCosts: this.generateDailyCosts(totalEnergyKWh, result.totalAmount)
                };

            case 'general-purpose-3phase':
                result = this.calculateGeneralPurpose3Phase(totalEnergyKWh, maxDemandKVA, powerFactor);
                return {
                    totalAmount: parseFloat(result.totalAmount.toFixed(2)),
                    category: request.connectionCategory,
                    breakdown: result.breakdown,
                    fixedCharges: result.fixedCharge,
                    demandCharges: parseFloat(result.demandCharges.toFixed(2)),
                    powerFactorAdjustment: parseFloat(result.pfAdjustment.toFixed(2)),
                    maxDemandKVA: parseFloat(maxDemandKVA.toFixed(2)),
                    powerFactor: powerFactor,
                    dailyCosts: this.generateDailyCosts(totalEnergyKWh, result.totalAmount)
                };

            case 'industrial-3phase':
                result = this.calculateIndustrial3Phase(totalEnergyKWh, maxDemandKVA, powerFactor);
                return {
                    totalAmount: parseFloat(result.totalAmount.toFixed(2)),
                    category: request.connectionCategory,
                    breakdown: result.breakdown,
                    fixedCharges: result.fixedCharge,
                    demandCharges: parseFloat(result.demandCharges.toFixed(2)),
                    powerFactorAdjustment: parseFloat(result.pfAdjustment.toFixed(2)),
                    maxDemandKVA: parseFloat(maxDemandKVA.toFixed(2)),
                    powerFactor: powerFactor,
                    dailyCosts: this.generateDailyCosts(totalEnergyKWh, result.totalAmount)
                };

            default:
                throw new Error('Invalid connection category');
        }
    }

    /**
     * Generate daily cost breakdown (simplified - assumes uniform distribution)
     * In production, this would use actual daily readings
     */
    private generateDailyCosts(totalEnergyKWh: number, totalAmount: number): DailyCost[] {
        const dailyCosts: DailyCost[] = [];
        const daysInMonth = 30;
        const dailyEnergy = totalEnergyKWh / daysInMonth;
        const dailyCost = totalAmount / daysInMonth;

        const today = new Date();
        
        for (let i = 0; i < daysInMonth; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() - (daysInMonth - 1 - i));
            
            dailyCosts.push({
                date: date.toISOString().split('T')[0],
                cost: parseFloat(dailyCost.toFixed(2))
            });
        }

        return dailyCosts;
    }
}

export default new BillingService();
