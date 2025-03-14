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
const REGISTER_START = 0
const REGISTER_COUNT = 2 // 2 * 데이터 개수

const dbPool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
})

// =========== DB =================

async function saveTodb(slaveID: number, data: number) {
    try {
        const query = {
            text: 'INSERT INTO rs485(slave_id, data) VALUES($1, $2)',
            values: [slaveID, data],
        }
        await dbPool.query(query)
        console.log('Data saved to DB')
    } catch (error) {
        console.error('DB error:', error)
    }
}

// =========== MQTT =================

const mqttClient = mqtt.connect(MQTT_URL, {
    username: ACCESS_TOKEN,
})

mqttClient.on('error', (err) => {
    console.error('MQTT error:', err)
})

// =========== Modbus =================

const modbusClient = new ModbusRTU()

// three numbers (each float is two 16bit registers)
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

// single number (one float from two 16bit registers)
function RegistersToFloat(register: number[]): number {
    const buffer = Buffer.alloc(4)
    buffer.writeUInt16BE(register[0], 0)
    buffer.writeUInt16BE(register[1], 2)
    return buffer.readFloatBE(0)
}

async function initModbus(): Promise<void> {
    if (!modbusClient.isOpen) {
        await modbusClient.connectRTUBuffered(SERIAL_PORT, { baudRate: BAUD_RATE })
        modbusClient.setTimeout(10)

        console.log('Modbus connected')
    }
}

async function detectSlaves(): Promise<number[]> {
    const Ids: number[] = []
    for (let id = 1; id <= 247; id++) {
        try {
            modbusClient.setID(id)
            await modbusClient.readHoldingRegisters(REGISTER_START, 1)
            Ids.push(id)
            console.log(`Deteced slave ID : ${id}`)
        } catch (err) {}
    }
    return Ids
}

// 어떤 환경센서 데이터를 읽어올지 모름. 일단 기본 구조만 잡기
async function pollSlaves(slaveIDs: number[]) {
    // Read data
    for (const id of slaveIDs) {
        try {
            modbusClient.setID(id)
            const data = await modbusClient.readHoldingRegisters(REGISTER_START, REGISTER_COUNT)
            const floatData = RegistersToFloat(data.data)

            console.log(`[slave ${id}] data: `, floatData)

            // MQTT pub
            const payload = JSON.stringify({
                slave_id: id,
                data: floatData,
            })
            mqttClient.publish('v1/devices/me/telemetry', payload, () => {
                console.log(`Published: ${payload}`)
            })

            // DB insert
            await saveTodb(id, floatData)
        } catch (error) {
            console.log(`slave ${id} error : `, error)
        }
    }
}

async function start() {
    await initModbus()
    const slaveIDs = await detectSlaves()
    console.log('Detected slave IDs: ', slaveIDs)

    setInterval(async () => {
        try {
            await pollSlaves(slaveIDs)
        } catch (error) {
            console.error('Polling error:', error)
        }
    }, 3000)
}

start().catch(console.error)
