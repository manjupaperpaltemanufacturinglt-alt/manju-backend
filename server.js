/**
 * Manju Paper Plate MFG — Backend Server v6.1 (Render Production Ready)
 */

// Load environment variables FIRST
require('dotenv').config();

// Force reload environment variables for Render
console.log('\n🔍 [STARTUP] Environment Variable Check:');
console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`  PORT: ${process.env.PORT || 'not set'}`);
console.log(`  CLOUDINARY_CLOUD_NAME: ${process.env.CLOUDINARY_CLOUD_NAME ? '✅ SET' : '❌ MISSING'}`);
console.log(`  CLOUDINARY_API_KEY: ${process.env.CLOUDINARY_API_KEY ? '✅ SET' : '❌ MISSING'}`);
console.log(`  CLOUDINARY_API_SECRET: ${process.env.CLOUDINARY_API_SECRET ? '✅ SET' : '❌ MISSING'}`);

// If variables are missing, try to read from Render's environment
if (!process.env.CLOUDINARY_CLOUD_NAME) {
  console.error('❌ CRITICAL: Cloudinary environment variables are missing!');
  console.error('   Please add them in Render dashboard → Environment tab');
}

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Cloudinary
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

// Configuration
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.SECRET_KEY || 'manju_super_secret_key_2025';

// Get Cloudinary credentials
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

// Configure Cloudinary ONLY if credentials exist
let isCloudinaryConfigured = false;

if (CLOUD_NAME && API_KEY && API_SECRET) {
  try {
    cloudinary.config({
      cloud_name: CLOUD_NAME,
      api_key: API_KEY,
      api_secret: API_SECRET,
      secure: true
    });
    isCloudinaryConfigured = true;
    console.log('\n✅ Cloudinary configured successfully:');
    console.log(`  Cloud Name: ${CLOUD_NAME}`);
    console.log(`  API Key: ${API_KEY.substring(0, 8)}...`);
  } catch (error) {
    console.error('❌ Cloudinary config error:', error.message);
  }
} else {
  console.error('\n❌ Cloudinary configuration FAILED!');
  console.error('  Missing required environment variables:');
  if (!CLOUD_NAME) console.error('  - CLOUDINARY_CLOUD_NAME');
  if (!API_KEY) console.error('  - CLOUDINARY_API_KEY');
  if (!API_SECRET) console.error('  - CLOUDINARY_API_SECRET');
}

// CORS
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGIN || '';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  ? ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()).filter(Boolean)
  : null;

console.log(`\n🌍 Server Configuration:`);
console.log(`  PORT: ${PORT}`);
console.log(`  BASE_URL: ${BASE_URL}`);
console.log(`  Cloudinary: ${isCloudinaryConfigured ? '✅ READY' : '❌ NOT READY'}`);

// File system setup
const UPLOAD_DIR = path.join(__dirname, 'upload');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Data persistence
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return {
        users: data.users || [],
        products: data.products || [],
        relevantProducts: data.relevantProducts || [],
        orders: data.orders || [],
        nextProductId: data.nextProductId || 1,
        nextRelId: data.nextRelId || 1,
        nextOrderId: data.nextOrderId || 1
      };
    } catch (e) {
      console.error('⚠️  data.json corrupt — starting fresh');
    }
  }
  return {
    users: [], products: [], relevantProducts: [], orders: [],
    nextProductId: 1, nextRelId: 1, nextOrderId: 1
  };
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

let db = loadData();

// Middleware
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (!ALLOWED_ORIGINS) return callback(null, true);
    const devPatterns = [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
    if (devPatterns.some(re => re.test(origin))) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/upload', express.static(UPLOAD_DIR));
app.use(express.static(__dirname));

// HTML routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/productpage', (req, res) => {
  res.sendFile(path.join(__dirname, 'productpage.html'));
});

// Multer setup
function cloudinaryUrl(file) {
  return file.path || file.secure_url || file.url || null;
}

let upload;
let uploadRelevant;

if (isCloudinaryConfigured) {
  console.log('\n📸 Initializing Cloudinary storage...');
  
  const cloudinaryStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'manju-products',
      format: async (req, file) => {
        const ext = path.extname(file.originalname).toLowerCase();
        return ext.substring(1);
      },
      public_id: (req, file) => {
        const timestamp = Date.now();
        const random = Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname).toLowerCase();
        const baseName = path.basename(file.originalname, ext);
        const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '_');
        return `prod-${timestamp}-${random}-${sanitized}`;
      },
      transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }]
    }
  });

  const cloudinaryStorageRelevant = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'manju-relevant',
      format: async (req, file) => {
        const ext = path.extname(file.originalname).toLowerCase();
        return ext.substring(1);
      },
      public_id: (req, file) => {
        const timestamp = Date.now();
        const random = Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname).toLowerCase();
        const baseName = path.basename(file.originalname, ext);
        const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '_');
        return `rel-${timestamp}-${random}-${sanitized}`;
      },
      transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }]
    }
  });

  const fileFilter = (req, file, cb) => {
    if (/\.(jpe?g|png|gif|webp)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, GIF, WEBP) are allowed'));
    }
  };

  upload = multer({
    storage: cloudinaryStorage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter
  });

  uploadRelevant = multer({
    storage: cloudinaryStorageRelevant,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter
  });
  
  console.log('✅ Cloudinary multer storage ready');
} else {
  console.log('\n⚠️  Using local disk storage fallback');
  
  const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, 'local-' + uniqueSuffix + path.extname(file.originalname));
    }
  });
  
  upload = multer({ storage: diskStorage, limits: { fileSize: 15 * 1024 * 1024 } });
  uploadRelevant = multer({ storage: diskStorage, limits: { fileSize: 15 * 1024 * 1024 } });
}

// Auth middleware
function checkToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), SECRET_KEY);
  } catch (err) {
    return null;
  }
}

function verifyToken(req, res, next) {
  if (!checkToken(req)) {
    return res.json({ success: false, message: 'Unauthorized — please login' });
  }
  next();
}

function multerThenAuth(fieldName, maxCount, isRelevant = false) {
  return (req, res, next) => {
    const uploader = isRelevant ? uploadRelevant : upload;
    if (!uploader) {
      return res.json({ success: false, message: 'Upload system not properly configured' });
    }
    uploader.array(fieldName, maxCount)(req, res, (err) => {
      if (err) {
        return res.json({ success: false, message: 'File error: ' + err.message });
      }
      if (!checkToken(req)) {
        return res.json({ success: false, message: 'Unauthorized' });
      }
      next();
    });
  };
}

// [YOUR EXISTING ROUTES GO HERE - they remain unchanged]
// (Keep all your route handlers from previous version)

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    environment: process.env.NODE_ENV || 'development',
    baseUrl: BASE_URL,
    port: PORT,
    stats: {
      products: db.products.length,
      orders: db.orders.length,
      users: db.users.length
    },
    cloudinary: {
      configured: isCloudinaryConfigured,
      cloudName: CLOUD_NAME || 'MISSING',
      hasApiKey: !!API_KEY,
      hasApiSecret: !!API_SECRET
    },
    timestamp: new Date().toISOString()
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Manju Paper Plate MFG — Backend Server v6.1              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📡 Server running on: ${BASE_URL}`);
  console.log(`🔍 Health check: ${BASE_URL}/api/health`);
  console.log(`\n☁️  Cloudinary Status: ${isCloudinaryConfigured ? '✅ CONNECTED' : '❌ NOT CONFIGURED'}`);
  
  if (!isCloudinaryConfigured) {
    console.log(`\n⚠️  ACTION REQUIRED:`);
    console.log(`   1. Go to Render dashboard → manju-backend-14`);
    console.log(`   2. Click "Environment" tab`);
    console.log(`   3. Add these environment variables:`);
    console.log(`      - CLOUDINARY_CLOUD_NAME = dqdxfmswm`);
    console.log(`      - CLOUDINARY_API_KEY = 736642871578954`);
    console.log(`      - CLOUDINARY_API_SECRET = Zu8JtdT4RGNQaghKyZhH8cfcrew`);
    console.log(`   4. Click "Save Changes"`);
    console.log(`   5. Click "Manual Deploy" → "Deploy latest commit"`);
  }
});

module.exports = app;
