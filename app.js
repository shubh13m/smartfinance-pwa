// app.js - Updated with 50/20/20/10 Financial Strategy Logic

(async function(){
  
  const DEFAULT_CATEGORIES = ['Housing', 'Food & Dining', 'Transportation', 'Utilities', 'Personal Care', 'Entertainment', 'Health', 'Debt & Loans', 'Savings & Invest', 'Miscellaneous'];
  await openDB();

  // --- Core DOM References ---
  const currentMonthDisplay = document.getElementById('currentMonthDisplay');
  const baseIncomeDisplay = document.getElementById('baseIncomeDisplay');
  const extraIncomeDisplay = document.getElementById('extraIncomeDisplay');
  const totalIncomeDisplay = document.getElementById('totalIncomeDisplay');
  const expenseDisplay = document.getElementById('expenseDisplay');
  const monthlyRecurringDisplay = document.getElementById('monthlyRecurringDisplay');
  const yearlyDueThisMonthDisplay = document.getElementById('yearlyDueThisMonthDisplay');
  const effectiveMonthlyRecurringDisplay = document.getElementById('effectiveMonthlyRecurringDisplay');
  const savedDisplay = document.getElementById('savedDisplay');

  // New Strategy DOM References
  const goalExpDisplay = document.getElementById('goalExpDisplay');
  const goalInvDisplay = document.getElementById('goalInvDisplay');
  const goalSavDisplay = document.getElementById('goalSavDisplay');
  const goalPreDisplay = document.getElementById('goalPreDisplay');
  const surplusDisplay = document.getElementById('surplusDisplay');
  const totalPowerDisplay = document.getElementById('totalPowerDisplay');
  const surplusLabel = document.getElementById('surplusLabel');

  const incomeInput = document.getElementById('incomeInput');
  const saveIncomeBtn = document.getElementById('saveIncome');
  const extraLabel = document.getElementById('extraLabel');
  const extraAmount = document.getElementById('extraAmount');
  const addExtraIncomeBtn = document.getElementById('addExtraIncome');
  const addExpBtn = document.getElementById('addExpBtn');
  const expAmount = document.getElementById('expAmount');
  const expCategory = document.getElementById('expCategory');
  const categorySuggestions = document.getElementById('categorySuggestions');
  const expNote = document.getElementById('expNote');
  const expDate = document.getElementById('expDate');
  const currentMonthExpenseList = document.getElementById('currentMonthExpenseList');
  const recName = document.getElementById('recName');
  const recAmount = document.getElementById('recAmount');
  const recFrequencyMonthly = document.getElementById('recMonthly');
  const recFrequencyYearly = document.getElementById('recYearly');
  const yearlyDueMonthInput = document.getElementById('yearlyDueMonthInput');
  const recDueMonth = document.getElementById('recDueMonth');
  const addRecurringItemBtn = document.getElementById('addRecurringItemBtn');
  const recurringItemList = document.getElementById('recurringItemList');
  const prevMonthBtn = document.getElementById('prevMonthBtn');
  const nextMonthBtn = document.getElementById('nextMonthBtn');
  const quickAddExpenseFAB = document.getElementById('quickAddExpenseFAB');
  const exportCSV = document.getElementById('exportCSV');
  const clearAll = document.getElementById('clearAll');
  const monthsList = document.getElementById('monthsList');
  const monthDetail = document.getElementById('monthDetail');
  const installBtn = document.getElementById('installBtn');
  const updateBar = document.getElementById('updateBar'); 
  let deferredPrompt;
  let viewingMonth = new Date().toISOString().slice(0,7);

  function getMonthIdFromDate(dateStr) { return dateStr.slice(0, 7); }
  function setMonthLabel(id){
    const [y,m] = id.split('-');
    const date = new Date(Number(y), Number(m)-1, 1);
    currentMonthDisplay.textContent = date.toLocaleString(undefined,{month:'long',year:'numeric'});
  }
  function fmt(val){ return `₹ ${Number(val || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
  function getMonthName(monthNum){ return new Date(2000, monthNum - 1, 1).toLocaleString(undefined, {month:'long'}); }
  function sumAmounts(list){ return (list || []).reduce((sum, item) => sum + Number(item.amount || 0), 0); }
  
  async function populateCategoryDatalist(){
    const allMonths = await listMonths();
    const uniqueCategories = new Set(DEFAULT_CATEGORIES);
    allMonths.forEach(m => { (m.daily || []).forEach(e => { if (e.category) uniqueCategories.add(e.category.trim()); }); });
    if (categorySuggestions) {
      categorySuggestions.innerHTML = '';
      Array.from(uniqueCategories).sort().forEach(cat => {
          const option = document.createElement('option'); option.value = cat; categorySuggestions.appendChild(option);
      });
    }
  }
  
  async function calculateEffectiveMonthlyCost(monthId) {
      const m = await ensureMonth(monthId);
      const monthlyTotal = sumAmounts(m.recurringMonthly);
      const yearlyTotal = sumAmounts(m.recurringYearly);
      return monthlyTotal + (yearlyTotal / 12);
  }

  async function deleteRecurringItem(event) {
    if (!confirm('Are you sure?')) return;
    const btn = event.currentTarget;
    const idToDelete = Number(btn.dataset.id);
    const type = btn.dataset.type;
    const m = await ensureMonth(viewingMonth); 
    if (type === 'monthly') { m.recurringMonthly = m.recurringMonthly.filter(item => (item.ts || 0) !== idToDelete); }
    else if (type === 'yearly') { m.recurringYearly = m.recurringYearly.filter(item => (item.ts || 0) !== idToDelete); }
    await saveMonth(m);
    refreshDashboard();
  }
  
  function populateMonthSelects(){
    const months = Array.from({length:12},(_,i)=>({v:i+1,n:getMonthName(i+1)}));
    recDueMonth.innerHTML = '<option value="">due month</option>';
    months.forEach(m=>{ const opt = document.createElement('option'); opt.value = m.v; opt.textContent = m.n; recDueMonth.appendChild(opt); });
  }

  async function renderRecurringList(){
    const m = await ensureMonth(viewingMonth);
    recurringItemList.innerHTML = '';
    const monthly = m.recurringMonthly || [];
    const yearly = m.recurringYearly || [];
    if(monthly.length === 0 && yearly.length === 0){
        recurringItemList.innerHTML = `<div class="muted" style="padding: 16px;">No recurring items.</div>`;
        return;
    }
    const createItem = (item, type) => {
        const li = document.createElement('li');
        li.className = 'mdl-list__item mdl-list__item--two-line';
        const label = type === 'yearly' ? `Yearly (${getMonthName(item.month)})` : 'Monthly';
        const itemTs = item.ts || 0; 
        li.innerHTML = `<span class="mdl-list__item-primary-content"><span>${item.name}</span><span class="mdl-list__item-sub-title">${label} - ${fmt(item.amount)}</span></span>
            <span class="mdl-list__item-secondary-content"><button class="mdl-button mdl-js-button mdl-button--icon delete-rec" data-id="${itemTs}" data-type="${type}"><i class="material-icons" style="color:#F44336;">delete</i></button></span>`;
        return li;
    };
    monthly.forEach(item => recurringItemList.appendChild(createItem(item, 'monthly')));
    yearly.forEach(item => recurringItemList.appendChild(createItem(item, 'yearly')));
    document.querySelectorAll('.delete-rec').forEach(btn => btn.addEventListener('click', deleteRecurringItem));
  }

  async function renderExpenseList(monthId){
    const m = await getMonth(monthId);
    currentMonthExpenseList.innerHTML = '';
    const expenses = m.daily || [];
    if(expenses.length === 0){ currentMonthExpenseList.innerHTML = `<div class="muted" style="padding: 16px;">No daily expenses.</div>`; return; }
    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
    expenses.forEach(e => {
        const li = document.createElement('li');
        li.className = 'mdl-list__item mdl-list__item--two-line';
        li.innerHTML = `<span class="mdl-list__item-primary-content"><span style="color:#F44336; font-weight:bold;">${fmt(e.amount)}</span><span class="mdl-list__item-sub-title">${e.category} | ${e.note || ''} (${e.date})</span></span>`;
        currentMonthExpenseList.appendChild(li);
    });
  }

  async function refreshDashboard(){
    setMonthLabel(viewingMonth);
    const m = await ensureMonth(viewingMonth);
    const currentMonthNum = Number(viewingMonth.split('-')[1]);

    const baseIncome = Number(m.income.base || 0);
    const extrasTotal = sumAmounts(m.income.extras);
    const totalIncome = baseIncome + extrasTotal;
    
    incomeInput.value = baseIncome > 0 ? baseIncome : '';
    baseIncomeDisplay.textContent = fmt(baseIncome);
    extraIncomeDisplay.textContent = fmt(extrasTotal);
    totalIncomeDisplay.textContent = fmt(totalIncome);

    const dailyTotal = sumAmounts(m.daily);
    const monthlyRecurringTotal = sumAmounts(m.recurringMonthly);
    const yearlyDueThisMonthTotal = m.recurringYearly
        .filter(item => Number(item.month) === currentMonthNum)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        
    const effectiveMonthlyCost = await calculateEffectiveMonthlyCost(viewingMonth);
    const totalOutflow = dailyTotal + monthlyRecurringTotal + yearlyDueThisMonthTotal;

    expenseDisplay.textContent = fmt(dailyTotal);
    monthlyRecurringDisplay.textContent = fmt(monthlyRecurringTotal);
    yearlyDueThisMonthDisplay.textContent = fmt(yearlyDueThisMonthTotal);
    effectiveMonthlyRecurringDisplay.textContent = fmt(effectiveMonthlyCost);

    // 🟢 NEW: Financial Strategy Calculations (50/20/20/10)
    const goalExp = totalIncome * 0.50;
    const goalInv = totalIncome * 0.20;
    const goalSav = totalIncome * 0.20;
    const goalPre = totalIncome * 0.10;

    goalExpDisplay.textContent = fmt(goalExp);
    goalInvDisplay.textContent = fmt(goalInv);
    goalSavDisplay.textContent = fmt(goalSav);
    goalPreDisplay.textContent = fmt(goalPre);

    // Surplus: Gap between 50% Goal and Actual Effective Burden
    const surplus = Math.max(0, goalExp - effectiveMonthlyCost);
    surplusDisplay.textContent = fmt(surplus);
    surplusLabel.textContent = effectiveMonthlyCost > goalExp ? "Expense Overrun:" : "Expense Surplus:";
    surplusDisplay.style.color = surplus > 0 ? "#4CAF50" : "#212121";

    // Total Prepay Power
    totalPowerDisplay.textContent = fmt(goalPre + surplus);

    const savings = totalIncome - totalOutflow;
    savedDisplay.textContent = fmt(savings);
    savedDisplay.parentElement.style.color = savings < 0 ? "#F44336" : "#4CAF50";

    await renderExpenseList(viewingMonth);
    await renderRecurringList();
    await populateCategoryDatalist();
    await renderHistory();
  }
  
  async function renderHistory(){
    const monthIds = await listMonths();
    monthsList.innerHTML = '';
    monthIds.sort().reverse().forEach(id => {
      const btn = document.createElement('button');
      btn.className = 'mdl-button mdl-js-button mdl-button--raised';
      btn.textContent = id;
      btn.style.margin = "4px";
      btn.addEventListener('click', async () => {
        const m = await getMonth(id);
        monthDetail.innerHTML = `<h3>Summary for ${id}</h3><pre>${JSON.stringify(m, null, 2)}</pre>`;
      });
      monthsList.appendChild(btn);
    });
  }
  
  prevMonthBtn.addEventListener('click', () => {
    let [y, m] = viewingMonth.split('-').map(Number);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
    viewingMonth = `${y}-${String(m).padStart(2, '0')}`;
    refreshDashboard();
  });

  nextMonthBtn.addEventListener('click', () => {
    let [y, m] = viewingMonth.split('-').map(Number);
    m += 1; if (m === 13) { m = 1; y += 1; }
    viewingMonth = `${y}-${String(m).padStart(2, '0')}`;
    refreshDashboard();
  });

  saveIncomeBtn.addEventListener('click', async () => {
    const amount = Number(incomeInput.value || 0);
    const m = await ensureMonth(viewingMonth);
    m.income.base = amount;
    await saveMonth(m);
    refreshDashboard();
    alert('Income saved!');
  });

  addExtraIncomeBtn.addEventListener('click', async () => {
    const label = (extraLabel.value || 'Extra').trim();
    const amount = Number(extraAmount.value || 0);
    if (!label || amount <= 0) return;
    const m = await ensureMonth(viewingMonth);
    m.income.extras.push({ label, amount, ts: Date.now() });
    await saveMonth(m);
    extraLabel.value = ''; extraAmount.value = '';
    refreshDashboard();
  });
  
  addExpBtn.addEventListener('click', async ()=>{
    const amount = Number(expAmount.value || 0);
    const category = (expCategory.value || 'Miscellaneous').trim();
    if(!amount || amount <= 0) return;
    const dateStr = expDate.value || new Date().toISOString().slice(0,10);
    const m = await ensureMonth(getMonthIdFromDate(dateStr));
    m.daily.push({ amount, category, note: expNote.value || '', date: dateStr, ts: Date.now() });
    await saveMonth(m);
    expAmount.value=''; expCategory.value=''; expNote.value='';
    refreshDashboard();
    alert('Expense saved');
  });

  recFrequencyMonthly.addEventListener('change', () => { yearlyDueMonthInput.classList.add('hidden'); });
  recFrequencyYearly.addEventListener('change', () => { yearlyDueMonthInput.classList.remove('hidden'); });

  addRecurringItemBtn.addEventListener('click', async () => {
    const name = (recName.value || 'Item').trim();
    const amount = Number(recAmount.value || 0);
    const frequency = document.querySelector('input[name="recFrequency"]:checked').value;
    if (!name || amount <= 0) return;
    const m = await ensureMonth(viewingMonth);
    const item = { name, amount, ts: Date.now() };
    if (frequency === 'monthly') { m.recurringMonthly.push(item); }
    else {
      const dueMonth = Number(recDueMonth.value);
      if (!dueMonth) { alert('Select due month'); return; }
      item.month = dueMonth;
      m.recurringYearly.push(item);
    }
    await saveMonth(m);
    recName.value = ''; recAmount.value = '';
    refreshDashboard();
    alert('Recurring item saved!');
  });
  
  quickAddExpenseFAB.addEventListener('click', () => {
      const tab = document.querySelector('a[href="#expenses-panel"]');
      if (tab) tab.click();
  });

  clearAll.addEventListener('click', async () => {
    if(confirm('Delete ALL data?')) { await clearAllData(); window.location.reload(); }
  });

  function showUpdatePrompt() {
    if (updateBar) {
        updateBar.classList.remove('hidden');
        updateBar.querySelector('#reloadAppBtn').addEventListener('click', () => { window.location.reload(); });
    }
  }

  expDate.value = new Date().toISOString().slice(0,10);
  await ensureMonth(viewingMonth);
  populateMonthSelects();
  refreshDashboard();
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').then(reg => {
        reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            nw.addEventListener('statechange', () => {
                if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt(); 
            });
        });
    });
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferredPrompt = e;
      installBtn.classList.remove('hidden');
    });
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; installBtn.classList.add('hidden'); }
    });
  }
})();
