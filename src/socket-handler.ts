import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { Socket } from 'net';

// too much work needed for this, currently replaced with rest endpoints
export class SocketHandler {
    clients: Socket[] = [];
    buffer: Buffer = Buffer.alloc(0);
    emitter: EventEmitter = new EventEmitter();

    handle(socket: Socket, request: IncomingMessage) {
        const key: string = createHash('sha1')
            .update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64');

        const headers: string[] = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + key];
        // console.log(headers);
        socket.write(headers.concat('\r\n').join('\r\n'));
        this.clients.push(socket);

        socket.on('data', data => {
            this.buffer = Buffer.concat([this.buffer, data], this.buffer.length + data.length);
            // console.log(data.toString());
            // console.log('a', socket.read());
            // console.log('data');

            console.log('data', data.length, data);
            // socket.write(encodeFrame('2222', false));

            // socket.destroy();
            while (this.buffer.length > 0) {
                let decodedData = this.decodeFrame();
                if (decodedData === '') {
                    socket.destroy();
                } else {
                    this.emitter.emit('data', decodedData);
                }
                console.log(decodedData, socket.readable);
            }
        });

        socket.on('end', () => {
            // this.clients.splice(this.clients.indexOf(socket), 1);
            // broadcast(socket.name + " left the chat.\n");
            console.log('end');
            this.removeSocket.bind(this, socket)();
        });
        socket.on('close', () => {
            // this.clients.splice(this.clients.indexOf(socket), 1);
            // broadcast(socket.name + " left the chat.\n");
            console.log('close');
            this.removeSocket.bind(this, socket)();
        });

        socket.on('readable', function() {
            console.log('readable');
            // console.log(this.socket.read());
        });

        socket.on('error', function(err) {
            // console.log('error', err);
            console.log('error');
        });
    }

    broadcast(message: string) {
        for (const client of this.clients) {
            client.write(encodeFrame(message, false));
        }
    }

    removeSocket(socket: Socket) {
        console.log('removing socket');
        this.clients.splice(this.clients.indexOf(socket), 1);
        console.log('liczba socketow', this.clients.length);
    }

    // Copyright (c) 2014 Guilherme Souza
    decodeFrame() {
        let fin, opcode, B, HB, mask, len, payload, start, i, hasMask;

        if (this.buffer.length < 2) {
            return;
        }

        // Is this the last frame in a sequence?
        B = this.buffer[0];
        HB = B >> 4;
        if (HB % 8) {
            // RSV1, RSV2 and RSV3 must be clear
            return false;
        }
        fin = HB === 8;
        opcode = B % 16;

        if (opcode !== 0 && opcode !== 1 && opcode !== 2 && opcode !== 8 && opcode !== 9 && opcode !== 10) {
            // Invalid opcode
            return false;
        }
        if (opcode >= 8 && !fin) {
            // Control frames must not be fragmented
            return false;
        }

        B = this.buffer[1];
        hasMask = B >> 7;
        // if ((this.server && !hasMask) || (!this.server && hasMask)) {
        //     // Frames sent by clients must be masked
        //     return false;
        // }
        len = B % 128;
        start = hasMask ? 6 : 2;

        if (this.buffer.length < start + len) {
            // Not enough data in the this.buffer
            return;
        }

        // Get the actual payload length
        if (len === 126) {
            len = this.buffer.readUInt16BE(2);
            start += 2;
        } else if (len === 127) {
            // Warning: JS can only store up to 2^53 in its number format
            len = this.buffer.readUInt32BE(2) * Math.pow(2, 32) + this.buffer.readUInt32BE(6);
            start += 8;
        }
        if (this.buffer.length < start + len) {
            return;
        }

        // Extract the payload
        payload = this.buffer.slice(start, start + len);
        if (hasMask) {
            // Decode with the given mask
            mask = this.buffer.slice(start - 4, start);
            for (i = 0; i < payload.length; i++) {
                payload[i] ^= mask[i % 4];
            }
        }
        this.buffer = this.buffer.slice(start + len);

        // Proceeds to frame processing
        // console.log(fin, opcode, payload, payload.toString());
        // console.log(payload, payload.toString());
        return payload.toString();
    }
}

// Copyright (c) 2014 Guilherme Souza
function encodeFrame(data, masked) {
    var payload, meta;

    payload = Buffer.from(data);
    meta = generateMetaData(true, 1, masked === undefined ? false : masked, payload);

    return Buffer.concat([meta, payload], meta.length + payload.length);
}

// Copyright (c) 2014 Guilherme Souza
function generateMetaData(fin, opcode, masked, payload) {
    var len, meta, start, mask, i;

    len = payload.length;

    // Creates the buffer for meta-data
    meta = Buffer.alloc(2 + (len < 126 ? 0 : len < 65536 ? 2 : 8) + (masked ? 4 : 0));

    // Sets fin and opcode
    meta[0] = (fin ? 128 : 0) + opcode;

    // Sets the mask and length
    meta[1] = masked ? 128 : 0;
    start = 2;
    if (len < 126) {
        meta[1] += len;
    } else if (len < 65536) {
        meta[1] += 126;
        meta.writeUInt16BE(len, 2);
        start += 2;
    } else {
        // Warning: JS doesn't support integers greater than 2^53
        meta[1] += 127;
        meta.writeUInt32BE(Math.floor(len / Math.pow(2, 32)), 2);
        meta.writeUInt32BE(len % Math.pow(2, 32), 6);
        start += 8;
    }

    // Set the mask-key
    if (masked) {
        mask = Buffer.alloc(4);
        for (i = 0; i < 4; i++) {
            meta[start + i] = mask[i] = Math.floor(Math.random() * 256);
        }
        for (i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
        }
        start += 4;
    }

    return meta;
}
