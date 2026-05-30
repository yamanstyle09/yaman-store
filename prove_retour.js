const https = require('https');
const API_TOKEN = "iDIVtr8bD0aeTQawT18uY92vJYXMrNhCV3YJWw8nOHEowh8sIndRf5Lgzo2q";

const urlPath = `/api/v1/get/orders?page=1&api_token=${API_TOKEN}&start_date=2024-01-01&end_date=2030-12-31`;

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
    try {
      const parsed = JSON.parse(data).data || [];
      const order = parsed.find(o => o.tracking === 'DHDWUGO26052413773576' || o.status.includes('retour'));
      if (order) {
        console.log("Found order tracking:", order.tracking);
        console.log("Raw JSON properties related to fees:");
        console.log(`montant: ${order.montant}`);
        console.log(`tarif_prestation: ${order.tarif_prestation}`);
        console.log(`tarif_retour: ${order.tarif_retour}`);
      } else {
        console.log("Order not found on page 1, but we already confirmed this earlier.");
      }
    } catch (e) {}
  });
});
req.end();
