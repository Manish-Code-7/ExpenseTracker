/**
 * Who sends transaction alerts in India, by email and by SMS.
 *
 * Data, not logic — kept in one place so adding a bank is a one-line change
 * and both ingestion sources learn about it at once. SMS sender IDs are the
 * six-character DLT headers Indian operators use (the "VM-HDFCBK" in a text);
 * only the trailing part is matched, since the two-letter operator prefix
 * varies by circuit.
 */

export type Bank = {
  name: string;
  /** Gmail addresses the bank sends alerts from. */
  email: string[];
  /** DLT sender-ID fragments, matched case-insensitively. */
  sms: string[];
};

export const BANKS: Bank[] = [
  // --- large private banks -------------------------------------------------
  { name: "HDFC Bank", email: ["alerts@hdfcbank.net", "alerts@hdfcbank.com", "emailstatements.cc@hdfcbank.com"], sms: ["HDFCBK", "HDFCBN"] },
  { name: "ICICI Bank", email: ["credit_cards@icicibank.com", "no.reply@icicibank.com", "alerts@icicibank.com"], sms: ["ICICIB", "ICICIT"] },
  { name: "Axis Bank", email: ["alerts@axisbank.com", "cc.statements@axisbank.com", "creditcards@axisbank.com"], sms: ["AXISBK", "AxisBk"] },
  { name: "Kotak Mahindra", email: ["alerts@kotak.com", "noreply@kotak.com", "creditcardstatements@kotak.com"], sms: ["KOTAKB", "KMBANK"] },
  { name: "Yes Bank", email: ["alerts@yesbank.in", "yestouch@yesbank.in"], sms: ["YESBNK", "YESBK"] },
  { name: "IndusInd Bank", email: ["alerts@indusind.com", "customercare@indusind.com"], sms: ["INDUSB", "IndusB"] },
  { name: "IDFC FIRST Bank", email: ["alerts@idfcfirstbank.com", "banker@idfcfirstbank.com"], sms: ["IDFCFB", "IDFCBK"] },
  { name: "RBL Bank", email: ["alerts@rblbank.com", "cardservices@rblbank.com"], sms: ["RBLBNK", "RBLCRD"] },
  { name: "Federal Bank", email: ["alerts@federalbank.co.in", "support@federalbank.co.in"], sms: ["FEDBNK", "FedBnk"] },
  { name: "AU Small Finance", email: ["alerts@aubank.in"], sms: ["AUBANK", "AUBNK"] },
  { name: "Bandhan Bank", email: ["alerts@bandhanbank.com"], sms: ["BANDAN", "BDNBNK"] },

  // --- public sector -------------------------------------------------------
  { name: "State Bank of India", email: ["no-reply@sbi.co.in", "donotreply@sbi.co.in", "alerts@sbi.co.in"], sms: ["SBIINB", "SBIBNK", "ATMSBI", "SBIUPI"] },
  { name: "SBI Card", email: ["statements@sbicard.com", "customercare@sbicard.com"], sms: ["SBICRD", "SBICard"] },
  { name: "Punjab National Bank", email: ["alerts@pnb.co.in", "care@pnb.co.in"], sms: ["PNBSMS", "PNBBNK"] },
  { name: "Bank of Baroda", email: ["alerts@bankofbaroda.com", "nointernet@bankofbaroda.co.in"], sms: ["BOBTXN", "BOBSMS"] },
  { name: "Canara Bank", email: ["alerts@canarabank.com"], sms: ["CANBNK", "CBSSBI"] },
  { name: "Union Bank of India", email: ["alerts@unionbankofindia.com"], sms: ["UNIONB", "UBININ"] },
  { name: "Bank of India", email: ["alerts@bankofindia.co.in"], sms: ["BOIIND", "BOISMS"] },
  { name: "Indian Bank", email: ["alerts@indianbank.co.in"], sms: ["INDBNK", "IndBnk"] },
  { name: "Central Bank of India", email: ["alerts@centralbank.co.in"], sms: ["CENTBK"] },

  // --- foreign banks -------------------------------------------------------
  { name: "Standard Chartered", email: ["alerts@sc.com", "creditcards.in@sc.com"], sms: ["SCBANK", "StanChart"] },
  { name: "HSBC India", email: ["alerts@hsbc.co.in", "creditcards@hsbc.co.in"], sms: ["HSBCBK", "HSBCIN"] },
  { name: "American Express", email: ["americanexpress@welcome.americanexpress.com", "alerts@americanexpress.com"], sms: ["AMEXIN", "AMEX"] },
  { name: "DBS Bank", email: ["alerts@dbs.com", "customercareindia@dbs.com"], sms: ["DBSBNK", "DBSSMS"] },

  // --- neobanks, wallets and card issuers ---------------------------------
  { name: "Paytm Payments Bank", email: ["alerts@paytmbank.com", "care@paytm.com"], sms: ["PYTMPB", "PAYTMB"] },
  { name: "Airtel Payments Bank", email: ["alerts@airtelbank.com"], sms: ["AIRTLB", "ATLBNK"] },
  { name: "Fi Money", email: ["alerts@fi.money", "care@fi.money"], sms: ["FIMNEY", "FiMony"] },
  { name: "Jupiter", email: ["alerts@jupiter.money", "care@jupiter.money"], sms: ["JUPITR", "JUPTR"] },
  { name: "OneCard", email: ["care@getonecard.app", "alerts@getonecard.app"], sms: ["ONECRD", "OneCrd"] },
  { name: "Slice", email: ["care@sliceit.com"], sms: ["SLICEIT", "SLICE"] },
  { name: "Amazon Pay ICICI", email: ["no.reply@icicibank.com"], sms: ["AMZNPY"] },
];

/** Every alert sender address, for building the Gmail query. */
export const ALERT_SENDERS = BANKS.flatMap((b) => b.email);

/** Every SMS sender fragment, lowercased for comparison. */
const SMS_IDS = BANKS.flatMap((b) => b.sms.map((s) => s.toLowerCase()));

/**
 * Whether a text came from a bank.
 *
 * Sender IDs arrive with an operator prefix and separators that differ by
 * circuit — "VM-HDFCBK", "AD-HDFCBK-S", "JD-HDFCBK" are all HDFC — so the
 * comparison is on the alphabetic core rather than the whole string.
 */
export function isBankSender(sender: string): boolean {
  const core = sender.toLowerCase().replace(/[^a-z]/g, "");
  return SMS_IDS.some((id) => core.includes(id));
}

/** The bank a sender belongs to, when we can tell. */
export function bankForSender(sender: string): string | null {
  const core = sender.toLowerCase().replace(/[^a-z]/g, "");
  for (const bank of BANKS) {
    if (bank.sms.some((id) => core.includes(id.toLowerCase()))) return bank.name;
  }
  return null;
}
