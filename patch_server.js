const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

// Patch 1: Filter /api/orders endpoint to only send is_legacy = 0
code = code.replace(
  'db.all("SELECT * FROM orders ORDER BY createdAt DESC", [], (err, rows) => {',
  'db.all("SELECT * FROM orders WHERE is_legacy = 0 ORDER BY createdAt DESC", [], (err, rows) => {'
);

// Patch 2: Filter ERP getDeliveredOrders to only count is_legacy = 0
code = code.replace(
  "WHERE status = 'delivered' AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)",
  "WHERE status = 'delivered' AND is_legacy = 0 AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)"
);

code = code.replace(
  "WHERE (status = 'delivered' OR status = 'cancelled') AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)",
  "WHERE (status = 'delivered' OR status = 'cancelled') AND is_legacy = 0 AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)"
);

// Patch 3: Filter getShippingMetrics to only count is_legacy = 0
code = code.replace(
  "WHERE ecotrack_tracking IS NOT NULL",
  "WHERE ecotrack_tracking IS NOT NULL AND is_legacy = 0"
);

// Save the patched code
fs.writeFileSync('server.js', code);
console.log("Patched server.js successfully.");
