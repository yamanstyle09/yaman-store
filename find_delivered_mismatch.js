const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.all(`
  SELECT id, ecotrack_tracking, total, deliveryPrice, realDeliveryPrice, (realDeliveryPrice - deliveryPrice) as overweight
  FROM orders
  WHERE status = 'delivered' AND dhd_status_label LIKE '%تحصيل السائق%' AND cod_payout_status = 'pending_payout'
`, [], (err, rows) => {
  if (err) {
    console.error(err);
    return;
  }
  
  console.log("Checking overweight fees for delivered orders pending collection:");
  rows.forEach(r => {
    if (r.overweight !== 0) {
      console.log(`ORDER ID: ${r.id}, Tracking: ${r.ecotrack_tracking}`);
      console.log(`  Total: ${r.total}`);
      console.log(`  DHD Base Delivery (deliveryPrice): ${r.deliveryPrice}`);
      console.log(`  Calculated Real Delivery: ${r.realDeliveryPrice}`);
      console.log(`  Overweight Fee Added: ${r.overweight}`);
    }
  });
});
