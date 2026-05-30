const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  const token = row.value.trim();
  const options = {
    hostname: 'platform.dhd-dz.com',
    port: 443,
    path: `/api/v1/get/tracking/info?tracking=DHDWUGO2508143354275`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  };

  https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => console.log(data));
  }).end();
});
