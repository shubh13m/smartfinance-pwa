// db.js - IndexedDB wrapper for SmartFinance (updated income structure)
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
// income: { base: Number, extras: [ {label, amount} ] }
async function ensureMonth(monthId){
  let m = await getMonth(monthId);
  if(!m){
    m = {
      id: monthId,
      income: { base: 0, extras: [] },
      daily: [], // list of {amount,category,note,date,ts}
      // Note: If you want to use the new recurring structure (recurringMonthly/recurringYearly)
      // that we used in app.js, these lines should be updated:
      monthlyRecurring: {rent:0,emi:0,bills:0,other:0}, // <-- Old object structure
      yearlyRecurringDue: [], // <-- Old array name
      investments: {sip:0,stocks:0,other:0}
    };
    await saveMonth(m);
  } else {
    // normalize older data shape: if income is number convert to object
    if(typeof m.income === 'number'){
      m.income = { base: m.income, extras: [] };
      await saveMonth(m);
    }
    // ensure keys exist
    m.monthlyRecurring = m.monthlyRecurring || {rent:0,emi:0,bills:0,other:0};
    m.yearlyRecurringDue = m.yearlyRecurringDue || [];
    m.investments = m.investments || {sip:0,stocks:0,other:0};
  }
  return m;
}
