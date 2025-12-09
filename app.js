// app.js - Final Version: Includes Category Management, Effective Monthly Recurring Cost, and Seamless PWA Update Handler

(async function(){
  
  // --- NEW CONSTANT: Default Categories ---
  const DEFAULT_CATEGORIES = [
    'Housing', 'Food & Dining', 'Transportation', 'Utilities', 
    'Personal Care', 'Entertainment', 'Health', 'Debt & Loans', 
    'Savings & Invest', 'Miscellaneous'
  ];
  // ----------------------------------------
  
  // Assume openDB, ensureMonth, saveMonth, listMonths, getMonth, getMonthIdFromDate exist in db.js
  await openDB();

  // --- Core DOM References (Updated) ---
  
  // Dashboard Displays
  const currentMonthDisplay = document.getElementById('currentMonthDisplay');
  const baseIncomeDisplay = document.getElementById('baseIncomeDisplay');
  const extraIncomeDisplay = document.getElementById('extraIncomeDisplay');
  const totalIncomeDisplay = document.getElementById('totalIncomeDisplay');
  const expenseDisplay = document.getElementById('expenseDisplay');
  const monthlyRecurringDisplay = document.getElementById('monthlyRecurringDisplay');
  const yearlyDueThisMonthDisplay = document.getElementById('yearlyDueThisMonthDisplay');
  // 🆕 NEW: Reference for Effective Monthly Recurring Cost
  const effectiveMonthlyRecurringDisplay = document.getElementById('effectiveMonthlyRecurringDisplay');
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
  const categorySuggestions = document.getElementById('categorySuggestions');
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
  
  // PWA Install & Update Prompts
  const installBtn = document.getElementById('installBtn');
  // 🆕 NEW: Reference for the update bar in index.html
  const updateBar = document.getElementById('updateBar'); 
  let deferredPrompt;

  // --- State & Helpers ---
  let viewingMonth = new Date().toISOString().slice(0,7); // e.g. "2025-12"

  function setMonthLabel(id){
    const [y,m] = id.split('-');
    const date = new Date(Number(y), Number(m)-1, 1);
    currentMonthDisplay.textContent = date.toLocaleString(undefined,{month:'long',year:'numeric'});
  }
  function fmt(val){ return `₹ ${Number(val || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
  function getMonthName(monthNum){ return new Date(2000, monthNum - 1, 1).toLocaleString(undefined, {month:'long'}); }
  function sumAmounts(list){ return (list || []).reduce((sum, item) => sum + Number(item.amount || 0), 0); }
  
  // --- NEW FUNCTION: Populate Category Datalist ---
  async function populateCategoryDatalist(){
    const allMonths = await listMonths();
    const uniqueCategories = new Set(DEFAULT_CATEGORIES);

    allMonths.forEach(m => {
        (m.daily || []).forEach(e => {
            if (e.category) {
                uniqueCategories.add(e.category.trim());
            }
        });
    });

    categorySuggestions.innerHTML = '';
    
    const sortedCategories = Array.from(uniqueCategories).sort();

    sortedCategories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        categorySuggestions.appendChild(option);
    });
  }
  
  // --- NEW FUNCTION: Calculate Effective Monthly Cost ---
  async function calculateEffectiveMonthlyCost(monthId) {
      const m = await ensureMonth(monthId);

      const monthlyTotal = sumAmounts(m.recurringMonthly);
      const yearlyTotal = sumAmounts(m.recurringYearly);
      
      // Calculate the yearly equivalent divided by 12 months
      const yearlyMonthlyEquivalent = yearlyTotal / 12;
      
      const effectiveTotal = monthlyTotal + yearlyMonthlyEquivalent;
      
      return effectiveTotal;
  }
  // ----------------------------------------------------


  // --- Rendering Functions (No logic change) ---

  async function renderRecurringList(){
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
                <span class="mdl-list__item-sub-title">Category: ${e.category} | Note: ${e.note || 'N/A'} (on ${e.date})</span>
            </span>
        `;
        currentMonthExpenseList.appendChild(li);
    });
  }

  // --- Main Refresh (Updated for Effective Cost) ---

  async function refreshDashboard(){
    setMonthLabel(viewingMonth);
    const m = await ensureMonth(viewingMonth);
    const currentMonthNum = Number(viewingMonth.split('-')[1]);

    // 1. INCOME
    const baseIncome = Number(m.income.base || 0);
    const extrasTotal = sumAmounts(m.income.extras);
    const totalIncome = baseIncome + extrasTotal;
    
    incomeInput.value = baseIncome > 0 ? baseIncome : '';
    baseIncomeDisplay.textContent = fmt(baseIncome);
    extraIncomeDisplay.textContent = fmt(extrasTotal);
    totalIncomeDisplay.textContent = fmt(totalIncome);

    // 2. EXPENSE CALCULATIONS
    const dailyTotal = sumAmounts(m.daily);
    const monthlyRecurringTotal = sumAmounts(m.recurringMonthly);

    const yearlyDueThisMonthTotal = m.recurringYearly
        .filter(item => Number(item.month) === currentMonthNum)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        
    // Calculate and display Effective Monthly Recurring Cost
    const effectiveMonthlyCost = await calculateEffectiveMonthlyCost(viewingMonth);

    // Total Outflow
    const totalOutflow = dailyTotal + monthlyRecurringTotal + yearlyDueThisMonthTotal;

    expenseDisplay.textContent = fmt(dailyTotal);
    monthlyRecurringDisplay.textContent = fmt(monthlyRecurringTotal);
    yearlyDueThisMonthDisplay.textContent = fmt(yearlyDueThisMonthTotal);
    // Display the new metric
    effectiveMonthlyRecurringDisplay.textContent = fmt(effectiveMonthlyCost);

    // 3. SAVINGS
    const savings = totalIncome - totalOutflow;
    savedDisplay.textContent = fmt(savings);
    savedDisplay.parentElement.classList.toggle('expense', savings < 0);
    savedDisplay.parentElement.classList.toggle('saved', savings >= 0);

    // 4. RENDER LISTS & CATEGORIES
    await renderExpenseList(viewingMonth);
    await renderRecurringList();
    await populateCategoryDatalist();
  }
  
  // --- Event Handlers (Expense Add Modified for cleanup) ---

  // ... (navigation, income listeners remain the same) ...

  // Add expense
  addExpBtn.addEventListener('click', async ()=>{
    const amount = Number(expAmount.value || 0);
    const category = (expCategory.value || 'Miscellaneous').trim();
    
    if(!amount || amount <= 0){ alert('Enter valid amount'); return; }
    
    const dateStr = expDate.value || new Date().toISOString().slice(0,10);
    const mid = getMonthIdFromDate(dateStr);
    const m = await ensureMonth(mid);
    
    m.daily.push({ amount, category, note: expNote.value || '', date: dateStr, ts: Date.now() });
    await saveMonth(m);
    
    expAmount.value=''; expCategory.value=''; expNote.value='';
    
    // CRITICAL MDL FIX: Manually clear the active/dirty state of MDL inputs
    const inputs = [expAmount, expCategory, expNote];
    inputs.forEach(input => {
        const parent = input.closest('.mdl-textfield');
        if(parent) {
            parent.classList.remove('is-dirty');
            parent.classList.remove('is-focused');
        }
    });
    
    if(mid === viewingMonth) refreshDashboard();
    else populateCategoryDatalist(); 
    
    alert('Expense saved');
  });
  
  // ... (Existing FAB, Recurring, and History listeners remain the same) ...
  
  // Delete Recurring Item (needs to be defined before calling)
  async function deleteRecurringItem(event) {
    if (!confirm('Are you sure you want to delete this recurring item?')) return;
    const btn = event.currentTarget;
    const indexToDelete = btn.dataset.index;
    const type = btn.dataset.type;

    const m = await ensureMonth(viewingMonth); 

    if (type === 'monthly') {
      m.recurringMonthly.splice(indexToDelete, 1);
    } else if (type === 'yearly') {
      m.recurringYearly.splice(indexToDelete, 1);
    }

    await saveMonth(m);
    refreshDashboard();
  }


  // populate month selects for recurring yearly due month
  function populateMonthSelects(){
    const months = Array.from({length:12},(_,i)=>({v:i+1,n:getMonthName(i+1)}));
    recDueMonth.innerHTML = '<option value="">due month</option>';
    months.forEach(m=>{
      const opt = document.createElement('option'); opt.value = m.v; opt.textContent = m.n; recDueMonth.appendChild(opt);
    });
  }
  
  // 🆕 NEW FUNCTION: Show the update prompt bar
  function showUpdatePrompt() {
    if (updateBar) {
        updateBar.classList.remove('hidden');
        updateBar.querySelector('#reloadAppBtn').addEventListener('click', () => {
            // Reload the page to load the new Service Worker and assets
            window.location.reload(); 
        });
    }
  }


  // --- Initialization (Updated with SW listener) ---
  
  // Set default date for expense input
  expDate.value = new Date().toISOString().slice(0,10);

  await ensureMonth(viewingMonth);
  populateMonthSelects();
  refreshDashboard();
  
  // --- 📢 PWA Service Worker Update Handler ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => {
        console.log('SW registration successful');

        // Check for updates every time the app loads
        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // Show a message to the user that an update is ready
                    showUpdatePrompt(); 
                }
            });
        });
      })
      .catch(() => console.warn('SW registration failed'));

    // PWA install prompt handler
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      installBtn.classList.remove('hidden');
    });
    
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.classList.add('hidden');
      }
    });
  }
  // --- END PWA Update Handler ---

})();
