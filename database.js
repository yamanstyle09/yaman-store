const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';
const dataDir = isProd ? path.join(__dirname, 'data') : __dirname;
if (isProd && !fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.resolve(dataDir, 'store.db');
const db = new sqlite3.Database(dbPath);

// Enable WAL journal mode immediately
db.serialize(() => {
  db.run("PRAGMA journal_mode=WAL;", (err) => {
    if (err) console.error("Error setting journal_mode to WAL:", err.message);
    else console.log("SQLite journal mode set to WAL successfully.");
  });
});

const initDb = () => {
  db.serialize(() => {
    // Categories/Variants
    db.run(`CREATE TABLE IF NOT EXISTS categories (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      purchasePrice INTEGER DEFAULT 0,
      stock INTEGER DEFAULT 50,
      features TEXT,
      weight REAL DEFAULT 1.45,
      image TEXT
    )`, () => {
      // Safe migration check to add purchasePrice if it doesn't exist
      db.run("ALTER TABLE categories ADD COLUMN purchasePrice INTEGER DEFAULT 0", [], (err) => {
        if (!err) console.log("Added purchasePrice column to categories.");
      });
      // Safe migration check to add stock if it doesn't exist
      db.run("ALTER TABLE categories ADD COLUMN stock INTEGER DEFAULT 50", [], (err) => {
        // Safe to ignore if column already exists
      });
      // Migration for weight
      db.run("ALTER TABLE categories ADD COLUMN weight REAL DEFAULT 1.45", [], (err) => {
        if (!err) console.log("Added weight column to categories.");
      });
      // Migration for image
      db.run("ALTER TABLE categories ADD COLUMN image TEXT", [], (err) => {
        if (!err) console.log("Added image column to categories.");
      });
      // Safe migration: add weight column (kg per unit) with default 1.45 kg
      db.run("ALTER TABLE categories ADD COLUMN weight REAL DEFAULT 1.45", [], (err) => {
        // Safe to ignore if column already exists
      });
      // Retroactively ensure all categories have stock and purchasePrice (no NULLs)
      db.run("UPDATE categories SET stock = 50 WHERE stock IS NULL OR stock = ''");
      db.run("UPDATE categories SET purchasePrice = 0 WHERE purchasePrice IS NULL");
      // Retroactively set weight to 1.45 kg for all categories that have no weight set
      db.run("UPDATE categories SET weight = 1.45 WHERE weight IS NULL OR weight = 0");
    });

    // Products
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      image TEXT NOT NULL,
      FOREIGN KEY (category) REFERENCES categories(code)
    )`, () => {
      db.run("ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0", [], (err) => {
        // Safe to ignore if column already exists
      });
      // Retroactively ensure all products have at least some default stock if null
      db.run("UPDATE products SET stock = 0 WHERE stock IS NULL");
    });

    // Wilayas
    db.run(`CREATE TABLE IF NOT EXISTS wilayas (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      deliveryPrice INTEGER NOT NULL
    )`, () => {
      // Seeder to populate all 58 Algerian wilayas from local JSON files
      db.get("SELECT COUNT(*) as count FROM wilayas", [], (err, row) => {
        if (err || !row || row.count < 40) {
          console.log("Seeding all 58 Algerian wilayas from local JSON files...");
          try {
            const wilayasJsonPath = path.resolve(__dirname, '..', 'dhd_wilayas.json');
            const feesJsonPath = path.resolve(__dirname, '..', 'dhd_fees.json');
            
            if (fs.existsSync(wilayasJsonPath)) {
              const wilayasData = JSON.parse(fs.readFileSync(wilayasJsonPath, 'utf8'));
              
              let feesMap = {};
              if (fs.existsSync(feesJsonPath)) {
                const feesJson = JSON.parse(fs.readFileSync(feesJsonPath, 'utf8'));
                if (feesJson.livraison) {
                  feesJson.livraison.forEach(item => {
                    feesMap[parseInt(item.wilaya_id)] = parseInt(item.tarif) || 600;
                  });
                }
              }
              
              db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stmt = db.prepare("INSERT OR REPLACE INTO wilayas (id, name, deliveryPrice) VALUES (?, ?, ?)");
                
                wilayasData.forEach(w => {
                  const id = parseInt(w.wilaya_id);
                  const name = w.wilaya_name.trim();
                  const deliveryPrice = feesMap[id] || 600;
                  stmt.run([id, name, deliveryPrice]);
                });
                
                stmt.finalize();
                db.run("COMMIT", (commitErr) => {
                  if (commitErr) console.error("Error committing wilayas seed transaction:", commitErr);
                  else console.log("Wilayas table populated successfully with 58 records!");
                });
              });
            }
          } catch (seederErr) {
            console.error("Wilayas seeder failed:", seederErr);
          }
        }
      });
    });

    // Communes Table
    db.run(`CREATE TABLE IF NOT EXISTS communes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wilayaId INTEGER NOT NULL,
      wilayaName TEXT NOT NULL,
      communeName TEXT NOT NULL,
      hasStopDesk INTEGER NOT NULL,
      appliedHomeFee INTEGER NOT NULL,
      appliedDeskFee INTEGER NOT NULL,
      realHomeFee INTEGER NOT NULL,
      realDeskFee INTEGER NOT NULL
    )`, () => {
      // Seeder for Communes
      db.get("SELECT COUNT(*) as count FROM communes", [], (err, row) => {
        // If the table is empty or only partially seeded (e.g. less than 1000 records)
        if (err || !row || row.count < 1000) {
          console.log("Seeding all communes from dhd_all_communes.json & dhd_wilayas.json...");
          try {
            const wilayasJsonPath = path.resolve(__dirname, '..', 'dhd_wilayas.json');
            const communesJsonPath = path.resolve(__dirname, '..', 'dhd_all_communes.json');
            const feesJsonPath = path.resolve(__dirname, '..', 'dhd_fees.json');
            
            if (fs.existsSync(wilayasJsonPath) && fs.existsSync(communesJsonPath)) {
              const wilayasData = JSON.parse(fs.readFileSync(wilayasJsonPath, 'utf8'));
              const communesData = JSON.parse(fs.readFileSync(communesJsonPath, 'utf8'));
              
              // Map Wilaya ID -> Wilaya Name
              const wilayaNamesMap = {};
              wilayasData.forEach(w => {
                wilayaNamesMap[parseInt(w.wilaya_id)] = w.wilaya_name.trim();
              });
              
              // Load fees maps for applied and real delivery prices
              let feesMap = {};
              if (fs.existsSync(feesJsonPath)) {
                const feesJson = JSON.parse(fs.readFileSync(feesJsonPath, 'utf8'));
                if (feesJson.livraison) {
                  feesJson.livraison.forEach(item => {
                    feesMap[parseInt(item.wilaya_id)] = {
                      home: parseInt(item.tarif) || 600,
                      desk: parseInt(item.tarif_stopdesk) || 400
                    };
                  });
                }
              }
              
              // Clear old incomplete communes table
              db.run("DELETE FROM communes", [], () => {
                db.serialize(() => {
                  db.run("BEGIN TRANSACTION");
                  const stmt = db.prepare(`
                    INSERT INTO communes (wilayaId, wilayaName, communeName, hasStopDesk, appliedHomeFee, appliedDeskFee, realHomeFee, realDeskFee)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  `);
                  
                  communesData.forEach(c => {
                    const wilayaId = parseInt(c.wilaya_id);
                    const wilayaName = wilayaNamesMap[wilayaId] || `Wilaya ${wilayaId}`;
                    const communeName = c.nom.trim();
                    const hasStopDesk = c.has_stop_desk ? 1 : 0;
                    
                    // Fees mapping
                    const fees = feesMap[wilayaId] || { home: 650, desk: 400 };
                    
                    // Let's set standard applied fees equal to real delivery fees
                    const appliedHomeFee = fees.home;
                    const appliedDeskFee = fees.desk;
                    const realHomeFee = fees.home;
                    const realDeskFee = fees.desk;
                    
                    stmt.run([
                      wilayaId,
                      wilayaName,
                      communeName,
                      hasStopDesk,
                      appliedHomeFee,
                      appliedDeskFee,
                      realHomeFee,
                      realDeskFee
                    ]);
                  });
                  
                  stmt.finalize();
                  db.run("COMMIT", (commitErr) => {
                    if (commitErr) console.error("Error committing communes seed transaction:", commitErr);
                    else console.log(`Communes table seeded successfully with ${communesData.length} records!`);
                  });
                });
              });
            } else {
              console.warn("Seeding bypassed: dhd_wilayas.json or dhd_all_communes.json not found.");
            }
          } catch (seederErr) {
            console.error("Communes seeder failed:", seederErr);
          }
        }
      });
    });

    // Orders
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerName TEXT NOT NULL,
      phone TEXT NOT NULL,
      wilayaId INTEGER NOT NULL,
      address TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      deliveryPrice INTEGER NOT NULL,
      total INTEGER NOT NULL,
      status TEXT DEFAULT 'new',
      month_year TEXT,
      monthly_sequence INTEGER DEFAULT 0,
      worker_code TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
      // Safe migrations for orders table
      db.all("PRAGMA table_info(orders)", (err, columns) => {
        if (err) return;
        const colNames = columns.map(c => c.name);
        
        if (!colNames.includes('month_year')) {
          db.run("ALTER TABLE orders ADD COLUMN month_year TEXT", () => {
            const currentMonthYear = new Date().toISOString().substring(0, 7); // YYYY-MM
            db.run(`UPDATE orders SET month_year = ?`, [currentMonthYear]);
          });
          console.log("Migration: Added month_year to orders");
        }
        
        if (!colNames.includes('monthly_sequence')) {
          db.run("ALTER TABLE orders ADD COLUMN monthly_sequence INTEGER DEFAULT 0", () => {
            // Give all legacy orders a fake sequence based on ID
            db.run(`UPDATE orders SET monthly_sequence = id`);
          });
          console.log("Migration: Added monthly_sequence to orders");
        }
        
        if (!colNames.includes('worker_code')) {
          db.run("ALTER TABLE orders ADD COLUMN worker_code TEXT", () => {
            console.log("Migration: Added worker_code to orders");
          });
        }
      });
      db.run("ALTER TABLE orders ADD COLUMN communeName TEXT", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN deliveryType TEXT", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN appliedDeliveryPrice INTEGER DEFAULT 0", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN realDeliveryPrice INTEGER DEFAULT 0", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN netProfit INTEGER DEFAULT 0", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN discount INTEGER DEFAULT 0", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN ecotrack_tracking TEXT", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN dhd_status_label TEXT", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN cod_payout_status TEXT DEFAULT 'pending_payout'", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN is_legacy INTEGER DEFAULT 0", [], (e) => {});
      db.run("ALTER TABLE orders ADD COLUMN is_exchange INTEGER DEFAULT 0", [], (e) => {});
      
      // Auto-Seed Variant D and products if not exist
      db.run(`INSERT OR IGNORE INTO categories (code, name, price, purchasePrice, stock, features, weight, image) 
              VALUES ('D', 'فئة D', 1900, 1500, 0, '[]', 1.45, NULL)`, [], (err) => {
        if (!err) {
          db.get("SELECT COUNT(*) as count FROM products WHERE category = 'D'", [], (err, row) => {
            if (row && row.count === 0) {
              const stmt = db.prepare(`INSERT OR IGNORE INTO products (code, category, name, image, stock) VALUES (?, 'D', ?, '', 0)`);
              for (let i = 1; i <= 200; i++) {
                const prodCode = `D-${i.toString().padStart(2, '0')}`;
                stmt.run([prodCode, prodCode]);
              }
              stmt.finalize();
              console.log("Migration: Seeded products D-01 to D-200");
            }
          });
        }
      });
      db.run("ALTER TABLE orders ADD COLUMN worker_code TEXT DEFAULT ''", [], (e) => {});
    });

    // Order Items
    db.run(`CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      productId INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      priceAtPurchase INTEGER NOT NULL,
      FOREIGN KEY (orderId) REFERENCES orders(id),
      FOREIGN KEY (productId) REFERENCES products(id)
    )`);

    // Settings Table
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`, () => {
      const defaults = {
        store_name: 'Yaman Style',
        store_subtitle: 'متجر المفروشات الأول - الدفع عند الاستلام',
        announcement_banner: '💡 يمكنك اختيار وتنسيق أكثر من موديل وبكميات مختلفة في طلبية واحدة!',
        required_fields: JSON.stringify({ name: true, phone: true, wilaya: true, address: true })
      };
      
      Object.entries(defaults).forEach(([key, val]) => {
        db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, val]);
      });
    });

    // Investors Table
    db.run(`CREATE TABLE IF NOT EXISTS investors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      share_percentage REAL NOT NULL,
      invested_capital INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Inventory Purchases Table
    db.run(`CREATE TABLE IF NOT EXISTS inventory_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_code TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_per_unit INTEGER NOT NULL,
      payment_type TEXT NOT NULL,
      amount_paid INTEGER DEFAULT 0,
      amount_debt INTEGER DEFAULT 0,
      supplier_name TEXT,
      purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Debt Payments Table
    db.run(`CREATE TABLE IF NOT EXISTS debt_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debt_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      target_name TEXT NOT NULL,
      amount_paid INTEGER NOT NULL,
      payment_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Expenses Table
    db.run(`CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      amount INTEGER NOT NULL,
      expense_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Employees Table
    db.run(`CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      salary_type TEXT NOT NULL,
      salary_rate INTEGER NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Employee Payments Table
    db.run(`CREATE TABLE IF NOT EXISTS employee_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      amount_paid INTEGER NOT NULL,
      payment_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Ad Spend Table
    db.run(`CREATE TABLE IF NOT EXISTS ad_spend (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spend_date DATE NOT NULL UNIQUE,
      amount INTEGER NOT NULL
    )`);

    // Borrowings (Loans) Table
    db.run(`CREATE TABLE IF NOT EXISTS borrowings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creditor_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      amount_paid INTEGER DEFAULT 0,
      amount_debt INTEGER DEFAULT 0,
      loan_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // System Users Table
    db.run(`CREATE TABLE IF NOT EXISTS system_users (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL
    )`, () => {
      db.run("ALTER TABLE system_users ADD COLUMN worker_code TEXT DEFAULT ''", [], (e) => {});
      db.run("ALTER TABLE system_users ADD COLUMN phone TEXT DEFAULT ''", [], (e) => {});
      db.get("SELECT COUNT(*) as count FROM system_users", [], (err, row) => {
        if (err || !row || row.count === 0) {
          console.log("Seeding default system users securely...");
          const hashPassword = (password) => {
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
            return `${salt}:${hash}`;
          };
          const stmt = db.prepare("INSERT OR REPLACE INTO system_users (email, password_hash, name, role) VALUES (?, ?, ?, ?)");
          stmt.run(['admin@yaman.com', hashPassword('123'), 'المدير العام', 'admin']);
          stmt.run(['emp@yaman.com', hashPassword('123'), 'موظف التأكيد', 'employee']);
          stmt.run(['yassine@agent.com', hashPassword('123456'), 'ياسين', 'admin']);
          stmt.finalize(() => {
            console.log("System users table seeded successfully.");
          });
        }
      });
    });
  });
};

module.exports = { db, initDb };

