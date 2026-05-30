const https = require('http');
const req = https.request('http://localhost:3001/api/analytics/erp-summary', {
  headers: { 'Authorization': 'Bearer test_token' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(JSON.parse(data).shipping));
});
req.end();
