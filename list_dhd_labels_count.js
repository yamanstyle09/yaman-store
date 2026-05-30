const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.all(`
  SELECT o.status, o.dhd_status_label, COUNT(o.id) as packageCount, SUM(oi.quantity) as pieceCount
  FROM orders o
  LEFT JOIN order_items oi ON o.id = oi.orderId
  GROUP BY o.status, o.dhd_status_label
`, [], (err, rows) => {
  if (err) {
    console.error(err);
    return;
  }
  
  console.log("BREAKDOWN OF ORDERS & PIECES BY STATUS LABEL:");
  rows.forEach(r => {
    console.log(`System Status: ${r.status}, Label: "${r.dhd_status_label}", Packages: ${r.packageCount}, Pieces: ${r.pieceCount}`);
  });
});
