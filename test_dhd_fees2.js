const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  const token = row.value.trim();
  let totalMontant = 0;
  let totalPrestation = 0;
  let totalRetour = 0;
  let count = 0;
  
  const fetchPage = (page) => {
    https.get(`https://platform.dhd-dz.com/api/v1/get/orders?api_token=${token}&page=${page}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.data && json.data.length > 0) {
          json.data.forEach(o => {
            if (o.status === 'encaissé_non_payé' || o.status === 'encaisse_non_paye') {
               totalMontant += (o.montant || 0);
               totalPrestation += (o.tarif_prestation || 0);
               totalRetour += (o.tarif_retour || 0);
               count++;
            }
          });
          fetchPage(page + 1);
        } else {
             console.log(`API totalMontant: ${totalMontant}`);
             console.log(`API totalPrestation: ${totalPrestation}`);
             console.log(`API totalRetour: ${totalRetour}`);
             console.log(`API Net (Montant - Prestation - Retour): ${totalMontant - totalPrestation - totalRetour}`);
             console.log(`Count: ${count}`);
        }
      });
    });
  };
  fetchPage(1);
});
