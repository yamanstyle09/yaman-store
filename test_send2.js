const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');

app.get('/test', (req, res) => {
  const p = path.resolve(__dirname, 'public/admin/index.html');
  console.log("Path is:", p, "Exists:", fs.existsSync(p));
  res.sendFile(p);
});
app.listen(3006, () => {
  console.log('Test server started on 3006');
});
