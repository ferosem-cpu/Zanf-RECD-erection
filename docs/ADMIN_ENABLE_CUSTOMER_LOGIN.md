# Enabling Customer Login — Instructions for Super Admin / Management

Customers don't self-register. Someone with the right permission has to create their account
(a "customer contact") before they can sign in. Roles that can do this: **Super Admin**,
**Owner/Admin**, **Management**, and **Sales**.

## The one thing that matters most: the email address

Customer sign-in is **email + one-time code only** today (the login page's old "Order ID +
phone" option was removed from the UI on 2026-08-14). That means:

> **A customer cannot log in at all unless their contact record has a working, correctly
> spelled email address.** Phone number is required by the form, but it no longer gets them
> into the app by itself.

The "New customer" form still labels email as *optional* and still shows old text about
logging in with "Order ID and phone" — that text is stale and no longer true. Always fill in
the email, and double-check it's spelled exactly right (no typos, no extra spaces) — sign-in
does a plain equality check against whatever is on file.

## Steps to set up a new customer for login

1. Go to **Customers** in the left navigation.
2. Click **New customer**.
3. Fill in:
   - **Company name** (required)
   - **Contact name** (required) — the person who will log in
   - **Contact phone** (required by the form, but not currently usable for login on its own)
   - **Contact email** — **fill this in even though the form marks it optional.** This is what
     the customer will type on the login page's Customer tab.
4. Click **Create customer**. The account is active immediately — no separate "enable" step
   or approval needed (that's only for vendors).
5. Send the customer their exact email address (or better, direct them to type it themselves)
   and point them to the companion guide, "How to Log In — Customer Portal."

## Fixing an existing customer who says they can't log in

1. Go to **Customers**, find the company, and open **Edit**.
2. Check the **Contact email** field:
   - If it's blank, that's why — add their email and save. They can now sign in.
   - If it has a value, read it character-by-character against what the customer says they're
     typing. A very common cause is the two not matching exactly (extra space, typo, or a
     completely different address than what the customer assumes is on file). As of
     2026-09-03, sign-in is not case-sensitive between what the customer types and what's
     stored (a fix was deployed for that), but the address still has to be the *same* address,
     spelled the same way.
3. Save any correction. The customer can try "Get One-Time Password" again immediately —
   no wait, no separate activation step.

## What you can't see from your side

The "OTP sent" confirmation the customer sees on screen is deliberately shown **whether or not
their email matches an account** — this is intentional (it stops anyone from using the login
page to fish for which emails are registered customers). So a customer reporting "it says sent
but I got nothing" gives you no error to go on directly. Your move is always the same: open
their customer record and verify the email on file is correct and exactly matches what they're
typing.

If the email is confirmed correct and they still don't receive it after a couple of minutes
(checking spam too), that points to an email delivery problem rather than an account setup
problem — flag that to whoever manages the Zan-APP deployment.
