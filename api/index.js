const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

async function requestPairingCode(number) {
    const sessionId = `session_${number}_${Date.now()}`;
    const sessionPath = path.join('/tmp', sessionId);

    try {
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Windows', 'Chrome', '120.0.0'],
            markOnlineOnConnect: false,
            connectTimeoutMs: 30000,
            defaultQueryTimeoutMs: 15000,
            keepAliveIntervalMs: 5000,
        });

        sock.ev.on('creds.update', saveCreds);

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000);
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'open') {
                    clearTimeout(timeout);
                    resolve(true);
                }
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode && statusCode !== DisconnectReason.loggedOut) {
                        clearTimeout(timeout);
                        reject(new Error(`Connection closed: ${statusCode}`));
                    }
                }
            });
        });

        const pairingCode = await sock.requestPairingCode(number);
        console.log(`✅ Pairing code for ${number}: ${pairingCode}`);

        setTimeout(() => sock.end(new Error('Session closed')), 1000);
        return { success: true, code: pairingCode };

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        return { success: false, error: error.message };
    } finally {
        if (fs.existsSync(sessionPath)) {
            setTimeout(() => fs.rmSync(sessionPath, { recursive: true, force: true }), 3000);
        }
    }
}

app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'WA Pairing Spammer API (Vercel)',
        version: '2.0.0',
        endpoints: ['GET / - Info', 'POST /pairing - Send pairing code']
    });
});

app.post('/pairing', async (req, res) => {
    const { number } = req.body;
    if (!number) {
        return res.status(400).json({ success: false, message: 'Nomor target diperlukan' });
    }

    const cleanNumber = number.toString().replace(/\D/g, '');
    if (cleanNumber.length < 10) {
        return res.status(400).json({ success: false, message: 'Nomor tidak valid (min 10 digit)' });
    }

    const result = await requestPairingCode(cleanNumber);

    res.json({
        success: result.success,
        message: result.success ? `Pairing code berhasil dikirim ke ${cleanNumber}` : `Gagal: ${result.error}`,
        pairingCode: result.code || null
    });
});

module.exports = app;
