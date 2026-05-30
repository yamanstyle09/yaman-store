const { db } = require('./database');

const CATEGORIES = {
  'D': { 
    name: 'طقم سرير 6 قطع لمكانين', 
    price: 1900,
    features: [
      { icon: '🛏️', label: 'أوس ماتلا:', text: '180x200 سم' },
      { icon: '🛌', label: 'درا:', text: '230x240 سم' },
      { icon: '🛋️', label: 'غلافات مخايد:', text: '50x70 سم' }
    ]
  },
  'DP': { name: 'درا 3 قطع لمكان ونصف', price: 1200, features: [] },
  'S': { name: 'طقم سرير مفرد', price: 1000, features: [] },
  'F': { name: 'غطاء فاخر', price: 2500, features: [] }
};

const PRODUCTS = [
  { code: 'D-104', category: 'D', image: '/uploads/d_104_bed_1779461592930.png', name: 'أوراق الشجر أسود' },
  { code: 'D-102', category: 'D', image: '/uploads/d_102_bed_1779461606413.png', name: 'أوراق الشجر أزرق' },
  { code: 'D-117', category: 'D', image: '/uploads/d_117_bed_1779461620268.png', name: 'الورد الأرجواني' },
  { code: 'D-84', category: 'D', image: '/uploads/d_84_bed_1779461634437.png', name: 'السراخس البنفسجي' },
  { code: 'D-10', category: 'D', image: '/uploads/d_10_bed_1779461648055.png', name: 'الأغصان الخضراء' },
];

const WILAYAS = [
  { id: 16, name: 'الجزائر العاصمة', deliveryPrice: 400 },
  { id: 31, name: 'وهران', deliveryPrice: 600 },
  { id: 25, name: 'قسنطينة', deliveryPrice: 600 },
  { id: 9, name: 'البليدة', deliveryPrice: 500 },
  { id: 35, name: 'بومرداس', deliveryPrice: 500 },
];

db.serialize(() => {
  // Insert Categories
  for (const [code, cat] of Object.entries(CATEGORIES)) {
    db.run("INSERT OR REPLACE INTO categories (code, name, price, features) VALUES (?, ?, ?, ?)", 
      [code, cat.name, cat.price, JSON.stringify(cat.features)]);
  }

  // Insert Products
  PRODUCTS.forEach(p => {
    db.run("INSERT OR REPLACE INTO products (code, category, name, image) VALUES (?, ?, ?, ?)", 
      [p.code, p.category, p.name, p.image]);
  });

  // Insert Wilayas
  WILAYAS.forEach(w => {
    db.run("INSERT OR REPLACE INTO wilayas (id, name, deliveryPrice) VALUES (?, ?, ?)", 
      [w.id, w.name, w.deliveryPrice]);
  });

  console.log("Database Seeded Successfully!");
});
