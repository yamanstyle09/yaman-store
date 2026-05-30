const fs = require('fs');

const data = JSON.parse(fs.readFileSync('/Users/mac/.gemini/antigravity/scratch/dhd_api.json', 'utf8'));

// Find any examples or schemas that have tracking info
function findSampleBodies(item) {
  let list = [];
  if (item.response) {
    item.response.forEach(res => {
      if (res.body && res.body.includes("status")) {
        list.push({
          name: item.name,
          body: res.body
        });
      }
    });
  }
  if (item.item) {
    item.item.forEach(sub => {
      list = list.concat(findSampleBodies(sub));
    });
  }
  return list;
}

const samples = findSampleBodies(data);
console.log(`Found ${samples.length} samples containing "status":\n`);
samples.forEach(s => {
  console.log(`========================================`);
  console.log(`Endpoint: ${s.name}`);
  console.log(`Body Sample:\n${s.body}`);
});
