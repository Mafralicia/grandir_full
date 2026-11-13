import { brl, DOSSIER_COLUMNS, dossierRows, identifiers, safeCell, type Dossier } from '@grandir/engines';
import { strToU8, zipSync } from 'fflate';
import PDFDocument from 'pdfkit';

const date = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Dossiê em PDF: capa com o resumo e uma ficha por ocorrência, com memória de cálculo e cronologia. */
export function dossierPdf(dossier: Dossier): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: dossier.subject, Author: dossier.company, Creator: 'Grandir' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const INK = '#1E2022';
    const BODY = '#475569';
    const GOLD = '#A65E0B';
    const width = doc.page.width - 96;
    const label = (text: string) => doc.fontSize(8).fillColor(GOLD).font('Helvetica-Bold').text(text.toUpperCase(), { characterSpacing: 0.8 });
    const body = (text: string) => doc.fontSize(10).fillColor(BODY).font('Helvetica').text(text, { width, lineGap: 2 });

    doc.fontSize(9).fillColor(GOLD).font('Helvetica-Bold').text('GRANDIR · DOSSIÊ DE EVIDÊNCIAS', { characterSpacing: 1 });
    doc.moveDown(0.6).fontSize(18).fillColor(INK).text(dossier.typeLabel, { width });
    doc.moveDown(0.2).fontSize(11).fillColor(BODY).font('Helvetica').text(`${dossier.marketplaceName} · ${dossier.bucketLabel}`);
    doc.moveDown(1);

    const summary: [string, string][] = [
      ['Seller', `${dossier.company} — loja ${dossier.storeName}`],
      ['Ocorrências', String(dossier.items.length)],
      ['Valor total a recuperar', brl(dossier.totalCents)],
      ['Prazo mais próximo', dossier.earliestDeadline ? date(dossier.earliestDeadline) : 'Sem prazo definido'],
      ['Gerado em', date(dossier.generatedAt)],
    ];
    for (const [key, value] of summary) {
      doc.fontSize(10).fillColor(INK).font('Helvetica-Bold').text(`${key}: `, { continued: true }).font('Helvetica').fillColor(BODY).text(value);
    }
    const policy = dossier.items.find((item) => item.details)?.details?.policy;
    if (policy) {
      doc.moveDown(0.8);
      label('Regra aplicável');
      body(policy);
    }

    if (dossier.requiredDocuments.length) {
      doc.moveDown(0.8);
      label('Documentos a anexar');
      for (const required of dossier.requiredDocuments) body(`• ${required}`);
    }

    dossier.items.forEach((item, index) => {
      doc.moveDown(1);
      if (doc.y > doc.page.height - 210) doc.addPage();
      doc.moveTo(48, doc.y).lineTo(48 + width, doc.y).strokeColor('#E2E8F0').stroke();
      doc.moveDown(0.6);
      doc.fontSize(11).fillColor(INK).font('Helvetica-Bold').text(`${index + 1}. ${item.productName}`, { width });
      doc.fontSize(9).fillColor(BODY).font('Helvetica').text(identifiers(item), { width });
      doc.moveDown(0.4);

      const details = item.details;
      const amounts = details
        ? `${details.amountLabels[0]}: ${brl(details.expectedCents)}   ·   ${details.amountLabels[1]}: ${brl(details.actualCents)}   ·   `
        : '';
      doc.fontSize(10).fillColor(INK).font('Helvetica-Bold').text(`${amounts}A recuperar: ${brl(item.recoverableCents)}`, { width });
      doc.moveDown(0.4);

      label('Memória de cálculo');
      for (const line of details?.calc ?? item.evidence) body(`• ${line}`);
      if (details?.timeline.length) {
        doc.moveDown(0.4);
        label('Cronologia');
        for (const event of details.timeline) body(`${date(event.at)} — ${event.label}`);
      }
    });

    doc.end();
  });
}

const xml = (text: string) => text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Planilha XLSX mínima (uma aba, cabeçalho em negrito), montada direto no formato Open XML. */
export function dossierXlsx(dossier: Dossier): Buffer {
  const rows: (string | number)[][] = [[...DOSSIER_COLUMNS], ...dossierRows(dossier)];
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
          if (value === '') return '';
          return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(safeCell(value))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files: Record<string, string> = {
    '[Content_Types].xml': `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${head}<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Ocorrências" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${head}<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `${head}<worksheet xmlns="${ns}"><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)]))));
}
