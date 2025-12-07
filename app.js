// === GLOBAL VARIABLES ===
let currentMonthId = new Date().toISOString().slice(0,7); // YYYY-MM
let deferredPrompt;

// === INSTALL PROMPT HANDLER ===
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
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

// === DOM ELEMENTS ===
const incomeInput = document.getElementById('incomeInput');
const saveIncomeBtn = document.getElementById('saveIncome');
const incomeVal = document.getElementById('incomeVal');
const expenseVal = document.getElementById('expenseVal');
const investVal = document.getElementById('investVal');
const saveVal = document.getElementById('saveVal');
const currentMonthLabel = document.getElementById('currentMonthLabel');

const openAddExpenseBtn = document.getElementById('openAddExpense');
const addExpenseSection = document.getElementById('addExpenseSection');
const cancelAddExp = document.getElementById('cancelAddExp');
const addExpBtn = document.getElementById('addExpBtn');
const expAmount = document.getElementById('expAmount');
const expCategory = document.getElementById('expCategory');
const expNote = document.getElementById('expNote');
const expDate = document.getElementById('expDate');

const prevMonthBtn = document.getElementById('prevMonthBtn');
const nextMonthBtn = document.getElementById('nextMonthBtn');

// Recurring
const openRecurringBtn = document.getElementById('openRecurring');
const recurringSection = document.getElementById('recurringSection');
const cancelRecurring = document.getElementById('cancelRecurring');
const saveRecurringBtn = document.getElementById('saveRecurring');

const recRent = document.getElementById('rec_rent');
const recEMI = document.getElementById('rec_emi');
const recBills = document.getElementById('rec_bills');
const recOther = document.getElementById('rec_other');

const yrInsuranceAmt = document.getElementById('yr_insurance_amt');
const yrInsuranceMonth = document.getElementById('yr_insurance_month');
const yrSubAmt = document.getElementById('yr_sub_amt');
const yrSubMonth = document.getElementById('yr_sub_month');

// Investments
const openInvestBtn = document.getElementById('openInvest');
const investSection = document.getElementById('investSection');
const cancelInvest = document.getElementById('cancelInvest');
const saveInvestBtn = document.getElementById('saveInvest');
const invSIP = document.getElementById('inv_sip');
const invStocks = document.getElementById('inv_stocks');
const invOther = document.getElementById('inv_other');

// History
const openHistoryBtn = document.getElementById('openHistory');
const historySection = document.getElementById('historySection');
const monthsList = document.getElementById('monthsList');
const monthDetail = document.getElementById('monthDetail');
const exportCSVBtn = document.getElementById('exportCSV');
const clearAllBtn = document.getElementById('clearAll');

// === UTILITY FUNCTIONS ===
function formatCurrency(val){return `₹ ${Number(val).toFixed(2)}`;}
function monthName(id){ 
  const d = new Date(id+'-01'); 
  return d.toLocaleString('default',{month:'long',year:'numeric'}); 
}

// === LOAD MONTH DATA AND CALCULATE STATS ===
async function loadMonth(id){
  currentMonthId = id;
  currentMonthLabel.textContent = monthName(id);
  const month = await ensureMonth(id);

  // Income
  incomeVal.textContent = formatCurrency(month.income);
  incomeInput.value = month.income;

  // Expenses
  let dailyExp = month.daily.reduce((acc,e)=>acc+Number(e.amount),0);
  let monthlyRecurring = Object.values(month.monthlyRecurring).reduce((a,b)=>a+Number(b),0);
  let yearlyRecurring = 0;
  const thisMonth = parseInt(id.split('-')[1]);
  month.yearlyRecurringDue.forEach(y=>{
    if(parseInt(y.month) === thisMonth) yearlyRecurring += Number(y.amount);
  });
  let totalExpense = dailyExp + monthlyRecurring + yearlyRecurring;
  expenseVal.textContent = formatCurrency(totalExpense);

  // Investments
  let totalInvest = Object.values(month.investments).reduce((a,b)=>a+Number(b),0);
  investVal.textContent = formatCurrency(totalInvest);

  // Savings
  let savings = month.income - totalExpense - totalInvest;
  saveVal.textContent = formatCurrency(savings);

  // Load recurring inputs
  recRent.value = month.monthlyRecurring.rent;
  recEMI.value = month.monthlyRecurring.emi;
  recBills.value = month.monthlyRecurring.bills;
  recOther.value = month.monthlyRecurring.other;
  invSIP.value = month.investments.sip;
  invStocks.value = month.investments.stocks;
  invOther.value = month.investments.other;
}

// === SAVE FUNCTIONS ===
saveIncomeBtn.addEventListener('click', async ()=>{
  const month = await ensureMonth(currentMonthId);
  month.income = Number(incomeInput.value);
  await saveMonth(month);
  loadMonth(currentMonthId);
});

// Add Expense
openAddExpenseBtn.addEventListener('click', ()=>{
  addExpenseSection.classList.remove('hidden');
});
cancelAddExp.addEventListener('click', ()=>{
  addExpenseSection.classList.add('hidden');
});
addExpBtn.addEventListener('click', async ()=>{
  const month = await ensureMonth(currentMonthId);
  month.daily.push({
    amount: Number(expAmount.value),
    category: expCategory.value,
    note: expNote.value,
    date: expDate.value || new Date().toISOString().slice(0,10)
  });
  await saveMonth(month);
  expAmount.value=''; expCategory.value=''; expNote.value=''; expDate.value='';
  addExpenseSection.classList.add('hidden');
  loadMonth(currentMonthId);
});

// Recurring
openRecurringBtn.addEventListener('click', ()=>recurringSection.classList.remove('hidden'));
cancelRecurring.addEventListener('click', ()=>recurringSection.classList.add('hidden'));
saveRecurringBtn.addEventListener('click', async ()=>{
  const month = await ensureMonth(currentMonthId);
  month.monthlyRecurring = {
    rent: Number(recRent.value),
    emi: Number(recEMI.value),
    bills: Number(recBills.value),
    other: Number(recOther.value)
  };
  // Yearly recurring
  const yearly = [];
  if(yrInsuranceAmt.value && yrInsuranceMonth.value) yearly.push({amount:Number(yrInsuranceAmt.value),month:yrInsuranceMonth.value});
  if(yrSubAmt.value && yrSubMonth.value) yearly.push({amount:Number(yrSubAmt.value),month:yrSubMonth.value});
  month.yearlyRecurringDue = yearly;
  await saveMonth(month);
  recurringSection.classList.add('hidden');
  loadMonth(currentMonthId);
});

// Investments
openInvestBtn.addEventListener('click', ()=>investSection.classList.remove('hidden'));
cancelInvest.addEventListener('click', ()=>investSection.classList.add('hidden'));
saveInvestBtn.addEventListener('click', async ()=>{
  const month = await ensureMonth(currentMonthId);
  month.investments = {
    sip: Number(invSIP.value),
    stocks: Number(invStocks.value),
    other: Number(invOther.value)
  };
  await saveMonth(month);
  investSection.classList.add('hidden');
  loadMonth(currentMonthId);
});

// Month navigation
prevMonthBtn.addEventListener('click', ()=>{
  const [y,m] = currentMonthId.split('-');
  const prev = new Date(y,m-2,1); // JS month 0-indexed
  loadMonth(prev.toISOString().slice(0,7));
});
nextMonthBtn.addEventListener('click', ()=>{
  const [y,m] = currentMonthId.split('-');
  const next = new Date(y,m,1);
  loadMonth(next.toISOString().slice(0,7));
});

// === HISTORY ===
openHistoryBtn.addEventListener('click', async ()=>{
  historySection.classList.remove('hidden');
  const allMonths = await listMonths();
  monthsList.innerHTML = '';
  monthDetail.innerHTML = '';
  allMonths.forEach(m=>{
    const div = document.createElement('div');
    div.className = 'monthCard';
    div.textContent = monthName(m.id) + ` — Income: ${formatCurrency(m.income)}`;
    div.addEventListener('click', ()=>showMonthDetail(m));
    monthsList.appendChild(div);
  });
});

function showMonthDetail(month){
  const daily = month.daily.map(e=>`${e.date}: ${e.category} - ${formatCurrency(e.amount)} (${e.note||''})`).join('<br>');
  monthDetail.innerHTML = `
  <h4>${monthName(month.id)}</h4>
  <div>Income: ${formatCurrency(month.income)}</div>
  <div>Expenses: ${formatCurrency(month.daily.reduce((a,b)=>a+Number(b.amount),0))}</div>
  <div>Investments: ${formatCurrency(Object.values(month.investments).reduce((a,b)=>a+Number(b),0))}</div>
  <div>Savings: ${formatCurrency(month.income - Object.values(month.investments).reduce((a,b)=>a+Number(b),0) - month.daily.reduce((a,b)=>a+Number(b.amount),0))}</div>
  <div style="margin-top:8px"><b>Daily Expenses:</b><br>${daily}</div>
  `;
}

// Export CSV
exportCSVBtn.addEventListener('click', async ()=>{
  const allMonths = await listMonths();
  let csv = 'Month,Income,Expenses,Investments,Savings\n';
  allMonths.forEach(m=>{
    const exp = m.daily.reduce((a,b)=>a+Number(b.amount),0) + Object.values(m.monthlyRecurring).reduce((a,b)=>a+Number(b),0);
    const invest = Object.values(m.investments).reduce((a,b)=>a+Number(b),0);
    const save = m.income - exp - invest;
    csv += `${m.id},${m.income},${exp},${invest},${save}\n`;
  });
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'smartfinance.csv';
  a.click();
});

// Clear all data
clearAllBtn.addEventListener('click', async ()=>{
  if(confirm('Clear all data?')){
    const database = await openDB();
    const tx = database.transaction('months','readwrite');
    tx.objectStore('months').clear();
    await tx.complete;
    loadMonth(currentMonthId);
  }
});

// === INITIAL LOAD ===
document.addEventListener('DOMContentLoaded', ()=>loadMonth(currentMonthId));
