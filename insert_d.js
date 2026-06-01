const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'store.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Insert Category D
  const catCode = 'D';
  const catName = 'فئة D';
  const price = 1900;
  const purchasePrice = 1500;
  const stock = 0;
  
  db.run(`INSERT OR IGNORE INTO categories (code, name, price, purchasePrice, stock, features, weight, image) 
          VALUES (?, ?, ?, ?, ?, '[]', 1.45, NULL)`, 
    [catCode, catName, price, purchasePrice, stock], 
    function(err) {
      if (err) console.error("Error inserting category:", err);
      else console.log("Category D inserted or already exists.");
  });
  
  // Insert Products D-01 to D-200
  db.run("BEGIN TRANSACTION");
  const stmt = db.prepare(`INSERT OR IGNORE INTO products (code, category, name, image, stock) VALUES (?, ?, ?, '', 0)`);
  
  for (let i = 1; i <= 200; i++) {
    const numStr = i.toString().padStart(2, '0');
    const prodCode = `D-${numStr}`;
    stmt.run([prodCode, catCode, prodCode], function(err) {
      if (err) console.error("Error inserting product", prodCode, ":", err);
    });
  }
  
  stmt.finalize();
  db.run("COMMIT", function(err) {
    if (err) console.error("Commit error:", err);
    else console.log("Products D-01 to D-200 inserted successfully.");
    db.close();
  });
});
