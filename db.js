// db.js - Updated with True Surplus Calculation Logic
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

async function clearAllData(){
  const database = await openDB();
  return new Promise((res,rej)=>{
    const tx = database.transaction(DB_STORE,'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.clear(); 
    req.onsuccess = ()=> res(true);
    req.onerror = ()=> rej(req.error);
  });
}

async function ensureMonth(monthId){
  let m = await getMonth(monthId);
  if(!m){
    m = {
      id: monthId,
      income: { base: 0, extras: [] },
      daily: [], 
      recurringMonthly: [], 
      recurringYearly: [],
      investments: {sip:0,stocks:0,other:0}
    };
    await saveMonth(m);
  } else {
    let saveNeeded = false;
    if(typeof m.income === 'number'){
      m.income = { base: m.income, extras: [] };
      saveNeeded = true;
    }
    m.recurringMonthly = m.recurringMonthly || [];
    m.recurringYearly = m.recurringYearly || [];
    m.daily = m.daily || [];
    m.income.extras = m.income.extras || [];
    m.investments = m.investments || {sip:0,stocks:0,other:0};

    if(m.monthlyRecurring) delete m.monthlyRecurring;
    if(m.yearlyRecurringDue) delete m.yearlyRecurringDue;

    if (saveNeeded) await saveMonth(m);
  }
  return m;
}

/**
 * 🆕 NEW: TRUTH-BASED CALCULATION
 * This function calculates the actual surplus by including daily expenses.
 */
async function getFinancialSummary(monthId) {
    const m = await ensureMonth(monthId);
    
    // 1. Calculate Total Income
    const totalIncome = m.income.base + m.income.extras.reduce((sum, e) => sum + e.amount, 0);
    
    // 2. Calculate Effective Monthly Recurring (Fixed Costs)
    const monthlyFixed = m.recurringMonthly.reduce((sum, r) => sum + r.amount, 0);
    const yearlyFixedSlice = m.recurringYearly.reduce((sum, r) => sum + (r.amount / 12), 0);
    const totalEffectiveRecurring = monthlyFixed + yearlyFixedSlice;
    
    // 3. Calculate Daily Expenses (The missing piece in your previous logic)
    const totalDaily = m.daily.reduce((sum, d) => sum + d.amount, 0);
    
    // 4. Budget Goals (50/20/20/10)
    const expenseGoal = totalIncome * 0.50;
    const prepayFixed = totalIncome * 0.10;
    
    // 5. TRUE SURPLUS: Goal - (Fixed Bills + Daily Cash Spending)
    const trueSurplus = expenseGoal - totalEffectiveRecurring - totalDaily;
    
    // 6. TOTAL PREPAY POWER
    const totalPrepayPower = trueSurplus + prepayFixed;

    return {
        totalIncome,
        totalEffectiveRecurring,
        totalDaily,
        expenseGoal,
        trueSurplus,
        totalPrepayPower
    };
}
