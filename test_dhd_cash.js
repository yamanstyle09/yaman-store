const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  const token = row.value.trim();
  let total_encaisse = 0;
  
  const fetchPage = (page) => {
    https.get(`https://platform.dhd-dz.com/api/v1/get/orders?api_token=${token}&page=${page}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.data && json.data.length > 0) {
          json.data.forEach(o => {
            if (o.status === 'encaisse_non_paye' || o.status === 'encaissé_non_payé') {
               // Let's print out what DHD considers the net value!
               // Usually, in ecotrack, price is o.price, delivery is o.delivery_price or something?
               console.log(o.tracking, "Price:", o.price, "Shipping:", o.shipping_price);
            }
          });
          if (page < 6) fetchPage(page + 1);
        }
      });
    });
  };
  fetchPage(1);
});
