const http = require('http');
http.get('http://localhost:3001/api/test-sync-dhd-status', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(data));
});
