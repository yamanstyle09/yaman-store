const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  const token = row.value.trim();
  let countRetour = 0;
  let totalTarifPrestation = 0;
  let totalTarifRetour = 0;
  
  const fetchPage = (page) => {
    https.get(`https://platform.dhd-dz.com/api/v1/get/orders?api_token=${token}&page=${page}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.data && json.data.length > 0) {
          json.data.forEach(o => {
            if (o.status === 'retour_recu' || o.status === 'retour_reçu' || o.global_status === 'retour') {
               // DHD handles returns under certain statuses. Let's sum their fees!
               // But wait, the user said they are "pending payout". We need to check if they have payment_id = null!
               if (o.payment_id == null) {
                  countRetour++;
                  totalTarifPrestation += Number(o.tarif_prestation) || 0;
                  totalTarifRetour += Number(o.tarif_retour) || 0;
               }
            }
          });
          fetchPage(page + 1);
        } else {
             console.log(`API Returned count: ${countRetour}, Prestation: ${totalTarifPrestation}, Retour: ${totalTarifRetour}`);
        }
      });
    });
  };
  fetchPage(1);
});
