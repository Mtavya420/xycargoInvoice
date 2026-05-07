const fs = require("fs");
const path = require("path");
const express = require("express");
const { generateInvoiceBuffer } = require("./generate");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));

const baseInvoicePath = path.resolve("data/invoice.sample.json");

function readBaseInvoice() {
  const raw = fs.readFileSync(baseInvoicePath, "utf-8");
  return JSON.parse(raw);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function formPage(defaults, message) {
  const firstItem = defaults.items && defaults.items[0] ? defaults.items[0] : {
    packageName: "",
    boxNo: "",
    weightKg: "",
    cbm: "",
    unitPriceUsd: ""
  };

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>XY Cargo Invoice Form</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 980px; margin: 24px auto; padding: 0 12px; }
      h1 { margin-bottom: 6px; }
      .note { color: #555; margin-bottom: 18px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      label { font-weight: 600; font-size: 14px; display: block; margin-bottom: 4px; }
      input, select { width: 100%; padding: 8px; box-sizing: border-box; }
      .block { border: 1px solid #ddd; padding: 14px; margin-bottom: 14px; border-radius: 6px; }
      .row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px; }
      .items-header { font-weight: 700; font-size: 13px; color: #0d6efd; margin-bottom: 8px; }
      button { padding: 10px 14px; border: 0; border-radius: 6px; cursor: pointer; }
      .primary { background: #0d6efd; color: #fff; }
      .secondary { background: #f1f3f5; }
      .actions { display: flex; gap: 8px; }
      .msg { background: #ecfdf3; border: 1px solid #b7ebc6; padding: 10px; margin-bottom: 12px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>Invoice Generator</h1>
    <div class="note">Company and payment details are fixed. Fill fields below and click Generate PDF.</div>
    ${message ? `<div class="msg">${message}</div>` : ""}
    <form method="POST" action="/generate">
      <div class="block">
        <div class="grid">
          <div><label>Invoice No</label><input name="invoiceNo" value="${defaults.invoiceNo || ""}" required /></div>
          <div><label>Tracking No</label><input name="trackingNo" value="${defaults.trackingNo || ""}" required /></div>
          <div>
            <label>Shipping</label>
            <select name="shipping" required>
              <option value="BY AIR" ${(defaults.shipping || "").toUpperCase() === "BY AIR" ? "selected" : ""}>By Air</option>
              <option value="BY SEA" ${(defaults.shipping || "").toUpperCase() === "BY SEA" ? "selected" : ""}>By Sea</option>
            </select>
          </div>
          <div><label>Exchange Rate</label><input type="number" step="0.01" name="exchangeRate" value="${defaults.exchangeRate || 1500}" required /></div>
          <div>
            <label>Total Currency</label>
            <select name="totalCurrency" required>
              <option value="WON" ${(defaults.totalCurrency || "WON").toUpperCase() === "WON" ? "selected" : ""}>WON</option>
              <option value="TSH" ${(defaults.totalCurrency || "").toUpperCase() === "TSH" ? "selected" : ""}>TSH</option>
            </select>
          </div>
          <div><label>Invoice Date</label><input type="date" name="invoiceDate" value="${defaults.invoiceDate || ""}" required /></div>
          <div><label>Due Date</label><input type="date" name="dueDate" value="${defaults.dueDate || ""}" required /></div>
          <div><label>Batch No</label><input name="batchNo" value="${defaults.batchNo || ""}" required /></div>
          <div><label>Bill To Name</label><input name="billToName" value="${(defaults.billTo && defaults.billTo.name) || ""}" required /></div>
          <div><label>Bill To Phone</label><input name="billToPhone" value="${(defaults.billTo && defaults.billTo.phone) || ""}" required /></div>
        </div>
      </div>

      <div class="block">
        <div class="items-header">Items</div>
        <div id="items"></div>
        <div class="actions">
          <button type="button" class="secondary" onclick="addRow()">Add Item</button>
        </div>
      </div>

      <div class="actions">
        <button type="submit" class="primary">Generate PDF</button>
      </div>
    </form>

    <script>
      const initialItems = ${JSON.stringify(defaults.items && defaults.items.length ? defaults.items : [firstItem])};
      const itemsEl = document.getElementById("items");

      function rowTemplate(item = {}) {
        return \`
          <div class="row">
            <input name="packageName" placeholder="Package Name" value="\${item.packageName || ""}" required />
            <input name="boxNo" placeholder="Box No" value="\${item.boxNo || ""}" required />
            <input name="weightKg" type="number" step="0.01" placeholder="Weight" value="\${item.weightKg ?? ""}" required />
            <input name="cbm" type="number" step="0.01" placeholder="CBM" value="\${item.cbm ?? ""}" required />
            <input name="unitPriceUsd" type="number" step="0.01" placeholder="Unit Price" value="\${item.unitPriceUsd ?? ""}" required />
          </div>
        \`;
      }

      function addRow(item = {}) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = rowTemplate(item);
        itemsEl.appendChild(wrapper.firstElementChild);
      }

      initialItems.forEach((item) => addRow(item));
    </script>
  </body>
</html>`;
}

app.get("/", (req, res) => {
  const base = readBaseInvoice();
  res.send(formPage(base));
});

app.post("/generate", async (req, res) => {
  try {
    const base = readBaseInvoice();
    const packageName = normalizeArray(req.body.packageName || req.body["packageName[]"]);
    const boxNo = normalizeArray(req.body.boxNo || req.body["boxNo[]"]);
    const weightKg = normalizeArray(req.body.weightKg || req.body["weightKg[]"]);
    const cbm = normalizeArray(req.body.cbm || req.body["cbm[]"]);
    const unitPriceUsd = normalizeArray(req.body.unitPriceUsd || req.body["unitPriceUsd[]"]);

    const items = packageName.map((name, idx) => ({
      packageName: String(name || "").trim(),
      boxNo: String(boxNo[idx] || "").trim(),
      weightKg: Number(weightKg[idx] || 0),
      cbm: Number(cbm[idx] || 0),
      unitPriceUsd: Number(unitPriceUsd[idx] || 0)
    })).filter((item) => item.packageName);

    const invoice = {
      ...base,
      invoiceNo: String(req.body.invoiceNo || "").trim(),
      trackingNo: String(req.body.trackingNo || "").trim(),
      shipping: String(req.body.shipping || "BY AIR").trim().toUpperCase(),
      invoiceDate: String(req.body.invoiceDate || "").trim(),
      dueDate: String(req.body.dueDate || "").trim(),
      batchNo: String(req.body.batchNo || "").trim(),
      exchangeRate: Number(req.body.exchangeRate || 0),
      totalCurrency: String(req.body.totalCurrency || "WON").trim().toUpperCase(),
      billTo: {
        name: String(req.body.billToName || "").trim(),
        phone: String(req.body.billToPhone || "").trim()
      },
      items: items.length ? items : base.items
    };

    const { fileName, pdfBuffer } = await generateInvoiceBuffer(invoice);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=\"${fileName}\"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).send(`Failed to generate invoice: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Invoice form running at http://localhost:${PORT}`);
});
