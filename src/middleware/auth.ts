import { Request, Response, NextFunction } from 'express';

/**
 * Device Authentication Middleware
 * Validates deviceId parameter for dashboard endpoints
 */
export const validateDeviceId = (req: Request, res: Response, next: NextFunction) => {
    const deviceId = req.query.deviceId as string || req.body.deviceId as string;

    // For endpoints that don't require deviceId (e.g., user-profile)
    const optionalDeviceIdEndpoints = ['/api/dashboard/user-profile'];
    
    if (optionalDeviceIdEndpoints.some(endpoint => req.path.includes(endpoint))) {
        return next();
    }

    if (!deviceId) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_PARAMETERS',
                message: 'deviceId parameter is required'
            }
        });
    }

    // Basic validation - ensure deviceId is alphanumeric with hyphens
    const deviceIdPattern = /^[a-zA-Z0-9-_]+$/;
    if (!deviceIdPattern.test(deviceId)) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_PARAMETERS',
                message: 'Invalid deviceId format'
            }
        });
    }

    // In production, you would verify the device exists and user has access
    // For now, we'll just validate the format

    next();
};

/**
 * Mock user database (in production, use a real database)
 */
const mockUsers: any = {
    'user-1': {
        name: 'Nuwan Perera',
        email: 'nuwan.perera@kln.ac.lk',
        role: 'admin',
        connectionCategory: 'domestic-3phase',
        monthlyBudget: 5000
    },
    'user-2': {
        name: 'Kasun Silva',
        email: 'kasun.silva@example.com',
        role: 'user',
        connectionCategory: 'general-purpose-3phase',
        monthlyBudget: 15000
    }
};

const mockDevices: any = {
    'ESP32-A1B2C3': {
        name: 'Main Energy Meter',
        location: 'Building A - Ground Floor',
        userId: 'user-1'
    },
    'ESP32-D4E5F6': {
        name: 'Factory Power Monitor',
        location: 'Production Floor',
        userId: 'user-2'
    }
};

/**
 * Get user by ID
 */
export const getUserById = (userId: string) => {
    return mockUsers[userId] || null;
};

/**
 * Get device by ID
 */
export const getDeviceById = (deviceId: string) => {
    return mockDevices[deviceId] || null;
};

/**
 * Get user profile (mock - returns default user)
 */
export const getCurrentUser = () => {
    return mockUsers['user-1']; // Default user for now
};

/**
 * Update user profile
 */
export const updateUserProfile = (userId: string, updates: any) => {
    if (mockUsers[userId]) {
        mockUsers[userId] = { ...mockUsers[userId], ...updates };
        return mockUsers[userId];
    }
    return null;
};
