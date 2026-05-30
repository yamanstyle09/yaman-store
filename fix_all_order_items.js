const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('store.db');

db.serialize(() => {
  // Load products and categories maps
  db.all("SELECT id, code, name, category FROM products", [], (err1, productsList) => {
    db.all("SELECT code, price, purchasePrice, weight FROM categories", [], (err2, categoriesList) => {
      const categoriesMap = {};
      categoriesList.forEach(c => {
        categoriesMap[c.code] = c;
      });

      db.all("SELECT id, ecotrack_tracking, total, status, dhd_status_label FROM orders", [], async (err3, ordersList) => {
        console.log(`Loaded ${ordersList.length} orders to fix items...`);
        
        for (const order of ordersList) {
          // Fetch the raw products text from DHD API? No, let's fetch it from the database if we have it, or query DHD API to get the correct products string!
          // Wait, is products string already in our local database? 
          // Let's check if the products text is saved in orders table. No, the products text is not in the orders table!
          // Ah! The products text is not in the orders table.
          // So we must fetch the products text from the DHD live API for all 182 orders!
        }
      });
    });
  });
});
