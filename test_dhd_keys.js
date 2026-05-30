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
      if (json.data && json.data.length > 0) {
        // Find one order that is encaisse_non_paye
        const order = json.data.find(o => o.status === 'encaissé_non_payé' || o.status === 'encaisse_non_paye');
        if (order) {
           console.log("Found order:", order.tracking);
           console.log("Keys:", Object.keys(order));
           console.log("Values for amount/price fields:", 
               "montant:", order.montant, 
               "price:", order.price, 
               "tarif:", order.tarif,
               "frais:", order.frais,
               "total:", order.total
           );
        } else {
           console.log("Keys of first order:", Object.keys(json.data[0]));
        }
      }
    });
  });
});
