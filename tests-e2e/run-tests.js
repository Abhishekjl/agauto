/**
 * Browser tests for the content-script scan/action logic, driven by the
 * system Chrome via puppeteer-core (no browser download).
 *
 * Run from the repo root:  npm run test:content
 * Override the browser:    CHROME_PATH=/path/to/chrome npm run test:content
 *
 * Each section reproduces a real failure seen on live application forms:
 *  [1] custom radios whose real <input> is CSS-hidden (agent skipped them)
 *  [2] framework-controlled checkbox that cancels programmatic clicks
 *  [3] custom dropdown mis-click going unnoticed (India → Indonesia)
 *  [5] question text living in a sibling <div>, not a <label>
 */
const puppeteer = require("puppeteer-core");
const path = require("path");

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.goto("file://" + path.join(__dirname, "testpage.html"));
  await page.addScriptTag({ path: path.join(__dirname, "bundle.js") });

  const scan = () =>
    page.evaluate(() => {
      const s = window.__agauto.scanPage();
      const byId = {};
      for (const e of s.elements) if (e.id) byId[e.id] = e;
      return { elements: s.elements, byId };
    });
  const act = (action) => page.evaluate((a) => window.__agauto.performAction(a), action);

  let { byId } = await scan();

  console.log("\n[1] Hidden custom radios (the skipped-radio bug)");
  check(
    "hidden radio with visible label is scanned as visible",
    byId["radio-yes"]?.geometry.visible === true,
    `visible=${byId["radio-yes"]?.geometry.visible}`
  );
  check(
    "radio label text captured",
    (byId["radio-yes"]?.label || "").includes("Yes, I am interested"),
    `label=${JSON.stringify(byId["radio-yes"]?.label)}`
  );
  const r1 = await act({ type: "set_checkbox", index: byId["radio-yes"].index, checked: true });
  const radioChecked = await page.$eval("#radio-yes", (el) => el.checked);
  check("set_checkbox actually selects the custom radio", r1.ok && radioChecked === true,
    `result=${JSON.stringify(r1)} checked=${radioChecked}`);
  const r1b = await act({ type: "set_checkbox", index: byId["radio-no"].index, checked: true });
  const yesAfter = await page.$eval("#radio-yes", (el) => el.checked);
  const noAfter = await page.$eval("#radio-no", (el) => el.checked);
  check("selecting the other radio switches the group", r1b.ok && noAfter === true && yesAfter === false,
    `yes=${yesAfter} no=${noAfter}`);

  console.log("\n[2] Framework-controlled checkbox that cancels clicks");
  const r2 = await act({ type: "set_checkbox", index: byId["controlled-cb"].index, checked: true });
  const cbChecked = await page.$eval("#controlled-cb", (el) => el.checked);
  check("native-setter fallback checks it anyway", r2.ok && cbChecked === true,
    `result=${JSON.stringify(r2)} checked=${cbChecked}`);

  console.log("\n[3] Custom dropdown (the India/Indonesia bug)");
  check(
    "combobox exposes its displayed text as value",
    byId["country-combo"]?.value === "Select country",
    `value=${JSON.stringify(byId["country-combo"]?.value)}`
  );
  const r3 = await act({ type: "click", index: byId["opt-indonesia"].index });
  check(
    "click result reports WHAT was clicked",
    r3.ok && r3.value === "Indonesia",
    `value=${JSON.stringify(r3.value)}`
  );
  ({ byId } = await scan());
  check(
    "rescan shows the combobox's new displayed value",
    byId["country-combo"]?.value === "Indonesia",
    `value=${JSON.stringify(byId["country-combo"]?.value)}`
  );

  console.log("\n[4] Native select exact-match");
  const r4 = await act({ type: "select_option", index: byId["country-native"].index, label: "India" });
  const nativeVal = await page.$eval("#country-native", (el) => el.value);
  check("label 'India' selects India, not Indonesia", r4.ok && nativeVal === "IN",
    `value=${nativeVal}`);

  console.log("\n[5] Div-based question label (the 'languages' bug)");
  const langsLabel = byId["langs-field"]?.label || "";
  check("full question text found via sibling div", langsLabel.includes("List the languages you write & speak"),
    `label=${JSON.stringify(langsLabel.slice(0, 80))}`);
  check("disambiguating example answer survives (cap 400)", langsLabel.includes("Example answer: Spanish"),
    `len=${langsLabel.length}`);

  console.log("\n[6] Label isolation between adjacent questions");
  check("field A gets its own question", (byId["field-a"]?.label || "").includes("Question A?"),
    `label=${JSON.stringify(byId["field-a"]?.label)}`);
  const bLabel = byId["field-b"]?.label || "";
  check("field B does NOT steal Question A's text", !bLabel.includes("Question A"),
    `label=${JSON.stringify(bLabel)}`);

  console.log("\n[7] aria-describedby fallback");
  check("describedby text used as label", (byId["notice-field"]?.label || "").includes("notice period"),
    `label=${JSON.stringify(byId["notice-field"]?.label)}`);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
