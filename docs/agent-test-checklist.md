# Zan-F Bot - manual QA checklist

Zan-F Bot 36-question run (7:36 PM IST): 12 pass / 4 partial / 20 fail on ba88248
Retest of `dpl_G9BdwcWwhTewxZXfpJXWEe4XsmTa` (2026-10-09): 35/36 pass; rows 41-44 cover the fix-6 items.

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
| 8 | Which overdue invoice is the oldest and by how many days? | get_receivables | /invoices/[id] | Days overdue = IST calendar days from due date to today (due 29 Sep, asked 9 Oct morning IST = 10, not 9), same as the page; correct invoice | |
| 9 | Total overdue amount for <customer X>? | get_receivables (customer) | /customers/[id] | Matches overdue sum for that customer only; paid/cancelled excluded | |

## 3. Payables and vendor bills

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 10 | How much do we owe suppliers in total? | get_payables | /finance/vendor-invoices | Total = sum of (total - vendor payments) over verified + approved + partially_paid bills; rejected/cancelled/deleted/paid excluded | |
| 11 | How much is pending to pay Selvam Enterprises? | get_payables (supplier) | /finance/vendor-invoices (filter supplier), /finance/vendor-payments | Supplier name resolved ("Selvam Ent." also works); amount matches page | |
| 12 | List all bills from Platino Automotive with status. | search_vendor_bills | /finance/vendor-invoices | All bills listed incl. rejected/paid with correct status labels; count covers all rows | |
| 13 | Show unpaid bills from Platino Automotive. | search_vendor_bills (status unpaid) | /finance/vendor-invoices/[id] | Only verified/approved/partially_paid; rejected and paid bills not shown; balance = total - paid | |
| 14 | Payables ageing - how much is overdue? | get_payables | /finance/vendor-invoices | Buckets (current, 0-30, 31-60, 61-90, 90+) sum to total; overdueCount/amount match; days overdue per bill = IST calendar days, same as /finance/vendor-invoices; never a literal `<EOS_TOKEN>` reply | |
| 15 | Is the rejected bill <bill no.> counted in what we owe? | search_vendor_bills, get_payables | /finance/vendor-invoices/[id] | Says No - rejected bills are excluded from payables | |

## 4. Purchase orders vs bills

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 16 | What POs are open with Selvam Enterprises and what is their value? / Open purchase orders? | search_purchase_orders (status=open) | /purchase-orders | Open = Issued + Partially received (e.g. PO/2026-27/0001 Issued is listed); closed, cancelled, received and draft are not; PO numbers, status, IST order dates and totals match; dates not 1970 | |
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
| 25 | How much did we collect last month? / this FY? | get_revenue_summary (last_month / this_fy) or search_payments (from/to) | /finance/payments, /reports/tds | Cash received, TDS deducted and settled total (cash + TDS) all stated - never cash alone as "collected"; a legacy "TDS Deducted" row counts as TDS; totals cover all payments, not 15 listed | |
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

## 11. Fix 6 retest (branch `fix/agent-retest-6`)

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 41 | Which vendor bills are overdue? (then "how many days for Selvam's?") | get_payables / search_vendor_bills (overdueOnly) | /finance/vendor-invoices (bill detail: due date) | Only bills WITH a due date before today are overdue (TXIN0934, 10 days on 09 Oct); bills without a due date are "no due date", aged by bill date, never overdue, no days past due and no "default terms"; asking again later the same day gives the same days | |
| 42 | How many orders are open? then "how many are commissioned?" (and "which sites are at Dispatched?" then "how many are Installing?") | search_orders_and_sites (openOnly / stageKey) | /orders, /sites | Filtered answer uses totals; out-of-filter counts quote allOrders (whole set): e.g. 9 Commissioned, never "0 commissioned" or "all sites are Order received or Installing" | |
| 43 | Open "AgsarPaint_Quote_TTCRN v1.2.pdf" from Drive and tell me the warranty clause. | search_documents, get_document_content | Google Drive (ZanF_DropBox top level) | Quotes the warranty clause from the PDF text; never "no OCR text" for a text PDF | |
| 44 | Reopen an old thread that showed `<EOS_TOKEN>` (or any old thread) and ask a follow-up; then click "+ New". | (any) | Agent chat bubble | No `<EOS_TOKEN>` / `<\|...\|>` text anywhere in the old thread (a token-only reply shows "(no reply)"); "+ New" empties the panel immediately, never flashing the old thread | |

## 12. Fix 7 retest (branch `fix/agent-retest-7`)

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 45 | Show all Platino bills. (then "only the unpaid ones") | search_vendor_bills (no status / status all; then unpaid) | /finance/vendor-invoices (filter Platino) | Lists every bill incl. the Rejected TXIN0933 with each bill's status (3 Verified + 1 Rejected); the follow-up drops the Rejected one; payables totals never include Rejected | |
| 46 | Search Drive for "backup" (and list recent documents). | search_documents, list_documents | Google Drive (ZanF_DropBox) | No `zanapp-backup-*` or other .json / backup files listed; asking to open one by id is refused with "app backup / data file" | |
| 47 | Open "AgsarPaint_Quote_TTCRN v1.2.pdf" from Drive and tell me the warranty clause. | search_documents, get_document_content | Google Drive (ZanF_DropBox top level) | Quotes the warranty clause from the PDF text within a few seconds; never "PDF extraction tool is currently unavailable" or "no OCR text" | |
| 48 | Where is the BOSTIK site? (and any site/customer location question) | search_orders_and_sites | /sites | One final answer with the place from tool data; no "X? Actually Y..." self-corrections or thinking aloud | |

## 13. Fix 8 retest (branch `fix/agent-retest-8`)

| # | Question | Expected tool(s) | Admin-web page to cross-check | Pass criteria | Result |
|---|---|---|---|---|---|
| 49 | List Ethen sites in Bangalore. | search_orders_and_sites | /sites (filter Bangalore) | "Site" column = the Sites list "Site name" exactly (VRL, Mahindra Aerostructures, BPCL, Wipro Enterprises, INTERGLOBE AVIATION, ...); address only in a separate "Address" column; customer = Ethen; no "End-client" label; noticeably faster than ~32 s | |
| 50 | Which sites are installing? | search_orders_and_sites (stageKey installing) | /sites (Stage = Installing) | Names exactly "BOSTIK" and "INTERGLOBE AVIATION" - never "BOSTIK - Bommasandra Industrial Area"; location, if given, as a separate field | |
| 51 | What is the warranty in "AgsarPaint_Quote_TTCRN v1.2.pdf"? (also "AgsarPaint warranty") | search_documents and/or get_document_content (by id or exact name) | Google Drive (ZanF_DropBox top level) | Finds the file and quotes the warranty text; never "couldn't find the file in the shared document folder" | |
| 52 | Search Drive for "backup". | search_documents | Google Drive | `zanapp-backup-*` and .json files never listed; a normal document with "backup" in its name IS listed | |
| 53 | What was our revenue this quarter? | get_revenue_summary | /finance (dashboard), /invoices | Period dates, excl. + incl. GST, collected (cash + TDS = settled) AND the number of tax invoices; proformas excluded | |

## Run summary

| Run date / time (IST) | Commit | Pass | Partial | Fail | Tester | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
