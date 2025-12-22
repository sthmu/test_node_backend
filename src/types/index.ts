// Three-phase energy monitoring types

export interface PhaseReading {
    voltage: number;
    current: number;
    power: number;
    energy_wh: number;
    powerFactor: number;
}

export interface ThreePhaseReadings {
    phases: {
        "1": PhaseReading;
        "2": PhaseReading;
        "3": PhaseReading;
    };
    total: {
        energy_wh: number;
        voltage: number;
        current: number;
        power: number;
    };
    timestamp: string;
}

export interface HourlyUsageData {
    hour: string;
    phase1: number;
    phase2: number;
    phase3: number;
}

export interface DeviceInfo {
    name: string;
    location: string;
    deviceId: string;
    status: 'online' | 'warning' | 'offline';
    lastDataReceived: string;
    healthStatus: 'ok' | 'warning' | 'offline';
    energy24h: number;
}

export interface UserProfile {
    name: string;
    email: string;
    role: string;
    connectionCategory: 'domestic-3phase' | 'general-purpose-3phase' | 'industrial-3phase';
    monthlyBudget: number;
}

export interface BillCalculationRequest {
    totalEnergy: number;
    deviceId: string;
    connectionCategory: 'domestic-3phase' | 'general-purpose-3phase' | 'industrial-3phase';
    billingPeriod: 'monthly' | 'daily';
    maxDemandKVA?: number;
    averagePowerFactor?: number;
}

export interface SlabBreakdown {
    slab: string;
    units: number;
    rate: number;
    amount: number;
}

export interface DailyCost {
    date: string;
    cost: number;
}

export interface BillCalculationResponse {
    totalAmount: number;
    category: string;
    breakdown: SlabBreakdown[];
    fixedCharges: number;
    demandCharges: number;
    powerFactorAdjustment: number;
    maxDemandKVA: number;
    powerFactor: number;
    dailyCosts: DailyCost[];
}

export interface AnalyticsData {
    energyTrend: Array<{
        time: string;
        energy: number;
        voltage: number;
        charge: number;
    }>;
    dailyConsumption: Array<{
        day: string;
        consumption: number;
    }>;
}

export interface Statistics {
    totalEnergy: number;
    averageVoltage: number;
    peakPower: number;
    latestReading: {
        timestamp: string;
        energy: number;
        voltage: number;
        current: number;
    };
}

export interface Insight {
    message: string;
    severity: 'info' | 'warning' | 'critical';
    icon: string;
}

export interface PhaseData {
    contribution: number;
    voltage: number;
    current: number;
    power: number;
}

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

export type ErrorCode = 
    | 'DEVICE_NOT_FOUND'
    | 'NO_DATA_AVAILABLE'
    | 'INVALID_PARAMETERS'
    | 'CALCULATION_ERROR'
    | 'SERVER_ERROR';
