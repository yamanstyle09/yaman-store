const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/Users/mac/.gemini/antigravity-ide/scratch/yaman-store-backend/store.db');
db.all("SELECT * FROM categories WHERE stock < 0", [], (err, rows) => {
  console.log(rows);
});
