const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.serialize(() => {
  db.run("BEGIN TRANSACTION");

  // Clear all orders and their items
  db.run("DELETE FROM order_items");
  db.run("DELETE FROM orders");
  db.run("DELETE FROM sqlite_sequence WHERE name='orders'");
  db.run("DELETE FROM sqlite_sequence WHERE name='order_items'");

  // Zero out all stock
  db.run("UPDATE products SET stock = 0");

  // Clear financial tables (expenses, ad_spend, employee_payments, debt_payments, borrowings, inventory_purchases)
  db.run("DELETE FROM expenses");
  db.run("DELETE FROM sqlite_sequence WHERE name='expenses'");
  db.run("DELETE FROM ad_spend");
  db.run("DELETE FROM sqlite_sequence WHERE name='ad_spend'");
  db.run("DELETE FROM employee_payments");
  db.run("DELETE FROM sqlite_sequence WHERE name='employee_payments'");
  db.run("DELETE FROM debt_payments");
  db.run("DELETE FROM sqlite_sequence WHERE name='debt_payments'");
  db.run("DELETE FROM borrowings");
  db.run("DELETE FROM sqlite_sequence WHERE name='borrowings'");
  db.run("DELETE FROM inventory_purchases");
  db.run("DELETE FROM sqlite_sequence WHERE name='inventory_purchases'");

  db.run("COMMIT", (err) => {
    if (err) {
      console.error("ERROR:", err.message);
    } else {
      console.log("✅ تم تفريغ قاعدة البيانات بالكامل بنجاح.");
      console.log("✅ تم تصفير المخزون لجميع المنتجات.");
      console.log("✅ تم حذف جميع الطلبيات والمصاريف والعمليات المالية.");
      
      // Verify
      db.get("SELECT COUNT(*) as cnt FROM orders", [], (e, r) => console.log(`Orders remaining: ${r.cnt}`));
      db.get("SELECT COUNT(*) as cnt, SUM(stock) as totalStock FROM products", [], (e, r) => console.log(`Products: ${r.cnt}, Total Stock: ${r.totalStock}`));
    }
  });
});
