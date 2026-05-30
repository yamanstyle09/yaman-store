const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const sourceDir = '/Users/mac/Desktop/DRAPS TOUS';
const destDir = path.resolve(__dirname, 'uploads');
const dbPath = path.resolve(__dirname, 'store.db');

const db = new sqlite3.Database(dbPath);

console.log("Starting bulk image copy and matching process...");

if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`);
  process.exit(1);
}

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

fs.readdir(sourceDir, (err, files) => {
  if (err) {
    console.error("Error reading source folder:", err.message);
    process.exit(1);
  }

  const validFiles = files.filter(f => f !== '.DS_Store' && !f.startsWith('.'));
  console.log(`Found ${validFiles.length} files to copy and match.`);

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    const stmt = db.prepare("UPDATE products SET image = ? WHERE code = ?");

    let copiedCount = 0;
    let matchedCount = 0;

    validFiles.forEach(file => {
      const srcFile = path.join(sourceDir, file);
      const destFile = path.join(destDir, file);

      try {
        // Copy file
        fs.copyFileSync(srcFile, destFile);
        copiedCount++;

        // Match filename to product code
        // Get extension
        const ext = path.extname(file);
        // Get code (filename without extension, e.g. D-01)
        const code = path.basename(file, ext).trim();

        // Run db update
        const dbImagePath = `/uploads/${file}`;
        stmt.run([dbImagePath, code], function(dbErr) {
          if (dbErr) {
            console.error(`Error updating DB for code ${code}:`, dbErr.message);
          } else if (this.changes > 0) {
            matchedCount++;
          }
        });
      } catch (copyErr) {
        console.error(`Error copying file ${file}:`, copyErr.message);
      }
    });

    stmt.finalize();
    db.run("COMMIT", (commitErr) => {
      if (commitErr) {
        console.error("Error committing transaction:", commitErr.message);
      } else {
        console.log(`\n🎉 Image matching completed successfully!`);
        console.log(`- Copied files count: ${copiedCount} / ${validFiles.length}`);
        
        // Let's run a query to count how many products have their images fully populated
        db.all("SELECT COUNT(*) as count FROM products WHERE image LIKE '/uploads/D-%' OR image LIKE '/uploads/DD-%'", [], (qErr, rows) => {
          const matched = rows && rows[0] ? rows[0].count : 0;
          console.log(`- Matched and updated products in database: ${matched}`);
          db.close();
        });
      }
    });
  });
});
