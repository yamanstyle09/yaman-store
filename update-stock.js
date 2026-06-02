const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const db = new sqlite3.Database('./store.db');
const dirPath = '/Users/mac/Desktop/DRAPS JUN 01';

const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'));
const productCodes = files.map(f => f.replace(/\.(png|jpg|jpeg)$/i, ''));

console.log('Product codes:', productCodes);
console.log('Total products to update:', productCodes.length);

db.serialize(() => {
  db.get("SELECT stock FROM categories WHERE code = 'D'", (err, categoryRow) => {
    if (err) throw err;
    if (!categoryRow) {
      console.error('Category D not found!');
      process.exit(1);
    }
    const totalCategoryStock = categoryRow.stock || 0;
    
    db.get("SELECT SUM(stock) as usedStock FROM products WHERE category = 'D'", (err, usedStockRow) => {
      if (err) throw err;
      const usedStock = usedStockRow.usedStock || 0;
      const unassignedStock = totalCategoryStock - usedStock;
      
      const requiredStock = productCodes.length * 10;
      console.log('Unassigned stock:', unassignedStock);
      console.log('Required stock:', requiredStock);
      
      if (unassignedStock < requiredStock) {
        console.error('Not enough unassigned stock!');
        process.exit(1);
      }
      
      const stmt = db.prepare("UPDATE products SET stock = stock + 10 WHERE code = ?");
      productCodes.forEach(code => {
        stmt.run(code);
      });
      stmt.finalize(() => {
         console.log('Stock updated successfully.');
         db.close();
      });
    });
  });
});
