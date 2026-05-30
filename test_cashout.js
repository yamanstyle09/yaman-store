const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  const token = row.value.trim();
  let totalNet = 0;
  
  const fetchPage = (page) => {
    https.get(`https://platform.dhd-dz.com/api/v1/get/orders?api_token=${token}&page=${page}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.data && json.data.length > 0) {
          json.data.forEach(o => {
            if (o.status === 'encaissé_non_payé' || o.status === 'encaisse_non_paye') {
               const m = Number(o.montant) || 0;
               const p = Number(o.tarif_prestation) || 0;
               const net = m - p;
               totalNet += net;
               console.log(`${o.tracking}: Montant ${m} - Prestation ${p} = Net ${net}`);
            }
          });
          fetchPage(page + 1);
        } else {
             console.log(`TOTAL NET of encaisse_non_paye: ${totalNet}`);
        }
      });
    });
  };
  fetchPage(1);
});
