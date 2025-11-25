import { InfluxDBClient } from '@influxdata/influxdb3-client';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.INFLUXDB_TOKEN;
const host = process.env.INFLUXDB_HOST || 'https://us-east-1-1.aws.cloud2.influxdata.com';
const database = process.env.INFLUXDB_DATABASE;

console.log('Using InfluxDB Database:', database);

if (!token) {
    throw new Error('INFLUXDB_TOKEN is not set in .env file');
}

const influxClient = new InfluxDBClient({ host, token });

export { influxClient, database };