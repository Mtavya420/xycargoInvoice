const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const { chromium: playwrightChromium } = require("playwright");
const { chromium: playwrightCoreChromium } = require("playwright-core");
const chromium = require("@sparticuz/chromium");

const TEMPLATE_PATH = path.join(__dirname, "template.html");
const DEFAULT_LOGO_PATH = path.join(__dirname, "assets", "company-logo.png");

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

function resolveLogoPath(logoPath) {
  const candidates = [];

  if (logoPath) {
    candidates.push(path.isAbsolute(logoPath) ? logoPath : path.resolve(__dirname, logoPath));
  }

  candidates.push(DEFAULT_LOGO_PATH);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function getLogoDataUri(logoPath) {
  const absoluteLogoPath = resolveLogoPath(logoPath);
  if (!absoluteLogoPath) return "";
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
  const templateSource = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const template = Handlebars.compile(templateSource);
  const computed = computeInvoice(invoiceData);
  return { computed, html: template(computed) };
}

function isServerlessRuntime() {
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_REGION ||
    process.env.AWS_EXECUTION_ENV ||
    process.env.LAMBDA_TASK_ROOT
  );
}

async function launchBrowser() {
  if (isServerlessRuntime()) {
    const executablePath = await chromium.executablePath();
    return playwrightCoreChromium.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless
    });
  }

  return playwrightChromium.launch();
}

async function buildPdf(invoiceData) {
  const { computed, html } = renderInvoiceHtml(invoiceData);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" }
    });
    return { computed, pdfBuffer };
  } finally {
    await browser.close();
  }
}

async function generateInvoiceBuffer(invoiceData) {
  const { computed, pdfBuffer } = await buildPdf(invoiceData);
  return {
    fileName: `invoice-${computed.invoiceNo}.pdf`,
    pdfBuffer
  };
}

async function generateInvoicePdf(invoiceData, outputPath) {
  const { computed, pdfBuffer } = await buildPdf(invoiceData);
  const outputDir = path.resolve("output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const pdfPath = outputPath || path.join(outputDir, `invoice-${computed.invoiceNo}.pdf`);
  fs.writeFileSync(pdfPath, pdfBuffer);
  return pdfPath;
}

module.exports = {
  computeInvoice,
  renderInvoiceHtml,
  generateInvoiceBuffer,
  generateInvoicePdf
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
