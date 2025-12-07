const DB_NAME = "SmartFinanceDB_v1";
const DB_STORE = "months";
let db;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      db = e.target.result;
      if(!db.objectStoreNames.contains(DB_STORE)){
        const store = db.createObjectStore(DB_STORE, { keyPath: "id" });
        store.createIndex("by_date", "id", { unique: true });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e);
  });
}

function getMonthIdFromDate(d){
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}

async function getMonth(id){
  const database = await openDB();
  return new Promise((res,rej)=>{
    const tx = database.transaction(DB_STORE,'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.get(id);
    req.onsuccess = ()=> res(req.result);
    req.onerror = ()=> rej(req.error);
  });
}

async function saveMonth(monthObj){
  const database = await openDB();
  return new Promise((res,rej)=>{
    const tx = database.transaction(DB_STORE,'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.put(monthObj);
    req.onsuccess = ()=> res(req.result);
    req.onerror = ()=> rej(req.error);
  });
}

async function listMonths(){
  const database = await openDB();
  return new Promise((res,rej)=>{
    const tx = database.transaction(DB_STORE,'readonly');
    const store = tx.objectStore(DB_STORE);
    const items = [];
    const cursor = store.openCursor(null,'prev');
    cursor.onsuccess = (e)=>{
      const c = e.target.result;
      if(c){
        items.push(c.value);
        c.continue();
      } else res(items);
    };
    cursor.onerror = ()=> rej(cursor.error);
  });
}

async function ensureMonth(monthId){
  let m = await getMonth(monthId);
  if(!m){
    m = {
      id: monthId,
      income: 0,
      daily: [],
      monthlyRecurring: {rent:0,emi:0,bills:0,other:0},
      yearlyRecurringDue: [],
      investments: {sip:0,stocks:0,other:0}
    };
    await saveMonth(m);
  }
  return m;
}
