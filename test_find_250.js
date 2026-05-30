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
        json.data.forEach(o => {
          if (o.status === 'encaissé_non_payé' || o.status === 'encaisse_non_paye') {
            console.log(o.tracking, ":");
            // print all keys with numbers
            for (let k in o) {
               if (typeof o[k] === 'number' || (typeof o[k] === 'string' && !isNaN(Number(o[k])))) {
                  console.log(`  ${k}: ${o[k]}`);
               }
            }
          }
        });
      }
    });
  });
});
