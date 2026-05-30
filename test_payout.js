const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  const token = row.value.trim();
  const options = {
    hostname: 'platform.dhd-dz.com',
    port: 443,
    path: `/api/v1/get/orders?api_token=${token}`,
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  };

  https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      const json = JSON.parse(data);
      if (json && json.data && json.data.length > 0) {
        console.log(Object.keys(json.data[0])); // Print keys to see if there's a net_payout field
        // Find one of the delivered ones
        const delivered = json.data.find(o => o.tracking === 'DHDWUGO26052513788754');
        console.log("Delivered order fields:");
        console.log("price:", delivered.price);
        console.log("shipping_price:", delivered.shipping_price);
        console.log("montant:", delivered.montant); // Usually this is what DHD collected
        console.log(delivered);
      }
    });
  }).end();
});
