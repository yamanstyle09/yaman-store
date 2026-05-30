PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE categories (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      features TEXT
    , purchasePrice INTEGER DEFAULT 0, stock INTEGER DEFAULT 50, weight REAL DEFAULT 1.45);
INSERT INTO categories VALUES('DP','درا 3 قطع لمكان ونصف',1200,'[]',1500,50,1.45);
INSERT INTO categories VALUES('S','طقم سرير مفرد',1000,'[]',1500,50,1.45);
INSERT INTO categories VALUES('F','غطاء فاخر',2500,'[]',1500,50,1.45);
INSERT INTO categories VALUES('TEST-VAR','فئة التجربة والاختبار',2500,'[{"icon":"🛏️","label":"المقاس:","text":"180x200 سم"}]',1500,10,1.45);
INSERT INTO categories VALUES('D','طقم سرير 6 قطع لمكانين',1900,'[{"icon":"🛏️","label":"أوس ماتلا:","text":"180x200 سم"},{"icon":"🛌","label":"درا:","text":"230x240 سم"},{"icon":"🛋️","label":"غلافات مخايد:","text":"50x70 سم"}]',1500,31,1.45);
COMMIT;
