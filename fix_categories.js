const axios = require('axios');

const API_URL = 'https://yaman-store-production.up.railway.app/api';

async function fix() {
  try {
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@yaman.com',
      password: '123'
    });
    const token = loginRes.data.token;
    const config = { headers: { 'Authorization': `Bearer ${token}` } };

    const res = await axios.get(`${API_URL}/categories`, config);
    const categories = res.data;

    for (const cat of categories) {
      if (typeof cat.features === 'string') {
        try {
          cat.features = JSON.parse(cat.features);
        } catch (e) {
          cat.features = [];
        }
      }
      // Post back to overwrite
      await axios.post(`${API_URL}/categories`, cat, config);
      console.log(`Fixed category: ${cat.code}`);
    }
    console.log("Fix complete!");
  } catch (err) {
    console.error(err);
  }
}

fix();
