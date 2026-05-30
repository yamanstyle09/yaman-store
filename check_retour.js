const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const API_TOKEN = "iDIVtr8bD0aeTQawT18uY92vJYXMrNhCV3YJWw8nOHEowh8sIndRf5Lgzo2q";
const db = new sqlite3.Database('./store.db');

const query = `
  SELECT 
    id, ecotrack_tracking, status, dhd_status_label, cod_payout_status
  FROM orders 
  WHERE 
    cod_payout_status = 'pending_payout' 
    AND status = 'cancelled'
    AND (dhd_status_label NOT LIKE '%🧪%' OR dhd_status_label IS NULL)
`;

db.all(query, [], async (err, rows) => {
  if (err) return console.error(err);
  
  const targetTrackings = rows.map(r => r.ecotrack_tracking);
  console.log("Cancelled trackings pending payout:", targetTrackings);
  
  let totalRetour = 0;
  
  for (let page = 1; page <= 15; page++) {
    const pageOrders = await fetchPage(page);
    if (!pageOrders || pageOrders.length === 0) break;
    
    const matches = pageOrders.filter(o => targetTrackings.includes(o.tracking));
    
    for (const o of matches) {
      const retFee = parseInt(o.tarif_retour) || 0;
      totalRetour += retFee;
      console.log(`Tracking: ${o.tracking}, DHD Status: ${o.status}, Retour Fee: ${retFee}`);
    }
  }
  
  console.log(`\nTotal Return Fees from DHD: ${totalRetour}`);
});

function fetchPage(page) {
  return new Promise((resolve) => {
    const urlPath = `/api/v1/get/orders?page=${page}&api_token=${API_TOKEN}&start_date=2020-01-01&end_date=2030-12-31`;
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
