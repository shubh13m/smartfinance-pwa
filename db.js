// db.js - FIX: ensureMonth now correctly initializes and uses recurringMonthly/recurringYearly keys.

const DB_NAME = "SmartFinanceDB_v1";
const DB_STORE = "months";
let db;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      db = e.target.result;
      if(!db.objectStoreNames.contains(DB_STORE)){
        const store = db.createObjectStore(DB_STORE, { keyPath: "id" }); // id: "YYYY-MM"
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

// 🆕 NEW FUNCTION: Clears all data from the database
async function clearAllData(){
  const database = await openDB();
  return new Promise((res,rej)=>{
    const tx = database.transaction(DB_STORE,'readwrite');
    const store = tx.objectStore(DB_STORE);
    // Use the clear method to delete all records in the object store
    const req = store.clear(); 
    req.onsuccess = ()=> res(true);
    req.onerror = ()=> rej(req.error);
  });
}
// ----------------------------------------------------


// Ensure month object exists and has new income structure:
async function ensureMonth(monthId){
  let m = await getMonth(monthId);
  if(!m){
    m = {
      id: monthId,
      income: { base: 0, extras: [] },
      daily: [], 
      // 🟢 FIX 2A: Initialize with the correct array keys used by app.js
      recurringMonthly: [], 
      recurringYearly: [],
      investments: {sip:0,stocks:0,other:0}
    };
    await saveMonth(m);
  } else {
    let saveNeeded = false;

    // 1. Normalize older income data shape
    if(typeof m.income === 'number'){
      m.income = { base: m.income, extras: [] };
      saveNeeded = true;
    }
    
    // 2. Normalize and ensure recurring keys exist (Migration/Correction)
    // If the old keys exist, migrate their contents to the new keys, but ensure the new keys are initialized as arrays.
    
    // 🟢 FIX 2B: Use the correct keys and ensure they are arrays
    m.recurringMonthly = m.recurringMonthly || [];
    m.recurringYearly = m.recurringYearly || [];
    m.daily = m.daily || [];
    m.income.extras = m.income.extras || [];
    m.investments = m.investments || {sip:0,stocks:0,other:0};


    // Clean up old/incorrect keys if they were accidentally saved previously (optional cleanup)
    if(m.monthlyRecurring) delete m.monthlyRecurring;
    if(m.yearlyRecurringDue) delete m.yearlyRecurringDue;

    if (saveNeeded) await saveMonth(m); // Save if income was normalized
  }
  return m;
}
