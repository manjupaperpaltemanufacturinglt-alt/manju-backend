/**
 * Manju Paper Plate MFG — Backend Server v6.0 (Render Production Ready)
 * 
 * FIXED: Cloudinary "Must supply api_key" error for Render deployment
 * FIXED: Environment variable loading order
 */

// ========== CRITICAL: Load environment variables IMMEDIATELY ==========
// This must be the VERY FIRST thing that runs
require('dotenv').config();

// Debug: Check if env vars are loaded (will appear in Render logs)
console.log('\n🔍 [STARTUP] Environment Variable Check:');
console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`  PORT: ${process.env.PORT || 'not set'}`);
console.log(`  CLOUDINARY_CLOUD_NAME: ${process.env.CLOUDINARY_CLOUD_NAME ? '✅ SET' : '❌ MISSING'}`);
console.log(`  CLOUDINARY_API_KEY: ${process.env.CLOUDINARY_API_KEY ? '✅ SET' : '❌ MISSING'}`);
console.log(`  CLOUDINARY_API_SECRET: ${process.env.CLOUDINARY_API_SECRET ? '✅ SET' : '❌ MISSING'}`);

// Import dependencies
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Cloudinary imports
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Initialize express
const app = express();

/* ══════════════════════════════════════════════════════════════
   ⚙️  CONFIGURATION
══════════════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.SECRET_KEY || 'manju_super_secret_key_2025';

// ========== CLOUDINARY SETUP WITH VALIDATION ==========
// Store credentials from environment
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

// Validate credentials
const hasCloudinaryCreds = CLOUD_NAME && API_KEY && API_SECRET;

if (hasCloudinaryCreds) {
  // Configure Cloudinary
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
    secure: true
  });
  
  console.log('\n✅ Cloudinary configured successfully:');
  console.log(`  Cloud Name: ${CLOUD_NAME}`);
  console.log(`  API Key: ${API_KEY.substring(0, 8)}...`);
  console.log(`  Secure: true`);
} else {
  console.error('\n❌ CLOUDINARY CONFIGURATION FAILED!');
  console.error('  Missing required environment variables:');
  if (!CLOUD_NAME) console.error('  - CLOUDINARY_CLOUD_NAME');
  if (!API_KEY) console.error('  - CLOUDINARY_API_KEY');
  if (!API_SECRET) console.error('  - CLOUDINARY_API_SECRET');
  console.error('\n  ⚠️  File uploads will NOT work until these are set in Render dashboard');
}

// CORS configuration
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGIN || '';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  ? ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()).filter(Boolean)
  : null;

console.log(`\n🌍 Server Configuration:`);
console.log(`  PORT: ${PORT}`);
console.log(`  BASE_URL: ${BASE_URL}`);
console.log(`  CORS: ${ALLOWED_ORIGINS ? ALLOWED_ORIGINS.join(', ') : 'all origins allowed'}`);

/* ─── File system setup ─── */
const UPLOAD_DIR = path.join(__dirname, 'upload');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ─── Data persistence ─── */
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

/* ─── Middleware ─── */
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

/* ─── HTML routes ─── */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/productpage', (req, res) => {
  res.sendFile(path.join(__dirname, 'productpage.html'));
});

/* ══════════════════════════════════════════════════════════════
   📸  MULTER STORAGE CONFIGURATION
══════════════════════════════════════════════════════════════ */

// Helper: extract URL from multer-cloudinary file object
function cloudinaryUrl(file) {
  return file.path || file.secure_url || file.url || null;
}

// Initialize multer storage (with fallback)
let upload;
let uploadRelevant;

if (hasCloudinaryCreds && cloudinary.config().api_key) {
  console.log('\n📸 Initializing Cloudinary storage...');
  
  // Main products storage
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

  // Relevant products storage
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
  console.log('\n⚠️  Using local disk storage fallback (Cloudinary not configured)');
  
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

/* ─── Auth middleware ─── */
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

/* ══════════════════════════════════════════════════════════════
   🔐  AUTHENTICATION ROUTES
══════════════════════════════════════════════════════════════ */

app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.json({ success: false, message: 'All fields required' });
  }
  if (db.users.find(u => u.email === email)) {
    return res.json({ success: false, message: 'Email already exists' });
  }
  try {
    db.users.push({
      id: Date.now(),
      name,
      email,
      password: await bcrypt.hash(password, 10),
      createdAt: new Date().toISOString()
    });
    saveData();
    res.json({ success: true, message: 'Account created successfully' });
  } catch (error) {
    console.error('Signup error:', error);
    res.json({ success: false, message: 'Server error' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ success: false, message: 'Email and password required' });
  }
  const user = db.users.find(u => u.email === email);
  if (!user) {
    return res.json({ success: false, message: 'User not found' });
  }
  try {
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.json({ success: false, message: 'Invalid password' });
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.name },
      SECRET_KEY,
      { expiresIn: '7d' }
    );
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, message: 'Server error' });
  }
});

app.post('/forgot-password', async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.json({ success: false, message: 'Email and new password required' });
  }
  const user = db.users.find(u => u.email === email);
  if (!user) {
    return res.json({ success: false, message: 'User not found' });
  }
  try {
    user.password = await bcrypt.hash(newPassword, 10);
    saveData();
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.json({ success: false, message: 'Server error' });
  }
});

/* ══════════════════════════════════════════════════════════════
   📦  PRODUCT ROUTES
══════════════════════════════════════════════════════════════ */

app.get('/products', (req, res) => {
  res.json({ success: true, count: db.products.length, products: db.products });
});

app.post('/upload-product', multerThenAuth('images', 5, false), (req, res) => {
  try {
    const { productName, offerPrice, originalPrice, category, size, description, badge, stock } = req.body;
    
    if (!productName?.trim()) {
      return res.json({ success: false, message: 'Product name required' });
    }
    if (!offerPrice || isNaN(+offerPrice) || +offerPrice <= 0) {
      return res.json({ success: false, message: 'Valid offer price required' });
    }
    if (!category) {
      return res.json({ success: false, message: 'Category required' });
    }
    if (!req.files || req.files.length === 0) {
      return res.json({ success: false, message: 'At least one image required' });
    }

    const imageUrls = req.files.map(f => cloudinaryUrl(f)).filter(Boolean);
    if (imageUrls.length === 0) {
      return res.json({ success: false, message: 'Image upload failed — no URL returned' });
    }

    const stockQty = parseInt(stock) || 0;
    const product = {
      id: db.nextProductId++,
      name: productName.trim(),
      originalPrice: originalPrice?.trim() ? +originalPrice : null,
      offerPrice: +offerPrice,
      size: size?.trim() || category,
      category,
      badge: badge || '',
      description: description?.trim() || '',
      images: imageUrls,
      image: imageUrls[0],
      stock: stockQty,
      sold: 0,
      available: stockQty,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.products.unshift(product);
    saveData();
    console.log(`✅ Product added: ${product.name} (ID: ${product.id})`);
    res.json({ success: true, product });
  } catch (error) {
    console.error('Product upload error:', error);
    res.json({ success: false, message: error.message });
  }
});

app.delete('/products/:id', verifyToken, (req, res) => {
  const id = parseInt(req.params.id);
  const index = db.products.findIndex(p => p.id === id);
  if (index === -1) {
    return res.json({ success: false, message: 'Product not found' });
  }

  const product = db.products[index];
  const imageUrls = product.images || [];

  // Try to delete from Cloudinary if configured
  if (hasCloudinaryCreds) {
    for (const url of imageUrls) {
      try {
        const urlParts = url.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        if (uploadIndex !== -1 && uploadIndex + 1 < urlParts.length) {
          let startIdx = uploadIndex + 1;
          if (urlParts[startIdx]?.startsWith('v')) startIdx++;
          const publicIdWithExt = urlParts.slice(startIdx).join('/');
          const publicId = publicIdWithExt.substring(0, publicIdWithExt.lastIndexOf('.'));
          if (publicId) {
            cloudinary.uploader.destroy(publicId).catch(err =>
              console.warn(`Could not delete Cloudinary image: ${publicId}`, err.message)
            );
          }
        }
      } catch (err) {
        console.warn(`Error deleting Cloudinary image:`, err.message);
      }
    }
  }

  db.products.splice(index, 1);
  saveData();
  console.log(`🗑️  Deleted product ${id}`);
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   ⭐  RELEVANT PRODUCTS ROUTES
══════════════════════════════════════════════════════════════ */

app.get('/relevant', (req, res) => {
  res.json({ success: true, products: db.relevantProducts });
});

app.get('/relevant-products', (req, res) => {
  res.json({ success: true, products: db.relevantProducts });
});

app.post('/upload-relevant', multerThenAuth('images', 5, true), (req, res) => {
  try {
    const { productName, offerPrice, originalPrice, category, badge } = req.body;
    
    if (!productName?.trim()) {
      return res.json({ success: false, message: 'Product name required' });
    }
    if (!offerPrice || isNaN(+offerPrice) || +offerPrice <= 0) {
      return res.json({ success: false, message: 'Valid offer price required' });
    }
    if (!req.files || req.files.length === 0) {
      return res.json({ success: false, message: 'At least one image required' });
    }

    const imageUrls = req.files.map(f => cloudinaryUrl(f)).filter(Boolean);
    if (imageUrls.length === 0) {
      return res.json({ success: false, message: 'Image upload failed — no URL returned' });
    }

    const product = {
      id: db.nextRelId++,
      name: productName.trim(),
      offerPrice: +offerPrice,
      originalPrice: originalPrice?.trim() ? +originalPrice : null,
      category: category || '',
      badge: badge || '',
      images: imageUrls,
      image: imageUrls[0],
      isRelevant: true,
      createdAt: new Date().toISOString()
    };

    db.relevantProducts.unshift(product);
    saveData();
    console.log(`⭐ Relevant product added: ${product.name}`);
    res.json({ success: true, product });
  } catch (error) {
    console.error('Relevant product upload error:', error);
    res.json({ success: false, message: error.message });
  }
});

app.delete('/relevant/:id', verifyToken, (req, res) => {
  const id = parseInt(req.params.id);
  const index = db.relevantProducts.findIndex(p => p.id === id);
  if (index === -1) {
    return res.json({ success: false, message: 'Product not found' });
  }

  const product = db.relevantProducts[index];
  const imageUrls = product.images || [];

  if (hasCloudinaryCreds) {
    for (const url of imageUrls) {
      try {
        const urlParts = url.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        if (uploadIndex !== -1 && uploadIndex + 1 < urlParts.length) {
          let startIdx = uploadIndex + 1;
          if (urlParts[startIdx]?.startsWith('v')) startIdx++;
          const publicIdWithExt = urlParts.slice(startIdx).join('/');
          const publicId = publicIdWithExt.substring(0, publicIdWithExt.lastIndexOf('.'));
          if (publicId) {
            cloudinary.uploader.destroy(publicId).catch(err =>
              console.warn(`Could not delete Cloudinary image: ${publicId}`, err.message)
            );
          }
        }
      } catch (err) {
        console.warn(`Error deleting Cloudinary image:`, err.message);
      }
    }
  }

  db.relevantProducts.splice(index, 1);
  saveData();
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   🔍  RECOMMENDATIONS
══════════════════════════════════════════════════════════════ */

app.get('/recommendations/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const source = db.products.find(p => p.id === id) || db.relevantProducts.find(p => p.id === id);
  const sameCategory = source
    ? db.products.filter(p => p.id !== id && p.category === source.category).slice(0, 4)
    : db.products.slice(0, 4);
  const relevantRecs = db.relevantProducts.filter(p => p.id !== id).map(p => ({ ...p, isRelevant: true }));
  const seen = new Set();
  const recommendations = [...sameCategory, ...relevantRecs].filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  }).slice(0, 8);
  res.json({ success: true, recommendations });
});

/* ══════════════════════════════════════════════════════════════
   📊  INVENTORY
══════════════════════════════════════════════════════════════ */

app.get('/inventory', (req, res) => {
  const inventory = db.products.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    image: (p.images || [])[0] || '',
    stock: p.stock || 0,
    sold: p.sold || 0,
    available: (p.stock || 0) - (p.sold || 0),
    updatedAt: p.updatedAt
  }));
  const lowCount = inventory.filter(i => i.available < 10).length;
  res.json({ success: true, inventory, lowCount });
});

app.put('/inventory/:id', verifyToken, (req, res) => {
  const id = parseInt(req.params.id);
  const product = db.products.find(p => p.id === id);
  if (!product) {
    return res.json({ success: false, message: 'Product not found' });
  }
  product.stock = parseInt(req.body.stock) || 0;
  product.available = product.stock - (product.sold || 0);
  product.updatedAt = new Date().toISOString();
  saveData();
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   🛒  ORDERS
══════════════════════════════════════════════════════════════ */

app.get('/orders', verifyToken, (req, res) => {
  res.json({ success: true, orders: db.orders });
});

app.post('/orders', verifyToken, (req, res) => {
  const { customerName, customerPhone, products: prods, total, notes } = req.body;
  const order = {
    id: 'ORD-' + Date.now(),
    customerName: customerName || 'Walk-in',
    customerPhone: customerPhone || '',
    products: prods || [],
    total: parseFloat(total) || 0,
    notes: notes || '',
    status: 'Pending',
    createdAt: new Date().toISOString()
  };
  db.orders.unshift(order);
  saveData();
  res.json({ success: true, order });
});

app.post('/order/create', (req, res) => {
  const { customerName, customerPhone, customerAddress, productId, quantity } = req.body;
  const product = db.products.find(p => p.id === parseInt(productId));
  const productName = product ? product.name : `Product #${productId}`;
  const productPrice = product ? (product.offerPrice || 0) : 0;
  const qty = parseInt(quantity) || 1;
  const order = {
    id: 'ORD-' + Date.now(),
    customerName: customerName || 'Online Customer',
    customerPhone: customerPhone || '',
    customerAddress: customerAddress || '',
    products: [{ id: productId, name: productName, price: productPrice, qty }],
    total: productPrice * qty,
    notes: customerAddress || '',
    status: 'Pending',
    source: 'productpage',
    createdAt: new Date().toISOString()
  };
  db.orders.unshift(order);
  saveData();
  console.log(`🛒 New order: ${order.id} - ${customerName}`);
  res.json({ success: true, order });
});

app.post('/order/status', verifyToken, (req, res) => {
  const { id, status } = req.body;
  const validStatuses = ['Pending', 'Ready to Move', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return res.json({ success: false, message: 'Invalid status' });
  }
  const order = db.orders.find(o => o.id === id);
  if (!order) {
    return res.json({ success: false, message: 'Order not found' });
  }
  order.status = status;
  order.updatedAt = new Date().toISOString();
  saveData();
  res.json({ success: true, order });
});

app.delete('/orders/:id', verifyToken, (req, res) => {
  const id = req.params.id;
  const index = db.orders.findIndex(o => o.id === id);
  if (index === -1) {
    return res.json({ success: false, message: 'Order not found' });
  }
  db.orders.splice(index, 1);
  saveData();
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   📈  DASHBOARD & HEALTH
══════════════════════════════════════════════════════════════ */

app.get('/analytics/dashboard', verifyToken, (req, res) => {
  const lowStockCount = db.products.filter(p => ((p.stock || 0) - (p.sold || 0)) < 10).length;
  const totalSales = db.orders
    .filter(o => o.status === 'Delivered')
    .reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
  res.json({
    success: true,
    stats: {
      totalProducts: db.products.length,
      totalRelevant: db.relevantProducts.length,
      totalOrders: db.orders.length,
      pendingOrders: db.orders.filter(o => o.status === 'Pending').length,
      deliveredOrders: db.orders.filter(o => o.status === 'Delivered').length,
      totalSales,
      lowStockCount
    }
  });
});

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
      configured: hasCloudinaryCreds,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'MISSING',
      hasApiKey: !!process.env.CLOUDINARY_API_KEY,
      hasApiSecret: !!process.env.CLOUDINARY_API_SECRET
    },
    timestamp: new Date().toISOString()
  });
});

/* ══════════════════════════════════════════════════════════════
   🚀  START SERVER
══════════════════════════════════════════════════════════════ */

const server = app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Manju Paper Plate MFG — Backend Server v6.0              ║');
  console.log('║                    PRODUCTION READY                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📡 Server Information:`);
  console.log(`   • URL: ${BASE_URL}`);
  console.log(`   • Port: ${PORT}`);
  console.log(`   • Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`\n🌐 Endpoints:`);
  console.log(`   • Admin Panel: ${BASE_URL}/admin`);
  console.log(`   • Product Page: ${BASE_URL}/productpage`);
  console.log(`   • Health Check: ${BASE_URL}/api/health`);
  console.log(`\n📊 Database Stats:`);
  console.log(`   • Users: ${db.users.length}`);
  console.log(`   • Products: ${db.products.length}`);
  console.log(`   • Relevant Products: ${db.relevantProducts.length}`);
  console.log(`   • Orders: ${db.orders.length}`);
  console.log(`\n☁️  Cloudinary Status: ${hasCloudinaryCreds ? '✅ CONNECTED' : '❌ NOT CONFIGURED'}`);
  
  if (!hasCloudinaryCreds) {
    console.log(`\n⚠️  WARNING: Cloudinary is not configured!`);
    console.log(`   Please add these environment variables in Render dashboard:`);
    console.log(`   1. CLOUDINARY_CLOUD_NAME`);
    console.log(`   2. CLOUDINARY_API_KEY`);
    console.log(`   3. CLOUDINARY_API_SECRET`);
  }
  console.log('\n✅ Server is ready to accept connections\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;
