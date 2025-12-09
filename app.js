// app.js - updated logic: per-month base income + extra incomes + recurring totals + placeholder fixes
(async function(){
  await openDB();

  // DOM refs
  const incomeVal = document.getElementById('incomeVal');
  const incomeTotal = document.getElementById('incomeTotal');
  const expenseVal = document.getElementById('expenseVal');
  const investVal = document.getElementById('investVal');
  const saveVal = document.getElementById('saveVal');
  const currentMonthLabel = document.getElementById('currentMonthLabel');

  const incomeInput = document.getElementById('incomeInput');
  const saveIncomeBtn = document.getElementById('saveIncome');

  const extraLabel = document.getElementById('extraLabel');
  const extraAmount = document.getElementById('extraAmount');
  const addExtraIncomeBtn = document.getElementById('addExtraIncome');

  const openAddExpense = document.getElementById('openAddExpense');
  const addExpenseSection = document.getElementById('addExpenseSection');
  const addExpBtn = document.getElementById('addExpBtn');
  const cancelAddExp = document.getElementById('cancelAddExp');
  const expAmount = document.getElementById('expAmount');
  const expCategory = document.getElementById('expCategory');
  const expNote = document.getElementById('expNote');
  const expDate = document.getElementById('expDate');

  const rec_rent = document.getElementById('rec_rent');
  const rec_emi = document.getElementById('rec_emi');
  const rec_bills = document.getElementById('rec_bills');
  const rec_other = document.getElementById('rec_other');
  const yr_insurance_amt = document.getElementById('yr_insurance_amt');
  const yr_insurance_month = document.getElementById('yr_insurance_month');
  const yr_sub_amt = document.getElementById('yr_sub_amt');
  const yr_sub_month = document.getElementById('yr_sub_month');
  const saveRecurring = document.getElementById('saveRecurring');
  const openRecurring = document.getElementById('openRecurring');
  const cancelRecurring = document.getElementById('cancelRecurring');

  const inv_sip = document.getElementById('inv_sip');
  const inv_stocks = document.getElementById('inv_stocks');
  const inv_other = document.getElementById('inv_other');
  const openInvest = document.getElementById('openInvest');
  const saveInvest = document.getElementById('saveInvest');
  const cancelInvest = document.getElementById('cancelInvest');

  const monthsList = document.getElementById('monthsList');
  const monthDetail = document.getElementById('monthDetail');
  const openHistory = document.getElementById('openHistory');
  const exportCSV = document.getElementById('exportCSV');
  const clearAll = document.getElementById('clearAll');

  const prevMonthBtn = document.getElementById('prevMonthBtn');
  const nextMonthBtn = document.getElementById('nextMonthBtn');
  const currentMonthBtn = document.getElementById('currentMonthBtn');

  const monthlyRecurringDisplay = document.getElementById('monthlyRecurringDisplay');
  const yearlyRecurringDisplay = document.getElementById('yearlyRecurringDisplay');
  const yearlyMonthlyEquivalent = document.getElementById('yearlyMonthlyEquivalent');

  // install prompt
  const installBtn = document.getElementById('installBtn');
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'inline-block';
  });
  installBtn.addEventListener('click', async ()=>{
    if(deferredPrompt){
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.style.display = 'none';
    }
  });

  // state: viewing month
  let viewingMonth = new Date().toISOString().slice(0,7);

  function setMonthLabel(id){
    const [y,m] = id.split('-');
    const date = new Date(Number(y), Number(m)-1, 1);
    currentMonthLabel.textContent = date.toLocaleString(undefined,{month:'long',year:'numeric'});
  }

  function fmt(val){ return `₹ ${Number(val || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

  // helper to set input showing placeholder when zero/empty
  function setInputValue(element, value){
    if(!element) return;
    if(value === 0 || value === null || value === undefined || value === ''){
      element.value = '';
    } else {
      element.value = value;
    }
  }

  // Calculate totals of recurring across all months (yearly totals deduped by name+month)
  async function calculateRecurringTotalsGlobal(){
    // sum monthlyRecurring from viewingMonth's monthlyRecurring (we treat it as the current set)
    const m = await ensureMonth(viewingMonth);
    const monthlyTotal = Object.values(m.monthlyRecurring || {}).reduce((s,v)=>s+Number(v||0),0);

    // For yearly total: sum all yearlyRecurringDue entries present in the db (treat them as annual totals)
    const months = await listMonths();
    // Use a map to avoid double counting same named yearly item set in different months
    const keySet = new Set();
    let yearlySum = 0;
    months.forEach(mm=>{
      (mm.yearlyRecurringDue||[]).forEach(y=>{
        const key = `${y.name || 'y'}-${y.month || ''}-${Number(y.amount||0)}`;
        // we allow duplicates with same name+month+amount to be skipped
        if(!keySet.has(key) && Number(y.amount||0) > 0){
          keySet.add(key);
          yearlySum += Number(y.amount||0);
        }
      });
    });

    return {
      monthlyTotal,
      yearlyTotal: yearlySum,
      yearlyMonthlyEquivalent: yearlySum / 12
    };
  }

  // Main refresh for dashboard
  async function refreshDashboard(){
    setMonthLabel(viewingMonth);
    const m = await ensureMonth(viewingMonth);

    // Income
    setInputValue(incomeInput, m.income.base);
    incomeVal.textContent = fmt(m.income.base);

    // total income = base + extras
    const extrasTotal = (m.income.extras||[]).reduce((s,e)=>s+Number(e.amount||0),0);
    incomeTotal.textContent = fmt(Number(m.income.base||0) + extrasTotal);

    // Expenses this month
    const dailyTotal = (m.daily||[]).reduce((s,e)=>s+Number(e.amount||0),0);
    const monthlyRecTotal = Object.values(m.monthlyRecurring || {}).reduce((s,v)=>s+Number(v||0),0);

    // yearly items that are due this viewing month (show as part of expense this month)
    const thisMonthNum = Number(viewingMonth.split('-')[1]);
    const yearlyDueThisMonth = (m.yearlyRecurringDue||[]).filter(y=>Number(y.month)===thisMonthNum).reduce((s,y)=>s+Number(y.amount||0),0);

    const investTotal = Object.values(m.investments || {}).reduce((s,v)=>s+Number(v||0),0);

    const totalExpense = dailyTotal + monthlyRecTotal + yearlyDueThisMonth;

    expenseVal.textContent = fmt(totalExpense);
    investVal.textContent = fmt(investTotal);

    const savings = Number(m.income.base||0) + extrasTotal - (totalExpense + investTotal);
    saveVal.textContent = fmt(savings);

    // populate recurring displays (global / monthly)
    const recs = await calculateRecurringTotalsGlobal();
    monthlyRecurringDisplay.textContent = fmt(recs.monthlyTotal);
    yearlyRecurringDisplay.textContent = fmt(recs.yearlyTotal);
    yearlyMonthlyEquivalent.textContent = `(₹ ${recs.yearlyMonthlyEquivalent.toFixed(2)} / month equivalent)`;

    // populate recurring inputs
    setInputValue(rec_rent, m.monthlyRecurring.rent);
    setInputValue(rec_emi, m.monthlyRecurring.emi);
    setInputValue(rec_bills, m.monthlyRecurring.bills);
    setInputValue(rec_other, m.monthlyRecurring.other);

    // investments
    setInputValue(inv_sip, m.investments.sip);
    setInputValue(inv_stocks, m.investments.stocks);
    setInputValue(inv_other, m.investments.other);

    // show extras list (if any) in history detail area
    // (optional) we won't render here by default
  }

  // navigation
  prevMonthBtn.addEventListener('click', ()=>{
    const [y,m] = viewingMonth.split('-').map(Number);
    let date = new Date(y,m-1,1);
    date.setMonth(date.getMonth()-1);
    viewingMonth = date.toISOString().slice(0,7);
    refreshDashboard();
  });
  nextMonthBtn.addEventListener('click', ()=>{
    const [y,m] = viewingMonth.split('-').map(Number);
    let date = new Date(y,m-1,1);
    date.setMonth(date.getMonth()+1);
    viewingMonth = date.toISOString().slice(0,7);
    refreshDashboard();
  });
  currentMonthBtn.addEventListener('click', ()=>{
    viewingMonth = new Date().toISOString().slice(0,7);
    refreshDashboard();
  });

  // Save base income
  saveIncomeBtn.addEventListener('click', async ()=>{
    const m = await ensureMonth(viewingMonth);
    m.income.base = Number(incomeInput.value || 0);
    await saveMonth(m);
    refreshDashboard();
    alert('Base income saved for ' + viewingMonth);
  });

  // Add extra income
  addExtraIncomeBtn.addEventListener('click', async ()=>{
    const label = (extraLabel.value || '').trim();
    const amt = Number(extraAmount.value || 0);
    if(!label || !amt){ alert('Provide label and amount'); return; }
    const m = await ensureMonth(viewingMonth);
    m.income.extras.push({ label, amount: amt, ts: Date.now() });
    await saveMonth(m);
    extraLabel.value = ''; extraAmount.value='';
    refreshDashboard();
    alert('Extra income added');
  });

  // Add expense
  openAddExpense.addEventListener('click', ()=>{ addExpenseSection.classList.remove('hidden'); expDate.value = new Date().toISOString().slice(0,10); });
  cancelAddExp.addEventListener('click', ()=>{ addExpenseSection.classList.add('hidden'); });
  addExpBtn.addEventListener('click', async ()=>{
    const amount = Number(expAmount.value || 0);
    if(!amount || amount <= 0){ alert('Enter valid amount'); return; }
    const dateStr = expDate.value || new Date().toISOString().slice(0,10);
    const mid = getMonthIdFromDate(dateStr);
    const m = await ensureMonth(mid);
    m.daily.push({ amount, category: expCategory.value || 'Other', note: expNote.value || '', date: dateStr, ts: Date.now() });
    await saveMonth(m);
    expAmount.value=''; expCategory.value=''; expNote.value=''; expDate.value='';
    addExpenseSection.classList.add('hidden');
    if(mid === viewingMonth) refreshDashboard();
    alert('Expense saved');
  });

  // Recurring save
  openRecurring.addEventListener('click', async ()=>{
    recurringSection.classList.remove('hidden');
    populateMonthSelects();
    const m = await ensureMonth(viewingMonth);
    setInputValue(rec_rent, m.monthlyRecurring.rent);
    setInputValue(rec_emi, m.monthlyRecurring.emi);
    setInputValue(rec_bills, m.monthlyRecurring.bills);
    setInputValue(rec_other, m.monthlyRecurring.other);
    // load yearly if present
    const ins = (m.yearlyRecurringDue||[]).find(x=>x.name==='insurance')||{};
    yr_insurance_amt.value = ins.amount || '';
    yr_insurance_month.value = ins.month || '';
    const sub = (m.yearlyRecurringDue||[]).find(x=>x.name==='subscription')||{};
    yr_sub_amt.value = sub.amount || '';
    yr_sub_month.value = sub.month || '';
  });
  cancelRecurring.addEventListener('click', ()=> recurringSection.classList.add('hidden'));

  saveRecurring.addEventListener('click', async ()=>{
    const m = await ensureMonth(viewingMonth);
    m.monthlyRecurring = {
      rent: Number(rec_rent.value || 0),
      emi: Number(rec_emi.value || 0),
      bills: Number(rec_bills.value || 0),
      other: Number(rec_other.value || 0)
    };
    const arr = [];
    if(Number(yr_insurance_amt.value || 0) > 0 && yr_insurance_month.value) arr.push({ name:'insurance', amount: Number(yr_insurance_amt.value), month: Number(yr_insurance_month.value) });
    if(Number(yr_sub_amt.value || 0) > 0 && yr_sub_month.value) arr.push({ name:'subscription', amount: Number(yr_sub_amt.value), month: Number(yr_sub_month.value) });
    m.yearlyRecurringDue = arr;
    await saveMonth(m);
    recurringSection.classList.add('hidden');
    refreshDashboard();
    alert('Recurring saved');
  });

  // Investments
  openInvest.addEventListener('click', async ()=>{
    investSection.classList.remove('hidden');
    const m = await ensureMonth(viewingMonth);
    setInputValue(inv_sip, m.investments.sip);
    setInputValue(inv_stocks, m.investments.stocks);
    setInputValue(inv_other, m.investments.other);
  });
  cancelInvest.addEventListener('click', ()=> investSection.classList.add('hidden'));
  saveInvest.addEventListener('click', async ()=>{
    const m = await ensureMonth(viewingMonth);
    m.investments = { sip: Number(inv_sip.value||0), stocks: Number(inv_stocks.value||0), other: Number(inv_other.value||0) };
    await saveMonth(m);
    investSection.classList.add('hidden');
    refreshDashboard();
    alert('Investments saved');
  });

  // History
  openHistory.addEventListener('click', async ()=>{
    document.getElementById('historySection').classList.remove('hidden');
    monthsList.innerHTML = ''; monthDetail.innerHTML = '';
    const months = await listMonths();
    if(months.length === 0) monthsList.innerHTML = '<div class="notice">No months yet</div>';
    months.forEach(m=>{
      const div = document.createElement('div');
      div.className = 'monthCard mdl-card';
      const income = Number(m.income.base||0) + (m.income.extras||[]).reduce((s,e)=>s+Number(e.amount||0),0);
      const daily = (m.daily||[]).reduce((s,e)=>s+Number(e.amount||0),0);
      const monthlyRec = Object.values(m.monthlyRecurring||{}).reduce((s,v)=>s+Number(v||0),0);
      const yearlyDue = (m.yearlyRecurringDue||[]).reduce((s,y)=>s+Number(y.amount||0),0);
      const invest = Object.values(m.investments||{}).reduce((s,v)=>s+Number(v||0),0);
      const totalExpense = daily + monthlyRec + yearlyDue;
      const saved = income - (totalExpense + invest);
      div.innerHTML = `<div><strong>${m.id}</strong><div class="month-summary">Income ₹ ${income.toLocaleString()} · Expense ₹ ${totalExpense.toLocaleString()} · Invest ₹ ${invest.toLocaleString()} · Saved ₹ ${saved.toLocaleString()}</div></div><button class="mdl-button mdl-js-button small-btn">View</button>`;
      div.querySelector('button').addEventListener('click', ()=> showMonthDetail(m.id));
      monthsList.appendChild(div);
    });
  });

  async function showMonthDetail(id){
    const m = await getMonth(id);
    if(!m) return;
    const income = Number(m.income.base||0) + (m.income.extras||[]).reduce((s,e)=>s+Number(e.amount||0),0);
    const daily = (m.daily||[]).reduce((s,e)=>s+Number(e.amount||0),0);
    const monthlyRec = Object.values(m.monthlyRecurring||{}).reduce((s,v)=>s+Number(v||0),0);
    const yearlyDue = (m.yearlyRecurringDue||[]).reduce((s,y)=>s+Number(y.amount||0),0);
    const invest = Object.values(m.investments||{}).reduce((s,v)=>s+Number(v||0),0);
    const totalExpense = daily + monthlyRec + yearlyDue;
    const saved = income - (totalExpense + invest);

    monthDetail.innerHTML = `<h4>${m.id} details</h4>
      <div>Income: ₹ ${income.toLocaleString()}</div>
      <div>Expenses: ₹ ${totalExpense.toLocaleString()}</div>
      <div>Invest: ₹ ${invest.toLocaleString()}</div>
      <div>Saved: ₹ ${saved.toLocaleString()}</div>
      <hr>
      <div><b>Daily Expenses</b><br>${(m.daily||[]).map(e=>`${e.date} · ₹ ${Number(e.amount).toLocaleString()} · ${e.category} · ${e.note||''}`).join('<br>')}</div>
      <hr>
      <div><b>Extras</b><br>${(m.income.extras||[]).map(x=>`${x.label} · ₹ ${Number(x.amount).toLocaleString()}`).join('<br>')}</div>
    `;
  }

  // export CSV
  exportCSV.addEventListener('click', async ()=>{
    const months = await listMonths();
    let csv = 'Month,Income,Expenses,Investments,Saved\n';
    months.forEach(m=>{
      const income = Number(m.income.base||0) + (m.income.extras||[]).reduce((s,e)=>s+Number(e.amount||0),0);
      const exp = (m.daily||[]).reduce((s,e)=>s+Number(e.amount||0),0) + Object.values(m.monthlyRecurring||{}).reduce((s,v)=>s+Number(v||0),0) + (m.yearlyRecurringDue||[]).reduce((s,y)=>s+Number(y.amount||0),0);
      const invest = Object.values(m.investments||{}).reduce((s,v)=>s+Number(v||0),0);
      const saved = income - exp - invest;
      csv += `${m.id},${income},${exp},${invest},${saved}\n`;
    });
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'smartfinance_summary.csv';
    a.click();
  });

  // clear all
  clearAll.addEventListener('click', async ()=>{
    if(!confirm('Clear all data? This cannot be undone.')) return;
    const dbi = await openDB();
    const tx = dbi.transaction('months','readwrite');
    tx.objectStore('months').clear();
    tx.oncomplete = ()=>{ alert('All data cleared'); location.reload(); };
  });

  // populate month selects
  function populateMonthSelects(){
    const months = Array.from({length:12},(_,i)=>({v:i+1,n:new Date(2000,i,1).toLocaleString(undefined,{month:'long'})}));
    yr_insurance_month.innerHTML = '<option value="">due month</option>';
    yr_sub_month.innerHTML = '<option value="">due month</option>';
    months.forEach(m=>{
      const o1 = document.createElement('option'); o1.value = m.v; o1.textContent = m.n; yr_insurance_month.appendChild(o1);
      const o2 = document.createElement('option'); o2.value = m.v; o2.textContent = m.n; yr_sub_month.appendChild(o2);
    });
  }

  // init
  await ensureMonth(viewingMonth);
  await refreshDashboard();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(()=>console.warn('sw failed'));
  }

})();
