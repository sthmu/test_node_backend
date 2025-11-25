import powerMonitorService from './services/powerMonitorService';

async function insertTestData() {
    console.log('Starting to insert test data...\n');

    try {
        // Insert 10 test readings with random variations
        const testReadings = [];
        
        for (let i = 0; i < 10; i++) {
            const voltage = 220 + Math.random() * 20; // 220-240V
            const current = 5 + Math.random() * 2;     // 5-7A
            
            testReadings.push({
                voltage: parseFloat(voltage.toFixed(2)),
                current: parseFloat(current.toFixed(2))
            });
            
            // Small delay between readings
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log('Sending batch of test data...');
        await powerMonitorService.sendBatchPowerData(testReadings);
        console.log('✓ Successfully inserted 10 test readings\n');

        // Wait a bit and then query the data
        console.log('Retrieving data from last hour...');
        const data = await powerMonitorService.getPowerUsage('1h');
        console.log(`✓ Found ${data.length} readings\n`);

        // Display the data
        console.log('Sample readings:');
        data.slice(0, 5).forEach((reading, index) => {
            console.log(`${index + 1}. Time: ${reading.time}, Voltage: ${reading.voltage}V, Current: ${reading.current}A, Power: ${reading.power}W`);
        });

        // Get energy consumption
        console.log('\nCalculating total energy consumption...');
        const energy = await powerMonitorService.getTotalEnergyConsumption('1h');
        console.log(`✓ Total energy consumed in last hour: ${energy.toFixed(4)} kWh\n`);

        console.log('Test completed successfully!');
    } catch (error) {
        console.error('Error during test:', error);
    }
}

// Run the test
insertTestData();
