const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  const token = row.value.trim();
  let totalTrackings = new Set();
  
  const fetchPage = (page) => {
    https.get(`https://platform.dhd-dz.com/api/v1/get/orders?api_token=${token}&page=${page}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.data && json.data.length > 0) {
          json.data.forEach(o => totalTrackings.add(o.tracking));
          console.log(`Page ${page}: fetched ${json.data.length}, unique so far: ${totalTrackings.size}`);
          if (page < 6) fetchPage(page + 1);
          else console.log("Done. Total unique trackings from DHD API:", totalTrackings.size);
        } else {
          console.log(`Page ${page} empty. Done. Total unique trackings from DHD API:`, totalTrackings.size);
        }
      });
    });
  };
  
  fetchPage(1);
});
