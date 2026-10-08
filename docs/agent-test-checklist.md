# Zan-F Bot - manual QA checklist

Zan-F Bot 36-question run (7:36 PM IST): 12 pass / 4 partial / 20 fail on ba88248

Re-run these questions in the admin-web agent chat after branch `fix/ledger-opening-date-and-drive-search`
is deployed (API first, then admin-web). Ask each question in a fresh thread unless the row says
"follow-up". For every row, compare the answer with the listed admin-web page and record **Pass**,
**Partial** or **Fail** (with a one-line note) in the Result column. Money definitions follow the
"Money rules" and "Domain rules" in `CLAUDE.md`. Results are not verified against production until
someone runs this list there.

General pass criteria for every row:
- Numbers match the admin-web page to the rupee (rounding to 2 decimals is fine).
- Dates are shown in IST; no `1970-01-01` or "Invalid Date"; a UTC `18:30` timestamp shows as the next day.
- Totals and counts cover all matching rows (server totals), not just the first 15 rows listed.
- The bot does not reuse a number from an earlier answer; each follow-up re-calls a tool.

## 1. Receivables (as of today)

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 1 | What is our total receivable as of today? | get_receivables | /finance (Receivables), /reports/finance | States as-of date (today, IST) and basis; total incl. GST = sum of (net - settled) over issued + partially_paid invoices; matches page | |
| 2 | And excluding GST? (follow-up) | get_receivables (re-called) | /reports/finance | Excl. GST = outstanding x subtotal/total per invoice; GST portion = incl. - excl.; re-calls tool | |
| 3 | Who owes us the most? Top 5 customers. | get_receivables | /finance, /customers/[id] | Top-5 order and amounts (incl. and excl. GST) match byCustomer; totals still cover all customers | |
| 4 | How much does <customer X> owe us incl. and excl. GST? | get_receivables (customer filter) | /customers/[id], /finance/ledgers | Both figures stated; credit notes and TDS reduce the balance; matches ledger closing balance | |
| 5 | Split receivables by tax invoice vs proforma. | get_receivables | /invoices (filter by doc type) | byDocType amounts sum to the total; no draft/cancelled/paid invoices included | |

## 2. Ageing and overdue invoices

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 6 | Give me the receivables ageing. | get_receivables | /reports/finance (Receivables ageing) | Same buckets and amounts as the report (shared `services/ageing.ts`); buckets sum to total incl. GST | |
| 7 | Which invoices are overdue? | get_receivables (overdueInvoices) or search_invoices (overdueOnly) | /invoices, /reports/finance | Every overdue invoice listed (number, customer, IST due date, balance, days overdue); overdue count/amount covers all, not 15 | |
| 8 | Which overdue invoice is the oldest and by how many days? | get_receivables | /invoices/[id] | Days overdue counted from IST due date to today; correct invoice | |
| 9 | Total overdue amount for <customer X>? | get_receivables (customer) | /customers/[id] | Matches overdue sum for that customer only; paid/cancelled excluded | |

## 3. Payables and vendor bills

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 10 | How much do we owe suppliers in total? | get_payables | /finance/vendor-invoices | Total = sum of (total - vendor payments) over verified + approved + partially_paid bills; rejected/cancelled/deleted/paid excluded | |
| 11 | How much is pending to pay Selvam Enterprises? | get_payables (supplier) | /finance/vendor-invoices (filter supplier), /finance/vendor-payments | Supplier name resolved ("Selvam Ent." also works); amount matches page | |
| 12 | List all bills from Platino Automotive with status. | search_vendor_bills | /finance/vendor-invoices | All bills listed incl. rejected/paid with correct status labels; count covers all rows | |
| 13 | Show unpaid bills from Platino Automotive. | search_vendor_bills (status unpaid) | /finance/vendor-invoices/[id] | Only verified/approved/partially_paid; rejected and paid bills not shown; balance = total - paid | |
| 14 | Payables ageing - how much is overdue? | get_payables | /finance/vendor-invoices | Buckets (current, 0-30, 31-60, 61-90, 90+) sum to total; overdueCount/amount match | |
| 15 | Is the rejected bill <bill no.> counted in what we owe? | search_vendor_bills, get_payables | /finance/vendor-invoices/[id] | Says No - rejected bills are excluded from payables | |

## 4. Purchase orders vs bills

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 16 | What POs are open with Selvam Enterprises and what is their value? | search_purchase_orders | /purchase-orders | PO numbers, status, IST order dates and totals match; dates not 1970 | |
| 17 | Do we owe Selvam Enterprises the value of those POs? | search_purchase_orders, get_payables | /purchase-orders, /finance/vendor-invoices | States POs are commitments, not payables; amount owed = bills only | |
| 18 | Show PO <PO no.> line items and its order date. | get_document_detail | /purchase-orders/[id] | Lines, qty, rates, total match; order date in IST (UTC 18:30 shows as next day) | |

## 5. Revenue (Indian FY)

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 19 | What is our revenue this quarter? | get_revenue_summary (this_quarter) | /reports/finance, /invoices | States period (e.g. Q3 FY26-27, 1 Oct - today); gives invoiced excl. GST and incl. GST net of credit notes, and collected cash separately; says "tax invoices only, proformas excluded" (proforma invoices never counted) | |
| 20 | And last quarter? (follow-up) | get_revenue_summary (last_quarter) | /reports/finance | Re-calls tool; Q2 = Jul-Sep; same three bases stated | |
| 21 | Revenue last month? | get_revenue_summary (last_month) | /reports/finance | Calendar month in IST stated; figures match | |
| 22 | Turnover this financial year to date? | get_revenue_summary (this_fy) | /reports/finance, /reports/gst-returns | FY = 1 Apr - today; invoiced excl. GST matches GST returns outward taxable value net of credit notes | |
| 23 | Revenue in Q4 of last FY? | get_revenue_summary (from/to) | /reports/finance | Q4 = Jan-Mar of the later calendar year (not Oct-Dec); period stated | |
| 24 | How much has been invoiced in total ever? | get_revenue_summary (all_time) | /invoices | Basis stated; credit notes deducted; drafts/cancelled and proforma invoices excluded (tax invoices only) | |

## 6. Collections and TDS

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 25 | How much did we collect last month? | search_payments (from/to) | /finance/payments | Cash collected and TDS stated separately; totals cover all payments, not 15 listed | |
| 26 | How much TDS has been deducted by customers this FY? | search_payments (no method filter) | /reports/tds | TDS = tdsAmount + full amount of method "tds" (TDS Deducted) payments; matches TDS report | |
| 27 | Show payments from <customer X> with UTR. | search_payments (query) | /finance/payments, /finance/ledgers | References, IST received dates, amounts match; a "TDS Deducted" payment is not counted as cash | |

## 7. Sites and orders

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 28 | Which sites are Pending? | search_orders_and_sites (updateStatus pending) | /sites | Uses latest SiteStageEvent status per site (not SITC stage); count matches page filter | |
| 29 | Which sites are at the Dispatched stage? | search_orders_and_sites (stageKey) | /sites, /reports/sitc | Uses current SITC stage; list and count match | |
| 30 | Show the status-update history for site <site>. | search_site_status_updates | /sites/[id] | Entries, statuses and IST dates match the timeline; newest first | |
| 31 | How many orders are open? | search_orders_and_sites (openOnly) | /orders | Open = no site, or site below Commissioned (seq 11); Commissioned and Customer sign-off are closed; count covers all | |
| 32 | Is order <order no.> closed? | search_orders_and_sites | /orders/[id] | Correct per the seq-11 rule; states the current stage | |

## 8. Expenses

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 33 | Total expenses last month, by category. | search_expenses (from/to) | /expenses | Date range in IST stated; server total and per-category breakdown cover all rows (not 15); sum of categories = total | |
| 34 | Transport expenses between 1 and 15 of this month? | search_expenses (categoryKey, from/to) | /expenses (filters) | Inclusive IST range; an expense at 00:30 IST on the 1st is included | |

## 9. Drive search (ZanF_DropBox only)

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 35 | Find documents about <site / customer name> in Drive. | search_documents | Google Drive (ZanF_DropBox folder) | Matches by file name and content; only files inside the ZanF_DropBox tree | |
| 36 | What does <file found in 35> say about warranty? | get_document_content | Google Drive file | Quotes/summarises the actual file text; no hallucinated content | |
| 37 | Search Drive for a file outside ZanF_DropBox (e.g. a personal folder name). | search_documents, list_documents | Google Drive | Returns nothing / says not accessible; never lists files outside the tree | |

## 10. Dates and follow-ups

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 38 | When was invoice <inv no.> issued and when is it due? | search_invoices or get_document_detail | /invoices/[id] | IST dates match the page; a record stored at 18:30 UTC shows as the next day; no 1970 dates | |
| 39 | Show the ledger for <customer X> this FY. (then "and for last FY?") | get_customer_ledger (re-called with new from/to) | /finance/ledgers | Opening balance dated at the period start, IST; follow-up re-calls the tool with the new range | |
| 40 | "Sales last month?" then "and the month before?" | get_revenue_summary (re-called with from/to) | /reports/finance | Follow-up keeps the revenue subject, calls the tool again, states the new period and basis | |

## Run summary

| Run date / time (IST) | Commit | Pass | Partial | Fail | Tester | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
