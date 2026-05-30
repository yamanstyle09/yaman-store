const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'store.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log("Starting cleanup of communes and wilayas tables...");
  
  db.run("DELETE FROM communes", [], (err) => {
    if (err) console.error("Error clearing communes:", err.message);
    else console.log("Communes table cleared successfully.");
  });

  db.run("DELETE FROM wilayas", [], (err) => {
    if (err) console.error("Error clearing wilayas:", err.message);
    else console.log("Wilayas table cleared successfully.");
  });

  db.close((err) => {
    if (err) console.error("Error closing database:", err.message);
    else console.log("Database connection closed. Ready for fresh seeding!");
  });
});
