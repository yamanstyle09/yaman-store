const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./store.db');

db.all("SELECT id FROM orders WHERE dhd_status_label LIKE '%Hub%'", [], async (err, rows) => {
   console.log("Total mapped to Hub:", rows.length);
});

const https = require('https');
db.get("SELECT value FROM settings WHERE key = 'ecotrack_api_token'", [], (err, row) => {
  const token = row.value.trim();
  let vers_hub = 0, en_hub = 0;
  
  const fetchPage = (page) => {
    https.get(`https://platform.dhd-dz.com/api/v1/get/orders?api_token=${token}&page=${page}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.data && json.data.length > 0) {
          json.data.forEach(o => {
            if (o.status === 'vers_hub') vers_hub++;
            if (o.status === 'en_hub') en_hub++;
          });
          if (page < 6) fetchPage(page + 1);
          else console.log(`API Results -> vers_hub: ${vers_hub}, en_hub: ${en_hub}`);
        } else {
          console.log(`API Results -> vers_hub: ${vers_hub}, en_hub: ${en_hub}`);
        }
      });
    });
  };
  fetchPage(1);
});
