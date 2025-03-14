import dotenv from 'dotenv'
dotenv.config()
import ModbusRTU from 'modbus-serial'
import mqtt from 'mqtt'
import { Pool } from 'pg'

const MQTT_BROKER_IP = process.env.MQTT_BROKER_IP || 'localhost'
const MQTT_URL = `mqtt://${MQTT_BROKER_IP}:1883`
const ACCESS_TOKEN = process.env.ACCESS_TOKEN

const SERIAL_PORT = '/dev/ttyV0'
const BAUD_RATE = 9600
const SLAVE_ID: number[] = [1, 2, 3, 4, 5]
const REGISTER_START = 0
const REGISTER_COUNT = 6 // 2 * 데이터 개수

const dbPool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
})

const mqttClient = mqtt.connect(MQTT_URL, {
    username: ACCESS_TOKEN,
})

const modbusClient = new ModbusRTU()

mqttClient.on('error', (err) => {
    console.error('MQTT error:', err)
})

function RegistersToFloats(registers: number[]): number[] {
    const values: number[] = []
    for (let i = 0; i < registers.length; i += 2) {
        const buffer = Buffer.alloc(4)
        buffer.writeUInt16BE(registers[i], 0) // MSB
        buffer.writeUInt16BE(registers[i + 1], 2) // LSB
        values.push(buffer.readFloatBE(0)) // Float 변환 후 배열에 저장
    }
    return values
}

async function initModbus() {
    try {
        if (!modbusClient.isOpen) {
            await modbusClient.connectRTUBuffered(SERIAL_PORT, {
                baudRate: BAUD_RATE,
            })
            for (const id of SLAVE_ID) {
                modbusClient.setID(id)
            }
            console.log('Modbus connection successed')
        }
    } catch (error) {
        console.error('Modbus connection error:', error)
    }
}

async function saveTodb(data1: number, data2: number, data3: number) {
    try {
        const query = {
            text: 'INSERT INTO modbus_data(data1, data2, data3) VALUES($1, $2, $3)',
            values: [data1, data2, data3],
        }
        await dbPool.query(query)
        console.log('Data saved to DB')
    } catch (error) {
        console.error('DB error:', error)
    }
}

// 어떤 환경센서 데이터를 읽어올지 모름. 일단 기본 구조만 잡기

async function readModbusData() {
    console.log('Reading modbus data...')
    try {
        if (!modbusClient.isOpen) {
            console.log('Modbus connection lost. Reconnecting...')
            await initModbus()
        }
        const data = await modbusClient.readHoldingRegisters(REGISTER_START, REGISTER_COUNT)
    } catch (error) {
        console.error('Error reading modbus data: ', error)
    }
}
