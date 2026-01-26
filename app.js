(async function() {
    // --- 1. Wait for DOM ---
    if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
    }

    const DEFAULT_CATEGORIES = ['Housing', 'Food & Dining', 'Transportation', 'Utilities', 'Personal Care', 'Entertainment', 'Health', 'Debt & Loans', 'Savings & Invest', 'Miscellaneous'];

    // --- 2. Core DOM References ---
    const currentMonthDisplay = document.getElementById('currentMonthDisplay');
    const baseIncomeDisplay = document.getElementById('baseIncomeDisplay');
    const extraIncomeDisplay = document.getElementById('extraIncomeDisplay');
    const totalIncomeDisplay = document.getElementById('totalIncomeDisplay');
    const expenseDisplay = document.getElementById('expenseDisplay');
    const monthlyRecurringDisplay = document.getElementById('monthlyRecurringDisplay');
    const yearlyDueThisMonthDisplay = document.getElementById('yearlyDueThisMonthDisplay');
    const effectiveMonthlyRecurringDisplay = document.getElementById('effectiveMonthlyRecurringDisplay');
    const totalMonthlyExpenseDisplay = document.getElementById('totalMonthlyExpenseDisplay');

    const savedDisplay = document.getElementById('savedDisplay');
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
    
    // UI Fix References
    const updateBar = document.getElementById('updateBar');
    const reloadAppBtn = document.getElementById('reloadAppBtn');

    let deferredPrompt;
    
    // FIX: Use a more stable date slice for YYYY-MM
    const now = new Date();
    let viewingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let isNavigating = false;

    // --- Helpers ---
    function updateLocalTimestamp() {
        localStorage.setItem('sf_last_saved', Date.now());
    }

    function upgradeMDL() {
        if (typeof componentHandler !== 'undefined') {
            componentHandler.upgradeDom();
        }
    }

    function getReadableMonthName(id) {
        const monthId = (typeof id === 'object' && id !== null) ? id.id : id;
        if (!monthId || typeof monthId !== 'string' || !monthId.includes('-')) return monthId || "Unknown Month";
        try {
            const [year, month] = monthId.split('-');
            const date = new Date(year, month - 1);
            return date.toLocaleString('default', { month: 'long', year: 'numeric' });
        } catch (e) { return monthId; }
    }

    function setMonthLabel(id) {
        if (currentMonthDisplay) {
            currentMonthDisplay.textContent = getReadableMonthName(id);
        }
    }

    function fmt(val) { return `₹ ${Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
    function getMonthName(monthNum) { return new Date(2000, monthNum - 1, 1).toLocaleString(undefined, { month: 'long' }); }

    function sumAmounts(list) {
        return (list || []).reduce((sum, item) => {
            return (Math.round(sum * 100) + Math.round(Number(item.amount || 0) * 100)) / 100;
        }, 0);
    }

    // --- Core Functions ---
    async function populateCategoryDatalist() {
        try {
            const allMonths = await listMonths();
            const uniqueCategories = new Set(DEFAULT_CATEGORIES);
            allMonths.forEach(m => {
                (m.daily || []).forEach(e => { if (e.category) uniqueCategories.add(e.category.trim()); });
            });
            if (categorySuggestions) {
                categorySuggestions.innerHTML = '';
                Array.from(uniqueCategories).sort().forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat;
                    categorySuggestions.appendChild(option);
                });
            }
        } catch (err) { console.warn("Datalist failed", err); }
    }

    async function calculateEffectiveMonthlyCost(monthId) {
        const m = await ensureMonth(monthId);
        return sumAmounts(m.recurringMonthly) + (sumAmounts(m.recurringYearly) / 12);
    }

    async function refreshDashboard() {
        setMonthLabel(viewingMonth); // Immediate update
        
        const m = await ensureMonth(viewingMonth);
        const currentMonthNum = Number(viewingMonth.split('-')[1]);
        const baseIncome = Number(m.income.base || 0);
        const extrasTotal = sumAmounts(m.income.extras);
        const totalIncome = baseIncome + extrasTotal;

        if (incomeInput) incomeInput.value = baseIncome > 0 ? baseIncome : '';
        baseIncomeDisplay.textContent = fmt(baseIncome);
        extraIncomeDisplay.textContent = fmt(extrasTotal);
        totalIncomeDisplay.textContent = fmt(totalIncome);

        const dailyTotal = sumAmounts(m.daily);
        const monthlyRec = sumAmounts(m.recurringMonthly);
        const yearlyDue = (m.recurringYearly || []).filter(item => Number(item.month) === currentMonthNum).reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const effectiveCost = await calculateEffectiveMonthlyCost(viewingMonth);
        const totalMonthlyExpense = dailyTotal + effectiveCost;

        expenseDisplay.textContent = fmt(dailyTotal);
        monthlyRecurringDisplay.textContent = fmt(monthlyRec);
        yearlyDueThisMonthDisplay.textContent = fmt(yearlyDue);
        effectiveMonthlyRecurringDisplay.textContent = fmt(effectiveCost);

        if (totalMonthlyExpenseDisplay) {
            totalMonthlyExpenseDisplay.textContent = fmt(totalMonthlyExpense);
            totalMonthlyExpenseDisplay.style.color = totalMonthlyExpense > (totalIncome * 0.5) ? "#F44336" : "#212121";
        }

        const goalExp = totalIncome * 0.50;
        goalExpDisplay.textContent = fmt(goalExp);
        goalInvDisplay.textContent = fmt(totalIncome * 0.20);
        goalSavDisplay.textContent = fmt(totalIncome * 0.20);
        const goalPre = totalIncome * 0.10;
        goalPreDisplay.textContent = fmt(goalPre);

        const surplus = totalIncome > 0 ? goalExp - totalMonthlyExpense : 0;
        surplusDisplay.textContent = fmt(surplus);
        surplusLabel.textContent = surplus < 0 ? "Budget Overrun:" : "Expense Surplus:";
        surplusDisplay.style.color = surplus < 0 ? "#F44336" : "#4CAF50";

        totalPowerDisplay.textContent = fmt(goalPre + surplus);

        const totalOutflow = dailyTotal + monthlyRec + yearlyDue;
        const savings = totalIncome - totalOutflow;
        savedDisplay.textContent = fmt(savings);
        savedDisplay.parentElement.style.color = savings < 0 ? "#F44336" : "#4CAF50";

        await renderExpenseList(viewingMonth);
        await renderRecurringList();
        await populateCategoryDatalist();
        await renderHistory();
        upgradeMDL();
    }

    // --- List Renderers ---
    async function renderRecurringList() {
        const m = await ensureMonth(viewingMonth);
        recurringItemList.innerHTML = '';
        const items = [...(m.recurringMonthly || []).map(i => ({...i, type:'monthly'})), ...(m.recurringYearly || []).map(i => ({...i, type:'yearly'}))];
        
        if (items.length === 0) {
            recurringItemList.innerHTML = '<div class="muted" style="padding:16px;">No recurring items.</div>';
            return;
        }

        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'mdl-list__item mdl-list__item--two-line';
            const label = item.type === 'yearly' ? `Yearly (${getMonthName(item.month)})` : 'Monthly';
            li.innerHTML = `
                <span class="mdl-list__item-primary-content">
                    <span>${item.name}</span>
                    <span class="mdl-list__item-sub-title">${label} - ${fmt(item.amount)}</span>
                </span>
                <span class="mdl-list__item-secondary-content">
                    <button class="mdl-button mdl-js-button mdl-button--icon delete-rec" data-id="${item.ts}" data-type="${item.type}"><i class="material-icons" style="color:#F44336;">cancel</i></button>
                </span>`;
            recurringItemList.appendChild(li);
        });
        document.querySelectorAll('.delete-rec').forEach(btn => btn.addEventListener('click', deleteRecurringItem));
        upgradeMDL();
    }

    async function renderExpenseList(monthId) {
        const m = await getMonth(monthId);
        currentMonthExpenseList.innerHTML = '';
        const expenses = m ? (m.daily || []) : [];
        if (expenses.length === 0) {
            currentMonthExpenseList.innerHTML = '<div class="muted" style="padding:16px;">No expenses.</div>';
            return;
        }
        expenses.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(e => {
            const li = document.createElement('li');
            li.className = 'mdl-list__item mdl-list__item--two-line';
            li.innerHTML = `
                <span class="mdl-list__item-primary-content">
                    <span style="color:#F44336; font-weight:bold;">${fmt(e.amount)}</span>
                    <span class="mdl-list__item-sub-title">${e.category} | ${e.note || ''} (${e.date})</span>
                </span>
                <span class="mdl-list__item-secondary-content">
                    <button class="mdl-button mdl-js-button mdl-button--icon delete-daily" data-id="${e.ts}"><i class="material-icons" style="color:#F44336;">delete_outline</i></button>
                </span>`;
            currentMonthExpenseList.appendChild(li);
        });
        document.querySelectorAll('.delete-daily').forEach(btn => btn.addEventListener('click', deleteDailyExpense));
        upgradeMDL();
    }

    async function renderHistory() {
        const data = await listMonths();
        monthsList.innerHTML = '';
        data.sort((a, b) => b.id.localeCompare(a.id)).forEach(m => {
            const btn = document.createElement('button');
            btn.className = 'mdl-button mdl-js-button mdl-button--raised';
            btn.textContent = getReadableMonthName(m.id);
            btn.style.margin = "4px";
            btn.onclick = () => {
                const inc = (m.income?.base || 0) + sumAmounts(m.income?.extras);
                const exp = sumAmounts(m.daily);
                monthDetail.innerHTML = `<div style="background:#f9f9f9; padding:15px; border-radius:8px;">
                    <h4>${getReadableMonthName(m.id)}</h4>
                    <p>Income: ${fmt(inc)} | Daily: ${fmt(exp)}</p>
                </div>`;
            };
            monthsList.appendChild(btn);
        });
    }

    // --- Events ---
    async function deleteRecurringItem(e) {
        if (!confirm('Delete this and all future occurrences?')) return;
        const { id, type } = e.currentTarget.dataset;
        const m = await ensureMonth(viewingMonth);
        
        let deletedItem;
        if (type === 'monthly') {
            deletedItem = m.recurringMonthly.find(i => i.ts == id);
            m.recurringMonthly = m.recurringMonthly.filter(i => i.ts != id);
        } else {
            deletedItem = m.recurringYearly.find(i => i.ts == id);
            m.recurringYearly = m.recurringYearly.filter(i => i.ts != id);
        }
        
        await saveMonth(m);
        updateLocalTimestamp(); // Sync Trigger Fix
        
        // Ripple the deletion to all future months
        if (deletedItem) {
            await propagateRecurringChange(viewingMonth, { ts: Number(id), type }, 'delete');
        }
        
        refreshDashboard();
    }

    async function deleteDailyExpense(e) {
        if (!confirm('Delete?')) return;
        const id = e.currentTarget.dataset.id;
        const m = await ensureMonth(viewingMonth);
        m.daily = m.daily.filter(i => i.ts != id);
        await saveMonth(m);
        updateLocalTimestamp(); // Sync Trigger Fix
        refreshDashboard();
    }

    if (prevMonthBtn) prevMonthBtn.onclick = () => changeMonth(-1);
    if (nextMonthBtn) nextMonthBtn.onclick = () => changeMonth(1);

    async function changeMonth(delta) {
        if (isNavigating) return;
        isNavigating = true;
        let [y, m] = viewingMonth.split('-').map(Number);
        m += delta;
        if (m === 0) { m = 12; y -= 1; } else if (m === 13) { m = 1; y += 1; }
        viewingMonth = `${y}-${String(m).padStart(2, '0')}`;
        await refreshDashboard();
        isNavigating = false;
    }

    if (saveIncomeBtn) {
        saveIncomeBtn.onclick = async () => {
            const m = await ensureMonth(viewingMonth);
            m.income.base = Number(incomeInput.value);
            await saveMonth(m);
            updateLocalTimestamp(); // Sync Trigger Fix
            refreshDashboard();
        };
    }

    if (addExpBtn) {
        addExpBtn.onclick = async () => {
            const amount = Number(expAmount.value);
            if (amount <= 0) return;
            const dateStr = expDate.value || new Date().toISOString().split('T')[0];
            const m = await ensureMonth(dateStr.slice(0, 7));
            m.daily.push({ amount, category: expCategory.value, note: expNote.value, date: dateStr, ts: Date.now() });
            await saveMonth(m);
            updateLocalTimestamp(); // Sync Trigger Fix
            expAmount.value = ''; expNote.value = '';
            refreshDashboard();
        };
    }

    if (addRecurringItemBtn) {
        addRecurringItemBtn.onclick = async () => {
            const name = recName.value;
            const amount = Number(recAmount.value);
            if (!name || amount <= 0) return;

            const isYearly = recFrequencyYearly.checked;
            const newItem = {
                name,
                amount,
                ts: Date.now(),
                type: isYearly ? 'yearly' : 'monthly'
            };

            if (isYearly) newItem.month = Number(recDueMonth.value);

            const m = await ensureMonth(viewingMonth);
            if (isYearly) m.recurringYearly.push(newItem);
            else m.recurringMonthly.push(newItem);

            await saveMonth(m);
            updateLocalTimestamp(); // Sync Trigger Fix
            
            // Ripple the new item to all existing future months
            await propagateRecurringChange(viewingMonth, newItem, 'add');

            // Clear inputs
            recName.value = ''; recAmount.value = '';
            refreshDashboard();
        };
    }

    // --- Initialization ---
    (async function init() {
        try {
            setMonthLabel(viewingMonth);
            await openDB();
            
            // Populate Dropdowns
            const monthsArr = Array.from({ length: 12 }, (_, i) => ({ v: i + 1, n: getMonthName(i + 1) }));
            if (recDueMonth) {
                recDueMonth.innerHTML = '<option value="">due month</option>';
                monthsArr.forEach(m => {
                    const opt = document.createElement('option'); opt.value = m.v; opt.textContent = m.n;
                    recDueMonth.appendChild(opt);
                });
            }

            if (expDate) expDate.value = new Date().toISOString().split('T')[0];
            await refreshDashboard();
        } catch (err) {
            console.error("Init failed", err);
        }
    })();

    // --- PWA / Service Worker Logic ---
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js').then(reg => {
            reg.onupdatefound = () => {
                const installingWorker = reg.installing;
                installingWorker.onstatechange = () => {
                    if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        if (updateBar) updateBar.classList.remove('hidden');
                    }
                };
            };
        });
    }

    if (reloadAppBtn) {
        reloadAppBtn.onclick = () => {
            window.location.reload();
        };
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installBtn) installBtn.classList.remove('hidden');
    });

    if (installBtn) {
        installBtn.onclick = () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt = null;
                installBtn.classList.add('hidden');
            }
        };
    }
})();