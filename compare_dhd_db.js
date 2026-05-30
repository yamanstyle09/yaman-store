const sqlite3 = require('sqlite3').verbose();
const https = require('https');

const dbPath = './store.db';
const db = new sqlite3.Database(dbPath);
const API_TOKEN = "iDIVtr8bD0aeTQawT18uY92vJYXMrNhCV3YJWw8nOHEowh8sIndRf5Lgzo2q";

function fetchPage(page) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'platform.dhd-dz.com',
      port: 443,
      path: `/api/v1/get/orders?page=${page}&api_token=${API_TOKEN}&start_date=2020-01-01&end_date=2030-12-31`,
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
  console.log("Fetching all DHD orders from API...");
  const dhdOrders = [];
  for (let page = 1; page <= 15; page++) {
    const pageOrders = await fetchPage(page);
    if (!pageOrders || pageOrders.length === 0) break;
    dhdOrders.push(...pageOrders);
  }
  
  console.log(`Fetched ${dhdOrders.length} orders from DHD API.`);
  
  // Load all local orders with tracking
  db.all("SELECT * FROM orders WHERE ecotrack_tracking IS NOT NULL", [], (err, localOrders) => {
    if (err) {
      console.error(err);
      return;
    }
    
    console.log(`Loaded ${localOrders.length} orders from local DB with tracking.\n`);
    
    const dhdMap = {};
    dhdOrders.forEach(o => {
      dhdMap[o.tracking] = o;
    });
    
    const localMap = {};
    localOrders.forEach(o => {
      localMap[o.ecotrack_tracking] = o;
    });
    
    // 1. Missing locally (In DHD but not in local DB)
    const missingLocally = [];
    dhdOrders.forEach(o => {
      if (!localMap[o.tracking]) {
        missingLocally.push(o);
      }
    });
    
    // 2. Extra locally (In local DB but not in DHD)
    const extraLocally = [];
    localOrders.forEach(o => {
      if (!dhdMap[o.ecotrack_tracking]) {
        extraLocally.push(o);
      }
    });
    
    // 3. Mismatched status or labels
    const mismatched = [];
    localOrders.forEach(local => {
      const dhd = dhdMap[local.ecotrack_tracking];
      if (dhd) {
        const dhdStatus = String(dhd.status).toLowerCase().trim();
        const localStatus = local.status;
        
        let expectedLocalStatus = 'confirmed';
        const deliveredStatuses = ['delivered', 'package_delivered', 'delivered_to_customer', 'paye', 'payé', 'payé_et_archivé', 'paye_et_archive', 'encaisse_non_paye', 'encaissé_non_payé', 'encaisse_non_paye_et_archive', 'encaissé_non_payé_et_archivé', 'livré_non_encaissé', 'livre_non_encaisse'];
        const cancelledStatuses = ['annule', 'annulé', 'returned', 'returned_to_shipper', 'retourné_a_l\'expéditeur', 'retourne_a_l\'expediteur', 'reçu_par_expéditeur', 'recu_par_expediteur', 'retourné', 'retourne', 'retour_reçu', 'retour_recu', 'retour_en_traitement'];
        
        if (deliveredStatuses.includes(dhdStatus)) {
          expectedLocalStatus = 'delivered';
        } else if (cancelledStatuses.includes(dhdStatus)) {
          expectedLocalStatus = 'cancelled';
        }
        
        const codPayoutStatus = (dhd.payment_id !== null && dhd.payment_id !== undefined && dhd.payment_id !== 0 && String(dhd.payment_id).trim() !== '') ? 'payout_received' : 'pending_payout';
        
        if (localStatus !== expectedLocalStatus || local.cod_payout_status !== codPayoutStatus) {
          mismatched.push({
            id: local.id,
            tracking: local.ecotrack_tracking,
            localStatus,
            expectedLocalStatus,
            localPayout: local.cod_payout_status,
            expectedPayout: codPayoutStatus,
            dhdStatus: dhdStatus
          });
        }
      }
    });
    
    console.log(`=== COMPARISON REPORT ===`);
    console.log(`1. Orders in DHD but missing in Local DB: ${missingLocally.length}`);
    missingLocally.slice(0, 10).forEach(o => {
      console.log(`   - Tracking: ${o.tracking}, Ref: ${o.reference}, Status: ${o.status}, Amount: ${o.montant}`);
    });
    
    console.log(`\n2. Orders in Local DB but missing in DHD (Obsolete/Invalid): ${extraLocally.length}`);
    extraLocally.slice(0, 10).forEach(o => {
      console.log(`   - ID: ${o.id}, Tracking: ${o.ecotrack_tracking}, Status: ${o.status}, Amount: ${o.total}`);
    });
    
    console.log(`\n3. Status/Payout mismatch between Local DB and DHD: ${mismatched.length}`);
    mismatched.slice(0, 20).forEach(m => {
      console.log(`   - ID: ${m.id}, Tracking: ${m.tracking}:`);
      console.log(`     * Local Status: "${m.localStatus}" vs Expected: "${m.expectedLocalStatus}" (DHD Status: "${m.dhdStatus}")`);
      console.log(`     * Local Payout: "${m.localPayout}" vs Expected: "${m.expectedPayout}"`);
    });
    
    db.close();
  });
}

run();
