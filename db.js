// db.js - SmartFinanceDB Logic with Auto-Migration and Propagation Fixes
const DB_NAME = "SmartFinanceDB_v1";
const DB_STORE = "months";
let db;

// PHASE 1: Safe Math Helper for Floating Point precision
function safeSum(arr, key = 'amount') {
  if (!arr || !Array.isArray(arr)) return 0;
  const totalInCents = arr.reduce((sum, item) => {
    const val = Number(item[key] || 0);
    return sum + Math.round(val * 100);
  }, 0);
  return totalInCents / 100;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        const store = db.createObjectStore(DB_STORE, { keyPath: "id" });
        store.createIndex("by_date", "id", { unique: true });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e);
  });
}

function getMonthIdFromDate(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function getMonth(id) {
  const database = await openDB();
  return new Promise((res, rej) => {
    const tx = database.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function saveMonth(monthObj) {
  const database = await openDB();
  return new Promise((res, rej) => {
    const tx = database.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.put(monthObj);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function listMonths() {
  const database = await openDB();
  return new Promise((res, rej) => {
    const tx = database.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const items = [];
    const cursor = store.openCursor(null, 'prev');
    cursor.onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        items.push(c.value);
        c.continue();
      } else res(items);
    };
    cursor.onerror = () => rej(cursor.error);
  });
}

// FIX: Helper to find the "Last Known Truth" month
async function findMostRecentData(targetMonthId) {
    const allMonths = await listMonths();
    // Sort descending to find the closest month that is older than target
    const sorted = allMonths
        .filter(m => m.id < targetMonthId)
        .sort((a, b) => b.id.localeCompare(a.id));
    return sorted[0] || null;
}

// FIX: Propagate changes to all existing future months
async function propagateRecurringChange(startMonthId, updatedItem, action) {
    const allMonths = await listMonths();
    const futureMonths = allMonths.filter(m => m.id > startMonthId);
    
    for (const m of futureMonths) {
        if (updatedItem.type === 'monthly') {
            if (action === 'add') {
                m.recurringMonthly.push(updatedItem);
            } else if (action === 'delete') {
                m.recurringMonthly = m.recurringMonthly.filter(i => i.ts !== updatedItem.ts);
            }
        } else {
            if (action === 'add') {
                m.recurringYearly.push(updatedItem);
            } else if (action === 'delete') {
                m.recurringYearly = m.recurringYearly.filter(i => i.ts !== updatedItem.ts);
            }
        }
        await saveMonth(m);
    }
}

async function clearAllData() {
  const database = await openDB();
  return new Promise((res, rej) => {
    const tx = database.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.clear();
    req.onsuccess = () => res(true);
    req.onerror = () => rej(req.error);
  });
}

async function exportFullBackup() {
  const allData = await listMonths();
  return JSON.stringify(allData);
}

async function importFullBackup(jsonData) {
  try {
    const data = JSON.parse(jsonData);
    if (!Array.isArray(data)) return false;
    for (const month of data) {
      await saveMonth(month);
    }
    return true;
  } catch (e) {
    console.error("Import failed", e);
    return false;
  }
}

// FIX: Improved inheritance logic with deep search
async function ensureMonth(monthId) {
  let m = await getMonth(monthId);
  if (!m) {
    // Look for the most recent data instead of just current-1
    const prevData = await findMostRecentData(monthId);

    m = {
      id: monthId,
      income: { base: prevData ? (prevData.income?.base || 0) : 0, extras: [] },
      daily: [],
      recurringMonthly: prevData ? JSON.parse(JSON.stringify(prevData.recurringMonthly || [])) : [],
      recurringYearly: prevData ? JSON.parse(JSON.stringify(prevData.recurringYearly || [])) : [],
      investments: prevData ? JSON.parse(JSON.stringify(prevData.investments || { sip: 0, stocks: 0, other: 0 })) : { sip: 0, stocks: 0, other: 0 }
    };
    await saveMonth(m);
  } else {
    // Migration logic for old data structures
    let saveNeeded = false;
    if (typeof m.income === 'number') { m.income = { base: m.income, extras: [] }; saveNeeded = true; }
    m.recurringMonthly = m.recurringMonthly || [];
    m.recurringYearly = m.recurringYearly || [];
    m.daily = m.daily || [];
    m.income.extras = m.income.extras || [];
    m.investments = m.investments || { sip: 0, stocks: 0, other: 0 };
    if (saveNeeded) await saveMonth(m);
  }
  return m;
}

async function getFinancialSummary(monthId) {
  const m = await ensureMonth(monthId);
  const totalIncome = (m.income.base || 0) + safeSum(m.income.extras);
  const monthlyFixed = safeSum(m.recurringMonthly);
  const yearlyFixedSlice = (m.recurringYearly || []).reduce((sum, r) => 
    sum + Math.round((Number(r.amount) / 12) * 100), 0) / 100;
  
  const totalEffectiveRecurring = monthlyFixed + yearlyFixedSlice;
  const totalDaily = safeSum(m.daily);
  const expenseGoal = (Math.round((totalIncome * 0.50) * 100)) / 100;
  const prepayFixed = (Math.round((totalIncome * 0.10) * 100)) / 100;
  const trueSurplus = (Math.round((expenseGoal - totalEffectiveRecurring - totalDaily) * 100)) / 100;
  const totalPrepayPower = (Math.round((trueSurplus + prepayFixed) * 100)) / 100;

  return { totalIncome, totalEffectiveRecurring, totalDaily, expenseGoal, trueSurplus, totalPrepayPower };
}

function upgradeMDL() {
  if (window.componentHandler) {
    window.componentHandler.upgradeDom();
    window.componentHandler.upgradeAllRegistered();
  }
}
