const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

const query = `
  SELECT 
    id, ecotrack_tracking, total, realDeliveryPrice, status, dhd_status_label, cod_payout_status
  FROM orders 
  WHERE 
    cod_payout_status = 'pending_payout' 
    AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)
    AND (
      (status = 'delivered') OR 
      (status = 'cancelled')
    )
`;

db.all(query, [], (err, rows) => {
  if (err) {
    console.error(err);
    return;
  }
  
  let deliveredTotal = 0;
  let cancelledTotal = 0;

  console.log("Orders contributing to pending payout:");
  rows.forEach(r => {
    let amt = 0;
    if (r.status === 'delivered') {
      amt = r.total - (r.realDeliveryPrice || 0);
      deliveredTotal += amt;
    } else if (r.status === 'cancelled') {
      amt = -(r.realDeliveryPrice || 0);
      cancelledTotal += amt;
    }
    console.log(`ID: ${r.id}, Tracking: ${r.ecotrack_tracking}, Status: ${r.status}, Total: ${r.total}, Delivery: ${r.realDeliveryPrice}, Label: ${r.dhd_status_label}, Contributes: ${amt}`);
  });
  
  console.log(`\nDelivered Total: ${deliveredTotal}`);
  console.log(`Cancelled Total: ${cancelledTotal}`);
  console.log(`Grand Total (Local): ${deliveredTotal + cancelledTotal}`);
});
