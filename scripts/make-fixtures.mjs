/** Regenerates the PDFs used for manual testing.
 *
 *    node scripts/make-fixtures.mjs
 *
 *  `public/samples/membership-form.pdf` ships with the app as the "try the
 *  sample" document. `build/fixtures/` holds the awkward cases — an embedded
 *  subset font with a ToUnicode CMap, which is what most real PDFs use and
 *  what the text editor has to cope with. */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'build/fixtures';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync('public/samples', { recursive: true });

// ---- the sample form: standard 14 fonts, a real AcroForm, a rotated page ---
{
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const p1 = doc.addPage([612, 792]);
  const label = (t, y, x = 56) =>
    p1.drawText(t, { x, y, size: 10, font: bold, color: rgb(0.2, 0.2, 0.25) });

  p1.drawText('Membership Application', { x: 56, y: 720, size: 22, font: bold });
  p1.drawText('Please complete every field and sign at the bottom.', {
    x: 56, y: 696, size: 11, font: helv, color: rgb(0.35, 0.35, 0.4),
  });

  label('Full name', 660);
  form.createTextField('applicant.name').addToPage(p1, { x: 56, y: 630, width: 240, height: 22 });
  label('Email address', 660, 316);
  form.createTextField('applicant.email').addToPage(p1, { x: 316, y: 630, width: 240, height: 22 });

  label('Mailing address', 604);
  const addr = form.createTextField('applicant.address');
  addr.enableMultiline();
  addr.addToPage(p1, { x: 56, y: 530, width: 500, height: 62 });

  label('Membership tier', 500);
  const tier = form.createRadioGroup('applicant.tier');
  ['Standard', 'Premium', 'Lifetime'].forEach((name, i) => {
    tier.addOptionToPage(name, p1, { x: 56 + i * 120, y: 474, width: 16, height: 16 });
    p1.drawText(name, { x: 78 + i * 120, y: 478, size: 11, font: helv });
  });

  label('Country', 440);
  const country = form.createDropdown('applicant.country');
  country.addOptions(['United States', 'Canada', 'United Kingdom', 'Germany', 'Japan']);
  country.addToPage(p1, { x: 56, y: 412, width: 220, height: 22 });

  form.createCheckBox('applicant.newsletter').addToPage(p1, { x: 56, y: 370, width: 15, height: 15 });
  p1.drawText('Send me the monthly newsletter', { x: 78, y: 373, size: 11, font: helv });
  form.createCheckBox('applicant.terms').addToPage(p1, { x: 56, y: 344, width: 15, height: 15 });
  p1.drawText('I accept the terms of membership', { x: 78, y: 347, size: 11, font: helv });

  for (const [x, w, text] of [[56, 244, 'Signature'], [340, 140, 'Date']]) {
    p1.drawLine({ start: { x, y: 250 }, end: { x: x + w, y: 250 }, thickness: 0.8, color: rgb(0.6, 0.6, 0.65) });
    p1.drawText(text, { x, y: 234, size: 9, font: helv, color: rgb(0.5, 0.5, 0.55) });
  }

  const p2 = doc.addPage([612, 792]);
  p2.drawText('Terms of Membership', { x: 56, y: 720, size: 18, font: bold });
  const prose = `Membership is granted on an annual basis and renews automatically unless the member
gives notice. The association keeps a register of members and the register is open
for inspection by any member on reasonable notice. Membership confers the right to
attend general meetings, to vote on resolutions, and to use the library and reading
rooms during published opening hours.

A member may resign at any time by written notice to the secretary. Subscriptions
already paid are not refundable. The committee may suspend or terminate membership
where a member has acted in a way that brings the association into disrepute, but only
after the member has had a fair opportunity to answer the complaint.

Personal data held about members is used solely for the administration of membership
and is never sold or shared with third parties. Members may request a copy of the data
held about them at any time.`;
  let y = 690;
  for (const line of prose.split('\n')) {
    p2.drawText(line, { x: 56, y, size: 11, font: helv, color: rgb(0.12, 0.12, 0.16) });
    y -= 17;
  }

  const p3 = doc.addPage([792, 612]);
  p3.setRotation({ type: 'degrees', angle: 90 });
  p3.drawText('Appendix A — rotated landscape page', { x: 56, y: 540, size: 16, font: bold });
  p3.drawText('This page has /Rotate 90 set in the file.', { x: 56, y: 512, size: 11, font: helv });

  fs.writeFileSync('public/samples/membership-form.pdf', await doc.save());
  console.log('wrote public/samples/membership-form.pdf');
}

// ---- embedded subset font, ToUnicode CMap, 2-byte CIDs ---------------------
{
  const candidates = [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial Unicode.ttf',
  ];
  const ttf = candidates.find((p) => fs.existsSync(p));
  if (!ttf) {
    console.log('skipped the embedded-font fixture (no TrueType file found)');
  } else {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fs.readFileSync(ttf), { subset: true });
    const page = doc.addPage([612, 792]);
    page.drawText('Invoice INV-2026-0417', { x: 56, y: 700, size: 24, font, color: rgb(0.1, 0.1, 0.15) });
    page.drawText('Amount due: $1,240.00', { x: 56, y: 660, size: 14, font });
    page.drawText('Customer: Ada Lovelace', { x: 56, y: 636, size: 14, font });
    const out = path.join(OUT, 'embedded-font.pdf');
    fs.writeFileSync(out, await doc.save());
    console.log(`wrote ${out} (from ${path.basename(ttf)})`);
  }
}
