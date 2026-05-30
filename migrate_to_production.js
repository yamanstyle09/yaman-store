const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const dbPath = './store.db';
const db = new sqlite3.Database(dbPath);
const API_URL = 'https://yaman-store-production.up.railway.app/api';

async function run() {
  console.log("Starting Migration to Production...");
  try {
    // 1. Login to get token
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@yaman.com',
      password: '123' // They just set the DB to default
    });
    const token = loginRes.data.token;
    console.log("Logged in to production successfully!");

    const config = {
      headers: { 'Authorization': `Bearer ${token}` }
    };

    // 2. Fetch local categories
    db.all("SELECT * FROM categories", [], async (err, categories) => {
      if (err) throw err;
      console.log(`Found ${categories.length} categories locally. Migrating...`);
      
      for (const cat of categories) {
        try {
          // Check if category exists
          await axios.post(`${API_URL}/categories`, cat, config);
          console.log(`✅ Category migrated: ${cat.name}`);
        } catch (catErr) {
           console.log(`⚠️  Could not migrate category ${cat.name} (maybe already exists)`);
        }
      }

      // 3. Fetch local products
      db.all("SELECT * FROM products", [], async (err, products) => {
        if (err) throw err;
        console.log(`Found ${products.length} products locally. Migrating...`);

        for (const prod of products) {
          try {
            const formData = new FormData();
            formData.append('code', prod.code);
            formData.append('category', prod.category);
            formData.append('name', prod.name);
            
            // Try to read image
            if (prod.image) {
               // prod.image is like /uploads/D-104.png
               const imgFileName = path.basename(prod.image);
               const imgPath = path.join(__dirname, 'uploads', imgFileName);
               if (fs.existsSync(imgPath)) {
                  formData.append('image', fs.createReadStream(imgPath));
               }
            }

            await axios.post(`${API_URL}/products`, formData, {
               headers: {
                 ...formData.getHeaders(),
                 'Authorization': `Bearer ${token}`
               }
            });
            console.log(`✅ Product migrated: ${prod.code}`);
          } catch (prodErr) {
            console.log(`⚠️  Could not migrate product ${prod.code}`);
          }
        }
        
        console.log("Migration Complete! 🎉");
      });
    });

  } catch (error) {
    console.error("Migration failed:", error.message);
  }
}

run();
