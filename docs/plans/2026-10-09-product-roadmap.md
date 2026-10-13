# Product roadmap: cloud invoicing and bookkeeping for paušalni obrtnici

**Status:** Draft

Date: 2026-10-09. Author: `architect`. This is a product and architecture plan, not a feature plan. Each phase gets its own feature plan in `docs/plans/` before any code is written. Phase 1 is in `2026-10-09-phase-1-foundation.md`.

Source references like **[S3]** point to the list in section 10. Every source was accessed on 2026-10-09. Where a statement comes from a secondary source (a publisher, vendor or community site) rather than the law or Porezna uprava, it is marked *(secondary)*.

> **Research limitation.** In this session I could not machine-read PDF files: the B2C technical specification v2.7, the HR CIUS specification, the HUB 3A barcode specification and the eRačun fiscalization specification. Everything below about those documents comes from the official HTML pages, the Narodne novine text of the pravilnik, and secondary summaries. The phase plans for Phases 2–4 **must** start by reading those PDFs. Where this plan gives field-level detail from memory, it is labelled "verify against spec".

---

## 1. Product summary and target customer

**Product.** A Croatian-language web app where a paušalni obrtnik can run the whole compliance side of the business in one place:

- issue quotes and invoices (PDF with HUB3 payment barcode, email);
- fiscalize invoices to consumers (B2C, "Fiskalizacija 1.0" messages to the CIS);
- send and receive structured eRačuni to and from businesses (B2B/B2G, Fiskalizacija 2.0) through an information intermediary;
- keep the KPR (knjiga prometa) automatically from recorded payments, import bank statements, match payments to invoices, and track the 60,000 EUR limit, quarterly flat-rate tax and the annual PO-SD.

**Target customer (MVP).** Croatian sole traders who are taxed as paušalisti, are **not** in the VAT system, and invoice mostly by bank transfer. Typical profiles: IT and creative freelancers (many invoice foreign clients), consultants, trainers, craftsmen and small service providers with some consumer customers. Accountants who look after several paušalisti are a secondary user, not a separate product.

**Explicitly not targeted in the MVP:** VAT-registered obrtnici and companies, obrtnici on real income (KPI/KPR-PO), paušalni iznajmljivači in tourism (a different tax regime), retail with physical point-of-sale hardware, and inventory.

---

## 2. Regulatory requirements and deadlines that drive scope

### 2.1 Key dates

| Date | What applies to a non-VAT paušalist | Source |
|---|---|---|
| 1 Sep 2025 | New Zakon o fiskalizaciji (NN 89/2025) in force. It replaces the Zakon o fiskalizaciji u prometu gotovinom. | [S1] Art. 79–80 |
| **1 Jan 2026 (in force now)** | **B2C fiscalization covers every payment method, bank transfer included** ("gotovinom, karticama, transakcijskim računom i na ostale načine"). | [S1] Art. 3, Art. 80; [S7]; [S16] |
| **1 Jan 2026 (in force now)** | Must be able to **receive** eRačuni in B2B and **fiscalize receipt within 5 working days**. Usually the intermediary or MIKROeRAČUN does this automatically. | [S2] Q6; [S3]; [S1] Art. 48(4) |
| **1 Jan 2026 (in force now)** | Must **report rejected** eRačuni (eIzvještavanje) by the 20th of the following month. If each rejection is recorded as it happens, no monthly report is needed. | [S1] Art. 52; [S4] |
| 1 Jan 2026 | Pravilnik o fiskalizaciji računa u krajnjoj potrošnji (NN 153/2025) applies. It covers ZKI, JIR, the QR code, numbering and premises. | [S8] Art. 48 |
| 2026 | B2B invoices may still be issued "kao i do sada" (PDF or paper). In 2026 a non-VAT paušalist's B2B invoices are not fiscalized, even when paid in cash or by card. | [S2] Q6, Q26 |
| 2026 | B2G: the public-procurement e-invoice law (since 2019) still applies to invoices sent to public buyers. They are **not** fiscalized under the Zakon o fiskalizaciji in 2026. | [S2] Q38 |
| 15 Jan 2027 | PO-SD for 2026 is due. | [S16] |
| **1 Jan 2027** | Must **issue eRačuni** to domestic businesses and the public sector, and **fiscalize them at the moment of issue**. MIKROeRAČUN gains issuing. | [S2] Q6, Q38; [S1] Art. 48(3), Art. 80; [S6] |
| **1 Jan 2027** | **eIzvještavanje of payments**: report paid eRačuni by the 20th of the month after payment, or in real time. The first monthly deadline is 20 Feb 2027. | [S1] Art. 53; [S4] |
| **1 Jan 2027** | B2C CIS production **stops accepting RSA-SHA1 signatures and TLS 1.1**. Only RSA-SHA256 and newer TLS remain. In the test environment this has applied since 1 Jul 2026. | [S9]; [S10] |
| 1 Jan 2027 | Amended B2C pravilnik (NN 97/2026) applies. Certificates may come from any EU-trusted-list provider and must contain the OIB, and the ZKI hash output is defined "more precisely". Existing certificates stay valid until they expire. | [S12] *(secondary; official NN text not read)* |
| 1 Jan 2027 (proposed) | Flat-rate tax and contributions rise for classes 6 and 7 (receipts above 40,000 EUR). The draft was in public consultation 31 Jul–30 Aug 2026, and I found no record of adoption. | [S22] *(secondary)* |

### 2.2 Corrections and clarifications to the brief

1. **"Receive from 1 Jan 2026, issue and fiscalize from 1 Jan 2027"**: correct [S2]. One addition: *received* eRačuni must also be fiscalized within 5 working days [S1 Art. 48(4)]. That has applied since 1 Jan 2026, and it is the main reason paušalisti already need MIKROeRAČUN or an intermediary today.
2. **"B2C fiscalization now covers all payment methods, including bank transfer"**: correct, since 1 Jan 2026 [S1 Art. 3; S7]. Porezna uprava confirmed this for paušalisti in an opinion dated 12 Feb 2026 *(secondary [S34])*. Payment-method code `T` (transakcijski račun) exists in the message. In the pravilnik's annex, `T` cannot be combined with a buyer OIB (error s181) [S8]. That implies bank-transfer invoices to businesses are not B2C-fiscalized.
3. **eIzvještavanje** has three parts [S1 Art. 51–53; S4]:
   - the **issuer** reports **payments** of eRačuni (from 2027 for paušalisti);
   - the **recipient** reports **rejections**;
   - the **issuer** reports transactions where an eRačun could not be sent because the recipient is not in the AMS directory.

   All deadlines are the 20th of the next month, or real time. Reporting is done through a web service, an intermediary, or FiskAplikacija in ePorezna. Corrections are made by sending a negative amount and then resending the correct data [S4].
4. **Informacijski posrednik** [S1 Art. 2(1)14, Art. 58–63]: a legal or natural person with an OIB that provides eRačun exchange, fiscalization and eIzvještavanje to others. **To become one**, you must:
   - submit GDPR Art. 32 security measures, a current **ISO/IEC 27001** certificate, a statement that the system is run in the EU with no transfers outside it, and a scope-of-services statement (Art. 61);
   - pass **conformity testing** on Porezna's testing portal;
   - get a *potvrda o sukladnosti* and be listed on the public list (Art. 59);
   - renew the ISO certificate within 60 days of expiry (Art. 62);
   - operate an AS4 access point, metadata service (MPS) and AMS registration [S13];
   - and accept that intermediaries are "key entities" under the Cybersecurity Act [S15].

   **To integrate with one**, you sign the intermediary's partner terms, and each obrtnik:
   - has a contract with the intermediary, which may be accepted electronically [S3; S1 Art. 58(4)];
   - **authorizes the intermediary in FiskAplikacija**, where exchange and fiscalization are *separate* authorizations [S3 FAQ 7].

   The list had 36 intermediaries on 7 Oct 2026, among them FINA, ELEKTRONIČKI RAČUNI d.o.o. (moj-eRačun) and E-RAČUNI d.o.o. (the e-računi competitor) [S14].
5. **FINA** has three roles:
   - it is one of the listed intermediaries [S14];
   - it runs the legacy B2G "servis eRačun za državu";
   - it issues the **FINA RDC application certificate ("Fiskal x")** for B2C fiscalization, plus a **FINA DEMO** certificate for the test environment.

   FINA's certificate costs about 39.82 EUR + PDV and is valid 5 years *(secondary [S30])*. From 1 Jan 2027 other EU-trusted providers' certificates containing the OIB are also accepted [S12]. For eRačun (F2), an authorized intermediary may fiscalize **with its own certificate** [S3], so the obrtnik needs a certificate only for B2C.
6. **MIKROeRAČUN** is Porezna uprava's free app, acting as access point/intermediary for non-VAT taxpayers who are not public buyers. It is accessed through ePorezna/NIAS and needs no certificate and no contract [S5].

   | | Detail | Source |
   |---|---|---|
   | **Today** | Receives, views, searches, rejects and archives eRačuni, and fiscalizes receipt and rejection. Received eRačuni show a 2D payment barcode since 15 Apr 2026. | [S5]; [S13] news |
   | **From 1 Jan 2027** | Issues eRačuni. Test version planned for October 2026. | [S6] |
   | **Does not do** | B2C fiscalization [S2 Q6, Q21], KPR, bank import and matching, PDF/HUB3 invoices for consumers, quotes, reminders, threshold tracking, or an API (none described) [S5]. | [S2]; [S5] |

   A paušalist can therefore meet the F2 obligations entirely for free, but still needs separate software for B2C fiscalization.

### 2.3 B2C fiscalization (F1): technical requirements

From the pravilnik NN 153/2025 [S8], the Porezna page [S7] and the spec announcement [S9]. Verify everything below against **Tehnička specifikacija za korisnike v2.7 (21.07.2026)** [S10] and **WSDL v1.10 (24.11.2025)** [S11] before Phase 3.

- **Messages.** SOAP/XML web service. Each invoice is sent "u trenutku izdavanja računa" [S7], and the Tax Administration aims to answer within 2 seconds [S8 Art. 10]. The fiscalization message carries [S7; S8 Annex 1]:
  - message ID;
  - issuer OIB and whether the issuer is in VAT;
  - issue date and time;
  - sequence marker (`P` for premises, `N` for device);
  - invoice number parts;
  - tax breakdown (empty for non-VAT issuers) and total;
  - payment method (`G` cash, `K` card, `T` bank transfer, `O` other or mixed);
  - operator OIB;
  - ZKI;
  - a late-delivery flag.

  Exact element names (in older versions `RacunZahtjev`, `NakDost`, `OznSlijed` and so on) must be taken from v2.7.
- **Payment-method change.** A later change of payment method on an issued invoice has its own procedure [S8 Art. 11, Annex 2].
- **Signing.** XML request messages are signed with the taxpayer's application certificate. From 1 Jan 2027 only RSA-SHA256 is accepted, and TLS 1.1 is dropped [S9].
- **ZKI.** The inputs are issuer OIB, issue date and time, numeric invoice number, premises code, device code and total amount, with a dot as decimal separator and UTF-8 encoding [S8 Art. 15–16]. NN 153/25 Art. 16 says the value is signed with **RSA-SHA1** using the production certificate, then hashed with **MD5**, giving 32 lowercase hex characters. **Open:** NN 97/26 (from 1 Jan 2027) "more precisely defines" the hash result, and SHA1 is removed from XML signing on the same date [S12]. Implement exactly what v2.7 and NN 97/26 say, and prove it against the CIS test environment.
- **JIR.** Returned by the CIS. It is a UUID: Annex 1 gives Char(36), but Art. 7(2) says 32 characters (see section 9).
- **Late delivery.** If the CIS cannot be reached, the invoice is **issued anyway without a JIR** (the sale is not blocked). All such invoices must be delivered **within 2 working days** of the outage [S1 Art. 21(2)], or 5 working days after a total device failure [S1 Art. 22]. They are flagged as late delivery. An invoice counts as reported only when a JIR is received [S8 Art. 9].
- **Invoice number.** The format is `numeric/premises/device`, e.g. `123/POSL1/1`:
  - numeric part: digits only, no leading zeros;
  - premises code: letters and digits, unique per OIB;
  - device code: digits, no leading zeros, unique within the premises [S8 Annex 1–2].

  The excerpt I read does not say that numbering restarts every year. Yearly restart is common practice and is assumed by `CLAUDE.md`. Verify it, and record the rule in the obrtnik's internal act.
- **QR code.** Mandatory on the printed or PDF invoice [S8 Art. 17–18]. It contains at least the Porezna check-page URL, the JIR (or ZKI), the issue date and time, and the total. Requirements: minimum 2×2 cm, a quiet zone of at least 2 mm, error correction at least level L, and no logo overlay.
- **Premises and internal act.** Business premises, including "internet/mobile" premises with 0–24 hours, are registered **by the obrtnik in ePorezna** before invoicing [S8 Art. 19]. Changes of software producer or maintainer must also be reported there, so our company's OIB will be entered by every customer. The obrtnik also adopts an internal act on numbering, premises and device codes, and the cash limit (blagajnički maksimum) [S34; S8].
- **Book of invoices.** A bound pre-numbered book (knjiga računa) is the fallback for total device failure [S8 Art. 37–38]. It is not our concern beyond showing a notice.
- **Test environment.** There is an EDUC/test WSDL [S11], and a FINA DEMO certificate is required for testing. Porezna's own Fiskalcis certificate, used to verify CIS responses, was replaced on 8 Sep 2026 [S31]. Its public key must be configurable, not hardcoded.

### 2.4 eRačun format (F2)

- **Norm.** Every eRačun must comply with "the EU norm": EN 16931-1:2017 as extended by Porezna's specification [S1 Art. 2(1)9, Art. 36].
- **Specification and syntax.** The current documents are *Specifikacija osnovne uporabe eRačuna s proširenjima* (**12.03.2026**), the **validator** (in use from 15.03.2026), the **UBL 2.1** artefacts (15.04.2026) and *Aplikacijski odgovor za odbijanje računa* (28.07.2026) [S13]. The syntax is **UBL 2.1** Invoice and CreditNote; no CII binding is described *(secondary)*.
- **KPD 2025.** Every line must carry the **KPD 2025** product classification as a **6-digit code** [S1 Art. 42]. Leaving it out is a misdemeanour (Art. 73(1)(18)). In UBL it goes in `cac:Item/cac:CommodityClassification/cbc:ItemClassificationCode` with `@listID="CG"`, and it is not given on credit notes (381) or advance invoices (386) *(secondary; verify against spec)*. The KPD catalogue comes from DZS KLASUS [S13].
- **Non-VAT seller.** The issuer OIB may be taken from `cbc:EndpointID` or `cac:PartyIdentification/cbc:ID` with scheme **9934** and 11 digits [S3]. The tax category and exemption code for a non-VAT seller (`O` or `E`, VATEX code, HR-specific codes) must be taken from the spec, because secondary sources disagree.
- **Amounts.** All data sent to fiscalization must be in **EUR** [S3].
- **Delivery date.** `ActualDeliveryDate` is used if present, otherwise the issue date [S3].
- **The XML is the invoice.** "eRačun nije PDF i ne može se poslati mailom" [S15]. PDF attachments do not replace the structured data [S5].

### 2.5 Paušalni obrt obligations

| Topic | Rule | Source |
|---|---|---|
| Eligibility and limit | Not in VAT; receipts **≤ 60,000 EUR** per year. Exceeding the limit means mandatory VAT registration and the end of the flat rate. | [S16]; [S17] |
| Tax classes 2026 | 7 classes: ≤11,300; ≤15,300; ≤19,900; ≤30,600; ≤40,000; ≤50,000; ≤60,000 EUR. Annual tax 203.40 / 275.40 / 358.20 / 550.80 / 720.00 / 900.00 / 1,080.00 EUR (12% of a base set at 15% of the class ceiling). 25% reduction in Vukovar, assisted areas and Group I islands. | [S16] |
| Quarterly tax | Paid by the last day of each quarter. | [S16] |
| PO-SD | Filed by **15 January** for the previous year, through ePorezna. | [S16] |
| KPR | Daily record of **collected** receipts (cash basis), entered by the end of the working day. Official columns: R. br., Nadnevak, Broj temeljnice, Opis isprava o primicima u gotovini, Iznos naplaćen u gotovini/čekovima, Iznos naplaćen bezgotovinskim putem, Ukupno (5+6). Bank receipts are entered on the payment date, one row each; cash as a daily total. Card receipts count when settled to the account. Kept by the obrtnik, not filed. | [S16]; [S21] *(secondary; official annex not read)* |
| Non-VAT note on invoices | Since 1 Jan 2025 the exemption is in **čl. 90. st. 1.** Zakona o PDV-u (NN 152/24), no longer st. 2. Commonly used wording: "Obveznik nije u sustavu PDV-a, PDV nije obračunat temeljem čl. 90. st. 1. Zakona o PDV-u." Some vendors still print st. 2. | [S18] *(secondary)* |
| Mandatory invoice elements | Per čl. 79 Zakona o PDV-u (small taxpayers must show the elements and the exemption provision) and the fiscalization rules: issuer name, address and OIB; number; issue date (and time for fiscalized invoices); delivery date; buyer name, address and OIB for businesses; description, quantity and price; total; exemption note; for F1, also ZKI, JIR and QR code; premises/device in the number. | [S18]; [S8] *(the list must be confirmed by a tax advisor)* |
| Retention | eRačuni: **6 years** from the end of the year of issue [S1 Art. 35(1)]. General tax records: **10 years from the start of the limitation period** (Opći porezni zakon). Non-eRačun invoices and accounting documents: "at least 11 years" (Zakon o računovodstvu, which applies to companies). I found no rule specific to paušalisti. | [S1]; [S19] *(secondary)* |
| HUB3 barcode | HUB **3A** 2D barcode specification, **version 6 (September 2022)**, for national EUR payments: PDF417, 0.254 mm module, 3:1 height-to-width ratio, error correction level 4, 9 data columns, binary encoding, no compact/macro variants, width 58 mm, height ≤ 26 mm. The payload starts with `HRVHUB30`, followed by line-separated fields (currency, 15-digit amount in cents, payer, payee, IBAN, model, reference, purpose code, description). | [S20] *(field table: verify against spec)* |

### 2.6 Penalties (why correctness matters)

For obrtnici [S1 Art. 71–73]:

- most serious offences: 3,980–39,810 EUR;
- serious offences: 1,320–39,810 EUR;
- lesser offences, which include missing KPD codes: 660–13,270 EUR;
- temporary closure of premises for up to 8 days (Art. 66).

Porezna's FAQ puts responsibility for correct issuing, fiscalization and eIzvještavanje on the **taxpayer**, and responsibility for the software on the **intermediary** [S3; S1 Art. 58]. Our terms of service and liability insurance must reflect that we are neither.

---

## 3. Competitive landscape and positioning

| Product | Paušalist offer (public price) | B2C fiscal. | eRačun | KPR / PO-SD | Bank import / matching | Notes |
|---|---|---|---|---|---|---|
| **e-računi** (E-RAČUNI d.o.o.) [S25] | FREE: ≤70 docs in the last 30 days and ≤45,000 EUR turnover in the last 6 months, no support. **BASIC paušalisti: 8.33 EUR/month or 100 EUR/year incl. PDV**, 1 user. | Yes, plus Android cash register | Yes; it is itself a listed intermediary [S14], sending free | Knjiga prometa and PO-SD in BASIC | Statement import, PSD2 at 0.80 EUR + PDV per account per month, rule-based matching | Strongest incumbent. Wide scope (also companies and VAT); the price page looks dated around Sept 2024. |
| **Solo** [S26] | jabba: 0 EUR (3 invoices/month); solo: **10 EUR/month incl. PDV** (300 invoices, 3 users); solo+: 40 EUR/month | Yes (F1, ZKI/JIR/QR) | Send and receive included; uses doku.hr | KPR, PO-SD, TZ1 listed | Open banking listed | Popular with paušalisti; mobile apps. The page does not map features to plans clearly. |
| **Minimax** [S27] | Izlazni računi 12 EUR + PDV/month; Mikro 16 EUR + PDV | Yes | Through Seyfor–Yescor: 2 free per month, then 0.29 EUR + PDV each | KPR | Bank statements | Full accounting product, more than a paušalist needs. |
| **FiskAI** [S28] | Free plan; Lite from 6.99 EUR/month | "Check availability" | Lite, separate activation | Annual record, 60k threshold tracking | Not stated | New entrant; AI scanning of incoming invoices. |
| **MIKROeRAČUN** [S5][S6] | **Free** | **No** | Receive, reject, archive now; **issuing from 1 Jan 2027** | No | No | The state tool. It covers all F2 duties for non-VAT taxpayers. |
| FiskAplikacija (ePorezna) | Free | No (view only) | Status and authorizations | CSV export of fiscalized invoices only [S21b] | No | Not a competitor, but it reduces the value of "reports". |

**Where a newcomer can differentiate**

1. **Paušalist-only focus.** No VAT, no general ledger, no inventory. Every screen speaks the paušalist's language: "naplaćeno", "KPR", "razred", "kvartalni porez". The incumbents carry company and VAT complexity.
2. **The KPR fills itself.** A matched bank payment becomes a KPR row on the payment date in the official column layout, with zero manual entry. Then a live threshold and class tracker (60,000 EUR, class changes, the 2027 rates), quarterly tax reminders, and a PO-SD worksheet that adds up exactly from the KPR.
3. **One correct routing decision per invoice.** The app decides automatically between F1 fiscalization, eRačun, or a plain invoice for foreign and 2026 B2B customers, using customer type, country and date. It explains the reason in plain Croatian, and it walks the user through the ePorezna/FiskAplikacija onboarding (premises, intermediary authorization, certificate).
4. **Transparent all-in price**, with intermediary fees included up to a generous volume and no per-document surprises.
5. **Good for foreign-client freelancers**: EU reverse-charge notes, foreign currency, and the EUR actually credited going to the KPR (if the user approves this scope; see section 9).
6. **Accountant view**: one login sees several obrtnici, with exports.
7. **Positioning against MIKROeRAČUN.** "MIKROeRAČUN covers eRačun. We cover everything else and do eRačun in the same place." We must assume the free tool improves. Our value must not depend on eRačun issuing alone.

---

## 4. System architecture

### 4.1 Modules

One Next.js application (web UI, server actions, route handlers) plus one **worker** process from the same codebase. One PostgreSQL database. Object storage for issued artefacts.

| Module | Responsibility | Phase |
|---|---|---|
| `auth` & `org` | Users, sessions, 2FA, organizations (obrt), memberships, invitations, roles, obrt profile | 1 |
| `tenancy` | Org context, membership checks, RLS session settings, composite FKs | 1 |
| `audit` | Append-only audit log of business actions | 1 |
| `money`, `dates`, `validation` | Decimal math, Croatian parsing, formatting, Zagreb time, OIB/IBAN/KPD validation | 1 |
| `customers`, `items` | Customer directory and product/service catalogue | 1 |
| `documents` | Quotes, invoices, credit notes/storno; drafts → issue; immutability; channel routing | 2 |
| `numbering` | Gapless sequences per premises, device and year | 2 |
| `premises` | Business premises and devices (codes, working hours, ePorezna confirmation) | 2 |
| `rendering` | PDF (invoice and quote), HUB3 PDF417, F1 QR code, stored artefacts | 2–3 |
| `mail` | Transactional email with document attachments, bounce status | 2 |
| `fiscal-b2c` | Certificate vault, ZKI, SOAP client, JIR, late delivery, payment-method change | 3 |
| `einvoice` | UBL HR CIUS generator and validator, intermediary adapter, outbox/inbox, rejection, eIzvještavanje | 4 |
| `banking` | Bank accounts, statement import (camt.053, CSV), dedupe, matching | 5 |
| `bookkeeping` | Payments, allocations, KPR, tax-year parameters, threshold, quarterly and PO-SD reports | 5 |
| `billing` | Our own subscriptions and invoices to our customers | 6 |
| `compliance` | Retention, archive mode, export, closure, GDPR requests | 6 |
| `jobs` | pg-boss queues, schedules, dead letters | 2 onward |

### 4.2 Data model overview

Conventions for every table:

- `id uuid` (DB default `gen_random_uuid()`), except Better Auth tables, which use text ids.
- `organization_id text NOT NULL` on every tenant table, with `UNIQUE (organization_id, id)` so that child tables reference parents through **composite foreign keys** `(organization_id, x_id)`. A row can then never point into another tenant.
- Money in `bigint` minor units with `currency char(3)`.
- Quantities, unit prices and percentages in `numeric(19,6)`, read as decimal strings.
- Legal instants in `timestamptz` (UTC); business dates in `date`.

| Entity | Key fields (abbreviated) | Notes |
|---|---|---|
| `user`, `session`, `account`, `verification`, `two_factor` | Better Auth schema | Not tenant-scoped |
| `organization` | id, name, slug | Better Auth organization plugin; one per obrt |
| `member`, `invitation` | organization_id, user_id, role (`owner`, `accountant`, `member`) | Better Auth; we re-check membership server-side on every action |
| `obrt_profiles` | organization_id (PK), trade_name, owner_full_name, oib, address, iban, in_vat_system=false, default_invoice_note, sequencing_mode (`P`/`N`) | 1:1 with organization |
| `customers` | kind (`person`, `business`), name, oib, vat_id, address, country_code, email, archived_at | Snapshotted onto documents at issue |
| `items` | name, description, unit_code (UN/ECE Rec 20), unit_price numeric, currency, kpd_code char(6), archived_at | |
| `business_premises` | code, kind (`fixed`, `internet`), address, working_hours, eporezna_confirmed_at, active | Registered by the obrtnik in ePorezna; we store and confirm |
| `devices` | premises_id, code (int), active | |
| `numbering_sequences` | organization_id, series (`invoice`, `quote`), premises_id, device_id (null when mode `P`), year, next_number | Unique per key; see 4.4 |
| `documents` | kind (`quote`, `invoice`, `credit_note`), status (`draft`, `issued`; quotes also `accepted`, `declined`, `expired`), channel (`b2c_fiscal`, `einvoice`, `plain`), numeric_number, number_text, premises_id, device_id, sequence_id, customer_id, customer_snapshot jsonb, issuer_snapshot jsonb, issued_at timestamptz, issue_date date (Zagreb), delivery_date, due_date, currency, total_cents, payment_method (`G`, `K`, `T`, `O`), notes, corrects_document_id, retain_until date | A DB trigger forbids updates to issued rows except whitelisted operational columns |
| `document_lines` | document_id, position, item_id, description, kpd_code, unit_code, quantity, unit_price, discount_percent, line_total_cents | Immutable with the document |
| `document_artifacts` | document_id, kind (`pdf`, `ubl_xml`, `f1_request`, `f1_response`, `received_xml`, `attachment`), object_key, sha256, bytes, created_at | Files live in WORM object storage; this table indexes them |
| `fiscal_certificates` | subject_oib, serial, issuer, not_before, not_after, ciphertext, wrapped_dek, kms_key_id, uploaded_by, revoked_at | See 4.7 |
| `fiscal_b2c_records` | document_id, zki, jir, message_id, attempt_count, first_attempt_at, last_attempt_at, status (`pending`, `confirmed`, `failed`), late_delivery, last_error_code, environment | One per invoice, plus `fiscal_b2c_attempts` for each try |
| `einvoice_messages` | direction (`out`, `in`), document_id (out), provider, provider_document_id, sender_oib, recipient_oib, provider_status, fiscalization_status, received_at, rejected_at, rejection_reason, payment_reported_at, ereport_status | The inbound UBL is stored as an artefact; parsed header fields are kept for listing |
| `payments` | source (`bank`, `cash`, `card_settlement`, `manual`), received_on date, amount_cents, currency, bank_transaction_id | Money actually collected |
| `payment_allocations` | payment_id, document_id, amount_cents | Splits sum exactly to the payment |
| `bank_accounts`, `bank_statement_imports`, `bank_transactions` | iban; file sha256 (dedupe); booking_date, value_date, amount_cents (signed), counterparty, reference_model, reference_number, description, bank_reference (unique per account) | |
| `kpr_entries` | year, row_no (gapless per org and year), entry_date, voucher_ref, description, cash_cents, noncash_cents, source, source_id, reverses_entry_id | Append-only; corrections are reversing rows; locked after the year is closed |
| `tax_year_parameters` | year, classes jsonb (thresholds, annual tax), contribution amounts, limit_cents, source_url, valid_from | **Data, not code**: the 2027 changes are pending |
| `regulatory_calendar` | key (e.g. `einvoice_issue_obligation_non_vat`), effective_date, source | Drives channel routing; no hardcoded dates |
| `audit_log` | organization_id, actor_user_id, action, entity_type, entity_id, changed_fields text[], request_id, occurred_at | Append-only (trigger plus revoked grants); no values, no PII |
| `subscriptions`, `billing_events` | Phase 6 | |

### 4.3 Document lifecycle and channel routing

- **Draft** documents are freely editable and deletable. **Issue** is a single server action that does the following inside one transaction:
  1. validates the draft;
  2. picks the channel;
  3. allocates the number;
  4. freezes the snapshots;
  5. computes totals;
  6. for F1, computes the ZKI;
  7. sets `issued_at`.

  After the commit, side effects run: the F1 call, eRačun send, PDF and email. Each one is retryable and never touches the number.
- **Channel routing**, evaluated at issue time from the customer and the Zagreb issue date against `regulatory_calendar`:
  - consumer (`person`, any country) → `b2c_fiscal`, any payment method;
  - domestic business with an OIB, before the F2 issuing date (2026-12-31 and earlier) → `plain`; from 2027-01-01 → `einvoice`. If the recipient is not in the AMS → `plain` plus an eIzvještavanje "non-delivery" report [S4];
  - domestic public-sector buyer → `einvoice` (B2G; see open question 6);
  - foreign business → `plain`; Fiskalizacija 2.0 covers domestic transactions only [S2 Q2, Q15].
  - **Open:** a domestic B2B invoice paid in cash or by card from 2027 (Art. 15 F1 with a recipient OIB [S29b]) needs confirmation.
- **Corrections.** A storno or credit note is a new document in the same invoice sequence, with negative amounts and `corrects_document_id` set. A full storno copies the original's line totals negated, so the pair nets to exactly 0.00. For `einvoice`, the serializer maps our negative amounts to the sign convention the HR CIUS requires (credit note type 381 vs negative invoice); **verify against the spec**.
- **Quotes** have their own non-fiscal sequence and are never fiscalized. A quote that shows a price and payment details carries "OVO NIJE FISKALIZIRANI RAČUN" *(secondary [S34]; confirm with the tax advisor)*. Converting a quote creates a new invoice draft.

### 4.4 Numbering

- One `numbering_sequences` row per (organization, series, premises, device or null when the obrtnik's internal act says `P`, year). Year = Zagreb calendar year of `issued_at`.
- Allocation happens **inside the issue transaction** with `INSERT … ON CONFLICT (…) DO UPDATE SET next_number = numbering_sequences.next_number + 1 RETURNING next_number`. The row lock serializes concurrent issuers, and a rollback also rolls back the increment, so there are no gaps and no duplicates. No network call may happen inside this transaction.
- A unique index on `documents (organization_id, sequence_id, numeric_number)` is the final guard.
- **All invoice-type documents (F1, eRačun, plain, storno and credit notes) share the premises/device/year sequence.** This is my recommendation and the simplest reading of "slijednost". It must be confirmed by the tax advisor and written into the internal act template we offer.

### 4.5 Rounding rule (normative for `CLAUDE.md`)

1. **Line total** = quantity × unit price × (1 − discount_percent / 100). It is computed exactly with `decimal.js` (precision ≥ 40 significant digits), then **rounded once to cents with ROUND_HALF_UP**. In decimal.js, ROUND_HALF_UP means half away from zero, so −49.995 → −50.00, symmetric with 49.995 → 50.00.
2. **Document total** = the integer sum of the rounded line totals. It is never recomputed from unrounded values.
3. **No document-level discounts or charges in the MVP** (out of scope). This keeps EN 16931 BR-CO-10 trivially true: sum of line net amounts = BT-106.
4. **VAT is always 0** for our customers. TaxExclusive = TaxInclusive = Payable = document total.
5. **Splits** (instalments, a payment allocated across invoices) use the **largest-remainder method** with deterministic tie-breaking (earlier position first). Example: 10.00 / 3 = 3.34 + 3.33 + 3.33. Splits always sum exactly to the source.
6. **Display and wire formats** (hr-HR in the UI; `123.45` in F1 and UBL; a 15-digit cents string in HUB3) are derived from integer cents at the edge only.

### 4.6 Background jobs

**Runner:** pg-boss on the same PostgreSQL. It needs Node ≥ 22.12 and PG ≥ 13, and supports retries with exponential backoff, cron schedules, dead-letter queues, and creating jobs inside an existing Drizzle transaction [pg-boss README]. That last feature gives us a transactional outbox with no extra infrastructure. Jobs carry `organizationId` and run inside the same tenant context as web requests.

| Queue | Trigger / schedule | Deadline it protects |
|---|---|---|
| `fiscal.b2c.deliver` | after issue if no JIR; backoff 1 min → 1 h | **2 working days** [S1 Art. 21(2)]. The user is alerted after 1 h and again at the end of the first working day. Uses the Croatian working-day calendar. |
| `einvoice.send` / `einvoice.status` | after issue; poll status | Issuer fiscalization at issue time [S1 Art. 48(3)] |
| `einvoice.inbox.poll` | every 10 min | Recipient fiscalization ≤ **5 working days** [S1 Art. 48(4)]. The intermediary fiscalizes; we monitor and alert on day 3. |
| `einvoice.ereport.payment` | when a payment is allocated to an eRačun; daily sweep | Before the **20th** of the next month [S1 Art. 53] |
| `einvoice.ereport.rejection` | on rejection | Before the **20th** [S1 Art. 52] |
| `mail.send` | after issue or on request | — |
| `bank.import.parse` | after upload | — |
| `reminders.*` | daily cron | Quarterly tax (end of quarter), PO-SD (15 Jan), certificate expiry (60/30/7 days), 60k limit warnings (80%, 90%, 100%) |
| `retention.purge` | yearly, January | Deletes only rows and objects whose `retain_until` has passed and whose org is closed |

**Working days** use a `public_holidays` table seeded from the Zakon o blagdanima, including the movable Easter Monday and Tijelovo, plus Saturday and Sunday. It is Phase 3 work and is unit-tested.

### 4.7 Certificate storage and signing

- **Upload.** The owner uploads a `.p12` file and its password. This requires re-authentication within the last 10 minutes and 2FA enabled. The server action:
  1. parses the PKCS#12 with `node-forge`, because Node's `crypto` cannot open PKCS#12;
  2. checks that the subject OIB equals the org's OIB, the validity dates, the key usage, and that the issuer is FINA RDC or an EU-trusted CA from 2027 [S12];
  3. extracts the PKCS#8 private key and the certificate chain;
  4. **discards the password and the original file**.
- **Envelope encryption.** A fresh 256-bit data key encrypts the key and chain with AES-256-GCM. The data key is wrapped by KMS with encryption context `{organizationId, certificateId}`. We store the ciphertext, wrapped data key and KMS key ID. Only the runtime role can call `kms:Decrypt`, and only with a matching context.
- **Signing.** The `server-only` module `src/server/fiscal/signer.ts` decrypts on demand into a `KeyObject`, which is cached in process memory for at most 5 minutes per org and never serialized. It signs (ZKI, XML-DSig) in the same process. Logs redact anything matching certificate or key fields. The certificate never reaches the browser; the UI shows serial, subject and expiry only.
- **Revocation.** The user can revoke a certificate. Deleting the wrapped data key crypto-shreds it.
- **CIS response verification.** Uses the configured Fiskalcis public certificate (rotated 8 Sep 2026 [S31]) from configuration, not code.
- **eRačun (F2).** No customer certificate is needed; the intermediary fiscalizes with its own [S3].

### 4.8 Multi-tenancy

- Shared database and schema. `organization_id` is on every tenant row, with composite FKs (4.2).
- **App layer.** Every server action and route handler calls `requireOrgContext(orgSlug)`. It loads the session, then loads the membership from the DB (never trusting only the session's active org), and returns `{userId, orgId, role}`. A non-member gets **404**, so other tenants' existence is not revealed.
- **DB layer (defense in depth).** PostgreSQL **Row-Level Security** with `FORCE ROW LEVEL SECURITY` on every tenant table. The policy is `organization_id = current_setting('app.org_id', true)`. `withTenant(ctx, fn)` opens a transaction and runs `set_config('app.org_id', orgId, true)`. The runtime role is **not** the table owner and has no `BYPASSRLS`; migrations run as a separate owner role.
- **Object storage.** Keys are `org/{orgId}/…`. Downloads go through an authorized route handler that streams the object or issues a ≤ 60-second presigned URL.
- **Support access.** None in the MVP. A later break-glass flow must be audited and time-boxed.

### 4.9 Retention and archiving

- **Policy (recommendation).** Keep invoices, credit notes, quotes that became invoices, F1 records, eRačun documents (sent and received), KPR and payments until **31 December of the 11th year after the year of issue**. A 2027 invoice is kept until 31 Dec 2038. This covers the 6-year eRačun rule [S1 Art. 35], OPZ's 10 years from the start of the limitation period, and the 11-year accounting-records rule [S19]. **Confirm with a tax advisor (open question 4).** `retain_until` is computed per document at issue.
- **Storage.** Issued artefacts (PDF as sent, UBL as sent or received, F1 request and response) go to object storage with **Object Lock in compliance mode** until `retain_until`. The stored PDF is the legal copy and is never regenerated for legal purposes. A SHA-256 is recorded in `document_artifacts`.
- **Database.** Issued rows are protected by triggers. Point-in-time recovery covers 35 days, plus monthly encrypted logical dumps to a separate account and bucket kept for the retention period.
- **Cancellation.** The org goes into **archive mode**: read-only, can export, nothing can be issued, and it is free (see the pricing options). The full export is a ZIP of PDFs, XMLs, the KPR and CSVs. Data is deleted only after `retain_until`.
- **GDPR erasure** of a buyer's personal data on issued invoices is refused under Art. 17(3)(b) (legal obligation) until retention ends. Non-issued data (drafts, archived customers never invoiced) can be erased.

### 4.10 Security and privacy

- **EU hosting only**, a DPA (ugovor o obradi) with every customer (we are a **processor** for their customers' data and a **controller** for account data), a public sub-processor list, a 72-hour breach procedure (the supervisory authority is AZOP), and a records-of-processing document.
- **Account security.** TOTP 2FA; mandatory for owners before certificate upload. Session cookies are `Secure`, `HttpOnly`, `SameSite=Lax`. Auth endpoints are rate-limited.
- **Next.js.** Use ≥ 16.3 and keep it patched. CVE-2026-64649 (Server Actions SSRF) is mitigated by the patch **and** by pinning the Host header at the load balancer [S33]. Authorization never relies on `proxy.ts`.
- **Logging.** Structured logs with a redaction list (OIB, IBAN, email, names, amounts, certificate and key material, tokens). No request bodies.
- **Supply chain.** Lockfile, `npm audit` in CI, Dependabot or Renovate. Pen test before launch (Phase 6).
- **Cybersecurity law.** We are **not** an intermediary, so we are not a key entity by that route. Whether NIS2 / the Croatian Zakon o kibernetičkoj sigurnosti reaches a small SaaS is a legal question (section 9).

### 4.11 External integrations

| System | How | Phase |
|---|---|---|
| CIS (Porezna, B2C) | SOAP over HTTPS: hand-built envelope from a typed template, `xml-crypto` for XML-DSig (RSA-SHA256, exclusive c14n), `fast-xml-parser` for responses. Test and production endpoints come from the WSDL v1.10 package. | 3 |
| Intermediary (F2) | REST adapter behind an `EInvoiceProvider` interface: `send`, `getStatus`, `listInbox`, `getDocument`, `reject`, `markPaid` (eIzvještavanje), `reportNonDelivery`, `checkRecipient` (AMS). Both shortlisted intermediaries are polling-based. | 4 |
| Banks | File import of ISO 20022 **camt.053** XML plus a bank-specific CSV mapping. No PSD2 in the MVP. | 5 |
| Email | SMTP through nodemailer: Mailpit locally, Amazon SES (eu-central-1) in production | 1–2 |
| KMS / object storage | AWS SDK v3 (`@aws-sdk/client-kms`, `@aws-sdk/client-s3`) | 2–3 |

---

## 5. Recommendations for the open decisions in `CLAUDE.md`

These remain **recommendations** until the user approves them. `CLAUDE.md` is not edited by this plan.

| Decision | Recommendation | One-line justification |
|---|---|---|
| Product name | Keep the working name until Phase 6; choose a short Croatian-friendly name with a free `.hr` domain, and check the DZIV trademark database before branding. | It is a product decision. It is only needed for the domain, email sender, ToS and the "software producer" entry in ePorezna. |
| Database and ORM | **PostgreSQL 17 + Drizzle ORM** (`pg` driver, `drizzle-kit` migrations) | SQL-first, explicit transactions with isolation levels, RLS-friendly, and pg-boss can enqueue inside Drizzle transactions. |
| Auth method | **Better Auth**: email + password with email verification, TOTP 2FA plugin, organization plugin (roles and invitations), sessions in our DB | Self-hosted in our EU DB with built-in orgs and 2FA. Auth.js is now maintained by the Better Auth team, which recommends Better Auth for new projects [S32]. |
| Hosting and job runner | **AWS eu-central-1 (Frankfurt)**: ECS Fargate (web and worker containers from the Next.js `standalone` build), RDS PostgreSQL Multi-AZ with PITR, S3 with Object Lock, KMS, SES. **Jobs: pg-boss** in the worker. Alternative if the user wants an EU-owned provider: Scaleway (Paris) with managed PostgreSQL, Key Manager and Object Storage with object lock. | KMS-wrapped certificates and WORM retention are hard requirements. AWS covers both with mature managed services in an EU region, and pg-boss adds no new infrastructure. |
| E-invoice exchange | **Integrate with an existing intermediary** behind an adapter. Shortlist **ePoslovanje** and **moj-eRačun (mer)**, and choose after commercial talks (open question 2). Do **not** become an intermediary for the MVP; revisit above roughly 5,000 paying customers. | Becoming one requires ISO 27001, conformity testing, AS4/MPS/AMS operation and key-entity duties [S1 Art. 59–62; S15]. Both shortlisted intermediaries have documented REST APIs and demo environments [S23; S24]. ePoslovanje offers an "ERP is billed" model that suits a SaaS. |
| PDF generation | **@react-pdf/renderer** (`renderToBuffer` on the server) with an embedded Unicode font (Noto Sans) for č ć đ š ž; **bwip-js** for the HUB3 PDF417 and the F1 QR code (PNG/SVG) | Needs no headless Chromium in the container, the output is deterministic, and bwip-js supports PDF417 and QR with the HUB options (columns, EC level) [bwip-js README, v4.11.4]. |
| Styling and UI kit | **Tailwind CSS v4 + shadcn/ui** (copied-in Radix components) | Boring, accessible primitives with no runtime UI-kit lock-in, and easy to give a Croatian-language look. |
| Test stack | **Vitest** (unit, plus integration against a real PostgreSQL in Docker), **Playwright** (e2e). Add later: `xmllint-wasm` for XSD validation of F1 XML, and the official HR CIUS validator in CI for UBL. | The suggested default works; real-PG integration tests are required for RLS and concurrent numbering. |
| Pricing and billing | Options in section 6; **the user chooses**. Billing mechanism: Stripe Billing (Croatia is a supported Stripe country [S35]) for card subscriptions, with **our own invoices to customers issued as eRačuni** through our intermediary. | Our customers are domestic businesses, so our own invoices to them must be eRačuni once we are VAT-registered. |

---

## 6. Pricing options (for the user to choose)

Benchmarks: e-računi BASIC paušalisti 100 EUR/year incl. PDV; Solo 10 EUR/month incl. PDV; FiskAI from 6.99 EUR/month; Minimax 12 EUR + PDV/month; MIKROeRAČUN free. Paušalisti cannot deduct VAT, so **show prices including PDV**. Every option includes intermediary fees up to a fair-use volume (e.g. 50 eRačuni out per month); our marginal cost is roughly 0.08–0.30 EUR per document *(secondary [S29])*.

| Option | Shape | Pros | Cons |
|---|---|---|---|
| **A. One plan** | ~9.99 EUR/month or ~99 EUR/year incl. PDV, everything included, 30-day trial, startup discount in year 1 | Simplest to explain and bill; matches the "all-in, transparent" positioning | No free entry point against e-računi FREE and MIKROeRAČUN |
| **B. Freemium + one paid plan** | Free: quotes and plain invoices only (no F1/F2 and no KPR automation), ≤10 per month. Paid as in A. | Lowers acquisition cost; upgrades happen when F1/F2 is needed | Free users still cost storage and support |
| **C. Two tiers** | "Osnovni" (F1 + plain invoices + KPR, ~6.99 EUR/month) and "Puni" (adds eRačun send/receive, bank import, accountant access, ~11.99 EUR/month) | Price discrimination; paušalisti with only consumer customers pay less | Users who start in "Osnovni" must upgrade before 1 Jan 2027 for B2B, which may feel like a trap |

Common policy choices for the user: annual discount (e.g. 2 months free); free **archive mode** after cancellation, recommended since the retention duty outlives the subscription; accountant seats (free vs paid); a referral programme through accountants.

---

## 7. Phased roadmap

Ordered by regulatory pressure and dependencies. All four MVP areas are already legally in force, or will be on 1 Jan 2027, so **the public launch needs Phases 1–6 complete**. Phases 3 and 4 can run in parallel after Phase 2. External lead-time items (in bold) start in Phase 1.

| Phase | Goal | Done when |
|---|---|---|
| **1 Foundation** | Scaffold, auth with 2FA, organizations and memberships, tenant isolation (app + RLS), audit log, money/date/validation libraries, obrt profile, customers and items. **Start: intermediary commercial talks, legal and tax advisor engagement, company/OIB set-up, FINA DEMO certificate order.** | The Phase 1 plan's test plan passes: no cross-tenant read or write via actions or direct SQL; the money parser and rounding cases are green; e2e sign-up → onboarding → customer → item passes. |
| **2 Invoices and quotes** | Premises and devices, numbering, drafts → issue, quotes → invoice, storno and credit notes, PDF with HUB3, email sending, manual paid/unpaid, immutability triggers, WORM artefact storage, pg-boss worker. Channel `plain` only. | 50 concurrent issues produce 50 consecutive numbers with no gaps (integration test); issued rows cannot be updated through any path; HUB3 scanned correctly by at least 3 Croatian bank apps; PDF elements match the advisor-approved checklist. |
| **3 B2C fiscalization** | Certificate vault (KMS), ZKI, SOAP/XML-DSig RSA-SHA256, JIR, QR code, late delivery within 2 working days, payment-method change, working-day calendar, CIS response verification, onboarding guide (ePorezna premises registration, internal act template). | All F1 scenarios pass in the CIS **test** environment with a FINA DEMO certificate (normal, timeout → late delivery, CIS error codes, storno, payment change); generated XML validates against WSDL v1.10 XSD; one production smoke test on a real obrt with a real certificate. |
| **4 eRačun (F2)** | Intermediary adapter (chosen provider), UBL 2.1 HR CIUS generator, KPD 2025 catalogue and required KPD on lines, AMS recipient check, send/status, inbox polling and viewer (visualization plus attachments), reject with reason, eIzvještavanje for payments, rejections and non-delivery, FiskAplikacija authorization guide. Channel `einvoice` live from 2027-01-01 by calendar. | Every generated UBL passes the official validator (15.03.2026 version or later); send and receive work end-to-end in the intermediary's demo; rejection and payment reports are confirmed in demo; a received invoice shows "fiskalizirano" within 5 working days in the monitor. |
| **5 Bookkeeping** | Bank accounts, camt.053 and CSV import with dedupe, matching (poziv na broj, amount, IBAN), partial and over-payments, cash and card-settlement payments, automatic KPR rows plus manual and reversing rows, KPR export (PDF/CSV in the official column layout), tax-year parameters, 60k and class tracker, quarterly tax reminders, PO-SD worksheet, reports (unpaid, monthly receipts, by customer), accountant export. | Importing the same statement twice creates no duplicates; the KPR total for the year equals the sum of allocated payments; the PO-SD worksheet matches the KPR exactly; 2026 and 2027 parameters are seeded from adopted official sources. |
| **6 Launch readiness** | Our subscriptions and billing, ToS, DPA, privacy policy and sub-processor list, archive mode, export, account closure, retention purge, security hardening (enforced CSP, pen test, restore drill, alerting, incident runbook), support tooling, product name and domain, closed beta with 10–20 real obrtnici in production (CIS and intermediary). | The beta runs one full month (including a 20th-of-month eIzvještavanje cycle) with no compliance incident; pen-test highs are fixed; a restore drill from backup succeeds; legal documents are signed off by counsel. |
| **7 Public launch** | Marketing site, self-serve sign-up, migration import (CSV from e-računi and Solo), regulatory-change monitoring routine. | Public sign-up is open; the first paying cohort is onboarded; regulatory watch has an owner. |

**Calendar reality.** Today is 2026-10-09. Paušalisti must already comply with F1 and with eRačun receiving, and they must issue eRačuni from 2027-01-01, before this product can realistically launch. Early adopters will come from people switching away from existing tools during 2027, not from first-time compliance. Plan Phases 3 and 4 against the post-2027 rules only (RSA-SHA256, NN 97/26 certificates); do not implement the SHA1 path.

**Later extensions (out of MVP scope):** PSD2 bank feeds through a licensed AISP, recurring invoices, payment reminders (opomene), HUB3 slips for the obrtnik's own tax and contributions, thermal POS printing and a mobile app, OCR of received invoices, multi-currency beyond foreign-client invoices, VAT-registered customers, becoming an intermediary, and a public API.

---

## 8. Risks and unknowns

| Risk | Impact | Mitigation |
|---|---|---|
| **Regulatory churn**: NN 97/26 in 2027, 2027 tax changes, new spec and validator versions, AMS/intermediary API changes | Wrong output means penalties for customers | Rules as data (`regulatory_calendar`, `tax_year_parameters`); a code comment naming the spec version (CLAUDE.md rule); monthly regulatory watch; golden-file tests per spec version |
| **ZKI algorithm from 2027 is unclear** (SHA1 + MD5 per NN 153/25 vs "more precise" hash definition in NN 97/26) | F1 rejected or invalid ZKI | Read NN 97/26 and v2.7 first in Phase 3; prove the algorithm against the CIS test environment; add test vectors |
| **Dependence on one intermediary** (pricing, outage, API change) | eRačun stops | Adapter interface; contract with SLA and price lock; second provider evaluated; MIKROeRAČUN as the user's manual fallback |
| **Onboarding friction**: ePorezna premises registration, FiskAplikacija authorization (two separate switches), intermediary contract, FINA certificate | Drop-off, misconfiguration (e.g. unfiscalized received invoices [S3 FAQ 7]) | Guided checklist with screenshots; status checks through the intermediary API; reminder emails |
| **Free state tool**: MIKROeRAČUN issuing from 2027, FiskAplikacija exports | Lower willingness to pay | Differentiate on F1, KPR automation, bank matching, UX, and accountant workflows; keep the price at or below ~10 EUR/month |
| **Liability**: we are neither taxpayer nor intermediary, but bugs cause fines | Claims and reputation | ToS liability cap, professional indemnity insurance, extensive compliance tests, reviewer gate on every compliance change |
| **Our own company**: we must be a legal entity with an OIB; likely VAT-registered; our invoices to obrtnici are domestic B2B and therefore eRačuni | Billing blocked | Set up the entity in Phase 1; dogfood our own eRačun issuing in Phase 6 |
| **Certificate security** | Key theft would let someone fiscalize in a customer's name | KMS envelope encryption, short-lived in-memory keys, 2FA plus re-auth for upload, audit, no export |
| **Data-retention cost** for churned customers (11 years) | Storage cost | Small per-org footprint; archive mode on cold storage tiers |
| **NIS2 / Zakon o kibernetičkoj sigurnosti applicability** to us | Extra obligations | Legal opinion in Phase 1 |
| **Bank statement formats** vary by bank | Import failures | camt.053 first; per-bank CSV mappings added from beta users' samples |
| **Spec PDFs not yet read** (see the limitation note at the top) | Hidden requirements | Mandatory first step of the Phase 2–4 plans |
| **Time to market** vs 1 Jan 2027 | Customers pick incumbents first | Accept it; target switchers in 2027; consider a waitlist |

---

## 9. Open questions for the user

**Blocking Phase 1**

1. **Legal entity and OIB** behind the product (d.o.o.? in VAT?). Needed for the intermediary contract, the software-producer entry customers make in ePorezna, and our own billing.
2. **Intermediary**: may I prepare a comparison request for ePoslovanje and moj-eRačun (API terms, ERP billing model, per-document price, SLA)? And should intermediary fees be included in our price (recommended) or passed through?
3. **Roles**: owner / accountant / member (proposed in the Phase 1 plan). Should accountants get free multi-client access?

**Needed before later phases**

4. **Retention period**: approve 11 years after the year of issue (pending tax-advisor confirmation), and free read-only archive mode after cancellation.
5. **Foreign clients**: support foreign-currency invoices and EU reverse-charge notes in the MVP? Many paušalisti are IT freelancers with foreign clients. I recommend yes for foreign business customers only, with the KPR recording the EUR actually credited.
6. **B2G** (schools, hospitals, municipalities) in the MVP?
7. **Cash and in-person sales**: include cash (`G`) and card (`K`) B2C invoices in the MVP (recommended, since F1 supports them)? Thermal-printer receipts are out of scope.
8. **Launch strategy**: is a limited early release (Phases 1–3: invoices + F1 + KPR basics, with users relying on MIKROeRAČUN for eRačun) acceptable, or does nothing ship before Phase 6?
9. **Pricing option** (A, B or C in section 6), the free tier, and the annual discount.
10. **Hosting**: AWS Frankfurt (recommended) or an EU-owned provider (Scaleway)?
11. **Advisors**: will you engage a Croatian tax advisor (invoice elements, note wording, numbering, KPR, retention) and a lawyer (ToS, DPA, liability, NIS2)? Several rules above are marked "confirm with advisor".
12. **Zajednički obrt** (several owners) and obrtnici with more than one obrt: in or out of the MVP?
13. **Product name**: when do you want to decide?

**Ambiguous or contradictory points in the sources** (for awareness):

- **JIR length**: NN 153/25 Art. 7(2) says 32 characters, Art. 7(3) describes the hyphenated 8-4-4-4-12 UUID (36), and Annex 1 says Char(36) [S8].
- **Spec v2.7 date**: the announcement is dated 06.07.2026, the file name and the Tehnički podaci page say 21.07.2026 [S9; S11].
- **ZKI algorithm from 2027**: see section 8 [S8; S12].
- **EU norm version**: the law cites EN 16931-1:2017 [S1]; the HR CIUS is described as built on HRN EN 16931-1:2020 *(secondary)*.
- **Non-VAT note**: čl. 90 **st. 1** since 1 Jan 2025, but some vendor templates still print **st. 2** [S18].
- **Retention**: 6 years (eRačun, ZoF) vs 10 years from the start of the limitation period (OPZ) vs 11 years (Zakon o računovodstvu); no explicit paušalist rule found [S1; S19].
- **Yearly numbering reset**: assumed in `CLAUDE.md`, but not stated in the pravilnik excerpt I read [S8].
- **B2B cash/card from 2027** (Art. 15 F1 with recipient OIB) vs eRačun: unclear for non-VAT issuers [S29b].
- **2027 paušal classes**: community sources first reported a merge of classes 1 and 2 with increases for all, then changes for classes 6 and 7 only; the draft law is not adopted as far as I found [S22].
- **Prices**: third-party price figures for moj-eRačun disagree (0.15 EUR per invoice with a 5 EUR minimum vs 8 EUR/month); the e-računi page says prices exclude VAT but marks the paušalist BASIC price "sa PDV" and seems to date from Sept 2024 [S25; S29].
- **Intermediary count**: Porezna's list shows 36 on 7.10.2026, while a vendor comparison says 33 [S14; S29].

---

## 10. Sources (all accessed 2026-10-09)

| Ref | Source | Page/document date |
|---|---|---|
| S1 | Zakon o fiskalizaciji, NN 89/2025 – https://narodne-novine.nn.hr/clanci/sluzbeni/full/2025_06_89_1233.html | 13.6.2025 |
| S2 | Porezna uprava – Izdavatelji i primatelji eRačuna te obveza izdavanja eRačuna – https://porezna-uprava.gov.hr/hr/izdavatelji-i-primatelji-eracuna-te-obveza-izdavanja-eracuna-azurirano-7-11-2025/8048 | updated 17.4.2026 |
| S3 | Porezna uprava – Fiskalizacija eRačuna – https://porezna-uprava.gov.hr/hr/fiskalizacija-eracuna-azurirano-17-4-2026/8049 | updated 5.6.2026 |
| S4 | Porezna uprava – Izvještajni sustav – https://porezna-uprava.gov.hr/hr/izvjestajni-sustav/8051 | updated 17.4.2026 |
| S5 | Porezna uprava – MIKROeRAČUN – https://porezna-uprava.gov.hr/8190 | no date on page |
| S6 | Porezna uprava – Nadogradnja MIKROeRAČUNA – https://porezna-uprava.gov.hr/hr/nadogradnja-mikroeracuna-besplatno-i-jednostavno-rjesenje-za-izdavanje-eracuna/8911 | 2.9.2026 |
| S7 | Porezna uprava – Računi u krajnjoj potrošnji – https://porezna-uprava.gov.hr/hr/racuni-u-krajnjoj-potrosnji-azurirano-30-1-2026/8034 | updated 7.10.2026 |
| S8 | Pravilnik o fiskalizaciji računa u krajnjoj potrošnji, NN 153/2025 – https://narodne-novine.nn.hr/clanci/sluzbeni/2025_12_153_2278.html | 17.12.2025 |
| S9 | Porezna uprava – Obavijest: tehnička unapređenja (spec v2.7, RSA-SHA1/TLS 1.1 removal) – https://porezna-uprava.gov.hr/hr/obavijest-obveznicima-fiskalizacije-u-krajnjoj-potrosnji-tehnicka-unapredjenja-u-sustavu-fiskalizacije-u-krajnjoj-potrosnji/8769 | 6.7.2026 |
| S10 | Tehnička specifikacija za korisnike v2.7 (PDF) – https://porezna-uprava.gov.hr/UserDocsImages/Fiskalizacija/Tehni%C4%8Dke%20specifikacije/Fiskalizacija%20-%20Tehnicka%20specifikacija%20za%20korisnike_v2.7%20(21.07.2026.).pdf | 21.7.2026 (not machine-read) |
| S11 | Porezna – Tehnički podaci (specs, WSDL v1.10) – https://porezna.gov.hr/fiskalizacija/gotovinski-racuni/tehnicki-podaci/o/tehnicki-podaci | WSDL 24.11.2025 |
| S12 | TEB – Pravilnik o izmjenama i dopunama Pravilnika o fiskalizaciji računa u krajnjoj potrošnji (NN 97/26) – https://www.teb.hr/novosti/2026/pravilnik-o-izmjenama-i-dopunama-pravilnika-o-fiskalizaciji-racuna-u-krajnjoj-potrosnji-nar-nov-br-9726/ *(secondary)* | 3.9.2026 |
| S13 | Porezna – eRačun documentation (HR CIUS 12.03.2026, validator 13.03.2026, UBL 2.1 15.04.2026, AS4/MPS/AMS specs Oct 2025, rejection application response 28.07.2026) – https://porezna.gov.hr/fiskalizacija/bezgotovinski-racuni/eracun | various |
| S14 | Porezna uprava – Popis informacijskih posrednika – https://porezna-uprava.gov.hr/hr/popis-informacijskih-posrednika/8019 | updated 7.10.2026 |
| S15 | Porezna uprava – Vodič kroz Fiskalizaciju 2.0 – https://porezna-uprava.gov.hr/hr/vodic-kroz-fiskalizaciju-2-0/8149 | 9.12.2025 |
| S16 | Porezna uprava – Obrtnici paušalisti – https://porezna-uprava.gov.hr/en/obrtnici-pausalisti/4564 | PDF updated 29.5.2026 |
| S17 | Pravilnik o izmjenama i dopunama Pravilnika o paušalnom oporezivanju samostalnih djelatnosti, NN 16/2025 – https://www.zakon.hr/cms.htm?id=540477 *(unofficial host)* | 31.1.2025 |
| S18 | TEB – Klauzula o oslobođenju od plaćanja PDV-a na računima malih poreznih obveznika od 1.1.2025. – https://www.teb.hr/novosti/2025/klauzula-o-oslobodenju-od-placanja-pdv-a-na-racunima-malih-poreznih-obveznika-od-112025/ *(secondary)* | 2025 |
| S19 | TEB – Čuvanje računa i knjigovodstvene dokumentacije – https://www.teb.hr/novosti/2026/cuvanje-racuna-i-knjigovodstvene-dokumentacije/ *(secondary)* | 10.3.2026 |
| S20 | HUB – 2D barkod, HUB 3A, verzija 6 – https://www.hub.hr/sites/default/files/inline-files/2DBK_EUR_Uputa_1.pdf | Sept 2022 (not machine-read) |
| S21 | Fiskalopedija – Knjiga prometa (KPR) – https://fiskalopedija.hr/baza-znanja/knjiga-prometa-kpr *(secondary)*; S21b: KPR iz FiskAplikacije – https://fiskalopedija.hr/baza-znanja/kpr-fiskaplikacija | both 11.9.2026 |
| S22 | Fiskalopedija – Paušalni obrt 2027 – https://fiskalopedija.hr/zajednica/pitanje/28/novosti-pausalni-obrt-za-2027 *(secondary)*; TEB – Izmjene poreznih zakona, savjetovanja – https://www.teb.hr/novosti/2026/izmjene-poreznih-zakona-i-zakona-o-doprinosima-otvorena-savjetovanja/ | 13.8.2026 / 2026 |
| S23 | moj-eRačun – API specification (v2.6) – https://manual.moj-eracun.hr/documentation/api-specification-2/ | 27.1.2026 |
| S24 | ePoslovanje – Za developere – https://eposlovanje.hr/za-developere/ | undated |
| S25 | e-računi – Cjenik – https://e-racuni.hr/hrracuni/cjenik/ | undated (~Sept 2024) |
| S26 | Solo – Cijene – https://solo.com.hr/cijene | undated |
| S27 | Minimax – Cjenik – https://www.minimax.hr/cjenik/ | undated |
| S28 | FiskAI – Cijene za paušalni obrt – https://www.fiskai.hr/cijene/pausalni-obrt/ | © 2026 |
| S29 | FiskalAPI – Usporedba informacijskih posrednika – https://www.fiskalapi.hr/alati/posrednik-usporedba *(vendor)* | 17.12.2025 |
| S29b | Pointer – New technical specification (B2B cash/card F1 with recipient OIB from 1.1.2026, Art. 15) – https://pointer.hr/new-technical-specification-for-fiscalization/ *(secondary)* | 14.7.2025 |
| S30 | FINA certificate price and validity (via Fiskalopedija/FiskAI) – https://fiskalopedija.hr/baza-znanja/fiskalni-certifikat *(secondary)* | 2026 |
| S31 | Porezna uprava – Istek aplikacijskog certifikata u rujnu 2026. – https://porezna-uprava.gov.hr/hr/obavijest-obveznicima-fiskalizacije-u-krajnjoj-potrosnji-istek-aplikacijskog-certifikata-u-rujnu-2026-godine/8837 | 2026 |
| S32 | Better Auth – Auth.js joins Better Auth – https://www.better-auth.com/blog/authjs-joins-better-auth | 22.9.2025 |
| S33 | CVE-2026-64649 (Next.js Server Actions SSRF) – https://nvd.nist.gov/vuln/detail/cve-2026-64649 | 2026 |
| S34 | Porezna uprava opinion KLASA 410-01/26-01/54 on paušalist B2C fiscalization of bank-transfer invoices, as reported by Fiskalopedija/RRiF – https://www.rrif.hr/obveza_fiskalizacije_racuna_u_krajnjoj_potrosnji_z-4194-misljenje/ *(secondary)* | 12.2.2026 |
| S35 | Stripe Services Agreement – Croatia – https://stripe.com/en-ch/legal/ssa/hr | current |

Library documentation consulted: Drizzle transactions (https://orm.drizzle.team/docs/transactions), pg-boss README (https://github.com/timgit/pg-boss), bwip-js README v4.11.4 of 2026-08-19 (https://github.com/metafloor/bwip-js), react-pdf Node API (https://react-pdf.org/node), Better Auth Next.js integration, organization and 2FA plugins (https://www.better-auth.com/docs/integrations/next, …/plugins/organization, …/plugins/2fa), Next.js blog (16.3, 3 Aug 2026).
