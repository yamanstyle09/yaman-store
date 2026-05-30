const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.serialize(() => {
  db.run("BEGIN TRANSACTION");
  
  // Find the 7 oldest cancelled DHD orders that are still pending payout
  db.all(`
    SELECT id, ecotrack_tracking 
    FROM orders 
    WHERE status = 'cancelled' 
      AND cod_payout_status = 'pending_payout' 
      AND ecotrack_tracking LIKE 'DHD%'
      AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)
    ORDER BY id ASC
    LIMIT 7
  `, [], (err, rows) => {
    if (err) {
      console.error(err);
      db.run("ROLLBACK");
      return;
    }
    
    if (rows.length === 0) {
      console.log("No orders found to update.");
      db.run("ROLLBACK");
      return;
    }
    
    const idsToUpdate = rows.map(r => r.id);
    console.log("Marking the following oldest 7 cancelled orders as payout_received:");
    console.log(rows.map(r => r.ecotrack_tracking).join(', '));
    
    db.run(`
      UPDATE orders 
      SET cod_payout_status = 'payout_received' 
      WHERE id IN (${idsToUpdate.join(',')})
    `, function(err2) {
      if (err2) {
        console.error(err2);
        db.run("ROLLBACK");
      } else {
        console.log(`Successfully updated ${this.changes} orders.`);
        db.run("COMMIT");
      }
    });
  });
});
