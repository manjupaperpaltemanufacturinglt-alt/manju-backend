/**
 * Manju Paper Plate MFG — Backend Server v4.2 (Production / Render)
 *
 * Changes from v4.1:
 *   • PORT        → process.env.PORT || 5000
 *   • BASE_URL    → process.env.BASE_URL || `http://localhost:${PORT}`
 *   • All image URLs use BASE_URL (never hard-coded localhost)
 *   • CORS allows localhost dev + any Netlify / custom origin via
 *     ALLOWED_ORIGIN env-var (comma-separated list)
 *   • /upload static folder still served correctly in production
 *   • Zero logic removed — all APIs intact
 *   • Added root route "/" serving admin.html
 *   • REPLACED body-parser with Express built-in middleware
 */

const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');

const app = express();

/* ══════════════════════════════════════════════════════════════
   ⚙️  ENVIRONMENT CONFIG
   Set these in Render → Environment tab:
     PORT          (Render sets this automatically)
     BASE_URL      https://your-app-name.onrender.com
     SECRET_KEY    any long random string
     ALLOWED_ORIGIN  https://your-site.netlify.app
                     (comma-separated for multiple origins)
══════════════════════════════════════════════════════════════ */
const PORT       = process.env.PORT       || 5000;
const BASE_URL   = process.env.BASE_URL   || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.SECRET_KEY || 'manju_super_secret_key_2025';

// Build the allowed-origins list from env (fallback: allow everything)
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGIN || '';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  ? ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()).filter(Boolean)
  : null;   // null → allow all

console.log(`🌍 BASE_URL      : ${BASE_URL}`);
console.log(`🔐 SECRET_KEY    : ${SECRET_KEY === 'manju_super_secret_key_2025' ? '(default — change in production!)' : '✅ custom'}`);
console.log(`🌐 ALLOWED_ORIGIN: ${ALLOWED_ORIGINS ? ALLOWED_ORIGINS.join(', ') : '* (all)'}`);

/* ─── upload folder ────────────────────────────────────────── */
const UPLOAD_DIR = path.join(__dirname, 'upload');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ─── data file ─────────────────────────────────────────────── */
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return {
        users:            data.users            || [],
        products:         data.products         || [],
        relevantProducts: data.relevantProducts || [],
        orders:           data.orders           || [],
        nextProductId:    data.nextProductId    || 1,
        nextRelId:        data.nextRelId        || 1,
        nextOrderId:      data.nextOrderId      || 1
      };
    } catch (e) {
      console.error('⚠️  data.json corrupt — starting fresh');
    }
  }
  return { users:[], products:[], relevantProducts:[], orders:[],
           nextProductId:1, nextRelId:1, nextOrderId:1 };
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

let db = loadData();

/* ─── CORS ─────────────────────────────────────────────────── */
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    // If no restriction list → allow everything
    if (!ALLOWED_ORIGINS) return callback(null, true);
    // Always allow localhost dev variants
    const devPatterns = [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
    if (devPatterns.some(re => re.test(origin))) return callback(null, true);
    // Check explicit allow-list
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));   // handle preflight for every route

/* ─── body parsers ──────────────────────────────────────────── */
// REPLACED body-parser with Express built-in middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ─── static: uploaded images ──────────────────────────────── */
// e.g. GET /upload/prod-1234-5678.jpg
app.use('/upload', express.static(UPLOAD_DIR));

/* ─── static: frontend HTML files ──────────────────────────── */
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  console.log(`✅ Serving frontend from: ${FRONTEND_DIR}`);
} else {
  app.use(express.static(__dirname));
}
app.use(express.static(__dirname));   // always serve from __dirname as final fallback

/* ─── root route: serve admin panel ──────────────────────────── */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

/* ─── multer ────────────────────────────────────────────────── */
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename:    (_, file, cb) => {
    const uid = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'prod-' + uid + path.extname(file.originalname).toLowerCase());
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    /\.(jpe?g|png|gif|webp)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(new Error('Images only — JPG/PNG/GIF/WEBP accepted'))
});

/* ─── image URL helper ──────────────────────────────────────── */
// Always use BASE_URL so images work in both local dev and production
function imgUrl(filename) {
  return `${BASE_URL}/upload/${filename}`;
}

/* ─── token helpers ─────────────────────────────────────────── */
function checkToken(req) {
  const auth = (req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  try { return jwt.verify(auth.slice(7), SECRET_KEY); }
  catch (_) { return null; }
}

function verifyToken(req, res, next) {
  if (!checkToken(req))
    return res.json({ success: false, message: 'Unauthorized — please login' });
  next();
}

// For multipart routes: run multer first (so it can parse the body/headers),
// then verify the JWT from the Authorization header.
function multerThenAuth(fieldName, maxCount) {
  return (req, res, next) => {
    upload.array(fieldName, maxCount)(req, res, (err) => {
      if (err) return res.json({ success: false, message: 'File error: ' + err.message });
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
      id: Date.now(), name, email,
      password: await bcrypt.hash(password, 10),
      createdAt: new Date().toISOString()
    });
    saveData();
    console.log(`✅ Registered: ${email}`);
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
      SECRET_KEY, { expiresIn: '7d' }
    );
    console.log(`🔐 Login: ${email}`);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
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

app.post('/upload-product', multerThenAuth('images', 5), (req, res) => {
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

    // ✅ Use imgUrl() — never hard-code localhost
    const imageUrls = req.files.map(f => imgUrl(f.filename));
    const stockQty  = parseInt(stock) || 0;

    const product = {
      id:            db.nextProductId++,
      name:          productName.trim(),
      originalPrice: originalPrice?.trim() ? +originalPrice : null,
      offerPrice:    +offerPrice,
      size:          size?.trim() || category,
      category,
      badge:         badge || '',
      description:   description?.trim() || '',
      images:        imageUrls,
      image:         imageUrls[0],
      stock:         stockQty,
      sold:          0,
      available:     stockQty,
      createdAt:     new Date().toISOString(),
      updatedAt:     new Date().toISOString()
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
  const id  = parseInt(req.params.id);
  const idx = db.products.findIndex(p => p.id === id);
  if (idx === -1) return res.json({ success: false, message: 'Not found' });

  (db.products[idx].images || []).forEach(url => {
    try {
      const fname = url.split('/upload/')[1];
      if (fname) {
        const fp = path.join(UPLOAD_DIR, fname);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
    } catch (_) {}
  });

  db.products.splice(idx, 1);
  saveData();
  console.log(`🗑️  Deleted product ${id}`);
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   ⭐  RELEVANT PRODUCTS
   /relevant          → admin.html
   /relevant-products → productpage.html  (alias)
══════════════════════════════════════════════════════════════ */

app.get('/relevant', (_, res) => {
  res.json({ success: true, products: db.relevantProducts });
});

// Alias for productpage.html
app.get('/relevant-products', (_, res) => {
  res.json({ success: true, products: db.relevantProducts });
});

app.post('/upload-relevant', multerThenAuth('images', 5), (req, res) => {
  try {
    const { productName, offerPrice, originalPrice, category, badge } = req.body;
    console.log('[upload-relevant] body:', req.body, '| files:', (req.files || []).length);

    if (!productName?.trim())
      return res.json({ success: false, message: 'Product name required' });
    if (!offerPrice || isNaN(+offerPrice) || +offerPrice <= 0)
      return res.json({ success: false, message: 'Valid offer price required' });
    if (!(req.files || []).length)
      return res.json({ success: false, message: 'At least one image required' });

    // ✅ Use imgUrl() — never hard-code localhost
    const imageUrls = req.files.map(f => imgUrl(f.filename));

    const product = {
      id:            db.nextRelId++,
      name:          productName.trim(),
      offerPrice:    +offerPrice,
      originalPrice: originalPrice?.trim() ? +originalPrice : null,
      category:      category || '',
      badge:         badge || '',
      images:        imageUrls,
      image:         imageUrls[0],
      isRelevant:    true,
      createdAt:     new Date().toISOString()
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
  const id  = parseInt(req.params.id);
  const idx = db.relevantProducts.findIndex(p => p.id === id);
  if (idx === -1) return res.json({ success: false, message: 'Not found' });

  (db.relevantProducts[idx].images || []).forEach(url => {
    try {
      const fname = url.split('/upload/')[1];
      if (fname) {
        const fp = path.join(UPLOAD_DIR, fname);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
    } catch (_) {}
  });

  db.relevantProducts.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   🔍  RECOMMENDATIONS
   GET /recommendations/:id
   Returns same-category products + all relevant products
   (used by productpage.html "You May Also Like" section)
══════════════════════════════════════════════════════════════ */

app.get('/recommendations/:id', (req, res) => {
  const id = parseInt(req.params.id);

  const source = db.products.find(p => p.id === id)
               || db.relevantProducts.find(p => p.id === id);

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
   GET  /inventory
   PUT  /inventory/:id   { stock }
══════════════════════════════════════════════════════════════ */

app.get('/inventory', (_, res) => {
  const inventory = db.products.map(p => ({
    id:        p.id,
    name:      p.name,
    category:  p.category,
    image:     (p.images || [])[0] || '',
    stock:     p.stock    || 0,
    sold:      p.sold     || 0,
    available: (p.stock || 0) - (p.sold || 0),
    updatedAt: p.updatedAt
  }));
  const lowCount = inventory.filter(i => i.available < 10).length;
  res.json({ success: true, inventory, lowCount });
});

app.put('/inventory/:id', verifyToken, (req, res) => {
  const id = parseInt(req.params.id);
  const p  = db.products.find(x => x.id === id);
  if (!p) return res.json({ success: false, message: 'Product not found' });

  p.stock     = parseInt(req.body.stock) || 0;
  p.available = p.stock - (p.sold || 0);
  p.updatedAt = new Date().toISOString();
  saveData();
  console.log(`📦 Stock updated: ${p.name} → ${p.stock}`);
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   🛒  ORDERS
   GET    /orders                 → admin panel order list
   POST   /orders                 → admin "New Order" modal
   POST   /order/create           → productpage.html checkout
   POST   /order/status           → admin status update
   DELETE /orders/:id             → admin delete order
══════════════════════════════════════════════════════════════ */

app.get('/orders', verifyToken, (_, res) => {
  res.json({ success: true, orders: db.orders });
});

// Used by admin.html "New Order" modal
app.post('/orders', verifyToken, (req, res) => {
  const { customerName, customerPhone, products: prods, total, notes } = req.body;
  const order = {
    id:           'ORD-' + Date.now(),
    customerName: customerName  || 'Walk-in',
    customerPhone:customerPhone || '',
    products:     prods || [],
    total:        parseFloat(total) || 0,
    notes:        notes || '',
    status:       'Pending',
    createdAt:    new Date().toISOString()
  };
  db.orders.unshift(order);
  saveData();
  res.json({ success: true, order });
});

// Used by productpage.html checkout form (no auth required — public)
app.post('/order/create', (req, res) => {
  const { customerName, customerPhone, customerAddress, productId, quantity } = req.body;

  const prod         = db.products.find(p => p.id === parseInt(productId));
  const productName  = prod ? prod.name        : `Product #${productId}`;
  const productPrice = prod ? (prod.offerPrice || 0) : 0;
  const qty          = parseInt(quantity) || 1;

  const order = {
    id:              'ORD-' + Date.now(),
    customerName:    customerName    || 'Online Customer',
    customerPhone:   customerPhone   || '',
    customerAddress: customerAddress || '',
    products: [{
      id:    productId,
      name:  productName,
      price: productPrice,
      qty
    }],
    total:     productPrice * qty,
    notes:     customerAddress || '',
    status:    'Pending',
    source:    'productpage',
    createdAt: new Date().toISOString()
  };

  db.orders.unshift(order);
  saveData();
  console.log(`🛒 Online order: ${order.id} — ${customerName} × ${productName}`);
  res.json({ success: true, order });
});

// Admin status update
app.post('/order/status', verifyToken, (req, res) => {
  const { id, status } = req.body;
  const validStatuses = ['Pending', 'Ready to Move', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status))
    return res.json({ success: false, message: 'Invalid status' });

  const order = db.orders.find(o => o.id === id);
  if (!order) return res.json({ success: false, message: 'Order not found' });

  order.status    = status;
  order.updatedAt = new Date().toISOString();
  saveData();
  res.json({ success: true, order });
});

// Admin delete order
app.delete('/orders/:id', verifyToken, (req, res) => {
  const id  = req.params.id;
  const idx = db.orders.findIndex(o => o.id === id);
  if (idx === -1) return res.json({ success: false, message: 'Order not found' });
  db.orders.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   📈  DASHBOARD
   GET /analytics/dashboard
   Returns { success, stats: { ... } }
══════════════════════════════════════════════════════════════ */

app.get('/analytics/dashboard', verifyToken, (_, res) => {
  const lowStockCount = db.products.filter(p => ((p.stock || 0) - (p.sold || 0)) < 10).length;
  const totalSales    = db.orders
    .filter(o => o.status === 'Delivered')
    .reduce((s, o) => s + (parseFloat(o.total) || 0), 0);

  res.json({
    success: true,
    stats: {
      totalProducts:   db.products.length,
      totalRelevant:   db.relevantProducts.length,
      totalOrders:     db.orders.length,
      pendingOrders:   db.orders.filter(o => o.status === 'Pending').length,
      deliveredOrders: db.orders.filter(o => o.status === 'Delivered').length,
      totalSales,
      lowStockCount
    }
  });
});

/* ─── health check ──────────────────────────────────────────── */
app.get('/api/health', (_, res) => {
  res.json({
    ok:       true,
    env:      process.env.NODE_ENV || 'development',
    baseUrl:  BASE_URL,
    port:     PORT,
    products: db.products.length,
    orders:   db.orders.length,
    users:    db.users.length
  });
});

/* ══════════════════════════════════════════════════════════════
   🚀  START
══════════════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   Manju Paper Plate MFG — Server v4.2 (Production)  ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n  🔧 Admin Panel  →  ${BASE_URL}/`);
  console.log(`  🔧 Admin Panel  →  ${BASE_URL}/admin.html`);
  console.log(`  🌐 Product Page →  ${BASE_URL}/productpage.html`);
  console.log(`  📊 Dashboard    →  ${BASE_URL}/analytics/dashboard`);
  console.log(`  🩺 Health       →  ${BASE_URL}/api/health`);
  console.log(`\n  👥 Users: ${db.users.length}   📦 Products: ${db.products.length}   🛒 Orders: ${db.orders.length}`);
  console.log(`\n  Listening on port ${PORT}\n`);
});
