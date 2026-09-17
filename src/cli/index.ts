#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

import { Command } from 'commander';
import { ZodError } from 'zod';

import { calculate } from '../calculate/totals.js';
import { invoiceInputSchema } from '../model/invoice.js';
import { IMPLEMENTED_RULES, validate } from '../rules/index.js';
import { fromUbl, UblParseError } from '../ubl/parse.js';
import { toUbl } from '../ubl/serialize.js';

const program = new Command();

program
  .name('ubl-billing')
  .description('Build, validate and inspect EN 16931 / Peppol BIS Billing 3.0 invoices.')
  .version('0.1.0');

/**
 * Exit codes: 0 valid, 1 violations found, 2 could not run. Kept distinct so
 * a pipeline cannot mistake "the file was unreadable" for "the invoice is fine".
 */
program
  .command('build')
  .description('Calculate totals from a JSON invoice description and write UBL XML')
  .argument('<input.json>')
  .option('-o, --output <file>', 'write XML here instead of stdout')
  .option('--no-peppol', 'validate against EN 16931 only, without the Peppol BIS rules')
  .option('--pretty', 'indent the XML')
  .action(async (inputPath: string, options: { output?: string; peppol: boolean; pretty?: boolean }) => {
    const raw: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
    const invoice = calculate(invoiceInputSchema.parse(raw));

    const violations = validate(invoice, { peppol: options.peppol });
    for (const violation of violations) report(violation);

    if (violations.some((violation) => violation.severity === 'fatal')) {
      process.exitCode = 1;
      return;
    }

    const xml = toUbl(invoice, { pretty: options.pretty ?? false });
    if (options.output === undefined) process.stdout.write(xml);
    else {
      await writeFile(options.output, xml, 'utf8');
      process.stderr.write(`wrote ${options.output}\n`);
    }
  });

program
  .command('validate')
  .description('Validate an existing UBL XML invoice')
  .argument('<invoice.xml>')
  .option('--no-peppol', 'validate against EN 16931 only, without the Peppol BIS rules')
  .action(async (path: string, options: { peppol: boolean }) => {
    const invoice = fromUbl(await readFile(path, 'utf8'));
    const violations = validate(invoice, { peppol: options.peppol });

    if (violations.length === 0) {
      process.stdout.write(`${path}: valid (${invoice.lines.length} line(s), ${invoice.totals.payableAmount} ${invoice.currency} payable)\n`);
      return;
    }
    for (const violation of violations) report(violation);
    process.exitCode = violations.some((violation) => violation.severity === 'fatal') ? 1 : 0;
  });

program
  .command('inspect')
  .description('Print the parsed model of a UBL XML invoice as JSON')
  .argument('<invoice.xml>')
  .action(async (path: string) => {
    const invoice = fromUbl(await readFile(path, 'utf8'));
    process.stdout.write(`${JSON.stringify(invoice, null, 2)}\n`);
  });

program
  .command('rules')
  .description('List the rule identifiers this tool implements')
  .action(() => {
    for (const rule of IMPLEMENTED_RULES) process.stdout.write(`${rule}\n`);
    process.stdout.write(`\n${IMPLEMENTED_RULES.length} rules\n`);
  });

function report(violation: { rule: string; severity: string; message: string; terms: readonly string[]; lineId?: string }): void {
  const where = violation.lineId === undefined ? '' : ` [line ${violation.lineId}]`;
  process.stdout.write(`${violation.severity.toUpperCase().padEnd(7)} ${violation.rule}${where}: ${violation.message} (${violation.terms.join(', ')})\n`);
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof ZodError) {
    process.stderr.write('The input does not match the invoice schema:\n');
    for (const issue of error.issues) process.stderr.write(`  ${issue.path.join('.')}: ${issue.message}\n`);
  } else if (error instanceof UblParseError) {
    process.stderr.write(`Could not parse the document: ${error.message}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 2;
}
