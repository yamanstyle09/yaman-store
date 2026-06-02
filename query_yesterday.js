const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store_recovered.db', sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error(err.message);
  }
});

const query = `
  SELECT date(createdAt) as order_date, COUNT(*) as count 
  FROM orders 
  GROUP BY order_date 
  ORDER BY order_date DESC 
  LIMIT 5;
`;

db.all(query, [], (err, rows) => {
  if (err) {
    console.error("DB Error:", err);
    return;
  }
  console.log("Recent order dates:");
  console.log(rows);
});
