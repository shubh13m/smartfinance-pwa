# smartfinance-pwa


📘 Expense Tracker PWA

A clean, fast, offline-ready Progressive Web App for tracking monthly income, daily expenses, and recurring monthly & yearly costs.
The entire app runs in the browser using HTML, CSS, JavaScript + localStorage and is hosted on GitHub Pages.


---

🚀 Features

✅ Monthly Income

Set base income once every month

Add extra income for that month (bonuses, gifts, freelance work)

Automatically calculates total monthly income


✅ Daily Expenses

Add daily expenses with:

Amount

Category

Notes

Date


Stored per month


✅ Recurring Expenses

Monthly Recurring Examples

Rent

EMIs

Internet

Bills

Subscriptions


Yearly Recurring Examples

Insurance

Yearly subscriptions

Maintenance fees


The app also auto-converts yearly expenses into monthly equivalent.


---

📊 Dashboard Overview

For the selected month, the dashboard shows:

Base Income

Extra Income

Total Income

Monthly Recurring Total

Yearly Recurring Total

Yearly → Monthly Equivalent

Total Daily Expenses

Savings = Income − (Expenses + Recurring Costs)


Includes a month selector to view previous months.


---

📁 Data Storage Structure

All data is stored locally in the browser using localStorage:

{
  "incomes": {
    "2025-01": { "base": 20000, "extra": 5000 }
  },

  "expenses": {
    "2025-01": [
      { "amount": 200, "category": "Food", "notes": "Tea", "date": "2025-01-02" }
    ]
  },

  "recurringMonthly": [
    { "name": "Rent", "amount": 12000 }
  ],

  "recurringYearly": [
    { "name": "Insurance", "amount": 12000 }
  ]
}


---

🧩 Tech Stack

HTML5

CSS3 (Soft Minimal UI)

Vanilla JavaScript

localStorage for data

PWA (manifest + service worker)

GitHub Pages hosting



---

📦 Project Structure

/expense-app
│
├── index.html
├── styles.css
├── app.js
├── manifest.json
├── service-worker.js
│
└── /icons
    ├── icon-192.png
    └── icon-512.png


---

🔧 Installation (Local)

1. Download or clone the repo:



git clone https://github.com/YOUR_USERNAME/expense-app

2. Open index.html in your browser


3. App works fully offline and saves everything locally




---

🌐 Deployment (GitHub Pages)

1. Create repository:
expense-app


2. Push files to repo


3. Go to:
Settings → Pages → Deploy from Branch


4. Select:

Branch: main

Folder: /root (default)




Your app will be live at:

https://shubh13m.github.io/expense-app/


---

📱 PWA Support

Add to Home Screen

Works offline

Cached using service-worker

Auto-updates on refresh



---

🔮 Roadmap (Optional Future Enhancements)

Dark mode

Category-wise charts (Chart.js)

Data export/import

Biometric/PIN lock

Cloud sync

Multi-device support



---

🧑‍💻 Author

Made by Shubham Pandey
A personal minimal PWA for financial management.
