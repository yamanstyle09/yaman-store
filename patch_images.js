const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const API_URL = 'https://yaman-store-production.up.railway.app/api';

async function run() {
  try {
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@yaman.com',
      password: '123'
    });
    const token = loginRes.data.token;
    console.log("Logged in!");

    const config = { headers: { 'Authorization': `Bearer ${token}` } };
    
    // Update DB
    const sql = `UPDATE products SET image = '/uploads/' || code || '.jpg'`;
    console.log("Running SQL:", sql);
    
    const patchRes = await axios.post(`${API_URL}/temp-sql`, { sql }, config);
    console.log("SQL executed successfully!", patchRes.data);
    
  } catch (e) {
    console.error("Error:", e.response?.data || e.message);
  }
}

run();
