const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const dbPath = './store.db';
const db = new sqlite3.Database(dbPath);
const API_URL = 'https://yaman-store-production.up.railway.app/api';

async function migrateLocations() {
  console.log("Starting Locations Migration to Production...");
  try {
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@yaman.com',
      password: '123'
    });
    const token = loginRes.data.token;
    console.log("Logged in to production successfully!");

    const config = {
      headers: { 'Authorization': `Bearer ${token}` }
    };

    // Migrate Wilayas
    await new Promise((resolve, reject) => {
      db.all("SELECT * FROM wilayas", [], async (err, wilayas) => {
        if (err) return reject(err);
        console.log(`Found ${wilayas.length} wilayas locally. Migrating...`);
        for (const w of wilayas) {
          try {
            await axios.post(`${API_URL}/wilayas`, w, config);
          } catch (e) {
            console.log(`Failed to migrate wilaya ${w.id}`);
          }
        }
        console.log("✅ Wilayas migrated!");
        resolve();
      });
    });

    // Migrate Communes
    await new Promise((resolve, reject) => {
      db.all("SELECT * FROM communes", [], async (err, communes) => {
        if (err) return reject(err);
        console.log(`Found ${communes.length} communes locally. Migrating in bulk...`);
        
        const CHUNK_SIZE = 100;
        let successCount = 0;
        
        for (let i = 0; i < communes.length; i += CHUNK_SIZE) {
          const chunk = communes.slice(i, i + CHUNK_SIZE);
          try {
            const res = await axios.post(`${API_URL}/communes/bulk-insert`, { communes: chunk }, config);
            successCount += res.data.count;
          } catch (e) {
            console.log(`Failed to migrate chunk starting at ${i}`, e.response?.data || e.message);
          }
        }
        
        console.log(`✅ Communes migrated! Count: ${successCount}`);
        resolve();
      });
    });

    console.log("Migration Complete! 🎉");
  } catch (error) {
    console.error("Migration failed:", error.response?.data || error.message);
  }
}

migrateLocations();
