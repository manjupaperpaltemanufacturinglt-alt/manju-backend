/**
 * Manju Paper Plate MFG — Backend Server v5.2 (Production / Render)
 * 
 * FIXED: Cloudinary "Must supply api_key" error
 * FIXED: multer-storage-cloudinary v4 compatibility
 */

console.log("=== ENV DEBUG START ===");
console.log("CLOUD NAME:", process.env.CLOUDINARY_CLOUD_NAME);
console.log("API KEY:", process.env.CLOUDINARY_API_KEY);
console.log("API SECRET:", process.env.CLOUDINARY_API_SECRET ? "***HIDDEN***" : "MISSING");
console.log("=== ENV DEBUG END ===");

require('dotenv').config();
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

/* ══════════════════════════════════════════════════════════════
   ⚙️  ENVIRONMENT CONFIG
══════════════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.SECRET_KEY || 'manju_super_secret_key_2025';

// ========== CLOUDINARY SETUP (FIXED FOR v4) ==========
// Configure Cloudinary FIRST
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Debug: Verify configuration
console.log('\n🔍 Cloudinary Config Check:');
console.log('  cloud_name:', cloudinary.config().cloud_name);
console.log('  api_key exists:', !!cloudinary.config().api_key);
console.log('  api_secret exists:', !!cloudinary.config().api_secret);
console.log('  secure:', cloudinary.config().secure);

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('❌ ERROR: Missing Cloudinary environment variables!');
} else {
  console.log('✅ Cloudinary configured successfully\n');
}

const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGIN || '';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  ? ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()).filter(Boolean)
  : null;

console.log(`🌍 BASE_URL      : ${BASE_URL}`);
console.log(`🔐 SECRET_KEY    : ${SECRET_KEY === 'manju_super_secret_key_2025' ? '(default — change in production!)' : '✅ custom'}`);
console.log(`🌐 ALLOWED_ORIGIN: ${ALLOWED_ORIGINS ? ALLOWED_ORIGINS.join(', ') : '* (all)'}`);

/* ─── upload folder (legacy, kept for static serving of old images) ─── */
const UPLOAD_DIR = path.join(__dirname, 'upload');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ─── data file ─────────────────────────────────────────────── */
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

/* ─── CORS ─────────────────────────────────────────────────── */
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

/* ─── body parsers ──────────────────────────────────────────── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ─── static: legacy uploaded images ───────────────────────── */
app.use('/upload', express.static(UPLOAD_DIR));

/* ─── static: serve HTML files from __dirname ────────────────── */
app.use(express.static(__dirname));

/* ─── explicit HTML routes (safety fallback) ────────────────── */
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
   📸  CLOUDINARY MULTER STORAGE (FIXED FOR v4)
══════════════════════════════════════════════════════════════ */

// Helper: extract the usable URL from a multer-cloudinary file object
function cloudinaryUrl(file) {
  return file.path || file.secure_url || file.url || null;
}

// Create storage for main products
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,  // ← CRITICAL: Pass the configured instance
  params: {
    folder: 'manju-products',
    format: async (req, file) => {
      const ext = path.extname(file.originalname).toLowerCase();
      return ext.substring(1); // Remove the dot
    },
    public_id: (req, file) => {
      const ts = Date.now();
      const rand = Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext);
      const sanitized = base.replace(/[^a-zA-Z0-9]/g, '_');
      return `prod-${ts}-${rand}-${sanitized}`;
    },
    transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }]
  }
});

// Create storage for relevant products
const cloudinaryStorageRelevant = new CloudinaryStorage({
  cloudinary: cloudinary,  // ← CRITICAL: Pass the configured instance
  params: {
    folder: 'manju-relevant',
    format: async (req, file) => {
      const ext = path.extname(file.originalname).toLowerCase();
      return ext.substring(1);
    },
    public_id: (req, file) => {
      const ts = Date.now();
      const rand = Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext);
      const sanitized = base.replace(/[^a-zA-Z0-9]/g, '_');
      return `rel-${ts}-${rand}-${sanitized}`;
    },
    transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }]
  }
});

const fileFilter = (_, file, cb) => {
  if (/\.(jpe?g|png|gif|webp)$/i.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('Images only — JPG/PNG/GIF/WEBP accepted'));
  }
};

const upload = multer({
  storage: cloudinaryStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter
});

const uploadRelevant = multer({
  storage: cloudinaryStorageRelevant,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter
});

/* ─── token helpers ─────────────────────────────────────────── */
function checkToken(req) {
  const auth = (req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), SECRET_KEY);
  } catch (_) {
    return null;
  }
}
function verifyToken(req, res, next) {
  if (!checkToken(req))
    return res.json({ success: false, message: 'Unauthorized — please login' });
  next();
}

// Run multer first (parses multipart), then check JWT
function multerThenAuth(fieldName, maxCount, isRelevant = false) {
  return (req, res, next) => {
    const uploader = isRelevant ? uploadRelevant : upload;
    uploader.array(fieldName, maxCount)(req, res, (err) => {
      if (err) return res.json({ success: false, message: 'File error: ' + (err.message || String(err)) });
      if (!checkToken(req))
        return res.json({ success: false, message: 'Unauthorized' });
      next();
    });
  };
}

/* ══════════════════════════════════════════════════════════════
   🔐  AUTH
══════════════════════════════════════════════════════════════ */
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.json({ success: false, message: 'All fields required' });
  if (db.users.find(u => u.email === email))
    return res.json({ success: false, message: 'Email already exists' });
  try {
    db.users.push({
      id: Date.now(),
      name,
      email,
      password: await bcrypt.hash(password, 10),
      createdAt: new Date().toISOString()
    });
    saveData();
    res.json({ success: true, message: 'Account created' });
  } catch (e) {
    res.json({ success: false, message: 'Server error' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.json({ success: false, message: 'Email and password required' });
  const user = db.users.find(u => u.email === email);
  if (!user) return res.json({ success: false, message: 'User not found' });
  try {
    if (!await bcrypt.compare(password, user.password))
      return res.json({ success: false, message: 'Invalid password' });
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
  } catch (e) {
    res.json({ success: false, message: 'Server error' });
  }
});

app.post('/forgot-password', async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword)
    return res.json({ success: false, message: 'Email and new password required' });
  const user = db.users.find(u => u.email === email);
  if (!user) return res.json({ success: false, message: 'User not found' });
  try {
    user.password = await bcrypt.hash(newPassword, 10);
    saveData();
    res.json({ success: true, message: 'Password updated' });
  } catch (e) {
    res.json({ success: false, message: 'Server error' });
  }
});

/* ══════════════════════════════════════════════════════════════
   📦  PRODUCTS
══════════════════════════════════════════════════════════════ */
app.get('/products', (_, res) => {
  res.json({ success: true, count: db.products.length, products: db.products });
});

app.post('/upload-product', multerThenAuth('images', 5, false), (req, res) => {
  try {
    const { productName, offerPrice, originalPrice, category, size, description, badge, stock } = req.body;
    console.log('[upload-product] body:', req.body, '| files:', (req.files || []).length);

    if (!productName?.trim())
      return res.json({ success: false, message: 'Product name required' });
    if (!offerPrice || isNaN(+offerPrice) || +offerPrice <= 0)
      return res.json({ success: false, message: 'Valid offer price required' });
    if (!category)
      return res.json({ success: false, message: 'Category required' });
    if (!(req.files || []).length)
      return res.json({ success: false, message: 'At least one image required' });

    // Get Cloudinary URLs
    const imageUrls = req.files.map(f => cloudinaryUrl(f)).filter(Boolean);

    if (!imageUrls.length)
      return res.json({ success: false, message: 'Image upload to Cloudinary failed — no URL returned' });

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
    console.log(`✅ Product added: ${product.name} (ID:${product.id})`);
    res.json({ success: true, product });
  } catch (e) {
    console.error('[upload-product]', e);
    res.json({ success: false, message: e.message });
  }
});

app.delete('/products/:id', verifyToken, (req, res) => {
  const id = parseInt(req.params.id);
  const idx = db.products.findIndex(p => p.id === id);
  if (idx === -1) return res.json({ success: false, message: 'Not found' });

  const product = db.products[idx];
  const imageUrls = product.images || [];

  // Delete images from Cloudinary
  for (const url of imageUrls) {
    try {
      const urlParts = url.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      if (uploadIndex !== -1 && uploadIndex + 1 < urlParts.length) {
        let startIdx = uploadIndex + 1;
        if (urlParts[startIdx]?.startsWith('v')) startIdx++;
        const publicIdWithExt = urlParts.slice(startIdx).join('/');
        const publicId = publicIdWithExt.substring(0, publicIdWithExt.lastIndexOf('.'));
        if (publicId) cloudinary.uploader.destroy(publicId).catch(err =>
          console.warn(`Could not delete Cloudinary image: ${publicId}`, err.message)
        );
      }
    } catch (err) {
      console.warn(`Error deleting Cloudinary image for product ${id}:`, err.message);
    }
  }

  db.products.splice(idx, 1);
  saveData();
  console.log(`🗑️  Deleted product ${id}`);
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   ⭐  RELEVANT PRODUCTS
══════════════════════════════════════════════════════════════ */
app.get('/relevant', (_, res) => {
  res.json({ success: true, products: db.relevantProducts });
});
app.get('/relevant-products', (_, res) => {
  res.json({ success: true, products: db.relevantProducts });
});

app.post('/upload-relevant', multerThenAuth('images', 5, true), (req, res) => {
  try {
    const { productName, offerPrice, originalPrice, category, badge } = req.body;
    console.log('[upload-relevant] body:', req.body, '| files:', (req.files || []).length);

    if (!productName?.trim())
      return res.json({ success: false, message: 'Product name required' });
    if (!offerPrice || isNaN(+offerPrice) || +offerPrice <= 0)
      return res.json({ success: false, message: 'Valid offer price required' });
    if (!(req.files || []).length)
      return res.json({ success: false, message: 'At least one image required' });

    const imageUrls = req.files.map(f => cloudinaryUrl(f)).filter(Boolean);

    if (!imageUrls.length)
      return res.json({ success: false, message: 'Image upload to Cloudinary failed — no URL returned' });

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
    console.log(`⭐ Relevant added: ${product.name}`);
    res.json({ success: true, product });
  } catch (e) {
    console.error('[upload-relevant]', e);
    res.json({ success: false, message: e.message });
  }
});

app.delete('/relevant/:id', verifyToken, (req, res) => {
  const id = parseInt(req.params.id);
  const idx = db.relevantProducts.findIndex(p => p.id === id);
  if (idx === -1) return res.json({ success: false, message: 'Not found' });

  const product = db.relevantProducts[idx];
  const imageUrls = product.images || [];
  
  for (const url of imageUrls) {
    try {
      const urlParts = url.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      if (uploadIndex !== -1 && uploadIndex + 1 < urlParts.length) {
        let startIdx = uploadIndex + 1;
        if (urlParts[startIdx]?.startsWith('v')) startIdx++;
        const publicIdWithExt = urlParts.slice(startIdx).join('/');
        const publicId = publicIdWithExt.substring(0, publicIdWithExt.lastIndexOf('.'));
        if (publicId) cloudinary.uploader.destroy(publicId).catch(err =>
          console.warn(`Could not delete Cloudinary image: ${publicId}`, err.message)
        );
      }
    } catch (err) {
      console.warn(`Error deleting Cloudinary image for relevant product ${id}:`, err.message);
    }
  }

  db.relevantProducts.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   🔍  RECOMMENDATIONS
══════════════════════════════════════════════════════════════ */
app.get('/recommendations/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const source = db.products.find(p => p.id === id) ||
    db.relevantProducts.find(p => p.id === id);
  const sameCat = source
    ? db.products.filter(p => p.id !== id && p.category === source.category).slice(0, 4)
    : db.products.slice(0, 4);
  const relRecs = db.relevantProducts
    .filter(p => p.id !== id)
    .map(p => ({ ...p, isRelevant: true }));
  const seen = new Set();
  const recommendations = [...sameCat, ...relRecs].filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  }).slice(0, 8);
  res.json({ success: true, recommendations });
});

/* ══════════════════════════════════════════════════════════════
   📊  INVENTORY
══════════════════════════════════════════════════════════════ */
app.get('/inventory', (_, res) => {
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
  const p = db.products.find(x => x.id === id);
  if (!p) return res.json({ success: false, message: 'Product not found' });
  p.stock = parseInt(req.body.stock) || 0;
  p.available = p.stock - (p.sold || 0);
  p.updatedAt = new Date().toISOString();
  saveData();
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   🛒  ORDERS
══════════════════════════════════════════════════════════════ */
app.get('/orders', verifyToken, (_, res) => {
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
  const prod = db.products.find(p => p.id === parseInt(productId));
  const productName = prod ? prod.name : `Product #${productId}`;
  const productPrice = prod ? (prod.offerPrice || 0) : 0;
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
  console.log(`🛒 Online order: ${order.id} — ${customerName} × ${productName}`);
  res.json({ success: true, order });
});

app.post('/order/status', verifyToken, (req, res) => {
  const { id, status } = req.body;
  const validStatuses = ['Pending', 'Ready to Move', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status))
    return res.json({ success: false, message: 'Invalid status' });
  const order = db.orders.find(o => o.id === id);
  if (!order) return res.json({ success: false, message: 'Order not found' });
  order.status = status;
  order.updatedAt = new Date().toISOString();
  saveData();
  res.json({ success: true, order });
});

app.delete('/orders/:id', verifyToken, (req, res) => {
  const id = req.params.id;
  const idx = db.orders.findIndex(o => o.id === id);
  if (idx === -1) return res.json({ success: false, message: 'Order not found' });
  db.orders.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   📈  DASHBOARD
══════════════════════════════════════════════════════════════ */
app.get('/analytics/dashboard', verifyToken, (_, res) => {
  const lowStockCount = db.products.filter(p => ((p.stock || 0) - (p.sold || 0)) < 10).length;
  const totalSales = db.orders
    .filter(o => o.status === 'Delivered')
    .reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
  res.json({
    success: true, stats: {
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

/* ─── health check ──────────────────────────────────────────── */
app.get('/api/health', (_, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'development',
    baseUrl: BASE_URL,
    port: PORT,
    products: db.products.length,
    orders: db.orders.length,
    users: db.users.length,
    cloudinary: {
      configured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY),
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'MISSING'
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   🚀  START
══════════════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   Manju Paper Plate MFG — Server v5.2 (Cloudinary FIXED)  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n  🔧 Admin Panel  →  ${BASE_URL}/`);
  console.log(`  🔧 Admin Panel  →  ${BASE_URL}/admin.html`);
  console.log(`  🌐 Product Page →  ${BASE_URL}/productpage.html`);
  console.log(`  📊 Dashboard    →  ${BASE_URL}/analytics/dashboard`);
  console.log(`  🩺 Health       →  ${BASE_URL}/api/health`);
  console.log(`\n  👥 Users: ${db.users.length}   📦 Products: ${db.products.length}   🛒 Orders: ${db.orders.length}`);
  console.log(`\n  ☁️  Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`\n  Listening on port ${PORT}\n`);
});
