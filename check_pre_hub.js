const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'database.sqlite'); // wait, the db is 'store.sqlite' or something? Let me check

const fs = require('fs');
const files = fs.readdirSync(__dirname);
const dbFile = files.find(f => f.endsWith('.sqlite') || f.endsWith('.db')) || 'database.sqlite';
console.log("Using DB:", dbFile);

const db = new sqlite3.Database(dbFile);

db.all(`
  SELECT o.id, o.status, o.ecotrack_tracking, o.dhd_status_label, oi.quantity, c.purchasePrice, (oi.quantity * c.purchasePrice) as cost
  FROM orders o
  JOIN order_items oi ON o.id = oi.orderId
  JOIN products p ON oi.productId = p.id
  JOIN categories c ON p.category = c.code
  WHERE IFNULL(o.is_legacy, 0) = 0
    AND o.status NOT IN ('cancelled', 'returning')
    AND o.status != 'delivered'
    AND (o.dhd_status_label NOT LIKE '%🧪%' OR o.dhd_status_label IS NULL)
    AND (
      o.status = 'new' OR
      (o.status = 'confirmed' AND (
        o.dhd_status_label IS NULL OR
        NOT (
          o.dhd_status_label LIKE '%En Hub%' OR
          o.dhd_status_label LIKE '%Vers Wilaya%' OR
          o.dhd_status_label LIKE '%En Cours de Livraison%' OR
          o.dhd_status_label LIKE '%En attente du client%' OR
          o.dhd_status_label LIKE '%Sorti en livraison%' OR
          o.dhd_status_label LIKE '%accepted_by_carrier%' OR
          o.dhd_status_label LIKE '%قيد التوصيل%'
        )
      ))
    )
`, [], (err, rows) => {
  if (err) console.error(err);
  let totalCost = 0;
  rows.forEach(r => {
    totalCost += r.cost;
    console.log(\`Order \${r.id}: Status=\${r.status}, Tracking=\${r.ecotrack_tracking}, Label="\${r.dhd_status_label}", Cost=\${r.cost}\`);
  });
  console.log("Total Pre-Hub Cost:", totalCost);
  
  // Also let's check pendingCollection
  db.all(`
    SELECT o.id, o.status, o.dhd_status_label, (oi.quantity * c.purchasePrice) as cost
    FROM orders o
    JOIN order_items oi ON o.id = oi.orderId
    JOIN products p ON oi.productId = p.id
    JOIN categories c ON p.category = c.code
    WHERE o.status IN ('confirmed', 'cancelled', 'returning') 
      AND o.ecotrack_tracking IS NOT NULL
      AND (o.dhd_status_label NOT LIKE '%🧪%' OR o.dhd_status_label IS NULL)
      AND o.dhd_status_label NOT LIKE '%Prêt à expédier%'
      AND o.dhd_status_label NOT LIKE '%Ramassage%'
      AND o.dhd_status_label NOT LIKE '%Vers Station%'
      AND o.dhd_status_label NOT LIKE '%Vers Hub%'
      AND o.dhd_status_label NOT LIKE '%تم تسجيل الطلب%'
  `, [], (err2, rows2) => {
    let pendingCost = 0;
    rows2.forEach(r => pendingCost += r.cost);
    console.log("Total Pending Collection (In-Transit):", pendingCost);
  });
});
