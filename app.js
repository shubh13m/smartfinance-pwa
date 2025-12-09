// app.js - Refactored for MDL Tabs, Flexible Data, and Updated Schema
(async function(){
  // --- Core DOM References (Updated) ---
  
  // Dashboard Displays
  const currentMonthDisplay = document.getElementById('currentMonthDisplay');
  const baseIncomeDisplay = document.getElementById('baseIncomeDisplay');
  const extraIncomeDisplay = document.getElementById('extraIncomeDisplay');
  const totalIncomeDisplay = document.getElementById('totalIncomeDisplay');
  const expenseDisplay = document.getElementById('expenseDisplay');
  const monthlyRecurringDisplay = document.getElementById('monthlyRecurringDisplay');
  const yearlyDueThisMonthDisplay = document.getElementById('yearlyDueThisMonthDisplay');
  const savedDisplay = document.getElementById('savedDisplay');

  // Income Card
  const incomeInput = document.getElementById('incomeInput');
  const saveIncomeBtn = document.getElementById('saveIncome');
  const extraLabel = document.getElementById('extraLabel');
  const extraAmount = document.getElementById('extraAmount');
  const addExtraIncomeBtn = document.getElementById('addExtraIncome');

  // Expense Panel
  const addExpBtn = document.getElementById('addExpBtn');
  const expAmount = document.getElementById('expAmount');
  const expCategory = document.getElementById('expCategory');
  const expNote = document.getElementById('expNote');
  const expDate = document.getElementById('expDate');
  const currentMonthExpenseList = document.getElementById('currentMonthExpenseList');
  
  // Recurring Panel
  const recName = document.getElementById('recName');
  const recAmount = document.getElementById('recAmount');
  const recFrequencyMonthly = document.getElementById('recMonthly');
  const recFrequencyYearly = document.getElementById('recYearly');
  const yearlyDueMonthInput = document.getElementById('yearlyDueMonthInput');
  const recDueMonth = document.getElementById('recDueMonth');
  const addRecurringItemBtn = document.getElementById('addRecurringItemBtn');
  const recurringItemList = document.getElementById('recurringItemList');

  // Navigation & Actions
  const prevMonthBtn = document.getElementById('prevMonthBtn');
  const nextMonthBtn = document.getElementById('nextMonthBtn');
  const quickAddExpenseFAB = document.getElementById('quickAddExpenseFAB');
  const exportCSV = document.getElementById('exportCSV');
  const clearAll = document.getElementById('clearAll');
  const monthsList = document.getElementById('monthsList');
  const monthDetail = document.getElementById('monthDetail');
  
  // PWA Install
  const installBtn = document.getElementById('installBtn');
  let deferredPrompt;

  // --- State & Helpers ---
  let viewingMonth = new Date().toISOString().slice(0,7); // e.g. "2025-12"

  function setMonthLabel(id){
    const [y,m] = id.split('-');
    const date = new Date(Number(y), Number(m)-1, 1);
    currentMonthDisplay.textContent = date.toLocaleString(undefined,{month:'long',year:'numeric'});
  }

  function fmt(val){ return `₹ ${Number(val || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

  function getMonthName(monthNum){ // 1=Jan, 12=Dec
    return new Date(2000, monthNum - 1, 1).toLocaleString(undefined, {month:'long'});
  }
  
  // --- Calculation Logic ---

  // Calculates total value of a list of objects (used for flexible arrays)
  function sumAmounts(list){
    return (list || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }

  // --- Rendering Functions ---

  async function renderRecurringList(){
    // This needs to fetch ALL recurring items (they are global, not month-specific)
    const allMonths = await listMonths();
    const globalRecurringItems = new Map();

    // Iterate all months to find unique recurring items (using the latest version saved)
    allMonths.forEach(m => {
        // Use an arbitrary month's recurring list (e.g., the last saved one) as the source of truth 
        // NOTE: In a perfect app, recurring items are stored in their own object store, but for PWA simplicity, we use the month data structure.
        // For this simple version, we assume the items are saved primarily via the 'Recurring' tab and exist in the current viewing month object.
    });

    // For simplicity with the current db.js structure, we fetch the current month's item, 
    // assuming the user edited the global list while in this month.
    const m = await ensureMonth(viewingMonth);
    const allRecs = [...m.recurringMonthly, ...m.recurringYearly];
    
    recurringItemList.innerHTML = '';
    if(allRecs.length === 0){
        recurringItemList.innerHTML = `<div class="muted" style="padding: 16px;">No recurring items saved.</div>`;
        return;
    }

    allRecs.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'mdl-list__item mdl-list__item--two-line';
        const type = item.month ? `Yearly (${getMonthName(item.month)})` : 'Monthly';
        li.innerHTML = `
            <span class="mdl-list__item-primary-content">
                <span>${item.name}</span>
                <span class="mdl-list__item-sub-title">${type} - ${fmt(item.amount)}</span>
            </span>
            <span class="mdl-list__item-secondary-content">
                <button class="mdl-button mdl-js-button mdl-button--icon delete-rec" data-index="${index}" data-type="${item.month ? 'yearly' : 'monthly'}">
                    <i class="material-icons">delete</i>
                </button>
            </span>
        `;
        recurringItemList.appendChild(li);
    });
    
    // Add delete listeners
    document.querySelectorAll('.delete-rec').forEach(btn => {
        btn.addEventListener('click', deleteRecurringItem);
    });
  }

  async function renderExpenseList(monthId){
    const m = await getMonth(monthId);
    currentMonthExpenseList.innerHTML = '';
    const expenses = m.daily || [];

    if(expenses.length === 0){
      currentMonthExpenseList.innerHTML = `<div class="muted" style="padding: 16px;">No daily expenses recorded for this month.</div>`;
      return;
    }

    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));

    expenses.forEach(e => {
        const li = document.createElement('li');
        li.className = 'mdl-list__item mdl-list__item--two-line';
        li.innerHTML = `
            <span class="mdl-list__item-primary-content">
                <span style="color: var(--danger); font-weight: bold;">${fmt(e.amount)}</span>
                <span class="mdl-list__item-sub-title">${e.category} / ${e.note || 'No note'} (on ${e.date})</span>
            </span>
        `;
        currentMonthExpenseList.appendChild(li);
    });
  }

  // --- Main Refresh ---

  async function refreshDashboard(){
    setMonthLabel(viewingMonth);
    const m = await ensureMonth(viewingMonth);
    const currentYear = Number(viewingMonth.split('-')[0]);
    const currentMonthNum = Number(viewingMonth.split('-')[1]);

    // 1. INCOME
    const baseIncome = Number(m.income.base || 0);
    const extrasTotal = sumAmounts(m.income.extras);
    const totalIncome = baseIncome + extrasTotal;
    
    incomeInput.value = baseIncome > 0 ? baseIncome : ''; // Set input field
    baseIncomeDisplay.textContent = fmt(baseIncome);
    extraIncomeDisplay.textContent = fmt(extrasTotal);
    totalIncomeDisplay.textContent = fmt(totalIncome);

    // 2. EXPENSE CALCULATIONS (Flexible arrays)
    const dailyTotal = sumAmounts(m.daily);
    const monthlyRecurringTotal = sumAmounts(m.recurringMonthly);

    // Calculate Yearly Due This Month: filter yearly items that match current month
    const yearlyDueThisMonthTotal = m.recurringYearly
        .filter(item => Number(item.month) === currentMonthNum)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    // Total Outflow
    const totalOutflow = dailyTotal + monthlyRecurringTotal + yearlyDueThisMonthTotal;

    expenseDisplay.textContent = fmt(dailyTotal);
    monthlyRecurringDisplay.textContent = fmt(monthlyRecurringTotal);
    yearlyDueThisMonthDisplay.textContent = fmt(yearlyDueThisMonthTotal);

    // 3. SAVINGS
    const savings = totalIncome - totalOutflow;
    savedDisplay.textContent = fmt(savings);
    savedDisplay.parentElement.classList.toggle('expense', savings < 0);
    savedDisplay.parentElement.classList.toggle('saved', savings >= 0);

    // 4. RENDER LISTS
    await renderExpenseList(viewingMonth);
    await renderRecurringList();
  }
  
  // --- Event Handlers (Updated for Flexibility) ---

  // Navigation
  prevMonthBtn.addEventListener('click', ()=>{
    let date = new Date(viewingMonth.replace(/-/g, ','));
    date.setMonth(date.getMonth()-1);
    viewingMonth = date.toISOString().slice(0,7);
    refreshDashboard();
  });
  nextMonthBtn.addEventListener('click', ()=>{
    let date = new Date(viewingMonth.replace(/-/g, ','));
    date.setMonth(date.getMonth()+1);
    viewingMonth = date.toISOString().slice(0,7);
    refreshDashboard();
  });

  // Save base income
  saveIncomeBtn.addEventListener('click', async ()=>{
    const m = await ensureMonth(viewingMonth);
    m.income.base = Number(incomeInput.value || 0);
    await saveMonth(m);
    refreshDashboard();
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
  });

  // Add expense
  addExpBtn.addEventListener('click', async ()=>{
    const amount = Number(expAmount.value || 0);
    if(!amount || amount <= 0){ alert('Enter valid amount'); return; }
    const dateStr = expDate.value || new Date().toISOString().slice(0,10);
    const mid = getMonthIdFromDate(dateStr);
    const m = await ensureMonth(mid);
    m.daily.push({ amount, category: expCategory.value || 'Other', note: expNote.value || '', date: dateStr, ts: Date.now() });
    await saveMonth(m);
    
    expAmount.value=''; expCategory.value=''; expNote.value='';
    // Reset MDL inputs state
    componentHandler.upgradeDom(); 

    if(mid === viewingMonth) refreshDashboard();
    alert('Expense saved');
  });
  
  // Floating Action Button (FAB)
  quickAddExpenseFAB.addEventListener('click', () => {
    // Switch to the expenses tab (index 1) and focus the amount field
    document.querySelector('.mdl-tabs__tab:nth-child(2)').click();
    document.getElementById('expAmount').focus();
  });

  // Recurring form change handler (show/hide due month)
  recFrequencyYearly.addEventListener('change', () => {
    yearlyDueMonthInput.classList.toggle('hidden', !recFrequencyYearly.checked);
  });
  recFrequencyMonthly.addEventListener('change', () => {
    yearlyDueMonthInput.classList.toggle('hidden', !recFrequencyMonthly.checked);
  });
  
  // Save Recurring Item (Crucial Logic Update)
  addRecurringItemBtn.addEventListener('click', async () => {
    const name = (recName.value || '').trim();
    const amount = Number(recAmount.value || 0);
    const frequency = document.querySelector('input[name="recFrequency"]:checked').value;
    const dueMonth = Number(recDueMonth.value || 0);

    if (!name || amount <= 0) { alert('Provide name and amount'); return; }
    if (frequency === 'yearly' && dueMonth === 0) { alert('Select a due month for yearly cost'); return; }

    // NOTE: Recurring items are considered "global settings" saved on the month they are created/edited.
    const m = await ensureMonth(viewingMonth);
    const newItem = { name, amount, ts: Date.now() };

    if (frequency === 'monthly') {
      m.recurringMonthly.push(newItem);
    } else if (frequency === 'yearly') {
      m.recurringYearly.push({ ...newItem, month: dueMonth });
    }

    await saveMonth(m);
    recName.value = ''; recAmount.value = ''; recDueMonth.value = '';
    recFrequencyMonthly.checked = true; // Reset to monthly
    yearlyDueMonthInput.classList.add('hidden'); // Hide month select
    
    refreshDashboard();
    alert('Recurring item saved');
  });

  // Delete Recurring Item (Crucial Logic Update)
  async function deleteRecurringItem(event) {
    if (!confirm('Are you sure you want to delete this recurring item?')) return;
    const btn = event.currentTarget;
    const indexToDelete = btn.dataset.index;
    const type = btn.dataset.type;

    // Fetch the month data to delete the item
    const m = await ensureMonth(viewingMonth); 

    if (type === 'monthly') {
      m.recurringMonthly.splice(indexToDelete, 1);
    } else if (type === 'yearly') {
      m.recurringYearly.splice(indexToDelete, 1);
    }

    await saveMonth(m);
    refreshDashboard();
  }


  // --- History Section Handlers (Minimal Updates) ---

  // History button click logic (now triggered when history tab is opened)
  document.querySelector('a[href="#history-panel"]').addEventListener('click', async () => {
    monthsList.innerHTML = ''; monthDetail.innerHTML = '';
    const months = await listMonths();
    if(months.length === 0) monthsList.innerHTML = '<div class="muted">No months yet</div>';

    months.forEach(m=>{
      const income = Number(m.income.base||0) + sumAmounts(m.income.extras);
      const daily = sumAmounts(m.daily);
      const monthlyRec = sumAmounts(m.recurringMonthly);
      const yearlyDue = m.recurringYearly.filter(item => {
          const mNum = Number(m.id.split('-')[1]);
          return Number(item.month) === mNum;
      }).reduce((s,y)=>s+Number(y.amount||0),0);
      
      const totalExpense = daily + monthlyRec + yearlyDue;
      const saved = income - totalExpense;
      
      const div = document.createElement('div');
      div.className = 'monthCard mdl-card mdl-shadow--2dp';
      div.style.padding = '16px';

      const savedClass = saved >= 0 ? 'color: var(--success);' : 'color: var(--danger);';
      div.innerHTML = `
        <div><strong>${m.id}</strong></div>
        <div class="muted">
          Income ${fmt(income)} · Expense ${fmt(totalExpense)} · <span style="${savedClass}">Saved ${fmt(saved)}</span>
        </div>
        <button class="mdl-button mdl-js-button small-btn mdl-button--colored" style="margin-top: 8px;">View Details</button>
      `;
      div.querySelector('button').addEventListener('click', ()=> showMonthDetail(m.id));
      monthsList.appendChild(div);
    });
  });

  async function showMonthDetail(id){
    const m = await getMonth(id);
    if(!m) return;
    
    // Recalculate based on current month's data
    const income = Number(m.income.base||0) + sumAmounts(m.income.extras);
    const daily = sumAmounts(m.daily);
    const monthlyRec = sumAmounts(m.recurringMonthly);
    
    const yearlyDue = m.recurringYearly.filter(item => {
        const mNum = Number(m.id.split('-')[1]);
        return Number(item.month) === mNum;
    }).reduce((s,y)=>s+Number(y.amount||0),0);
    
    const totalExpense = daily + monthlyRec + yearlyDue;
    const saved = income - totalExpense;

    monthDetail.innerHTML = `<h4>${m.id} details</h4>
      <div>Income: ${fmt(income)}</div>
      <div>Expenses: ${fmt(totalExpense)}</div>
      <div>Saved: ${fmt(saved)}</div>
      <hr>
      <div><b>Daily Expenses (${m.daily.length})</b><br>${(m.daily||[]).map(e=>`${e.date} · ${fmt(e.amount)} · ${e.category} · ${e.note||''}`).join('<br>')}</div>
      <hr>
      <div><b>Extras Income (${m.income.extras.length})</b><br>${(m.income.extras||[]).map(x=>`${x.label} · ${fmt(x.amount)}`).join('<br>')}</div>
    `;
  }

  // export CSV (updated to use flexible arrays)
  exportCSV.addEventListener('click', async ()=>{
    const months = await listMonths();
    let csv = 'Month,Income,Expenses\n';
    months.forEach(m=>{
      const income = Number(m.income.base||0) + sumAmounts(m.income.extras);
      
      const daily = sumAmounts(m.daily);
      const monthlyRec = sumAmounts(m.recurringMonthly);
      const yearlyDue = m.recurringYearly.filter(item => {
          const mNum = Number(m.id.split('-')[1]);
          return Number(item.month) === mNum;
      }).reduce((s,y)=>s+Number(y.amount||0),0);
      
      const exp = daily + monthlyRec + yearlyDue;
      csv += `${m.id},${income},${exp}\n`;
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

  // populate month selects for recurring yearly due month
  function populateMonthSelects(){
    const months = Array.from({length:12},(_,i)=>({v:i+1,n:getMonthName(i+1)}));
    recDueMonth.innerHTML = '<option value="">due month</option>';
    months.forEach(m=>{
      const opt = document.createElement('option'); opt.value = m.v; opt.textContent = m.n; recDueMonth.appendChild(opt);
    });
  }

  // --- Initialization ---
  
  // init
  await ensureMonth(viewingMonth);
  populateMonthSelects();
  refreshDashboard();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(()=>console.warn('sw failed'));
  }
  
  // PWA install prompt handler
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove('hidden');
  });
  installBtn.addEventListener('click', async ()=>{
    if(deferredPrompt){
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    }
  });

})();
