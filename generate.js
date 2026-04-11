const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const { chromium } = require("playwright");

Handlebars.registerHelper("inc", function (value) {
  return parseInt(value, 10) + 1;
});

function formatNumber(n) {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function extToMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function getLogoDataUri(logoPath) {
  if (!logoPath) return "";
  const absoluteLogoPath = path.resolve(logoPath);
  if (!fs.existsSync(absoluteLogoPath)) return "";
  const mime = extToMime(absoluteLogoPath);
  const buffer = fs.readFileSync(absoluteLogoPath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function computeInvoice(data) {
  const shippingMode = String(data.shipping || "").trim().toUpperCase();
  const isSea = shippingMode === "BY SEA";
  const amountBaseKey = isSea ? "cbm" : "weightKg";

  const items = data.items.map((item) => {
    const amountBase = Number(item[amountBaseKey] || 0);
    const amountUsd = amountBase * Number(item.unitPriceUsd || 0);
    return {
      ...item,
      amountUsd: formatNumber(amountUsd)
    };
  });

  const totalWeight = data.items.reduce((s, i) => s + Number(i.weightKg || 0), 0);
  const totalCbm = data.items.reduce((s, i) => s + Number(i.cbm || 0), 0);
  const totalAmountUsdRaw = data.items.reduce(
    (s, i) => s + Number(i[amountBaseKey] || 0) * Number(i.unitPriceUsd || 0),
    0
  );
  const totalAmountWonRaw = totalAmountUsdRaw * Number(data.exchangeRate || 0);

  return {
    ...data,
    company: {
      ...data.company,
      logoSrc: getLogoDataUri(data.company && data.company.logoPath)
    },
    items,
    totalCurrency: String(data.totalCurrency || "WON").toUpperCase(),
    totalWeight: formatNumber(totalWeight),
    totalCbm: formatNumber(totalCbm),
    totalAmountUsd: formatNumber(totalAmountUsdRaw),
    totalAmountWon: formatNumber(totalAmountWonRaw),
    exchangeRate: formatNumber(data.exchangeRate)
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node generate.js <path-to-invoice-json>");
    process.exit(1);
  }

  const absInput = path.resolve(inputPath);
  if (!fs.existsSync(absInput)) {
    console.error(`Input file not found: ${absInput}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(absInput, "utf-8");
  const invoice = JSON.parse(raw);
  const pdfPath = await generateInvoicePdf(invoice);

  console.log(`Invoice generated: ${pdfPath}`);
}

function renderInvoiceHtml(invoiceData) {
  const templatePath = path.resolve("template.html");
  const templateSource = fs.readFileSync(templatePath, "utf-8");
  const template = Handlebars.compile(templateSource);
  const computed = computeInvoice(invoiceData);
  return { computed, html: template(computed) };
}

async function generateInvoicePdf(invoiceData, outputPath) {
  const { computed, html } = renderInvoiceHtml(invoiceData);
  const outputDir = path.resolve("output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const pdfPath = outputPath || path.join(outputDir, `invoice-${computed.invoiceNo}.pdf`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" }
    });
  } finally {
    await browser.close();
  }
  return pdfPath;
}

module.exports = {
  computeInvoice,
  renderInvoiceHtml,
  generateInvoicePdf
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
