const axios = require('axios');

async function test() {
  try {
    const res = await axios.post('http://localhost:8080/api/orders', {
      customerName: "Test",
      phone: "0555555555",
      wilayaId: "1",
      address: "Test",
      subtotal: 1500,
      deliveryPrice: 500,
      total: 2000,
      items: [{ productId: 1, quantity: 1, price: 1500 }],
      communeName: "Test Commune",
      deliveryType: "home",
      discount: 0
    });
    console.log("Success:", res.data);
  } catch (err) {
    console.error("Error:", err.response ? err.response.data : err.message);
  }
}
test();
