const dns = require('node:dns');

// Force IPv4 for all network requests (essential for Railway/Docker without IPv6 support)
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const cookieParser = require('cookie-parser');

// Security packages
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');

// Load environment variables
dotenv.config();

// CRITICAL SECURITY CHECK: Ensure essential keys are present
const requiredEnv = ['JWT_SECRET', 'MONGO_URI', 'DB_ENCRYPTION_KEY', 'DB_SIGNING_KEY', 'EMAIL_USER', 'EMAIL_PASS'];
const missing = requiredEnv.filter(k => !process.env[k]);
if (missing.length > 0) {
    console.error(`❌ CRITICAL ERROR: Missing required environment variables: ${missing.join(', ')}`);
    console.error("The server cannot start in an insecure state. Please configure your environment in Railway.");
    // In a production environment, we WANT to exit if configuration is missing
    process.exit(1);
} else {
    console.log("✅ All required environment variables are present.");
}

const app = express();

// Trust Railway's proxy for rate limiting to work correctly
app.set('trust proxy', 1);

// --- Performance & security Middleware ---
const compression = require('compression');
app.use(compression());
app.use(cookieParser());
app.disable('x-powered-by');

// 1. Helmet: Adds secure HTTP headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "blob:"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https://justadudewhohacks.github.io", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", "blob:", "data:"],
            frameSrc: ["https://www.youtube.com"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// 2. CORS: Restrict to specific origins in production
const allowedOrigins = [
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'https://evote-production-1902.up.railway.app'
];

app.use(cors({
    origin: function (origin, callback) {
        // In development, allow localhost/127.0.0.1. In production, list your domain.
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        const msg = `The CORS policy for this site does not allow access from ${origin}.`;
        return callback(new Error(msg), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true
}));

// ... (existing CSRF config)
const crypto = require('crypto');
app.use((req, res, next) => {
    if (!req.cookies['XSRF-TOKEN']) {
        const csrfToken = crypto.randomBytes(24).toString('hex');
        res.cookie('XSRF-TOKEN', csrfToken, { 
            sameSite: 'Lax', 
            path: '/',
            secure: process.env.NODE_ENV === 'production'
        }); 
    }

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const tokenInCookie = req.cookies['XSRF-TOKEN'];
        const tokenInHeader = req.headers['x-csrf-token'];
        
        console.log(`[CSRF] Method: ${req.method} | URL: ${req.url}`);
        console.log(`[CSRF] Header: ${tokenInHeader}`);
        console.log(`[CSRF] Cookie: ${tokenInCookie}`);

        if (!tokenInHeader || tokenInHeader !== tokenInCookie) {
            console.warn(`CSRF Mismatch: Header=${tokenInHeader}, Cookie=${tokenInCookie}`);
            return res.status(403).json({ msg: 'CSRF token mismatch or missing' });
        }
    }
    next();
});

// 3. Rate Limiting: Prevent Brute-Force and DDoS attacks
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 1000, 
    standardHeaders: true, 
    legacyHeaders: false,
    skip: (req) => process.env.BYPASS_IP && req.ip === process.env.BYPASS_IP,
    message: { msg: "Too many requests from this IP, please try again after 15 minutes." }
});
app.use('/api', limiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 20, // Allowing 20 attempts for OTP/Login
    skip: (req) => process.env.BYPASS_IP && req.ip === process.env.BYPASS_IP,
    message: { msg: "Too many login/OTP attempts, please try again later." }
});

// Apply authLimiter to sensitive endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/send-otp', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/register-staff', authLimiter);

// Standard Middleware
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 4. Data Sanitization: Prevent NoSQL Injection
// Removes keys containing `$` or `.` from req.body, req.query, or req.params
app.use(mongoSanitize());

// Static File Security: Prevent accidental exposure of sensitive files
const staticOptions = {
    extensions: ['html'],
    maxAge: '7d',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
};

// Serve frontend files but BLOCK sensitive files explicitly
app.use((req, res, next) => {
    // SECURITY: Use a more robust list and check against the file path.
    const forbiddenPatterns = [
        /^\/\.env/i, /^\/package(-lock)?\.json/i, /^\/\.git/i, 
        /^\/config\//i, /^\/utils\//i, /^\/middleware\//i, 
        /^\/models\//i, /^\/routes\//i, /^\/services\//i
    ];
    const isForbidden = forbiddenPatterns.some(pattern => pattern.test(req.path));
    if (isForbidden) {
        console.warn(`[SECURITY] Forbidden access attempt: ${req.path} from ${req.ip}`);
        return res.status(403).send('Forbidden: Access is denied.');
    }
    next();
}, express.static(path.join(__dirname, '/'), staticOptions));

// Database Connection
const connectDB = require('./config/db');
connectDB();

// Routes
const authRoutes = require('./routes/authRoutes');
const voteRoutes = require('./routes/voteRoutes');
const resultRoutes = require('./routes/resultRoutes');
const helpdeskRoutes = require('./routes/helpdeskRoutes');
const candidateRoutes = require('./routes/candidateRoutes');
const electionRoutes = require('./routes/electionRoutes');
const classRoutes = require('./routes/classRoutes');
const alumniCleanup = require('./utils/alumniCleanup');

app.get('/api/ping', (req, res) => res.json({ msg: 'pong' }));
app.use('/api/classes', classRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vote', voteRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/helpdesk', helpdeskRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/elections', electionRoutes);

// Serve Frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'home.html'));
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ msg: 'Resource not found' });
});

// Central Error Handler
app.use((err, req, res, next) => {
    console.error('GLOBAL ERROR CAUGHT:', err.stack);
    const status = err.status || 500;
    res.status(status).json({ 
        success: false, 
        msg: err.message || 'Internal Server Error', 
        error: err.message,
        stack: err.stack 
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is successfully listening on port ${PORT}`);
    console.log(`🔗 Primary Access URL: https://evote-production-1902.up.railway.app`);
    
    // Periodically (Daily) cleanup alumni whose courses have completed
    console.log("⏳ Starting initial alumni cleanup task...");
    alumniCleanup();
    setInterval(alumniCleanup, 24 * 60 * 60 * 1000); 
});