const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  const token = row.value.trim();
  https.get(`https://platform.dhd-dz.com/api/v1/get/orders?api_token=${token}&page=1`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const json = JSON.parse(data);
      if (json.data) {
        // Find orders with hub or station
        json.data.forEach(o => {
           console.log(`Tracking: ${o.tracking}, Status: ${o.status}, Status Reason: ${o.status_reason}`);
        });
      }
    });
  });
});
