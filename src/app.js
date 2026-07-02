const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');
const logger = require('./config/logger');

const app = express();

// Trust Railway/reverse-proxy headers so rate limiting and IP detection work correctly
app.set('trust proxy', 1);

// ─── Security ────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Rate Limiting ───────────────────────────────────────
// General limit is generous: a student in a live class sends a heartbeat
// every 10s (~90 requests per 15-min window) on top of normal app usage.
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests, try again later' } },
});

// Tighter limit on auth endpoints to slow credential stuffing / OTP abuse
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many attempts, please wait a few minutes' } },
});

app.use('/api/auth', authLimiter);
app.use('/api', limiter);

// ─── Parsing & Logging ──────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ─── Routes ─────────────────────────────────────────────
app.use('/api', routes);

// Root redirect
app.get('/', (req, res) => {
  res.json({
    name: 'EdTain API',
    version: '1.0.0',
    docs: '/api/health',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { message: `Route ${req.method} ${req.path} not found` },
  });
});

// ─── Global Error Handler ────────────────────────────────
app.use(errorHandler);

module.exports = app;
