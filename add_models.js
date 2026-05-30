const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'store.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log("Starting insertion of models D-01 to D-150...");
  
  db.run("BEGIN TRANSACTION");
  
  const stmt = db.prepare(`
    INSERT INTO products (code, category, name, image)
    SELECT ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM products WHERE code = ?)
  `);

  for (let i = 1; i <= 150; i++) {
    // Format suffix with leading zero for numbers under 10 (01 to 09)
    const suffix = String(i).padStart(2, '0');
    const code = `D-${suffix}`;
    const category = 'D'; // Standard category code for double beds
    const name = `موديل ${code}`;
    const image = `/uploads/d_${suffix}.png`;

    stmt.run([code, category, name, image, code]);
  }

  stmt.finalize();

  db.run("COMMIT", (err) => {
    if (err) {
      console.error("Error committing models insertion transaction:", err.message);
    } else {
      console.log("Models D-01 to D-150 successfully processed and added where missing!");
      
      // Let's count and verify total products in the database
      db.get("SELECT COUNT(*) as count FROM products", [], (countErr, row) => {
        if (countErr) {
          console.error("Error counting products:", countErr.message);
        } else {
          console.log(`Total products now in the database: ${row.count}`);
        }
        db.close();
      });
    }
  });
});
