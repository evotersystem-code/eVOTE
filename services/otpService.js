const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const OTP = require('../models/OTP');
const fs = require('fs');
const path = require('path');

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ],
    }
});

client.on('qr', async (qr) => {
    qrcodeTerminal.generate(qr, { small: true });

    // Also save as image for easier scanning
    try {
        const qrPath = path.join(__dirname, '../qr.png');
        await qrcodeImage.toFile(qrPath, qr);
        console.log("------------------------------------------");
        console.log("CAN'T SCAN TERMINAL? Open qr.png in this folder! ✅");
        console.log("------------------------------------------");
    } catch (err) {
        console.error("Failed to save QR image:", err);
    }

    console.log("Scan the QR code with WhatsApp");
});

client.on('ready', () => {
    console.log('WhatsApp Client Ready');
});

// Initialize WhatsApp with error handling to prevent app crash
try {
    console.log("Initializing WhatsApp Client...");
    client.initialize().catch(err => {
        console.error("WhatsApp Initialization Failed (Async):", err.message);
    });
} catch (err) {
    console.error("WhatsApp Initialization Failed (Sync):", err.message);
}

// --- Email Service Deprecated (Shifted to WhatsApp) ---
async function sendEmail(to, subject, text) {
    console.warn(`[DEPRECATED] sendEmail called for ${to}. Redirecting to logs only.`);
    console.log(`[DEPRECATED EMAIL] Subject: ${subject}\nText: ${text}`);
    return true; 
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendWhatsAppOTP(identifier, phone) {
    try {
        const code = generateOTP();

        // Format number: remove all non-digits
        let cleanNumber = phone.replace(/\D/g, '');

        // If it starts with 0 and followed by 10 digits, remove 0
        if (cleanNumber.length === 11 && cleanNumber.startsWith('0')) {
            cleanNumber = cleanNumber.substring(1);
        }

        // If it is 10 digits, add 91 (India)
        if (cleanNumber.length === 10) {
            cleanNumber = '91' + cleanNumber;
        }

        const formattedNumber = `${cleanNumber}@c.us`;
        console.log(`[WhatsApp] Original: ${phone}, Cleaned: ${cleanNumber}, Formatted: ${formattedNumber}`);

        // Save to DB (using the email/identifier, not the phone)
        await OTP.create({ identifier: identifier, code });

    const state = await client.getState().catch(() => 'DISCONNECTED');
    console.log(`[WhatsApp] Status Check: ${state}, Info: ${client.info ? 'Available' : 'Missing'}`);

    if (state !== 'CONNECTED') {
      console.error(`[WhatsApp] Client not connected. Current state: ${state}`);
      if (!client.info || !client.info.wid) {
        throw new Error(`WhatsApp Service is currently unavailable (Status: ${state}). Please contact admin.`);
      }
    }

    console.log(`[WhatsApp] Attempting to send OTP to: ${formattedNumber}`);
    await client.sendMessage(formattedNumber, `Your eVoter verification code is: ${code}. Valid for 10 minutes.`);
    console.log(`[WhatsApp] OTP sent successfully to ${phone}`);
    return code;
  } catch (err) {
    console.error("WhatsApp Send Error:", err.message);
    // Provide a more user-friendly error message if it's a known connection issue
    if (err.message.includes('wid')) {
      throw new Error("WhatsApp Service is not authenticated. Please scan the QR code.");
    }
    throw err;
  }
}

async function sendEmailOTP(email) {
    console.error(`[DEPRECATED] sendEmailOTP called for ${email}. Email OTP is removed.`);
    throw new Error("Email OTP is no longer supported. Please use WhatsApp.");
}

async function verifyOTP(identifier, code) {
    const otpRecord = await OTP.findOne({ identifier, code }).sort({ createdAt: -1 });
    if (!otpRecord) return false;

    // Check if expired (though TTL index handles this, we be safe)
    const now = new Date();
    const expiry = new Date(otpRecord.createdAt.getTime() + 10 * 60000);
    if (now > expiry) return false;

    // Delete after use
    await OTP.deleteOne({ _id: otpRecord._id });
    return true;
}

async function sendWhatsAppMessage(phone, message) {
    try {
        let cleanNumber = phone.replace(/\D/g, '');
        if (cleanNumber.length === 11 && cleanNumber.startsWith('0')) cleanNumber = cleanNumber.substring(1);
        if (cleanNumber.length === 10) cleanNumber = '91' + cleanNumber;
        const formattedNumber = `${cleanNumber}@c.us`;

        console.log(`[WhatsApp] Attempting to send message to: ${formattedNumber}`);
        await client.sendMessage(formattedNumber, message);
        console.log(`[WhatsApp] Message sent successfully to ${phone}`);
        return true;
    } catch (err) {
        console.error("WhatsApp Message Error:", err.message);
        return false;
    }
}

// Export is already handled below

module.exports = {
    sendWhatsAppOTP,
    sendEmailOTP,
    verifyOTP,
    sendEmail,
    sendWhatsAppMessage,
    client
};
