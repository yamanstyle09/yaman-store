const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.get(`
  SELECT 
    (SELECT SUM(total - IFNULL(realDeliveryPrice, 0)) FROM orders WHERE status = 'delivered' AND dhd_status_label LIKE '%وبانتظار السحب%' AND cod_payout_status = 'pending_payout' AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)) as deliveredCashedNet,
    (SELECT SUM(IFNULL(realDeliveryPrice, 0)) FROM orders WHERE status = 'cancelled' AND cod_payout_status = 'pending_payout' AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)) as cancelledNet
`, [], (err, row) => {
  if (err) {
    console.error(err);
    return;
  }
  
  const deliveredCashedNet = row.deliveredCashedNet || 0;
  const cancelledNet = row.cancelledNet || 0;
  const readyForCollection = deliveredCashedNet - cancelledNet;
  
  console.log("=== Dashboard Stats ===");
  console.log(`Delivered Cashed Net: ${deliveredCashedNet} DA`);
  console.log(`Cancelled Return Fees: ${cancelledNet} DA`);
  console.log(`Total Ready For Collection (Pending Payout): ${readyForCollection} DA`);
  console.log("=======================");
});
