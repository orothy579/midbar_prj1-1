import { SerialPort } from 'serialport'
import crc from 'crc'
import { faker } from '@faker-js/faker'

// 사용할 시리얼 포트
const SERIAL_PORT = '/dev/ttyV1'
const BAUD_RATE = 9600

// 여러 개의 Slave ID를 저장하는 객체
const SLAVE_IDS = [1, 5, 10] // 예제: 3개의 Slave
const slaveRegisters: { [id: number]: number[] } = {}

// 각 Slave ID에 대해 초기값 설정
for (const id of SLAVE_IDS) {
    slaveRegisters[id] = floatToModbusRegisters(faker.number.float({ max: 100 }))
}

// 각 Slave의 데이터를 5초마다 갱신
setInterval(() => {
    for (const id of SLAVE_IDS) {
        slaveRegisters[id] = floatToModbusRegisters(faker.number.float({ max: 100 }))
    }
}, 5000)

// SerialPort 인스턴스 생성 (Slave 역할)
const port = new SerialPort({
    path: SERIAL_PORT,
    baudRate: BAUD_RATE,
})

function floatToModbusRegisters(values: number): number[] {
    const buffer = Buffer.alloc(4)
    buffer.writeFloatBE(values, 0)

    const registers: number[] = []
    for (let i = 0; i < buffer.length; i += 2) {
        registers.push(buffer.readUInt16BE(i))
    }

    return registers
}

// Master의 요청을 감지하고 처리
port.on('data', (data: Buffer) => {
    console.log('Request Received:', data.toString('hex'))

    if (data.length >= 8 && data[1] === 3) {
        const slaveId = data[0] // 요청된 Slave ID
        if (!(slaveId in slaveRegisters)) {
            console.log(`Unknown Slave ID: ${slaveId}, ignoring request.`)
            return
        }

        const startAddress = data.readUInt16BE(2)
        const quantity = data.readUInt16BE(4)

        console.log(
            `Request info: Slave ID: ${slaveId}, Function: ${data[1]}, Start Address: ${startAddress}, Quantity: ${quantity}`
        )

        // 요청 개수가 레지스터 크기를 초과하면 오류 처리
        const registers = slaveRegisters[slaveId]
        if (startAddress + quantity > registers.length) {
            console.error(`Invalid request: Requested registers exceed available data`)
            return
        }

        // 응답 패킷 생성
        const response = Buffer.alloc(3 + quantity * 2)
        response[0] = slaveId
        response[1] = 0x03
        response[2] = quantity * 2

        for (let i = 0; i < quantity; i++) {
            response.writeUInt16BE(registers[startAddress + i], 3 + i * 2)
        }

        // CRC 계산 및 추가
        const crcValue = crc.crc16modbus(response)
        const crcBuffer = Buffer.from([crcValue & 0xff, (crcValue >> 8) & 0xff])
        const finalResponse = Buffer.concat([response, crcBuffer])

        // Master에게 응답 전송
        port.write(finalResponse, () => {
            console.log(`Response Sent (HEX) for Slave ${slaveId}:`, finalResponse.toString('hex'))
        })
    }
})

console.log(`Modbus started on port: ${SERIAL_PORT}`)
console.log(`Active Slave IDs: ${SLAVE_IDS}`)
