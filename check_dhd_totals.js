const https = require('https');
const API_TOKEN = "iDIVtr8bD0aeTQawT18uY92vJYXMrNhCV3YJWw8nOHEowh8sIndRf5Lgzo2q";

function fetchPage(page) {
  return new Promise((resolve) => {
    const urlPath = `/api/v1/get/orders?page=${page}&api_token=${API_TOKEN}&start_date=2024-01-01&end_date=2030-12-31`;
    const options = {
      hostname: 'platform.dhd-dz.com',
      port: 443,
      path: urlPath,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).data || []); } catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function run() {
  console.log("Fetching orders from DHD...");
  let totalLivreNonEncaisse = 0;
  let totalEncaisseNonPaye = 0;
  
  for (let page = 1; page <= 15; page++) {
    const pageOrders = await fetchPage(page);
    if (!pageOrders || pageOrders.length === 0) break;
    
    for (const o of pageOrders) {
      if (o.tracking && o.tracking.startsWith('DHDWUGO2602019')) continue; // skip old test trackings
      if (o.tracking && o.tracking.startsWith('DHDWUGO250')) continue; // skip old test trackings
      
      const montant = parseInt(o.montant) || 0;
      const prest = parseInt(o.tarif_prestation || o.delivery_price) || 0;
      const net = montant - prest;
      
      if (o.status === 'livré_non_encaissé') {
        totalLivreNonEncaisse += net;
      } else if (o.status === 'encaissé_non_payé') {
        totalEncaisseNonPaye += net;
      }
    }
  }
  
  console.log(`DHD Total 'livré_non_encaissé' (With Driver): ${totalLivreNonEncaisse} DA`);
  console.log(`DHD Total 'encaissé_non_payé' (Ready for Payout): ${totalEncaisseNonPaye} DA`);
}

run();
