/**
 * Code lists referenced by EN 16931. Each is the subset the model actually
 * uses, with the source named, so a reviewer can check the values rather
 * than trust them.
 */

/** UNTDID 1001, restricted by EN 16931 to the invoice and credit note codes. */
export const INVOICE_TYPE_CODES = {
  /** Commercial invoice. */
  '380': 'Commercial invoice',
  /** Credit note. */
  '381': 'Credit note',
  '384': 'Corrected invoice',
  '389': 'Self-billed invoice',
  '326': 'Partial invoice',
} as const;
export type InvoiceTypeCode = keyof typeof INVOICE_TYPE_CODES;

/**
 * UNTDID 5305 VAT category codes as constrained by EN 16931 (BT-151, BT-118).
 * The rule set for each category is in rules/vat.ts.
 */
export const VAT_CATEGORIES = {
  S: 'Standard rate',
  Z: 'Zero rated goods',
  E: 'Exempt from tax',
  AE: 'VAT Reverse Charge',
  K: 'VAT exempt for EEA intra-community supply of goods and services',
  G: 'Free export item, tax not charged',
  O: 'Services outside scope of tax',
  L: 'Canary Islands general indirect tax',
  M: 'Tax for production, services and importation in Ceuta and Melilla',
} as const;
export type VatCategory = keyof typeof VAT_CATEGORIES;

/**
 * Categories where the rate must be zero and an exemption reason is
 * expected (BR-E-10, BR-AE-10, BR-K-10, BR-G-10, BR-O-10 and companions).
 */
export const ZERO_RATE_CATEGORIES: ReadonlySet<VatCategory> = new Set(['Z', 'E', 'AE', 'K', 'G', 'O']);

/** Categories for which BT-120 exemption reason text or BT-121 code is required. */
export const EXEMPTION_REASON_CATEGORIES: ReadonlySet<VatCategory> = new Set(['E', 'AE', 'K', 'G', 'O']);

/** UNTDID 4461 payment means, the subset a typical invoice uses (BT-81). */
export const PAYMENT_MEANS_CODES = {
  '10': 'In cash',
  '30': 'Credit transfer',
  '31': 'Debit transfer',
  '42': 'Payment to bank account',
  '48': 'Bank card',
  '49': 'Direct debit',
  '58': 'SEPA credit transfer',
  '59': 'SEPA direct debit',
} as const;
export type PaymentMeansCode = keyof typeof PAYMENT_MEANS_CODES;

/** UN/ECE Recommendation 20 unit codes, the ones seen on most invoices (BT-130). */
export const COMMON_UNIT_CODES = new Set([
  'C62', // one (unit)
  'EA', // each
  'HUR', // hour
  'DAY',
  'MON', // month
  'KGM', // kilogram
  'GRM', // gram
  'LTR', // litre
  'MTR', // metre
  'MTK', // square metre
  'MTQ', // cubic metre
  'KWH', // kilowatt hour
  'PCE', // piece
  'SET',
  'XPK', // package
  'LS', // lump sum
  'E48', // service unit
]);

/**
 * ISO 3166-1 alpha-2. Validated by shape here; the full list is not
 * embedded because it changes and a stale copy would reject a real country.
 * Access points validate against the live list.
 */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/** ISO 4217 alpha-3 by shape, for the same reason. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** EU member states, for the intra-community (K) check and reverse-charge sanity. */
export const EU_MEMBER_STATES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * Peppol BIS Billing 3.0 identifiers. These two strings are what an access
 * point keys its validation on; a document without them is not a Peppol
 * document, whatever else is right about it.
 */
export const PEPPOL_CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
export const PEPPOL_PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

/**
 * Electronic address schemes (BT-34-1, BT-49-1) from the Peppol EAS code
 * list. The common ones; the list has ~100 entries and is maintained by
 * OpenPeppol.
 */
export const ELECTRONIC_ADDRESS_SCHEMES = {
  '0002': 'System Information et Repertoire des Entreprise et des Etablissements: SIRENE (FR)',
  '0007': 'Organisationsnummer (SE)',
  '0009': 'SIRET-CODE (FR)',
  '0037': 'LY-tunnus (FI)',
  '0060': 'Data Universal Numbering System (D-U-N-S Number)',
  '0088': 'EAN Location Code (GLN)',
  '0096': 'Danish Chamber of Commerce Scheme (DK)',
  '0106': 'Vereniging van Kamers van Koophandel en Fabrieken in Nederland (NL)',
  '0184': 'DIGSTORG (DK)',
  '0192': 'Enhetsregisteret ved Bronnoysundregisterne (NO)',
  '0195': 'Singapore UEN identifier',
  '0196': 'Kennitala - Iceland legal id',
  '0198': 'ERSTORG (DK)',
  '0201': 'Codice Univoco Unità Organizzativa iPA (IT)',
  '0204': 'Leitweg-ID (DE)',
  '0208': 'Numero d\'entreprise / ondernemingsnummer / Unternehmensnummer (BE)',
  '0209': 'GS1 identification keys',
  '0210': 'CODICE FISCALE (IT)',
  '0211': 'PARTITA IVA (IT)',
  '0212': 'Finnish Organization Identifier',
  '0213': 'Finnish Organization Value Add Tax Identifier',
  '9915': 'Österreichisches Verwaltungs bzw. Organisationskennzeichen (AT)',
  '9918': 'SOCIETY FOR WORLDWIDE INTERBANK FINANCIAL TELECOMMUNICATION S.W.I.F.T',
  '9919': 'Kennziffer des Unternehmensregisters (AT)',
  '9920': 'Agencia Española de Administración Tributaria (ES)',
  '9922': 'Andorra VAT number',
  '9923': 'Albania VAT number',
  '9924': 'Bosnia and Herzegovina VAT number',
  '9925': 'Belgium VAT number',
  '9926': 'Bulgaria VAT number',
  '9927': 'Switzerland VAT number',
  '9928': 'Cyprus VAT number',
  '9929': 'Czech Republic VAT number',
  '9930': 'Germany VAT number',
  '9931': 'Estonia VAT number',
  '9932': 'United Kingdom VAT number',
  '9933': 'Greece VAT number',
  '9934': 'Croatia VAT number',
  '9935': 'Ireland VAT number',
  '9936': 'Liechtenstein VAT number',
  '9937': 'Lithuania VAT number',
  '9938': 'Luxemburg VAT number',
  '9939': 'Latvia VAT number',
  '9940': 'Monaco VAT number',
  '9941': 'Montenegro VAT number',
  '9942': 'Macedonia, of the former Yugoslav Republic VAT number',
  '9943': 'Malta VAT number',
  '9944': 'Netherlands VAT number',
  '9945': 'Poland VAT number',
  '9946': 'Portugal VAT number',
  '9947': 'Romania VAT number',
  '9948': 'Serbia VAT number',
  '9949': 'Slovenia VAT number',
  '9950': 'Slovakia VAT number',
  '9951': 'San Marino VAT number',
  '9952': 'Turkey VAT number',
  '9953': 'Holy See (Vatican City State) VAT number',
  '9955': 'Swedish VAT number',
  '9957': 'French VAT number',
  '9959': 'Employer Identification Number (EIN, USA)',
} as const;
export type ElectronicAddressScheme = keyof typeof ELECTRONIC_ADDRESS_SCHEMES;
