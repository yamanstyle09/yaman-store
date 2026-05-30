const https = require('https');
const API_TOKEN = "iDIVtr8bD0aeTQawT18uY92vJYXMrNhCV3YJWw8nOHEowh8sIndRf5Lgzo2q";

const targetTrackings = [
  'DHDWUGO26052513788754',
  'DHDWUGO26052513788530',
  'DHDWUGO26052413772528',
  'DHDWUGO26052413772502',
  'DHDWUGO26052313717791',
  'DHDWUGO26052313716770',
  'DHDWUGO26052313716617',
  'DHDWUGO26052313715472',
  'DHDWUGO26052313715154',
  'DHDWUGO26052313715131'
];

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
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.data || parsed || []);
        } catch (e) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function run() {
  console.log("Fetching orders from DHD...");
  let totalDhdCalculated = 0;
  for (let page = 1; page <= 15; page++) {
    const pageOrders = await fetchPage(page);
    if (!pageOrders || pageOrders.length === 0) break;
    
    const matches = pageOrders.filter(o => targetTrackings.includes(o.tracking));
    
    for (const o of matches) {
      const montant = parseInt(o.montant) || 0;
      const prest = parseInt(o.tarif_prestation || o.delivery_price) || 0;
      const retFee = parseInt(o.tarif_retour) || 0;
      const net = montant - prest;
      totalDhdCalculated += net;
      
      console.log(`Tracking: ${o.tracking}, Status: ${o.status}, Montant: ${montant}, Prestation: ${prest}, Retour: ${retFee}, Net: ${net}, Raw DHD Montant: ${o.montant}`);
      console.log(`Raw DHD fields:`, Object.keys(o).filter(k => k.includes('tarif') || k.includes('prix') || k.includes('price') || k.includes('montant') || k.includes('fee')).map(k => `${k}: ${o[k]}`).join(', '));
    }
  }
  
  console.log(`\nCalculated Total from DHD Data: ${totalDhdCalculated}`);
}

run();
