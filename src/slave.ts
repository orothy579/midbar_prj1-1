import { SerialPort } from 'serialport'
import crc from 'crc'
import { faker } from '@faker-js/faker'

// 사용할 시리얼 포트
const SERIAL_PORT = '/dev/ttyV1'
const BAUD_RATE = 9600

// SerialPort 인스턴스 생성 (Slave 역할)
const port = new SerialPort({
    path: SERIAL_PORT,
    baudRate: BAUD_RATE,
})

function floatToModbusRegisters(values: number): number[] {
    // Float data개수 * 4바이트 할당
    const buffer = Buffer.alloc(4)
    buffer.writeFloatBE(values, 0)

    // 2바이트씩 읽어서 배열에 추가
    const registers: number[] = []
    for (let i = 0; i < buffer.length; i += 2) {
        registers.push(buffer.readUInt16BE(i))
    }

    return registers
}
let holdingRegisters = floatToModbusRegisters(faker.number.float({ max: 100 }))

setInterval(() => {
    holdingRegisters = floatToModbusRegisters(faker.number.float({ max: 100 }))
}, 5000)

// Master의 요청을 감지하고 처리
port.on('data', (data: Buffer) => {
    console.log('Request Received:', data.toString('hex'))

    if (data.length >= 8 && data[1] === 3) {
        const startAddress = data.readUInt16BE(2) // 요청된 시작 주소
        const quantity = data.readUInt16BE(4) // 요청된 레지스터 개수

        console.log(
            `Request info : Function: ${data[1]}, Start Address: ${startAddress}, Quantity: ${quantity}`
        )

        // 응답 패킷 생성
        const response = Buffer.alloc(3 + quantity * 2) // Slave ID(1) + Function Code(1) + Byte Count(1) + Data(N)
        response[0] = data[0] // Slave ID
        response[1] = 0x03 // Function Code
        response[2] = quantity * 2 // Byte Count (Register 개수 * 2 바이트)

        // 요청된 개수만큼 레지스터 데이터 채우기
        for (let i = 0; i < quantity; i++) {
            const registerValue = holdingRegisters[startAddress + i]
            response.writeUInt16BE(registerValue, 3 + i * 2)
        }

        // CRC
        const crcValue = crc.crc16modbus(response)
        const crcBuffer = Buffer.from([crcValue & 0xff, (crcValue >> 8) & 0xff])

        const finalResponse = Buffer.concat([response, crcBuffer])

        // Master에게 응답 전송
        port.write(finalResponse, () => {
            console.log('Response Sent (HEX):', finalResponse.toString('hex'))
        })
    }
})

console.log(`Modbus started : ${SERIAL_PORT}`)
