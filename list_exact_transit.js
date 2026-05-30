const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.all(`
  SELECT 
    o.id, 
    o.ecotrack_tracking, 
    o.dhd_status_label,
    GROUP_CONCAT(p.code || ' x' || oi.quantity, ' | ') as productsList,
    SUM(oi.quantity) as pieceCount
  FROM orders o
  JOIN order_items oi ON o.id = oi.orderId
  JOIN products p ON oi.productId = p.id
  WHERE (o.dhd_status_label LIKE '%توصيل%' 
     OR o.dhd_status_label LIKE '%ولاية%' 
     OR o.dhd_status_label LIKE '%تسجيل%' 
     OR o.dhd_status_label LIKE '%المحطة%' 
     OR o.dhd_status_label LIKE '%تأجيل%'
     OR o.dhd_status_label LIKE '%توقيف%'
     OR o.dhd_status_label LIKE '%سائق%')
     AND o.status = 'confirmed'
  GROUP BY o.id
`, [], (err, rows) => {
  if (err) {
    console.error(err);
    return;
  }
  
  console.log("EXACT TRANSIT ORDERS IN DATABASE:");
  rows.forEach((r, idx) => {
    console.log(`${idx+1}. ID: ${r.id}, Tracking: ${r.ecotrack_tracking}, Label: "${r.dhd_status_label}", Products: ${r.productsList}, Pieces: ${r.pieceCount}`);
  });
  console.log("Total Pieces:", rows.reduce((s, r) => s + r.pieceCount, 0));
});
