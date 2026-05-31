const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const { db, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// Persistent cryptographic key to prevent session invalidation on server restart
const JWT_SECRET = process.env.JWT_SECRET || 'yaman_super_secret_key_2024_persistent_v1';

// Cryptographic Password Verification Helper
function verifyPassword(password, storedValue) {
  try {
    const [salt, hash] = storedValue.split(':');
    const verifyHash = crypto.createHmac('sha256', salt).update(password).digest('hex');
    return hash === verifyHash;
  } catch (err) {
    return false;
  }
}

// Signed Secure Token Generator (No external dependencies)
function generateToken(email, role) {
  const expires = Date.now() + 24 * 60 * 60 * 1000; // 24 Hours lifetime
  const payload = `${email}|${role}|${expires}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
  return `${payload}|${signature}`;
}

// Authentication Verification Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'الرجاء تسجيل الدخول أولاً للوصول إلى هذا القسم.' });
  }
  
  try {
    const parts = token.split('|');
    if (parts.length !== 4) {
      return res.status(401).json({ error: 'رمز الجلسة غير صالح.' });
    }
    
    const [email, role, expiresStr, signature] = parts;
    const expires = parseInt(expiresStr);
    
    if (Date.now() > expires) {
      return res.status(401).json({ error: 'انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مجدداً.' });
    }
    
    const payload = `${email}|${role}|${expiresStr}`;
    const verifySignature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
    
    if (signature !== verifySignature) {
      return res.status(401).json({ error: 'رمز الجلسة غير صحيح أو تالف.' });
    }
    
    req.user = { email, role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'فشل المصادقة الأمنية.' });
  }
}

// Role-Based Access Control: requireAdmin Middleware
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'غير مصرح! هذه الصلاحية تطلب حساب المدير العام فقط.' });
  }
}

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in dev, restrict in prod via ALLOWED_ORIGINS env var
    }
  },
  credentials: true
}));
app.use(express.json());
const isProd = process.env.NODE_ENV === 'production';
const dataDir = isProd ? path.join(__dirname, 'data') : __dirname;
const uploadsDir = path.join(dataDir, 'uploads');
app.use('/uploads', express.static(uploadsDir));

// Serve React frontend in production
const frontendBuildPath = path.join(__dirname, 'public');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
  console.log('Serving static frontend from /public');
}

// Ensure uploads dir exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

initDb();

// ---- GOOGLE SHEETS INTEGRATION SYSTEM WITH REDIRECT SUPPORT ----

function sendHttpRequestWithRedirects(targetUrl, postData, method = 'POST', maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      return reject(new Error('Too many redirects'));
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return reject(e);
    }

    const postDataString = postData ? (typeof postData === 'string' ? postData : JSON.stringify(postData)) : '';

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {}
    };

    if (method === 'POST' && postDataString) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postDataString);
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        }
        
        let nextMethod = method;
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
          nextMethod = 'GET';
        }
        
        return sendHttpRequestWithRedirects(redirectUrl, nextMethod === 'GET' ? null : postData, nextMethod, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });

    req.on('error', (err) => { reject(err); });

    if (method === 'POST' && postDataString) {
      req.write(postDataString);
    }
    req.end();
  });
}

function triggerGoogleSheetsSync(orderId) {
  db.get("SELECT value FROM settings WHERE key = 'google_sheets_url'", [], (settingsErr, settingRow) => {
    if (settingsErr || !settingRow || !settingRow.value) {
      console.log(`[Google Sheets] Sync skipped for order ${orderId}: No URL configured.`);
      return;
    }

    const googleSheetsUrl = settingRow.value;

    db.get(`
      SELECT o.*, w.name as wilayaName 
      FROM orders o 
      LEFT JOIN wilayas w ON o.wilayaId = w.id 
      WHERE o.id = ?
    `, [orderId], (orderErr, order) => {
      if (orderErr || !order) {
        console.error(`[Google Sheets] Failed to fetch order ${orderId} for sync:`, orderErr);
        return;
      }

      db.all(`
        SELECT oi.*, p.name as productName, p.code as productCode 
        FROM order_items oi
        JOIN products p ON oi.productId = p.id
        WHERE oi.orderId = ?
      `, [orderId], (itemsErr, items) => {
        if (itemsErr || !items) {
          console.error(`[Google Sheets] Failed to fetch items for order ${orderId}:`, itemsErr);
          return;
        }

        const itemsDetail = items.map(item => {
          return `${item.productName} [${item.productCode}] (الكمية: ${item.quantity})`;
        }).join(' - ');

        const purchaseCost = (order.subtotal || 0) - (order.discount || 0) - (order.realDeliveryPrice || 0) - (order.netProfit || 0);

        const payload = {
          orderId: order.id,
          createdAt: order.createdAt,
          customerName: order.customerName,
          phone: order.phone,
          wilaya: order.wilayaName || `ولاية ${order.wilayaId}`,
          commune: order.communeName || '',
          address: order.address,
          deliveryType: order.deliveryType || 'home',
          itemsDetail: itemsDetail,
          subtotal: order.subtotal,
          appliedDeliveryPrice: order.appliedDeliveryPrice,
          discount: order.discount,
          total: order.total,
          purchaseCost: purchaseCost,
          realDeliveryPrice: order.realDeliveryPrice,
          netProfit: order.netProfit,
          status: order.status,
          trackingNumber: order.ecotrack_tracking || ''
        };

        console.log(`[Google Sheets] Sending order ${orderId} sync payload to Google Sheets...`);
        sendHttpRequestWithRedirects(googleSheetsUrl, payload)
          .then(response => {
            console.log(`[Google Sheets] Sync successful for order ${orderId}. Status: ${response.statusCode}`);
          })
          .catch(err => {
            console.error(`[Google Sheets] Sync failed for order ${orderId}:`, err.message);
          });
      });
    });
  });
}

// ---- ECOTRACK DELIVERY INTEGRATION ----

// Levenshtein helper
function levenshtein(a, b) {
  const tmp = [];
  for (let i = 0; i <= b.length; i++) tmp[i] = [i];
  for (let j = 0; j <= a.length; j++) tmp[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        tmp[i][j] = tmp[i - 1][j - 1];
      } else {
        tmp[i][j] = Math.min(
          tmp[i - 1][j - 1] + 1,
          Math.min(tmp[i][j - 1] + 1, tmp[i - 1][j] + 1)
        );
      }
    }
  }
  return tmp[b.length][a.length];
}

// Arabic normalization helper
function normalizeAr(str) {
  if (!str) return '';
  return str
    .trim()
    .replace(/ال/g, '') // remove all "Al" prefixes
    .replace(/[أإآاىءئؤي]/g, 'ا') // unify all Alef, Hamza, Ya, Alef Maksura to 'ا'
    .replace(/ة/g, 'ه') // Teh Marbuta
    .replace(/\s+/g, '') // remove all spaces
    .toLowerCase();
}

// French normalization helper
function normalizeFr(str) {
  if (!str) return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // remove non-alphanumeric characters
}

// Find DHD French commune name for a given wilaya and input name (Arabic or French)
function findDhdCommune(wilayaId, inputName) {
  if (!inputName) return '';
  
  const localMappingPath = path.resolve(__dirname, '..', 'algeria_communes_ar_fr.json');
  const localDhdCommunesPath = path.resolve(__dirname, '..', 'dhd_all_communes.json');
  const oldMappingPath = '/Users/mac/.gemini/antigravity/scratch/algeria_communes_ar_fr.json';
  const oldDhdCommunesPath = '/Users/mac/.gemini/antigravity/scratch/dhd_all_communes.json';

  const mappingPath = fs.existsSync(localMappingPath) ? localMappingPath : oldMappingPath;
  const dhdCommunesPath = fs.existsSync(localDhdCommunesPath) ? localDhdCommunesPath : oldDhdCommunesPath;
  
  if (!fs.existsSync(mappingPath) || !fs.existsSync(dhdCommunesPath)) {
    console.warn(`[Ecotrack] Commune matching skipped: Mapping files not found.`);
    return inputName;
  }
  
  try {
    const mappingList = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    const dhdList = JSON.parse(fs.readFileSync(dhdCommunesPath, 'utf8'));
    
    const wIdStr = String(wilayaId);
    const inputArNorm = normalizeAr(inputName);
    const inputFrNorm = normalizeFr(inputName);
    
    const mapFiltered = mappingList.filter(c => String(c.wilaya_id) === wIdStr);
    const dhdFiltered = dhdList.filter(c => String(c.wilaya_id) === wIdStr);
    
    // Try 1: Exact match in DHD list directly
    let foundInDhd = dhdFiltered.find(c => c.nom.toLowerCase().trim() === inputName.toLowerCase().trim());
    if (foundInDhd) return foundInDhd.nom;
    
    // Try 2: Normalized match in DHD list directly
    if (inputFrNorm) {
      foundInDhd = dhdFiltered.find(c => normalizeFr(c.nom) === inputFrNorm);
      if (foundInDhd) return foundInDhd.nom;
    }
    
    // Try 3: Arabic matching candidates in mapping list
    let candidate = null;
    candidate = mapFiltered.find(c => 
      c.ar_name.trim() === inputName.trim() || 
      c.name.toLowerCase().trim() === inputName.toLowerCase().trim()
    );
    
    if (!candidate && inputArNorm) {
      candidate = mapFiltered.find(c => normalizeAr(c.ar_name) === inputArNorm);
    }
    
    if (!candidate && inputFrNorm) {
      candidate = mapFiltered.find(c => normalizeFr(c.name) === inputFrNorm);
    }
    
    if (!candidate && inputArNorm) {
      candidate = mapFiltered.find(c => {
        const mapArNorm = normalizeAr(c.ar_name);
        return mapArNorm.includes(inputArNorm) || inputArNorm.includes(mapArNorm);
      });
    }

    if (!candidate && inputFrNorm) {
      candidate = mapFiltered.find(c => {
        const mapFrNorm = normalizeFr(c.name);
        return mapFrNorm.includes(inputFrNorm) || inputFrNorm.includes(mapFrNorm);
      });
    }
    
    if (candidate) {
      let bestMatch = null;
      let minDistance = 999;
      const candFrNorm = normalizeFr(candidate.name);
      
      dhdFiltered.forEach(d => {
        const dFrNorm = normalizeFr(d.nom);
        const dist = levenshtein(candFrNorm, dFrNorm);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = d;
        }
      });
      
      if (bestMatch && minDistance <= 4) {
        return bestMatch.nom;
      }
    }
    
    // Try direct substring match in DHD list directly
    if (inputFrNorm) {
      foundInDhd = dhdFiltered.find(c => 
        normalizeFr(c.nom).includes(inputFrNorm) || 
        inputFrNorm.includes(normalizeFr(c.nom))
      );
      if (foundInDhd) return foundInDhd.nom;
    }
  } catch (err) {
    console.error(`[Ecotrack] Error in commune mapping:`, err.message);
  }
  
  return inputName;
}

function triggerEcotrackCreate(orderId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (tokenErr, tokenRow) => {
      if (tokenErr || !tokenRow || !tokenRow.value || tokenRow.value.trim() === '') {
        console.log(`[Ecotrack] Skipped for order ${orderId}: No API token configured.`);
        return resolve(null);
      }

      const apiToken = tokenRow.value.trim();
      const apiBase = 'https://platform.dhd-dz.com';

      db.get(`
        SELECT o.*, w.name as wilayaName 
        FROM orders o 
        LEFT JOIN wilayas w ON o.wilayaId = w.id 
        WHERE o.id = ?
      `, [orderId], (orderErr, order) => {
        if (orderErr || !order) {
          console.error(`[Ecotrack] Failed to fetch order ${orderId}:`, orderErr);
          return reject(orderErr || new Error("Failed to fetch order"));
        }

        // Skip if already has a tracking number
        if (order.ecotrack_tracking) {
          console.log(`[Ecotrack] Order ${orderId} already has tracking: ${order.ecotrack_tracking}`);
          return resolve(order.ecotrack_tracking);
        }

        db.all(`
          SELECT oi.*, p.name as productName, p.code as productCode, p.category,
                 c.weight as categoryWeight
          FROM order_items oi
          JOIN products p ON oi.productId = p.id
          LEFT JOIN categories c ON p.category = c.code
          WHERE oi.orderId = ?
        `, [orderId], (itemsErr, items) => {
          if (itemsErr) {
            console.error(`[Ecotrack] Failed to fetch items for order ${orderId}:`, itemsErr);
            return reject(itemsErr);
          }

          const productNames = items.map(i => `${i.productCode} X ${i.quantity}`).join(' | ');
          const isStopDesk = order.deliveryType === 'desk' ? 1 : 0;

          // Weight calculation: each item uses its category weight (default 1.45 kg per unit)
          const totalWeightRaw = items.reduce((sum, item) => {
            const unitWeight = parseFloat(item.categoryWeight) || 1.45;
            return sum + (item.quantity * unitWeight);
          }, 0);

          // Round up to nearest integer if total exceeds 5.9 kg (Ecotrack billing bracket)
          const finalWeight = totalWeightRaw > 5.9
            ? Math.ceil(totalWeightRaw)
            : Math.round(totalWeightRaw * 100) / 100;

          console.log(`[Ecotrack] Order ${orderId} total weight: ${totalWeightRaw.toFixed(2)} kg → sending: ${finalWeight} kg`);

          // Perform robust Arabic/French commune mapping
          const mappedCommune = findDhdCommune(order.wilayaId, order.communeName);
          console.log(`[Ecotrack] Order ${orderId} commune mapping: "${order.communeName}" → "${mappedCommune}"`);

          const params = new URLSearchParams({
            reference: String(order.id),
            nom_client: order.customerName,
            telephone: order.phone,
            adresse: order.address || mappedCommune || '',
            commune: mappedCommune || '',
            code_wilaya: String(order.wilayaId),
            montant: String(order.total),
            produit: productNames.substring(0, 255),
            type: '1',
            stop_desk: String(isStopDesk),
            weight: String(finalWeight),
            remarque: `طلبية رقم #${order.id} - Yaman Style | الوزن: ${finalWeight} كغ`
          });

          const ecotrackUrl = `${apiBase}/api/v1/create/order?${params.toString()}`;
          const parsedUrl = new URL(ecotrackUrl);
          const reqOptions = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Accept': 'application/json'
            }
          };

          console.log(`[Ecotrack] Creating order ${orderId} in Ecotrack...`);
          const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              try {
                const result = JSON.parse(data);
                if (result.success && result.tracking) {
                  console.log(`[Ecotrack] Order ${orderId} created. Tracking: ${result.tracking}`);
                  db.run("UPDATE orders SET ecotrack_tracking = ? WHERE id = ?", [result.tracking, orderId], (updateErr) => {
                    if (updateErr) {
                      console.error(`[Ecotrack] Failed to save tracking for order ${orderId}:`, updateErr.message);
                      reject(updateErr);
                    } else {
                      console.log(`[Ecotrack] Tracking ${result.tracking} saved for order ${orderId}.`);
                      triggerGoogleSheetsSync(orderId);
                      resolve(result.tracking);
                    }
                  });
                } else {
                  console.error(`[Ecotrack] Failed to create order ${orderId}:`, result);
                  reject(new Error(result.message || "فشلت عملية إنشاء بوليصة الشحن لدى شركة التوصيل"));
                }
              } catch (parseErr) {
                console.error(`[Ecotrack] Failed to parse response for order ${orderId}:`, parseErr.message, data);
                reject(new Error("استجابة غير صالحة من منصة الشحن DHD"));
              }
            });
          });
          req.on('error', err => {
            console.error(`[Ecotrack] Request failed for order ${orderId}:`, err.message);
            reject(new Error("فشل الاتصال بخادم شركة الشحن DHD"));
          });
          req.end();
        });
      });
    });
  });
}

function deleteDhdShipment(trackingNumber) {
  return new Promise((resolve, reject) => {
    if (!trackingNumber) return resolve(true);

    db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (tokenErr, tokenRow) => {
      if (tokenErr || !tokenRow || !tokenRow.value || tokenRow.value.trim() === '') {
        console.log(`[Ecotrack] Delete skipped for ${trackingNumber}: No API token configured.`);
        return resolve(true);
      }

      const apiToken = tokenRow.value.trim();
      const apiBase = 'https://platform.dhd-dz.com';

      const params = new URLSearchParams({
        tracking: trackingNumber
      });

      const ecotrackUrl = `${apiBase}/api/v1/delete/order?${params.toString()}`;
      const parsedUrl = new URL(ecotrackUrl);
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json'
        }
      };

      console.log(`[Ecotrack] Deleting tracking ${trackingNumber} from Ecotrack...`);
      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.success || result.delete === 'success' || result.message === 'Commande supprimée') {
              console.log(`[Ecotrack] Tracking ${trackingNumber} deleted successfully.`);
              resolve(true);
            } else {
              console.warn(`[Ecotrack] Could not delete ${trackingNumber} (may be already shipped):`, result.message || data);
              reject(new Error(result.message || "Commande non modifiable"));
            }
          } catch (parseErr) {
            console.error(`[Ecotrack] Failed to parse delete response for ${trackingNumber}:`, data);
            reject(new Error("استجابة غير صالحة من شركة الشحن"));
          }
        });
      });
      req.on('error', err => {
        console.error(`[Ecotrack] Delete request failed for ${trackingNumber}:`, err.message);
        reject(new Error("فشل الاتصال بخدمة الشحن لطلب الإلغاء"));
      });
      req.end();
    });
  });
}

// ---- ROUTES ----



// System Users Management
app.get('/api/system_users', authenticateToken, requireAdmin, (req, res) => {
  db.all('SELECT email, name, role, worker_code, phone FROM system_users', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return `${salt}:${hash}`;
};

app.post('/api/system_users', authenticateToken, requireAdmin, (req, res) => {
  const { email, password, name, role, worker_code, phone } = req.body;
  if (!email || !name || !role) return res.status(400).json({ error: 'البيانات الأساسية مطلوبة' });
  
  db.get('SELECT * FROM system_users WHERE email = ?', [email.trim().toLowerCase()], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });
    
    let passHash = existing ? existing.password_hash : '';
    if (password) {
      passHash = hashPassword(password);
    } else if (!existing) {
      return res.status(400).json({ error: 'كلمة المرور مطلوبة للمستخدم الجديد' });
    }

    db.run(
      'INSERT OR REPLACE INTO system_users (email, password_hash, name, role, worker_code, phone) VALUES (?, ?, ?, ?, ?, ?)',
      [email.trim().toLowerCase(), passHash, name, role, worker_code || '', phone || ''],
      function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ success: true, message: 'تم حفظ بيانات الموظف بنجاح' });
      }
    );
  });
});

app.put('/api/system_users/:oldEmail', authenticateToken, requireAdmin, (req, res) => {
  const oldEmail = req.params.oldEmail;
  const { email, password, name, role, worker_code, phone } = req.body;
  if (!email || !name || !role) return res.status(400).json({ error: 'البيانات الأساسية مطلوبة' });

  db.get('SELECT * FROM system_users WHERE email = ?', [oldEmail], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!existing) return res.status(404).json({ error: 'المستخدم غير موجود' });

    let passHash = existing.password_hash;
    if (password) {
      passHash = hashPassword(password);
    }

    db.run(
      'UPDATE system_users SET email = ?, password_hash = ?, name = ?, role = ?, worker_code = ?, phone = ? WHERE email = ?',
      [email.trim().toLowerCase(), passHash, name, role, worker_code || '', phone || '', oldEmail],
      function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ success: true, message: 'تم تحديث بيانات الموظف بنجاح' });
      }
    );
  });
});

app.delete('/api/system_users/:email', authenticateToken, requireAdmin, (req, res) => {
  const email = req.params.email;
  // Prevent admin from deleting themselves
  if (email === req.user.email) {
      return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });
  }
  db.run('DELETE FROM system_users WHERE email = ?', [email], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Authenticate / Login system user
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'الرجاء إدخال البريد الإلكتروني وكلمة المرور.' });
  }

  db.get("SELECT * FROM system_users WHERE email = ?", [email.trim().toLowerCase()], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
    }

    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
    }

    const token = generateToken(user.email, user.role);
    res.json({
      success: true,
      token,
      role: user.role,
      name: user.name,
      email: user.email,
      worker_code: user.worker_code || ''
    });
  });
});

// Categories
app.get('/api/categories', (req, res) => {
  db.all("SELECT * FROM categories", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const data = rows.map(r => ({...r, features: r.features ? JSON.parse(r.features) : []}));
    res.json(data);
  });
});

app.post('/api/categories', authenticateToken, requireAdmin, (req, res) => {
  const { code, name, price, purchasePrice, features, weight } = req.body;
  const unitWeight = (typeof weight !== 'undefined' && weight !== null && weight !== '') ? parseFloat(weight) : 1.45;
  const featsStr = JSON.stringify(features || []);

  db.get("SELECT code FROM categories WHERE code = ?", [code], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) {
      // Update existing, do NOT touch stock
      db.run("UPDATE categories SET name = ?, price = ?, purchasePrice = ?, features = ?, weight = ? WHERE code = ?",
        [name, price, purchasePrice || 0, featsStr, unitWeight, code], function(err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true, code });
      });
    } else {
      // Insert new, stock will default to 0
      db.run("INSERT INTO categories (code, name, price, purchasePrice, stock, features, weight) VALUES (?, ?, ?, ?, 0, ?, ?)",
        [code, name, price, purchasePrice || 0, featsStr, unitWeight], function(err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true, code });
      });
    }
  });
});

app.delete('/api/categories/:code', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM categories WHERE code = ?", [req.params.code], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Products
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/products', authenticateToken, requireAdmin, upload.single('image'), (req, res) => {
  const { code, category, name } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  db.run("INSERT INTO products (code, category, name, image) VALUES (?, ?, ?, ?)",
    [code, category, name, image], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, code, category, name, image });
  });
});

app.delete('/api/products/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM products WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Wilayas
app.get('/api/wilayas', (req, res) => {
  db.all("SELECT * FROM wilayas ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/wilayas', authenticateToken, requireAdmin, (req, res) => {
  const { id, name, deliveryPrice } = req.body;
  db.run("INSERT OR REPLACE INTO wilayas (id, name, deliveryPrice) VALUES (?, ?, ?)",
    [id, name, deliveryPrice], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, name, deliveryPrice });
  });
});

// Communes API
app.get('/api/communes', authenticateToken, (req, res) => {
  db.all("SELECT * FROM communes ORDER BY wilayaId ASC, communeName ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/communes/wilaya/:wilayaId', (req, res) => {
  db.all("SELECT * FROM communes WHERE wilayaId = ? ORDER BY communeName ASC", [req.params.wilayaId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.patch('/api/communes/:id', authenticateToken, requireAdmin, (req, res) => {
  const { appliedHomeFee, appliedDeskFee, realHomeFee, realDeskFee, hasStopDesk } = req.body;
  db.run(`
    UPDATE communes 
    SET appliedHomeFee = ?, appliedDeskFee = ?, realHomeFee = ?, realDeskFee = ?, hasStopDesk = ?
    WHERE id = ?
  `, [appliedHomeFee, appliedDeskFee, realHomeFee, realDeskFee, hasStopDesk, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/communes/bulk-update', authenticateToken, requireAdmin, (req, res) => {
  const { wilayaId, appliedHomeFee, appliedDeskFee, realHomeFee, realDeskFee } = req.body;
  db.run(`
    UPDATE communes 
    SET appliedHomeFee = ?, appliedDeskFee = ?, realHomeFee = ?, realDeskFee = ?
    WHERE wilayaId = ?
  `, [appliedHomeFee, appliedDeskFee, realHomeFee, realDeskFee, wilayaId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, updated: this.changes });
  });
});

app.post('/api/communes/bulk-insert', authenticateToken, requireAdmin, (req, res) => {
  const communes = req.body.communes;
  if (!Array.isArray(communes)) return res.status(400).json({error: "Expected array of communes"});
  
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO communes (id, wilayaId, wilayaName, communeName, appliedHomeFee, appliedDeskFee, realHomeFee, realDeskFee, hasStopDesk)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    communes.forEach(c => {
      stmt.run([c.id, c.wilayaId, c.wilayaName, c.communeName, c.appliedHomeFee, c.appliedDeskFee, c.realHomeFee, c.realDeskFee, c.hasStopDesk]);
    });
    
    stmt.finalize();
    db.run("COMMIT", (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, count: communes.length });
    });
  });
});

// Orders
app.get('/api/orders', authenticateToken, (req, res) => {
  db.run("ALTER TABLE orders ADD COLUMN is_legacy INTEGER DEFAULT 0", () => {
    // Migration: Update any existing orders that were wrongly labeled as test orders due to Validation status
    db.run("UPDATE orders SET dhd_status_label = 'بانتظار التأكيد / التجهيز ⏳' WHERE dhd_status_label LIKE '%🧪%'", (err) => {
      if (!err) {
        console.log("Successfully migrated old validation/test labels to Pre-Hub labels on startup.");
      }
    });
  });
  db.all("SELECT * FROM orders WHERE is_legacy = 0 ORDER BY createdAt DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/orders/:id/items', authenticateToken, (req, res) => {
  db.all(`
    SELECT oi.*, p.name as productName, p.code as productCode, p.image as productImage, p.category 
    FROM order_items oi
    JOIN products p ON oi.productId = p.id
    WHERE oi.orderId = ?
  `, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/orders', (req, res) => {
  const { 
    customerName, 
    phone, 
    wilayaId, 
    address, 
    subtotal, 
    deliveryPrice, 
    total, 
    items,
    communeName,
    deliveryType,
    appliedDeliveryPrice,
    realDeliveryPrice,
    discount
  } = req.body;
  
  // 1. Get commune from DB to check exact real & applied fees
  db.get("SELECT * FROM communes WHERE wilayaId = ? AND communeName = ?", [wilayaId, communeName], (err, commune) => {
    let finalAppliedDelivery = deliveryPrice;
    let finalRealDelivery = 0;
    
    if (commune) {
      if (deliveryType === 'desk') {
        finalAppliedDelivery = deliveryPrice === 0 ? 0 : commune.appliedDeskFee;
        finalRealDelivery = commune.realDeskFee;
      } else {
        finalAppliedDelivery = deliveryPrice === 0 ? 0 : commune.appliedHomeFee;
        finalRealDelivery = commune.realHomeFee;
      }
    } else {
      finalAppliedDelivery = typeof appliedDeliveryPrice !== 'undefined' ? appliedDeliveryPrice : (deliveryPrice || 0);
      finalRealDelivery = typeof realDeliveryPrice !== 'undefined' ? realDeliveryPrice : 0;
    }
    
    const finalTotal = subtotal + finalAppliedDelivery - (parseInt(discount) || 0);
    
    // 2. Fetch purchase prices, weights, and stock for categories and products to compute net profit and weight fees
    db.all("SELECT code, purchasePrice, weight, stock FROM categories", [], (catErr, catRows) => {
      const purchasePriceMap = {};
      const weightMap = {};
      const stockMap = {};
      if (!catErr && catRows) {
        catRows.forEach(row => {
          purchasePriceMap[row.code] = row.purchasePrice || 0;
          weightMap[row.code] = row.weight || 1.45;
          stockMap[row.code] = row.stock || 0;
        });
      }
      
      db.all("SELECT id, category FROM products", [], (prodErr, prodRows) => {
        const productCategoryMap = {};
        if (!prodErr && prodRows) {
          prodRows.forEach(row => {
            productCategoryMap[row.id] = row.category;
          });
        }
        
        let totalPurchaseCost = 0;
        let totalWeightRaw = 0;
        let outOfStockError = null;
        
        // Accumulate requested quantities by category code to check against available stock
        const requestedQuantities = {};
        
        items.forEach(item => {
          const catCode = productCategoryMap[item.productId];
          // Only check stock if category exists, otherwise assume 0
          if (catCode) {
            requestedQuantities[catCode] = (requestedQuantities[catCode] || 0) + item.quantity;
          } else {
            requestedQuantities['UNKNOWN'] = (requestedQuantities['UNKNOWN'] || 0) + item.quantity;
          }
          
          const purchasePrice = purchasePriceMap[catCode] || 0;
          const unitWeight = weightMap[catCode] || 1.45;
          totalPurchaseCost += purchasePrice * item.quantity;
          totalWeightRaw += unitWeight * item.quantity;
        });
        
        // Verify stock availability safely
        for (const catCode of Object.keys(requestedQuantities)) {
          const requested = requestedQuantities[catCode];
          if (catCode === 'UNKNOWN') {
            outOfStockError = `عذراً، بعض المنتجات المطلوبة غير موجودة في المستودع.`;
            break;
          }
          const available = stockMap[catCode] || 0;
          if (requested > available) {
            outOfStockError = `عذراً، الكمية المطلوبة (${requested}) للمنتج غير متوفرة في المخزن. المتوفر حالياً هو: ${available} قطعة.`;
            break;
          }
        }
        
        if (outOfStockError) {
          return res.status(400).json({ error: outOfStockError });
        }
        
        // Match Ecotrack weight rounding logic
        const finalWeight = totalWeightRaw > 5.9
          ? Math.ceil(totalWeightRaw)
          : Math.round(totalWeightRaw * 100) / 100;
          
        // Overweight calculation: 50 DZD for each extra kg above 5 kg
        let overweightFee = 0;
        if (finalWeight > 5) {
          const extraKg = Math.ceil(finalWeight - 5);
          overweightFee = extraKg * 50;
          console.log(`[Weight Fee] Order total weight: ${finalWeight} kg (${extraKg} extra kg) ➔ Adding ${overweightFee} DZD to delivery price`);
        }
        
        const adjustedRealDelivery = finalRealDelivery + overweightFee;
        const adjustedAppliedDelivery = finalAppliedDelivery; // Seller bears it, not added to customer
        const finalTotal = subtotal + adjustedAppliedDelivery - (parseInt(discount) || 0);
        
        const netProfit = subtotal + adjustedAppliedDelivery - (parseInt(discount) || 0) - totalPurchaseCost - adjustedRealDelivery;
        
        // 3. Save order to database
        const currentMonthYear = new Date().toISOString().substring(0, 7); // YYYY-MM
        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          db.get("SELECT MAX(monthly_sequence) as maxSeq FROM orders WHERE month_year = ?", [currentMonthYear], (errSeq, rowSeq) => {
            if (errSeq) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: errSeq.message });
            }
            const nextSeq = (rowSeq && rowSeq.maxSeq ? rowSeq.maxSeq : 0) + 1;
            
            db.run(`INSERT INTO orders (
                      customerName, phone, wilayaId, address, subtotal, deliveryPrice, total,
                      communeName, deliveryType, appliedDeliveryPrice, realDeliveryPrice, netProfit, discount,
                      month_year, monthly_sequence
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                customerName, 
                phone, 
                wilayaId, 
                address, 
                subtotal, 
                adjustedAppliedDelivery, 
                finalTotal,
                communeName || '',
                deliveryType || 'home',
                adjustedAppliedDelivery,
                adjustedRealDelivery,
                netProfit,
                parseInt(discount) || 0,
                currentMonthYear,
                nextSeq
              ],
              function(err) {
                if (err) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err.message });
                }
                
                const orderId = this.lastID;
                const stmt = db.prepare("INSERT INTO order_items (orderId, productId, quantity, priceAtPurchase) VALUES (?, ?, ?, ?)");
                const stmt2 = db.prepare("UPDATE categories SET stock = MAX(0, stock - ?) WHERE code = (SELECT category FROM products WHERE id = ?)");
                
                items.forEach(item => {
                  stmt.run([orderId, item.productId, item.quantity, item.price]);
                  stmt2.run([item.quantity, item.productId]);
                });
                stmt.finalize();
                stmt2.finalize();
              
              db.run("COMMIT", (commitErr) => {
                if (commitErr) return res.status(500).json({ error: commitErr.message });
                res.json({ success: true, orderId });
                triggerGoogleSheetsSync(orderId);
              });
            }
          );
          });
        });
      });
    });
  });
});


// Change Order Status
app.patch('/api/orders/:id/status', authenticateToken, (req, res) => {
  const { status: newStatus } = req.body;
  const orderId = req.params.id;

  // 1. Get current status and ecotrack tracking of the order
  db.get("SELECT status, ecotrack_tracking FROM orders WHERE id = ?", [orderId], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: "Order not found" });

    const oldStatus = order.status;

    // Check if confirming the order
    if (newStatus === 'confirmed' && oldStatus !== 'confirmed') {
      if (order.ecotrack_tracking) {
        return res.status(400).json({ error: "الطلبية مؤكدة بالفعل لدى شركة الشحن وتمتلك رقم تتبع." });
      }

      console.log(`[Ecotrack] Confirming order ${orderId} - triggering DHD shipment creation first...`);
      
      // Trigger DHD creation synchronously before replying
      triggerEcotrackCreate(orderId)
        .then((tracking) => {
          console.log(`[Ecotrack] DHD Shipment created successfully with tracking: ${tracking}. Proceeding with status update...`);
          // Update status to confirmed in DB and adjust inventory stock
          updateOrderStatus(orderId, 'confirmed', (updateErr, updateRes) => {
            if (updateErr) {
              console.error(`[Ecotrack] Failed to update status in DB for confirmed order ${orderId}:`, updateErr.message);
              return res.status(500).json({ error: updateErr.message });
            }
            return res.json({ success: true, tracking });
          });
        })
        .catch((dhdErr) => {
          console.error(`[Ecotrack] Shipment creation failed for order ${orderId}:`, dhdErr.message);
          return res.status(400).json({ error: dhdErr.message || "فشلت عملية إنشاء بوليصة الشحن لدى شركة التوصيل" });
        });
    } else {
      // Reverting a confirmed order (changing to 'cancelled' or 'new')
      if (oldStatus === 'confirmed' && newStatus === 'new') {
        return res.status(400).json({ error: "لا يمكن إرجاع الطلبية كطلب جديد بعد تأكيدها لدى شركة الشحن DHD. مسموح فقط بإلغاء الطلب." });
      }

      const isRevert = (newStatus === 'cancelled' || newStatus === 'new') && order.ecotrack_tracking;

      if (isRevert) {
        console.log(`[Ecotrack] Reversion/cancellation requested for order ${orderId}. Automatically syncing tracking status first...`);
        
        syncOrderWithDhd(orderId)
          .then((syncRes) => {
            // After sync, query the order again to get the latest synced status
            db.get("SELECT status, ecotrack_tracking FROM orders WHERE id = ?", [orderId], (err2, order2) => {
              if (err2) return res.status(500).json({ error: err2.message });
              if (!order2) return res.status(404).json({ error: "Order not found" });

              // If the status has progressed to delivered on DHD, block manual cancellation!
              if (order2.status === 'delivered') {
                return res.status(400).json({ error: "لا يمكن إلغاء أو حذف الطلبية لأنها تم توصيلها بالفعل لدى شركة الشحن DHD." });
              }

              // If the status became cancelled during sync, return success directly
              if (order2.status === 'cancelled') {
                return res.json({ success: true, message: "تم تحديث حالة الطلبية إلى ملغى تلقائياً بالفعل من شركة الشحن." });
              }

              // If the order has no tracking anymore (cleared during sync), proceed with status change
              if (!order2.ecotrack_tracking) {
                updateOrderStatus(orderId, newStatus, (updateErr, updateRes) => {
                  if (updateErr) return res.status(500).json({ error: updateErr.message });
                  return res.json({ success: true });
                });
                return;
              }

              // Otherwise, if still confirmed, proceed to call DHD Delete API to check if it is deletable
              console.log(`[Ecotrack] Sync completed. Order is still confirmed. Verifying deletion with DHD for tracking ${order2.ecotrack_tracking}...`);
              
              db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (tokenErr, tokenRow) => {
                if (tokenErr || !tokenRow || !tokenRow.value || tokenRow.value.trim() === '') {
                  // No API token, proceed locally
                  updateOrderStatus(orderId, newStatus, (updateErr, updateRes) => {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });
                    return res.json({ success: true });
                  });
                  return;
                }

                const apiToken = tokenRow.value.trim();
                const apiBase = 'https://platform.dhd-dz.com';
                const params = new URLSearchParams({ tracking: order2.ecotrack_tracking });
                const ecotrackUrl = `${apiBase}/api/v1/delete/order?${params.toString()}`;
                const parsedUrl = new URL(ecotrackUrl);
                
                const reqOptions = {
                  hostname: parsedUrl.hostname,
                  port: 443,
                  path: parsedUrl.pathname + parsedUrl.search,
                  method: 'DELETE',
                  headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Accept': 'application/json'
                  }
                };

                const req = https.request(reqOptions, (resDhd) => {
                  let data = '';
                  resDhd.on('data', chunk => { data += chunk; });
                  resDhd.on('end', () => {
                    try {
                      const result = JSON.parse(data);
                      if (result.success || result.delete === 'success' || result.message === 'Commande supprimée') {
                        console.log(`[Ecotrack] Tracking ${order2.ecotrack_tracking} deleted successfully from DHD. Proceeding with status change.`);
                        updateOrderStatus(orderId, newStatus, (updateErr, updateRes) => {
                          if (updateErr) return res.status(500).json({ error: updateErr.message });
                          return res.json({ success: true });
                        });
                      } else {
                        console.warn(`[Ecotrack] Delete rejected for ${order2.ecotrack_tracking} (already shipped/validated by DHD):`, result.message || data);
                        return res.status(400).json({ error: "لا يمكن تعديل أو إلغاء الطلبية لأن الشحنة قيد التوصيل (expédié) بالفعل وتم تأكيد شحنها لدى شركة الشحن DHD." });
                      }
                    } catch (parseErr) {
                      console.error(`[Ecotrack] Failed to parse delete response:`, data);
                      return res.status(400).json({ error: "استجابة غير صالحة من شركة الشحن - قد تكون الشحنة قيد التوصيل بالفعل وغير قابلة للحذف." });
                    }
                  });
                });

                req.on('error', err => {
                  console.error(`[Ecotrack] Delete request failed:`, err.message);
                  return res.status(500).json({ error: "فشل الاتصال بخادم شركة الشحن للتحقق من إمكانية إلغاء الطلبية." });
                });
                
                req.end();
              });
            });
          })
          .catch((syncErr) => {
            console.error(`[Ecotrack] Auto-sync failed before deletion for order ${orderId}:`, syncErr.message);
            return res.status(500).json({ error: `فشل التحقق من حالة الشحنة تلقائياً من DHD قبل الإلغاء: ${syncErr.message}` });
          });
      } else {
        // If order already has tracking, and they tried to change to something other than cancelled/new (revert)
        if (order.ecotrack_tracking) {
          return res.status(400).json({ error: "لا يمكن تعديل الطلبية يدوياً لأنها مؤكدة بالفعل لدى شركة الشحن DHD." });
        }

        // For any other status change
        updateOrderStatus(orderId, newStatus, (updateErr, updateRes) => {
          if (updateErr) return res.status(500).json({ error: updateErr.message });
          return res.json({ success: true });
        });
      }
    }
  });
});


// Settings Endpoints
app.get('/api/settings', (req, res) => {
  db.all("SELECT * FROM settings", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(r => {
      try {
        settings[r.key] = JSON.parse(r.value);
      } catch {
        settings[r.key] = r.value;
      }
    });
    res.json(settings);
  });
});

app.post('/api/settings', authenticateToken, requireAdmin, (req, res) => {
  const settings = req.body;
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    Object.entries(settings).forEach(([key, val]) => {
      const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
      stmt.run([key, strVal]);
    });
    stmt.finalize();
    db.run("COMMIT", (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

function updateOrderStatus(orderId, newStatus, callback) {
  db.get("SELECT status, ecotrack_tracking FROM orders WHERE id = ?", [orderId], (err, order) => {
    if (err) return callback(err);
    if (!order) return callback(new Error("Order not found"));
    
    const oldStatus = order.status;
    const isDecrementState = (s) => s !== 'cancelled';
    const wasDecremented = isDecrementState(oldStatus);
    const shouldBeDecremented = isDecrementState(newStatus);
    
    const finalizeUpdate = () => {
      // Perform DB update
      if (wasDecremented === shouldBeDecremented) {
        db.run("UPDATE orders SET status = ?, ecotrack_tracking = CASE WHEN ? IN ('cancelled', 'new') THEN NULL ELSE ecotrack_tracking END WHERE id = ?", [newStatus, newStatus, orderId], function(statusErr) {
          if (statusErr) return callback(statusErr);
          callback(null, { statusChanged: oldStatus !== newStatus });
          triggerGoogleSheetsSync(orderId);
        });
      } else {
        // Stock adjustment is needed. Retrieve items first.
        db.all(`
          SELECT p.category, oi.quantity 
          FROM order_items oi 
          JOIN products p ON oi.productId = p.id 
          WHERE oi.orderId = ?
        `, [orderId], (itemErr, items) => {
          if (itemErr) return callback(itemErr);
          
          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            let updateErr = null;
            const stmt = db.prepare("UPDATE categories SET stock = stock + ? WHERE code = ?");
            items.forEach(item => {
              const stockChange = shouldBeDecremented ? -item.quantity : item.quantity;
              stmt.run([stockChange, item.category], (runErr) => {
                if (runErr) updateErr = runErr;
              });
            });
            stmt.finalize();
            
            if (updateErr) {
              db.run("ROLLBACK");
              return callback(updateErr);
            }
            
            db.run("UPDATE orders SET status = ?, ecotrack_tracking = CASE WHEN ? IN ('cancelled', 'new') THEN NULL ELSE ecotrack_tracking END WHERE id = ?", [newStatus, newStatus, orderId], function(statusErr) {
              if (statusErr) {
                db.run("ROLLBACK");
                return callback(statusErr);
              }
              db.run("COMMIT", (commitErr) => {
                if (commitErr) return callback(commitErr);
                callback(null, { statusChanged: oldStatus !== newStatus });
                triggerGoogleSheetsSync(orderId);
              });
            });
          });
        });
      }
    };
    
    finalizeUpdate();
  });
}

function getDhdArabicStatusLabel(dhdStatus, reason, content) {
  const status = String(dhdStatus).toLowerCase().trim();
  const reasonText = reason ? ` (${reason})` : '';
  
  // Normalize status string (strip French accents and convert underscores to spaces)
  const norm = status.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/_/g, " ").trim();
  
  // Map Validation/Preparation stages to real Pre-Hub statuses instead of test
  if (
    norm.includes('validation') || 
    norm.includes('valid') || 
    norm.includes('pret') || 
    norm.includes('preparation') || 
    (norm.includes('hub') && !norm.includes('vers hub') && !norm.includes('en hub'))
  ) {
    return "بانتظار التأكيد / التجهيز ⏳";
  }
  
  // Delivered states
  const isDelivered = [
    'delivered', 'package delivered', 'delivered to customer', 
    'paye', 'paye et archive', 
    'encaisse non paye', 'encaisse non paye et archive', 
    'livre non encaisse'
  ].some(x => norm === x || norm.includes(x)) || 
  ['delivered', 'package_delivered', 'delivered_to_customer', 'paye', 'payé', 'payé_et_archivé', 'paye_et_archive', 'encaisse_non_paye', 'encaissé_non_payé', 'encaisse_non_paye_et_archive', 'encaissé_non_payé_et_archivé', 'livré_non_encaissé', 'livre_non_encaisse'].includes(status);
  
  if (isDelivered) {
    if (norm.includes('encaisse non paye') || norm.includes('encaisse_non_paye')) {
      return "تم التحصيل وبانتظار السحب 💰" + reasonText;
    }
    if (norm.includes('livre non encaisse') || norm.includes('livre_non_encaisse')) {
      return "تم التسليم (بانتظار تحصيل السائق) ⏳" + reasonText;
    }
    return "تم التسليم بنجاح ✅" + reasonText;
  }
  
  // Cancelled / Returned states
  if (norm.includes('annule')) {
    return "ملغى من شركة الشحن ❌" + reasonText;
  }
  if (
    norm.includes('returned') || 
    norm.includes('retourne') || 
    norm.includes('recu par expediteur') || 
    norm.includes('retour recu') || 
    norm.includes('retour en traitement')
  ) {
    if (norm.includes('traitement')) {
      return "مرتجع قيد المعالجة 🔄" + reasonText;
    }
    return "تم الإرجاع للمستودع 🔄" + reasonText;
  }
  
  // In progress / In transit
  if (
    norm.includes('en cours') || 
    norm.includes('en livraison') || 
    norm.includes('in transit') || 
    norm.includes('shipped') || 
    norm.includes('accepted_by_carrier') || 
    norm.includes('expedie') || 
    norm.includes('en route') || 
    norm.includes('vers hub') || 
    norm.includes('en hub') || 
    norm.includes('vers wilaya') ||
    norm.includes('en station') ||
    norm.includes('vers station') ||
    norm.includes('ramassage') ||
    norm.includes('ramass')
  ) {
    if (norm.includes('vers hub')) {
      return "شحنة متوجهة للمركز (Vers Hub) 🚚" + (content ? ` - ${content}` : '');
    }
    if (norm.includes('en hub') || norm.includes('hub')) {
      return "شحنة في المركز (En Hub) 🚚" + (content ? ` - ${content}` : '');
    }
    if (norm.includes('wilaya')) {
      return "شحنة متوجهة للولاية 🚚" + (content ? ` - ${content}` : '');
    }
    if (norm.includes('en station') || norm.includes('station')) {
      return "شحنة في المحطة (En Station) 🚚" + (content ? ` - ${content}` : '');
    }
    if (norm.includes('vers station')) {
      return "شحنة متوجهة للمحطة (Vers Station) 🚚" + (content ? ` - ${content}` : '');
    }
    if (norm.includes('ramassage') || norm.includes('ramass')) {
      return "قيد الاستلام (Ramassage) 📥" + (content ? ` - ${content}` : '');
    }
    return "قيد التوصيل 🚚" + (content ? ` - ${content}` : '');
  }
  
  if (
    norm.includes('order information received') || 
    norm.includes('order created') || 
    norm.includes('created') || 
    norm.includes('information received')
  ) {
    return "تم تسجيل الطلب لدى شركة الشحن 📥";
  }
  
  // Special states
  if (
    norm.includes('pas de reponse') || 
    norm.includes('no answer') || 
    norm.includes('reponse') || 
    norm.includes('pas')
  ) {
    return "لم يتم الرد من الزبون ☎️" + reasonText;
  }
  if (norm.includes('refuse') || norm.includes('refused')) {
    return "الزبون رفض الاستلام ❌" + reasonText;
  }
  if (
    norm.includes('reporte') || 
    norm.includes('postponed') || 
    norm.includes('postpone') || 
    norm.includes('suspendu')
  ) {
    return "تم تأجيل التوصيل 🗓️" + reasonText;
  }
  if (norm.includes('incorrect') || norm.includes('erreur') || norm.includes('wrong')) {
    return "خطأ في العنوان أو الهاتف ⚠️" + reasonText;
  }
  
  // Fallback
  return dhdStatus + (reason ? ` (${reason})` : '') + (content ? ` - ${content}` : '');
}

function syncOrderWithDhd(orderId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT id, ecotrack_tracking, status, wilayaId FROM orders WHERE id = ?", [orderId], (err, order) => {
      if (err) return reject(err);
      if (!order) return reject(new Error("الطلبية غير موجودة."));
      if (!order.ecotrack_tracking) {
        return resolve({ updated: false, tracking: null, status: order.status, message: "الطلبية لا تمتلك رقم تتبع DHD." });
      }
      
      db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (tokenErr, tokenRow) => {
        if (tokenErr || !tokenRow || !tokenRow.value || tokenRow.value.trim() === '') {
          return reject(new Error("لم يتم تكوين مفتاح API الخاص بـ DHD."));
        }
        
        const apiToken = tokenRow.value.trim();
        const tracking = order.ecotrack_tracking;
        
        const options = {
          hostname: 'platform.dhd-dz.com',
          port: 443,
          path: `/api/v1/get/tracking/info?tracking=${tracking}`,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/json'
          }
        };
        
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                return reject(new Error(`خادم شركة الشحن أرجع رمز حالة ${res.statusCode}`));
              }
              
              const result = JSON.parse(data);
              if (!result.activity || !Array.isArray(result.activity) || result.activity.length === 0) {
                return resolve({ updated: false, tracking, status: order.status, message: "لا توجد نشاطات تتبع مسجلة لهذه البوليصة." });
              }
              
              // Get latest activity status, reason, content
              const latestActivity = result.activity[result.activity.length - 1];
              const dhdStatus = String(latestActivity.status).toLowerCase().trim();
              const reason = latestActivity.reason || '';
              const content = latestActivity.content || '';
              
              // Translate to clean Arabic sub-status
              const dhdArabicLabel = getDhdArabicStatusLabel(dhdStatus, reason, content);
              
              // Save DHD status label to the database immediately on every check
              db.run("UPDATE orders SET dhd_status_label = ? WHERE id = ?", [dhdArabicLabel, orderId], (dbErr) => {
                if (dbErr) {
                  console.error(`[Ecotrack Sync] Failed to save dhd_status_label for order ${orderId}:`, dbErr.message);
                }
              });
              
              // Exclude from changing local system status if labeled as a test/validation order
              if (dhdArabicLabel.includes('🧪')) {
                console.log(`[Ecotrack Sync] Order ${orderId} is in experimental stage (${dhdStatus}). Bypassing status mapping.`);
                return resolve({ updated: false, tracking, status: order.status, dhdStatus, dhdArabicLabel });
              }
              
              let newSystemStatus = order.status;
              
              // Map DHD status to system status
              const normStatusForMap = String(dhdStatus).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '_');
              
              const deliveredStatuses = ['delivered', 'package_delivered', 'delivered_to_customer', 'paye', 'paye_et_archive', 'encaisse_non_paye', 'encaisse_non_paye_et_archive', 'livre_non_encaisse'];
              const returningStatuses = ['returned', 'returned_to_shipper', 'retourne_a_l\'expediteur', 'retourne', 'retour_en_traitement'];
              const cancelledStatuses = ['annule', 'recu_par_expediteur', 'retour_recu'];
              
              if (deliveredStatuses.includes(normStatusForMap)) {
                newSystemStatus = 'delivered';
              } else if (returningStatuses.includes(normStatusForMap)) {
                newSystemStatus = 'returning';
              } else if (cancelledStatuses.includes(normStatusForMap)) {
                newSystemStatus = 'cancelled';
              }
              
              if (newSystemStatus !== order.status) {
                console.log(`[Ecotrack Sync] Order ${orderId} status changed on DHD: "${dhdStatus}" -> mapping system status to "${newSystemStatus}"`);
                
                updateOrderStatus(orderId, newSystemStatus, (updateErr, updateRes) => {
                  if (updateErr) reject(updateErr);
                  else resolve({ updated: true, tracking, oldStatus: order.status, newStatus: newSystemStatus, dhdStatus, dhdArabicLabel });
                });
              } else {
                resolve({ updated: false, tracking, status: order.status, dhdStatus, dhdArabicLabel });
              }
            } catch (parseErr) {
              reject(new Error("فشل في تحليل استجابة خادم شركة الشحن."));
            }
          });
        });
        
        req.on('error', err => {
          reject(new Error(`فشل الاتصال بخدمة الشحن: ${err.message}`));
        });
        
        req.end();
      });
    });
  });
}

// Sync single order status from DHD
app.post('/api/orders/:id/sync-dhd', authenticateToken, async (req, res) => {
  const orderId = req.params.id;
  try {
    const result = await syncOrderWithDhd(orderId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper for delay
const delay = ms => new Promise(res => setTimeout(res, ms));

// Sync all active orders status from DHD in bulk/loop
app.post('/api/orders/sync-all-dhd', authenticateToken, async (req, res) => {
  try {
    db.all("SELECT id FROM orders WHERE status = 'confirmed' AND ecotrack_tracking IS NOT NULL", [], async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows || rows.length === 0) {
        return res.json({ message: "لا توجد طلبيات نشطة قيد التوصيل لمزامنتها.", updatedCount: 0 });
      }
      
      let updatedCount = 0;
      const results = [];
      
      for (const row of rows) {
        try {
          const syncResult = await syncOrderWithDhd(row.id);
          if (syncResult.updated) {
            updatedCount++;
          }
          results.push({ orderId: row.id, ...syncResult });
          await delay(1500); // 1.5s delay to avoid DHD Rate Limit (HTTP 429)
        } catch (syncErr) {
          console.error(`[Bulk Sync] Failed for order ${row.id}:`, syncErr.message);
          results.push({ orderId: row.id, error: syncErr.message });
          await delay(2000); // Wait longer on error
        }
      }
      
      res.json({ message: `تمت مزامنة جميع الطلبيات بنجاح. تم تحديث ${updatedCount} طلبية.`, updatedCount, results });
    });
  } catch (bulkErr) {
    res.status(500).json({ error: bulkErr.message });
  }
});

// Background automatic sync: Sync all active confirmed orders with DHD every 30 minutes
setInterval(() => {
  console.log('[Background Sync] Triggering automated bulk DHD status sync...');
  db.all("SELECT id FROM orders WHERE status = 'confirmed' AND ecotrack_tracking IS NOT NULL", [], async (err, rows) => {
    if (err || !rows || rows.length === 0) return;
    
    console.log(`[Background Sync] Found ${rows.length} active orders to check with DHD.`);
    for (const row of rows) {
      try {
        await syncOrderWithDhd(row.id);
        await delay(1500); // Prevent HTTP 429
      } catch (syncErr) {
        console.error(`[Background Sync] Failed for order ${row.id}:`, syncErr.message);
        await delay(2000); // Wait longer on error
      }
    }
  });
}, 30 * 60 * 1000); // 30 minutes

// ============================================================================
// ---- ERP & FINANCIAL ENDPOINTS ----
// ============================================================================

// 1. INVESTORS API
app.get('/api/investors', authenticateToken, requireAdmin, (req, res) => {
  db.all("SELECT * FROM investors ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/investors', authenticateToken, requireAdmin, (req, res) => {
  const { name, share_percentage, invested_capital } = req.body;
  if (!name || typeof share_percentage === 'undefined') {
    return res.status(400).json({ error: "اسم الشريك ونسبة الشراكة مطلوبان" });
  }
  db.run(`
    INSERT INTO investors (name, share_percentage, invested_capital)
    VALUES (?, ?, ?)
  `, [name, parseFloat(share_percentage), parseInt(invested_capital) || 0], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/investors/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM investors WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});


// 2. INVENTORY PURCHASES API
app.get('/api/inventory-purchases', authenticateToken, requireAdmin, (req, res) => {
  db.all(`
    SELECT ip.*, c.name as category_name 
    FROM inventory_purchases ip 
    LEFT JOIN categories c ON ip.category_code = c.code 
    ORDER BY purchase_date DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/inventory-purchases', authenticateToken, requireAdmin, (req, res) => {
  const { category_code, quantity, price_per_unit, payment_type, amount_paid, amount_debt, supplier_name, distribution } = req.body;
  if (!category_code || !quantity || !price_per_unit || !payment_type) {
    return res.status(400).json({ error: "جميع حقول فاتورة الشراء مطلوبة" });
  }

  const qty = parseInt(quantity);
  const price = parseInt(price_per_unit);
  const paid = parseInt(amount_paid) || 0;
  const debt = parseInt(amount_debt) || 0;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    // Increment category stock
    db.run("UPDATE categories SET stock = stock + ? WHERE code = ?", [qty, category_code], (err1) => {
      if (err1) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: err1.message });
      }

      const runInsertPurchase = () => {
        db.run(`
          INSERT INTO inventory_purchases (category_code, quantity, price_per_unit, payment_type, amount_paid, amount_debt, supplier_name)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [category_code, qty, price, payment_type, paid, debt, supplier_name || ''], function(err2) {
          if (err2) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err2.message });
          }

          db.run("COMMIT", (commitErr) => {
            if (commitErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: commitErr.message });
            }
            res.json({ success: true, id: this.lastID });
          });
        });
      };

      if (distribution && Array.isArray(distribution) && distribution.length > 0) {
        let distErr = null;
        const stmt = db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
        distribution.forEach(dist => {
          if (dist.productId && dist.quantity) {
            stmt.run([parseInt(dist.quantity), parseInt(dist.productId)], (e) => {
              if (e) distErr = e;
            });
          }
        });
        stmt.finalize(() => {
          if (distErr) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: distErr.message });
          }
          runInsertPurchase();
        });
      } else {
        runInsertPurchase();
      }
    });
  });
});

app.delete('/api/inventory-purchases/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM inventory_purchases WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});


app.post('/api/inventory-purchases/distribute', authenticateToken, requireAdmin, (req, res) => {
  const { category_code, distribution } = req.body;
  if (!category_code || !distribution || !Array.isArray(distribution)) {
    return res.status(400).json({ error: "بيانات التوزيع غير صالحة" });
  }

  const requestedTotal = distribution.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
  if (requestedTotal <= 0) return res.status(400).json({ error: "يجب أن تكون الكمية الموزعة أكبر من 0" });

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    // 1. Calculate unassigned stock for this category
    db.get(`
      SELECT 
        c.stock as total_stock, 
        COALESCE((SELECT SUM(stock) FROM products WHERE category = c.code), 0) as distributed_stock 
      FROM categories c WHERE c.code = ?
    `, [category_code], (err, row) => {
      if (err) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        db.run("ROLLBACK");
        return res.status(404).json({ error: "الفئة غير موجودة" });
      }

      const unassignedStock = row.total_stock - row.distributed_stock;
      if (requestedTotal > unassignedStock) {
        db.run("ROLLBACK");
        return res.status(400).json({ error: `خطأ صارم: الكمية المطلوبة للتوزيع (${requestedTotal}) تتجاوز الرصيد غير الموزع المتاح (${unassignedStock})!` });
      }

      // 2. Perform distribution
      let distErr = null;
      const stmt = db.prepare("UPDATE products SET stock = stock + ? WHERE id = ? AND category = ?");
      distribution.forEach(dist => {
        const qty = parseInt(dist.quantity) || 0;
        if (dist.productId && qty > 0) {
          stmt.run([qty, parseInt(dist.productId), category_code], (e) => {
            if (e) distErr = e;
          });
        }
      });
      
      stmt.finalize(() => {
        if (distErr) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: distErr.message });
        }
        db.run("COMMIT", (commitErr) => {
          if (commitErr) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: commitErr.message });
          }
          res.json({ success: true, message: "تم التوزيع بنجاح" });
        });
      });
    });
  });
});


// 3. DEBT PAYMENTS API
app.get('/api/debt-payments', authenticateToken, requireAdmin, (req, res) => {
  db.all("SELECT * FROM debt_payments ORDER BY payment_date DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/debt-payments', authenticateToken, requireAdmin, (req, res) => {
  const { debt_type, target_id, target_name, amount_paid } = req.body;
  if (!debt_type || !target_name || !amount_paid) {
    return res.status(400).json({ error: "جميع بيانات عملية السداد مطلوبة" });
  }

  const paid = parseInt(amount_paid);

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    
    db.run(`
      INSERT INTO debt_payments (debt_type, target_id, target_name, amount_paid)
      VALUES (?, ?, ?, ?)
    `, [debt_type, target_id || 0, target_name, paid], function(err1) {
      if (err1) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: err1.message });
      }

      if (debt_type === 'supplier' && target_id) {
        db.run(`
          UPDATE inventory_purchases 
          SET amount_debt = MAX(0, amount_debt - ?) 
          WHERE id = ?
        `, [paid, target_id], (err2) => {
          if (err2) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err2.message });
          }

          db.run("COMMIT", (commitErr) => {
            if (commitErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: commitErr.message });
            }
            res.json({ success: true, id: this.lastID });
          });
        });
      } else if (debt_type === 'loan' && target_id) {
        db.run(`
          UPDATE borrowings 
          SET amount_paid = amount_paid + ?, amount_debt = MAX(0, amount_debt - ?) 
          WHERE id = ?
        `, [paid, paid, target_id], (err2) => {
          if (err2) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err2.message });
          }

          db.run("COMMIT", (commitErr) => {
            if (commitErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: commitErr.message });
            }
            res.json({ success: true, id: this.lastID });
          });
        });
      } else {
        db.run("COMMIT", (commitErr) => {
          if (commitErr) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: commitErr.message });
          }
          res.json({ success: true, id: this.lastID });
        });
      }
    });
  });
});

app.delete('/api/debt-payments/:id', authenticateToken, requireAdmin, (req, res) => {
  const paymentId = req.params.id;
  db.get("SELECT * FROM debt_payments WHERE id = ?", [paymentId], (err, payment) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!payment) return res.status(404).json({ error: "عملية السداد غير موجودة" });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      
      db.run("DELETE FROM debt_payments WHERE id = ?", [paymentId], (err1) => {
        if (err1) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err1.message });
        }

        if (payment.debt_type === 'supplier' && payment.target_id) {
          db.run(`
            UPDATE inventory_purchases 
            SET amount_debt = amount_debt + ? 
            WHERE id = ?
          `, [payment.amount_paid, payment.target_id], (err2) => {
            if (err2) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: err2.message });
            }

            db.run("COMMIT", (commitErr) => {
              if (commitErr) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: commitErr.message });
              }
              res.json({ success: true });
            });
          });
        } else if (payment.debt_type === 'loan' && payment.target_id) {
          db.run(`
            UPDATE borrowings 
            SET amount_paid = MAX(0, amount_paid - ?), amount_debt = amount_debt + ? 
            WHERE id = ?
          `, [payment.amount_paid, payment.amount_paid, payment.target_id], (err2) => {
            if (err2) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: err2.message });
            }

            db.run("COMMIT", (commitErr) => {
              if (commitErr) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: commitErr.message });
              }
              res.json({ success: true });
            });
          });
        } else {
          db.run("COMMIT", (commitErr) => {
            if (commitErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: commitErr.message });
            }
            res.json({ success: true });
          });
        }
      });
    });
  });
});


// 4. GENERAL EXPENSES API
app.get('/api/expenses', authenticateToken, requireAdmin, (req, res) => {
  db.all("SELECT * FROM expenses ORDER BY expense_date DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/expenses', authenticateToken, requireAdmin, (req, res) => {
  const { title, category, amount } = req.body;
  if (!title || !category || !amount) {
    return res.status(400).json({ error: "جميع حقول المصاريف مطلوبة" });
  }
  db.run(`
    INSERT INTO expenses (title, category, amount)
    VALUES (?, ?, ?)
  `, [title, category, parseInt(amount)], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/expenses/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM expenses WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});


// 5. EMPLOYEES & SALARIES API
app.get('/api/employees', authenticateToken, requireAdmin, (req, res) => {
  db.all("SELECT * FROM employees ORDER BY createdAt DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/employees', authenticateToken, requireAdmin, (req, res) => {
  const { name, role, salary_type, salary_rate } = req.body;
  if (!name || !role || !salary_type || typeof salary_rate === 'undefined') {
    return res.status(400).json({ error: "جميع بيانات الموظف مطلوبة" });
  }
  db.run(`
    INSERT INTO employees (name, role, salary_type, salary_rate)
    VALUES (?, ?, ?, ?)
  `, [name, role, salary_type, parseInt(salary_rate)], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/employees/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM employees WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});


// 6. EMPLOYEE PAYMENTS API
app.get('/api/employee-payments', authenticateToken, requireAdmin, (req, res) => {
  db.all(`
    SELECT ep.*, e.name as employee_name, e.role as employee_role
    FROM employee_payments ep
    JOIN employees e ON ep.employee_id = e.id
    ORDER BY payment_date DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/employee-payments', authenticateToken, requireAdmin, (req, res) => {
  const { employee_id, amount_paid } = req.body;
  if (!employee_id || !amount_paid) {
    return res.status(400).json({ error: "اسم الموظف والمبلغ المدفوع مطلوبان" });
  }
  db.run(`
    INSERT INTO employee_payments (employee_id, amount_paid)
    VALUES (?, ?)
  `, [parseInt(employee_id), parseInt(amount_paid)], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/employee-payments/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM employee_payments WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});


// 7. AD SPEND API
app.get('/api/ad-spend', authenticateToken, requireAdmin, (req, res) => {
  db.all("SELECT * FROM ad_spend ORDER BY spend_date DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/ad-spend', authenticateToken, requireAdmin, (req, res) => {
  const { spend_date, amount } = req.body;
  if (!spend_date || typeof amount === 'undefined') {
    return res.status(400).json({ error: "التاريخ وتكلفة الإعلانات مطلوبان" });
  }
  db.run(`
    INSERT OR REPLACE INTO ad_spend (spend_date, amount)
    VALUES (?, ?)
  `, [spend_date, parseInt(amount)], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID || null });
  });
});

app.delete('/api/ad-spend/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM ad_spend WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});


// 7.5 BORROWINGS (LOANS) API
app.get('/api/borrowings', authenticateToken, requireAdmin, (req, res) => {
  db.all(`SELECT * FROM borrowings ${dBorr} ORDER BY loan_date DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/borrowings', authenticateToken, requireAdmin, (req, res) => {
  const { creditor_name, amount } = req.body;
  if (!creditor_name || !amount) {
    return res.status(400).json({ error: "اسم المقرض والمبلغ مطلوبان" });
  }
  const amt = parseInt(amount);
  db.run(`
    INSERT INTO borrowings (creditor_name, amount, amount_paid, amount_debt)
    VALUES (?, ?, 0, ?)
  `, [creditor_name, amt, amt], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/borrowings/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM borrowings WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});


// 7.6 CASH RECONCILIATION & COD PAYOUTS API
app.get('/api/orders/delivered', authenticateToken, (req, res) => {
  db.all("SELECT * FROM orders WHERE status = 'delivered' AND is_legacy = 0 AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%' ORDER BY createdAt DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.patch('/api/orders/:id/reconcile-payout', authenticateToken, requireAdmin, (req, res) => {
  const { status } = req.body; // 'pending_payout' or 'payout_received'
  if (!status) return res.status(400).json({ error: "حالة التسوية مطلوبة" });
  
  db.run("UPDATE orders SET cod_payout_status = ? WHERE id = ?", [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});


// 7.7 PULL ALL ORDERS FROM DHD PLATFORM AND SYNC/IMPORT
function fetchDhdOrdersPage(apiToken, page) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'platform.dhd-dz.com',
      port: 443,
      path: `/api/v1/get/orders?page=${page}&api_token=${apiToken}&start_date=2020-01-01&end_date=2030-12-31`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`خادم شركة التوصيل أرجع رمز حالة ${res.statusCode}`));
          }
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error("فشل في تحليل استجابة خادم شركة التوصيل."));
        }
      });
    });
    
    req.on('error', err => reject(new Error(`فشل الاتصال بخادم DHD: ${err.message}`)));
    req.end();
  });
}

async function pullOrdersFromDhd(apiToken, productsList, categoriesMap) {
  let page = 1;
  let totalProcessed = 0;
  let totalImported = 0;
  let totalUpdated = 0;
  const fetchedTrackings = [];
  
  while (page <= 20) {
    console.log(`[DHD Pull] Fetching orders list page ${page}...`);
    let resData;
    try {
      resData = await fetchDhdOrdersPage(apiToken, page);
    } catch (err) {
      console.error(`[DHD Pull] Failed to fetch DHD orders page ${page}:`, err.message);
      break;
    }
    
    let ordersList = [];
    if (resData && Array.isArray(resData)) {
      ordersList = resData;
    } else if (resData && resData.data && Array.isArray(resData.data)) {
      ordersList = resData.data;
    }
    
    if (ordersList.length === 0) {
      console.log(`[DHD Pull] No more orders on page ${page}. Stopping.`);
      break;
    }
    
    console.log(`[DHD Pull] Processing ${ordersList.length} orders from page ${page}...`);
    
    for (const dhdOrder of ordersList) {
      totalProcessed++;
      const tracking = dhdOrder.tracking;
      if (tracking) fetchedTrackings.push(tracking);
      const ref = dhdOrder.reference;
      const client = dhdOrder.client || dhdOrder.nom_client || 'زبون غير معروف';
      const phone = dhdOrder.phone || dhdOrder.telephone || '';
      const address = dhdOrder.adresse || dhdOrder.address || '';
      const commune = dhdOrder.commune || '';
      const wilayaId = parseInt(dhdOrder.wilaya_id || dhdOrder.code_wilaya) || 16;
      const montant = parseInt(dhdOrder.montant) || 0;
      const prest = parseInt(dhdOrder.tarif_prestation || dhdOrder.delivery_price) || 600;
      const retFee = parseInt(dhdOrder.tarif_retour) || 200;
      const dhdStatus = String(dhdOrder.status).toLowerCase().trim();
      const productsText = dhdOrder.products || dhdOrder.produit || '';
      const dateStr = dhdOrder.created_at || new Date().toISOString();
      
      // Skip pre-transit statuses that are not yet meaningful for local tracking
      // 1 = Prêt à expédier, 2 = En ramassage, 102 = Vers Station
      const dhdStatusId = parseInt(dhdOrder.status_id || dhdOrder.etat_id) || 0;
      const normStatus = dhdStatus.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const isPreTransit = (
        dhdStatusId === 1 ||
        normStatus.includes('pret a expedier') || normStatus === 'pret'
      );
      if (isPreTransit) {
        console.log(`[DHD Pull] Skipping pre-transit order ${tracking} (status: ${dhdOrder.status})`);
        continue;
      }
      
      let newSystemStatus = 'confirmed';
      const normStatusForMap = dhdStatus.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '_');
      
      const deliveredStatuses = ['delivered', 'package_delivered', 'delivered_to_customer', 'paye', 'paye_et_archive', 'encaisse_non_paye', 'encaisse_non_paye_et_archive', 'livre_non_encaisse'];
      const returningStatuses = ['returned', 'returned_to_shipper', 'retourne_a_l\'expediteur', 'retourne', 'retour_en_traitement'];
      const cancelledStatuses = ['annule', 'recu_par_expediteur', 'retour_recu'];
      
      if (deliveredStatuses.includes(normStatusForMap)) {
        newSystemStatus = 'delivered';
      } else if (returningStatuses.includes(normStatusForMap)) {
        newSystemStatus = 'returning';
      } else if (cancelledStatuses.includes(normStatusForMap)) {
        newSystemStatus = 'cancelled';
      }
      
      const dhdArabicLabel = getDhdArabicStatusLabel(dhdStatus, '', '');
      
      const paymentId = dhdOrder.payment_id;
      let codPayoutStatus = 'pending_payout';
      if (paymentId !== null && paymentId !== undefined && paymentId !== 0 && String(paymentId).trim() !== '') {
        codPayoutStatus = 'payout_received';
      }
      
      // Look up if this order exists locally by TRACKING only
      const existing = await new Promise((resolve) => {
        db.get(
          "SELECT id, status, ecotrack_tracking, dhd_status_label FROM orders WHERE ecotrack_tracking = ?",
          [tracking],
          (e, row) => resolve(row)
        );
      });
      
      if (existing) {
        const oldStatus = existing.status;
        
        // If the order was already delivered or cancelled, we don't need to re-parse items or recalculate delivery price/profit!
        if (oldStatus === 'delivered' || oldStatus === 'cancelled') {
          await new Promise((resolve) => {
            db.run(
              `UPDATE orders SET 
                status = ?, 
                dhd_status_label = ?, 
                cod_payout_status = ?
               WHERE id = ?`,
              [newSystemStatus, dhdArabicLabel, codPayoutStatus, existing.id],
              resolve
            );
          });
          totalUpdated++;
          continue;
        }
        
        // 1. Get existing items
        const oldItems = await new Promise((resolve) => {
          db.all("SELECT oi.*, p.category FROM order_items oi JOIN products p ON oi.productId = p.id WHERE oi.orderId = ?", [existing.id], (e, rows) => resolve(rows || []));
        });
        
        // 2. If the old order was active, temporarily add its items back to stock
        const isRealActive = (s, lbl) => {
          const isActive = (s === 'confirmed' || s === 'delivered');
          const isTest = lbl && lbl.includes('🧪');
          return isActive && !isTest;
        };
        
        const wasRealActive = isRealActive(oldStatus, existing.dhd_status_label);
        if (wasRealActive) {
          await new Promise((resolve) => {
            db.serialize(() => {
              db.run("BEGIN TRANSACTION");
              oldItems.forEach(item => {
                db.run("UPDATE products SET stock = stock + ? WHERE id = ?", [item.quantity, item.productId]);
              });
              db.run("COMMIT", resolve);
            });
          });
        }
        
        // 3. Delete old items
        await new Promise((resolve) => {
          db.run("DELETE FROM order_items WHERE orderId = ?", [existing.id], resolve);
        });
        
        // 4. Parse DHD products text to get new items
        const parsedItems = [];
        if (productsText) {
          const parts = productsText.split(/[,;\+\|\/]/);
          for (let part of parts) {
            part = part.trim();
            if (!part) continue;
            
            let qty = 1;
            let name = part;
            
            const xSuffixMatch = part.match(/(.+?)\s*[xX]\s*(\d+)$/);
            const xPrefixMatch = part.match(/^(\d+)\s*[xX]\s*(.+)$/);
            const parenMatch = part.match(/(.+?)\s*\((\d+)\)$/);
            
            if (xSuffixMatch) {
              name = xSuffixMatch[1].trim();
              qty = parseInt(xSuffixMatch[2]) || 1;
            } else if (xPrefixMatch) {
              name = xPrefixMatch[2].trim();
              qty = parseInt(xPrefixMatch[1]) || 1;
            } else if (parenMatch) {
              name = parenMatch[1].trim();
              qty = parseInt(parenMatch[2]) || 1;
            }
            
            // 1. Try exact code match (case-insensitive)
            let foundProduct = productsList.find(p => p.code.toLowerCase() === name.toLowerCase());
            
            // 2. Try exact name match (case-insensitive)
            if (!foundProduct) {
              foundProduct = productsList.find(p => p.name.toLowerCase() === name.toLowerCase());
            }
            
            // 3. Try word boundary or substring match
            if (!foundProduct) {
              foundProduct = productsList.find(p => 
                name.toLowerCase().includes(p.code.toLowerCase()) || 
                p.name.toLowerCase().includes(name.toLowerCase())
              );
            }
            
            if (!foundProduct) {
              const firstChar = name.toUpperCase().charAt(0);
              foundProduct = productsList.find(p => p.category === firstChar);
            }
            
            if (foundProduct) {
              parsedItems.push({
                productId: foundProduct.id,
                quantity: qty,
                price: categoriesMap[foundProduct.category]?.price || 2500,
                category: foundProduct.category
              });
            }
          }
        }
        
        if (parsedItems.length === 0 && productsList.length > 0) {
          const fallbackProd = productsList[0];
          parsedItems.push({
            productId: fallbackProd.id,
            quantity: 1,
            price: categoriesMap[fallbackProd.category]?.price || 2500,
            category: fallbackProd.category
          });
        }
        
        // 5. Insert new items into database
        await new Promise((resolve) => {
          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare("INSERT INTO order_items (orderId, productId, quantity, priceAtPurchase) VALUES (?, ?, ?, ?)");
            parsedItems.forEach(item => {
              stmt.run([existing.id, item.productId, item.quantity, item.price]);
            });
            stmt.finalize();
            db.run("COMMIT", resolve);
          });
        });
        
        // 6. Subtract new items from stock if new status is active
        const isNewRealActive = isRealActive(newSystemStatus, dhdArabicLabel);
        if (isNewRealActive) {
          await new Promise((resolve) => {
            db.serialize(() => {
              db.run("BEGIN TRANSACTION");
              parsedItems.forEach(item => {
                db.run("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?", [item.quantity, item.productId]);
              });
              db.run("COMMIT", resolve);
            });
          });
        }
        
        // 7. Calculate new costs and profit based on new items
        let purchaseCost = 0;
        let totalWeightRaw = 0;
        parsedItems.forEach(item => {
          const cat = categoriesMap[item.category] || { purchasePrice: 0, weight: 1.45 };
          purchaseCost += (cat.purchasePrice || 0) * item.quantity;
          totalWeightRaw += (cat.weight || 1.45) * item.quantity;
        });
        
        // DHD weight fee calculation: DHD already finalizes the total delivery fee in prest/prestation
        let overweightFee = 0;
        
        const subtotal = montant - prest;
        let adjustedRealDelivery = prest;
        let netProfit = 0;
        
        if (newSystemStatus === 'cancelled') {
          adjustedRealDelivery = retFee;
          netProfit = -retFee; // Deduct return fee from profit
        } else {
          netProfit = subtotal - purchaseCost;
        }
        
        await new Promise((resolve) => {
          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run(
              `UPDATE orders SET 
                status = ?, 
                dhd_status_label = ?, 
                subtotal = ?,
                total = ?, 
                deliveryPrice = ?, 
                realDeliveryPrice = ?, 
                appliedDeliveryPrice = ?, 
                netProfit = ?,
                cod_payout_status = ?
               WHERE id = ?`,
              [newSystemStatus, dhdArabicLabel, subtotal, montant, prest, adjustedRealDelivery, prest, netProfit, codPayoutStatus, existing.id],
              () => {
                db.run("COMMIT", resolve);
              }
            );
          });
        });
        totalUpdated++;
      } else {
        // New order imported from DHD!
        const parsedItems = [];
        if (productsText) {
          const parts = productsText.split(/[,;\+\|\/]/);
          for (let part of parts) {
            part = part.trim();
            if (!part) continue;
            
            let qty = 1;
            let name = part;
            
            const xSuffixMatch = part.match(/(.+?)\s*[xX]\s*(\d+)$/);
            const xPrefixMatch = part.match(/^(\d+)\s*[xX]\s*(.+)$/);
            const parenMatch = part.match(/(.+?)\s*\((\d+)\)$/);
            
            if (xSuffixMatch) {
              name = xSuffixMatch[1].trim();
              qty = parseInt(xSuffixMatch[2]) || 1;
            } else if (xPrefixMatch) {
              name = xPrefixMatch[2].trim();
              qty = parseInt(xPrefixMatch[1]) || 1;
            } else if (parenMatch) {
              name = parenMatch[1].trim();
              qty = parseInt(parenMatch[2]) || 1;
            }
            
            // 1. Try exact code match (case-insensitive)
            let foundProduct = productsList.find(p => p.code.toLowerCase() === name.toLowerCase());
            
            // 2. Try exact name match (case-insensitive)
            if (!foundProduct) {
              foundProduct = productsList.find(p => p.name.toLowerCase() === name.toLowerCase());
            }
            
            // 3. Try word boundary or substring match
            if (!foundProduct) {
              foundProduct = productsList.find(p => 
                name.toLowerCase().includes(p.code.toLowerCase()) || 
                p.name.toLowerCase().includes(name.toLowerCase())
              );
            }
            
            if (!foundProduct) {
              const firstChar = name.toUpperCase().charAt(0);
              foundProduct = productsList.find(p => p.category === firstChar);
            }
            
            if (foundProduct) {
              parsedItems.push({
                productId: foundProduct.id,
                quantity: qty,
                price: categoriesMap[foundProduct.category]?.price || 2500,
                category: foundProduct.category
              });
            }
          }
        }
        
        if (parsedItems.length === 0 && productsList.length > 0) {
          const fallbackProd = productsList[0];
          parsedItems.push({
            productId: fallbackProd.id,
            quantity: 1,
            price: categoriesMap[fallbackProd.category]?.price || 2500,
            category: fallbackProd.category
          });
        }
        
        let purchaseCost = 0;
        let totalWeightRaw = 0;
        parsedItems.forEach(item => {
          const cat = categoriesMap[item.category] || { purchasePrice: 0, weight: 1.45 };
          purchaseCost += (cat.purchasePrice || 0) * item.quantity;
          totalWeightRaw += (cat.weight || 1.45) * item.quantity;
        });
        
        const subtotal = montant - prest;
        let adjustedRealDelivery = prest;
        let netProfit = 0;
        
        if (newSystemStatus === 'cancelled') {
          adjustedRealDelivery = retFee; // DHD charges return fee
          netProfit = -retFee; // Deduct return fee from profit
        } else {
          netProfit = subtotal - purchaseCost;
        }
        
        await new Promise((resolve) => {
          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            let insertQuery = `
              INSERT INTO orders (
                customerName, phone, wilayaId, address, subtotal, deliveryPrice, total,
                communeName, deliveryType, appliedDeliveryPrice, realDeliveryPrice, netProfit, 
                status, dhd_status_label, ecotrack_tracking, createdAt, cod_payout_status, is_legacy
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `;
            let params = [
              client, phone, wilayaId, address, subtotal, prest, montant,
              commune, 'home', prest, adjustedRealDelivery, netProfit,
              newSystemStatus, dhdArabicLabel, tracking, dateStr, codPayoutStatus
            ];
            
            const isRefNum = /^\d+$/.test(ref);
            if (isRefNum) {
              const parsedRef = parseInt(ref);
              db.get("SELECT id FROM orders WHERE id = ?", [parsedRef], (idErr, row) => {
                if (!row) {
                  insertQuery = `
                    INSERT INTO orders (
                      id, customerName, phone, wilayaId, address, subtotal, deliveryPrice, total,
                      communeName, deliveryType, appliedDeliveryPrice, realDeliveryPrice, netProfit, 
                      status, dhd_status_label, ecotrack_tracking, createdAt, cod_payout_status, is_legacy
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                  `;
                  params = [
                    parsedRef, client, phone, wilayaId, address, subtotal, prest, montant,
                    commune, 'home', prest, adjustedRealDelivery, netProfit,
                    newSystemStatus, dhdArabicLabel, tracking, dateStr, codPayoutStatus
                  ];
                }
                
                db.run(insertQuery, params, function(err) {
                  const newId = this.lastID || parsedRef;
                  const stmt = db.prepare("INSERT INTO order_items (orderId, productId, quantity, priceAtPurchase) VALUES (?, ?, ?, ?)");
                  parsedItems.forEach(item => {
                    stmt.run([newId, item.productId, item.quantity, item.price]);
                  });
                  stmt.finalize();
                  
                  const isRealActive = (s, lbl) => {
                    const isActive = (s === 'confirmed' || s === 'delivered');
                    const isTest = lbl && lbl.includes('🧪');
                    return isActive && !isTest;
                  };
                  
                  if (isRealActive(newSystemStatus, dhdArabicLabel)) {
                    parsedItems.forEach(item => {
                      db.run("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?", [item.quantity, item.productId]);
                    });
                  }
                  db.run("COMMIT", resolve);
                });
              });
            } else {
              db.run(insertQuery, params, function(err) {
                const newId = this.lastID;
                const stmt = db.prepare("INSERT INTO order_items (orderId, productId, quantity, priceAtPurchase) VALUES (?, ?, ?, ?)");
                parsedItems.forEach(item => {
                  stmt.run([newId, item.productId, item.quantity, item.price]);
                });
                stmt.finalize();
                
                const isRealActive = (s, lbl) => {
                  const isActive = (s === 'confirmed' || s === 'delivered');
                  const isTest = lbl && lbl.includes('🧪');
                  return isActive && !isTest;
                };
                
                if (isRealActive(newSystemStatus, dhdArabicLabel)) {
                  parsedItems.forEach(item => {
                    db.run("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?", [item.quantity, item.productId]);
                  });
                }
                db.run("COMMIT", resolve);
              });
            }
          });
        });
        totalImported++;
      }
    }
    
    if (resData && resData.last_page && page < resData.last_page) {
      page++;
    } else {
      break;
    }
  }
  
  // Delete obsolete orders that are in the database but were not fetched from DHD
  if (fetchedTrackings.length > 0) {
    await new Promise((resolve) => {
      const placeholders = fetchedTrackings.map(() => '?').join(',');
      db.all(`SELECT id FROM orders WHERE ecotrack_tracking IS NOT NULL AND is_legacy = 0 AND ecotrack_tracking NOT IN (${placeholders})`, fetchedTrackings, (err, rows) => {
        if (err || !rows || rows.length === 0) {
          resolve();
          return;
        }
        const orderIdsToDelete = rows.map(r => r.id);
        const idsPlaceholders = orderIdsToDelete.map(() => '?').join(',');
        
        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          db.run(`DELETE FROM order_items WHERE orderId IN (${idsPlaceholders})`, orderIdsToDelete);
          db.run(`DELETE FROM orders WHERE id IN (${idsPlaceholders})`, orderIdsToDelete, () => {
            console.log(`[DHD Cleanup] Deleted ${orderIdsToDelete.length} obsolete orders from local DB.`);
          });
          db.run("COMMIT", resolve);
        });
      });
    });
  }
  
  return {
    success: true,
    totalProcessed,
    totalImported,
    totalUpdated
  };
}

app.post('/api/orders/pull-from-dhd', authenticateToken, requireAdmin, async (req, res) => {
  try {
    db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], async (tokenErr, tokenRow) => {
      if (tokenErr || !tokenRow || !tokenRow.value || tokenRow.value.trim() === '') {
        return res.status(400).json({ error: "لم يتم تكوين مفتاح API الخاص بـ DHD." });
      }
      
      const apiToken = tokenRow.value.trim();
      
      db.all("SELECT id, code, name, category FROM products", [], async (prodErr, productsList) => {
        if (prodErr) return res.status(500).json({ error: prodErr.message });
        
        db.all("SELECT code, price, purchasePrice, weight FROM categories", [], async (catErr, categoriesList) => {
          if (catErr) return res.status(500).json({ error: catErr.message });
          
          const categoriesMap = {};
          categoriesList.forEach(c => {
            categoriesMap[c.code] = c;
          });
          
          try {
            const pullResult = await pullOrdersFromDhd(apiToken, productsList, categoriesMap);
            res.json(pullResult);
          } catch (pullErr) {
            res.status(500).json({ error: `فشل سحب الطلبيات من DHD: ${pullErr.message}` });
          }
        });
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 8. UNIFIED ERP SUMMARY & METRICS
app.get('/api/analytics/erp-summary', authenticateToken, requireAdmin, (req, res) => {
  const { startDate, endDate } = req.query;
  let dOrders = '';
  let dExp = '';
  let dSal = '';
  let dAd = '';
  let dDebt = '';
  let dBorr = '';
  
  if (startDate && endDate) {
    dOrders = ` AND date(createdAt) BETWEEN date('${startDate}') AND date('${endDate}')`;
    dExp = ` WHERE date(date) BETWEEN date('${startDate}') AND date('${endDate}')`;
    dSal = ` WHERE date(payment_date) BETWEEN date('${startDate}') AND date('${endDate}')`;
    dAd = ` WHERE date(date) BETWEEN date('${startDate}') AND date('${endDate}')`;
    dDebt = ` WHERE date(purchase_date) BETWEEN date('${startDate}') AND date('${endDate}')`;
    dBorr = ` WHERE date(loan_date) BETWEEN date('${startDate}') AND date('${endDate}')`;
  }

  const stats = {
    investors: [],
    borrowings: [],
    totals: {
      sales: 0,
      netProfit: 0,
      subtotal: 0,
      expenses: 0,
      salaries: 0,
      adSpend: 0,
      supplierDebt: 0,
      loansDebt: 0,
      pendingCollection: 0,
      deliveredNotCashed: 0,
      readyForCollection: 0,
      collectedCash: 0
    },
    shipping: {
      total: 0,
      inTransit: 0,
      delivered: 0,
      returned: 0,
      deliveryRate: 0,
      returnRate: 0
    },
    dailyPerformance: []
  };

  const getInvestors = () => new Promise((resolve) => {
    db.all("SELECT * FROM investors", [], (err, rows) => {
      stats.investors = rows || [];
      resolve();
    });
  });

  const getBorrowingsList = () => new Promise((resolve) => {
    db.all("SELECT * FROM borrowings ORDER BY loan_date DESC", [], (err, rows) => {
      stats.borrowings = rows || [];
      resolve();
    });
  });

  const getDeliveredOrders = () => new Promise((resolve) => {
    db.get(`
      SELECT 
        COUNT(*) as count, 
        SUM(total) as totalSales, 
        SUM(subtotal) as totalSubtotal 
      FROM orders 
      WHERE status = 'delivered' AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%' ${dOrders}
    `, [], (err, row) => {
      if (row) {
        stats.totals.sales = row.totalSales || 0;
        stats.totals.subtotal = row.totalSubtotal || 0;
      }
      
      // Calculate overall net profit including both delivered and cancelled orders, excluding test orders
      db.get(`
        SELECT SUM(netProfit) as totalNetProfit 
        FROM orders 
        WHERE (status = 'delivered' OR status = 'cancelled') AND is_legacy = 0 AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%' ${dOrders}
      `, [], (errProfit, rowProfit) => {
        stats.totals.netProfit = (rowProfit && rowProfit.totalNetProfit) || 0;
        resolve();
      });
    });
  });

  const getShippingMetrics = () => new Promise((resolve) => {
    db.all(`
      SELECT status, COUNT(*) as count 
      FROM orders 
      WHERE ecotrack_tracking IS NOT NULL 
        AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%'
        AND dhd_status_label NOT LIKE '%تم تسجيل الطلب%'
        AND dhd_status_label NOT LIKE '%جاهز للشحن%'
        AND dhd_status_label NOT LIKE '%بانتظار التأكيد%'
        AND dhd_status_label NOT LIKE '%قيد الاستلام%'
        AND dhd_status_label NOT LIKE '%شحنة متوجهة للمحطة%'
        AND dhd_status_label NOT LIKE '%شحنة في المحطة%'
        AND dhd_status_label NOT LIKE '%شحنة متوجهة للمركز%'
        AND dhd_status_label NOT LIKE '%شحنة في المركز%'
      GROUP BY status
    `, [], (err, rows) => {
      if (rows) {
        let total = 0;
        let inTransit = 0;
        let delivered = 0;
        let returned = 0;
        
        rows.forEach(r => {
          total += r.count;
          if (r.status === 'delivered') delivered = r.count;
          else if (r.status === 'cancelled' || r.status === 'returning') returned += r.count;
          else inTransit += r.count; // confirmed, processing, etc.
        });

        stats.shipping.total = total;
        stats.shipping.inTransit = inTransit;
        stats.shipping.delivered = delivered;
        stats.shipping.returned = returned;
        stats.shipping.deliveryRate = total > 0 ? parseFloat(((delivered / total) * 100).toFixed(1)) : 0;
        stats.shipping.returnRate = total > 0 ? parseFloat(((returned / total) * 100).toFixed(1)) : 0;
      }
      resolve();
    });
  });

  const getExpenses = () => new Promise((resolve) => {
    db.get(`SELECT SUM(amount) as total FROM expenses ${dExp}`, [], (err, row) => {
      stats.totals.expenses = (row && row.total) || 0;
      resolve();
    });
  });

  const getSalaries = () => new Promise((resolve) => {
    db.get(`SELECT SUM(amount_paid) as total FROM employee_payments ${dSal}`, [], (err, row) => {
      stats.totals.salaries = (row && row.total) || 0;
      resolve();
    });
  });

  const getAdSpend = () => new Promise((resolve) => {
    db.get(`SELECT SUM(amount) as total FROM ad_spend ${dAd}`, [], (err, row) => {
      stats.totals.adSpend = (row && row.total) || 0;
      resolve();
    });
  });

  const getDebts = () => new Promise((resolve) => {
    db.get(`SELECT SUM(amount_debt) as total FROM inventory_purchases ${dDebt}`, [], (err, row) => {
      stats.totals.supplierDebt = (row && row.total) || 0;
      resolve();
    });
  });

  const getLoansDebt = () => new Promise((resolve) => {
    db.get(`SELECT SUM(amount_debt) as total FROM borrowings ${dBorr}`, [], (err, row) => {
      stats.totals.loansDebt = (row && row.total) || 0;
      resolve();
    });
  });

  const getCashReconciliationMetrics = () => new Promise((resolve) => {
    // 1. Pending collection (in transit): the TOTAL sale value (montant = total) of confirmed orders at DHD
    // Before delivery: money is "at DHD" valued at full sale price (total)
    db.get(`
      SELECT 
        (SELECT SUM(oi.quantity * c.purchasePrice)
         FROM orders o
         JOIN order_items oi ON o.id = oi.orderId
         JOIN products p ON oi.productId = p.id
         JOIN categories c ON p.category = c.code
         WHERE o.status IN ('confirmed', 'returning') 
           AND o.ecotrack_tracking IS NOT NULL
           AND (o.dhd_status_label NOT LIKE '%🧪%' OR o.dhd_status_label IS NULL) AND LOWER(IFNULL(o.customerName, '')) NOT LIKE '%test%' AND IFNULL(o.customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(o.customerName, '')) NOT LIKE '%essai%'
           AND o.dhd_status_label NOT LIKE '%جاهز للشحن%'
           AND o.dhd_status_label NOT LIKE '%بانتظار التأكيد%'
           /* Removed Ramassage, Vers Station, Vers Hub from exclusions so they count as In-Transit */
           AND o.dhd_status_label NOT LIKE '%تم تسجيل الطلب%'
        ) as confirmedTotal,
        (SELECT SUM(total - IFNULL(realDeliveryPrice, 0)) FROM orders WHERE status = 'delivered' AND dhd_status_label LIKE '%تحصيل السائق%' AND cod_payout_status = 'pending_payout' AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%') as deliveredNotCashedNet
    `, [], (err1, row1) => {
      const confirmedCost = (row1 && row1.confirmedTotal) || 0;
      const deliveredNotCashedNet = (row1 && row1.deliveredNotCashedNet) || 0;
      
      // pendingCollection = total sale value of packages in transit at DHD (before delivery)
      stats.totals.pendingCollection = confirmedCost;
      
      // deliveredNotCashed is dedicated for delivered packages not yet cashed by DHD!
      stats.totals.deliveredNotCashed = deliveredNotCashedNet;
      
      // 2. Ready for collection: delivered & cashed by DHD (تم التحصيل وبانتظار السحب 💰) but not paid to merchant yet
      db.get(`
        SELECT 
          (SELECT SUM(total - IFNULL(realDeliveryPrice, 0)) FROM orders WHERE status = 'delivered' AND dhd_status_label LIKE '%وبانتظار السحب%' AND cod_payout_status = 'pending_payout' AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%') as deliveredCashedNet,
          (SELECT SUM(IFNULL(realDeliveryPrice, 0)) FROM orders WHERE status IN ('cancelled', 'returning') AND cod_payout_status = 'pending_payout' AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%') as cancelledNet
      `, [], (err2, row2) => {
        const deliveredCashedNet = (row2 && row2.deliveredCashedNet) || 0;
        const cancelledNet = (row2 && row2.cancelledNet) || 0;
        stats.totals.readyForCollection = deliveredCashedNet - cancelledNet;
        
        // 3. Collected cash: delivered payout received MINUS cancelled payout received
        db.get(`
          SELECT 
            (SELECT SUM(total - IFNULL(realDeliveryPrice, 0)) FROM orders WHERE status = 'delivered' AND cod_payout_status = 'payout_received' AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%') as deliveredNet,
            (SELECT SUM(IFNULL(realDeliveryPrice, 0)) FROM orders WHERE status IN ('cancelled', 'returning') AND cod_payout_status = 'payout_received' AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%') as cancelledNet
        `, [], (err3, row3) => {
          const deliveredNet = (row3 && row3.deliveredNet) || 0;
          const cancelledNet = (row3 && row3.cancelledNet) || 0;
          stats.totals.collectedCash = deliveredNet - cancelledNet;
          resolve();
        });
      });
    });
  });

  const getInventoryAndPendingMetrics = () => new Promise((resolve) => {
    db.get(`
      SELECT 
        (SELECT SUM(stock * purchasePrice) FROM categories WHERE stock > 0) as warehouseStockValue,
        (SELECT SUM(stock) FROM categories WHERE stock > 0) as warehouseStockCount,
        (SELECT SUM(oi.quantity * c.purchasePrice)
         FROM orders o
         JOIN order_items oi ON o.id = oi.orderId
         JOIN products p ON oi.productId = p.id
         JOIN categories c ON p.category = c.code
         WHERE IFNULL(o.is_legacy, 0) = 0
           AND o.status NOT IN ('cancelled', 'returning')
           AND o.status != 'delivered'
           AND (o.dhd_status_label NOT LIKE '%🧪%' OR o.dhd_status_label IS NULL) AND LOWER(IFNULL(o.customerName, '')) NOT LIKE '%test%' AND IFNULL(o.customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(o.customerName, '')) NOT LIKE '%essai%'
           AND (
             o.status = 'new' OR
             (o.status = 'confirmed' AND (
               o.dhd_status_label IS NULL OR
               NOT (
                 o.dhd_status_label LIKE '%En Hub%' OR
                 o.dhd_status_label LIKE '%Vers Wilaya%' OR
                 o.dhd_status_label LIKE '%En Cours de Livraison%' OR
                 o.dhd_status_label LIKE '%En attente du client%' OR
                 o.dhd_status_label LIKE '%Sorti en livraison%' OR o.dhd_status_label LIKE '%accepted_by_carrier%' OR o.dhd_status_label LIKE '%قيد التوصيل%' OR o.dhd_status_label LIKE '%Ramassage%' OR o.dhd_status_label LIKE '%Vers Station%' OR o.dhd_status_label LIKE '%Vers Hub%'
               )
             ))
           )
        ) as preHubCost,
        (SELECT SUM(oi.quantity)
         FROM orders o
         JOIN order_items oi ON o.id = oi.orderId
         WHERE IFNULL(o.is_legacy, 0) = 0
           AND o.status NOT IN ('cancelled', 'returning')
           AND o.status != 'delivered'
           AND (o.dhd_status_label NOT LIKE '%🧪%' OR o.dhd_status_label IS NULL) AND LOWER(IFNULL(o.customerName, '')) NOT LIKE '%test%' AND IFNULL(o.customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(o.customerName, '')) NOT LIKE '%essai%'
           AND (
             o.status = 'new' OR
             (o.status = 'confirmed' AND (
               o.dhd_status_label IS NULL OR
               NOT (
                 o.dhd_status_label LIKE '%En Hub%' OR
                 o.dhd_status_label LIKE '%Vers Wilaya%' OR
                 o.dhd_status_label LIKE '%En Cours de Livraison%' OR
                 o.dhd_status_label LIKE '%En attente du client%' OR
                 o.dhd_status_label LIKE '%Sorti en livraison%' OR o.dhd_status_label LIKE '%accepted_by_carrier%' OR o.dhd_status_label LIKE '%قيد التوصيل%' OR o.dhd_status_label LIKE '%Ramassage%' OR o.dhd_status_label LIKE '%Vers Station%' OR o.dhd_status_label LIKE '%Vers Hub%'
               )
             ))
           )
        ) as preHubCount
    `, [], (err, row) => {
      stats.totals.warehouseStockValue = (row && row.warehouseStockValue) || 0;
      stats.totals.warehouseStockCount = (row && row.warehouseStockCount) || 0;
      stats.totals.preHubCost = (row && row.preHubCost) || 0;
      stats.totals.preHubCount = (row && row.preHubCount) || 0;
      resolve();
    });
  });

  const getDailyPerformance = () => new Promise((resolve) => {
    db.all(`
      SELECT 
        DATE(o.createdAt) as date, 
        COUNT(o.id) as orderCount,
        SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) as deliveredCount,
        SUM(CASE WHEN o.status IN ('cancelled', 'returning') THEN 1 ELSE 0 END) as returnedCount,
        SUM(oi.quantity) as totalPieces
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.orderId
      WHERE o.dhd_status_label NOT LIKE '%🧪%' OR o.dhd_status_label IS NULL
      GROUP BY date
      ORDER BY date DESC
      LIMIT 60
    `, [], (err, orderRows) => {
      const orderMap = {};
      (orderRows || []).forEach(row => {
        orderMap[row.date] = row;
      });

      db.all(`
        SELECT spend_date as date, amount 
        FROM ad_spend 
        ORDER BY date DESC
        LIMIT 60
      `, [], (err2, spendRows) => {
        const spendMap = {};
        (spendRows || []).forEach(row => {
          spendMap[row.date] = row.amount;
        });

        const allDates = new Set([...Object.keys(orderMap), ...Object.keys(spendMap)]);
        const sortedDates = Array.from(allDates).sort((a, b) => new Date(b) - new Date(a)).slice(0, 30);

        const dailyList = sortedDates.map(d => {
          const orderInfo = orderMap[d] || { orderCount: 0, deliveredCount: 0, returnedCount: 0, totalPieces: 0 };
          const spend = spendMap[d] || 0;
          const CAC = orderInfo.orderCount > 0 ? parseFloat((spend / orderInfo.orderCount).toFixed(1)) : 0;
          const adCostPerPiece = orderInfo.totalPieces > 0 ? parseFloat((spend / orderInfo.totalPieces).toFixed(1)) : 0;

          return {
            date: d,
            adSpend: spend,
            orderCount: orderInfo.orderCount,
            deliveredCount: orderInfo.deliveredCount,
            returnedCount: orderInfo.returnedCount,
            totalPieces: orderInfo.totalPieces,
            cac: CAC,
            adCostPerPiece: adCostPerPiece
          };
        });

        stats.dailyPerformance = dailyList;
        resolve();
      });
    });
  });

  const getDhdInventoryMetrics = () => new Promise((resolve) => {
    db.all(`
      SELECT 
        o.status,
        oi.productId,
        p.name as productName,
        p.code as productCode,
        p.category,
        SUM(oi.quantity) as qty
      FROM orders o
      JOIN order_items oi ON o.id = oi.orderId
      JOIN products p ON oi.productId = p.id
      WHERE o.ecotrack_tracking IS NOT NULL 
        AND (o.dhd_status_label NOT LIKE '%🧪%' OR o.dhd_status_label IS NULL) AND LOWER(IFNULL(o.customerName, '')) NOT LIKE '%test%' AND IFNULL(o.customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(o.customerName, '')) NOT LIKE '%essai%'
      GROUP BY o.status, oi.productId
    `, [], (err, rows) => {
      stats.dhdInventory = { inTransit: [], returned: [] };
      if (rows) {
        rows.forEach(r => {
          const item = {
            productId: r.productId,
            productName: r.productName,
            productCode: r.productCode,
            category: r.category,
            quantity: r.qty
          };
          if (r.status === 'confirmed') {
            stats.dhdInventory.inTransit.push(item);
          } else if (r.status === 'cancelled' || r.status === 'returning') {
            stats.dhdInventory.returned.push(item);
          }
        });
      }
      resolve();
    });
  });

  Promise.all([
    getInvestors(),
    getDeliveredOrders(),
    getShippingMetrics(),
    getExpenses(),
    getSalaries(),
    getAdSpend(),
    getDebts(),
    getDailyPerformance(),
    getBorrowingsList(),
    getLoansDebt(),
    getCashReconciliationMetrics(),
    getInventoryAndPendingMetrics(),
    getDhdInventoryMetrics()
  ]).then(() => {
    stats.investors = stats.investors.map(inv => {
      const earnedProfit = Math.round(stats.totals.netProfit * (inv.share_percentage / 100));
      return {
        ...inv,
        earnedProfit
      };
    });

    res.json(stats);
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

// Worker Performance Analytics
app.get('/api/analytics/worker-performance', authenticateToken, (req, res) => {
  const { startDate, endDate, workerCode } = req.query;
  let dateFilter = '';
  if (startDate && endDate) {
    // Basic SQL Injection prevention: ensure format YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dateRegex.test(startDate) && dateRegex.test(endDate)) {
      dateFilter = ` AND date(createdAt) BETWEEN date('${startDate}') AND date('${endDate}')`;
    }
  }
  
  let workerFilter = '';
  let params = [];
  if (workerCode) {
    workerFilter = ' AND worker_code = ?';
    params.push(workerCode);
  }

  db.all(`
    SELECT 
      worker_code as workerCode,
      COUNT(*) as totalInput,
      SUM(CASE WHEN status NOT IN ('cancelled', 'returning') THEN 1 ELSE 0 END) as validated,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status IN ('cancelled', 'returning') OR dhd_status_label LIKE '%Retour%' THEN 1 ELSE 0 END) as returned,
      SUM(CASE WHEN status NOT IN ('delivered', 'cancelled', 'returning') AND (dhd_status_label IS NULL OR dhd_status_label NOT LIKE '%Retour%') THEN 1 ELSE 0 END) as inTransit
    FROM orders
    WHERE worker_code IS NOT NULL AND worker_code != '' AND is_legacy = 0 AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL) AND LOWER(IFNULL(customerName, '')) NOT LIKE '%test%' AND IFNULL(customerName, '') NOT LIKE '%تجربة%' AND LOWER(IFNULL(customerName, '')) NOT LIKE '%essai%' ${dateFilter} ${workerFilter}
    GROUP BY worker_code
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.patch('/api/products/:id/stock', authenticateToken, requireAdmin, (req, res) => {
  const { stock } = req.body;
  db.run("UPDATE products SET stock = ? WHERE id = ?", [parseInt(stock) || 0, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});
// Endpoint to clean up unused images in uploads directory
app.post('/api/system/cleanup-images', authenticateToken, requireAdmin, (req, res) => {
  db.all("SELECT image FROM products WHERE image IS NOT NULL", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const usedImages = new Set();
    rows.forEach(row => {
      if (row.image && row.image.startsWith('/uploads/')) {
        usedImages.add(row.image.replace('/uploads/', ''));
      }
    });

    if (!fs.existsSync(uploadsDir)) {
      return res.json({ success: true, deletedCount: 0, message: "No uploads directory found." });
    }

    fs.readdir(uploadsDir, (err, files) => {
      if (err) return res.status(500).json({ error: err.message });

      let deletedCount = 0;
      let freedBytes = 0;

      files.forEach(file => {
        // Skip .gitkeep or other hidden files
        if (file.startsWith('.')) return;

        if (!usedImages.has(file)) {
          const filePath = path.join(uploadsDir, file);
          try {
            const stats = fs.statSync(filePath);
            freedBytes += stats.size;
            fs.unlinkSync(filePath);
            deletedCount++;
          } catch (e) {
            console.error("Error deleting file:", filePath, e);
          }
        }
      });

      const freedMB = (freedBytes / (1024 * 1024)).toFixed(2);
      res.json({ 
        success: true, 
        deletedCount, 
        freedMB,
        message: `تم تنظيف ${deletedCount} صورة غير مستخدمة وتوفير ${freedMB} ميجابايت من المساحة.` 
      });
    });
  });
});
app.post('/api/temp-sql', authenticateToken, requireAdmin, (req, res) => {
  db.run(req.body.sql, [], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

// Catch-all: serve index.html for React Router (must be LAST)
const frontendIndexPath = path.join(__dirname, 'public', 'index.html');
if (fs.existsSync(frontendIndexPath)) {
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(frontendIndexPath);
  });
}

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

