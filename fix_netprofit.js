const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.serialize(() => {
  db.run("BEGIN TRANSACTION");
  
  db.run(`
    UPDATE orders 
    SET netProfit = -50 
    WHERE status = 'cancelled' 
      AND ecotrack_tracking LIKE 'DHD%' 
      AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)
  `, function(err) {
    if (err) {
      console.error("Error updating:", err);
      db.run("ROLLBACK");
    } else {
      console.log(`Successfully updated netProfit to -50 DA for ${this.changes} cancelled DHD orders.`);
      db.run("COMMIT");
    }
  });
});
