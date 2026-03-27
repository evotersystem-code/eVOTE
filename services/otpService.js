const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const nodemailer = require('nodemailer');
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

// Nodemailer setup
console.log("Initializing Nodemailer with user:", process.env.EMAIL_USER ? process.env.EMAIL_USER : "NOT FOUND");

const dns = require('node:dns');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Use STARTTLS (port 587)
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    lookup: (hostname, options, callback) => {
        // Force DNS resolution to IPv4
        dns.lookup(hostname, { family: 4 }, callback);
    },
    family: 4, // Explicitly force IPv4
    connectionTimeout: 15000, // 15 seconds
    greetingTimeout: 15000,
    socketTimeout: 30000,
    debug: true, // Enable debug logging
    logger: true // Use built-in logger to stdout
});

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
    try {
        const code = generateOTP();

        // Save to DB
        await OTP.create({ identifier: email, code });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'eVoter Verification Code',
            text: `Your verification code is: ${code}. Valid for 10 minutes.`
        };

        console.log(`[SMTP] Attempting to send OTP email to: ${email}...`);
        const info = await transporter.sendMail(mailOptions);
        console.log(`[SMTP] SUCCESS: Email OTP sent to ${email}: ${info.response}`);
        return code;
    } catch (err) {
        console.error("Email Send Error:", err.message);
        throw err;
    }
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

async function sendEmail(to, subject, text) {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to,
            subject,
            text
        };
        console.log(`[SMTP] Attempting to send general email to: ${to}...`);
        const info = await transporter.sendMail(mailOptions);
        console.log(`[SMTP] SUCCESS: General email sent to ${to}: ${info.response}`);
        return info;
    } catch (err) {
        console.error("Email Send Error:", err.message);
        throw err;
    }
}

module.exports = {
    sendWhatsAppOTP,
    sendEmailOTP,
    verifyOTP,
    sendEmail,
    client
};
