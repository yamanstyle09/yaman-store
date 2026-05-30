const sqlite3 = require('sqlite3').verbose();
const https = require('https');

const dbPath = './store.db';
const db = new sqlite3.Database(dbPath);

db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  if (err || !row || !row.value) {
    console.error("No API token found!");
    process.exit(1);
  }
  
  const token = row.value.trim();
  const tracking = 'DHDWUGO26052913817291';
  
  // Test 1: get/tracking/info
  testGetTrackingInfo(token, tracking);
});

function testGetTrackingInfo(token, tracking) {
  console.log("\n--- Testing get/tracking/info ---");
  const options = {
    hostname: 'platform.dhd-dz.com',
    port: 443,
    path: `/api/v1/get/tracking/info?tracking=${tracking}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      console.log("Status:", res.statusCode);
      console.log("Body:", data);
      
      // Test 2: get/orders/status
      testGetOrdersStatus(token, tracking);
    });
  });
  req.end();
}

function testGetOrdersStatus(token, tracking) {
  console.log("\n--- Testing get/orders/status ---");
  const options = {
    hostname: 'platform.dhd-dz.com',
    port: 443,
    path: `/api/v1/get/orders/status?api_token=${token}&trackings=${tracking}`,
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      console.log("Status:", res.statusCode);
      console.log("Body:", data);
    });
  });
  req.end();
}
