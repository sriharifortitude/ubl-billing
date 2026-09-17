import type { InvoiceInput } from '../../src/model/invoice.js';

/**
 * A German domestic B2B invoice: two lines at 19%, one at 7%, a document
 * allowance. The hand-checked totals appear in the tests that use it, so a
 * change to the calculation that alters them is a failure, not a new
 * expected value.
 */
export const domesticInvoice: InvoiceInput = {
  number: 'RE-2026-0042',
  issueDate: '2026-09-15',
  dueDate: '2026-10-15',
  typeCode: '380',
  currency: 'EUR',
  buyerReference: 'PO-7781',
  seller: {
    name: 'Muster Consulting GmbH',
    vatId: 'DE123456789',
    legalRegistrationId: 'HRB 12345',
    electronicAddress: { scheme: '9930', value: 'DE123456789' },
    address: { street: 'Beispielstraße 1', city: 'Berlin', postalCode: '10115', countryCode: 'DE' },
    contact: { name: 'Anna Muster', email: 'billing@muster.example' },
  },
  buyer: {
    name: 'Kunde AG',
    vatId: 'DE987654321',
    electronicAddress: { scheme: '0204', value: '04011000-12345-67' },
    address: { street: 'Kundenweg 9', city: 'München', postalCode: '80331', countryCode: 'DE' },
  },
  payment: {
    meansCode: '58',
    creditTransfer: { accountId: 'DE89370400440532013000', accountName: 'Muster Consulting GmbH', serviceProviderId: 'COBADEFFXXX' },
  },
  paymentTerms: 'Zahlbar innerhalb 30 Tagen ohne Abzug.',
  allowances: [{ amount: '50.00', reason: 'Loyalty discount', vatCategory: 'S', vatRate: '19' }],
  lines: [
    { id: '1', quantity: '10', unitCode: 'HUR', netPrice: '120.00', itemName: 'Consulting', vatCategory: 'S', vatRate: '19' },
    { id: '2', quantity: '3', unitCode: 'C62', netPrice: '0.3333', itemName: 'Widget', vatCategory: 'S', vatRate: '19' },
    { id: '3', quantity: '2', unitCode: 'C62', netPrice: '24.50', itemName: 'Printed manual', vatCategory: 'S', vatRate: '7' },
  ],
};

/** Reverse charge: services from DE to an FR business. */
export const reverseChargeInvoice: InvoiceInput = {
  number: 'RE-2026-0043',
  issueDate: '2026-09-15',
  currency: 'EUR',
  buyerReference: 'FR-PO-1',
  paymentTerms: '30 days net',
  seller: domesticInvoice.seller,
  buyer: {
    name: 'Société Cliente SAS',
    vatId: 'FR12345678901',
    electronicAddress: { scheme: '0009', value: '12345678900012' },
    address: { street: '1 rue Exemple', city: 'Paris', postalCode: '75001', countryCode: 'FR' },
  },
  // VATEX-EU-AE is the code from the CEF VATEX list for "reverse charge".
  vatExemptionReasons: { AE: { reason: 'Reverse charge', code: 'VATEX-EU-AE' } },
  lines: [{ id: '1', quantity: '1', unitCode: 'LS', netPrice: '5000.00', itemName: 'Software development', vatCategory: 'AE', vatRate: '0' }],
};
